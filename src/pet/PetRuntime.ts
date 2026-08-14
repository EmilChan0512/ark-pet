import { Container, Graphics, Text } from 'pixi.js'
import type { CharacterManifestWithPaths, FacingDirection } from '../types/character'
import type { DebugStore } from '../types/pet'
import type { PetSettings } from '../settings/PetSettings'
import { NativeWindowService } from '../services/tauri'
import { PetController } from './PetController'
import { PetStateMachine } from './PetStateMachine'
import { RuntimeBehaviorAdapter } from './behavior/adapters/RuntimeBehaviorAdapter'
import { CharacterManager } from './character/CharacterManager'
import { DragController } from './interaction/DragController'
import { HitTestController } from './interaction/HitTestController'
import { PixiRenderer } from './renderer/PixiRenderer'

interface PointerSession {
  x: number
  y: number
}

export class PetRuntime {
  private readonly renderer = new PixiRenderer()
  private readonly stateMachine = new PetStateMachine()
  private readonly controller = new PetController(this.stateMachine)
  private readonly characterManager = new CharacterManager()
  private readonly nativeWindowService = new NativeWindowService()
  private readonly dragController = new DragController(
    this.nativeWindowService,
    (direction) => this.setFacing(direction),
  )
  private readonly behaviorAdapter: RuntimeBehaviorAdapter
  private readonly hitTestController = new HitTestController(
    () => this.getCharacterBounds(),
    async (passthroughEnabled) => {
      await this.nativeWindowService.setIgnoreCursorEvents(passthroughEnabled)
      this.debugStore.patch({ mousePassthrough: passthroughEnabled })
    },
  )

  private placeholder: Container | null = null
  private pointerDown: PointerSession | null = null
  private currentAnimation: string | null = null
  private currentManifest: CharacterManifestWithPaths | null = null
  private animationCompleteCleanup: (() => void) | null = null
  private windowMoveCleanup: (() => void) | null = null
  private cursorPollId: number | null = null
  private fpsSampleAt = 0
  private settings: PetSettings
  private uiInteractionActive = false
  private hidden = false
  private facing: FacingDirection = 'right'
  private readonly host: HTMLElement
  private readonly debugStore: DebugStore
  private readonly onSettingsRequested: () => void

  constructor(
    host: HTMLElement,
    debugStore: DebugStore,
    settings: PetSettings,
    onSettingsRequested: () => void,
  ) {
    this.host = host
    this.debugStore = debugStore
    this.settings = settings
    this.onSettingsRequested = onSettingsRequested
    this.behaviorAdapter = new RuntimeBehaviorAdapter(
      {
        enterIdle: () => this.applyIdleBehavior(),
        enterInteraction: () => this.applyInteractionBehavior(),
        enterDrag: () => this.applyDragBehavior(),
      },
      {
        publish: (snapshot) => {
          this.debugStore.patch({
            activeBehavior: snapshot.activeBehaviorId,
            lastBehaviorError: snapshot.lastError,
          })
        },
        reportError: (behaviorId, phase, error) => {
          console.error(`[BehaviorEngine] ${behaviorId}:${phase}`, error)
        },
      },
    )
  }

  private readonly updateDebugSnapshot = () => {
    this.behaviorAdapter.update(performance.now())
    const app = this.renderer.getApplication()
    const now = performance.now()
    if (now - this.fpsSampleAt > 250) {
      this.fpsSampleAt = now
      this.debugStore.patch({
        fps: Math.round(app.ticker.FPS),
        petState: this.stateMachine.getState(),
        currentAnimation: this.currentAnimation,
        characterManifest: this.currentManifest,
      })
    }
  }

