/* eslint-disable @typescript-eslint/no-explicit-any -- memory table rows */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))

import { writeAudit } from '@/lib/audit-log'
import { recordAssetChange } from '@/lib/github-sync/enqueue'
import { createMcpServer } from '@/lib/mcp/server'
import type { ServiceContext } from '@/lib/services/context'
import * as forms from '@/lib/services/forms'
import { createEmptyAssetIdMaps, remapKnownIds } from '@/lib/portability/id-maps'
import { normalizeFormAssetLikeImport, stripWorkflowFormPins } from '@/lib/portability/forms'
import { createMemorySupabase } from './fixtures/supabase-memory'

const ALL = ['forms.view', 'forms.edit', 'forms.delete']
const page = { limit: 50, offset: 0 }
const THEME_A = '11111111-1111-4111-8111-111111111111'
const THEME_B = '22222222-2222-4222-8222-222222222222'
const FORM_B = '33333333-3333-4333-8333-333333333333'

const FIELDS = [
  { key: 'decision', label: 'Decision', type: 'choice', required: true, options: ['Approve', 'Reject'] },
  { key: 'comments', label: 'Comments', type: 'textarea' },
]

function context(supabase: ReturnType<typeof createMemorySupabase>, permissions: string[] = ALL): ServiceContext {
  return {
    supabase: supabase as unknown as ServiceContext['supabase'],
    tenantId: 'tenant-a',
    actorId: 'user-1',
    permissions: new Set(permissions),
    authKind: 'api_key',
    source: 'api',
  }
}

function seed(extra: Record<string, any[]> = {}) {
  return createMemorySupabase({
    form_themes: [
      { id: THEME_A, tenant_id: 'tenant-a', name: 'Brand', description: null, overrides: { radius: 12 }, created_at: '2026-01-01', updated_at: '2026-01-01' },
      { id: THEME_B, tenant_id: 'tenant-b', name: 'Foreign theme', description: null, overrides: { radius: 2 }, created_at: '2026-01-01', updated_at: '2026-01-01' },
    ],
    forms: [
      { id: FORM_B, tenant_id: 'tenant-b', name: 'Foreign form', description: null, tags: [], fields: FIELDS, layout: null, theme: { source: 'workspace' }, version: 1, created_at: '2026-01-01', updated_at: '2026-01-01' },
    ],
    form_versions: [],
    workflows: [],
    workflow_versions: [],
    ...extra,
  }, { uuids: true })
}

beforeEach(() => {
  vi.mocked(writeAudit).mockClear()
  vi.mocked(recordAssetChange).mockClear()
})

