import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { quickFormError } from '@/components/tasks/task-quick-actions'

describe('quick comment in the expanded task panel', () => {
  it('a comment needs text', () => {
    expect(quickFormError({ mode: 'comment', comment: '  ', chosen: 0, limit: null })).toBe('Write a comment first.')
    expect(quickFormError({ mode: 'comment', comment: 'Looks good', chosen: 0, limit: null })).toBeNull()
  })
  it('offers Comment… and posts through addTaskComment', () => {
    const src = readFileSync('components/tasks/task-quick-actions.tsx', 'utf8')
    expect(src).toContain('data-quick-action="comment"')
    expect(src).toContain('addTaskComment(taskId, comment.trim())')
    expect(src).toContain('Post comment')
  })
})
