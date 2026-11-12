/**
 * Tenant isolation of every dashboard read (providers phase 4), against the
 * real schema and RLS policies. Two workspaces (A, B) with rows in the tables
 * the reads touch; user `a` is an owner of A only. Every read in the
 * registry is run as `a` with every argument shape it accepts filled from
 * B's row ids (and with no arguments when it takes none): no result may
 * contain a B id or B's marker text. The same reads with A's ids must find
 * A's rows (so the check isn't vacuous).
 *
 * The reads run on a pg-query client bound to `a`'s identity (role
 * authenticated + JWT claims, as PostgREST and the postgres provider do)
 * over this test's single connection, inside one transaction that is rolled
 * back: pg-query's per-request BEGIN/COMMIT become savepoints.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/ui-reads-isolation-db.test.ts
 */
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client, type Pool } from 'pg'
import type { z } from 'zod'
import { createPgQuery } from '@user-tasks/pg-query'
import { runUiRead, UI_READS } from '@/lib/services/ui-reads'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows and zod shapes */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
/** Reads whose answer repeats their text input (see the leak check). */
const ECHO_READS = new Set(['forms.systemNameCheck', 'forms.systemNameSuggest', 'settings.workspaceAddressCheck'])

type K = 'A' | 'B'
function uid(key: string): string {
  const h = createHash('md5').update(`ui-reads-isolation:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const TENANT: Record<K, string> = { A: uid('tenant:A'), B: uid('tenant:B') }
const USER: Record<K, string> = { A: uid('user:a'), B: uid('user:b') }
const TRACE: Record<K, string> = { A: uid('trace:A'), B: uid('trace:B') }
const MARK: Record<K, string> = { A: 'ISO-MARK-A', B: 'ISO-MARK-B' }
const id = (table: string, k: K) => uid(`${table}:${k}`)

/** One row per tenant (uuid `id` added from the table name). */
const SPECS: Array<{ table: string; make: (k: K) => Record<string, unknown>; noId?: boolean }> = [
  { table: 'teams', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} team` }) },
  { table: 'tasks', make: (k) => ({ tenant_id: TENANT[k], title: `${MARK[k]} task`, assignee_id: USER[k], assigner_id: USER[k] }) },
  { table: 'workflows', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} wf` }) },
  { table: 'workflow_versions', make: (k) => ({ workflow_id: id('workflows', k), tenant_id: TENANT[k], version_number: 1, trigger_type: 'manual' }) },
  { table: 'workflow_runs', make: (k) => ({ workflow_id: id('workflows', k), tenant_id: TENANT[k] }) },
  { table: 'workflow_logs', make: (k) => ({ workflow_id: id('workflows', k), run_id: id('workflow_runs', k), tenant_id: TENANT[k], message: `${MARK[k]} log` }) },
  { table: 'workflow_queue', make: (k) => ({ workflow_id: id('workflows', k), tenant_id: TENANT[k], trigger_type: 'manual' }) },
  { table: 'workflow_webhooks', make: (k) => ({ workflow_id: id('workflows', k), tenant_id: TENANT[k], slug: `iso-${k}`, api_key_hash: `iso-h-${k}`, api_key_prefix: 'p' }) },
  { table: 'integrations', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} int`, type: 'http', is_active: true }) },
  { table: 'integration_references', make: (k) => ({ integration_id: id('integrations', k), tenant_id: TENANT[k], name: `${MARK[k]} ref` }) },
  { table: 'integration_call_logs', make: (k) => ({ tenant_id: TENANT[k], integration_id: id('integrations', k), reference_id: id('integration_references', k), trace_id: TRACE[k] }) },
  { table: 'integration_objects', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} obj` }) },
  { table: 'agents', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} agent` }) },
  { table: 'agent_runs', make: (k) => ({ tenant_id: TENANT[k], agent_id: id('agents', k), input_message: `${MARK[k]} input`, trace_id: TRACE[k] }) },
  { table: 'custom_tables', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} table`, slug: `iso-${k.toLowerCase()}` }) },
  { table: 'custom_table_rows', make: (k) => ({ tenant_id: TENANT[k], table_id: id('custom_tables', k), data: { note: MARK[k] } }) },
  { table: 'custom_workflow_activities', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} act`, key: `iso-${k}`, source_code: 'x' }) },
  { table: 'decision_tables', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} dt` }) },
  { table: 'email_templates', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} tpl` }) },
  { table: 'reports', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} report`, created_by: USER[k], is_shared: true }) },
  { table: 'retention_policies', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} rp`, policy_mode: 'keep_forever' }) },
  { table: 'roles', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} role`, slug: `iso-${k.toLowerCase()}` }) },
  { table: 'api_keys', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} key`, key_prefix: 'p', key_hash: `iso-${k}` }) },
  { table: 'mcp_servers', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} mcp`, url: 'http://x' }) },
  { table: 'invitations', make: (k) => ({ tenant_id: TENANT[k], email: `iso-${k.toLowerCase()}@iso.test`, invited_by: USER[k] }) },
  { table: 'lifecycle_events', make: (k) => ({ tenant_id: TENANT[k], task_id: id('tasks', k), event_type: 'created', metadata: { note: MARK[k] } }) },
  { table: 'object_audit_log', make: (k) => ({ tenant_id: TENANT[k], object_type: 'workflow', object_id: id('workflows', k), action: 'update', summary: MARK[k] }) },
  { table: 'object_permissions', make: (k) => ({ tenant_id: TENANT[k], object_type: 'workflow', object_id: id('workflows', k), user_id: USER[k] }) },
  { table: 'notifications', make: (k) => ({ user_id: USER[k], tenant_id: TENANT[k], type: 'info', title: `${MARK[k]} n` }) },
  { table: 'tag_definitions', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} tag` }) },
  { table: 'log_destinations', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} dest`, type: 'webhook' }) },
  // Reusable task forms (20261115000000): forms.list / get / versions / themes / tableColumns.
  // (jsonb arrays go in as JSON text: pg sends a JS array as a Postgres array.)
  { table: 'forms', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} form`, fields: JSON.stringify([{ key: 'note', label: `${MARK[k]} field`, type: 'text' }]) }) },
  { table: 'form_versions', make: (k) => ({ tenant_id: TENANT[k], form_id: id('forms', k), version: 1, name: `${MARK[k]} form v1`, fields: JSON.stringify([{ key: 'note', label: `${MARK[k]} field`, type: 'text' }]) }) },
  { table: 'form_themes', make: (k) => ({ tenant_id: TENANT[k], name: `${MARK[k]} theme`, overrides: { radius: 4 } }) },
  // Task tracker → Following (20261226000000): each user follows their own workspace's task.
  { table: 'task_followers', noId: true, make: (k) => ({ tenant_id: TENANT[k], user_id: USER[k], task_id: id('tasks', k) }) },
  // Invite, read only (20270105000000): each workspace's task shared with its team (tasks.viewers, the tracker's Shared with me).
  { table: 'task_viewers', make: (k) => ({ tenant_id: TENANT[k], task_id: id('tasks', k), principal_type: 'team', principal_id: id('teams', k), invited_by: USER[k], note: `${MARK[k]} invite` }) },
]