describe('forms service: permissions', () => {
  it.each([
    ['list', [] as string[], (ctx: ServiceContext) => forms.listForms(ctx, {}, page)],
    ['get', [], (ctx: ServiceContext) => forms.getForm(ctx, FORM_B)],
    ['versions', [], (ctx: ServiceContext) => forms.listFormVersions(ctx, FORM_B, page)],
    ['usages', [], (ctx: ServiceContext) => forms.getFormUsages(ctx, FORM_B)],
    ['create', ['forms.view', 'forms.delete'], (ctx: ServiceContext) => forms.createForm(ctx, { name: 'X', fields: FIELDS })],
    ['update', ['forms.view', 'forms.delete'], (ctx: ServiceContext) => forms.updateForm(ctx, FORM_B, { name: 'Y' })],
    ['delete', ['forms.view', 'forms.edit'], (ctx: ServiceContext) => forms.deleteForm(ctx, FORM_B)],
    ['theme list', [], (ctx: ServiceContext) => forms.listFormThemes(ctx, {}, page)],
    ['theme get', [], (ctx: ServiceContext) => forms.getFormTheme(ctx, THEME_A)],
    ['theme create', ['forms.view'], (ctx: ServiceContext) => forms.createFormTheme(ctx, { name: 'T', overrides: {} })],
    ['theme update', ['forms.view'], (ctx: ServiceContext) => forms.updateFormTheme(ctx, THEME_A, { name: 'T' })],
    ['theme delete', ['forms.view', 'forms.edit'], (ctx: ServiceContext) => forms.deleteFormTheme(ctx, THEME_A)],
  ])('%s is refused (403) without its forms.* permission and writes nothing', async (_name, permissions, call) => {
    const supabase = seed()
    await expect(call(context(supabase, permissions))).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    expect(supabase.calls).toEqual([])
  })

  it('duplicate needs forms.edit, not just forms.view', async () => {
    const supabase = seed()
    const form = await forms.createForm(context(supabase), { name: 'Source', fields: FIELDS })
    const before = supabase.tables.forms.length
    await expect(forms.duplicateForm(context(supabase, ['forms.view']), form.id)).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    expect(supabase.tables.forms).toHaveLength(before)
  })

  it('MCP gates the forms tools on forms.view / forms.edit / forms.delete', async () => {
    const supabase = seed()
    const mcp = (permissions: string[]) => createMcpServer({ tenantId: 'tenant-a', supabase, actingUserId: 'user-1', keyType: 'tenant', permissions })
    expect((await mcp([]).callTool('forms_list', {})).isError).toBe(true)
    expect((await mcp(['forms.view']).callTool('forms_list', {})).isError).toBeFalsy()
    expect((await mcp(['forms.view']).callTool('forms_create', { name: 'X', fields: FIELDS })).isError).toBe(true)
    const created = await mcp(['forms.view', 'forms.edit']).callTool('forms_create', { name: 'Via MCP', fields: FIELDS })
    expect(created.isError).toBeFalsy()
    expect(JSON.parse(created.content[0].text).form.name).toBe('Via MCP')
    expect((await mcp(['forms.view', 'forms.edit']).callTool('form_themes_delete', { form_theme_id: THEME_A })).isError).toBe(true)
  })
})

