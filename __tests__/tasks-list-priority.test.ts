/** tasks.list accepts only task_priority values for `priority` (anything else is a 400, not a database error). */
import { describe, expect, it } from 'vitest'
import { reads } from '@/lib/services/ui-reads/tasks'

describe('tasks.list priority filter', () => {
  const args = (reads['tasks.list'] as unknown as { args: { safeParse(v: unknown): { success: boolean } } }).args
  it('accepts the five priorities', () => {
    expect(args.safeParse({ priority: ['critical', 'high', 'medium', 'low', 'none'] }).success).toBe(true)
  })
  it('refuses anything else before it reaches the database', () => {
    expect(args.safeParse({ priority: ['6acfc322-6565-4f2e-80e3-0166488d03a5'] }).success).toBe(false)
    expect(args.safeParse({ priority: ['urgent'] }).success).toBe(false)
  })
})
