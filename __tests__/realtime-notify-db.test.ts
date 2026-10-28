/**
 * NOTIFY triggers of supabase/migrations/20261105000000_realtime_notify.sql
 * and the SSE realtime pipeline end to end against the real schema:
 * payload shapes (ids + routing columns only, old values on updates),
 * chunking under the 8000-byte limit, bulk statements, the idle guard, and
 * tenant isolation through RealtimeHub (LISTEN) → audience (RLS functions,
 * evaluated as the user via pg-query) → SSE stream.
 *
 * NOTIFY is only delivered on COMMIT, so unlike the other DB suites this one
 * commits its fixtures (two throwaway workspaces) and deletes them after.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/realtime-notify-db.test.ts
 */
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, Pool } from 'pg'
import { createPgQuery } from '@usertasks/pg-query'

const DB_URL = process.env.EVENT_STREAM_DB_URL

function uid(key: string): string {
  const h = createHash('md5').update(`realtime-notify:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const TENANT = { A: uid('tenant:A'), B: uid('tenant:B') }
const USER = { a: uid('user:a'), b: uid('user:b') }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!DB_URL)('realtime NOTIFY triggers and SSE isolation (local DB)', () => {
  const admin = new Client({ connectionString: DB_URL })
  const listener = new Client({ connectionString: DB_URL })
  const payloads: string[] = []
  const extraTenants = new Set<string>()

  async function cleanup() {
    const tenants = [TENANT.A, TENANT.B, ...extraTenants]
    await admin.query('DELETE FROM public.notifications WHERE tenant_id = ANY($1::uuid[])', [tenants]).catch(() => {})
    await admin.query('DELETE FROM public.tasks WHERE tenant_id = ANY($1::uuid[])', [tenants]).catch(() => {})
    await admin.query('DELETE FROM public.user_memberships WHERE user_id = ANY($1::uuid[])', [[USER.a, USER.b]]).catch(() => {})
    await admin.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [[USER.a, USER.b]]).catch(() => {})
    await admin.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [tenants]).catch(() => {})
  }

  /** Payloads (parsed) received since `from` that mention one of our tenants. */
  function ours(from: number) {
    return payloads.slice(from).map((p) => JSON.parse(p)).filter((p) => JSON.stringify(p).includes(TENANT.A) || JSON.stringify(p).includes(TENANT.B))
  }

  beforeAll(async () => {
    await admin.connect()
    await listener.connect()
    listener.on('notification', (msg) => { if (msg.payload) payloads.push(msg.payload) })
    await listener.query('LISTEN usertasks_realtime')
    await cleanup()
    for (const [k, user] of [['A', USER.a], ['B', USER.b]] as const) {
      await admin.query('INSERT INTO public.tenants (id, name, slug) VALUES ($1, $2, $3)', [TENANT[k], `Realtime ${k}`, `realtime-notify-${k.toLowerCase()}`])
      // The auth trigger creates the users row and a personal workspace.
      await admin.query(
        `INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [user, `realtime-${k.toLowerCase()}@notify.test`],
      )
      const { rows } = await admin.query('SELECT tenant_id FROM public.user_memberships WHERE user_id = $1', [user])
      for (const r of rows) extraTenants.add(r.tenant_id)
      await admin.query('DELETE FROM public.user_memberships WHERE user_id = $1', [user])
      await admin.query('UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1', [user, TENANT[k]])
      await admin.query('INSERT INTO public.user_memberships (user_id, tenant_id, role, is_home) VALUES ($1, $2, $3, true)', [user, TENANT[k], 'owner'])
    }
  }, 60_000)

  afterAll(async () => {
    await cleanup()
    await admin.query(`UPDATE app_realtime.listener_state SET listening_until = '-infinity'`).catch(() => {})
    await listener.end()
    await admin.end()
  })

  it('stays silent while no listener has armed the triggers', async () => {
    await admin.query(`UPDATE app_realtime.listener_state SET listening_until = '-infinity'`)
    const from = payloads.length
    await admin.query('INSERT INTO public.tasks (tenant_id, title) VALUES ($1, $2)', [TENANT.A, 'silent'])
    await sleep(300)
    expect(ours(from)).toEqual([])
  })

  it('emits ids and routing columns (new and old values), never row data', async () => {
    const { rows: [{ now }] } = await admin.query('SELECT app_realtime.mark_listening(120) AS now')
    expect(Number(now)).toBeGreaterThan(1_600_000_000_000)
    const from = payloads.length
    const { rows: [task] } = await admin.query(
      'INSERT INTO public.tasks (tenant_id, title, assignee_id, description) VALUES ($1, $2, $3, $4) RETURNING id',
      [TENANT.A, 'secret title', USER.a, 'secret description'],
    )
    await admin.query('UPDATE public.tasks SET assignee_id = $2 WHERE id = $1', [task.id, USER.b])
    await admin.query('INSERT INTO public.notifications (user_id, tenant_id, type, title) VALUES ($1, $2, $3, $4)', [USER.a, TENANT.A, 'info', 'secret note'])
    await admin.query('DELETE FROM public.tasks WHERE id = $1', [task.id])
    await sleep(300)
    const got = ours(from)
    const taskPayloads = got.filter((p) => p.table === 'tasks' && p.rows?.some((r: { id: string }) => r.id === task.id))
    expect(taskPayloads.map((p) => p.op)).toEqual(['INSERT', 'UPDATE', 'DELETE'])
    expect(taskPayloads[0].rows).toEqual([{ id: task.id, tenant_id: TENANT.A, assignee_id: [USER.a], assigner_id: [], parent_task_id: [] }])
    expect(taskPayloads[1].rows[0].assignee_id).toEqual([USER.b, USER.a])
    expect(typeof taskPayloads[0].ts).toBe('number')
    const notif = got.find((p) => p.table === 'notifications')
    expect(notif).toMatchObject({ op: 'INSERT', rows: [{ tenant_id: TENANT.A, user_id: [USER.a] }] })
    expect(JSON.stringify(got)).not.toContain('secret')
  })

  it('chunks large statements below the 8000-byte payload limit and sends one bulk notice above 200 rows', async () => {
    await admin.query('SELECT app_realtime.mark_listening(120)')
    let from = payloads.length
    await admin.query(`INSERT INTO public.tasks (tenant_id, title, assignee_id) SELECT $1, 'chunk ' || g, $2 FROM generate_series(1, 150) g`, [TENANT.A, USER.a])
    await sleep(300)
    const chunks = ours(from).filter((p) => p.table === 'tasks')
    expect(chunks.length).toBeGreaterThan(1)
    for (const raw of payloads.slice(from)) expect(Buffer.byteLength(raw)).toBeLessThan(8000)
    expect(new Set(chunks.flatMap((p) => p.rows.map((r: { id: string }) => r.id))).size).toBe(150)

    from = payloads.length
    await admin.query(`INSERT INTO public.tasks (tenant_id, title) SELECT $1, 'bulk ' || g FROM generate_series(1, 250) g`, [TENANT.B])
    await sleep(300)
    const bulk = ours(from).filter((p) => p.table === 'tasks')
    expect(bulk).toEqual([{ table: 'tasks', op: 'INSERT', ts: bulk[0].ts, bulk: true, tenants: [TENANT.B] }])
  })

  it('end to end: a tenant A user hears about A tasks and their own notifications only', async () => {
    const { RealtimeHub } = await import('@/lib/realtime/hub')
    const { authorizeSubscriptions, loadAudience } = await import('@/lib/realtime/authorize')
    const { createRealtimeStream } = await import('@/lib/realtime/stream')

    const hub = new RealtimeHub({ connectionString: DB_URL!, log: () => {} })
    const pool = new Pool({ connectionString: DB_URL, max: 2 })
    try {
      const pgq = createPgQuery({ pool, maxRows: 1000 })
      const asA = pgq.client({ role: 'authenticated', claims: { sub: USER.a, role: 'authenticated', aud: 'authenticated' } })
      const audience = await loadAudience(asA, USER.a)
      expect([...audience.visible]).toEqual([TENANT.A])

      const { rows: [bTask] } = await admin.query('INSERT INTO public.tasks (tenant_id, title) VALUES ($1, $2) RETURNING id', [TENANT.B, 'b-task'])
      const keys = ['tasks||*', `tasks|tenant_id=eq.${TENANT.B}|*`, `notifications|user_id=eq.${USER.a}|*`, `notifications|user_id=eq.${USER.b}|*`, `tasks|id=eq.${bTask.id}|*`]
      const { accepted, rejected } = await authorizeSubscriptions({ userId: USER.a, permissions: null, db: asA }, keys)
      expect(rejected.map((r) => r.reason)).toEqual(['forbidden', 'not_found'])

      const stream = createRealtimeStream({ hub, subscriptions: accepted, audience, maxMs: 60_000, flushMs: 50 })
      const reader = stream.getReader()
      let text = ''
      const pump = (async () => {
        for (;;) {
          const r = await reader.read()
          if (r.done) return
          text += new TextDecoder().decode(r.value)
        }
      })()
      // Wait until the hub is listening (it armed the triggers).
      for (let i = 0; i < 50 && hub.watermark() === null; i++) await sleep(100)
      expect(hub.mode).toBe('listen')

      const ins = async (sql: string, params: unknown[]) => (await admin.query(sql, params)).rows[0].id as string
      const aTask = await ins('INSERT INTO public.tasks (tenant_id, title, assignee_id) VALUES ($1, $2, $3) RETURNING id', [TENANT.A, 'a-task', USER.a])
      const bTask2 = await ins('INSERT INTO public.tasks (tenant_id, title, assignee_id) VALUES ($1, $2, $3) RETURNING id', [TENANT.B, 'b-task-2', USER.a])
      const myNote = await ins('INSERT INTO public.notifications (user_id, tenant_id, type, title) VALUES ($1, $2, $3, $4) RETURNING id', [USER.a, TENANT.A, 'info', 'mine'])
      const theirNote = await ins('INSERT INTO public.notifications (user_id, tenant_id, type, title) VALUES ($1, $2, $3, $4) RETURNING id', [USER.b, TENANT.A, 'info', 'theirs'])
      await admin.query('UPDATE public.tasks SET title = $2 WHERE id = $1', [bTask.id, 'b-task changed'])

      for (let i = 0; i < 50 && !(text.includes(aTask) && text.includes(myNote)); i++) await sleep(100)
      await reader.cancel()
      await pump
      expect(text).toContain(aTask)
      expect(text).toContain(myNote)
      for (const leaked of [bTask.id, bTask2, theirNote]) expect(text).not.toContain(leaked)
    } finally {
      await hub.stop()
      await pool.end()
    }
  }, 30_000)
})
