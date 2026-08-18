import type { CharacterManifestWithPaths, PetState } from '../types/character'
import { PetStateMachine } from './PetStateMachine'
import type { SpineCharacter } from './character/SpineCharacter'

export class PetController {
  private readonly stateMachine: PetStateMachine

  constructor(stateMachine: PetStateMachine) {
    this.stateMachine = stateMachine
  }

  enterLoading() {
    this.stateMachine.transition('loading')
  }

  enterError() {
    this.stateMachine.transition('error')
  }

  enterIdle(character: SpineCharacter, manifest: CharacterManifestWithPaths) {
    this.transition('idle')
    return character.play(manifest.animations.idle, true)
  }

  enterInteracting(character: SpineCharacter, manifest: CharacterManifestWithPaths) {
    this.transition('interacting')
    return character.play(manifest.animations.interact, false, manifest.animations.idle)
  }

  enterDragging(character: SpineCharacter, manifest: CharacterManifestWithPaths) {
    this.transition('dragging')
    return character.play(manifest.animations.drag, true, manifest.animations.idle)
  }

  enterWalking(character: SpineCharacter, manifest: CharacterManifestWithPaths) {
    this.transition('walking')
    return character.play(
      manifest.animations.walk,
      true,
      manifest.animations.drag ?? manifest.animations.idle,
    )
  }

  enterSitting(character: SpineCharacter, manifest: CharacterManifestWithPaths) {
    this.transition('sitting')
    return character.play(manifest.animations.sit, true, manifest.animations.idle)
  }

  enterSleeping(character: SpineCharacter, manifest: CharacterManifestWithPaths) {
    this.transition('sleeping')
    return character.play(manifest.animations.sleep, true, manifest.animations.idle)
  }

  getState(): PetState {
    return this.stateMachine.getState()
  }

  private transition(nextState: PetState) {
    const current = this.stateMachine.getState()
    if (current === nextState) return

    if (current === 'error' && nextState === 'dragging') {
      throw new Error('Cannot drag while pet is in error state')
    }

    if (this.stateMachine.canTransition(nextState)) {
      this.stateMachine.transition(nextState)
    }
  }
}
