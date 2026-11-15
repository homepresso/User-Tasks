/**
 * Unread tasks (no database; the SQL rule, RLS and the service are in
 * task-reads-db.test.ts):
 *  - the rule (lib/tasks/unread.ts): assignment, reassignment, group / team
 *    tasks, collaborators, sent back / reopened, completed and other closed
 *    states, people who only see the task;
 *  - patching cached lists, the nav badge helpers;
 *  - row rendering: the dot + bold title + sr-only "Unread" (MobileTaskCard,
 *    UnreadDot), and nothing for read or done tasks;
 *  - API contract: REST endpoints + route handlers, `unread` on the list /
 *    get handlers, MCP tools and their permissions, surface parity, the
 *    migration's shape.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => createElement('a', { href, ...rest }, children) }))

import { isTaskUnread, patchUnreadInData, showsUnread, unreadSince, withUnreadFlags } from '@/lib/tasks/unread'
import { formatNavBadge, navBadgeLabelWithUnread, navUnreadCount } from '@/lib/nav-badges'
import { MobileTaskCard } from '@/components/tasks/mobile-task-card'
import { UnreadDot, unreadTitleClass } from '@/components/tasks/unread-dot'
import { API_ENDPOINTS } from '@/lib/api-schemas'
import { checkToolPermission, READ_TOOL_PERMISSIONS, TOOL_PERMISSIONS } from '@/lib/mcp/authz'
import { createMcpServer, type McpContext } from '@/lib/mcp/server'
import { SURFACE_PARITY } from '@/lib/surface-parity'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */

const ROOT = join(__dirname, '..')
const T0 = '2027-01-10T09:00:00.000Z'
const before = (iso: string, ms = 60_000) => new Date(new Date(iso).getTime() - ms).toISOString()
const after = (iso: string, ms = 60_000) => new Date(new Date(iso).getTime() + ms).toISOString()

describe('the unread rule', () => {
  it('assignment: a new task assigned to me is unread until I open it', () => {
    expect(isTaskUnread({ status: 'todo', holding: { kind: 'assignee' }, routedAt: T0, seenAt: null })).toBe(true)
    expect(isTaskUnread({ status: 'todo', holding: { kind: 'assignee' }, routedAt: T0, seenAt: after(T0) })).toBe(false)
    // Opened in the same instant it was routed (same transaction): read.
    expect(isTaskUnread({ status: 'todo', holding: { kind: 'assignee' }, routedAt: T0, seenAt: T0 })).toBe(false)
  })

  it('reassignment: routed to me after I last opened it → unread again', () => {
    const seen = before(T0, 3_600_000)
    expect(isTaskUnread({ status: 'in_progress', holding: { kind: 'assignee' }, routedAt: T0, seenAt: seen })).toBe(true)
  })

  it('group / team tasks: members of the assigned team of an unassigned task', () => {
    expect(isTaskUnread({ status: 'todo', holding: { kind: 'team' }, routedAt: T0, seenAt: null })).toBe(true)
    expect(isTaskUnread({ status: 'todo', holding: { kind: 'team' }, routedAt: T0, seenAt: after(T0) })).toBe(false)
  })

  it('collaborators and claim candidates: since the later of routing and being added; declined rows hold nothing', () => {
    const added = after(T0, 3_600_000)
    expect(unreadSince({ kind: 'collaborator', addedAt: added }, T0)).toBe(new Date(added).getTime())
    // Read before being added → unread.
    expect(isTaskUnread({ status: 'todo', holding: { kind: 'collaborator', addedAt: added }, routedAt: T0, seenAt: after(T0) })).toBe(true)
    expect(isTaskUnread({ status: 'todo', holding: { kind: 'collaborator', addedAt: added }, routedAt: T0, seenAt: after(added) })).toBe(false)
    expect(isTaskUnread({ status: 'todo', holding: { kind: 'collaborator', addedAt: added, declined: true }, routedAt: T0, seenAt: null })).toBe(false)
  })

  it('sent back / reopened: routed_at moves forward, so the earlier read no longer counts', () => {
    const firstRead = before(T0, 86_400_000)
    expect(isTaskUnread({ status: 'todo', holding: { kind: 'assignee' }, routedAt: T0, seenAt: firstRead })).toBe(true)
  })

  it('completed, cancelled and draft tasks are never unread; deleted neither', () => {
    for (const status of ['completed', 'cancelled', 'draft']) {
      expect(isTaskUnread({ status, holding: { kind: 'assignee' }, routedAt: T0, seenAt: null }), status).toBe(false)
    }
    expect(isTaskUnread({ status: 'blocked', holding: { kind: 'assignee' }, routedAt: T0, seenAt: null })).toBe(true)
    expect(isTaskUnread({ status: 'todo', deleted: true, holding: { kind: 'assignee' }, routedAt: T0, seenAt: null })).toBe(false)
  })

  it('people who only see the task (manager, assigner, follower, viewer) never have it unread', () => {
    expect(isTaskUnread({ status: 'todo', holding: { kind: 'none' }, routedAt: T0, seenAt: null })).toBe(false)
  })

  it('rows: flags from the server ids; a cached row loses the dot once it is closed', () => {
    const rows = withUnreadFlags([{ id: 'a' }, { id: 'b' }], new Set(['b']))
    expect(rows.map((r) => r.unread)).toEqual([false, true])
    expect(showsUnread({ unread: true, status: 'todo' })).toBe(true)
    expect(showsUnread({ unread: true, status: 'completed' })).toBe(false)
    expect(showsUnread({ unread: false, status: 'todo' })).toBe(false)
    expect(showsUnread({ unread: true })).toBe(true)
  })
})

