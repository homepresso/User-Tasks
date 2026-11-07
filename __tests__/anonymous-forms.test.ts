/**
 * Anonymous forms (public form links, lib/services/anonymous-forms.ts):
 * the security model, with an in-memory database.
 *  - the link: off → 404, workspace switch off → 404 even with the form on,
 *    regeneration revokes the old link, enabling needs the workspace switch;
 *  - the allowlist: no data-table / lookup / API read unless the field allows
 *    it (projection + capped pages), no server step unless the step allows
 *    it, no uploads by default (strict limits when on), no custom-control
 *    capabilities, {{user.*}} empty, only the form's tenant;
 *  - abuse: honeypot, minimum fill time, per-IP rate limit, daily cap;
 *  - the page payload carries no workspace data;
 *  - submissions are marked anonymous and the "Form submitted" trigger runs
 *    as 'anonymous' with no user;
 *  - crafted __form_state / params / vars / field definitions / form ids
 *    sent to the public endpoints can't widen any of it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form JSON */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createMemorySupabase } from './fixtures/supabase-memory'
import type { ServiceContext } from '@/lib/services/context'

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64)

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const A = u(1)
const B = u(2)
const FORM = u(10)
const FORM_B = u(11)
const TABLE = u(20)
const TABLE_B = u(21)
const TRIGGERED = u(30)
const RULE_WF = u(31)
const STAFF = u(40)
const TOKEN = 'T'.repeat(43)
const TOKEN_B = 'B'.repeat(43)

const started: any[] = []
vi.mock('@/lib/services/workflow-start', () => ({
  startWorkflow: vi.fn(async (ctx: any, input: any, options?: any) => {
    started.push({ ctx, input, options })
    return { mode: 'async', job_id: `job-${started.length}-0000-0000`, workflow_id: input.workflow_id, published_version_id: null }
  }),
}))
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/process-queue', () => ({ kickQueueProcessor: vi.fn() }))

let db: any
let rpcCalls: Array<{ name: string; args: any }>
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async (ctx: any) => (ctx?.authKind === 'session' ? db : ctx?.db ?? db) }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: () => db }))

const svc = await import('@/lib/services/anonymous-forms')
svc.anonymousDeps.serviceClient = async () => db
let clock = Date.parse('2026-11-04T10:00:00Z')
svc.anonymousDeps.now = () => clock

const TABLE_COLUMNS = [{ key: 'name', label: 'Name', type: 'text' }, { key: 'secret', label: 'Secret', type: 'text' }]
const FIELDS = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'customer', label: 'Customer', type: 'lookup', lookup: { source: 'table', table_id: TABLE, search_columns: ['name'], display_columns: ['name'] } },
  { key: 'product', label: 'Product', type: 'data_table', data_table: { source: 'table', table_id: TABLE, mode: 'select', columns: [{ key: 'name', label: 'Name', type: 'text' }], anonymous_read: true, page_size: 50 } },
  { key: 'ledger', label: 'Ledger', type: 'data_table', data_table: { source: 'table', table_id: TABLE, mode: 'display', columns: [{ key: 'name', label: 'Name', type: 'text' }] } },
  { key: 'files', label: 'Files', type: 'attachments' },
  { key: 'picker', label: 'Picker', type: 'custom', custom: { tag: 'acme-picker', version: '1.0.0', value_type: 'string', capabilities: ['lookup', 'network'] }, lookup: { source: 'table', table_id: TABLE, search_columns: ['name'], display_columns: ['name'], anonymous_read: true } },
  { key: 'mail', label: 'Hello {{user.email}}', type: 'heading' },
  { key: 'go', label: 'Go', type: 'button', button: { style: 'primary', actions: [{ type: 'apply_table_changes', table_changes: { field: 'product', target: 'workflow', workflow_id: RULE_WF, operation: 'auto' } }] } },
]
const LAYOUT = {
  rows: FIELDS.map((f) => ({ columns: 1, cells: [{ field_key: f.key, span: 1 }] })),
  rules: [
    { id: 'r_closed', event: 'button_click', target: 'go', then: [{ type: 'start_workflow', workflow_id: RULE_WF, workflow_name: 'Closed' }] },
    { id: 'r_open', event: 'button_click', target: 'go', then: [{ type: 'start_workflow', workflow_id: RULE_WF, workflow_name: 'Open', allow_anonymous: true }] },
  ],
}

