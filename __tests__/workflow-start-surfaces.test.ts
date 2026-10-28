import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})
vi.mock('@/lib/workflow-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workflow-engine')>()
  return { ...actual, executeWorkflow: vi.fn() }
})
vi.mock('@/lib/process-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/process-queue')>()
  return { ...actual, kickQueueProcessor: vi.fn() }
})
// The dialog's server actions are not exercised by the render tests.
vi.mock('@/app/actions/workflow-start', () => ({ getWorkflowRunInputs: vi.fn(), runWorkflowNow: vi.fn() }))

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { executeWorkflow } from '@/lib/workflow-engine'
import { kickQueueProcessor } from '@/lib/process-queue'
import { createMcpServer } from '@/lib/mcp/server'
import { POST as startRoute } from '@/app/api/v1/workflows/start/route'
import { GET as inputsRoute } from '@/app/api/v1/workflows/[id]/inputs/route'
import { RunWorkflowButton, WorkflowInputFields, runDisabledReason } from '@/components/automations/run-workflow-dialog'
import { deriveInputFields } from '@/lib/workflow-inputs'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows / JSON payloads */

const WF = '11111111-1111-4111-8111-111111111111'
const PLAIN = '22222222-2222-4222-8222-222222222222'
const DRAFT = '33333333-3333-4333-8333-333333333333'
const VERSION = '44444444-4444-4444-8444-444444444444'

const PUBLISHED_VARS = [
  { id: 'a', name: 'customer', type: 'string', defaultValue: '', description: 'Customer name', required: true },
  { id: 'b', name: 'amount', type: 'number', defaultValue: '10', description: '' },
  { id: 'c', name: 'urgent', type: 'boolean', defaultValue: 'false', description: '' },
]

function seed() {
  const db = createMemorySupabase({
    workflows: [
      // The draft has a different variable set: the published version's wins.
      { id: WF, tenant_id: 'tenant-a', name: 'Onboard', is_active: true, published_version_id: VERSION, user_variables: [{ name: 'draft_only', type: 'string', required: true }] },
      { id: PLAIN, tenant_id: 'tenant-a', name: 'Plain', is_active: true, published_version_id: null, user_variables: [] },
      { id: DRAFT, tenant_id: 'tenant-a', name: 'Draft only', is_active: false, published_version_id: null, user_variables: [{ name: 'x', type: 'number' }] },
    ],
    workflow_versions: [{ id: VERSION, workflow_id: WF, version_number: 3, user_variables: PUBLISHED_VARS }],
  }) as any
  db.rpc = vi.fn(async () => ({ data: 'job-1', error: null }))
  return db
}
type Db = ReturnType<typeof seed>

const mockedValidate = vi.mocked(validateApiKey)
const mockedExecute = vi.mocked(executeWorkflow)
function authAs(db: Db, permissions: string[], workflowIds: string[] = []) {
  mockedValidate.mockResolvedValue({
    success: true, tenantId: 'tenant-a', keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId: null,
    scopes: { workflow_ids: workflowIds, table_ids: [] }, permissions,
    supabase: db as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
  } as any)
}
const req = (path: string, init?: { method?: string; body?: unknown }) => new NextRequest(`https://app.test/api/v1${path}`, {
  method: init?.method ?? 'GET',
  headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json' },
  body: init?.body === undefined ? undefined : JSON.stringify(init.body),
})
const params = (p: { id: string }) => ({ params: Promise.resolve(p) })
const json = async (res: Response) => (await res.json()) as any

beforeEach(() => {
  mockedValidate.mockReset()
  mockedExecute.mockReset()
  mockedExecute.mockResolvedValue({ status: 'completed', node_results: { end: { ok: true } }, run_id: 'run-1' } as any)
  vi.mocked(kickQueueProcessor).mockReset()
})

