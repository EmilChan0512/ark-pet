import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PET_SETTINGS } from '../../settings/PetSettings'
import {
  RuntimeCommandCoordinator,
  type RuntimeCommand,
  type RuntimeCommandOutcome,
} from './RuntimeCommandCoordinator'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('RuntimeCommandCoordinator', () => {
  it('executes FIFO with at most one handler active', async () => {
    const gates = [deferred(), deferred(), deferred()]
    const starts: string[] = []
    let active = 0
    let peakActive = 0
    const coordinator = new RuntimeCommandCoordinator({
      async execute(command) {
        const index = starts.length
        starts.push(command.type)
        active += 1
        peakActive = Math.max(peakActive, active)
        await gates[index].promise
        active -= 1
      },
    })

    const first = coordinator.dispatch({ type: 'initialize' })
    const second = coordinator.dispatch({ type: 'reload-character' })
    const third = coordinator.dispatch({ type: 'request-settings' })
    expect(starts).toEqual(['initialize'])

    gates[0].resolve()
    await settle()
    expect(starts).toEqual(['initialize', 'reload-character'])
    gates[1].resolve()
    await settle()
    expect(starts).toEqual(['initialize', 'reload-character', 'request-settings'])
    gates[2].resolve()

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      'executed',
      'executed',
      'executed',
    ])
    expect(peakActive).toBe(1)
  })

  it.each([
    [
      { type: 'show' } as const,
      { type: 'hide' } as const,
    ],
    [
      { type: 'reload-character' } as const,
      { type: 'reload-character' } as const,
    ],
    [
      { type: 'select-character', characterId: 'com.example.a' } as const,
      { type: 'select-character', characterId: 'com.example.c' } as const,
    ],
    [
      { type: 'request-settings' } as const,
      { type: 'request-settings' } as const,
    ],
    [
      { type: 'apply-settings', settings: DEFAULT_PET_SETTINGS } as const,
      {
        type: 'apply-settings',
        settings: { ...DEFAULT_PET_SETTINGS, scale: 1.2 },
      } as const,
    ],
    [
      { type: 'set-ui-interaction', active: true } as const,
      { type: 'set-ui-interaction', active: false } as const,
    ],
    [
      { type: 'cancel-speech', reason: 'replaced' } as const,
      { type: 'cancel-speech', reason: 'hidden' } as const,
    ],
    [
      { type: 'prepare-character-voice' } as const,
      { type: 'prepare-character-voice' } as const,
    ],
  ])('coalesces queued latest-wins command %#', async (older, latest) => {
    const gate = deferred()
    const executed: RuntimeCommand[] = []
    const coordinator = new RuntimeCommandCoordinator({
      async execute(command) {
        executed.push(command)
        if (command.type === 'initialize') await gate.promise
      },
    })

    const initialize = coordinator.dispatch({ type: 'initialize' })
    const oldOutcome = coordinator.dispatch(older)
    const latestOutcome = coordinator.dispatch(latest)
    await expect(oldOutcome).resolves.toBe('superseded')

    gate.resolve()
    await expect(initialize).resolves.toBe('executed')
    await expect(latestOutcome).resolves.toBe('executed')
    expect(executed).toEqual([{ type: 'initialize' }, latest])
  })

  it('closes input immediately and executes destroy once after in-flight work', async () => {
    const gate = deferred()
    const executed: string[] = []
    const coordinator = new RuntimeCommandCoordinator({
      async execute(command) {
        executed.push(command.type)
        if (command.type === 'initialize') await gate.promise
      },
    })

    const initialize = coordinator.dispatch({ type: 'initialize' })
    const pending = coordinator.dispatch({ type: 'reload-character' })
    const destroy = coordinator.dispatch({ type: 'destroy' })

    await expect(pending).resolves.toBe('superseded')
    await expect(coordinator.dispatch({ type: 'show' })).resolves.toBe(
      'rejected-destroyed',
    )
    expect(coordinator.getSnapshot().accepting).toBe(false)

    gate.resolve()
    await expect(initialize).resolves.toBe('executed')
    await expect(destroy).resolves.toBe('executed')
    expect(executed).toEqual(['initialize', 'destroy'])
    expect(coordinator.getSnapshot().destroyed).toBe(true)
  })

  it('contains handler and diagnostics failures and continues draining', async () => {
    const outcomes: Array<Promise<RuntimeCommandOutcome>> = []
    const executed: string[] = []
    const reportError = vi.fn(() => {
      throw new Error('diagnostics failed')
    })
    const coordinator = new RuntimeCommandCoordinator(
      {
        execute(command) {
          executed.push(command.type)
          if (command.type === 'initialize') throw new Error('init failed')
        },
      },
      {
        publish: () => {
          throw new Error('snapshot consumer failed')
        },
        reportError,
      },
    )

    outcomes.push(coordinator.dispatch({ type: 'initialize' }))
    outcomes.push(coordinator.dispatch({ type: 'reload-character' }))

    await expect(Promise.all(outcomes)).resolves.toEqual(['failed', 'executed'])
    expect(executed).toEqual(['initialize', 'reload-character'])
    expect(reportError).toHaveBeenCalledOnce()
    expect(coordinator.getSnapshot().lastError).toBe('[initialize] init failed')
  })
})