function makeDb(opts: { workspace?: boolean; enabled?: boolean; settings?: Record<string, unknown> } = {}) {
  const mem = createMemorySupabase({
    tenants: [
      { id: A, name: 'Northwind Secret Workspace', settings: { forms: { anonymous: { enabled: opts.workspace ?? true, captcha: { provider: null } } }, document_ocr: { key: 'SECRET-OCR' } } },
      { id: B, name: 'Contoso', settings: { forms: { anonymous: { enabled: true } } } },
    ],
    forms: [
      { id: FORM, tenant_id: A, name: 'Contact us', description: null, fields: FIELDS, layout: LAYOUT, theme: { source: 'workspace' }, version: 2,
        buttons: [{ id: 'submit', label: 'Send', kind: 'submit', style: 'primary', actions: [
          { type: 'start_workflow', workflow_id: RULE_WF, workflow_name: 'Internal only' },
          { type: 'message', text: 'Thanks {{name}}' },
        ] }], header: null },
      { id: FORM_B, tenant_id: B, name: 'Other', description: null, fields: [{ key: 'name', label: 'Name', type: 'text' }], layout: null, theme: null, version: 1, buttons: null, header: null },
    ],
    form_anonymous_access: [
      { form_id: FORM, tenant_id: A, token: TOKEN, enabled: opts.enabled ?? true, settings: { min_fill_seconds: 0, ...(opts.settings ?? {}) }, token_rotated_at: '2026-11-01T00:00:00Z' },
      { form_id: FORM_B, tenant_id: B, token: TOKEN_B, enabled: true, settings: { min_fill_seconds: 0 } },
    ],
    custom_tables: [{ id: TABLE, tenant_id: A, columns: TABLE_COLUMNS }, { id: TABLE_B, tenant_id: B, columns: TABLE_COLUMNS }],
    custom_table_rows: [
      { id: u(50), tenant_id: A, table_id: TABLE, data: { name: 'Chai', secret: 'S-A' } },
      ...Array.from({ length: 40 }, (_, i) => ({ id: u(100 + i), tenant_id: A, table_id: TABLE, data: { name: `P${i}`, secret: 'S-A' } })),
      { id: u(60), tenant_id: B, table_id: TABLE_B, data: { name: 'Contoso row', secret: 'S-B' } },
    ],
    users: [{ id: STAFF, display_name: 'Nancy Davolio', email: 'nancy@northwind.example' }],
    workflows: [{ id: TRIGGERED, tenant_id: A, is_active: true, trigger_type: 'form_submitted', published_version_id: null, nodes: [{ id: 't', type: 'form_submitted', config: { form_id: FORM } }] }],
    form_submissions: [],
    form_files: [],
    form_controls: [],
  }, { uuids: true })
  rpcCalls = []
  return { ...mem, rpc: async (name: string, args: any) => { rpcCalls.push({ name, args }); return { data: args?.p_jobs?.length ?? 1, error: null } } }
}

const staff = (perms: string[] = ['forms.view', 'forms.edit', 'forms.submit', 'settings.edit', 'settings.view']): ServiceContext => ({
  supabase: db, db, tenantId: A, actorId: STAFF, permissions: new Set(perms), authKind: 'session', source: 'ui',
})
let ipCounter = 0
const visitor = () => ({ ip: `203.0.113.${++ipCounter % 250}`, userAgent: 'Mozilla/5.0 (test) '.repeat(20) })
async function anon(token = TOKEN, extra: { uploadKey?: string } = {}) {
  const resolved = await svc.resolveAnonymousForm(token)
  if (!resolved) throw new Error('not resolved')
  return svc.anonymousContext(resolved, { ip: visitor().ip, uploadKey: extra.uploadKey })
}
const ticket = (formId = FORM, at = clock - 10_000) => svc.issueTicket(formId, at)

