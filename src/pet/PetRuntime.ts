import { Container, Graphics, Text } from 'pixi.js'
import type { CharacterManifestWithPaths } from '../types/character'
import type { DebugStore } from '../types/pet'
import { NativeWindowService } from '../services/tauri'
import { PetController } from './PetController'
import { PetStateMachine } from './PetStateMachine'
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
  private readonly dragController = new DragController(this.nativeWindowService)
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
  private readonly host: HTMLElement
  private readonly debugStore: DebugStore

  constructor(host: HTMLElement, debugStore: DebugStore) {
    this.host = host
    this.debugStore = debugStore
  }

  async init() {
    this.controller.enterLoading()
    this.debugStore.patch({ petState: 'loading', rendererStatus: 'idle' })

    try {
      const app = await this.renderer.init(this.host)
      this.debugStore.patch({ rendererStatus: 'ready' })

      await this.nativeWindowService.setAlwaysOnTop(true)
      await this.characterManager.init()

      this.windowMoveCleanup = await this.nativeWindowService.onMoved((position) => {
        this.debugStore.patch({
          windowPosition: { x: position.x, y: position.y },
        })
      })

      app.ticker.add(() => {
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
      })

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
  }

  async hide() {
    this.renderer.pauseTicker()
    await this.nativeWindowService.hide()
  }

  async reloadCharacter() {
    await this.loadCharacter(this.currentManifest?.id ?? 'demo')
  }

  async openSettings() {
    console.info('[PetRuntime] Settings requested')
  }

  destroy() {
    this.animationCompleteCleanup?.()
    this.windowMoveCleanup?.()
    if (this.cursorPollId !== null) {
      window.clearInterval(this.cursorPollId)
      this.cursorPollId = null
    }
    this.detachPointerEvents()
    this.characterManager.destroy()
    this.placeholder?.destroy({ children: true })
    this.placeholder = null
    this.renderer.destroy()
  }

  private readonly handlePointerMove = async (event: PointerEvent) => {
    this.debugStore.patch({
      pointerPosition: { x: event.clientX, y: event.clientY },
    })

    await this.evaluatePointer(event.clientX, event.clientY)

    if (!this.pointerDown) return

    const deltaX = event.clientX - this.pointerDown.x
    const deltaY = event.clientY - this.pointerDown.y
    const moved = Math.hypot(deltaX, deltaY) > 4

    if (moved && !this.dragController.isDragging()) {
      const started = await this.dragController.start(this.pointerDown.x, this.pointerDown.y)
      if (started) {
        this.enterDragging()
      }
    }

    if (this.dragController.isDragging()) {
      await this.dragController.update(event.clientX, event.clientY)
    }
  }

  private readonly handlePointerDown = async (event: PointerEvent) => {
    const result = await this.evaluatePointer(event.clientX, event.clientY)
    if (!result.hit) return
    this.pointerDown = { x: event.clientX, y: event.clientY }
  }

  private readonly handlePointerUp = async (event: PointerEvent) => {
    const result = await this.evaluatePointer(event.clientX, event.clientY)

    if (this.dragController.isDragging()) {
      this.dragController.stop()
      this.enterIdle()
      this.pointerDown = null
      return
    }

    if (this.pointerDown && result.hit) {
      this.enterInteracting()
    }

    this.pointerDown = null
  }

  private attachPointerEvents() {
    window.addEventListener('pointermove', this.handlePointerMove)
    window.addEventListener('pointerdown', this.handlePointerDown)
    window.addEventListener('pointerup', this.handlePointerUp)
  }

  private detachPointerEvents() {
    window.removeEventListener('pointermove', this.handlePointerMove)
    window.removeEventListener('pointerdown', this.handlePointerDown)
    window.removeEventListener('pointerup', this.handlePointerUp)
  }

  private async loadCharacter(characterId: string) {
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
    const character = this.characterManager.getCurrentCharacter()
    if (!character || !this.currentManifest) return

    this.controller.enterIdle(character, this.currentManifest)
    this.currentAnimation = character.play(this.currentManifest.animations.idle, true)
      ?.animation?.name ?? this.currentManifest.animations.idle
    this.debugStore.patch({
      petState: 'idle',
      currentAnimation: this.currentAnimation,
    })
  }

  private enterInteracting() {
    const character = this.characterManager.getCurrentCharacter()
    if (!character || !this.currentManifest) return

    this.controller.enterInteracting(character, this.currentManifest)
    this.currentAnimation =
      character.play(
        this.currentManifest.animations.interact,
        false,
        this.currentManifest.animations.idle,
      )?.animation?.name ?? this.currentManifest.animations.idle
    this.debugStore.patch({
      petState: 'interacting',
      currentAnimation: this.currentAnimation,
    })
  }

  private enterDragging() {
    const character = this.characterManager.getCurrentCharacter()
    if (!character || !this.currentManifest) return

    this.controller.enterDragging(character, this.currentManifest)
    this.currentAnimation =
      character.play(
        this.currentManifest.animations.drag,
        true,
        this.currentManifest.animations.idle,
      )?.animation?.name ?? this.currentManifest.animations.idle
    this.debugStore.patch({
      petState: 'dragging',
      currentAnimation: this.currentAnimation,
    })
  }

  private layoutCharacter() {
    const character = this.characterManager.getCurrentCharacter()
    const view = character?.getView()
    if (!character || !view) return

    const bounds = character.getBounds()
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
      const [cursor, windowPosition] = await Promise.all([
        this.nativeWindowService.getCursorPosition(),
        this.nativeWindowService.getWindowPosition(),
      ])

      if (!cursor || !windowPosition) return

      const localX = cursor.x - windowPosition.x
      const localY = cursor.y - windowPosition.y

      this.debugStore.patch({
        pointerPosition: { x: localX, y: localY },
        windowPosition: { x: windowPosition.x, y: windowPosition.y },
      })

      await this.evaluatePointer(localX, localY)
    }, 100)
  }
}
