/**
 * Auto-follow what I act on + Task tracker → Following via runs, against a
 * LOCAL Supabase stack (migration 20261228000000_followed_run_tasks.sql,
 * lib/services/task-actions autoFollowActedRun, lib/services/task-follows
 * viaRuns). Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/followed-run-tasks-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, Pool } from 'pg'
import { createPgQuery } from '@user-tasks/pg-query'
import { createClient } from './helpers/db-test-client'
import { autoFollowActedRun } from '@/lib/services/task-actions'
import * as follows from '@/lib/services/task-follows'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are loose JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `7e0e7e00-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const uid = (n: number) => `7e${n.toString(16).padStart(6, '0')}-0000-4000-8000-00000000007e`
const A = id(0xa)
const ACTOR = uid(0x201)     // approved step 1 (assignee of T_STEP1)
const NEXT = uid(0x202)      // has step 2
const STRANGER = uid(0x203)  // member, nothing to do with the run
const OPTOUT = uid(0x204)    // has a task in the run, opted out of auto-follow
const USERS = [ACTOR, NEXT, STRANGER, OPTOUT]
const WF = id(0x301)
const RUN = id(0x401)
const RUN_DONE = id(0x402)
const T_STEP1 = id(0x501)
const T_STEP2 = id(0x502)
const T_OPT = id(0x503)
const T_DONE_RUN = id(0x504)
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

describe.skipIf(!DB_URL)('followed run tasks (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const pool = new Pool({ connectionString: DB_URL, max: 2 })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const pgq = createPgQuery({ pool, maxRows: 1000 })
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows
  const session = (actorId: string): ServiceContext => {
    const client = pgq.client({ role: 'authenticated', claims: { sub: actorId, role: 'authenticated', aud: 'authenticated' } }) as any
    return { supabase: client, db: client, tenantId: A, actorId, permissions: new Set(['tasks.view_own', 'tasks.complete']), authKind: 'session', source: 'ui' } as ServiceContext
  }

  async function cleanup() {
    const personal = (await q('SELECT tenant_id FROM public.users WHERE id = ANY($1::uuid[])', [USERS])).map((r: any) => r.tenant_id)
    await db.query('DELETE FROM public.run_followers WHERE tenant_id = $1', [A]).catch(() => undefined)
    await db.query('DELETE FROM public.tasks WHERE tenant_id = $1', [A]).catch(() => undefined)
    await db.query('DELETE FROM public.workflow_runs WHERE tenant_id = $1', [A]).catch(() => undefined)
    await db.query('DELETE FROM public.workflows WHERE tenant_id = $1', [A]).catch(() => undefined)
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [USERS])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [[A, ...personal.filter((t: string | null) => t && t !== A)]])
  }

  beforeAll(async () => {
    await db.connect()
    await cleanup()
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Run follow A', 'run-follow-a-test')`, [A])
    for (const user of USERS) {
      await q(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [user, `r${user.slice(2, 8)}.${Date.now().toString(36)}@runfollow.test`])
      await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [user, A])
      await q('UPDATE public.users SET current_tenant_id = $2, display_name = $3 WHERE id = $1', [user, A, `User ${user.slice(2, 8)}`])
    }
    await q(`UPDATE public.users SET preferences = coalesce(preferences, '{}'::jsonb) || '{"auto_follow_acted_runs": false}'::jsonb WHERE id = $1`, [OPTOUT])
    const memberRole = (await q(`SELECT id FROM public.roles WHERE tenant_id = $1 AND slug = 'member'`, [A]))[0].id
    for (const user of USERS) await q('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [A, user, memberRole])
    await q(`INSERT INTO public.workflows (id, tenant_id, name) VALUES ($1, $2, 'Purchase request')`, [WF, A])
    await q(`INSERT INTO public.workflow_runs (id, workflow_id, tenant_id, status, event_id) VALUES ($1, $2, $3, 'waiting_for_event', 'evt-run-follow-1'), ($4, $2, $3, 'completed', 'evt-run-follow-2')`, [RUN, WF, A, RUN_DONE])
    const task = (tid: string, run: string, assignee: string, title: string, status = 'todo') =>
      q(`INSERT INTO public.tasks (id, tenant_id, title, status, priority, assignee_id, workflow_run_id, is_workflow_task)
         VALUES ($1, $2, $3, $4::task_status, 'medium', $5, $6, true)`, [tid, A, title, status, assignee, run])
    await task(T_STEP1, RUN, ACTOR, 'Manager approval', 'completed')
    await task(T_STEP2, RUN, NEXT, 'Finance approval')
    await task(T_OPT, RUN, OPTOUT, 'Legal check')
    await task(T_DONE_RUN, RUN_DONE, ACTOR, 'Old request step')
    // ACTOR assigned step 2, so they can see (and follow) it directly too.
    await q('UPDATE public.tasks SET assigner_id = $1 WHERE id = $2', [ACTOR, T_STEP2])
  })

  afterAll(async () => {
    await cleanup()
    await db.end()
    await pool.end()
  })

  it('acting on a step follows the run; opted-out people and strangers do not', async () => {
    expect(await autoFollowActedRun(admin as any, { tenant_id: A, workflow_run_id: RUN }, ACTOR, 'ui')).toBe(RUN)
    expect(await autoFollowActedRun(admin as any, { tenant_id: A, workflow_run_id: RUN }, OPTOUT, 'ui')).toBeNull()
    expect(await autoFollowActedRun(admin as any, { tenant_id: A, workflow_run_id: RUN }, STRANGER, 'api')).toBeNull() // can't see the run
    const rows = await q('SELECT user_id, source FROM public.run_followers WHERE run_id = $1', [RUN])
    expect(rows).toEqual([{ user_id: ACTOR, source: 'auto' }])
    // Idempotent.
    expect(await autoFollowActedRun(admin as any, { tenant_id: A, workflow_run_id: RUN }, ACTOR, 'mcp')).toBe(RUN)
    expect((await q('SELECT count(*)::int AS n FROM public.run_followers WHERE run_id = $1', [RUN]))[0].n).toBe(1)
  })

  it('Following lists the open tasks of the followed run, each once, labelled with the run', async () => {
    await q(`INSERT INTO public.run_followers (tenant_id, user_id, run_id, source) VALUES ($1, $2, $3, 'auto') ON CONFLICT DO NOTHING`, [A, ACTOR, RUN_DONE])
    await q(`INSERT INTO public.task_followers (tenant_id, user_id, task_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [A, ACTOR, T_STEP2])
    const rows = await follows.listFollowedTasks(session(ACTOR), { viaRuns: true, hideCompleted: true })
    const ids = rows.map((r: any) => r.id).sort()
    expect(ids).toEqual([T_STEP2, T_OPT].sort()) // not the completed step, not the finished run's task
    expect(rows.find((r: any) => r.id === T_STEP2).followed_via_run).toBeNull() // followed directly: once, unlabelled
    expect(rows.find((r: any) => r.id === T_OPT).followed_via_run).toMatchObject({ run_id: RUN, workflow_name: 'Purchase request' })
    // Show completed: the finished run's task and the completed step come back.
    const all = (await follows.listFollowedTasks(session(ACTOR), { viaRuns: true })).map((r: any) => r.id)
    expect(all).toEqual(expect.arrayContaining([T_STEP1, T_DONE_RUN]))
  })

  it('a follower who can no longer see the run gets nothing from it; nobody can ask for someone else', async () => {
    await q(`INSERT INTO public.run_followers (tenant_id, user_id, run_id, source) VALUES ($1, $2, $3, 'manual') ON CONFLICT DO NOTHING`, [A, STRANGER, RUN])
    expect(await follows.listFollowedTasks(session(STRANGER), { viaRuns: true })).toEqual([])
    await db.query('BEGIN')
    try {
      await db.query('SET LOCAL ROLE authenticated')
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: STRANGER, role: 'authenticated' })])
      const { rows } = await db.query('SELECT * FROM public.list_followed_run_tasks($1, $2, true)', [ACTOR, A])
      expect(rows).toEqual([])
    } finally {
      await db.query('ROLLBACK')
    }
  })
})