/**
 * A pg Pool stand-in over one connection that is already inside the test's
 * transaction: requests run one at a time, BEGIN/COMMIT/ROLLBACK become a
 * savepoint (always rolled back — the reads write nothing, and this resets
 * the role and claims each request sets locally).
 */
function savepointPool(client: Client): Pool {
  let chain: Promise<unknown> = Promise.resolve()
  // One statement at a time on the connection (introspection runs several at once).
  let statements: Promise<unknown> = Promise.resolve()
  const query = (text: any, values?: any) => {
    const next = statements.then(() => client.query(text, values))
    statements = next.catch(() => {})
    return next
  }
  return {
    query,
    async connect() {
      let release!: () => void
      const turn = chain.then(() => undefined)
      chain = turn.then(() => new Promise<void>((r) => { release = r }))
      await turn
      return {
        query(text: any, values?: any) {
          if (typeof text === 'string' && /^BEGIN\b/.test(text)) return query('SAVEPOINT pgq')
          if (text === 'COMMIT' || text === 'ROLLBACK') return query('ROLLBACK TO SAVEPOINT pgq; RELEASE SAVEPOINT pgq')
          return query(text, values)
        },
        release: () => release(),
      }
    },
  } as unknown as Pool
}

describe.skipIf(!DB_URL)('dashboard reads: tenant isolation (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })
  let ctx: ServiceContext
  const bIds = new Set<string>()
  const aIds = new Set<string>()

  beforeAll(async () => {
    // A few reads also use the service client for service-role-only tables
    // (e.g. forms.list → form_design_drafts for "Draft changes"); it reads
    // its URL and key from the environment, so set them for the local stack
    // instead of depending on what an earlier file in this worker left there.
    // (With DATABASE_URL set, the postgres provider serves it instead.)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', API_URL)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY)
    await db.connect()
    await db.query('BEGIN')
    for (const k of ['A', 'B'] as const) {
      await db.query('INSERT INTO public.tenants (id, name, slug) VALUES ($1, $2, $3)', [TENANT[k], `${MARK[k]} ws`, `ui-reads-iso-${k.toLowerCase()}`])
      // The auth trigger creates the users row (and a personal workspace).
      await db.query(
        `INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [USER[k], `iso-${k.toLowerCase()}@iso.test`],
      )
      await db.query('DELETE FROM public.user_memberships WHERE user_id = $1', [USER[k]])
      await db.query('UPDATE public.users SET tenant_id = $2, current_tenant_id = $2, display_name = $3 WHERE id = $1', [USER[k], TENANT[k], `${MARK[k]} user`])
      await db.query('INSERT INTO public.user_memberships (user_id, tenant_id, role, is_home) VALUES ($1, $2, $3, true)', [USER[k], TENANT[k], 'owner'])
    }
    for (const spec of SPECS) {
      for (const k of ['A', 'B'] as const) {
        const values: Record<string, unknown> = spec.noId ? spec.make(k) : { id: id(spec.table, k), ...spec.make(k) }
        const cols = Object.keys(values)
        await db.query('SAVEPOINT row')
        try {
          await db.query(`INSERT INTO public.${spec.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(values))
          await db.query('RELEASE SAVEPOINT row')
          if (typeof values.id === 'string') (k === 'A' ? aIds : bIds).add(values.id)
        } catch (error) {
          await db.query('ROLLBACK TO SAVEPOINT row')
          throw new Error(`fixture ${spec.table}: ${(error as Error).message}`)
        }
      }
    }
    bIds.add(TENANT.B).add(USER.B).add(TRACE.B)
    aIds.add(TENANT.A).add(TRACE.A)

    const pgq = createPgQuery({ pool: savepointPool(db), maxRows: 1000 })
    const client = pgq.client({ role: 'authenticated', claims: { sub: USER.A, role: 'authenticated', aud: 'authenticated' } })
    ctx = { db: client as any, supabase: client as any, tenantId: TENANT.A, actorId: USER.A, permissions: null, authKind: 'session', source: 'ui' }
  }, 60_000)

  afterAll(async () => {
    vi.unstubAllEnvs()
    await db.query('ROLLBACK').catch(() => {})
    await db.end()
  })

  /** Every argument object the read's schema accepts, filled with one of `ids`. */
  function argSets(schema: z.ZodType, ids: string[]): unknown[] {
    const out: unknown[] = []
    if (schema.safeParse(undefined).success) out.push(undefined)
    let obj: any = schema
    while (obj && !obj.shape && typeof obj.unwrap === 'function') obj = obj.unwrap()
    const shape: Record<string, z.ZodType> | undefined = obj?.shape
    if (!shape) return out
    for (const value of ids) {
      const args: Record<string, unknown> = {}
      let usable = true
      for (const [key, field] of Object.entries(shape)) {
        const candidate = [value, [value], 0, false].find((c) => field.safeParse(c).success)
        if (candidate !== undefined) args[key] = candidate
        else if (!field.safeParse(undefined).success) { usable = false; break }
      }
      if (usable && schema.safeParse(args).success) out.push(args)
    }
    return out
  }

  async function runAll(ids: Set<string>) {
    const results: Array<{ name: string; args: unknown; json: string }> = []
    for (const [name, def] of Object.entries(UI_READS)) {
      for (const args of argSets((def as any).args, [...ids])) {
        const result = await runUiRead(ctx, { name, args })
        results.push({ name, args, json: JSON.stringify(result.ok ? result.data : null) ?? 'null' })
      }
    }
    return results
  }

  it('no read returns another workspace\'s rows, by any id', async () => {
    const leaks = (await runAll(bIds))
      // Reads that echo a free-text argument back (a system name check / suggestion
      // normalises the text it was given) contain the id only because it was the
      // input; they're still checked for B's marked rows.
      .filter(({ name, json }) => json.includes(MARK.B) || (!ECHO_READS.has(name) && [...bIds].some((b) => json.includes(b))))
      .map(({ name, args }) => `${name} ${JSON.stringify(args)}`)
    expect(leaks).toEqual([])
  }, 300_000)

  it('the same reads find the caller\'s own workspace rows (the check is not vacuous)', async () => {
    const found = new Set((await runAll(aIds)).filter(({ json }) => json.includes(MARK.A)).map(({ name }) => name))
    // A broad sample of areas must see A's rows.
    expect(found.size).toBeGreaterThan(10)
    // The forms library reads see the caller's forms, versions, themes and tables.
    for (const name of ['forms.list', 'forms.get', 'forms.versions', 'forms.themes', 'forms.tableColumns']) expect(found, name).toContain(name)
    // Task tracker → Following: the caller's followed task through RLS.
    expect(found, 'tasks.following').toContain('tasks.following')
  }, 300_000)
})