beforeEach(() => { db = makeDb(); started.length = 0; clock = Date.parse('2026-11-04T10:00:00Z') })

describe('the public link', () => {
  it('anonymous responses off → not available (404 for every case)', async () => {
    db = makeDb({ enabled: false })
    expect(await svc.resolveAnonymousForm(TOKEN)).toBeNull()
    await expect(svc.submitAnonymousForm(TOKEN, { values: { name: 'x' }, ticket: ticket() }, visitor())).rejects.toMatchObject({ code: 'not_found' })
  })

  it('workspace switch off → blocked even with the form on', async () => {
    db = makeDb({ workspace: false })
    expect(await svc.resolveAnonymousForm(TOKEN)).toBeNull()
    // And a form can't be turned on while the workspace switch is off.
    db.tables.form_anonymous_access[0].enabled = false
    await expect(svc.setFormAnonymousAccess(staff(), FORM, { enabled: true })).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('malformed / unknown tokens resolve to nothing; tokens are 43-char base64url', async () => {
    for (const t of ['', 'short', `${TOKEN}'--`, FORM, 'X'.repeat(43), null, 42]) expect(await svc.resolveAnonymousForm(t)).toBeNull()
    expect(svc.newAnonymousToken()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('regenerating the token revokes the old link', async () => {
    const next = await svc.regenerateFormAnonymousToken(staff(), FORM)
    expect(next.token).not.toBe(TOKEN)
    expect(await svc.resolveAnonymousForm(TOKEN)).toBeNull()
    expect((await svc.resolveAnonymousForm(next.token))?.formId).toBe(FORM)
  })

  it('changing it needs forms.edit; the workspace switch needs settings.edit', async () => {
    await expect(svc.setFormAnonymousAccess(staff(['forms.view']), FORM, { enabled: false })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(svc.regenerateFormAnonymousToken(staff(['forms.view']), FORM)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(svc.setAnonymousWorkspaceSettings(staff(['forms.edit']), { enabled: false })).rejects.toMatchObject({ code: 'forbidden' })
    const view = await svc.setAnonymousWorkspaceSettings(staff(), { enabled: false })
    expect(view.enabled).toBe(false)
    expect(await svc.resolveAnonymousForm(TOKEN)).toBeNull()
  })

  it('options are clamped to the platform limits', async () => {
    const out = await svc.setFormAnonymousAccess(staff(), FORM, { settings: { per_ip_per_minute: 10_000, daily_cap: 0, max_upload_mb: 400, max_files: 99 } as any })
    expect(out.settings).toMatchObject({ per_ip_per_minute: 60, daily_cap: 1, max_upload_mb: 4, max_files: 10 })
  })

  it('the captcha secret is write-only and stored encrypted', async () => {
    const view = await svc.setAnonymousWorkspaceSettings(staff(), { captcha: { provider: 'turnstile', site_key: 'site-key-1', secret: 'top-secret' } })
    expect(view.captcha).toEqual({ provider: 'turnstile', site_key: 'site-key-1', has_secret: true })
    const stored = db.tables.tenants[0].settings.forms.anonymous.captcha.secret
    expect(stored).not.toContain('top-secret')
    expect(JSON.stringify(await svc.getAnonymousWorkspaceSettings(staff()))).not.toContain(stored)
  })
})

describe('the allowlist', () => {
  it('Data tables: nothing without "Allow anonymous read"; with it the projection only, the form\'s tenant only, pages capped', async () => {
    const { queryDataTable } = await import('@/lib/services/form-data-table')
    const ctx = await anon()
    await expect(queryDataTable(ctx, { form_id: FORM }, { field_key: 'ledger' })).rejects.toMatchObject({ code: 'forbidden' })
    const res = await queryDataTable(ctx, { form_id: FORM }, { field_key: 'product', query: { page_size: 1000 } })
    expect(res.page_size).toBeLessThanOrEqual(25)
    expect(res.rows.length).toBeLessThanOrEqual(25)
    const json = JSON.stringify(res)
    expect(json).not.toContain('S-A')
    expect(json).not.toContain('Contoso')
    // Another form id than the link's (even the same tenant's) is not reachable.
    await expect(queryDataTable(ctx, { form_id: FORM_B }, { field_key: 'product' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('lookups: nothing without "Allow anonymous read"; never a custom control\'s', async () => {
    const { lookupFormField } = await import('@/lib/services/form-lookup')
    const ctx = await anon()
    await expect(lookupFormField(ctx, FORM, { field_key: 'customer', query: 'Ch' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(lookupFormField(ctx, FORM, { field_key: 'picker', query: 'Ch' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(lookupFormField(ctx, FORM_B, { field_key: 'customer' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('server steps: skipped / refused unless "Allow for anonymous"; an allowed one starts as anonymous', async () => {
    const { runRuleAction } = await import('@/lib/services/form-rule-actions')
    const { applyTableChangesFromButton } = await import('@/lib/services/form-table-changes')
    const ctx = await anon()
    await expect(runRuleAction(ctx, { form_id: FORM }, { rule_id: 'r_closed', action_index: 0, values: { name: 'x' }, idempotency_key: 'key-00000001' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(applyTableChangesFromButton(ctx, { form_id: FORM }, { button_key: 'go', action_index: 0, values: {}, idempotency_key: 'key-00000002' })).rejects.toMatchObject({ code: 'forbidden' })
    await runRuleAction(ctx, { form_id: FORM }, { rule_id: 'r_open', action_index: 0, values: { name: 'x' }, idempotency_key: 'key-00000003' })
    expect(started).toHaveLength(1)
    expect(started[0].options.via).toBe('anonymous')
    expect(started[0].ctx.actorId).toBeNull()
  })

  it('uploads: blocked by default; when allowed only with the visit\'s key, safe types, server path', async () => {
    const { uploadFormFile, initDirectUpload } = await import('@/lib/services/form-files')
    const file = { context: { kind: 'form' as const, formId: FORM }, field_key: 'files', name: 'a.pdf', bytes: new TextEncoder().encode('%PDF-1.4 hello') }
    await expect(uploadFormFile(await anon(), file)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(initDirectUpload(await anon(), { ...file, size: 10 })).rejects.toMatchObject({ code: 'forbidden' })
    db = makeDb({ settings: { uploads: true } })
    await expect(uploadFormFile(await anon(), file)).rejects.toThrow(/upload key/)
    const keyed = await anon(TOKEN, { uploadKey: 'k'.repeat(43) })
    expect(await initDirectUpload(keyed, { ...file, size: 10 })).toMatchObject({ mode: 'server' })
    await expect(uploadFormFile(keyed, { ...file, name: 'run.exe' })).rejects.toMatchObject({ code: 'validation_error' })
    // Never a custom control's files capability.
    await expect(uploadFormFile(keyed, { ...file, field_key: 'picker' })).rejects.toBeTruthy()
  })

  it('custom-control capabilities: reports need reports.view (an anonymous visitor has only forms.submit)', async () => {
    const { runControlReport } = await import('@/lib/services/form-control-report')
    await expect(runControlReport(await anon(), { form_id: FORM, field_key: 'picker' } as any)).rejects.toMatchObject({ code: 'forbidden' })
    const ctx = await anon()
    expect([...(ctx.permissions ?? [])]).toEqual(['forms.submit'])
    expect(ctx.actorId).toBeNull()
  })

  it('{{user.*}} is empty: no user in the context; the designer is warned', async () => {
    const ctx = await anon()
    const { reads } = await import('@/lib/services/ui-reads/forms')
    expect(await (reads['forms.ruleUser'] as any).run(ctx, undefined)).toBeNull()
    const access = await svc.getFormAnonymousAccess(staff(), FORM)
    expect(access.readiness.user_placeholders).toBe(true)
    expect(access.warnings.join(' ')).toMatch(/\{\{user\.\*\}\} placeholders resolve to empty/)
    expect(access.warnings.join(' ')).toMatch(/"Customer" \(lookup\) shows nothing/)
    expect(access.warnings.join(' ')).toMatch(/skipped for anonymous visitors/)
  })

  it('the form\'s tenant and no other is touched', async () => {
    const ctx = await anon()
    expect(ctx.tenantId).toBe(A)
    const { submitForm } = await import('@/lib/services/form-submissions')
    await expect(submitForm(ctx, FORM_B, { values: { name: 'x' } }, { source: 'anonymous' })).rejects.toMatchObject({ code: 'not_found' })
    const result = await svc.submitAnonymousForm(TOKEN_B, { values: { name: 'x' }, ticket: ticket(FORM_B) }, visitor())
    const row = db.tables.form_submissions.find((r: any) => r.id === result.submission.id)
    expect(row.tenant_id).toBe(B)
  })
})

describe('abuse protection', () => {
  it('the honeypot: a bot gets "Submitted." and nothing is stored', async () => {
    const result = await svc.submitAnonymousForm(TOKEN, { values: { name: 'bot' }, ticket: ticket(), hp: 'http://spam.example' }, visitor())
    expect(result.effects.messages[0].text).toBe('Submitted.')
    expect(db.tables.form_submissions).toHaveLength(0)
  })

  it('minimum fill time and a forged / expired ticket', async () => {
    db = makeDb({ settings: { min_fill_seconds: 5 } })
    await expect(svc.submitAnonymousForm(TOKEN, { values: { name: 'x' }, ticket: ticket(FORM, clock - 1_000) }, visitor())).rejects.toThrow(/quick/)
    await expect(svc.submitAnonymousForm(TOKEN, { values: { name: 'x' }, ticket: 'abc.def' }, visitor())).rejects.toThrow(/expired/)
    await expect(svc.submitAnonymousForm(TOKEN, { values: { name: 'x' }, ticket: ticket(FORM_B) }, visitor())).rejects.toThrow(/expired/)
    await expect(svc.submitAnonymousForm(TOKEN, { values: { name: 'x' }, ticket: ticket(FORM, clock - 25 * 3_600_000) }, visitor())).rejects.toThrow(/expired/)
    await svc.submitAnonymousForm(TOKEN, { values: { name: 'x' }, ticket: ticket(FORM, clock - 6_000) }, visitor())
    expect(db.tables.form_submissions).toHaveLength(1)
  })

  it('per-IP rate limit and the daily cap', async () => {
    db = makeDb({ settings: { per_ip_per_minute: 2, daily_cap: 3 } })
    const same = { ip: '198.51.100.7', userAgent: 'UA' }
    await svc.submitAnonymousForm(TOKEN, { values: { name: '1' }, ticket: ticket() }, same)
    await svc.submitAnonymousForm(TOKEN, { values: { name: '2' }, ticket: ticket() }, same)
    await expect(svc.submitAnonymousForm(TOKEN, { values: { name: '3' }, ticket: ticket() }, same)).rejects.toMatchObject({ code: 'rate_limited' })
    await svc.submitAnonymousForm(TOKEN, { values: { name: '4' }, ticket: ticket() }, { ip: '198.51.100.8', userAgent: 'UA' })
    // (Postgres stamps created_at; the in-memory table doesn't.)
    for (const r of db.tables.form_submissions) r.created_at ??= new Date(clock).toISOString()
    await expect(svc.submitAnonymousForm(TOKEN, { values: { name: '5' }, ticket: ticket() }, { ip: '198.51.100.9', userAgent: 'UA' })).rejects.toThrow(/not taking more responses today/)
  })

  it('captcha: only verified when configured, on the server', async () => {
    const calls: any[] = []
    svc.anonymousDeps.fetch = async (url: string, init: any) => { calls.push({ url, body: String(init.body) }); return new Response(JSON.stringify({ success: String(init.body).includes('response=good') }), { status: 200 }) }
    await svc.submitAnonymousForm(TOKEN, { values: { name: 'x' }, ticket: ticket() }, visitor())
    expect(calls).toHaveLength(0)
    await svc.setAnonymousWorkspaceSettings(staff(), { captcha: { provider: 'turnstile', site_key: 'site-key-1', secret: 'top-secret' } })
    await expect(svc.submitAnonymousForm(TOKEN, { values: { name: 'x' }, ticket: ticket(), captcha: 'bad' }, visitor())).rejects.toThrow(/verification/)
    await svc.submitAnonymousForm(TOKEN, { values: { name: 'x' }, ticket: ticket(), captcha: 'good' }, visitor())
    expect(calls[0].url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(calls[0].body).toContain('secret=top-secret')
  })
})

describe('the page and the submission', () => {
  it('the page payload carries the form and nothing else of the workspace', async () => {
    const page = await svc.getAnonymousFormPage((await svc.resolveAnonymousForm(TOKEN))!)
    expect(Object.keys(page).sort()).toEqual(['captcha', 'form', 'options', 'ticket', 'trusted_controls'])
    const json = JSON.stringify(page)
    for (const leak of ['nancy@northwind.example', 'Nancy Davolio', 'Northwind Secret Workspace', 'SECRET-OCR', 'S-A', 'Chai', 'Contoso', TOKEN_B]) expect(json).not.toContain(leak)
    expect(page.form.name).toBe('Contact us')
  })

  it('a submission is marked anonymous, unticked steps are skipped and the "Form submitted" workflow runs as anonymous', async () => {
    const result = await svc.submitAnonymousForm(TOKEN, { values: { name: 'Visitor' }, ticket: ticket() }, { ip: '192.0.2.10', userAgent: 'x'.repeat(500) })
    const row = db.tables.form_submissions[0]
    expect(row).toMatchObject({ tenant_id: A, form_id: FORM, source: 'anonymous', submitted_by: null })
    expect(row.anonymous_meta.ip_hash).toMatch(/^[0-9a-f]{16}$/)
    expect(JSON.stringify(row)).not.toContain('192.0.2.10')
    expect(row.anonymous_meta.user_agent).toHaveLength(120)
    expect(result.effects.messages.map((m: any) => m.text)).toContain('Thanks Visitor')
    expect(started).toHaveLength(0) // the bar button's Start workflow isn't allowed for anonymous
    const job = rpcCalls.find((c) => c.name === 'enqueue_workflow_batch')!.args.p_jobs[0]
    expect(job.workflow_id).toBe(TRIGGERED)
    expect(job.trigger_data.submission).toMatchObject({ source: 'anonymous', submitted_by: { id: null, name: 'Anonymous', email: null } })
    expect(job.trigger_data.submitted_by ?? null).toBeNull()
    if (job.trigger_data._started_by) expect(job.trigger_data._started_by).toMatchObject({ user_id: null, via: 'anonymous' })
  })

  it('crafted values: sources the visitor can\'t read, people, uploads and control lookups are dropped before any check', async () => {
    const values = { name: 'Visitor', customer: u(50), customer_item: { name: 'forged' }, ledger: [{ name: 'x' }], files: [{ id: u(70) }], picker: 'Chai', submission: { source: 'page' } }
    const out = svc.anonymousSubmittableValues(FIELDS as any, values, false)
    expect(Object.keys(out).sort()).toEqual(['name', 'submission'])
    expect(out).not.toHaveProperty('customer')
    expect(out).not.toHaveProperty('customer_item')
    expect(out).not.toHaveProperty('files')
    expect(out).not.toHaveProperty('picker')
    await svc.submitAnonymousForm(TOKEN, { values, ticket: ticket() }, visitor())
    const row = db.tables.form_submissions[0]
    expect(row.values.customer).toBeUndefined()
    expect(row.values.submission).toBeUndefined()
    expect(db.tables.form_submissions[0].submitted_by).toBeNull()
  })
})

describe('the public endpoints', () => {
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => new NextRequest(`http://localhost/api/public/forms/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.18.0.${++ipCounter % 250}`, ...headers }, body: JSON.stringify(body),
  })

  it('a crafted field definition, form id, __form_state, params or vars can\'t reach a source or step', async () => {
    const dt = (await import('@/app/api/public/forms/[token]/data-table/route')).POST
    const crafted = { field_key: 'ledger', form_id: FORM_B, field: { ...FIELDS[3], data_table: { ...(FIELDS[3] as any).data_table, anonymous_read: true } }, values: { __form_state: { flags: { admin: true } }, __form_params: { x: 1 }, __form_vars: { y: 2 } } }
    const res = await dt(post(`${TOKEN}/data-table`, crafted), { params: Promise.resolve({ token: TOKEN }) })
    expect(res.status).toBe(403)
    const rule = (await import('@/app/api/public/forms/[token]/rule-action/route')).POST
    const res2 = await rule(post(`${TOKEN}/rule-action`, { rule_id: 'r_closed', action_index: 0, values: { __form_state: { anonymous: true } }, idempotency_key: 'key-00000009', form_id: FORM }), { params: Promise.resolve({ token: TOKEN }) })
    expect(res2.status).toBe(403)
    expect(started).toHaveLength(0)
    const lookup = (await import('@/app/api/public/forms/[token]/lookup/route')).POST
    const res3 = await lookup(post(`${TOKEN}/lookup`, { field_key: 'customer', query: 'Ch', field: { lookup: { anonymous_read: true } } }), { params: Promise.resolve({ token: TOKEN }) })
    expect(res3.status).toBe(403)
  })

  it('an unknown or switched-off link is a 404; bodies are capped; JSON only', async () => {
    const submit = (await import('@/app/api/public/forms/[token]/submit/route')).POST
    const res = await submit(post(`${'Z'.repeat(43)}/submit`, { values: {} }), { params: Promise.resolve({ token: 'Z'.repeat(43) }) })
    expect(res.status).toBe(404)
    const big = await submit(post(`${TOKEN}/submit`, { values: { name: 'x'.repeat(300_000) } }), { params: Promise.resolve({ token: TOKEN }) })
    expect(big.status).toBe(413)
    const form = await submit(new NextRequest(`http://localhost/api/public/forms/${TOKEN}/submit`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'values=1' }), { params: Promise.resolve({ token: TOKEN }) })
    expect(form.status).toBe(415)
    const ok = await submit(post(`${TOKEN}/submit`, { values: { name: 'Visitor' }, ticket: ticket(), idempotency_key: 'idem-000001' }), { params: Promise.resolve({ token: TOKEN }) })
    expect(ok.status).toBe(201)
    expect(ok.headers.get('cache-control')).toBe('no-store')
    const body = await ok.json()
    expect(Object.keys(body).sort()).toEqual(['effects', 'started', 'submission'])
  })

  it('the rate limit answers 429 with Retry-After', async () => {
    db = makeDb({ settings: { per_ip_per_minute: 1 } })
    const submit = (await import('@/app/api/public/forms/[token]/submit/route')).POST
    const headers = { 'x-forwarded-for': '198.19.0.1' }
    expect((await submit(post(`${TOKEN}/submit`, { values: { name: 'a' }, ticket: ticket() }, headers), { params: Promise.resolve({ token: TOKEN }) })).status).toBe(201)
    const limited = await submit(post(`${TOKEN}/submit`, { values: { name: 'b' }, ticket: ticket() }, headers), { params: Promise.resolve({ token: TOKEN }) })
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
  })
})
