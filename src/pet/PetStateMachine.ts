import type { PetState } from '../types/character'

type Listener = (state: PetState) => void

const transitions: Record<PetState, PetState[]> = {
  loading: ['idle', 'error'],
  idle: ['loading', 'interacting', 'dragging', 'walking', 'sitting', 'sleeping', 'error'],
  interacting: ['loading', 'idle', 'dragging', 'error'],
  dragging: ['loading', 'idle', 'error'],
  walking: ['loading', 'idle', 'interacting', 'dragging', 'error'],
  sitting: ['loading', 'idle', 'interacting', 'dragging', 'error'],
  sleeping: ['loading', 'idle', 'interacting', 'dragging', 'error'],
  error: ['loading', 'idle'],
}

export class PetStateMachine {
  private state: PetState = 'loading'
  private readonly listeners = new Set<Listener>()

  getState() {
    return this.state
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  canTransition(nextState: PetState) {
    return transitions[this.state].includes(nextState)
  }

  transition(nextState: PetState) {
    if (this.state === nextState) return
    if (!this.canTransition(nextState)) {
      throw new Error(`Invalid pet state transition: ${this.state} -> ${nextState}`)
    }

    this.state = nextState
    for (const listener of this.listeners) {
      listener(nextState)
    }
  }
}
