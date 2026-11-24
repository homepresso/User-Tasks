import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from './helpers/fake-supabase'

/**
 * Instance admin ("cloud admin") operations: only instance admins get
 * anything (everyone else, a workspace owner included, gets 404 / 403), no
 * workspace content leaves (response shapes are the declared columns), and
 * every on-behalf action needs a reason and is recorded in both trails.
 */

vi.mock('@/lib/admin/infrastructure', () => ({ viewerCanSeeInfrastructure: vi.fn(async () => false) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterMs: 0 })), resetRateLimit: vi.fn(async () => undefined) }))
vi.mock('@/lib/api-auth-cache', () => ({ invalidateCredentialCache: vi.fn(async () => undefined) }))
vi.mock('@/lib/invitations', () => ({
  INVITATION_TTL_MS: 7 * 86_400_000,
  newInvitationToken: () => 'tok-NEW-SECRET',
  sendInvitationEmail: vi.fn(async () => ({ success: true })),
}))
vi.mock('@/lib/licensing/admin', () => ({
  listTenantEntitlements: vi.fn(async () => []),
  grantTenantEntitlement: vi.fn(async () => ({})),
}))
vi.mock('@/lib/licensing/paused-runs', () => ({ resumeLicencePausedRuns: vi.fn(async () => ({ resumed: 0, failed: 0, remaining: 0 })) }))
const authState = vi.hoisted(() => ({
  unlockAccount: vi.fn(async () => ({ changed: true, kind: 'builtin', cleared: ['failed sign-in lockout'] })),
  revokeSessions: vi.fn(async () => 2),
  sendPasswordReset: vi.fn(async () => undefined),
  accountStates: vi.fn(async () => new Map()),
  lockedAccounts: vi.fn(async () => []),
  authKind: vi.fn(async () => 'builtin'),
}))
vi.mock('@/lib/services/instance-admin/auth-state', () => authState)
vi.mock('@/lib/providers/db', () => ({ getServiceDb: () => { throw new Error('tests inject the service db') } }))

import { setInstanceAdminCheckForTests, setInstanceServiceDbForTests, requireInstanceAdmin, eligibleCaller, ACCESS_MESSAGE } from '@/lib/services/instance-admin/access'
import { readInstanceDataset, runInstanceAction } from '@/lib/services/instance-admin'
import { resetInstanceActionsForTests } from '@/lib/services/instance-admin/actions'
import { resetInstanceStatsForTests } from '@/lib/services/instance-admin/stats'
import { runInstanceStep } from '@/lib/services/instance-admin/workflow-step'
import { INSTANCE_ACTIONS, INSTANCE_DATASETS, INSTANCE_DATASET_COLUMNS, SUPPORT_ACTOR_LABEL } from '@/lib/instance-admin/schema'
import { ServiceError, type ServiceContext } from '@/lib/services/context'
import { auditActorLabel, auditActionLabel } from '@/lib/audit-labels'
import { ruleActionAllowed } from '@/lib/apps/governance'

const ADMIN = '11111111-1111-4111-8111-111111111111'
const OWNER = '22222222-2222-4222-8222-222222222222'
const MEMBER = '33333333-3333-4333-8333-333333333333'
const HOME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ACME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OWNER_ROLE = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01'
const MEMBER_ROLE = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02'
const ADMIN_ROLE = 'cccccccc-cccc-4ccc-8ccc-cccccccccc03'
const INVITE = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01'
const SECRET = 'SECRET-CONTENT-MUST-NOT-LEAK'

const now = new Date().toISOString()
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

