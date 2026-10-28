import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/services/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/context')>()
  return { ...actual, fromSession: vi.fn() }
})

import { createHmac } from 'node:crypto'
import { createServiceClient } from '@/lib/cron-auth'
import { fromSession, type ServiceContext } from '@/lib/services/context'
import { decryptSecret } from '@/lib/secret-crypto'
import {
  createLogDestinationAction,
  deleteLogDestinationAction,
  listLogDestinationsWithStatus,
  listLogExportWorkflowOptions,
  resetLogDestinationCursorAction,
  setLogDestinationEnabledAction,
  testLogDestinationAction,
  updateLogDestinationAction,
} from '@/app/actions/log-destinations'
import {
  buildCreateInput,
  buildUpdateInput,
  emptyForm,
  formFromDestination,
  headersForUpdate,
  SECRET,
  validateForm,
  type DestinationForm,
} from '@/components/settings/log-export/form-state'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const A = 'tenant-a'
const B = 'tenant-b'
const WF_A = 'a0000000-0000-4000-8000-000000000001'
const URL_A = 'https://93.184.216.34/hook' // IP literal: no DNS in tests

// ─── Form state (pure) ───

describe('log export form state', () => {
  const stored = {
    name: 'otel', type: 'otlp_http', enabled: true,
    config: { endpoint: 'https://otel.example.com', resource_attributes: { env: 'prod' } },
    credentials: { headers: { 'x-api-key': SECRET, 'x-team': SECRET } },
    filters: { categories: ['workflow'], types: ['workflow.run.*'], min_severity: 'warn' },
  }

  it('round-trips a stored destination without sending any secret', () => {
    const form = formFromDestination(stored)
    expect(form.headers.map((h) => h.name)).toEqual(['x-api-key', 'x-team'])
    expect(form.headers.every((h) => h.value.stored && h.value.value === '')).toBe(true)
    const update = buildUpdateInput(form, stored)
    expect(update).not.toHaveProperty('credentials')
    expect(JSON.stringify(update)).not.toContain(SECRET)
    expect(update.config).toEqual({ endpoint: 'https://otel.example.com', resource_attributes: { env: 'prod' } })
    expect(update.filters).toEqual({ categories: ['workflow'], types: ['workflow.run.*'], min_severity: 'warn' })
  })

  it('sends the whole header map with __SECRET__ for kept values once any header changes', () => {
    const form = formFromDestination(stored)
    form.headers[1] = { ...form.headers[1], value: { stored: true, replacing: true, value: 'new-team' } }
    expect(buildUpdateInput(form, stored).credentials).toEqual({ headers: { 'x-api-key': SECRET, 'x-team': 'new-team' } })

    const removed = formFromDestination(stored)
    removed.headers = removed.headers.slice(0, 1)
    expect(buildUpdateInput(removed, stored).credentials).toEqual({ headers: { 'x-api-key': SECRET } })
  })

  it('a renamed stored header needs a new value and never reuses the old one under a new name', () => {
    const form = formFromDestination(stored)
    form.headers[0] = { ...form.headers[0], name: 'authorization' }
    expect(validateForm(form, 'edit')).toMatch(/authorization needs a value/)
    expect(headersForUpdate(form.headers, ['x-api-key', 'x-team'])).toEqual({ 'x-team': SECRET })
  })

  it('cleared optional config keys are sent as null; unmanaged keys are left alone', () => {
    const splunk = { name: 's', type: 'splunk_hec', enabled: true, config: { url: 'https://s.example.com', index: 'main', verify_tls: true }, credentials: { token: SECRET } }
    const form = formFromDestination(splunk)
    form.index = ''
    const update = buildUpdateInput(form, splunk)
    expect(update.config).toEqual({ url: 'https://s.example.com', index: null })
    expect(update).not.toHaveProperty('credentials')
  })

  it('a replaced token is sent; "Keep current" sends nothing', () => {
    const splunk = { name: 's', type: 'splunk_hec', enabled: true, config: { url: 'https://s.example.com' }, credentials: { token: SECRET } }
    const form = formFromDestination(splunk)
    form.token = { stored: true, replacing: true, value: 'new-token' }
    expect(buildUpdateInput(form, splunk).credentials).toEqual({ token: 'new-token' })
    form.token = { stored: true, replacing: true, value: '' }
    expect(validateForm(form, 'edit')).toMatch(/new HEC token/)
    form.token = { stored: true, replacing: false, value: '' }
    expect(buildUpdateInput(form, splunk)).not.toHaveProperty('credentials')
  })

  it('builds per-type create input and validates required fields', () => {
    const dd: DestinationForm = { ...emptyForm('datadog'), name: 'dd', site: 'datadoghq.eu', tags: 'env:prod, team:ops' }
    expect(validateForm(dd, 'create')).toBe('API key is required')
    dd.apiKey = { stored: false, replacing: false, value: 'k' }
    expect(validateForm(dd, 'create')).toBeNull()
    expect(buildCreateInput(dd)).toMatchObject({
      name: 'dd', type: 'datadog', config: { site: 'datadoghq.eu', tags: ['env:prod', 'team:ops'] }, credentials: { api_key: 'k' }, filters: {}, start_from: 'now',
    })

    const hook: DestinationForm = { ...emptyForm('webhook'), name: 'h', url: URL_A }
    expect(buildCreateInput(hook).credentials).toEqual({}) // secret generated server-side
    hook.signingSecret = { stored: false, replacing: false, value: 'short' }
    expect(validateForm(hook, 'create')).toMatch(/at least 16/)
  })
})

