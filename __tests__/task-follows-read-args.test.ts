import { describe, expect, it } from 'vitest'
import { runUiRead } from '@/lib/services/ui-reads'
import type { ServiceContext } from '@/lib/services/context'

// tasks.following's priority filter goes to the task_priority enum: a value
// outside it was a database error logged as a 500 (the isolation suite feeds
// ids into every argument); now it is a 400 before any query runs.
const ctx = { tenantId: 't1', actorId: 'u1', permissions: new Set(['tasks.view_own']), authKind: 'session', source: 'ui', supabase: null, db: null } as unknown as ServiceContext

describe('tasks.following arguments', () => {
  it('refuses a priority outside the enum with a 400', async () => {
    expect(await runUiRead(ctx, { name: 'tasks.following', args: { priority: ['6acfc322-6565-4f2e-80e3-0166488d03a5'] } })).toMatchObject({ ok: false, status: 400 })
    expect(await runUiRead(ctx, { name: 'tasks.following', args: { priority: ['urgent'] } })).toMatchObject({ ok: false, status: 400 })
  })
})

describe('listFollowedTasks (REST GET /tasks/following, MCP tasks_following)', () => {
  it('refuses a priority outside the enum as a validation error', async () => {
    const { listFollowedTasks } = await import('@/lib/services/task-follows')
    await expect(listFollowedTasks(ctx, { priority: ['high', 'nope'] })).rejects.toMatchObject({ code: 'validation_error', status: 400 })
  })
})
