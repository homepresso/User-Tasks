import { describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app-store'

// The task page clears its draft whenever the form has no changes, i.e. on
// almost every render. That must not notify subscribers (the always-mounted
// sidebar re-rendered on each keystroke) when there is nothing to clear.
describe('app store task drafts', () => {
  it('clearTaskDraft without a draft keeps the state (no subscriber notified)', () => {
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)
    const before = useAppStore.getState()
    useAppStore.getState().clearTaskDraft('no-such-task')
    expect(listener).not.toHaveBeenCalled()
    expect(useAppStore.getState()).toBe(before)
    unsubscribe()
  })

  it('still sets and clears a real draft', () => {
    useAppStore.getState().setTaskDraft('t1', { a: 1 } as any)
    expect(useAppStore.getState().taskDrafts.t1).toEqual({ a: 1 })
    useAppStore.getState().clearTaskDraft('t1')
    expect(useAppStore.getState().taskDrafts.t1).toBeUndefined()
  })
})
