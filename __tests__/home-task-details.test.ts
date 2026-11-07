import { describe, expect, it } from 'vitest'
import { descriptionExcerpt, fieldValueText, shapeTaskDetails } from '@/lib/services/home'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import { reads } from '@/lib/services/ui-reads/home'

const NOW = Date.parse('2026-11-04T12:00:00Z')

describe('Home task row details', () => {
  it('formats field values on one short line', () => {
    expect(fieldValueText('a')).toBe('a')
    expect(fieldValueText(true)).toBe('Yes')
    expect(fieldValueText(3)).toBe('3')
    expect(fieldValueText(['x', 'y'])).toBe('x, y')
    expect(fieldValueText('hi', { hi: 'High' })).toBe('High')
    expect(fieldValueText(null)).toBe('')
    expect(fieldValueText({ a: 1 })).toBe('')
    expect(fieldValueText([{ name: 'file.pdf' }])).toBe('')
    expect(fieldValueText('x'.repeat(200))).toHaveLength(120)
  })

  it('turns an HTML description into one trimmed paragraph', () => {
    expect(descriptionExcerpt('<p>Check the <b>claim</b> &amp; sign</p>')).toBe('Check the claim & sign')
    expect(descriptionExcerpt('   ')).toBeNull()
    expect(descriptionExcerpt(null)).toBeNull()
    expect(descriptionExcerpt('a'.repeat(400))!.length).toBe(280)
  })

  it('shapes fields, subtasks, assignees and progress', () => {
    const task = {
      id: 't1',
      description: 'Review it',
      metadata: {
        fields: [
          { key: 'title', label: 'Section', type: 'heading' },
          { key: 'amount', label: 'Amount', type: 'number' },
          { key: 'notes', label: 'Notes', type: 'text' },
          { key: 'empty', label: 'Empty', type: 'text' },
          { key: 'docs', label: 'Docs', type: 'attachments' },
        ],
        template_values: { amount: 1200, notes: 'Urgent', docs: [{ name: 'a.pdf' }] },
      },
    }
    const out = shapeTaskDetails(
      task,
      [
        { id: 's1', title: 'Collect receipts', status: 'completed', due_date: '2026-11-01T00:00:00Z', assignee_id: 'u1' },
        { id: 's2', title: 'Check totals', status: 'in_progress', due_date: '2026-11-02T00:00:00Z', assignee_id: 'u2' },
        { id: 's3', title: 'Sign off', status: 'todo', due_date: null, assignee_id: null },
      ],
      [{ parent_task_id: 's2', status: 'completed' }, { parent_task_id: 's2', status: 'todo' }],
      new Map([['u1', 'Ada'], ['u2', 'Grace']]),
      normalizeTaskFields,
      NOW,
    )
    expect(out.description).toBe('Review it')
    expect(out.fields).toEqual([{ key: 'amount', label: 'Amount', value: '1200' }, { key: 'notes', label: 'Notes', value: 'Urgent' }])
    expect(out.completed).toBe(1)
    expect(out.total).toBe(3)
    expect(out.subtasks.map((s) => [s.id, s.assignee, s.overdue, s.completed, s.total])).toEqual([
      ['s1', 'Ada', false, 0, 0],
      ['s2', 'Grace', true, 1, 2],
      ['s3', null, false, 0, 0],
    ])
  })

  it('is a gated UI read (tasks.view_own)', () => {
    expect(reads['home.taskDetails']).toBeDefined()
  })
})
