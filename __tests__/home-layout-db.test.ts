/**
 * Home layout persistence against a LOCAL Supabase stack (lib/services/home.ts
 * getHomeLayout / setHomeLayout / resetHomeLayout → users.preferences.home_layout):
 *  - nothing saved → the default (customised false);
 *  - saved per person and per workspace (another workspace, another person
 *    unaffected), and the other preferences (auto_follow_runs) are kept;
 *  - validation on write (unknown widgets, bad sizes, size cap, no user);
 *  - stored values are normalised on read (removed widgets dropped, sizes
 *    clamped, new widgets in their default spot);
 *  - reset clears only this workspace's layout;
 *  - RLS: a signed-in person can't write someone else's preferences.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/home-layout-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import * as home from '@/lib/services/home'
import type { ServiceContext } from '@/lib/services/context'
import { defaultHomeLayout, type HomeLayout } from '@/lib/home/layout'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are loose JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `be1a0000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
// Personal workspaces take the first 8 characters of the user id as slug: keep those distinct.
const uid = (n: number) => `be${n.toString(16).padStart(6, '0')}-0000-4000-8000-0000000000be`
const A = id(0xa)
const B = id(0xb)
const ME = uid(0x201)     // member of A and B
const OTHER = uid(0x202)  // member of A
const USERS = [ME, OTHER]
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

const ids = (l: HomeLayout) => l.items.map((i) => i.id)

describe.skipIf(!DB_URL)('home layout (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const member = ['tasks.view_own', 'tasks.complete', 'forms.submit', 'forms.view']
  const ctx = (tenantId: string, actorId: string | null, permissions: string[] = member): ServiceContext =>
    ({ supabase: admin, db: admin, tenantId, actorId, permissions: new Set(permissions), authKind: 'api_key', source: 'api' } as ServiceContext)
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows
  const prefsOf = async (user: string) => (await q('SELECT preferences FROM public.users WHERE id = $1', [user]))[0]?.preferences ?? {}

  /** SQL as a signed-in user (PostgREST style), rolled back. */
  async function as(user: string, sql: string, params: unknown[] = []) {
    await db.query('BEGIN')
    try {
      await db.query('SET LOCAL ROLE authenticated')
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated' })])
      const res = await db.query(sql, params)
      return { rowCount: res.rowCount ?? 0, error: null as null | { code?: string } }
    } catch (e) {
      return { rowCount: 0, error: e as { code?: string } }
    } finally {
      await db.query('ROLLBACK')
    }
  }

  async function cleanup() {
    const personal = (await q('SELECT tenant_id FROM public.users WHERE id = ANY($1::uuid[])', [USERS])).map((r: any) => r.tenant_id)
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [USERS])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [[A, B, ...personal.filter((t: string | null) => t && ![A, B].includes(t))]])
    await db.query(`DELETE FROM public.tenants WHERE slug LIKE 'personal-be0002%'`).catch(() => undefined)
  }

  beforeAll(async () => {
    await db.connect()
    await cleanup()
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Layout A', 'layout-a-test'), ($2, 'Layout B', 'layout-b-test')`, [A, B])
    for (const user of USERS) {
      await q(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [user, `l${user.slice(2, 8)}.${Date.now().toString(36)}@layout.test`])
      await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [user, A])
      await q('UPDATE public.users SET current_tenant_id = $2 WHERE id = $1', [user, A])
    }
    await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [ME, B])
    await q(`UPDATE public.users SET preferences = coalesce(preferences, '{}'::jsonb) || '{"auto_follow_runs": false}' WHERE id = $1`, [ME])
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
  })

  it('nothing saved: the default layout, not customised, with the widget catalogue', async () => {
    const r = await home.getHomeLayout(ctx(A, ME))
    expect(r.customised).toBe(false)
    expect(r.updated_at).toBeNull()
    expect(r.layout).toEqual(defaultHomeLayout())
    expect(ids(r.layout).slice(0, 5)).toEqual(['metric.tasks', 'chart.decisions', 'metric.submissions', 'metric.following', 'tasks'])
    expect(r.widgets.map((w) => w.id)).not.toContain('chart.on_time')
    expect(r.widgets.map((w) => w.id)).not.toContain('favorites')
    expect(r.grid).toEqual({ columns: 12, row_px: 40, gap_px: 12 })
    expect(r.widgets.find((w) => w.id === 'tasks')).toMatchObject({ available: true, min: { w: 4, h: 6 } })
    // Without forms.submit the forms widgets are unavailable and the cards share the row.
    const limited = await home.getHomeLayout(ctx(A, ME, ['tasks.view_own']))
    expect(limited.widgets.find((w) => w.id === 'drafts')?.available).toBe(false)
    // My tasks, My decisions and Following: a third each.
    expect(limited.layout.items.find((i) => i.id === 'metric.tasks')?.w).toBe(4)
    expect(limited.layout.items.find((i) => i.id === 'chart.decisions')?.w).toBe(4)
  })

  it('saves per person and per workspace, keeping other preferences', async () => {
    // 'favorites' is the retired Favourite forms widget (now a tab): accepted from older clients, dropped on save.
    const mine = {
      items: [{ id: 'chart.completed', w: 6, h: 8 }, { id: 'metric.tasks', w: 3, h: 3 }, { id: 'tasks', w: 9, h: 14 }],
      hidden: ['drafts', 'favorites'],
    }
    const saved = await home.setHomeLayout(ctx(A, ME), mine)
    expect(saved.customised).toBe(true)
    expect(saved.updated_at).toEqual(expect.any(String))
    // Mine in my order; the widgets I didn't mention follow their default predecessors.
    expect(ids(saved.layout)).toEqual([
      'chart.completed', 'chart.duration', 'chart.top_processes',
      'metric.tasks', 'chart.decisions', 'metric.submissions', 'metric.following', 'tasks',
    ])
    expect(saved.layout.items.find((i) => i.id === 'tasks')).toEqual({ id: 'tasks', w: 9, h: 14 })
    expect(saved.layout.hidden).toEqual(['drafts'])
    expect(JSON.stringify((await prefsOf(ME)).home_layout)).not.toContain('favorites')

    // Same person, another device: the same layout.
    const again = await home.getHomeLayout(ctx(A, ME))
    expect(again.layout).toEqual(saved.layout)
    // Another workspace: still the default.
    expect((await home.getHomeLayout(ctx(B, ME))).customised).toBe(false)
    // Another person in the same workspace: still the default.
    expect((await home.getHomeLayout(ctx(A, OTHER))).customised).toBe(false)
    expect((await prefsOf(OTHER)).home_layout).toBeUndefined()

    // Keyed by workspace; auto-follow untouched (and setting it keeps the layout).
    const prefs = await prefsOf(ME)
    expect(Object.keys(prefs.home_layout)).toEqual([A])
    expect(prefs.auto_follow_runs).toBe(false)
    await home.setHomePreferences(ctx(A, ME), { auto_follow_runs: false })
    expect((await home.getHomeLayout(ctx(A, ME))).layout).toEqual(saved.layout)

    // A second workspace gets its own entry.
    await home.setHomeLayout(ctx(B, ME), { items: [{ id: 'tasks', w: 12, h: 20 }], hidden: [] })
    expect(ids((await home.getHomeLayout(ctx(B, ME))).layout)[0]).toBe('metric.tasks')
    expect((await home.getHomeLayout(ctx(B, ME))).layout.items.find((i) => i.id === 'tasks')?.h).toBe(20)
    expect(ids((await home.getHomeLayout(ctx(A, ME))).layout)[0]).toBe('chart.completed')
  })

  it('validates writes: known widgets, sizes in the grid, size cap, a user-bound credential', async () => {
    await expect(home.setHomeLayout(ctx(A, ME), { items: [{ id: 'nope', w: 4, h: 4 }] })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(home.setHomeLayout(ctx(A, ME), { items: [{ id: 'tasks', w: 40, h: 4 }] })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(home.setHomeLayout(ctx(A, ME), { items: [{ id: 'tasks', w: 4, h: 6 }, { id: 'tasks', w: 4, h: 6 }] })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(home.setHomeLayout(ctx(A, ME), { items: [], junk: 'x'.repeat(10_000) })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(home.setHomeLayout(ctx(A, ME), null)).rejects.toMatchObject({ code: 'validation_error' })
    await expect(home.setHomeLayout(ctx(A, null), { items: [] })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(home.getHomeLayout(ctx(A, null))).rejects.toMatchObject({ code: 'forbidden' })
    // Sizes within the grid but outside a widget's bounds are clamped.
    const clamped = await home.setHomeLayout(ctx(A, OTHER), { items: [{ id: 'metric.tasks', w: 12, h: 1 }] })
    expect(clamped.layout.items.find((i) => i.id === 'metric.tasks')).toEqual({ id: 'metric.tasks', w: 6, h: 4 })
  })

  it('normalises what is stored: removed widgets dropped, sizes clamped, new widgets in their default spot', async () => {
    await q(`UPDATE public.users SET preferences = jsonb_set(preferences, '{home_layout}', $2::jsonb) WHERE id = $1`, [OTHER, JSON.stringify({
      [A]: { items: [{ id: 'tasks', w: 12, h: 99 }, { id: 'widget.retired', w: 4, h: 4 }, { id: 'favorites', w: 12, h: 4 }, { id: 'metric.following', w: 1, h: 3 }], hidden: ['chart.decisions', 'gone'] },
    })])
    const r = await home.getHomeLayout(ctx(A, OTHER))
    expect(r.customised).toBe(true)
    expect(ids(r.layout)).not.toContain('widget.retired')
    expect(ids(r.layout)).not.toContain('favorites')
    expect(r.layout.items[0]).toEqual({ id: 'metric.tasks', w: 3, h: 4 }) // new: before the task list
    expect(r.layout.items.find((i) => i.id === 'tasks')?.h).toBe(30)
    expect(r.layout.items.find((i) => i.id === 'metric.following')?.w).toBe(3)
    expect(r.layout.hidden).toEqual(['chart.decisions'])
    expect([...ids(r.layout), ...r.layout.hidden]).toHaveLength(9)
  })

  it('reset clears only this workspace (idempotent)', async () => {
    const r = await home.resetHomeLayout(ctx(A, ME))
    expect(r.customised).toBe(false)
    expect(r.layout).toEqual(defaultHomeLayout())
    const prefs = await prefsOf(ME)
    expect(Object.keys(prefs.home_layout)).toEqual([B])
    expect(prefs.auto_follow_runs).toBe(false)
    expect((await home.resetHomeLayout(ctx(A, ME))).customised).toBe(false)
    await home.resetHomeLayout(ctx(B, ME))
    expect((await prefsOf(ME)).home_layout).toBeUndefined()
    expect((await prefsOf(ME)).auto_follow_runs).toBe(false)
  })

  it('RLS: a signed-in person cannot write another person’s layout', async () => {
    await home.setHomeLayout(ctx(A, ME), { items: [{ id: 'tasks', w: 6, h: 10 }], hidden: [] })
    const before = await prefsOf(ME)
    const attack = await as(OTHER, `UPDATE public.users SET preferences = jsonb_set(coalesce(preferences, '{}'::jsonb), '{home_layout}', '{}'::jsonb) WHERE id = $1`, [ME])
    expect(attack.error ? 'refused' : attack.rowCount).toSatisfy((v: unknown) => v === 'refused' || v === 0)
    expect(await prefsOf(ME)).toEqual(before)
    // The service only ever writes the acting person's own row.
    await home.setHomeLayout(ctx(A, OTHER), { items: [{ id: 'drafts', w: 3, h: 2 }], hidden: [] })
    expect(await prefsOf(ME)).toEqual(before)
  })
})
