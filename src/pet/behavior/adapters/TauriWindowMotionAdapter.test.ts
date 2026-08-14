import { describe, expect, it, vi } from 'vitest'
import type { NativeWindowService } from '../../../services/tauri'
import { TauriWindowMotionAdapter } from './TauriWindowMotionAdapter'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('TauriWindowMotionAdapter', () => {
  it('coalesces queued positions while one IPC move is in flight', async () => {
    const firstMove = deferred()
    const moveWindow = vi
      .fn<(x: number, y: number) => Promise<void>>()
      .mockImplementationOnce(() => firstMove.promise)
      .mockResolvedValue(undefined)
    const service = { moveWindow, getWindowGeometry: vi.fn() } as unknown as NativeWindowService
    const adapter = new TauriWindowMotionAdapter(service)

    adapter.requestPosition(1, 10)
    adapter.requestPosition(2, 20)
    adapter.requestPosition(3, 30)
    expect(moveWindow).toHaveBeenCalledTimes(1)
    expect(moveWindow).toHaveBeenNthCalledWith(1, 1, 10)

    firstMove.resolve()
    await vi.waitFor(() => expect(moveWindow).toHaveBeenCalledTimes(2))
    expect(moveWindow).toHaveBeenNthCalledWith(2, 3, 30)
  })

  it('drops queued positions and waits for the in-flight move on cancel', async () => {
    const firstMove = deferred()
    const moveWindow = vi.fn(() => firstMove.promise)
    const service = { moveWindow, getWindowGeometry: vi.fn() } as unknown as NativeWindowService
    const adapter = new TauriWindowMotionAdapter(service)

    adapter.requestPosition(1, 10)
    adapter.requestPosition(2, 20)
    let cancelled = false
    const cancellation = adapter.cancel().then(() => {
      cancelled = true
    })
    await Promise.resolve()
    expect(cancelled).toBe(false)

    firstMove.resolve()
    await cancellation
    expect(moveWindow).toHaveBeenCalledOnce()
  })
})
