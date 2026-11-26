/**
 * Task-table writes made for a signed-in user run with the service role
 * (end users hold no write grant on the task tables — migration
 * 20270130140000), after the service's checks, scoped to the task's
 * workspace, and carrying the acting user (actorServiceClient →
 * createActorServiceClient) so the tasks triggers attribute the change.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const writer = vi.hoisted(() => ({ db: null as any, actors: [] as Array<string | null | undefined> }))
vi.mock('@/lib/cron-auth', async (orig) => ({
  ...(await orig() as object),
  createActorServiceClient: (actorId: string | null | undefined) => { writer.actors.push(actorId); return writer.db },
}))

import * as tasks from '@/lib/services/tasks'
import type { ServiceContext } from '@/lib/services/context'

const rows = () => ({
  tasks: [
    { id: 't1', tenant_id: 'tenant-a', title: 'Mine', status: 'todo', assignee_id: 'user-1', deleted_at: null, is_workflow_task: false, event_id: null },
    { id: 't1', tenant_id: 'tenant-b', title: 'Same id, other workspace', status: 'todo', assignee_id: 'user-1', deleted_at: null, is_workflow_task: false, event_id: null },
  ],
  lifecycle_events: [], task_assignees: [], user_teams: [], user_memberships: [],
})

describe('task writes for a session user', () => {
  let session: any
  beforeEach(() => {
    session = createMemorySupabase(rows())
    writer.db = createMemorySupabase(rows())
    writer.actors = []
  })
  const ctx = (): ServiceContext => ({ db: session, supabase: session, tenantId: 'tenant-a', actorId: 'user-1', permissions: new Set(['tasks.complete']), authKind: 'session', source: 'ui' })

  it('completeStandardTask writes through the actor service client, in the task workspace only', async () => {
    await tasks.completeStandardTask(ctx(), 't1', { outcome: 'Done' })
    expect(writer.actors).toContain('user-1')
    const all = (await writer.db.from('tasks').select('*')).data
    expect(all.find((t: any) => t.tenant_id === 'tenant-a').status).toBe('completed')
    expect(all.find((t: any) => t.tenant_id === 'tenant-b').status).toBe('todo')
    const sessionRows = (await session.from('tasks').select('*')).data
    expect(sessionRows.every((t: any) => t.status === 'todo')).toBe(true)
  })
})