describe('GET /workflows/{id}/inputs', () => {
  it('returns the published version fields', async () => {
    const db = seed()
    authAs(db, ['workflows.view'])
    const res = await inputsRoute(req(`/workflows/${WF}/inputs`), params({ id: WF }))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.data).toMatchObject({ workflow_id: WF, published: true, source: 'published', version_id: VERSION, version_number: 3 })
    expect(body.data.fields.map((f: any) => [f.key, f.type, f.required, f.default])).toEqual([
      ['customer', 'text', true, null], ['amount', 'number', false, 10], ['urgent', 'boolean', false, false],
    ])
  })

  it('falls back to the draft when never published, 404s for unknown, honours scopes and permission', async () => {
    const db = seed()
    authAs(db, ['workflows.view'])
    const draft = await json(await inputsRoute(req(`/workflows/${DRAFT}/inputs`), params({ id: DRAFT })))
    expect(draft.data).toMatchObject({ published: false, source: 'draft', version_id: null, fields: [{ key: 'x', type: 'number' }] })
    expect((await inputsRoute(req('/workflows/nope/inputs'), params({ id: 'nope' }))).status).toBe(404)

    authAs(db, ['workflows.view'], [PLAIN])
    expect((await inputsRoute(req(`/workflows/${WF}/inputs`), params({ id: WF }))).status).toBe(403)
    authAs(db, [])
    expect((await inputsRoute(req(`/workflows/${WF}/inputs`), params({ id: WF }))).status).toBe(403)
  })
})

describe('POST /workflows/start input validation', () => {
  it('400s with per-field details when a required input is missing or mistyped', async () => {
    const db = seed()
    authAs(db, ['workflows.activate'])
    const res = await startRoute(req('/workflows/start', { method: 'POST', body: { workflow_id: WF, variables: { amount: 'lots' } } }))
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body).toMatchObject({ success: false, code: 'validation_error' })
    expect(body.error).toContain('customer: Customer is required')
    expect(body.details).toEqual([
      { path: 'body.variables.customer', field: 'customer', message: 'Customer is required' },
      { path: 'body.variables.amount', field: 'amount', message: 'Amount must be a number' },
    ])
    expect(mockedExecute).not.toHaveBeenCalled()
  })

  it('coerces values, runs the published version (sync) and warns about undeclared keys', async () => {
    const db = seed()
    authAs(db, ['workflows.activate'])
    const res = await startRoute(req('/workflows/start', { method: 'POST', body: { workflow_id: WF, variables: { customer: 'Acme', amount: '42', urgent: 'true', note: 'x' } } }))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.data).toMatchObject({ mode: 'sync', run_id: 'run-1', status: 'completed', published_version_id: VERSION })
    expect(body.data.warnings).toEqual(['Not declared as workflow inputs (passed through unchanged): note'])
    // Started by the workspace key's creator (workflow_started_by), via api.
    expect(mockedExecute).toHaveBeenCalledWith(WF, undefined, false, { customer: 'Acme', amount: 42, urgent: true, note: 'x' }, undefined, VERSION, undefined, { initiator: { userId: 'u1', via: 'api' } })
  })

  it('the CLI (its User-Agent) starts runs via cli; start variables cannot set the initiator', async () => {
    const db = seed()
    authAs(db, ['workflows.activate'])
    const request = new NextRequest('https://app.test/api/v1/workflows/start', {
      method: 'POST',
      headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json', 'user-agent': 'usertasks-cli/0.4.0' },
      body: JSON.stringify({ workflow_id: PLAIN, variables: { a: 1, workflow_started_by: 'someone-else', workflow_owner_id: 'x' } }),
    })
    expect((await startRoute(request)).status).toBe(200)
    expect(mockedExecute).toHaveBeenCalledWith(PLAIN, undefined, false, { a: 1 }, undefined, undefined, undefined, { initiator: { userId: 'u1', via: 'cli' } })
  })

  it('async starts enqueue the coerced inputs and answer 202', async () => {
    const db = seed()
    authAs(db, ['workflows.activate'])
    const res = await startRoute(req('/workflows/start', { method: 'POST', body: { workflow_id: WF, async: true, priority: 80, variables: { customer: 'Acme' } } }))
    expect(res.status).toBe(202)
    expect((await json(res)).data).toMatchObject({ mode: 'async', job_id: 'job-1' })
    expect(db.rpc).toHaveBeenCalledWith('enqueue_workflow', expect.objectContaining({
      p_workflow_id: WF, p_tenant_id: 'tenant-a', p_priority: 80, p_trigger_type: 'api',
      p_trigger_data: { customer: 'Acme', _version_id: VERSION },
    }))
    expect(kickQueueProcessor).toHaveBeenCalled()
  })

  it('a workflow without declared inputs behaves as before', async () => {
    const db = seed()
    authAs(db, ['workflows.activate'])
    const res = await startRoute(req('/workflows/start', { method: 'POST', body: { workflow_id: PLAIN, variables: { anything: { a: 1 } } } }))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.data.warnings).toBeUndefined()
    expect(mockedExecute).toHaveBeenCalledWith(PLAIN, undefined, false, { anything: { a: 1 } }, undefined, undefined, undefined, { initiator: { userId: 'u1', via: 'api' } })
  })

  it('keeps the inactive / not found / scope / permission answers', async () => {
    const db = seed()
    authAs(db, ['workflows.activate'])
    const inactive = await startRoute(req('/workflows/start', { method: 'POST', body: { workflow_id: DRAFT } }))
    expect(inactive.status).toBe(400)
    expect((await json(inactive)).error).toBe('Workflow is not active')
    expect((await startRoute(req('/workflows/start', { method: 'POST', body: { workflow_id: '55555555-5555-4555-8555-555555555555' } }))).status).toBe(404)
    authAs(db, ['workflows.activate'], [PLAIN])
    expect((await startRoute(req('/workflows/start', { method: 'POST', body: { workflow_id: WF, variables: { customer: 'A' } } }))).status).toBe(403)
    authAs(db, ['workflows.view'])
    expect((await startRoute(req('/workflows/start', { method: 'POST', body: { workflow_id: WF, variables: { customer: 'A' } } }))).status).toBe(403)
  })
})