function seed(): FakeSupabase {
  const fake = createFakeSupabase({
    tenants: [
      { id: HOME, name: 'Cloud HQ', slug: 'cloud-hq', plan: 'business_team', industry: null, company_size: null, created_at: daysAgo(90), deleted_at: null, settings: { secret_setting: SECRET } },
      { id: ACME, name: 'Acme Robotics', slug: 'acme', plan: 'personal_pro', industry: 'Manufacturing', company_size: '11-50', created_at: daysAgo(10), deleted_at: null, branding: { css: SECRET } },
    ],
    users: [
      { id: ADMIN, email: 'ops@cloud.example', display_name: 'Ops Admin', tenant_id: HOME, last_seen_at: now, created_at: daysAgo(90), deleted_at: null, preferences: { note: SECRET } },
      { id: OWNER, email: 'owner@acme.example', display_name: 'Ada Owner', tenant_id: ACME, last_seen_at: daysAgo(1), created_at: daysAgo(10), deleted_at: null, description: SECRET },
      { id: MEMBER, email: 'member@acme.example', display_name: 'Max Member', tenant_id: ACME, last_seen_at: null, created_at: daysAgo(3), deleted_at: null },
    ],
    user_memberships: [
      { id: 'm1', user_id: ADMIN, tenant_id: HOME, is_active: true, is_home: true, joined_at: daysAgo(90) },
      { id: 'm2', user_id: OWNER, tenant_id: ACME, is_active: true, is_home: true, joined_at: daysAgo(10) },
      { id: 'm3', user_id: MEMBER, tenant_id: ACME, is_active: true, is_home: true, joined_at: daysAgo(3) },
    ],
    roles: [
      { id: OWNER_ROLE, tenant_id: ACME, slug: 'owner', is_system: true },
      { id: MEMBER_ROLE, tenant_id: ACME, slug: 'member', is_system: true },
      { id: ADMIN_ROLE, tenant_id: ACME, slug: 'admin', is_system: true },
    ],
    user_roles: [
      { id: 'ur1', tenant_id: ACME, user_id: OWNER, role_id: OWNER_ROLE },
      { id: 'ur2', tenant_id: ACME, user_id: MEMBER, role_id: MEMBER_ROLE },
    ],
    invitations: [
      { id: INVITE, tenant_id: ACME, email: 'new@acme.example', role: 'member', invited_by: OWNER, token: 'tok-OLD-SECRET', accepted_at: null, expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_at: daysAgo(1) },
    ],
    workflow_runs: [
      { id: 'r1', tenant_id: ACME, workflow_id: 'w1', status: 'failed', started_at: daysAgo(1), error: SECRET, title: SECRET },
      { id: 'r2', tenant_id: ACME, workflow_id: 'w1', status: 'completed', started_at: daysAgo(2), title: SECRET },
    ],
    tasks: [{ id: 't1', tenant_id: ACME, status: 'todo', title: SECRET, description: SECRET, created_at: daysAgo(1), deleted_at: null }],
    form_submissions: [{ id: 's1', tenant_id: ACME, data: { answer: SECRET } }],
    custom_table_rows: [{ id: 'row1', tenant_id: ACME, data: { cell: SECRET } }],
    object_audit_log: [{ id: 'a1', tenant_id: ACME, actor_id: OWNER, object_type: 'form', object_id: 'f1', action: 'update', summary: SECRET, diff: { x: { before: SECRET, after: SECRET } }, metadata: { via: 'ui', secret: SECRET }, created_at: daysAgo(1) }],
    agent_runs: [{ id: 'ag1', tenant_id: ACME, model: 'claude', status: 'failed', input_tokens: 10, output_tokens: 5, total_tokens: 15, cost_amount: 0.25, cost_currency: 'USD', started_at: daysAgo(1), input: SECRET, output: SECRET }],
    assistant_usage: [],
    api_keys: [{ id: 'k1', tenant_id: ACME, is_revoked: false, last_used_at: daysAgo(1), key_hash: SECRET }],
    instance_admin_audit: [],
    tenant_entitlements: [],
  })
  return fake
}

let fake: FakeSupabase
const ctxFor = (userId: string | null, extra: Partial<ServiceContext> = {}): ServiceContext => ({
  supabase: fake.client as never, tenantId: userId === OWNER ? ACME : HOME, actorId: userId, permissions: null, authKind: 'session', source: 'ui', ...extra,
})

beforeEach(() => {
  fake = seed()
  setInstanceServiceDbForTests(() => fake.client as never)
  // The instance admin list: ops@cloud.example only (never the workspace owner).
  setInstanceAdminCheckForTests(async (v) => v.email === 'ops@cloud.example')
  resetInstanceActionsForTests()
  resetInstanceStatsForTests()
})

