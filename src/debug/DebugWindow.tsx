import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { ContextEvent } from '../pet/reaction/types'
import type { DebugSnapshot } from '../types/pet'
import { listenDebugSnapshots, sendDebugCommand } from './DebugBridge'
import { INITIAL_DEBUG_SNAPSHOT } from './initialDebugSnapshot'
import './DebugWindow.css'

type Tab = 'overview' | 'senses' | 'mind' | 'voice' | 'runtime' | 'logs'

const simulations: readonly [string, ContextEvent][] = [
  ['Dev app', { type: 'desktop.activity-category-entered', at: 0, category: 'development' }],
  ['Long idle return', { type: 'desktop.system-idle-returned', at: 0, idleBucket: 'long' }],
  ['Coding problem', { type: 'perception.scene-noticed', at: 0, scene: 'coding-problem' }],
  ['Reading', { type: 'perception.scene-noticed', at: 0, scene: 'focused-reading' }],
]

function value(value: unknown) { return value === null || value === undefined ? 'n/a' : String(value) }

export default function DebugWindow() {
  const [snapshot, setSnapshot] = useState<DebugSnapshot>(INITIAL_DEBUG_SNAPSHOT)
  const [tab, setTab] = useState<Tab>('overview')
  useEffect(() => {
    let cleanup = () => {}
    let active = true
    void listenDebugSnapshots(setSnapshot).then((next) => {
      if (active) cleanup = next
      else next()
    })
    return () => { active = false; cleanup() }
  }, [])
  useEffect(() => {
    let cleanup = () => {}
    let active = true
    void getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault()
      void sendDebugCommand({ type: 'set-debug-window-visible', visible: false })
      void getCurrentWindow().hide()
    }).then((next) => {
      if (active) cleanup = next
      else next()
    })
    return () => { active = false; cleanup() }
  }, [])
  const mind = snapshot.characterMind
  const awareness = snapshot.desktopAwareness
  return (
    <main className="debug-window">
      <header><div><small>ARK PET DEVELOPMENT</small><h1>Companion Debug</h1></div><span className={`debug-status debug-status--${snapshot.petState}`}>{snapshot.petState}</span></header>
      <nav>{(['overview', 'senses', 'mind', 'voice', 'runtime', 'logs'] as const).map((item) => <button className={tab === item ? 'active' : ''} onClick={() => setTab(item)} key={item}>{item}</button>)}</nav>
      <section className="debug-window__content">
        {tab === 'overview' ? <>
          <div className="debug-overview-grid">
            <article><small>Saw</small><strong>{mind.lastObservation ?? 'Nothing salient'}</strong></article>
            <article><small>Mind</small><strong>{mind.mood} · {value(mind.scene)}</strong></article>
            <article><small>Intent</small><strong>{mind.currentIntent ?? 'No current intent'}</strong></article>
            <article><small>Action</small><strong>{mind.lastAction ?? snapshot.activeBehavior ?? 'Idle'}</strong></article>
            <article><small>Speech</small><strong>{snapshot.voiceProgressStatus} · queue {snapshot.speechQueueDepth}</strong></article>
            <article><small>Error</small><strong>{snapshot.lastError ?? snapshot.lastRuntimeCommandError ?? snapshot.lastBehaviorError ?? snapshot.lastSpeechError ?? snapshot.lastReactionError ?? 'None'}</strong></article>
          </div>
          {mind.currentThought ? <div className="debug-thought">{mind.currentThought}</div> : null}
          {mind.blockedReason ? <div className="debug-muted">Mind blocked: {mind.blockedReason}</div> : null}
        </> : null}
        {tab === 'senses' ? <div className="debug-list">
          <div>Awareness <b>{awareness.status}</b></div><div>Category <b>{awareness.category}</b></div>
          <div>Idle <b>{awareness.idleState} {awareness.idleBucket ?? ''}</b></div><div>Session <b>{awareness.sessionState}</b></div>
          <div>Title capability <b>{awareness.capabilities.foregroundTitle}</b></div>
          <div>Last public event <b>{awareness.lastEventType ?? 'n/a'}</b></div>
          <p className="debug-muted">Raw observed content is redacted from this overview. Sensitive inspection belongs in an explicit development-only view.</p>
        </div> : null}
        {tab === 'mind' ? <div className="debug-list">
          <div>Status <b>{mind.status}</b></div><div>Mood <b>{mind.mood}</b></div><div>Scene <b>{value(mind.scene)}</b></div>
          <div>Attention <b>{Math.round(mind.attention * 100)}%</b></div><div>Thought <b>{value(mind.currentThought)}</b></div>
          <div>Intent <b>{value(mind.currentIntent)}</b></div><div>Generation <b>{mind.generation}</b></div>
        </div> : null}
        {tab === 'voice' ? <><div className="debug-list"><div>Status <b>{snapshot.voiceProgressStatus}</b></div><div>Session <b>{value(snapshot.activeSpeechSession)}</b></div><div>Audio <b>{snapshot.speechAudioSource ?? 'text-only'}</b></div><div>Queue <b>{snapshot.speechQueueDepth}</b></div><div>Reaction blocked <b>{snapshot.reactionBlockedReason ?? 'No'}</b></div><div>Last speech error <b>{snapshot.lastSpeechError ?? 'None'}</b></div></div><pre>{snapshot.voiceProgressLog.join('\n') || 'No voice log'}</pre></> : null}
        {tab === 'runtime' ? <div className="debug-list"><div>FPS <b>{snapshot.fps}</b></div><div>Animation <b>{value(snapshot.currentAnimation)}</b></div><div>Behavior <b>{value(snapshot.activeBehavior)}</b></div><div>Character <b>{value(snapshot.characterId)}</b></div><div>Renderer <b>{snapshot.rendererStatus}</b></div><div>Command <b>{value(snapshot.activeRuntimeCommand)}</b></div><details><summary>Character load</summary><pre>{snapshot.characterLoadLog.join('\n')}</pre></details></div> : null}
        {tab === 'logs' ? <><div className="debug-actions">{simulations.map(([label, event]) => <button key={label} onClick={() => void sendDebugCommand({ type: 'simulate-context', event: { ...event, at: performance.now() } })}>{label}</button>)}<button onClick={() => void sendDebugCommand({ type: 'clear-reaction-cooldowns' })}>Clear cooldowns</button></div><pre>{snapshot.reactionDecisionLog.join('\n') || 'No reaction log'}</pre></> : null}
      </section>
    </main>
  )
}