describe('cached lists', () => {
  const list = [{ id: 'a', unread: true }, { id: 'b', unread: true }, { id: 'c' }]

  it('patches the rows of these tasks, in arrays and { tasks } / { data } wrappers', () => {
    const patched = patchUnreadInData(list, new Set(['a']), false)
    expect(patched).toEqual([{ id: 'a', unread: false }, { id: 'b', unread: true }, { id: 'c' }])
    expect(patchUnreadInData({ tasks: list, total: 3 }, 'all', false)).toEqual({ tasks: [{ id: 'a', unread: false }, { id: 'b', unread: false }, { id: 'c' }], total: 3 })
    expect((patchUnreadInData({ data: list }, new Set(['b']), false) as any).data[1].unread).toBe(false)
  })

  it('returns the same object when nothing changes (no needless re-renders)', () => {
    expect(patchUnreadInData(list, new Set(['zzz']), false)).toBe(list)
    const wrapped = { tasks: list }
    expect(patchUnreadInData(wrapped, new Set(['a']), true)).toBe(wrapped)
    expect(patchUnreadInData(undefined, 'all', false)).toBeUndefined()
  })
})

describe('nav badge', () => {
  it('My tasks shows the unread count; other items none', () => {
    const counts = { my_tasks: 4, queue: 1, tracker: 2, unread: 3 }
    expect(navUnreadCount(counts, '/tasks')).toBe(3)
    expect(navUnreadCount(counts, '/tasks/assigned')).toBe(0)
    expect(navUnreadCount({ my_tasks: 1, queue: 0, tracker: 0 }, '/tasks')).toBe(0)
    expect(formatNavBadge(navUnreadCount({ ...counts, unread: 250 }, '/tasks'))).toBe('99+')
  })

  it('the accessible name says both counts', () => {
    expect(navBadgeLabelWithUnread('My tasks', 5, 2)).toBe('My tasks, 5 pending, 2 unread')
    expect(navBadgeLabelWithUnread('My tasks', 5, 0)).toBe('My tasks, 5 pending')
    expect(navBadgeLabelWithUnread('My tasks', 0, 2)).toBe('My tasks, 2 unread')
  })
})

