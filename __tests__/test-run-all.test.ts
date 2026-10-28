/**
 * The Test runner's "Run All" at a paused step (lib/automations/test-run-all.ts):
 * it never waits — a User Task with the case's saved values (and the option
 * on) is completed with them, anything else is reported "Paused at …" and
 * the next case runs. Saved values are remembered per case and User Task
 * when the tester completes one.
 */
import { describe, expect, it } from 'vitest'
import { pausedAtLabel, rememberTaskValues, runAllPauseDecision, savedTaskValuesFor, type TestPausePrompt } from '@/lib/automations/test-run-all'

const task: TestPausePrompt = { kind: 'task', nodeId: 'approve', title: 'Approve the request', outcomes: ['approved', 'rejected'] }
const event: TestPausePrompt = { kind: 'event', nodeId: 'wait', eventName: 'payment.received' }

describe('Run All at a paused step', () => {
  it('reports the pause and moves on when there is nothing to complete it with', () => {
    expect(runAllPauseDecision(task, undefined, true)).toEqual({ action: 'skip', label: 'Paused at "Approve the request"' })
    expect(runAllPauseDecision(event, undefined, true)).toEqual({ action: 'skip', label: 'Paused at "payment.received"' })
    expect(runAllPauseDecision(null, undefined, true)).toEqual({ action: 'skip', label: 'Paused' })
  })

  it('completes the task with the case\'s saved values when the option is on', () => {
    const saved = rememberTaskValues(undefined, 'approve', 'approved', { amount: 120, note: 'ok' })
    expect(saved).toEqual({ approve: { outcome: 'approved', values: { amount: 120, note: 'ok' } } })
    expect(runAllPauseDecision(task, saved, true)).toEqual({ action: 'resume', outcome: 'approved', values: { amount: 120, note: 'ok' } })
    // Option off: reported, not completed.
    expect(runAllPauseDecision(task, saved, false)).toEqual({ action: 'skip', label: 'Paused at "Approve the request"' })
    // Saved values of another task don't apply.
    expect(runAllPauseDecision({ ...task, nodeId: 'other' }, saved, true).action).toBe('skip')
    // An outcome the task no longer has falls back to its first.
    const stale = rememberTaskValues(undefined, 'approve', 'escalated', {})
    expect(runAllPauseDecision(task, stale, true)).toEqual({ action: 'resume', outcome: 'approved', values: {} })
  })

  it('remembers values per task (later saves replace earlier ones, other tasks kept)', () => {
    let saved = rememberTaskValues(undefined, 'a', 'done', { x: 1 })
    saved = rememberTaskValues(saved, 'b', 'ok', { y: 2 })
    saved = rememberTaskValues(saved, 'a', 'done', { x: 3 })
    expect(saved).toEqual({ a: { outcome: 'done', values: { x: 3 } }, b: { outcome: 'ok', values: { y: 2 } } })
    expect(savedTaskValuesFor(saved, 'b')).toEqual({ y: 2 })
    expect(savedTaskValuesFor(saved, 'c')).toBeNull()
    expect(pausedAtLabel(task)).toBe('Paused at "Approve the request"')
  })
})
