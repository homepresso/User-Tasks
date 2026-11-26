import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from './helpers/fake-supabase'

// createTask sent one notification insert per assignee and one users lookup
// per assignee (3-4 sequential round trips per recipient). Now: one bulk
// insert and one .in() lookup, whatever the number of assignees.
const fake = vi.hoisted(() => ({ current: null as any }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/permissions-server', () => ({ requirePermission: vi.fn(async () => undefined) }))
vi.mock('@/lib/process-queue', () => ({ kickQueueProcessor: vi.fn() }))
vi.mock('@/lib/invitations', async (orig) => ({ ...(await orig() as object), ensureTenantInvitation: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({
  getCachedUser: vi.fn(async () => ({ id: 'me' })),
  createClient: vi.fn(async () => fake.current.client),
}))
// Task-table and notification writes go through the actor's service client (hotfix 1bbfe596e).
vi.mock('@/lib/cron-auth', async (orig) => ({ ...(await orig() as object), createActorServiceClient: vi.fn(() => fake.current.client) }))

import { createTask } from '@/app/actions/tasks'

describe('createTask fan-out', () => {
  it('notifies 30 collaborators with one insert and looks them up with one query', async () => {
    const people = Array.from({ length: 30 }, (_, i) => `u${i}`)
    const db = createFakeSupabase({
      users: [{ id: 'me', tenant_id: 'ta', current_tenant_id: 'ta', email: 'me@x.test' }, ...people.map((id) => ({ id, tenant_id: 'ta', email: `${id}@x.test` }))],
      tasks: [], notifications: [], task_assignees: [], user_memberships: [],
    })
    db.rpcs.create_task_with_subtasks = () => ({ data: { task: { id: 'task-1' } } })
    fake.current = db
    const form = new FormData()
    form.set('title', 'Plan the launch')
    form.set('assignee_ids', JSON.stringify(people))
    form.set('assignment_mode', 'collaborative')
    await createTask(form)
    const inserts = db.calls.filter((c) => c.table === 'notifications' && c.op === 'insert')
    expect(inserts).toHaveLength(1)
    expect((inserts[0].args as unknown[]).length).toBe(30)
    expect(db.tables.notifications).toHaveLength(30)
    const lookups = db.calls.filter((c) => c.table === 'users' && c.op === 'select' && String(c.columns ?? '').includes('email'))
    expect(lookups.length).toBe(1)
  })
})
