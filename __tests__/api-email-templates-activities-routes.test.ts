import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/deletion-queue', () => ({
  enqueueDeletionJob: vi.fn(async () => {}),
  kickDeletionProcessor: vi.fn(),
  processDeletionQueueBatch: vi.fn(async () => ({ processed: 0, results: [] })),
}))

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { GET as listTemplates, POST as createTemplate } from '@/app/api/v1/email-templates/route'
import { DELETE as deleteTemplate, PATCH as patchTemplate } from '@/app/api/v1/email-templates/[id]/route'
import { POST as previewTemplate } from '@/app/api/v1/email-templates/[id]/preview/route'
import { GET as listActivities, POST as createActivity } from '@/app/api/v1/workflow-activities/route'
import { DELETE as deleteActivity, GET as getActivity, PATCH as patchActivity } from '@/app/api/v1/workflow-activities/[id]/route'
import { GET as exportActivity } from '@/app/api/v1/workflow-activities/[id]/export/route'
import { POST as importActivity } from '@/app/api/v1/workflow-activities/import/route'
import { createMemorySupabase } from './fixtures/supabase-memory'

const mockedValidate = vi.mocked(validateApiKey)
const ALL = [
  'workflows.view', 'workflows.create', 'workflows.edit',
  'extensibility.view', 'extensibility.create', 'extensibility.edit', 'extensibility.delete',
]
const SOURCE = 'async function run(inputs) { return { outputs: { echo: inputs.text } } }'
const MANIFEST = { inputs: [{ name: 'text' }], outputs: [{ name: 'echo' }] }

function authAs(supabase: ReturnType<typeof createMemorySupabase>, permissions = ALL) {
  mockedValidate.mockResolvedValue({
    success: true, tenantId: 'tenant-a', keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId: null,
    scopes: { workflow_ids: [], table_ids: [] }, permissions,
    supabase: supabase as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
  })
}

function req(path: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(`https://app.test/api/v1${path}`, {
    method: init?.method ?? 'GET',
    headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
}
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) })

function seed() {
  return createMemorySupabase({
    email_templates: [{ id: 'tpl-default', tenant_id: 'tenant-a', name: 'UserTasks Default', is_default: true, subject: 'Hi {{name}}', html_body: '<p>Hi {{name}}</p>', text_body: 'Hi {{name}}' }],
    custom_workflow_activities: [{ id: 'act-a', tenant_id: 'tenant-a', name: 'Echo', key: 'echo', status: 'active', source_kind: 'inline', source_code: SOURCE, manifest: MANIFEST, tags: [], demo_inputs: {} }],
  })
}

beforeEach(() => mockedValidate.mockReset())

describe('/api/v1/email-templates', () => {
  it('401 when the credential is rejected', async () => {
    mockedValidate.mockResolvedValue({ success: false, response: NextResponse.json({ success: false, error: 'Invalid API key' }, { status: 401 }) })
    expect((await listTemplates(req('/email-templates'))).status).toBe(401)
  })

  it('403 without workflows.* permissions', async () => {
    authAs(seed(), ['workflows.view'])
    const res = await createTemplate(req('/email-templates', { method: 'POST', body: { name: 'X', subject: 's', html_body: '<p>b</p>' } }))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ success: false, code: 'forbidden' })
    authAs(seed(), [])
    expect((await listTemplates(req('/email-templates'))).status).toBe(403)
  })

  it('400 with field details for an invalid body', async () => {
    authAs(seed())
    const res = await createTemplate(req('/email-templates', { method: 'POST', body: { name: '' } }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['body.name', 'body.subject', 'body.html_body']))
  })

  it('creates (sanitised), lists, previews, moves the default and deletes', async () => {
    const supabase = seed()
    authAs(supabase)
    const created = await createTemplate(req('/email-templates', {
      method: 'POST', body: { name: 'Digest', subject: '{{count}} updates', html_body: '<h1 onclick="x()">{{count}} updates</h1><script>bad()</script>' },
    }))
    expect(created.status).toBe(201)
    const template = (await created.json()).data.email_template
    expect(template).toMatchObject({ name: 'Digest', html_body: '<h1>{{count}} updates</h1>', text_body: '{{count}} updates', is_default: false })

    const list = await (await listTemplates(req('/email-templates?search=dig'))).json()
    expect(list.data).toMatchObject({ email_templates: [{ id: template.id }], total: 1 })

    const preview = await previewTemplate(req(`/email-templates/${template.id}/preview`, { method: 'POST', body: { variables: { count: 3 } } }), params({ id: template.id }))
    expect((await preview.json()).data).toMatchObject({ subject: '3 updates', html_body: '<h1>3 updates</h1>', text_body: '3 updates' })

    const conflict = await deleteTemplate(req('/email-templates/tpl-default', { method: 'DELETE' }), params({ id: 'tpl-default' }))
    expect(conflict.status).toBe(409)

    const promoted = await patchTemplate(req(`/email-templates/${template.id}`, { method: 'PATCH', body: { is_default: true } }), params({ id: template.id }))
    expect((await promoted.json()).data.email_template.is_default).toBe(true)
    expect(supabase.tables.email_templates.filter((row) => row.is_default).map((row) => row.id)).toEqual([template.id])

    const deleted = await deleteTemplate(req('/email-templates/tpl-default', { method: 'DELETE' }), params({ id: 'tpl-default' }))
    expect(await deleted.json()).toEqual({ success: true, data: { deleted: true } })
  })

  it('404 for unknown ids', async () => {
    authAs(seed())
    const res = await previewTemplate(req('/email-templates/nope/preview', { method: 'POST', body: {} }), params({ id: 'nope' }))
    expect(res.status).toBe(404)
  })
})

