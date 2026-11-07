/**
 * Task tracker → Following (no database; the DB rules are in
 * task-followers-db.test.ts):
 *  - tab order (Following first), the default tab and the per-user memory;
 *  - the follow bell: aria-pressed / labels, and the optimistic toggle with
 *    rollback;
 *  - surfaces: REST endpoints + route handlers, MCP tools and their
 *    permissions, the dashboard reads.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/app/actions/task-follows', () => ({ setTaskFollowed: vi.fn(async (taskId: string, follow: boolean) => ({ ok: true, data: { task_id: taskId, following: follow } })) }))

import { defaultTrackerTab, isTrackerTab, readStoredTrackerTab, storeTrackerTab, TRACKER_TABS, trackerTabStorageKey } from '@/lib/tasks/tracker-tabs'
import { FOLLOW_LABEL, FOLLOWING_LABEL, performFollowToggle, TaskFollowButton, TaskFollowToggle } from '@/components/tasks/task-follow-button'
import { Tabs } from '@/components/ui/tabs'
import { API_ENDPOINTS } from '@/lib/api-schemas'
import { checkToolPermission, READ_TOOL_PERMISSIONS, TOOL_PERMISSIONS } from '@/lib/mcp/authz'
import { createMcpServer, type McpContext } from '@/lib/mcp/server'
import { UI_READS } from '@/lib/services/ui-reads'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */

const ROOT = join(__dirname, '..')
const wrap = (el: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))

describe('tracker tabs', () => {
  it('Following is the first tab, then the tracker scopes', () => {
    expect(TRACKER_TABS.map((t) => t.value)).toEqual(['following', 'assigned_by_me', 'team_members', 'all'])
    const html = renderToStaticMarkup(createElement(Tabs as any, { 'aria-label': 'Task tracker views', value: 'following', items: TRACKER_TABS.map((t) => t.value === 'following' ? { ...t, count: 3 } : t) }))
    const tabs = [...html.matchAll(/role="tab"[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''))
    expect(tabs[0]).toBe('Following3')
    expect(tabs.slice(1)).toEqual(['Assigned by me', 'Team members', 'All tasks'])
  })

  it('opens the remembered tab; otherwise Following when you follow something, else Assigned by me', () => {
    expect(defaultTrackerTab('all', 5)).toBe('all')
    expect(defaultTrackerTab('team_members', 0)).toBe('team_members')
    expect(defaultTrackerTab(null, 2)).toBe('following')
    expect(defaultTrackerTab(null, 0)).toBe('assigned_by_me')
    expect(defaultTrackerTab('bogus', undefined)).toBe('assigned_by_me')
    expect(isTrackerTab('following')).toBe(true)
    expect(isTrackerTab('scope')).toBe(false)
  })

  describe('remembered per user', () => {
    afterEach(() => { vi.unstubAllGlobals() })

    it('stores and reads the tab under a per-user key', () => {
      const store = new Map<string, string>()
      vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } } })
      storeTrackerTab('u1', 'team_members')
      expect(store.get(trackerTabStorageKey('u1'))).toBe('team_members')
      expect(readStoredTrackerTab('u1')).toBe('team_members')
      expect(readStoredTrackerTab('u2')).toBeNull()
      store.set(trackerTabStorageKey('u2'), 'nonsense')
      expect(readStoredTrackerTab('u2')).toBeNull()
    })

    it('survives storage that throws (private mode)', () => {
      vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } } })
      expect(() => storeTrackerTab('u1', 'all')).not.toThrow()
      expect(readStoredTrackerTab('u1')).toBeNull()
    })
  })
})

