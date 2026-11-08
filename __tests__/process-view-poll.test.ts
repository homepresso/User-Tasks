import { describe, it, expect } from 'vitest'
import { processViewPollMs } from '@/lib/automations/process-view-poll'

describe('processViewPollMs', () => {
  it('polls fast while running, slower while waiting, not at all when finished', () => {
    expect(processViewPollMs('running')).toBe(2000)
    expect(processViewPollMs('waiting_for_event')).toBe(5000)
    expect(processViewPollMs('paused')).toBe(5000)
    expect(processViewPollMs('completed')).toBe(false)
    expect(processViewPollMs('failed')).toBe(false)
    expect(processViewPollMs(undefined)).toBe(false)
  })
})
