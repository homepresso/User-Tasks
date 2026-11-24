/**
 * Task list `status` filters accept only task_status values: anything else is
 * a 400 with the allowed values, not a database enum error (500). REST
 * GET /api/v1/tasks (both scopes), the tasks.list UI read and the MCP tasks_list tool.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { GET as listRoute } from '@/app/api/v1/tasks/route'
import { runUiRead } from '@/lib/services/ui-reads'
import { createMcpServer } from '@/lib/mcp/server'
import { listReportTasks } from '@/lib/services/manager-tasks'
import type { ServiceContext } from '@/lib/services/context'
import { invalidTaskStatusMessage, TASK_STATUSES } from '@/lib/tasks/status-filter'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows / JSON payloads */

const seed = () => createMemorySupabase({
  tasks: [
    { id: 't1', tenant_id: 'tenant-a', title: 'Open', status: 'todo', priority: 'high', created_at: '2026-10-01', deleted_at: null, parent_task_id: null, acceptance_status: 'accepted', metadata: {} },
    { id: 't2', tenant_id: 'tenant-a', title: 'Done', status: 'completed', priority: 'low', created_at: '2026-10-02', deleted_at: null, parent_task_id: null, acceptance_status: 'accepted', metadata: {} },
  ],
  task_responses: [],
  task_reads: [],
})

const mockedValidate = vi.mocked(validateApiKey)
function authAs(db: unknown, actingUserId: string | null = null) {
  mockedValidate.mockResolvedValue({
    success: true, tenantId: 'tenant-a', keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId,
    scopes: { workflow_ids: [], table_ids: [] }, permissions: ['tasks.view_all', 'tasks.view_own'],
    supabase: db as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
  })
}
const get = (query: string) => listRoute(new NextRequest(`https://app.test/api/v1/tasks?${query}`, { headers: { authorization: 'Bearer ut_test' } }))

beforeEach(() => mockedValidate.mockReset())

describe('invalidTaskStatusMessage', () => {
  it('passes task_status values and lists the allowed ones otherwise', () => {
    expect(invalidTaskStatusMessage([...TASK_STATUSES])).toBeNull()
    expect(invalidTaskStatusMessage(undefined)).toBeNull()
    expect(invalidTaskStatusMessage(['todo', 'bogus'])).toBe('Invalid status "bogus": use draft, todo, in_progress, blocked, completed, cancelled')
    expect(invalidTaskStatusMessage(['queued'])).not.toBeNull()
    expect(invalidTaskStatusMessage(['queued'], ['queued'])).toBeNull()
  })
})

describe('GET /api/v1/tasks status', () => {
  it('rejects an unknown status with 400 before querying', async () => {
    const db = seed()
    const from = vi.spyOn(db, 'from')
    authAs(db)
    const res = await get('status=todo,nope')
    expect(res.status).toBe(400)
    expect((await res.json() as any).error).toMatch(/Invalid status "nope": use draft, todo/)
    expect(from).not.toHaveBeenCalled()
  })

  it('still filters by valid statuses', async () => {
    authAs(seed())
    const res = await get('status=completed')
    expect(res.status).toBe(200)
    expect((await res.json() as any).data.tasks.map((t: any) => t.id)).toEqual(['t2'])
  })

  it('scope=reports rejects an unknown status with 400', async () => {
    authAs(seed(), 'u1')
    const res = await get('scope=reports&status=open')
    expect(res.status).toBe(400)
    expect((await res.json() as any).error).toMatch(/Invalid status "open"/)
  })
})

describe('tasks.list UI read status', () => {
  const ctx = (db: unknown): ServiceContext => ({ db, supabase: db, tenantId: 'tenant-a', actorId: 'u1', permissions: new Set(['tasks.view_all']), authKind: 'session', source: 'ui' } as unknown as ServiceContext)

  it('is a 400 for an unknown status, and for queued outside the unified list', async () => {
    expect(await runUiRead(ctx(seed()), { name: 'tasks.list', args: { status: ['bogus'] } })).toMatchObject({ ok: false, status: 400 })
    expect(await runUiRead(ctx(seed()), { name: 'tasks.list', args: { status: ['queued'] } })).toMatchObject({ ok: false, status: 400 })
    expect(await runUiRead(ctx(seed()), { name: 'tasks.list', args: { status: ['bogus'], mine: true } })).toMatchObject({ ok: false, status: 400 })
  })
})

describe('listReportTasks status', () => {
  it('refuses an unknown status as a validation error', async () => {
    const ctx = { supabase: seed(), tenantId: 'tenant-a', actorId: 'u1', permissions: new Set(['tasks.view_own']), authKind: 'api_key', source: 'api' } as unknown as ServiceContext
    await expect(listReportTasks(ctx, { status: ['nope'] })).rejects.toMatchObject({ status: 400 })
  })
})

describe('MCP tasks_list status', () => {
  it('returns an error naming the allowed statuses', async () => {
    const db = seed()
    const server = createMcpServer({ tenantId: 'tenant-a', supabase: db as any, actingUserId: null, keyType: 'tenant', scopes: { workflow_ids: [], table_ids: [] } })
    const bad = await server.callTool('tasks_list', { status: 'nope' }) as any
    expect(bad.isError).toBe(true)
    expect(bad.content[0].text).toMatch(/Invalid status "nope"/)
    const good = await server.callTool('tasks_list', { status: 'todo' }) as any
    expect(good.isError).toBeFalsy()
    expect(JSON.parse(good.content[0].text).tasks.map((t: any) => t.id)).toEqual(['t1'])
  })
})