describe('forms service: CRUD and validation', () => {
  it('creates version 1 with a snapshot, audits and records a sync change', async () => {
    const supabase = seed()
    const form = await forms.createForm(context(supabase), { name: ' Review ', description: ' Approve it ', tags: ['Finance', 'finance', ' AP '], fields: FIELDS })
    expect(form).toMatchObject({ name: 'Review', description: 'Approve it', tags: ['finance', 'ap'], version: 1, theme: { source: 'workspace' }, layout: null })
    expect(supabase.tables.forms.find((row) => row.id === form.id)).toMatchObject({ tenant_id: 'tenant-a', created_by: 'user-1' })
    expect(supabase.tables.form_versions).toEqual([expect.objectContaining({ form_id: form.id, version: 1, tenant_id: 'tenant-a', name: 'Review' })])
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ objectType: 'form', action: 'create', objectId: form.id }))
    expect(recordAssetChange).toHaveBeenCalledWith(expect.objectContaining({ assetType: 'form', assetId: form.id, action: 'save' }))
  })

  it.each([
    ['no name', { name: '  ', fields: FIELDS }, /Form name must be/],
    ['fields not an array', { name: 'X', fields: 'nope' }, /fields must be an array/],
    ['no fields', { name: 'X', fields: [] }, /at least one field/],
    ['a choice without options', { name: 'X', fields: [{ key: 'c', label: 'C', type: 'choice' }] }, /Field "c": Add at least one option/],
    ['an invalid theme reference', { name: 'X', fields: FIELDS, theme: { source: 'saved', theme_id: 'not-a-uuid' } }, /Invalid form theme/],
    ['another workspace\'s saved theme', { name: 'X', fields: FIELDS, theme: { source: 'saved', theme_id: THEME_B } }, /does not exist in this workspace/],
    ['too many tags', { name: 'X', fields: FIELDS, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, /At most 20 tags/],
  ])('rejects %s (400)', async (_name, input, message) => {
    const supabase = seed()
    await expect(forms.createForm(context(supabase), input as any)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(message) })
    expect(supabase.tables.forms.filter((row) => row.tenant_id === 'tenant-a')).toEqual([])
  })

  it('lists and reads only the caller workspace (tag filter, usage counts)', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const a = await forms.createForm(ctx, { name: 'Alpha', tags: ['hr'], fields: FIELDS })
    await forms.createForm(ctx, { name: 'Beta', fields: FIELDS })
    const all = await forms.listForms(ctx, {}, page)
    expect(all.forms.map((f) => f.name).sort()).toEqual(['Alpha', 'Beta'])
    expect(all.forms.find((f) => f.id === a.id)).toMatchObject({ field_count: 2, usage_count: 0, theme_source: 'workspace' })
    expect((await forms.listForms(ctx, { tag: 'HR' }, page)).forms.map((f) => f.id)).toEqual([a.id])
    await expect(forms.getForm(ctx, FORM_B)).rejects.toMatchObject({ status: 404 })
    await expect(forms.updateForm(ctx, FORM_B, { name: 'pwn' })).rejects.toMatchObject({ status: 404 })
    await expect(forms.deleteForm(ctx, FORM_B)).rejects.toMatchObject({ status: 404 })
    await expect(forms.getFormTheme(ctx, THEME_B)).rejects.toMatchObject({ status: 404 })
    expect(supabase.tables.forms.find((row) => row.id === FORM_B)?.name).toBe('Foreign form')
  })

  it('bumps the version (and snapshots it) only when fields, layout or theme change', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const form = await forms.createForm(ctx, { name: 'Review', fields: FIELDS })

    const renamed = await forms.updateForm(ctx, form.id, { name: 'Review 2', description: 'x', tags: ['a'] })
    expect(renamed).toMatchObject({ name: 'Review 2', version: 1, version_changed: false })
    expect(supabase.tables.form_versions).toHaveLength(1)

    const same = await forms.updateForm(ctx, form.id, { fields: FIELDS })
    expect(same).toMatchObject({ version: 1, version_changed: false })

    const changed = await forms.updateForm(ctx, form.id, { fields: [...FIELDS, { key: 'amount', label: 'Amount', type: 'number' }] })
    expect(changed).toMatchObject({ version: 2, version_changed: true })
    const themed = await forms.updateForm(ctx, form.id, { theme: { source: 'saved', theme_id: THEME_A } })
    expect(themed).toMatchObject({ version: 3, theme: { source: 'saved', theme_id: THEME_A } })

    const versions = await forms.listFormVersions(ctx, form.id, page)
    expect(versions.versions.map((v) => v.version)).toEqual([3, 2, 1])
    expect(versions.total).toBe(3)
    const v1 = await forms.getFormVersion(ctx, form.id, 1)
    expect((v1.fields as any[]).map((f) => f.key)).toEqual(['decision', 'comments'])
    expect((await forms.getFormVersion(ctx, form.id, 2)).fields).toHaveLength(3)
    await expect(forms.getFormVersion(ctx, form.id, 9)).rejects.toMatchObject({ status: 404 })
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ objectType: 'form', action: 'update', summary: 'Updated form "Review 2" (version 2)' }))
  })

  it('duplicates into a new form at version 1', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const form = await forms.createForm(ctx, { name: 'Review', tags: ['ap'], fields: FIELDS })
    await forms.updateForm(ctx, form.id, { fields: FIELDS.slice(0, 1) })
    const copy = await forms.duplicateForm(ctx, form.id)
    expect(copy).toMatchObject({ name: 'Review (copy)', version: 1, tags: ['ap'] })
    expect(copy.id).not.toBe(form.id)
    expect((copy.fields as any[]).map((f) => f.key)).toEqual(['decision'])
    expect((await forms.duplicateForm(ctx, form.id, 'Named')).name).toBe('Named')
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ objectType: 'form', action: 'duplicate', metadata: expect.objectContaining({ source_id: form.id }) }))
  })
})