describe('MCP', () => {
  const server = (db: Db) => createMcpServer({
    tenantId: 'tenant-a', supabase: db, actingUserId: null, keyType: 'tenant',
    scopes: { workflow_ids: [], table_ids: [] },
  })
  const parse = (result: any) => JSON.parse(result.content[0].text)

  it('workflows_inputs_get returns the schema', async () => {
    const db = seed()
    const data = parse(await server(db).callTool('workflows_inputs_get', { workflow_id: WF }))
    expect(data.fields.map((f: any) => f.key)).toEqual(['customer', 'amount', 'urgent'])
  })

  it('workflows_start validates inputs and keeps its result shapes', async () => {
    const db = seed()
    const bad = await server(db).callTool('workflows_start', { workflow_id: WF, variables: {} }) as any
    expect(bad.isError).toBe(true)
    expect(bad.content[0].text).toContain('customer: Customer is required')

    const sync = parse(await server(db).callTool('workflows_start', { workflow_id: WF, variables: { customer: 'Acme', amount: '5' } }))
    expect(sync).toMatchObject({ mode: 'sync', run_id: 'run-1', status: 'completed', published_version_id: VERSION })
    expect(mockedExecute).toHaveBeenLastCalledWith(WF, undefined, false, { customer: 'Acme', amount: 5 }, undefined, VERSION, undefined, { initiator: expect.objectContaining({ via: 'mcp' }) })

    const queued = parse(await server(db).callTool('workflows_start', { workflow_id: WF, async: true, variables: { customer: 'Acme' } }))
    expect(queued).toMatchObject({ queued: true, mode: 'async', job_id: 'job-1', workflow_id: WF })
  })
})