  async init() {
    this.controller.enterLoading()
    this.debugStore.patch({ petState: 'loading', rendererStatus: 'idle' })

    try {
      const app = await this.renderer.init(this.host)
      this.debugStore.patch({ rendererStatus: 'ready' })

      this.renderer.setMaxFPS(this.settings.fps)
      await this.nativeWindowService.setAlwaysOnTop(this.settings.alwaysOnTop)
      await this.characterManager.init()

      this.windowMoveCleanup = await this.nativeWindowService.onMoved((position) => {
        this.debugStore.patch({
          windowPosition: { x: position.x, y: position.y },
        })
      })

      app.ticker.add(this.updateDebugSnapshot)

      this.attachPointerEvents()
      this.startCursorMonitor()
      await this.loadCharacter('demo')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.controller.enterError()
      this.createPlaceholder(message)
      this.debugStore.patch({
        petState: 'error',
        rendererStatus: 'error',
        lastError: message,
      })
    }
  }

  async show() {
    await this.nativeWindowService.show()
    this.renderer.resumeTicker()
    if (this.hidden) {
      this.hidden = false
      void this.behaviorAdapter.requestIdle('completed')
    }
  }

  async hide() {
    this.cancelPointerSession()
    await this.behaviorAdapter.cancel('hidden')
    this.hidden = true
    this.renderer.pauseTicker()
    await this.nativeWindowService.hide()
  }

  async reloadCharacter() {
    this.cancelPointerSession()
    await this.behaviorAdapter.cancel('reload')
    await this.loadCharacter(this.currentManifest?.id ?? 'demo')
  }

  async openSettings() {
    await this.show()
    this.onSettingsRequested()
  }

  async applySettings(settings: PetSettings) {
    this.settings = settings
    this.renderer.setMaxFPS(settings.fps)
    await this.nativeWindowService.setAlwaysOnTop(settings.alwaysOnTop)

    const character = this.characterManager.getCurrentCharacter()
    if (character && this.currentManifest) {
      character.setScale(this.currentManifest.scale * settings.scale)
      this.layoutCharacter()
    }
  }

  async setUiInteractionActive(active: boolean) {
    if (this.uiInteractionActive === active) return
    this.uiInteractionActive = active
    this.hitTestController.reset()

    if (active) {
      this.cancelPointerSession()
      await this.behaviorAdapter.cancel('paused')
      await this.nativeWindowService.setIgnoreCursorEvents(false)
      this.debugStore.patch({ mousePassthrough: false, hitTest: false })
    } else {
      void this.behaviorAdapter.requestIdle('completed')
    }
  }

  async destroy() {
    // Behavior cleanup owns future timers and motion subscriptions, so it must
    // finish before the renderer and native ports it may reference disappear.
    await this.behaviorAdapter.destroy()
    this.cancelPointerSession()
    this.animationCompleteCleanup?.()
    this.windowMoveCleanup?.()
    if (this.cursorPollId !== null) {
      window.clearInterval(this.cursorPollId)
      this.cursorPollId = null
    }
    this.detachPointerEvents()
    this.renderer.removeTickerCallback(this.updateDebugSnapshot)
    this.characterManager.destroy()
    this.placeholder?.destroy({ children: true })
    this.placeholder = null
    this.renderer.destroy()
  }

  private readonly handlePointerMove = async (event: PointerEvent) => {
    this.debugStore.patch({
      pointerPosition: { x: event.clientX, y: event.clientY },
    })

    if (!this.pointerDown) {
      await this.evaluatePointer(event.clientX, event.clientY)
      return
    }

    const deltaX = event.clientX - this.pointerDown.x
    const deltaY = event.clientY - this.pointerDown.y
    const moved = Math.hypot(deltaX, deltaY) > 4

    if (moved && !this.dragController.isDragging()) {
      const started = await this.dragController.start()
      if (started) {
        await this.nativeWindowService.setIgnoreCursorEvents(false)
        this.debugStore.patch({ mousePassthrough: false, hitTest: true })
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          this.setFacing(deltaX < 0 ? 'left' : 'right')
        }
        this.enterDragging()
      }
    }

