import type { PetRuntime } from '../PetRuntime'
import type { RuntimeCommand, RuntimeCommandHandler } from './RuntimeCommandCoordinator'

/**
 * Application adapter from typed intent to the concrete runtime. Keeping this
 * switch outside the coordinator preserves its platform-independent contract.
 */
export function createPetRuntimeCommandHandler(runtime: PetRuntime): RuntimeCommandHandler {
  return {
    execute(command: RuntimeCommand) {
      switch (command.type) {
        case 'initialize':
          return runtime.init()
        case 'show':
          return runtime.show()
        case 'hide':
          return runtime.hide()
        case 'reload-character':
          return runtime.reloadCharacter()
        case 'select-character':
          return runtime.selectCharacter(command.characterId)
        case 'install-character-package':
          return runtime.installCharacterPackage(command.inspectionToken)
        case 'remove-character-package':
          return runtime.removeCharacterPackage(command.packageId, command.characterId)
        case 'request-settings':
          return runtime.openSettings()
        case 'apply-settings':
          return runtime.applySettings(command.settings)
        case 'set-ui-interaction':
          return runtime.setUiInteractionActive(command.active)
        case 'prepare-character-voice':
          return runtime.prepareCharacterVoice()
        case 'speak':
          return runtime.enqueueSpeech(command.request)
        case 'cancel-speech':
          return runtime.cancelSpeech(command.reason)
        case 'simulate-context':
          return runtime.simulateContextEvent(command.event)
        case 'clear-first-meeting-marker':
          return runtime.clearFirstMeetingMarker()
        case 'clear-reaction-cooldowns':
          return runtime.clearReactionCooldowns()
        case 'destroy':
          return runtime.destroy()
      }
    },
  }
}