describe('/api/v1/workflow-activities', () => {
  it('403 without extensibility.* permissions', async () => {
    authAs(seed(), ['extensibility.view'])
    const res = await createActivity(req('/workflow-activities', { method: 'POST', body: { name: 'X', source_code: SOURCE, manifest: MANIFEST } }))
    expect(res.status).toBe(403)
    const del = await deleteActivity(req('/workflow-activities/act-a', { method: 'DELETE' }), params({ id: 'act-a' }))
    expect(del.status).toBe(403)
    authAs(seed(), [])
    expect((await listActivities(req('/workflow-activities'))).status).toBe(403)
  })

  it('400 for a missing manifest or code without an entry point', async () => {
    authAs(seed())
    const missing = await createActivity(req('/workflow-activities', { method: 'POST', body: { name: 'X', source_code: SOURCE } }))
    expect(missing.status).toBe(400)
    expect((await missing.json()).details.map((d: { path: string }) => d.path)).toContain('body.manifest')
    const bad = await createActivity(req('/workflow-activities', { method: 'POST', body: { name: 'X', source_code: 'let x = 1', manifest: MANIFEST } }))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toContain('source_code must expose')
  })

  it('creates, patches, exports, deletes and imports back', async () => {
    const supabase = seed()
    authAs(supabase)
    const created = await createActivity(req('/workflow-activities', { method: 'POST', body: { name: 'Shout', source_code: SOURCE, manifest: MANIFEST } }))
    expect(created.status).toBe(201)
    const activity = (await created.json()).data.workflow_activity
    expect(activity).toMatchObject({ key: 'shout', status: 'draft', code_execution_enabled: false })

    const patched = await patchActivity(req(`/workflow-activities/${activity.id}`, { method: 'PATCH', body: { status: 'active' } }), params({ id: activity.id }))
    expect((await patched.json()).data.workflow_activity).toMatchObject({ status: 'active', name: 'Shout' })

    const list = await (await listActivities(req('/workflow-activities?status=active'))).json()
    expect(list.data.total).toBe(2)

    const exported = (await (await exportActivity(req(`/workflow-activities/${activity.id}/export`), params({ id: activity.id }))).json()).data
    expect(exported).toMatchObject({ version: 1, asset_type: 'workflow_activity', workflow_activity: { key: 'shout', status: 'active' } })

    const del = await deleteActivity(req(`/workflow-activities/${activity.id}`, { method: 'DELETE' }), params({ id: activity.id }))
    expect(await del.json()).toEqual({ success: true, data: { deleted: true } })

    const imported = await importActivity(req('/workflow-activities/import', { method: 'POST', body: exported }))
    expect(imported.status).toBe(201)
    expect((await imported.json()).data.workflow_activity).toMatchObject({ name: 'Shout', key: 'shout', status: 'active', source_code: SOURCE })

    const got = await getActivity(req('/workflow-activities/act-a'), params({ id: 'act-a' }))
    expect((await got.json()).data.workflow_activity.source_code).toBe(SOURCE)
  })

  it('import ?publish=true activates a draft export; invalid payloads are 400', async () => {
    authAs(seed())
    const body = { version: 1, asset_type: 'workflow_activity', workflow_activity: { name: 'Draft one', status: 'draft', source_code: SOURCE, manifest: MANIFEST } }
    const res = await importActivity(req('/workflow-activities/import?publish=true', { method: 'POST', body }))
    expect((await res.json()).data.workflow_activity.status).toBe('active')
    const bad = await importActivity(req('/workflow-activities/import', { method: 'POST', body: { workflow_activity: { name: 'x' } } }))
    expect(bad.status).toBe(400)
  })
})