describe('forms service: usages and delete', () => {
  it('refuses to delete a form a workflow draft links, listing the usages', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const form = await forms.createForm(ctx, { name: 'Review', fields: FIELDS })
    supabase.tables.workflows.push({ id: 'wf-1', tenant_id: 'tenant-a', name: 'Invoices', trigger_config: {}, nodes: [{ id: 'n1', type: 'user_task', label: 'Approve', config: { form_id: form.id } }] })
    expect(await forms.getFormUsages(ctx, form.id)).toEqual([
      { workflow_id: 'wf-1', workflow_name: 'Invoices', node_id: 'n1', node_label: 'Approve', node_type: 'user_task', where: 'draft', pinned_version: null },
    ])
    expect((await forms.getForm(ctx, form.id)).usages).toHaveLength(1)
    expect((await forms.listForms(ctx, {}, page)).forms[0].usage_count).toBe(1)
    await expect(forms.deleteForm(ctx, form.id)).rejects.toMatchObject({
      status: 409, message: expect.stringContaining('Invoices › Approve'), details: { usages: [expect.objectContaining({ workflow_id: 'wf-1' })] },
    })
    expect(supabase.tables.forms.some((row) => row.id === form.id)).toBe(true)
  })

  it('refuses while an active published version pins the form, deletes once unused', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const form = await forms.createForm(ctx, { name: 'Review', fields: FIELDS })
    supabase.tables.workflows.push({ id: 'wf-1', tenant_id: 'tenant-a', name: 'Invoices', trigger_config: {}, nodes: [] })
    supabase.tables.workflow_versions.push({ id: 'v1', tenant_id: 'tenant-a', workflow_id: 'wf-1', is_active: true, trigger_config: {}, nodes: [{ id: 'n1', type: 'task_completed', label: 'Done', config: { form_id: form.id, form_version: 1 } }] })
    const usages = await forms.getFormUsages(ctx, form.id)
    expect(usages).toEqual([expect.objectContaining({ where: 'published', pinned_version: 1, workflow_name: 'Invoices' })])
    await expect(forms.deleteForm(ctx, form.id)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('(published)') })

    supabase.tables.workflow_versions[0].is_active = false
    expect(await forms.deleteForm(ctx, form.id)).toEqual({ deleted: true, id: form.id })
    expect(supabase.tables.forms.some((row) => row.id === form.id)).toBe(false)
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ objectType: 'form', action: 'delete', objectId: form.id }))
    expect(recordAssetChange).toHaveBeenCalledWith(expect.objectContaining({ assetType: 'form', assetId: form.id, action: 'delete' }))
  })
})

describe('form themes', () => {
  it('creates, updates and validates themes', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const theme = await forms.createFormTheme(ctx, { name: 'Calm', overrides: { radius: 6, density: 'compact' } })
    expect(theme).toMatchObject({ name: 'Calm', overrides: { radius: 6, density: 'compact' } })
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ objectType: 'form_theme', action: 'create' }))
    expect(recordAssetChange).toHaveBeenCalledWith(expect.objectContaining({ assetType: 'form_theme', assetId: theme.id }))
    expect((await forms.updateFormTheme(ctx, theme.id, { overrides: { radius: 10 } })).overrides).toEqual({ radius: 10 })
    await expect(forms.createFormTheme(ctx, { name: 'Bad', overrides: { radius: 99 } })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Invalid form theme/) })
    await expect(forms.createFormTheme(ctx, { name: 'Bad', overrides: { unknown: true } })).rejects.toMatchObject({ status: 400 })
    const listed = await forms.listFormThemes(ctx, {}, page)
    expect(listed.form_themes.map((t) => t.name).sort()).toEqual(['Brand', 'Calm'])
  })

  it('refuses to delete a theme a form or a step uses', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const form = await forms.createForm(ctx, { name: 'Themed', fields: FIELDS, theme: { source: 'saved', theme_id: THEME_A } })
    await expect(forms.deleteFormTheme(ctx, THEME_A)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('form "Themed"') })

    await forms.updateForm(ctx, form.id, { theme: { source: 'workspace' } })
    supabase.tables.workflows.push({ id: 'wf-1', tenant_id: 'tenant-a', name: 'Intake', trigger_config: {}, nodes: [{ id: 'n1', type: 'user_task', label: 'Step', config: { fields: FIELDS, form_theme: { source: 'saved', theme_id: THEME_A } } }] })
    await expect(forms.deleteFormTheme(ctx, THEME_A)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Intake › Step') })

    supabase.tables.workflows[0].nodes = [{ id: 't', type: 'manual', config: { start_form: { theme: { source: 'saved', theme_id: THEME_A } } } }]
    await expect(forms.deleteFormTheme(ctx, THEME_A)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Intake › Start form') })

    supabase.tables.workflows[0].nodes = []
    expect(await forms.deleteFormTheme(ctx, THEME_A)).toEqual({ deleted: true, id: THEME_A })
    expect(supabase.tables.form_themes.map((t) => t.id)).toEqual([THEME_B])
  })
})