const REASON = { reason: 'Customer asked by email (ticket 1042)' }
const inputsFor: Record<string, Record<string, unknown>> = {
  unlock_user: { user_id: MEMBER, ...REASON },
  send_password_reset: { user_id: MEMBER, ...REASON },
  force_sign_out: { user_id: MEMBER, ...REASON },
  invite_user: { workspace_id: ACME, email: 'fresh@acme.example', role: 'member', ...REASON },
  resend_invitation: { invitation_id: INVITE, ...REASON },
  revoke_invitation: { invitation_id: INVITE, ...REASON },
  change_role: { workspace_id: ACME, user_id: MEMBER, role: 'admin', ...REASON },
  deactivate_member: { workspace_id: ACME, user_id: MEMBER, ...REASON },
  reactivate_member: { workspace_id: ACME, user_id: MEMBER, ...REASON },
  extend_trial: { workspace_id: ACME, extension_id: 'sharepoint', days: 14, ...REASON },
  reactivate_licence: { workspace_id: ACME, extension_id: 'sharepoint', ...REASON },
  resume_paused_runs: { workspace_id: ACME, ...REASON },
}
const paramsFor = (d: string) => (d === 'workspace' || d === 'workspace_audit' || d === 'memberships' ? { workspace_id: ACME } : d === 'user' ? { user_id: MEMBER } : {})

describe('who may use it', () => {
  it('only a person: tenant keys, anonymous visitors and the in-app Agent are never considered', () => {
    expect(eligibleCaller(ctxFor(ADMIN))).toBe(ADMIN)
    expect(eligibleCaller(ctxFor(ADMIN, { keyType: 'tenant' }))).toBeNull()
    expect(eligibleCaller(ctxFor(ADMIN, { authKind: 'anonymous' }))).toBeNull()
    expect(eligibleCaller(ctxFor(ADMIN, { via: 'agent' }))).toBeNull()
    expect(eligibleCaller(ctxFor(null))).toBeNull()
  })

  it('a workspace owner gets 404 — or, in an app, the access message', async () => {
    await expect(requireInstanceAdmin(ctxFor(OWNER))).rejects.toMatchObject({ code: 'not_found', status: 404 })
    await expect(requireInstanceAdmin(ctxFor(OWNER), { refusal: 'forbidden' })).rejects.toMatchObject({ status: 403, message: ACCESS_MESSAGE })
    await expect(requireInstanceAdmin(ctxFor(ADMIN))).resolves.toMatchObject({ userId: ADMIN, email: 'ops@cloud.example' })
  })

  it.each(INSTANCE_DATASETS)('non-admins are refused reading %s', async (dataset) => {
    for (const who of [ctxFor(OWNER), ctxFor(MEMBER), ctxFor(ADMIN, { keyType: 'tenant' })]) {
      await expect(readInstanceDataset(who, dataset, paramsFor(dataset))).rejects.toMatchObject({ status: 404 })
    }
  })

  it.each(INSTANCE_ACTIONS)('non-admins are refused the %s action and nothing is written', async (action) => {
    const before = JSON.stringify(fake.tables)
    await expect(runInstanceAction(ctxFor(OWNER), action, inputsFor[action])).rejects.toMatchObject({ status: 404 })
    expect(JSON.stringify(fake.tables)).toBe(before)
    expect(fake.calls.filter((c) => c.op !== 'select')).toEqual([])
  })
})

