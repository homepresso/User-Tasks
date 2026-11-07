/**
 * AAD (Entra ID) group User Tasks end to end against a LOCAL Supabase stack:
 * the engine resolves the group's members through Microsoft Graph (mocked
 * fetch; database calls pass through), maps them to workspace members and
 * creates
 *  - claim: one unassigned task with candidate rows → Claim in the queue,
 *    the first claim wins and the other candidates drop out;
 *  - everyone: one collaborative task (lead + collaborators, the node's
 *    completion rule);
 *  - Entra ID disconnected: the task is created unassigned, with a warning.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/aad-group-assignment-db.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ServiceContext } from '@/lib/services/context'
import { createClient } from './helpers/db-test-client'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const TENANT = 'aad00000-0000-4000-8000-0000000000a1'
const WF_CLAIM = 'aad00000-0000-4000-8000-0000000000c1'
const WF_EVERYONE = 'aad00000-0000-4000-8000-0000000000c2'
const ALICE = 'aad0b001-0000-4000-8000-0000000000b1'
const BOB = 'aad0b002-0000-4000-8000-0000000000b2'
const CAROL = 'aad0b003-0000-4000-8000-0000000000b3'
const USERS = [ALICE, BOB, CAROL]
const STAMP = Date.now().toString(36)
const EMAIL: Record<string, string> = { [ALICE]: `alice.${STAMP}@aad.test`, [BOB]: `bob.${STAMP}@aad.test`, [CAROL]: `carol.${STAMP}@aad.test` }

let supabase: SupabaseClient
vi.mock('@/lib/cron-auth', async (orig) => ({ ...(await orig() as object), createServiceClient: () => supabase }))

const realFetch = globalThis.fetch
/** Graph: the group's transitive members — Alice (linked), Bob (by email), Carol (no membership here), a device. */
const graphFetch = vi.fn(async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (url.startsWith('https://login.microsoftonline.com/')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
  if (url.startsWith('https://graph.microsoft.com/')) {
    return new Response(JSON.stringify({ value: [
      { '@odata.type': '#microsoft.graph.user', id: 'ext-alice', mail: 'someone-else@aad.test' },
      { '@odata.type': '#microsoft.graph.user', id: 'ext-bob', mail: EMAIL[BOB].toUpperCase() },
      { '@odata.type': '#microsoft.graph.user', id: 'ext-carol', mail: EMAIL[CAROL] },
      { '@odata.type': '#microsoft.graph.device', id: 'dev-1' },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return realFetch(input, init)
})

function userTaskNodes(config: Record<string, unknown>) {
  return [
    { id: 'start', type: 'manual', label: 'Start', config: {} },
    { id: 'approve', type: 'user_task', label: 'Approve', config: { task_title: 'Approve invoice', outcomes: ['Approved', 'Rejected'], assignment_type: 'aad_group', aad_group_id: 'grp-finance', aad_group_name: 'Finance approvers', ...config } },
  ]
}
const edges = [{ id: 'e1', source: 'start', target: 'approve' }]

describe.skipIf(!DB_URL)('engine: AAD group User Tasks', () => {
  const db = new Client({ connectionString: DB_URL })
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as any[]
  const ctx = (actorId: string): ServiceContext =>
    ({ supabase, db: supabase, tenantId: TENANT, actorId, permissions: new Set(['tasks.view_own', 'tasks.complete']), authKind: 'api_key', source: 'api' } as ServiceContext)

  async function cleanup() {
    const personal = (await q('SELECT tenant_id FROM public.users WHERE id = ANY($1::uuid[])', [USERS]).catch(() => [])).map((r: any) => r.tenant_id)
    for (const table of ['task_assignees', 'notifications', 'lifecycle_events', 'workflow_logs', 'workflow_queue', 'workflow_runs', 'tasks', 'workflow_versions', 'workflows', 'directory_links', 'tenant_connectors', 'object_audit_log']) {
      await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [TENANT]).catch(() => undefined)
    }
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [USERS])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [[TENANT, ...personal.filter((t: string | null) => t && t !== TENANT)]])
  }

  beforeAll(async () => {
    await db.connect()
    await cleanup()
    supabase = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    vi.stubGlobal('fetch', graphFetch)
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'AAD groups', 'aad-groups-${STAMP}')`, [TENANT])
    for (const user of USERS) {
      await q(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [user, EMAIL[user]])
    }
    for (const user of [ALICE, BOB]) {
      await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [user, TENANT])
    }
    // Bob queues everything for acceptance; Alice adds tasks straight away.
    await q(`UPDATE public.users SET preferences = coalesce(preferences, '{}'::jsonb) || '{"queue_rules": {"default": "queue", "rules": []}}' WHERE id = $1`, [BOB])
    await q(`UPDATE public.users SET preferences = coalesce(preferences, '{}'::jsonb) || '{"queue_rules": {"default": "add", "rules": []}}' WHERE id = $1`, [ALICE])
    await q(`INSERT INTO public.tenant_connectors (tenant_id, connector_key, display_name, config, credentials, is_enabled)
             VALUES ($1, 'entra_directory', 'Entra ID Directory', '{"provider":"entra","sync_groups":false}', '{"tenant_id":"tid","client_id":"cid","client_secret":"sec"}', true)`, [TENANT])
    await q(`INSERT INTO public.directory_links (tenant_id, provider, object_type, external_id, local_id) VALUES ($1, 'entra', 'user', 'ext-alice', $2)`, [TENANT, ALICE])
    for (const [id, config] of [[WF_CLAIM, {}], [WF_EVERYONE, { aad_group_mode: 'everyone', completion_rule: 'all_complete' }]] as const) {
      await q(`INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type, nodes, edges) VALUES ($1, $2, 'AAD', true, 'manual', $3::jsonb, $4::jsonb)`,
        [id, TENANT, JSON.stringify(userTaskNodes(config)), JSON.stringify(edges)])
    }
  })

  beforeEach(async () => {
    const { clearEntraGroupCaches } = await import('@/lib/directory-sync/entra-groups')
    clearEntraGroupCaches()
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    await cleanup().catch(() => undefined)
    await db.end()
  })

  async function run(workflowId: string) {
    const { executeWorkflow } = await import('@/lib/workflow-engine')
    const result = await executeWorkflow(workflowId, undefined, false, {}, undefined, undefined, undefined, { supabase })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe('waiting_for_event')
    const [task] = await q('SELECT * FROM public.tasks WHERE tenant_id = $1 AND workflow_run_id = $2', [TENANT, result.run_id])
    const assignees = await q('SELECT user_id, role, acceptance_status FROM public.task_assignees WHERE task_id = $1 ORDER BY role, user_id', [task.id])
    const logs = (await q('SELECT level, message FROM public.workflow_logs WHERE tenant_id = $1 AND run_id = $2', [TENANT, result.run_id])).map((l: any) => `${l.level}: ${l.message}`).join('\n')
    return { result, task, assignees, logs }
  }

  it('claim: candidates queue it, the first claim wins', async () => {
    const { task, assignees, logs } = await run(WF_CLAIM)
    expect(task).toMatchObject({ assignee_id: null, assigned_team_id: null, assignment_type: 'aad_group', assignment_mode: 'team', status: 'todo' })
    expect(task.metadata.completion_rule).toBe('first_response')
    expect(task.metadata.aad_group).toMatchObject({ group_id: 'grp-finance', mode: 'claim', member_count: 3, assigned_count: 2, skipped_count: 1 })
    expect(assignees).toEqual([
      { user_id: ALICE, role: 'candidate', acceptance_status: 'pending' },
      { user_id: BOB, role: 'candidate', acceptance_status: 'pending' },
    ].sort((a, b) => a.user_id.localeCompare(b.user_id)))
    expect(logs).toMatch(/skipped 1 of 3 members \(1 not members of this workspace\)/)
    const notified = (await q('SELECT user_id, title FROM public.notifications WHERE task_id = $1', [task.id]))
    expect(notified.map((n: any) => n.user_id).sort()).toEqual([ALICE, BOB].sort())
    expect(notified[0].title).toBe('Task available to claim: Approve invoice')

    const home = await import('@/lib/services/home')
    const queue = await home.listQueueTasks(ctx(ALICE), {}, { limit: 50, offset: 0 })
    expect(queue.tasks.find((t) => t.id === task.id)?.action).toBe('claim')
    await expect(home.claimTask(ctx(CAROL), task.id)).rejects.toThrow(/group/)

    expect(await home.claimTask(ctx(BOB), task.id)).toEqual({ claimed: true, task_id: task.id })
    await expect(home.claimTask(ctx(ALICE), task.id)).rejects.toThrow(/already claimed/)
    const [claimed] = await q('SELECT assignee_id, acceptance_status FROM public.tasks WHERE id = $1', [task.id])
    expect(claimed).toEqual({ assignee_id: BOB, acceptance_status: 'accepted' })
    expect(await q('SELECT user_id, role, acceptance_status FROM public.task_assignees WHERE task_id = $1', [task.id]))
      .toEqual([{ user_id: BOB, role: 'lead', acceptance_status: 'accepted' }])
    const after = await home.listQueueTasks(ctx(ALICE), {}, { limit: 50, offset: 0 })
    expect(after.tasks.some((t) => t.id === task.id)).toBe(false)
  })

  it('everyone: one collaborative task, each member queued by their own rules', async () => {
    const { task, assignees } = await run(WF_EVERYONE)
    expect(task).toMatchObject({ assignee_id: ALICE, assignment_type: 'aad_group', assignment_mode: 'collaborative' })
    expect(task.metadata.completion_rule).toBe('all_complete')
    const byUser = Object.fromEntries(assignees.map((a: any) => [a.user_id, a]))
    expect(byUser[ALICE]).toMatchObject({ role: 'lead', acceptance_status: 'accepted' })
    expect(byUser[BOB]).toMatchObject({ role: 'collaborator', acceptance_status: 'pending' })
  })

  it('Entra ID disconnected: created unassigned with a warning', async () => {
    await q(`UPDATE public.tenant_connectors SET is_enabled = false, credentials = '{}' WHERE tenant_id = $1`, [TENANT])
    graphFetch.mockClear()
    const { task, assignees, logs } = await run(WF_CLAIM)
    expect(task).toMatchObject({ assignee_id: null, assigned_team_id: null, assignment_type: 'aad_group' })
    expect(task.metadata.aad_group.fallback).toBe('unassigned')
    expect(assignees).toEqual([])
    expect(logs).toMatch(/warn: AAD group assignment: Entra ID is not configured.*created unassigned/)
    expect(graphFetch.mock.calls.some(([u]) => String(u).includes('graph.microsoft.com'))).toBe(false)
  })
})
