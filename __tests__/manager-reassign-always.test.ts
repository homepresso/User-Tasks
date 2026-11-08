import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// A manager in the assignee's chain can always reassign a report's task:
// the step's redirect setting (allow_reassign) is only the assignee's own option.
describe('My team reassign ignores the step redirect setting', () => {
  it('the service no longer refuses workflow tasks without allow_reassign', () => {
    const src = readFileSync('lib/services/manager-tasks.ts', 'utf8')
    expect(src).not.toMatch(/does not allow reassigning its task/)
  })
  it('the row offers Reassign for any open task', () => {
    const src = readFileSync('components/tasks/team-task-row.tsx', 'utf8')
    expect(src).toMatch(/const canReassign = !closed\n/)
  })
})