describe('operational data only', () => {
  it.each(INSTANCE_DATASETS)('%s returns only its declared columns and no content', async (dataset) => {
    const page = await readInstanceDataset(ctxFor(ADMIN), dataset, paramsFor(dataset))
    const allowed = new Set(INSTANCE_DATASET_COLUMNS[dataset].map((c) => c.key))
    for (const row of page.rows) for (const key of Object.keys(row)) expect(allowed.has(key), `${dataset}.${key}`).toBe(true)
    const text = JSON.stringify(page)
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('tok-OLD-SECRET')
  })

  it('selects explicit columns: never invitation tokens, audit summaries / diffs, task text, submission or row data', async () => {
    for (const dataset of INSTANCE_DATASETS) await readInstanceDataset(ctxFor(ADMIN), dataset, paramsFor(dataset))
    const selects = fake.calls.filter((c) => c.op === 'select' && c.columns !== undefined)
    for (const c of selects) expect(c.columns, `${c.table}`).not.toBe('*')
    const cols = (t: string) => selects.filter((c) => c.table === t).map((c) => c.columns ?? '')
    for (const s of cols('invitations')) expect(s).not.toMatch(/\btoken\b/)
    for (const s of cols('object_audit_log')) { expect(s).not.toMatch(/\bsummary\b|\bdiff\b/); expect(s).not.toMatch(/metadata(?!->>via)/) }
    for (const s of cols('tasks')) expect(s).not.toMatch(/\btitle\b|\bdescription\b/)
    for (const s of cols('agent_runs')) expect(s).not.toMatch(/\binput\b|\boutput\b|\berror\b/)
    for (const s of cols('api_keys')) expect(s).not.toMatch(/key_hash/)
    // Content tables are only ever counted.
    for (const t of ['form_submissions', 'custom_table_rows']) for (const s of cols(t)) expect(s).toBe('id')
  })
})

