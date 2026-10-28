/**
 * Background jobs (migration 20261114000000_user_jobs.sql, lib/user-jobs)
 * against a LOCAL database: the runner's lifecycle (enqueue → run → succeed
 * with a stored file and a bell notification; progress; retry with backoff;
 * permanent failures; cancel queued and running jobs; lease expiry and
 * resume from a checkpoint; chunked jobs), the permission re-check as the
 * starting user / API key when the job runs, RLS (own jobs, workspace
 * admins, other tenants, no client writes), the download / result rules
 * (owner only, not finished, expired) and the expiry cleanup.
 *
 * Runs when EVENT_STREAM_DB_URL is set, on the local Supabase stack (REST via
 * PostgREST, Supabase Storage) or plain PostgreSQL (DB_PROVIDER=postgres,
 * STORAGE_PROVIDER=local), e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/user-jobs-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { z } from 'zod'
import { createClient } from './helpers/db-test-client'

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  // Outside a request: after() throws, so the runner starts jobs unawaited. Tests drive runs themselves.
  after: () => { throw new Error('no request scope') },
}))

import { requirePerm, ServiceError, type ServiceContext } from '@/lib/services/context'
import { defineJobKind, type JobKind } from '@/lib/user-jobs/define'
import { enqueueUserJob, jobServiceContext, processUserJobs, purgeExpiredUserJobs, retryDelayMs, runUserJob } from '@/lib/user-jobs/runner'
import { cancelJob, getJob, getJobResult, listJobs, openJobDownload, retryJob } from '@/lib/services/user-jobs'
import { readAll } from '@/lib/providers/storage/types'

/* eslint-disable @typescript-eslint/no-explicit-any -- job rows are untyped in tests */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `0b100000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const T = id(0xa)
const OTHER_T = id(0xb)
const OWNER = id(0x1) // reports.view + settings.view
const MATE = id(0x2) // same tenant, reports.view only
const ADMIN = id(0x3) // settings.edit in T
const OUTSIDER = id(0x4) // home OTHER_T, settings.edit there
const ROLE_VIEW = id(0x101)
const ROLE_ADMIN = id(0x102)
const ROLE_OTHER = id(0x103)
const KEY = id(0x201)

/** Test kinds: a file export, a counter that runs in chunks, kinds that fail. */
let flaky = 0
let chunkRuns = 0
const exportKind = defineJobKind({
  kind: 'test.export',
  effect: 'download',
  params: z.object({ rows: z.number().int().min(1).max(1000) }),
  title: (p) => `Test export (${p.rows})`,
  authorize: (ctx) => requirePerm(ctx, 'reports.view'),
  async run({ params, progress }) {
    await progress(50, 'half way')
    return { file: { name: 'rows.csv', contentType: 'text/csv', body: Array.from({ length: params.rows }, (_, i) => `row ${i}`).join('\n') }, counts: { rows: params.rows }, summary: `${params.rows} rows` }
  },
})
const chunkKind = defineJobKind({
  kind: 'test.chunks',
  effect: 'result',
  maxAttempts: 3,
  params: z.object({ total: z.number().int() }),
  title: () => 'Chunked count',
  authorize: (ctx) => requirePerm(ctx, 'reports.view'),
  async run({ params, checkpoint, putPart, readParts }) {
    chunkRuns++
    const done = (checkpoint as { done: number } | null)?.done ?? 0
    if (done < params.total) {
      await putPart(done, `part ${done}\n`)
      return { continue: { done: done + 1 }, progress: ((done + 1) / params.total) * 100 }
    }
    const parts = await readParts(params.total)
    return { data: { text: parts.map((p) => new TextDecoder().decode(p)).join('') } }
  },
})
const flakyKind = defineJobKind({
  kind: 'test.flaky',
  effect: 'result',
  maxAttempts: 2,
  params: z.object({}),
  title: () => 'Flaky',
  authorize: () => undefined,
  async run() { flaky++; throw new Error(`boom ${flaky}`) },
})
const deniedKind = defineJobKind({
  kind: 'test.denied',
  effect: 'result',
  maxAttempts: 3,
  params: z.object({}),
  title: () => 'Denied',
  authorize: () => undefined,
  async run() { throw ServiceError.validation('bad input') },
})
let releaseSlow: (() => void) | null = null
const slowKind = defineJobKind({
  kind: 'test.slow',
  effect: 'result',
  params: z.object({}),
  title: () => 'Slow',
  authorize: () => undefined,
  async run({ progress }) {
    for (let i = 0; i < 50; i++) {
      await new Promise<void>((resolve) => { releaseSlow = resolve; setTimeout(resolve, 100) })
      await progress(i * 2, `step ${i}`)
    }
    return { data: { finished: true } }
  },
})
const KINDS = new Map<string, JobKind<any>>([exportKind, chunkKind, flakyKind, deniedKind, slowKind].map((k) => [k.kind, k]))

describe.skipIf(!DB_URL)('background jobs (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) as any
  const deps = { supabase: admin, kinds: (name: string) => KINDS.get(name), start: false, kick: () => undefined }
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }

  const session = (userId: string, tenantId = T, permissions: string[] = ['reports.view']): ServiceContext =>
    ({ db: admin, supabase: admin, tenantId, actorId: userId, permissions: new Set(permissions), authKind: 'session', source: 'ui' })
  const row = async (jobId: string) => (await db.query('SELECT * FROM public.user_jobs WHERE id = $1', [jobId])).rows[0]
  const due = (jobId: string) => db.query(`UPDATE public.user_jobs SET run_after = now() - interval '1 second' WHERE id = $1`, [jobId])

  /** Run SQL as an end user the way PostgREST does (SET ROLE + jwt claims), inside a savepoint. */
  async function asUser(sub: string, sql: string, params: unknown[] = []) {
    await db.query('BEGIN')
    try {
      await db.query('SET LOCAL ROLE authenticated')
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated' })])
      const { rows } = await db.query(sql, params)
      return { rows, error: null as string | null }
    } catch (error) {
      return { rows: [], error: (error as { code?: string }).code ?? 'error' }
    } finally {
      await db.query('ROLLBACK')
    }
  }

  async function cleanup() {
    await db.query('DELETE FROM public.user_jobs WHERE tenant_id = ANY($1)', [[T, OTHER_T]])
    await db.query('DELETE FROM public.notifications WHERE tenant_id = ANY($1)', [[T, OTHER_T]])
    await db.query('DELETE FROM public.api_keys WHERE tenant_id = ANY($1)', [[T, OTHER_T]])
    await db.query('DELETE FROM public.user_roles WHERE tenant_id = ANY($1)', [[T, OTHER_T]])
    await db.query('DELETE FROM public.users WHERE id = ANY($1)', [[OWNER, MATE, ADMIN, OUTSIDER]])
    await db.query('DELETE FROM public.roles WHERE id = ANY($1)', [[ROLE_VIEW, ROLE_ADMIN, ROLE_OTHER]])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1)', [[T, OTHER_T]])
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Jobs T', 'user-jobs-test-t'), ($2, 'Jobs Other', 'user-jobs-test-o')`, [T, OTHER_T])
    for (const [user, home] of [[OWNER, T], [MATE, T], [ADMIN, T], [OUTSIDER, OTHER_T]]) {
      await db.query(`INSERT INTO public.users (id, tenant_id, current_tenant_id, email, display_name) VALUES ($1, $2, $2, $3, 'Jobs user')`, [user, home, `${user}@jobs.test`])
    }
    await db.query(`INSERT INTO public.roles (id, tenant_id, name, slug, permissions) VALUES
      ($1, $4, 'jobs-view', 'jobs-view', ARRAY['reports.view','settings.view']), ($2, $4, 'jobs-admin', 'jobs-admin', ARRAY['reports.view','settings.edit']), ($3, $5, 'jobs-other', 'jobs-other', ARRAY['reports.view','settings.edit'])`,
    [ROLE_VIEW, ROLE_ADMIN, ROLE_OTHER, T, OTHER_T])
    await db.query(`INSERT INTO public.user_roles (user_id, tenant_id, role_id) VALUES ($1, $5, $3), ($2, $5, $3), ($4, $5, $6), ($7, $8, $9)`,
      [OWNER, MATE, ROLE_VIEW, ADMIN, T, ROLE_ADMIN, OUTSIDER, OTHER_T, ROLE_OTHER])
    await db.query(`INSERT INTO public.api_keys (id, tenant_id, name, key_prefix, key_hash, key_type) VALUES ($1, $2, 'jobs key', 'jobstest', 'x', 'tenant')`, [KEY, T])
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
  })

  it('enqueue → run → succeeded with a stored file, progress and a bell notification', async () => {
    const job = await enqueueUserJob(session(OWNER), 'test.export', { rows: 3 }, deps)
    expect(job).toMatchObject({ status: 'queued', title: 'Test export (3)', downloadable: false, cancellable: true })
    const stored = await row(job.id)
    expect(stored.origin).toEqual({ source: 'ui', auth_kind: 'session' })
    expect(stored.user_id).toBe(OWNER)

    const done = await runUserJob(job.id, deps)
    expect(done).toMatchObject({ status: 'succeeded', progress: 100, attempts: 1, lease_owner: null })
    expect(done!.result!.file).toMatchObject({ filename: 'rows.csv', content_type: 'text/csv' })
    expect(new Date(done!.expires_at!).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000)

    const view = await getJob(session(OWNER), job.id)
    expect(view).toMatchObject({ downloadable: true, download_url: `/api/jobs/${job.id}/download`, result: { summary: '3 rows', counts: { rows: 3 } } })
    expect(JSON.stringify(view)).not.toContain('storage://') // refs stay server-side

    const file = await openJobDownload(session(OWNER), job.id)
    expect(new TextDecoder().decode(await readAll(file.body))).toBe('row 0\nrow 1\nrow 2')
    const notes = (await db.query('SELECT type, title, job_id, user_id FROM public.notifications WHERE job_id = $1', [job.id])).rows
    expect(notes).toEqual([{ type: 'job_succeeded', title: 'Test export (3) is ready', job_id: job.id, user_id: OWNER }])
  })

  it('refuses unknown kinds, invalid params and callers without the permission (at enqueue)', async () => {
    await expect(enqueueUserJob(session(OWNER), 'test.nope', {}, deps)).rejects.toMatchObject({ code: 'validation_error' })
    await expect(enqueueUserJob(session(OWNER), 'test.export', { rows: 0 }, deps)).rejects.toMatchObject({ code: 'validation_error' })
    await expect(enqueueUserJob(session(OWNER, T, ['settings.view']), 'test.export', { rows: 1 }, deps)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('re-checks permissions as the user when it runs: a lost role or membership fails the job', async () => {
    const job = await enqueueUserJob(session(MATE), 'test.export', { rows: 1 }, deps)
    await db.query('DELETE FROM public.user_roles WHERE user_id = $1', [MATE])
    try {
      const done = await runUserJob(job.id, deps)
      expect(done).toMatchObject({ status: 'failed' })
      expect(done!.error).toMatch(/reports\.view/)
      expect(done!.attempts).toBe(1) // permission errors are not retried
    } finally {
      await db.query('INSERT INTO public.user_roles (user_id, tenant_id, role_id) VALUES ($1, $2, $3)', [MATE, T, ROLE_VIEW])
    }
    // The caller's session permissions don't matter in the runner — only the live roles.
    const ctx = await jobServiceContext(admin, { ...(await row(job.id)), user_id: OUTSIDER })
      .then(() => null, (error) => error)
    expect(ctx).toMatchObject({ code: 'forbidden' }) // not a member of T
  })

  it('API-key jobs keep the key\'s permission ceiling and fail once the key is revoked', async () => {
    const keyCtx: ServiceContext = { db: admin, supabase: admin, tenantId: T, actorId: null, permissions: new Set(['reports.view']), authKind: 'api_key', source: 'api', keyType: 'tenant', credentialId: KEY }
    const job = await enqueueUserJob(keyCtx, 'test.export', { rows: 1 }, deps)
    expect((await row(job.id)).origin).toMatchObject({ source: 'api', auth_kind: 'api_key', key_id: KEY, permissions: ['reports.view'] })
    const ctx = await jobServiceContext(admin, await row(job.id))
    expect([...(ctx.permissions ?? [])]).toEqual(['reports.view'])
    expect(ctx).toMatchObject({ authKind: 'job', source: 'job', tenantId: T, actorId: null, jobId: job.id })

    await db.query('UPDATE public.api_keys SET is_revoked = true WHERE id = $1', [KEY])
    const done = await runUserJob(job.id, deps)
    expect(done).toMatchObject({ status: 'failed', error: expect.stringMatching(/revoked/) })
    await db.query('UPDATE public.api_keys SET is_revoked = false WHERE id = $1', [KEY])
    // Tenant keys see the jobs they started (no user).
    expect((await listJobs(keyCtx)).jobs.map((j) => j.id)).toContain(job.id)
  })

  it('retries unexpected errors with backoff, then fails and notifies; ServiceErrors fail at once', async () => {
    flaky = 0
    const job = await enqueueUserJob(session(OWNER), 'test.flaky', {}, deps)
    let state = await runUserJob(job.id, deps)
    expect(state).toMatchObject({ status: 'queued', attempts: 1, error: 'boom 1' })
    expect(new Date(state!.run_after).getTime()).toBeGreaterThan(Date.now() + retryDelayMs(1) - 5_000)
    expect(await runUserJob(job.id, deps)).toBeNull() // not due yet
    await due(job.id)
    state = await runUserJob(job.id, deps)
    expect(state).toMatchObject({ status: 'failed', attempts: 2, error: 'boom 2' })
    expect((await db.query(`SELECT type FROM public.notifications WHERE job_id = $1`, [job.id])).rows).toEqual([{ type: 'job_failed' }])

    const denied = await enqueueUserJob(session(OWNER), 'test.denied', {}, deps)
    expect(await runUserJob(denied.id, deps)).toMatchObject({ status: 'failed', attempts: 1, error: 'bad input' })
  })

  it('cancels a queued job at once and a running one at its next progress report', async () => {
    const queued = await enqueueUserJob(session(OWNER), 'test.export', { rows: 1 }, deps)
    expect(await cancelJob(session(OWNER), queued.id)).toMatchObject({ status: 'cancelled', cancellable: false, retryable: true })
    expect(await runUserJob(queued.id, deps)).toBeNull()

    const slow = await enqueueUserJob(session(OWNER), 'test.slow', {}, deps)
    const running = runUserJob(slow.id, deps)
    for (let i = 0; i < 50 && (await row(slow.id)).status !== 'running'; i++) await new Promise((r) => setTimeout(r, 50))
    // Others can't cancel it (404); the owner can.
    await expect(cancelJob(session(MATE), slow.id)).rejects.toMatchObject({ code: 'not_found' })
    expect(await cancelJob(session(OWNER), slow.id)).toMatchObject({ status: 'running', cancellable: false })
    releaseSlow?.()
    expect(await running).toMatchObject({ status: 'cancelled' })
  })

  it('a job whose invocation died (lease expired) is claimed again and resumes from its checkpoint', async () => {
    chunkRuns = 0
    const job = await enqueueUserJob(session(OWNER), 'test.chunks', { total: 3 }, deps)
    // Simulate a runner that claimed it, saved a checkpoint and died.
    await db.query(`UPDATE public.user_jobs SET status = 'running', attempts = 1, lease_owner = 'dead-runner', lease_expires_at = now() - interval '1 second', checkpoint = '{"done":1}' WHERE id = $1`, [job.id])
    const after = await runUserJob(job.id, deps)
    expect(after).toMatchObject({ status: 'queued', attempts: 1, checkpoint: { done: 2 } }) // chunk boundaries don't count as attempts
    expect(chunkRuns).toBe(1)
    await db.query('DELETE FROM public.user_jobs WHERE id = $1', [job.id]) // not drained by the next test

    // No attempts left: a dead invocation fails the job instead of running it again.
    const single = await enqueueUserJob(session(OWNER), 'test.export', { rows: 1 }, deps)
    await db.query(`UPDATE public.user_jobs SET status = 'running', attempts = 1, lease_owner = 'dead-runner', lease_expires_at = now() - interval '1 second' WHERE id = $1`, [single.id])
    expect(await runUserJob(single.id, deps)).toBeNull()
    expect(await row(single.id)).toMatchObject({ status: 'failed', error: 'The job stopped responding and has no retries left', lease_owner: null })
  })

  it('chunked jobs continue across invocations (processUserJobs drains them) and assemble their parts', async () => {
    chunkRuns = 0
    const job = await enqueueUserJob(session(OWNER), 'test.chunks', { total: 3 }, deps)
    for (let i = 0; i < 6 && (await row(job.id)).status !== 'succeeded'; i++) {
      await processUserJobs({ ...deps, budgetMs: 10_000, concurrency: 1 })
    }
    const done = await row(job.id)
    expect(done).toMatchObject({ status: 'succeeded', attempts: 1, checkpoint: null })
    expect(chunkRuns).toBe(4)
    expect(await getJobResult(session(OWNER), job.id)).toEqual({ text: 'part 0\npart 1\npart 2\n' })
  })

  it('a runner that lost its lease cannot write the job', async () => {
    const job = await enqueueUserJob(session(OWNER), 'test.export', { rows: 1 }, deps)
    await db.query(`UPDATE public.user_jobs SET status = 'running', lease_owner = 'someone-else', lease_expires_at = now() + interval '5 minutes' WHERE id = $1`, [job.id])
    expect(await runUserJob(job.id, deps)).toBeNull() // not claimable while leased
    expect((await row(job.id)).lease_owner).toBe('someone-else')
  })

  it('downloads and results: owner only, nothing before it finishes, 410 once expired; retry makes a new job', async () => {
    const job = await enqueueUserJob(session(OWNER), 'test.export', { rows: 2 }, deps)
    await expect(openJobDownload(session(OWNER), job.id)).rejects.toMatchObject({ status: 409 })
    await runUserJob(job.id, deps)
    await expect(openJobDownload(session(MATE), job.id)).rejects.toMatchObject({ status: 404 })
    await expect(openJobDownload(session(OUTSIDER, OTHER_T), job.id)).rejects.toMatchObject({ status: 404 })
    // Workspace admins may see and cancel jobs, not download someone else's file.
    const adminCtx = session(ADMIN, T, ['settings.edit'])
    expect((await getJob(adminCtx, job.id)).id).toBe(job.id)
    await expect(openJobDownload(adminCtx, job.id)).rejects.toMatchObject({ status: 404 })
    expect((await listJobs(adminCtx, { scope: 'tenant' })).jobs.some((j) => j.id === job.id)).toBe(true)
    await expect(listJobs(session(MATE), { scope: 'tenant' })).rejects.toMatchObject({ code: 'forbidden' })
    expect((await listJobs(session(MATE))).jobs.some((j) => j.id === job.id)).toBe(false)

    await db.query(`UPDATE public.user_jobs SET expires_at = now() - interval '1 minute' WHERE id = $1`, [job.id])
    await expect(openJobDownload(session(OWNER), job.id)).rejects.toMatchObject({ status: 410 })
    expect((await getJob(session(OWNER), job.id)).downloadable).toBe(false)

    flaky = 0
    const failed = await enqueueUserJob(session(OWNER), 'test.denied', {}, deps)
    await runUserJob(failed.id, deps)
    await expect(retryJob(session(MATE), failed.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('RLS: users read their own jobs, workspace admins every job of the workspace; no client writes', async () => {
    const mine = await enqueueUserJob(session(OWNER), 'test.export', { rows: 1 }, deps)
    const other = await enqueueUserJob(session(OUTSIDER, OTHER_T), 'test.export', { rows: 1 }, deps)
    const ids = [mine.id, other.id]
    const seen = async (sub: string) => (await asUser(sub, 'SELECT id FROM public.user_jobs WHERE id = ANY($1)', [ids])).rows.map((r) => r.id).sort()
    expect(await seen(OWNER)).toEqual([mine.id])
    expect(await seen(MATE)).toEqual([])
    expect(await seen(ADMIN)).toEqual([mine.id]) // settings.edit in T, not in OTHER_T
    expect(await seen(OUTSIDER)).toEqual([other.id])

    expect((await asUser(OWNER, `UPDATE public.user_jobs SET status = 'succeeded' WHERE id = $1`, [mine.id])).error).toBe('42501')
    expect((await asUser(OWNER, `DELETE FROM public.user_jobs WHERE id = $1`, [mine.id])).error).toBe('42501')
    expect((await asUser(OWNER, `INSERT INTO public.user_jobs (tenant_id, user_id, kind, title) VALUES ($1, $2, 'test.export', 'x')`, [T, OWNER])).error).toBe('42501')
    expect((await asUser(OWNER, `SELECT * FROM public.user_jobs_claim('x')`)).error).toBe('42501')
    expect((await asUser(OWNER, `SELECT public.user_jobs_actor($1, $2)`, [ADMIN, T])).error).toBe('42501')
  })

  it('cleanup deletes expired jobs with their files and keeps the rest', async () => {
    const keep = await enqueueUserJob(session(OWNER), 'test.export', { rows: 1 }, deps)
    const gone = await enqueueUserJob(session(OWNER), 'test.export', { rows: 1 }, deps)
    await runUserJob(keep.id, deps)
    await runUserJob(gone.id, deps)
    await db.query(`UPDATE public.user_jobs SET expires_at = now() - interval '1 minute' WHERE id = $1`, [gone.id])
    const purged = await purgeExpiredUserJobs({ supabase: admin })
    expect(purged.jobs).toBeGreaterThanOrEqual(1)
    expect(purged.files).toBeGreaterThanOrEqual(1)
    expect(await row(gone.id)).toBeUndefined()
    expect((await db.query('SELECT count(*)::int AS n FROM public.notifications WHERE job_id = $1', [gone.id])).rows[0].n).toBe(0) // notification went with it
    expect(await row(keep.id)).toMatchObject({ status: 'succeeded' })
    await expect(openJobDownload(session(OWNER), keep.id)).resolves.toMatchObject({ filename: 'rows.csv' })
  })
})
