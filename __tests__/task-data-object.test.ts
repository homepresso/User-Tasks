import { describe, it, expect } from 'vitest'
import { buildTaskDataObject, flattenTaskContext, TASK_VARIABLE_CATALOG } from '@/lib/task-data'

const baseTask = {
  id: 't1',
  title: 'Review contract',
  status: 'in_progress',
  priority: 'high',
  tenant_id: 'tenant-1',
  due_date: new Date(Date.now() - 864e5).toISOString(), // yesterday
  created_at: new Date(Date.now() - 3 * 36e5).toISOString(), // 3h ago
  metadata: {
    template_values: { customer_name: 'Acme', amount: 1250 },
    task_actions: { redirect_assignment_mode: 'single' },
    form_url: 'https://forms.example.com/f/1',
  },
}

describe('buildTaskDataObject', () => {
  it('is a strict superset of the raw row', () => {
    const obj = buildTaskDataObject({ task: baseTask })
    for (const [key, value] of Object.entries(baseTask)) {
      expect(obj[key]).toEqual(value)
    }
  })

  it('exposes template values as data', () => {
    const obj = buildTaskDataObject({ task: baseTask })
    expect(obj.data).toEqual({ customer_name: 'Acme', amount: 1250 })
    expect(obj.actions.redirect_assignment_mode).toBe('single')
    expect(obj.form_url).toBe('https://forms.example.com/f/1')
  })

  it('tolerates null/absent metadata', () => {
    const obj = buildTaskDataObject({ task: { id: 't2', metadata: null } })
    expect(obj.data).toEqual({})
    expect(obj.actions).toEqual({})
    expect(obj.form_url).toBeNull()
    expect(obj.responses).toEqual([])
  })

  it('maps responses and aggregates outcome counts', () => {
    const obj = buildTaskDataObject({
      task: baseTask,
      responses: [
        { user_id: 'u1', outcome: 'approve', outcome_notes: 'lgtm', responded_at: '2026-07-11T00:00:00Z' },
        { user_id: 'u2', outcome: 'approve', outcome_notes: null, responded_at: '2026-07-11T01:00:00Z' },
        { user_id: 'u3', outcome: 'reject', outcome_notes: null, responded_at: null },
      ],
    })
    expect(obj.responses).toHaveLength(3)
    expect(obj.response_count).toBe(3)
    expect(obj.outcome_counts).toEqual({ approve: 2, reject: 1 })
  })

  it('maps timeline events, newest-first input preserved and capped at 20', () => {
    const events = Array.from({ length: 25 }, (_, i) => ({
      event_type: 'task_response', actor_id: `u${i}`, created_at: `2026-07-0${(i % 9) + 1}`, metadata: {},
    }))
    const obj = buildTaskDataObject({ task: baseTask, events })
    expect(obj.timeline).toHaveLength(20)
    expect(obj.timeline[0].event_type).toBe('task_response')
  })

  it('computes is_overdue and age_hours', () => {
    const obj = buildTaskDataObject({ task: baseTask })
    expect(obj.is_overdue).toBe(true) // due yesterday, in_progress
    expect(obj.age_hours).toBe(3)

    const done = buildTaskDataObject({ task: { ...baseTask, status: 'completed' } })
    expect(done.is_overdue).toBe(false)
  })

  it('raw column wins on key collision (defensive guard)', () => {
    const weird = { ...baseTask, data: 'raw-column-value' }
    const obj = buildTaskDataObject({ task: weird })
    expect(obj.data).toBe('raw-column-value')
  })
})

describe('flattenTaskContext', () => {
  it('produces flat task.* keys including task.data.<field>', () => {
    const obj = buildTaskDataObject({ task: baseTask })
    const flat = flattenTaskContext(obj)
    expect(flat['task.title']).toBe('Review contract')
    expect(flat['task.status']).toBe('in_progress')
    expect(flat['task.data.customer_name']).toBe('Acme')
    expect(flat['task.data.amount']).toBe(1250)
    expect(flat['task.is_overdue']).toBe(true)
  })
})

describe('TASK_VARIABLE_CATALOG', () => {
  it('covers the enriched keys designers need to discover', () => {
    const names = TASK_VARIABLE_CATALOG.map((v) => v.name)
    for (const expected of ['task.data', 'task.responses', 'task.response_count', 'task.outcome_counts', 'task.timeline', 'task.is_overdue', 'task.form_url', 'task.outcome', 'task.title']) {
      expect(names).toContain(expected)
    }
  })
})
