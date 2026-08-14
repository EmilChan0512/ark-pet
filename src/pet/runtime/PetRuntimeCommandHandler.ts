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
        case 'request-settings':
          return runtime.openSettings()
        case 'apply-settings':
          return runtime.applySettings(command.settings)
        case 'set-ui-interaction':
          return runtime.setUiInteractionActive(command.active)
        case 'destroy':
          return runtime.destroy()
      }
    },
  }
}