describe('UI: Run dialog form', () => {
  const fields = deriveInputFields([
    { name: 'customer', type: 'string', required: true, description: 'Legal name' },
    { name: 'amount', type: 'number', defaultValue: '10' },
    { name: 'urgent', type: 'boolean' },
    { name: 'meta', type: 'object' },
    { name: 'due', type: 'string', format: 'date' },
    { name: 'at', type: 'string', format: 'datetime' },
    { name: 'email', type: 'string', format: 'email' },
    { name: 'site', type: 'string', format: 'url' },
    { name: 'region', type: 'string', format: 'select', options: 'EMEA,APAC' },
  ])
  const render = (errors: Array<{ field: string; message: string }> = []) => renderToStaticMarkup(createElement(WorkflowInputFields, {
    fields, values: { customer: '', amount: '10', urgent: false, meta: '', due: '', at: '', email: '', site: '', region: '' },
    errors, onChange: () => {}, idPrefix: 'run',
  }))

  /** The opening tag of the element with this id. */
  const tag = (html: string, id: string) => {
    const at = html.indexOf(`id="${id}"`)
    expect(at, id).toBeGreaterThan(-1)
    return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1)
  }

  it('renders one control per input type with labels, required markers and help text', () => {
    const html = render()
    expect(tag(html, 'run-customer')).toMatch(/^<input/)
    expect(tag(html, 'run-customer')).toContain('type="text"')
    expect(tag(html, 'run-customer')).toContain('aria-required="true"')
    expect(tag(html, 'run-amount')).toContain('type="number"')
    expect(tag(html, 'run-amount')).toContain('value="10"')
    expect(tag(html, 'run-urgent')).toContain('type="checkbox"')
    expect(tag(html, 'run-meta')).toMatch(/^<textarea/)
    expect(tag(html, 'run-due')).toContain('type="date"')
    expect(tag(html, 'run-at')).toContain('type="datetime-local"')
    expect(tag(html, 'run-email')).toContain('type="email"')
    expect(tag(html, 'run-site')).toContain('type="url"')
    expect(tag(html, 'run-region')).toMatch(/^<select/)
    expect(html).toContain('<option value="EMEA">EMEA</option>')
    expect(html).toContain('<label for="run-customer"')
    expect(html).toContain('Legal name')
    // one required marker (customer)
    expect(html.match(/aria-hidden="true"[^>]*>\*</g)).toHaveLength(1)
  })

  it('shows field errors (required validation) linked to the control', () => {
    const html = render([{ field: 'customer', message: 'Customer is required' }])
    expect(tag(html, 'run-customer')).toContain('aria-invalid="true"')
    expect(tag(html, 'run-customer')).toContain('aria-describedby="run-customer-help run-customer-error"')
    expect(html).toContain('<p id="run-customer-error" role="alert"')
    expect(html).toContain('Customer is required')
  })

  it('says when there are no inputs', () => {
    expect(renderToStaticMarkup(createElement(WorkflowInputFields, { fields: [], values: {}, errors: [], onChange: () => {} }))).toContain('no input parameters')
  })

  it('Run button: hidden without permission, disabled with a reason until published and active', () => {
    const published = { id: WF, name: 'Onboard', is_active: true, published_version_id: VERSION }
    expect(renderToStaticMarkup(createElement(RunWorkflowButton, { workflow: published, canRun: false, onRun: () => {} }))).toBe('')
    const enabled = renderToStaticMarkup(createElement(RunWorkflowButton, { workflow: published, canRun: true, onRun: () => {} }))
    expect(enabled).toContain('Run')
    expect(enabled).not.toContain('aria-disabled')
    expect(runDisabledReason({ ...published, published_version_id: null })).toMatch(/^Publish first/)
    expect(runDisabledReason({ ...published, is_active: false })).toBe('Activate the workflow first')
    const disabled = renderToStaticMarkup(createElement(RunWorkflowButton, { workflow: { ...published, published_version_id: null }, canRun: true, onRun: () => {} }))
    expect(disabled).toContain('aria-disabled="true"')
    expect(disabled).toContain('title="Publish first')
  })
})