describe('follow bell', () => {
  it('renders its state: aria-pressed and the Follow / Following tooltips', () => {
    const on = wrap(createElement(TaskFollowButton, { taskId: 't1', following: true }))
    expect(on).toContain('aria-pressed="true"')
    expect(on).toContain(`aria-label="${FOLLOWING_LABEL}"`)
    expect(on).toContain('data-task-follow="following"')
    const off = wrap(createElement(TaskFollowButton, { taskId: 't1', following: false }))
    expect(off).toContain('aria-pressed="false"')
    expect(off).toContain(`aria-label="${FOLLOW_LABEL}"`)
    expect(FOLLOWING_LABEL).toBe('Following — click to unfollow')
  })

  it('the task page button starts disabled until its state loads', () => {
    const html = wrap(createElement(TaskFollowToggle, { taskId: 't1' }))
    expect(html).toContain('data-task-follow="not-following"')
    expect(html).toMatch(/<button[^>]*disabled/)
    expect(html).toContain('Follow')
  })

  it('optimistic: shows the new state before the save resolves, then the server answer', async () => {
    const shown: Array<boolean | null> = []
    let resolve!: (v: any) => void
    const save = vi.fn(() => new Promise<any>((r) => { resolve = r }))
    const done = vi.fn()
    const pending = performFollowToggle(true, { save, show: (v) => shown.push(v), done })
    expect(shown).toEqual([true])
    expect(save).toHaveBeenCalledWith(true)
    resolve({ ok: true, data: { task_id: 't1', following: true } })
    expect(await pending).toBe(true)
    expect(shown).toEqual([true, true])
    expect(done).toHaveBeenCalledWith({ following: true })
  })

  it('rolls back and reports the error when the server refuses or the call throws', async () => {
    const shown: Array<boolean | null> = []
    const done = vi.fn()
    expect(await performFollowToggle(true, { save: async () => ({ ok: false, error: 'Task not found' }), show: (v) => shown.push(v), done })).toBeNull()
    expect(shown).toEqual([true, null])
    expect(done).toHaveBeenCalledWith({ error: 'Task not found' })

    const shown2: Array<boolean | null> = []
    const done2 = vi.fn()
    await performFollowToggle(false, { save: async () => { throw new Error('network') }, show: (v) => shown2.push(v), done: done2 })
    expect(shown2).toEqual([false, null])
    expect(done2).toHaveBeenCalledWith({ error: 'Could not unfollow the task.' })
  })
})

describe('surfaces', () => {
  it('REST: GET /tasks/following, PUT / DELETE /tasks/{id}/follow, with route handlers', () => {
    const find = (method: string, path: string) => API_ENDPOINTS.find((e) => e.method === method && e.path === path)
    for (const [method, path] of [['GET', '/tasks/following'], ['PUT', '/tasks/{id}/follow'], ['DELETE', '/tasks/{id}/follow']] as const) {
      const endpoint = find(method, path)
      expect(endpoint, `${method} ${path}`).toBeDefined()
      expect(endpoint!.permission).toBe('tasks.view_own')
    }
    const list = readFileSync(join(ROOT, 'app/api/v1/tasks/following/route.ts'), 'utf8')
    expect(list).toMatch(/export const GET = apiRoute\(listFollowedTasksEndpoint/)
    const toggle = readFileSync(join(ROOT, 'app/api/v1/tasks/[id]/follow/route.ts'), 'utf8')
    expect(toggle).toMatch(/export const PUT = apiRoute\(followTaskEndpoint/)
    expect(toggle).toMatch(/export const DELETE = apiRoute\(unfollowTaskEndpoint/)
    // The static segment wins over [id] (as /tasks/assigned does).
    expect(existsSync(join(ROOT, 'app/api/v1/tasks/[id]/route.ts'))).toBe(true)
  })

  it('MCP: tasks_follow / tasks_unfollow / tasks_following registered and gated on tasks.view_own', () => {
    const tools = new Set(createMcpServer({ tenantId: 't1', supabase: {} }).getRegisteredTools().map((t) => t.name))
    for (const name of ['tasks_follow', 'tasks_unfollow', 'tasks_following']) expect(tools.has(name), name).toBe(true)
    expect(TOOL_PERMISSIONS.tasks_follow).toBe('tasks.view_own')
    expect(TOOL_PERMISSIONS.tasks_unfollow).toBe('tasks.view_own')
    expect(READ_TOOL_PERMISSIONS.tasks_following).toBe('tasks.view_own')
    const noPerms = { tenantId: 't1', supabase: {}, permissions: [] } as unknown as McpContext
    const viewer = { tenantId: 't1', supabase: {}, permissions: ['tasks.view_own'] } as unknown as McpContext
    for (const name of ['tasks_follow', 'tasks_unfollow', 'tasks_following']) {
      expect(checkToolPermission(noPerms, name)?.isError, name).toBe(true)
      expect(checkToolPermission(viewer, name), name).toBeNull()
    }
  })

  it('dashboard reads: the list and count need a task view permission; the ids read takes at most 250 ids', () => {
    const reads = UI_READS as Record<string, any>
    expect(reads['tasks.following'].perm).toEqual(['tasks.view_own', 'tasks.view_all'])
    expect(reads['tasks.followingCount'].perm).toEqual(['tasks.view_own', 'tasks.view_all'])
    expect(reads['tasks.followedIds'].args.safeParse({ ids: Array.from({ length: 250 }, (_, i) => `id${i}`) }).success).toBe(true)
    expect(reads['tasks.followedIds'].args.safeParse({ ids: Array.from({ length: 251 }, (_, i) => `id${i}`) }).success).toBe(false)
  })
})
