import { describe, expect, it } from 'vitest'
import { TASK_TABS, parseTaskTab, taskTabs } from '@/components/tasks/task-tabs'

describe('task page tabs', () => {
  it('lists Details, Form (only with a form), Comments and Attachments, in that order', () => {
    expect(taskTabs({ hasForm: true }).map((t) => t.value)).toEqual(['details', 'form', 'comments', 'attachments'])
    expect(taskTabs({ hasForm: false }).map((t) => t.value)).toEqual(['details', 'comments', 'attachments'])
  })

  it('puts the counts on Comments and Attachments, and none while unknown', () => {
    const tabs = taskTabs({ hasForm: false, comments: 3, attachments: undefined })
    expect(tabs.find((t) => t.value === 'comments')?.count).toBe(3)
    expect(tabs.find((t) => t.value === 'attachments')?.count).toBeUndefined()
  })

  it('reads ?tab= only for tabs the page has', () => {
    expect(parseTaskTab('form', TASK_TABS)).toBe('form')
    expect(parseTaskTab('form', ['details', 'comments', 'attachments'])).toBeNull()
    expect(parseTaskTab('nope', TASK_TABS)).toBeNull()
    expect(parseTaskTab(null, TASK_TABS)).toBeNull()
  })
})