describe('forms runtime', () => {
  it('pinWorkflowForms pins linked steps to the current version (unlinked steps untouched)', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const form = await forms.createForm(ctx, { name: 'Review', fields: FIELDS })
    await forms.updateForm(ctx, form.id, { fields: FIELDS.slice(0, 1) })
    const nodes = [
      { id: 'n1', type: 'user_task', config: { form_id: form.id, fields: FIELDS } },
      { id: 'n2', type: 'user_task', config: { fields: FIELDS } },
      { id: 'n3', type: 'user_task', config: { form_id: 'gone-form', fields: FIELDS } },
      { id: 'n4', type: 'send_email', config: { form_id: form.id } },
    ]
    const trigger = { schedule: null }
    const pinned = await forms.pinWorkflowForms(supabase as any, 'tenant-a', nodes, trigger) as { nodes: any[]; trigger_config: unknown }
    expect(pinned.nodes[0].config.form_version).toBe(2)
    expect(pinned.nodes[1].config).not.toHaveProperty('form_version')
    expect(pinned.nodes[2].config).not.toHaveProperty('form_version')
    expect(pinned.nodes[3].config).not.toHaveProperty('form_version')
    expect(pinned.trigger_config).toBe(trigger)
    // The draft itself is not changed.
    expect(nodes[0].config).not.toHaveProperty('form_version')
    // Another workspace's form id is never pinned.
    const foreign = await forms.pinWorkflowForms(supabase as any, 'tenant-a', [{ id: 'x', type: 'user_task', config: { form_id: FORM_B } }], {}) as { nodes: any[] }
    expect(foreign.nodes[0].config).not.toHaveProperty('form_version')
  })

  it('resolveRuntimeForm: pinned version, else latest, else the node cache; saved themes resolve to overrides', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const form = await forms.createForm(ctx, { name: 'Review', fields: FIELDS, theme: { source: 'saved', theme_id: THEME_A } })
    await forms.updateForm(ctx, form.id, { name: 'Review v2', fields: FIELDS.slice(1) })
    const cache = [{ key: 'cached', label: 'Cached', type: 'text' }]

    const pinned = await forms.resolveRuntimeForm(supabase as any, 'tenant-a', { form_id: form.id, form_version: 1, fields: cache })
    expect(pinned).toMatchObject({ form_id: form.id, version: 1, form_name: 'Review', theme_overrides: { radius: 12 } })
    expect(pinned.fields.map((f) => f.key)).toEqual(['decision', 'comments'])

    const latest = await forms.resolveRuntimeForm(supabase as any, 'tenant-a', { form_id: form.id, fields: cache })
    expect(latest).toMatchObject({ version: 2, form_name: 'Review v2' })
    expect(latest.fields.map((f) => f.key)).toEqual(['comments'])

    // A pinned version that no longer exists falls back to the latest.
    expect((await forms.resolveRuntimeForm(supabase as any, 'tenant-a', { form_id: form.id, form_version: 7, fields: cache })).version).toBe(2)

    const gone = await forms.resolveRuntimeForm(supabase as any, 'tenant-a', { form_id: 'deleted-form', form_name: 'Old', fields: cache })
    expect(gone).toMatchObject({ form_id: 'deleted-form', form_name: 'Old', version: null, theme_overrides: null })
    expect(gone.fields.map((f) => f.key)).toEqual(['cached'])

    // Another workspace's form is "gone" from this workspace's point of view.
    const foreign = await forms.resolveRuntimeForm(supabase as any, 'tenant-a', { form_id: FORM_B, fields: cache })
    expect(foreign.fields.map((f) => f.key)).toEqual(['cached'])

    const own = await forms.resolveRuntimeForm(supabase as any, 'tenant-a', { fields: cache, form_theme: { source: 'custom', overrides: { radius: 3 } } })
    expect(own).toMatchObject({ form_id: null, version: null, theme_overrides: { radius: 3 } })
  })
})

