import { Container, Graphics, Text } from 'pixi.js'
import type { CharacterManifestWithPaths, FacingDirection } from '../types/character'
import type { DebugStore } from '../types/pet'
import type { PetSettings } from '../settings/PetSettings'
import { NativeWindowService } from '../services/tauri'
import { PetController } from './PetController'
import { PetStateMachine } from './PetStateMachine'
import { RuntimeBehaviorAdapter } from './behavior/adapters/RuntimeBehaviorAdapter'
import { TauriWindowMotionAdapter } from './behavior/adapters/TauriWindowMotionAdapter'
import type { AmbientAnimationKind } from './behavior/ambient/AmbientBehaviorModule'
import { CharacterManager } from './character/CharacterManager'
import { DragController } from './interaction/DragController'
import { HitTestController } from './interaction/HitTestController'
import { PixiRenderer } from './renderer/PixiRenderer'
import { SpeechSessionCoordinator } from './speech/SpeechSessionCoordinator'
import { DomSpeechBubbleRenderer } from './speech/adapters/DomSpeechBubbleRenderer'
import { HtmlAudioPlaybackAdapter } from './speech/adapters/HtmlAudioPlaybackAdapter'
import { TauriCharacterVoiceResolver } from './speech/adapters/TauriCharacterVoiceResolver'
import type { SpeakRequest, SpeechCancellationReason } from './speech/types'
import { ContextEventBus } from './reaction/ContextEventBus'
import { ReactionEngine } from './reaction/ReactionEngine'
import { RuntimeReactionAdapter } from './reaction/adapters/RuntimeReactionAdapter'
import { InteractionContextSource } from './reaction/sources/InteractionContextSource'
import { SessionContextSource } from './reaction/sources/SessionContextSource'
import { TimeContextSource } from './reaction/sources/TimeContextSource'
import { loadCharacterPersona } from './persona/CharacterPersonaLoader'
import type { ContextEvent } from './reaction/types'

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
  private readonly windowMotionAdapter = new TauriWindowMotionAdapter(
    this.nativeWindowService,
  )
  private readonly dragController = new DragController(
    this.nativeWindowService,
    (direction) => this.setFacing(direction),
  )
  private readonly behaviorAdapter: RuntimeBehaviorAdapter
  private readonly speechCoordinator: SpeechSessionCoordinator
  private readonly contextEventBus = new ContextEventBus({
    reportSubscriberError: (event, error) => console.error(`[ContextEventBus] ${event.type}`, error),
  })
  private readonly reactionAdapter: RuntimeReactionAdapter
  private readonly interactionContextSource: InteractionContextSource
  private readonly sessionContextSource: SessionContextSource
  private readonly timeContextSource: TimeContextSource
  private reactionEngine: ReactionEngine | null = null
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
  private pointerOverInteractiveUi = false
  private debugPanelWindowExpanded: boolean | null = null
  private hidden = false
  private facing: FacingDirection = 'right'
  private characterGeneration = 0
  private readonly host: HTMLElement
  private readonly debugStore: DebugStore
  private readonly onSettingsRequested: () => void
  private readonly getInteractiveUiBounds: () => DOMRect | null

  constructor(
    host: HTMLElement,
    debugStore: DebugStore,
    settings: PetSettings,
    onSettingsRequested: () => void,
    getInteractiveUiBounds: () => DOMRect | null = () => null,
  ) {
    this.host = host
    this.debugStore = debugStore
    this.settings = settings
    this.onSettingsRequested = onSettingsRequested
    this.getInteractiveUiBounds = getInteractiveUiBounds
    this.speechCoordinator = new SpeechSessionCoordinator(
      new DomSpeechBubbleRenderer(host, () => this.getCharacterBounds()),
      new TauriCharacterVoiceResolver(() => this.settings.characterVoiceFallback),
      new HtmlAudioPlaybackAdapter(),
      () => {
        const voice = this.currentManifest?.voice
        if (!voice) return null
        return {
          characterId: voice.characterId,
          characterGeneration: this.characterGeneration,
          voiceIdentity: voice.voiceIdentity,
        }
      },
      {
        publish: (snapshot) => {
          this.debugStore.patch({
            activeSpeechSession: snapshot.activeSessionId,
            speechQueueDepth: snapshot.queueDepth,
            speechAudioSource: snapshot.activeAudioSource,
            speechVoiceEnabled: snapshot.voiceEnabled,
            voiceProgressStatus: snapshot.voiceProgressStatus,
            voiceProgressLog: snapshot.voiceProgressLog,
            lastSpeechError: snapshot.lastError,
          })
        },
        reportError: (sessionId, phase, error) => {
          console.error(`[SpeechSession] ${sessionId}:${phase}`, error)
        },
      },
      { volume: settings.characterVoiceVolume },
    )
    this.speechCoordinator.setVoiceEnabled(settings.speechMode === 'character-voice')
    if (settings.speechMode !== 'off') this.speechCoordinator.resume()
    this.behaviorAdapter = new RuntimeBehaviorAdapter(
      {
        enterIdle: () => this.applyIdleBehavior(),
        enterInteraction: () => this.applyInteractionBehavior(),
        enterDrag: () => this.applyDragBehavior(),
        ambientAnimation: {
          has: (kind) => this.hasAmbientAnimation(kind),
          enter: (kind) => this.applyAmbientBehavior(kind),
          setFacing: (direction) => this.setFacing(direction),
        },
        windowMotion: this.windowMotionAdapter,
        random: { next: () => Math.random() },
      },
      settings.autonomousBehavior,
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
      (snapshot) => {
        this.debugStore.patch({
          ambientSchedulerStatus: snapshot.status,
          nextAmbientActionAt: snapshot.nextActionAt,
        })
      },
    )
    this.reactionAdapter = new RuntimeReactionAdapter({
      hasAnimation: (name) => Boolean(this.characterManager.getCurrentCharacter()?.hasAnimation(name)),
      hasBehavior: (id) => this.behaviorAdapter.hasBehavior(id),
      requestAnimation: (name) => this.requestReactionAnimation(name),
      requestBehavior: (id) => this.behaviorAdapter.requestReaction(id, performance.now()),
      enqueueSpeech: (request) => this.enqueueSpeech(request),
    })
    this.interactionContextSource = new InteractionContextSource(this.contextEventBus)
    this.sessionContextSource = new SessionContextSource(this.contextEventBus, {
      getLastDate: () => {
        try { return window.localStorage.getItem('ark-pet.personality.first-meeting-date') } catch { return null }
      },
      setLastDate: (date) => window.localStorage.setItem('ark-pet.personality.first-meeting-date', date),
      clear: () => window.localStorage.removeItem('ark-pet.personality.first-meeting-date'),
    })
    this.timeContextSource = new TimeContextSource(this.contextEventBus)
    this.contextEventBus.subscribe((event) => this.reactionEngine?.handle(event))
  }

  private readonly updateDebugSnapshot = () => {
    const now = performance.now()
    this.behaviorAdapter.update(now)
    this.speechCoordinator.update(now)
    this.reactionAdapter.update(now)
    this.interactionContextSource.update(now)
    this.sessionContextSource.update(now)
    this.timeContextSource.update(now)
    const app = this.renderer.getApplication()
    if (now - this.fpsSampleAt > 250) {
      this.fpsSampleAt = now
      this.debugStore.patch({
        fps: Math.round(app.ticker.FPS),
        petState: this.stateMachine.getState(),
        currentAnimation: this.currentAnimation,
        characterManifest: this.currentManifest,
        currentLocalTimePeriod: this.timeContextSource.getPeriod(),
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
      this.resumeSpeechIfAllowed()
    }
  }

  async show() {
    await this.nativeWindowService.show()
    this.renderer.resumeTicker()
    if (this.hidden) {
      this.hidden = false
      void this.behaviorAdapter.resume(performance.now())
      this.resumeSpeechIfAllowed()
    }
  }

  async hide() {
    this.cancelPointerSession()
    this.cancelReactions('hidden')
    this.speechCoordinator.pause('hidden')
    await this.behaviorAdapter.pause('hidden')
    this.hidden = true
    this.renderer.pauseTicker()
    await this.nativeWindowService.hide()
  }

  async reloadCharacter() {
    this.cancelPointerSession()
    this.cancelReactions('reload')
    this.speechCoordinator.pause('reload')
    await this.behaviorAdapter.pause('reload')
    await this.loadCharacter(this.currentManifest?.id ?? 'demo')
  }

  async openSettings() {
    await this.show()
    this.onSettingsRequested()
  }

  /** Hands external text to the speech-owned queue without blocking runtime commands. */
  enqueueSpeech(request: SpeakRequest) {
    if (this.settings.speechMode === 'off') return
    void this.speechCoordinator.enqueue(request, performance.now())
  }

  cancelSpeech(reason: SpeechCancellationReason) {
    this.speechCoordinator.cancelAll(reason)
  }

  simulateContextEvent(event: ContextEvent) {
    this.contextEventBus.publish(event)
  }

  clearFirstMeetingMarker() {
    this.sessionContextSource.clearFirstMeetingMarker()
  }

  clearReactionCooldowns() {
    this.reactionEngine?.clearCooldowns()
    try {
      const keys: string[] = []
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index)
        if (key?.startsWith('ark-pet.personality.daily.')) keys.push(key)
      }
      for (const key of keys) window.localStorage.removeItem(key)
    } catch (error) {
      console.warn('[ReactionEngine] Could not clear daily cooldowns', error)
    }
  }

  /** Explicit preflight for development tools that must not race cold startup. */
  prepareCharacterVoice() {
    return this.speechCoordinator.prepareVoice()
  }

  async applySettings(settings: PetSettings) {
    const personalityChanged = this.settings.personalityEnabled !== settings.personalityEnabled
    this.settings = settings
    if (
      import.meta.env.DEV &&
      this.debugPanelWindowExpanded !== settings.showDebugPanel
    ) {
      this.debugPanelWindowExpanded = settings.showDebugPanel
      // A 400 px pet window cannot contain both the character and a 280 px
      // diagnostics panel side by side. Expand only in development while the
      // panel is visible; production and panel-off geometry stay unchanged.
      await this.nativeWindowService.setWindowSize(
        settings.showDebugPanel ? 800 : 400,
        500,
      )
    }
    this.renderer.setMaxFPS(settings.fps)
    await this.nativeWindowService.setAlwaysOnTop(settings.alwaysOnTop)
    await this.behaviorAdapter.setAutonomousEnabled(
      settings.autonomousBehavior,
      performance.now(),
    )
    this.speechCoordinator.setVolume(settings.characterVoiceVolume)
    this.speechCoordinator.setVoiceEnabled(settings.speechMode === 'character-voice')
    if (settings.speechMode === 'off') this.speechCoordinator.pause('disabled')
    else this.resumeSpeechIfAllowed()
    this.reactionEngine?.setEnabled(settings.personalityEnabled)
    if (personalityChanged && !settings.personalityEnabled) {
      this.reactionAdapter.cancel('disabled')
      this.sessionContextSource.reset()
      this.timeContextSource.setReady(false)
    } else if (personalityChanged && settings.personalityEnabled && this.currentManifest) {
      const now = performance.now()
      this.sessionContextSource.characterReady(now, this.localDateKey())
      this.timeContextSource.setReady(true)
      this.timeContextSource.update(now)
    }

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
      this.cancelReactions('ui-interaction')
      this.speechCoordinator.pause('ui-interaction')
      // Acquire UI input before awaiting behavior cancellation. Otherwise a
      // concurrent ticker transition can leave a visible settings panel under
      // native mouse passthrough until the behavior exit barrier settles.
      await this.nativeWindowService.setIgnoreCursorEvents(false)
      this.debugStore.patch({ mousePassthrough: false, hitTest: false })
      await this.behaviorAdapter.pause('paused')
    } else {
      void this.behaviorAdapter.resume(performance.now())
      this.resumeSpeechIfAllowed()
    }
  }

  async destroy() {
    // Behavior cleanup owns future timers and motion subscriptions, so it must
    // finish before the renderer and native ports it may reference disappear.
    this.reactionEngine?.destroy()
    this.reactionAdapter.cancel('destroyed')
    this.contextEventBus.destroy()
    await this.speechCoordinator.destroy()
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
    this.sessionContextSource.recordActivity(performance.now())
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
        const now = performance.now()
        this.cancelReactions('drag-started')
        this.interactionContextSource.dragStarted(now)
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
    const now = performance.now()
    this.sessionContextSource.recordActivity(now)
    // Preserve pending clicks across pointer sequences so the interaction
    // source can distinguish a repeated click from unrelated single clicks.
    this.cancelReactions('manual-interaction', false)
    this.speechCoordinator.cancelAll('replaced')
    await this.behaviorAdapter.interruptForUser(now)
    this.pointerDown = { x: event.clientX, y: event.clientY }
  }

  private readonly handlePointerUp = async (event: PointerEvent) => {
    if (this.dragController.isDragging()) {
      this.interactionContextSource.dragEnded(performance.now())
      this.dragController.stop()
      this.enterIdle()
      this.pointerDown = null
      await this.evaluatePointer(event.clientX, event.clientY)
      return
    }

    const result = await this.evaluatePointer(event.clientX, event.clientY)
    if (this.pointerDown && result.hit) {
      this.enterInteracting()
      this.interactionContextSource.recordClick(performance.now())
    } else if (this.pointerDown) {
      this.enterIdle()
    }

    this.pointerDown = null
  }

  private readonly handlePointerCancel = () => {
    const hadPointerSession = this.pointerDown !== null
    this.cancelPointerSession()
    this.interactionContextSource.cancel()
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
    this.cancelReactions('character-reload')
    this.sessionContextSource.reset()
    this.timeContextSource.setReady(false)
    await this.behaviorAdapter.pause('reload')
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
      this.characterGeneration += 1
      if (this.currentManifest) {
        this.facing = this.currentManifest.nativeFacing ?? 'right'
        character.setScale(this.currentManifest.scale * this.settings.scale)
        character.setFacing(this.facing)
      }
      this.layoutCharacter()
      this.behaviorAdapter.refreshAmbientCapabilities()

      try {
        const persona = await loadCharacterPersona(characterId)
        if (persona.characterId !== characterId) throw new Error(`Character Persona Error: expected ${characterId}, received ${persona.characterId}`)
        if (this.reactionEngine) this.reactionEngine.setPersona(persona)
        else {
          this.reactionEngine = new ReactionEngine(
            persona,
            { now: () => performance.now() },
            { next: () => Math.random() },
            this.reactionAdapter,
            {
              publish: (snapshot) => this.debugStore.patch({
                lastContextEvent: snapshot.lastEvent,
                selectedReactionId: snapshot.selectedReactionId,
                activeReactionId: snapshot.activeReactionId,
                reactionState: snapshot.activeState,
                reactionBlockedReason: snapshot.blockedReason,
                reactionDecisionLog: snapshot.decisionLog,
              }),
              reportError: (reactionId, error) => {
                const message = `[${reactionId}] ${error instanceof Error ? error.message : String(error)}`
                console.error('[ReactionEngine]', message)
                this.debugStore.patch({ lastReactionError: message })
              },
            },
            undefined,
            {
              currentDate: () => this.localDateKey(),
              getDate: (key) => {
                try { return window.localStorage.getItem(`ark-pet.personality.daily.${key}`) } catch { return null }
              },
              setDate: (key, date) => window.localStorage.setItem(`ark-pet.personality.daily.${key}`, date),
            },
          )
        }
        this.reactionEngine.setEnabled(this.settings.personalityEnabled)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(message)
        this.debugStore.patch({ lastReactionError: message })
      }

      this.animationCompleteCleanup = character.onAnimationComplete(() => {
        if (this.stateMachine.getState() === 'interacting') {
          this.enterIdle()
        }
      })

      this.enterIdle()
      if (!this.hidden && !this.uiInteractionActive) {
        void this.behaviorAdapter.resume(performance.now())
        this.resumeSpeechIfAllowed()
      }
      if (this.settings.personalityEnabled) {
        const now = performance.now()
        this.sessionContextSource.characterReady(now, this.localDateKey())
        this.timeContextSource.setReady(true)
        this.timeContextSource.update(now)
      }

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
    void this.behaviorAdapter.requestInteraction(performance.now())
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

  private resumeSpeechIfAllowed() {
    if (
      this.settings.speechMode !== 'off' &&
      !this.hidden &&
      !this.uiInteractionActive
    ) {
      this.speechCoordinator.resume()
    }
  }

  private enterDragging() {
    void this.behaviorAdapter.requestDrag(performance.now())
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

  private requestReactionAnimation(name: string) {
    const character = this.characterManager.getCurrentCharacter()
    if (!character?.hasAnimation(name)) return
    character.play(name, false, this.currentManifest?.animations.idle)
    this.currentAnimation = name
    this.debugStore.patch({ currentAnimation: name })
  }

  private cancelReactions(reason: string, resetInteractionSource = true) {
    this.reactionEngine?.cancel(reason)
    this.reactionAdapter.cancel(reason)
    if (resetInteractionSource) this.interactionContextSource.cancel()
  }

  private localDateKey() {
    const date = new Date()
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  private hasAmbientAnimation(kind: AmbientAnimationKind) {
    const character = this.characterManager.getCurrentCharacter()
    const animationName = this.getAmbientAnimationName(kind)
    return Boolean(character && animationName && character.hasAnimation(animationName))
  }

  private applyAmbientBehavior(kind: AmbientAnimationKind) {
    const character = this.characterManager.getCurrentCharacter()
    if (!character || !this.currentManifest) return

    const entry =
      kind === 'walk'
        ? this.controller.enterWalking(character, this.currentManifest)
        : kind === 'sit'
          ? this.controller.enterSitting(character, this.currentManifest)
          : this.controller.enterSleeping(character, this.currentManifest)
    this.currentAnimation = entry?.animation?.name ?? this.currentManifest.animations.idle
    this.debugStore.patch({
      petState: kind === 'walk' ? 'walking' : kind === 'sit' ? 'sitting' : 'sleeping',
      currentAnimation: this.currentAnimation,
    })
  }

  private getAmbientAnimationName(kind: AmbientAnimationKind) {
    if (!this.currentManifest) return null
    if (kind === 'walk') {
      return (
        this.currentManifest.animations.walk ??
        this.currentManifest.animations.drag ??
        this.currentManifest.animations.idle
      )
    }
    return this.currentManifest.animations[kind] ?? null
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
    const uiBounds = this.getInteractiveUiBounds()
    const overInteractiveUi = Boolean(
      uiBounds &&
        clientX >= uiBounds.left &&
        clientX <= uiBounds.right &&
        clientY >= uiBounds.top &&
        clientY <= uiBounds.bottom,
    )
    if (overInteractiveUi) {
      if (!this.pointerOverInteractiveUi) {
        this.pointerOverInteractiveUi = true
        // Native cursor passthrough is window-wide. Acquire input only while
        // the global cursor monitor sees the pointer over a registered DOM UI
        // region, then reset pet hit-test state so leaving restores passthrough.
        this.hitTestController.reset()
        await this.nativeWindowService.setIgnoreCursorEvents(false)
        this.debugStore.patch({ mousePassthrough: false, hitTest: false })
      }
      return { hit: false, pointer: { x: clientX, y: clientY } }
    }
    if (this.pointerOverInteractiveUi) {
      this.pointerOverInteractiveUi = false
      this.hitTestController.reset()
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