// ─── Server actions over the real service + memory DB ───

function seed() {
  return createMemorySupabase({
    event_stream: [
      { id: 10, tenant_id: A, occurred_at: new Date(Date.now() - 90_000).toISOString(), type: 'workflow.run.started', category: 'workflow', severity: 'info' },
      { id: 11, tenant_id: B, occurred_at: new Date(Date.now() - 60_000).toISOString(), type: 'workflow.run.started', category: 'workflow', severity: 'info' },
    ],
    workflows: [
      { id: WF_A, tenant_id: A, name: 'Notify', nodes: [], edges: [], is_active: true },
      { id: 'b0000000-0000-4000-8000-000000000001', tenant_id: B, name: 'Other tenant', nodes: [], edges: [], is_active: true },
    ],
  }, { uuids: true })
}

function sessionCtx(db: ReturnType<typeof seed>, permissions: string[], tenantId = A): ServiceContext {
  return { supabase: db as any, tenantId, actorId: 'user-1', permissions: new Set(permissions), authKind: 'session', source: 'ui' }
}

const ADMIN = ['observability.view', 'settings.view', 'settings.edit']

describe('log destination server actions', () => {
  let db: ReturnType<typeof seed>
  const fetchMock = vi.fn()

  beforeEach(() => {
    db = seed()
    vi.mocked(createServiceClient).mockReturnValue(db as any)
    vi.mocked(fromSession).mockImplementation(async () => sessionCtx(db, ADMIN))
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('create → list → test → pause → reset → delete a webhook destination', async () => {
    const created = await createLogDestinationAction({ name: 'Hook', type: 'webhook', config: { url: URL_A }, filters: { categories: ['workflow'] } })
    if (!created.ok) throw new Error(created.error)
    const secret = created.data.signing_secret!
    expect(secret).toMatch(/^whsec_/)
    expect(created.data.log_destination.credentials).toEqual({ signing_secret: SECRET })
    const id = created.data.log_destination.id

    const listed = await listLogDestinationsWithStatus()
    if (!listed.ok) throw new Error(listed.error)
    expect(listed.data).toHaveLength(1)
    expect(listed.data[0].destination.name).toBe('Hook')
    expect(listed.data[0].status).toMatchObject({ status: 'healthy', lag_events: 0 })
    expect(JSON.stringify(listed.data)).not.toContain(secret)

    // Test event: signed with the stored secret.
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const tested = await testLogDestinationAction(id)
    if (!tested.ok) throw new Error(tested.error)
    expect(tested.data).toMatchObject({ ok: true, status_code: 204 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(URL_A)
    const header = new Headers(init.headers).get('x-usertasks-signature')!
    const t = /t=(\d+)/.exec(header)![1]
    const expected = createHmac('sha256', secret).update(`${t}.${init.body}`).digest('hex')
    expect(header).toContain(`v1=${expected}`)
    expect(JSON.parse(init.body).events[0].type).toBe('system.test')

    const paused = await setLogDestinationEnabledAction(id, false)
    expect(paused.ok && paused.data.log_destination.status).toBe('disabled')

    const reset = await resetLogDestinationCursorAction(id, 'retention_start')
    expect(reset.ok && reset.data.log_destination.cursor).toBe('9')

    const deleted = await deleteLogDestinationAction(id)
    expect(deleted).toEqual({ ok: true, data: { deleted: true } })
    expect(db.tables.log_destinations ?? []).toHaveLength(0)
  })

  it('an edit that does not replace secrets keeps them; a replaced header is stored encrypted', async () => {
    const created = await createLogDestinationAction({
      name: 'OTel', type: 'otlp_http', config: { endpoint: 'https://93.184.216.34:4318' },
      credentials: { headers: { 'x-api-key': 'key-1', 'x-team': 'ops' } }, filters: { categories: ['task'] },
    })
    if (!created.ok) throw new Error(created.error)
    const row = created.data.log_destination

    const form = formFromDestination(row)
    form.name = 'OTel prod'
    const kept = await updateLogDestinationAction(row.id, buildUpdateInput(form, row))
    expect(kept.ok).toBe(true)
    const storedHeaders = () => (db.tables.log_destinations[0].credentials as any).headers
    expect(decryptSecret(storedHeaders()['x-api-key'])).toBe('key-1')
    expect(decryptSecret(storedHeaders()['x-team'])).toBe('ops')

    form.headers[0] = { ...form.headers[0], value: { stored: true, replacing: true, value: 'key-2' } }
    const replaced = await updateLogDestinationAction(row.id, buildUpdateInput(form, row))
    expect(replaced.ok).toBe(true)
    expect(storedHeaders()['x-api-key']).not.toBe('key-2')
    expect(decryptSecret(storedHeaders()['x-api-key'])).toBe('key-2')
    expect(decryptSecret(storedHeaders()['x-team'])).toBe('ops')
  })

  it('returns expected failures as { ok: false } (messages survive production builds)', async () => {
    const bad = await createLogDestinationAction({ name: 'Bad', type: 'webhook', config: { url: 'https://127.0.0.1/x' } })
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.error).toMatch(/127\.0\.0\.1|private|blocked|egress/i)

    const missing = await updateLogDestinationAction('00000000-0000-4000-8000-000000000000', { name: 'x' })
    expect(missing).toEqual({ ok: false, error: 'Log destination not found' })
  })

  it('denies writes without settings.edit and reads without observability.view', async () => {
    vi.mocked(fromSession).mockImplementation(async () => sessionCtx(db, ['observability.view', 'settings.view']))
    const create = await createLogDestinationAction({ name: 'Hook', type: 'webhook', config: { url: URL_A } })
    expect(create.ok).toBe(false)
    expect(!create.ok && create.error).toMatch(/settings\.edit/)
    expect((await listLogDestinationsWithStatus()).ok).toBe(true)

    vi.mocked(fromSession).mockImplementation(async () => sessionCtx(db, ['settings.view', 'settings.edit']))
    const list = await listLogDestinationsWithStatus()
    expect(list.ok).toBe(false)
    expect(!list.ok && list.error).toMatch(/observability\.view/)
    expect((await listLogExportWorkflowOptions()).ok).toBe(false)
  })

  it('exporting audit/security events also needs settings.view', async () => {
    vi.mocked(fromSession).mockImplementation(async () => sessionCtx(db, ['observability.view', 'settings.edit']))
    const all = await createLogDestinationAction({ name: 'All', type: 'webhook', config: { url: URL_A } })
    expect(all.ok).toBe(false)
    expect(!all.ok && all.error).toMatch(/settings\.view/)
    const scoped = await createLogDestinationAction({ name: 'Wf', type: 'webhook', config: { url: URL_A }, filters: { categories: ['workflow'] } })
    expect(scoped.ok).toBe(true)
  })

  it('is tenant-scoped: another workspace sees none of A\'s destinations or workflows', async () => {
    const created = await createLogDestinationAction({ name: 'Hook', type: 'webhook', config: { url: URL_A } })
    if (!created.ok) throw new Error(created.error)
    vi.mocked(fromSession).mockImplementation(async () => sessionCtx(db, ADMIN, B))
    const listB = await listLogDestinationsWithStatus()
    expect(listB.ok && listB.data).toEqual([])
    expect(await deleteLogDestinationAction(created.data.log_destination.id)).toEqual({ ok: false, error: 'Log destination not found' })
    const workflows = await listLogExportWorkflowOptions()
    expect(workflows.ok && workflows.data.map((w) => w.name)).toEqual(['Other tenant'])
  })
})
