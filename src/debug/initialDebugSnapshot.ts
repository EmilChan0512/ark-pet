import type { DebugSnapshot } from '../types/pet'

export const INITIAL_DEBUG_SNAPSHOT: DebugSnapshot = {
  fps: 0, petState: 'loading', currentAnimation: null, windowPosition: null,
  pointerPosition: null, hitTest: false, mousePassthrough: false,
  characterId: null, rendererStatus: 'idle', characterManifest: null,
  characterLoadLog: [], activeBehavior: null, lastBehaviorError: null,
  ambientSchedulerStatus: 'paused', nextAmbientActionAt: null,
  activeRuntimeCommand: null, runtimeCommandQueueDepth: 0, lastRuntimeCommandError: null,
  activeSpeechSession: null, speechQueueDepth: 0, speechAudioSource: null,
  speechVoiceEnabled: false, voiceProgressStatus: 'disabled', voiceProgressLog: [],
  lastSpeechError: null, lastContextEvent: null, selectedReactionId: null,
  activeReactionId: null, reactionState: 'idle', reactionBlockedReason: null,
  reactionDecisionLog: [], currentLocalTimePeriod: null,
  desktopAwareness: {
    enabled: false, consented: false, status: 'off',
    capabilities: {
      foregroundCategory: 'unsupported', foregroundTitle: 'unsupported',
      systemIdle: 'unsupported', sessionLock: 'unsupported',
    },
    category: 'unknown', idleState: 'unavailable', idleBucket: null,
    sessionState: 'unavailable', lastEventType: null,
    blockedReason: 'awareness disabled', generation: 0, errorCode: null,
  },
  characterMind: {
    status: 'off', mood: 'calm', scene: null, attention: 0,
    lastObservation: null, currentThought: null, currentIntent: null,
    lastAction: null, blockedReason: 'content perception disabled', generation: 0,
  },
  lastReactionError: null, lastError: null,
}