    if (this.dragController.isDragging()) {
      await this.dragController.update()
    }
  }

  private readonly handlePointerDown = async (event: PointerEvent) => {
    const result = await this.evaluatePointer(event.clientX, event.clientY)
    if (!result.hit) return
    await this.behaviorAdapter.cancel('user-input')
    this.pointerDown = { x: event.clientX, y: event.clientY }
  }

  private readonly handlePointerUp = async (event: PointerEvent) => {
    if (this.dragController.isDragging()) {
      this.dragController.stop()
      this.enterIdle()
      this.pointerDown = null
      await this.evaluatePointer(event.clientX, event.clientY)
      return
    }

    const result = await this.evaluatePointer(event.clientX, event.clientY)
    if (this.pointerDown && result.hit) {
      this.enterInteracting()
    } else if (this.pointerDown) {
      this.enterIdle()
    }

    this.pointerDown = null
  }

  private readonly handlePointerCancel = () => {
    const hadPointerSession = this.pointerDown !== null
    this.cancelPointerSession()
    if (hadPointerSession) this.enterIdle()
  }

  private cancelPointerSession() {
    this.dragController.stop()
    this.pointerDown = null
  }

  private attachPointerEvents() {
    window.addEventListener('pointermove', this.handlePointerMove)
    window.addEventListener('pointerdown', this.handlePointerDown)
    window.addEventListener('pointerup', this.handlePointerUp)
    window.addEventListener('pointercancel', this.handlePointerCancel)
  }

  private detachPointerEvents() {
    window.removeEventListener('pointermove', this.handlePointerMove)
    window.removeEventListener('pointerdown', this.handlePointerDown)
    window.removeEventListener('pointerup', this.handlePointerUp)
    window.removeEventListener('pointercancel', this.handlePointerCancel)
  }

  private async loadCharacter(characterId: string) {
    await this.behaviorAdapter.cancel('reload')
    this.controller.enterLoading()
    this.debugStore.patch({
      petState: 'loading',
      currentAnimation: null,
      characterId: characterId,
      lastError: null,
    })

    this.animationCompleteCleanup?.()
    this.animationCompleteCleanup = null
    this.placeholder?.destroy({ children: true })
    this.placeholder = null

    try {
      const character = await this.characterManager.loadCharacter(
        characterId,
        this.renderer.getRoot(),
      )
      this.currentManifest = this.characterManager.getCurrentManifest()
      if (this.currentManifest) {
        this.facing = this.currentManifest.nativeFacing ?? 'right'
        character.setScale(this.currentManifest.scale * this.settings.scale)
        character.setFacing(this.facing)
      }
      this.layoutCharacter()

      this.animationCompleteCleanup = character.onAnimationComplete(() => {
        if (this.stateMachine.getState() === 'interacting') {
          this.enterIdle()
        }
      })

      this.enterIdle()

      this.debugStore.patch({
        petState: 'idle',
        characterId,
        characterManifest: this.currentManifest,
        currentAnimation: this.currentAnimation,
        lastError: null,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(message)
      this.controller.enterError()
      this.createPlaceholder(message)
      this.debugStore.patch({
        petState: 'error',
        characterId,
        characterManifest: this.currentManifest,
        currentAnimation: null,
        lastError: message,
      })
    }
  }

  private enterIdle() {
    void this.behaviorAdapter.requestIdle('completed')
  }

  private applyIdleBehavior() {
    const character = this.characterManager.getCurrentCharacter()
    if (!character || !this.currentManifest) return

    this.currentAnimation =
      this.controller.enterIdle(character, this.currentManifest)?.animation?.name ??
      this.currentManifest.animations.idle
    this.debugStore.patch({
      petState: 'idle',
      currentAnimation: this.currentAnimation,
    })
  }

  private enterInteracting() {
    void this.behaviorAdapter.requestInteraction()
  }

  private applyInteractionBehavior() {
    const character = this.characterManager.getCurrentCharacter()
    if (!character || !this.currentManifest) return

    this.currentAnimation =
      this.controller.enterInteracting(character, this.currentManifest)?.animation?.name ??
      this.currentManifest.animations.idle
    this.debugStore.patch({
      petState: 'interacting',
      currentAnimation: this.currentAnimation,
    })
  }

  private enterDragging() {
    void this.behaviorAdapter.requestDrag()
  }

  private applyDragBehavior() {
    const character = this.characterManager.getCurrentCharacter()
    if (!character || !this.currentManifest) return

    this.currentAnimation =
      this.controller.enterDragging(character, this.currentManifest)?.animation?.name ??
      this.currentManifest.animations.idle
    this.debugStore.patch({
      petState: 'dragging',
      currentAnimation: this.currentAnimation,
    })
  }

  private setFacing(facing: FacingDirection) {
    if (this.facing === facing) return
    this.facing = facing
    this.characterManager.getCurrentCharacter()?.setFacing(facing)
  }

  private layoutCharacter() {
    const character = this.characterManager.getCurrentCharacter()
    const view = character?.getView()
    if (!character || !view) return

    const bounds = character.getLocalBounds()
    if (!bounds) return

    view.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height)
    character.setPosition(window.innerWidth / 2, window.innerHeight - 18)
  }

  private createPlaceholder(message: string) {
    const root = this.renderer.getRoot()
    const container = new Container()
    const pet = new Graphics()

    pet.beginFill(0x8b5cf6, 0.88)
    pet.drawRoundedRect(0, 0, 180, 220, 48)
    pet.endFill()

    pet.beginFill(0xffffff, 0.95)
    pet.drawCircle(55, 58, 12)
    pet.drawCircle(125, 58, 12)
    pet.endFill()

    pet.beginFill(0x111827, 1)
    pet.drawCircle(55, 58, 4)
    pet.drawCircle(125, 58, 4)
    pet.endFill()

    pet.beginFill(0xffffff, 0.92)
    pet.drawRoundedRect(60, 128, 60, 12, 6)
    pet.endFill()

    const label = new Text('PLACEHOLDER PET', {
      fill: '#ffffff',
      fontSize: 18,
      fontWeight: '700',
    })
    label.position.set(10, 236)

    const details = new Text(message.split('\n').slice(0, 4).join('\n'), {
      fill: '#f5f3ff',
      fontSize: 11,
      wordWrap: true,
      wordWrapWidth: 220,
    })
    details.position.set(10, 270)

    container.addChild(pet, label, details)
    container.pivot.set(90, 110)
    container.position.set(window.innerWidth / 2, window.innerHeight - 22)
    root.addChild(container)

    this.placeholder = container
  }

  private getCharacterBounds() {
    const character = this.characterManager.getCurrentCharacter()
    const bounds = character?.getBounds() ?? this.placeholder?.getBounds() ?? null
    return bounds ? new DOMRect(bounds.x, bounds.y, bounds.width, bounds.height) : null
  }

  private async evaluatePointer(clientX: number, clientY: number) {
    if (this.uiInteractionActive) {
      return { hit: false, pointer: { x: clientX, y: clientY } }
    }
    if (this.dragController.isDragging()) {
      this.debugStore.patch({
        pointerPosition: { x: clientX, y: clientY },
        hitTest: true,
        mousePassthrough: false,
      })
      return { hit: true, pointer: { x: clientX, y: clientY } }
    }
    const result = await this.hitTestController.evaluate(clientX, clientY)
    this.debugStore.patch({
      pointerPosition: result.pointer,
      hitTest: result.hit,
    })
    return result
  }

  private startCursorMonitor() {
    if (!this.nativeWindowService.isAvailable()) return

    this.cursorPollId = window.setInterval(async () => {
      const [cursor, windowPosition, scaleFactor] = await Promise.all([
        this.nativeWindowService.getCursorPosition(),
        this.nativeWindowService.getWindowPosition(),
        this.nativeWindowService.getScaleFactor(),
      ])

      if (!cursor || !windowPosition) return

      const localX = (cursor.x - windowPosition.x) / scaleFactor
      const localY = (cursor.y - windowPosition.y) / scaleFactor

      this.debugStore.patch({
        pointerPosition: { x: localX, y: localY },
        windowPosition: { x: windowPosition.x, y: windowPosition.y },
      })

      await this.evaluatePointer(localX, localY)
    }, 100)
  }
}