describe('row rendering', () => {
  const card = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(MobileTaskCard, { href: '/tasks/t1', title: 'Approve purchase request', ...props } as any))

  it('an unread card: accent dot before the title, bold title, "(unread)" in the link name', () => {
    const html = card({ unread: true })
    expect(html).toContain('data-unread-dot')
    expect(html).toMatch(/data-unread-dot[^>]*class="[^"]*bg-accent-text/)
    expect(html.indexOf('data-unread-dot')).toBeLessThan(html.indexOf('Approve purchase request</span>'))
    expect(html).toMatch(/class="[^"]*font-semibold[^"]*"[^>]*>Approve purchase request/)
    expect(html).toContain('aria-label="Open Approve purchase request (unread)"')
    expect(html).toContain('data-unread="true"')
  })

  it('a read card, and a done one even if flagged, have no dot and a regular title', () => {
    for (const html of [card({}), card({ unread: true, done: true })]) {
      expect(html).not.toContain('data-unread-dot')
      expect(html).not.toMatch(/font-semibold[^"]*"[^>]*>Approve purchase request/)
      expect(html).not.toContain('(unread)')
    }
  })

  it('UnreadDot: a decorative dot plus an sr-only "Unread" label; nothing when read', () => {
    const html = renderToStaticMarkup(createElement(UnreadDot, { unread: true }))
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('<span class="sr-only">Unread: </span>')
    expect(renderToStaticMarkup(createElement(UnreadDot, { unread: false }))).toBe('')
    expect(unreadTitleClass(true)).toBe('font-semibold')
    expect(unreadTitleClass(false)).toBe(false)
  })

  it('the task lists render the dot and bold title (My tasks table and cards, Home, the tracker)', () => {
    const files = ['app/(dashboard)/tasks/page.tsx', 'components/home/home-tabs.tsx', 'components/tasks/assigned-task-row.tsx']
    for (const file of files) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      expect(src, file).toMatch(/<UnreadDot unread=\{unread\}/)
      expect(src, file).toMatch(/unreadTitleClass\(unread\)/)
      expect(src, file).toMatch(/showsUnread\(/)
    }
    // Opening marks read: the task page and the inline panel.
    expect(readFileSync(join(ROOT, 'app/(dashboard)/tasks/[id]/page.tsx'), 'utf8')).toMatch(/useMarkTaskReadOnOpen\(id,/)
    expect(readFileSync(join(ROOT, 'components/tasks/task-detail-panel.tsx'), 'utf8')).toMatch(/useMarkTaskReadOnOpen\(taskId,/)
  })
})

describe('API contract', () => {
  const find = (method: string, path: string) => API_ENDPOINTS.find((e) => e.method === method && e.path === path)

  it('REST: mark read / unread / all read and the count, personal (tasks.view_own), with route handlers', () => {
    const expected = [
      ['PUT', '/tasks/{id}/read', 'markTaskRead'], ['DELETE', '/tasks/{id}/read', 'markTaskUnread'],
      ['POST', '/tasks/read-all', 'markAllTasksRead'], ['GET', '/tasks/unread-count', 'countUnreadTasks'],
    ] as const
    for (const [method, path, operationId] of expected) {
      const endpoint = find(method, path)
      expect(endpoint, `${method} ${path}`).toBeDefined()
      expect(endpoint!.operationId).toBe(operationId)
      expect(endpoint!.permission).toBe('tasks.view_own')
    }
    const toggle = readFileSync(join(ROOT, 'app/api/v1/tasks/[id]/read/route.ts'), 'utf8')
    expect(toggle).toMatch(/export const PUT = apiRoute\(markTaskReadEndpoint/)
    expect(toggle).toMatch(/export const DELETE = apiRoute\(markTaskUnreadEndpoint/)
    expect(readFileSync(join(ROOT, 'app/api/v1/tasks/read-all/route.ts'), 'utf8')).toMatch(/export const POST = apiRoute\(markAllTasksReadEndpoint/)
    expect(readFileSync(join(ROOT, 'app/api/v1/tasks/unread-count/route.ts'), 'utf8')).toMatch(/export const GET = apiRoute\(countUnreadTasksEndpoint/)
  })

  it('REST list / get handlers add unread; their docs say so', () => {
    for (const file of ['app/api/v1/tasks/route.ts', 'app/api/v1/tasks/assigned/route.ts']) {
      expect(readFileSync(join(ROOT, file), 'utf8'), file).toMatch(/withUnread\(fromApiAuth\(auth\)/)
    }
    expect(readFileSync(join(ROOT, 'app/api/v1/tasks/[id]/route.ts'), 'utf8')).toMatch(/isTaskUnreadFor\(fromApiAuth\(auth\)/)
    for (const [method, path] of [['GET', '/tasks'], ['GET', '/tasks/assigned'], ['GET', '/tasks/{id}'], ['GET', '/tasks/following']] as const) {
      expect(find(method, path)?.description ?? '', path).toMatch(/unread/)
    }
  })

  it('OpenAPI / SDK / CLI are regenerated with the new operations', () => {
    const openapi = JSON.parse(readFileSync(join(ROOT, 'packages/sdk/openapi.json'), 'utf8'))
    expect(openapi.paths['/tasks/{id}/read']?.put?.operationId).toBe('markTaskRead')
    expect(openapi.paths['/tasks/{id}/read']?.delete?.operationId).toBe('markTaskUnread')
    expect(openapi.paths['/tasks/read-all']?.post?.operationId).toBe('markAllTasksRead')
    expect(openapi.paths['/tasks/unread-count']?.get?.operationId).toBe('countUnreadTasks')
    const ops = readFileSync(join(ROOT, 'packages/sdk/src/generated/operations.ts'), 'utf8')
    for (const op of ['markTaskRead', 'markTaskUnread', 'markAllTasksRead', 'countUnreadTasks']) expect(ops, op).toContain(op)
    const cli = readFileSync(join(ROOT, 'packages/cli/src/generated/commands.ts'), 'utf8')
    for (const verb of ['mark-read', 'mark-unread', 'mark-all-read', 'unread-count']) expect(cli, verb).toContain(`"verb": "${verb}"`)
  })

  it('MCP: the read tools are registered and gated on tasks.view_own', () => {
    const tools = new Set(createMcpServer({ tenantId: 't1', supabase: {} }).getRegisteredTools().map((t) => t.name))
    const writes = ['tasks_mark_read', 'tasks_mark_unread', 'tasks_mark_all_read']
    for (const name of [...writes, 'tasks_unread_count']) expect(tools.has(name), name).toBe(true)
    for (const name of writes) expect(TOOL_PERMISSIONS[name], name).toBe('tasks.view_own')
    expect(READ_TOOL_PERMISSIONS.tasks_unread_count).toBe('tasks.view_own')
    const noPerms = { tenantId: 't1', supabase: {}, permissions: [] } as unknown as McpContext
    const viewer = { tenantId: 't1', supabase: {}, permissions: ['tasks.view_own'] } as unknown as McpContext
    for (const name of [...writes, 'tasks_unread_count']) {
      expect(checkToolPermission(noPerms, name)?.isError, name).toBe(true)
      expect(checkToolPermission(viewer, name), name).toBeNull()
    }
    const src = readFileSync(join(ROOT, 'lib/mcp/tools/tasks.ts'), 'utf8')
    expect(src).toMatch(/withUnread\(fromMcpContext\(ctx\)/)
    expect(src).toMatch(/isTaskUnreadFor\(fromMcpContext\(ctx\)/)
  })

  it('surface parity lists the read state on REST, MCP and the CLI', () => {
    const resource = SURFACE_PARITY.find((r) => r.resource === 'task read state (unread)')
    expect(resource).toBeDefined()
    const create = resource!.ops.find((o) => o.op === 'create')!
    expect([create.rest, create.mcp, create.cli]).toEqual(['PUT /tasks/{id}/read', 'tasks_mark_read', 'tasks mark-read'])
  })
})

describe('migration', () => {
  const file = join(ROOT, 'supabase/migrations/20270115300000_task_reads.sql')
  const sql = existsSync(file) ? readFileSync(file, 'utf8') : ''

  it('task_reads: PK (task_id, user_id), cascading FKs, own-row RLS with the coalescing tenant helper', () => {
    expect(sql).toMatch(/PRIMARY KEY \(task_id, user_id\)/)
    expect(sql.match(/ON DELETE CASCADE/g)?.length).toBeGreaterThanOrEqual(3)
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/)
    for (const op of ['select', 'insert', 'update', 'delete']) expect(sql).toMatch(new RegExp(`CREATE POLICY task_reads_${op} ON public.task_reads`))
    expect(sql).toMatch(/rls_member_tenant_ids\(\)/)
    expect(sql).not.toMatch(/IN \(SELECT current_tenant_id/)
  })

  it('routed_at is added without a rewrite and backfilled read only on first apply', () => {
    expect(sql).toMatch(/ADD COLUMN routed_at timestamptz NOT NULL DEFAULT now\(\)/)
    expect(sql).toMatch(/already applied: no second backfill/)
    expect(sql).toMatch(/CREATE TRIGGER trg_tasks_routed_at/)
  })
})