describe('forms in manifests', () => {
  it('applyFormManifest creates, then updates as a new version only on content change', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const asset = { id: 'src-1', name: 'Imported', description: null, tags: ['x'], fields: FIELDS, layout: null, theme: { source: 'workspace' }, version: 9 }
    const created = await forms.applyFormManifest(ctx, asset, null)
    expect(created).toMatchObject({ name: 'Imported', version: 1 })
    expect(writeAudit).not.toHaveBeenCalled()
    const again = await forms.applyFormManifest(ctx, asset, created.id)
    expect(again.version).toBe(1)
    const changed = await forms.applyFormManifest(ctx, { ...asset, fields: FIELDS.slice(0, 1) }, created.id)
    expect(changed.version).toBe(2)
  })

  it('remaps form_id and theme_id through the id maps, leaving unknown ids alone', () => {
    const maps = createEmptyAssetIdMaps()
    maps.form['src-form'] = 'local-form'
    maps.form_theme['src-theme'] = 'local-theme'
    const workflow = {
      nodes: [
        { id: 'n1', type: 'user_task', config: { form_id: 'src-form', form_theme: { source: 'saved', theme_id: 'src-theme' } } },
        { id: 't', type: 'manual', config: { start_form: { theme: { source: 'saved', theme_id: 'src-theme' } } } },
        { id: 'n2', type: 'user_task', config: { form_id: 'other', form_theme: { source: 'saved', theme_id: 'other-theme' } } },
      ],
    }
    const out = remapKnownIds(workflow, maps)
    expect(out.nodes[0].config).toEqual({ form_id: 'local-form', form_theme: { source: 'saved', theme_id: 'local-theme' } })
    expect(out.nodes[1].config.start_form!.theme.theme_id).toBe('local-theme')
    expect(out.nodes[2].config).toEqual(workflow.nodes[2].config)
  })

  it('strips published form_version pins from workflow drafts, and normalises forms like the import', () => {
    const wf = { name: 'W', nodes: [{ id: 'n1', type: 'user_task', config: { form_id: 'f', form_version: 3 } }, { id: 'n2', type: 'manual', config: {} }] }
    const stripped = stripWorkflowFormPins(wf)
    expect(stripped.nodes[0].config).toEqual({ form_id: 'f' })
    expect(stripped.nodes[1]).toBe(wf.nodes[1])
    const untouched = { name: 'W', nodes: [{ id: 'n1', type: 'user_task', config: { form_id: 'f' } }] }
    expect(stripWorkflowFormPins(untouched)).toBe(untouched)

    const normalized = normalizeFormAssetLikeImport({ id: 'x', name: 'F', tags: ['A', 'a', ' B '], description: '  ', fields: FIELDS, version: 4 })
    expect(normalized).toMatchObject({ tags: ['a', 'b'], description: null, layout: null, theme: { source: 'workspace' } })
    expect(normalized).not.toHaveProperty('version')
  })
})