describe('on-behalf actions', () => {
  it('need a reason', async () => {
    await expect(runInstanceAction(ctxFor(ADMIN), 'unlock_user', { user_id: MEMBER })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(runInstanceAction(ctxFor(ADMIN), 'unlock_user', { user_id: MEMBER, reason: ' ' })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('are refused until the audit table exists (nothing happens unaudited)', async () => {
    fake.errors.instance_admin_audit = { message: 'relation "public.instance_admin_audit" does not exist', code: '42P01' }
    await expect(runInstanceAction(ctxFor(ADMIN), 'change_role', inputsFor.change_role)).rejects.toMatchObject({ status: 503 })
    expect(fake.tables.user_roles.find((r) => r.user_id === MEMBER)?.role_id).toBe(MEMBER_ROLE)
  })

  it('change a role, recorded in the instance trail and as "UserTasks support (on behalf)" in the workspace log', async () => {
    const r = await runInstanceAction(ctxFor(ADMIN), 'change_role', inputsFor.change_role)
    expect(r).toMatchObject({ outcome: 'ok', workspace_id: ACME, user_id: MEMBER })
    expect(fake.tables.user_roles.filter((x) => x.user_id === MEMBER).map((x) => x.role_id)).toEqual([ADMIN_ROLE])
    const trail = fake.tables.instance_admin_audit.at(-1)!
    expect(trail).toMatchObject({ admin_user_id: ADMIN, admin_email: 'ops@cloud.example', action: 'change_role', target_tenant_id: ACME, target_user_id: MEMBER, reason: REASON.reason, outcome: 'ok' })
    const ws = fake.tables.object_audit_log.find((a) => a.action === 'support.change_role')!
    expect(ws).toMatchObject({ tenant_id: ACME, actor_id: null })
    expect(String(ws.summary)).toMatch(new RegExp(`^${SUPPORT_ACTOR_LABEL.replace(/[()]/g, '\\$&')}`))
    expect(ws.metadata).toMatchObject({ via: 'instance_support', support_admin: 'ops@cloud.example', reason: REASON.reason })
    expect(auditActorLabel(ws as never)).toBe(`${SUPPORT_ACTOR_LABEL} · ops@cloud.example`)
    expect(auditActionLabel('support.change_role')).toBe('Support: Change role')
  })

  it('are idempotent: the same role again is a no-op, a repeated key replays the first result', async () => {
    await runInstanceAction(ctxFor(ADMIN), 'change_role', inputsFor.change_role)
    const again = await runInstanceAction(ctxFor(ADMIN), 'change_role', inputsFor.change_role)
    expect(again.outcome).toBe('noop')
    const key = { idempotency_key: 'retry-key-0001' }
    const first = await runInstanceAction(ctxFor(ADMIN), 'unlock_user', { ...inputsFor.unlock_user, ...key })
    const replay = await runInstanceAction(ctxFor(ADMIN), 'unlock_user', { ...inputsFor.unlock_user, ...key })
    expect(replay).toMatchObject({ replayed: true, message: first.message })
    expect(authState.unlockAccount).toHaveBeenCalledTimes(1)
  })

  it('guard the last owner', async () => {
    await expect(runInstanceAction(ctxFor(ADMIN), 'change_role', { workspace_id: ACME, user_id: OWNER, role: 'member', ...REASON })).rejects.toMatchObject({ code: 'conflict' })
    await expect(runInstanceAction(ctxFor(ADMIN), 'deactivate_member', { workspace_id: ACME, user_id: OWNER, ...REASON })).rejects.toMatchObject({ code: 'conflict' })
    expect(fake.tables.instance_admin_audit.filter((a) => a.outcome === 'refused')).toHaveLength(2)
  })

  it('invite on behalf (pending invite → no-op), resend with a new link, revoke', async () => {
    const invited = await runInstanceAction(ctxFor(ADMIN), 'invite_user', inputsFor.invite_user)
    expect(invited.outcome).toBe('ok')
    expect(fake.tables.invitations.find((i) => i.email === 'fresh@acme.example')).toMatchObject({ tenant_id: ACME, invited_by: ADMIN, role: 'member' })
    const dup = await runInstanceAction(ctxFor(ADMIN), 'invite_user', { ...inputsFor.invite_user, email: 'new@acme.example' })
    expect(dup.outcome).toBe('noop')
    const resent = await runInstanceAction(ctxFor(ADMIN), 'resend_invitation', inputsFor.resend_invitation)
    expect(resent.outcome).toBe('ok')
    expect(fake.tables.invitations.find((i) => i.id === INVITE)?.token).toBe('tok-NEW-SECRET')
    expect(JSON.stringify(resent)).not.toContain('tok-')
    await runInstanceAction(ctxFor(ADMIN), 'revoke_invitation', inputsFor.revoke_invitation)
    expect(fake.tables.invitations.find((i) => i.id === INVITE)).toBeUndefined()
  })

  it('unlock and sign-out write the audit row into every workspace the person belongs to', async () => {
    const r = await runInstanceAction(ctxFor(ADMIN), 'unlock_user', inputsFor.unlock_user)
    expect(r.detail.workspace_audit_rows).toBe(1)
    expect(fake.tables.object_audit_log.some((a) => a.action === 'support.unlock_user' && a.tenant_id === ACME)).toBe(true)
  })

  it('app viewers never get the write action (the app role check), whatever the server says', () => {
    expect(ruleActionAllowed({ type: 'instance_action', action: 'unlock_user', inputs: {} } as never, {} as never, 'viewer')).toBe(false)
  })
})

describe('the workflow step', () => {
  const step = (over: Partial<Parameters<typeof runInstanceStep>[0]> = {}) => runInstanceStep({
    tenantId: HOME, runId: 'run-1', workflowId: 'wf-1', isTest: false,
    config: { mode: 'action', action: 'unlock_user', inputs: { user_id: MEMBER, reason: REASON.reason } }, resolve: (v) => v, ...over,
  })
  beforeEach(() => {
    fake.tables.workflows = [{ id: 'wf-1', tenant_id: HOME, created_by: ADMIN }]
    fake.tables.workflow_versions = [{ id: 'v-1', tenant_id: HOME, published_by: ADMIN }]
  })

  it('acts for a run an instance admin started', async () => {
    fake.tables.workflow_runs.push({ id: 'run-1', tenant_id: HOME, workflow_id: 'wf-1', started_by: ADMIN, started_via: 'form', version_id: 'v-1' })
    const r = await step()
    expect(r.mode === 'action' && r.result.outcome).toBe('ok')
    expect(fake.tables.instance_admin_audit.at(-1)).toMatchObject({ via: 'workflow', admin_user_id: ADMIN })
  })

  it('refuses a run a non-admin started, test runs, and scheduled actions', async () => {
    fake.tables.workflow_runs.push({ id: 'run-1', tenant_id: HOME, workflow_id: 'wf-1', started_by: OWNER, started_via: 'form', version_id: 'v-1' })
    await expect(step()).rejects.toBeInstanceOf(ServiceError)
    await expect(step({ isTest: true })).rejects.toMatchObject({ status: 403 })
    fake.tables.workflow_runs[fake.tables.workflow_runs.length - 1] = { id: 'run-1', tenant_id: HOME, workflow_id: 'wf-1', started_by: null, started_via: 'schedule', version_id: 'v-1' }
    await expect(step()).rejects.toMatchObject({ status: 403 })
    // …but a scheduled READ runs when owner and publisher are instance admins.
    const read = await step({ config: { mode: 'read', dataset: 'overview' } })
    expect(read.mode).toBe('read')
  })

  it('refuses scheduled reads of a workflow published by a non-admin, and webhook / anonymous starts', async () => {
    fake.tables.workflow_versions = [{ id: 'v-1', tenant_id: HOME, published_by: OWNER }]
    fake.tables.workflow_runs.push({ id: 'run-1', tenant_id: HOME, workflow_id: 'wf-1', started_by: null, started_via: 'schedule', version_id: 'v-1' })
    await expect(step({ config: { mode: 'read', dataset: 'overview' } })).rejects.toMatchObject({ status: 403 })
    fake.tables.workflow_runs[fake.tables.workflow_runs.length - 1] = { id: 'run-1', tenant_id: HOME, workflow_id: 'wf-1', started_by: null, started_via: 'webhook', version_id: 'v-1' }
    fake.tables.workflow_versions = [{ id: 'v-1', tenant_id: HOME, published_by: ADMIN }]
    await expect(step({ config: { mode: 'read', dataset: 'overview' } })).rejects.toMatchObject({ status: 403 })
  })
})

describe('report sources', () => {
  it('refuse anyone but an instance admin, and return declared columns only', async () => {
    const { instanceReportRows } = await import('@/lib/services/instance-admin/report-rows')
    const { INSTANCE_REPORT_SOURCES } = await import('@/lib/instance-admin/report-sources')
    await expect(instanceReportRows(null, 'instance_workspaces')).rejects.toMatchObject({ status: 403 })
    await expect(instanceReportRows(OWNER, 'instance_workspaces')).rejects.toMatchObject({ status: 403 })
    for (const source of INSTANCE_REPORT_SOURCES) {
      const rows = await instanceReportRows(ADMIN, source.key)
      const allowed = new Set(source.columns.map((c) => c.key))
      for (const row of rows) for (const key of Object.keys(row)) expect(allowed.has(key), `${source.key}.${key}`).toBe(true)
      expect(JSON.stringify(rows)).not.toContain(SECRET)
    }
  })
})

describe('the app data grid over the instance source', () => {
  it('uses the grid machinery: header sort, saved-view columns and equals filters, server-side', async () => {
    const { moreWidgetData } = await import('@/lib/services/app-widgets-more')
    const { WIDGET_CONFIG_SCHEMAS } = await import('@/lib/apps/schema')
    const config = WIDGET_CONFIG_SCHEMAS.data_grid.parse({ source: 'instance', instance_dataset: 'users', columns: ['display_name', 'email', 'status'], personal_views: true })
    const extra = { params: { sort: 'email', dir: 'desc' as const, cols: ['email'], eq: [{ column: 'status', value: 'Never signed in' }] }, filters: {}, role: 'viewer' as const, widgetKey: 'a:p:w', preview: false }
    const data: any = await moreWidgetData(ctxFor(ADMIN), 'data_grid', config, extra)
    expect(data).toMatchObject({ type: 'data_grid', source: 'instance', sort: 'email', dir: 'desc', personal_views: true, editable: false })
    expect(data.grid_columns.map((c: any) => c.key)).toEqual(['display_name', 'email', 'status'])
    expect(data.columns.map((c: any) => c.key)).toEqual(['email'])
    expect(data.rows.map((r: any) => r.data.email)).toEqual(['member@acme.example'])
    await expect(moreWidgetData(ctxFor(OWNER), 'data_grid', config, extra)).rejects.toMatchObject({ status: 403 })
  })
})
