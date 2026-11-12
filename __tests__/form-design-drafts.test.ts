/* eslint-disable @typescript-eslint/no-explicit-any -- memory table rows */
/**
 * Form drafts (lib/services/form-design-drafts.ts) against the in-memory
 * PostgREST stand-in: saving writes the draft and end users keep the
 * published version, publishing bumps the version and snapshots it,
 * validation blocks publishing, discard, reviewer access granted and
 * revoked (enforced in the service), workflow drafts / test runs follow
 * the published form unless "Use form drafts", the behaviour before the
 * migration (save = live), the compare summary, and the API / MCP / CLI
 * contract.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))

import { writeAudit } from '@/lib/audit-log'
import { sendEmail } from '@/lib/email'
import type { ServiceContext } from '@/lib/services/context'
import * as forms from '@/lib/services/forms'
import * as drafts from '@/lib/services/form-design-drafts'
import { diffFormContent } from '@/lib/forms/draft-diff'
import { createMemorySupabase } from './fixtures/supabase-memory'

const TENANT = 'tenant-a'
const FORM = '44444444-4444-4444-8444-444444444444'
const ANA = '11111111-1111-4111-8111-111111111111'
const BEN = '22222222-2222-4222-8222-222222222222'
const CARA = '33333333-3333-4333-8333-333333333333'
const TEAM = '55555555-5555-4555-8555-555555555555'

const V1 = [
  { key: 'amount', label: 'Amount', type: 'currency', currency: 'USD', required: true },
  { key: 'reason', label: 'Reason', type: 'textarea' },
]
const V2 = [...V1, { key: 'cost_center', label: 'Cost center', type: 'text' }]

function seed() {
  return createMemorySupabase({
    tenants: [{ id: TENANT, name: 'A', settings: {} }],
    users: [
      { id: ANA, display_name: 'Ana', email: 'ana@example.com' },
      { id: BEN, display_name: 'Ben', email: 'ben@example.com' },
      { id: CARA, display_name: 'Cara', email: 'cara@example.com' },
    ],
    user_memberships: [ANA, BEN, CARA].map((user_id) => ({ tenant_id: TENANT, user_id, is_active: true })),
    teams: [{ id: TEAM, tenant_id: TENANT, name: 'Finance' }],
    user_teams: [{ team_id: TEAM, user_id: CARA }],
    forms: [{ id: FORM, tenant_id: TENANT, name: 'Expense claim', description: null, tags: [], fields: V1, layout: null, theme: { source: 'workspace' }, buttons: null, header: null, version: 1, created_at: '2026-01-01', updated_at: '2026-01-01' }],
    form_versions: [{ id: 'v1', tenant_id: TENANT, form_id: FORM, version: 1, name: 'Expense claim', fields: V1, layout: null, theme: { source: 'workspace' }, buttons: null, header: null, created_by: ANA, created_at: '2026-01-01' }],
    form_design_drafts: [],
    form_design_draft_reviewers: [],
    form_themes: [],
    workspace_themes: [],
    workflows: [],
    workflow_versions: [],
    notifications: [],
  }, { uuids: true })
}

type Db = ReturnType<typeof createMemorySupabase>

const EDIT = ['forms.view', 'forms.edit', 'forms.delete', 'forms.submit']
const ctx = (db: unknown, actorId: string, permissions: string[] = EDIT): ServiceContext => ({ supabase: db as any, tenantId: TENANT, actorId, permissions: new Set(permissions), authKind: 'api_key', source: 'api' })

/** The memory stand-in with the drafts tables missing (the migration not applied). */
function withoutDraftTables(db: Db) {
  const missing = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.form_design_drafts' in the schema cache" }, count: null }
  const chain: any = new Proxy({}, { get: (_t, prop) => (prop === 'then' ? (resolve: (v: unknown) => void) => resolve(missing) : () => chain) })
  return new Proxy(db as any, {
    get(target, prop) {
      if (prop === 'from') return (table: string) => (table.startsWith('form_design_draft') ? chain : target.from(table))
      return target[prop]
    },
  })
}

describe('form drafts: save and publish', () => {
  let db: Db
  beforeEach(() => { db = seed(); drafts.resetDesignDraftAvailability(); vi.mocked(writeAudit).mockClear(); vi.mocked(sendEmail).mockClear() })

  it('saving writes the draft; end users, workflow drafts and the default reads keep the published version', async () => {
    const saved = await drafts.saveDesignDraft(ctx(db, ANA), FORM, { fields: V2 })
    expect(saved.mode).toBe('draft')
    if (saved.mode !== 'draft') return
    expect(saved.draft.base_version).toBe(1)
    expect(saved.draft.summary.updated_by).toEqual({ id: ANA, name: 'Ana' })
    expect(saved.publish_problems).toEqual([])
    // The published row is untouched.
    const row = (await db.from('forms').select('*').eq('id', FORM).single()).data
    expect(row.version).toBe(1)
    expect(row.fields.map((f: any) => f.key)).toEqual(['amount', 'reason'])
    // Default reads: published, for everyone; editors see that a draft exists.
    const member = await forms.getForm(ctx(db, BEN, ['forms.view']), FORM)
    expect(member.fields.map((f: any) => f.key)).toEqual(['amount', 'reason'])
    expect((member as any).draft).toBeUndefined()
    const editor = await forms.getForm(ctx(db, BEN), FORM)
    expect(editor.fields.map((f: any) => f.key)).toEqual(['amount', 'reason'])
    expect((editor as any).draft.updated_by.name).toBe('Ana')
    // ?version=draft: editors only.
    const draftRead = await forms.getForm(ctx(db, BEN), FORM, { version: 'draft' })
    expect(draftRead.fields.map((f: any) => f.key)).toEqual(['amount', 'reason', 'cost_center'])
    expect((draftRead as any).content).toBe('draft')
    await expect(forms.getForm(ctx(db, BEN, ['forms.view']), FORM, { version: 'draft' })).rejects.toMatchObject({ status: 403 })
    // The runtime (task forms, workflow drafts, test runs): published unless the test run uses drafts.
    const runtime = await forms.resolveRuntimeForm(db as any, TENANT, { form_id: FORM })
    expect(runtime.fields.map((f) => f.key)).toEqual(['amount', 'reason'])
    const testWithDraft = await forms.resolveRuntimeForm(db as any, TENANT, { form_id: FORM }, { useDraft: true })
    expect(testWithDraft.fields.map((f) => f.key)).toEqual(['amount', 'reason', 'cost_center'])
    // A pinned (published workflow) step never sees the draft.
    const pinned = await forms.resolveRuntimeForm(db as any, TENANT, { form_id: FORM, form_version: 1 }, { useDraft: true })
    expect(pinned.fields.map((f) => f.key)).toEqual(['amount', 'reason'])
    // The library marks it.
    const list = await forms.listForms(ctx(db, BEN, ['forms.view']), {}, { limit: 50, offset: 0 })
    expect(list.forms[0]).toMatchObject({ id: FORM, has_draft: true, version: 1 })
  })

  it('one shared draft: other editors open it, and a stale save is refused', async () => {
    const first = await drafts.saveDesignDraft(ctx(db, ANA), FORM, { fields: V2, expected_updated_at: null })
    if (first.mode !== 'draft') throw new Error('expected a draft')
    // Ben opened the form before Ana's draft existed: his save is refused (he would fork / overwrite it).
    await expect(drafts.saveDesignDraft(ctx(db, BEN), FORM, { fields: V1, expected_updated_at: null })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Ana started a draft') })
    // He reloads: the same draft.
    const view = await drafts.getDesignDraft(ctx(db, BEN), FORM)
    expect(view.draft?.fields.map((f: any) => f.key)).toEqual(['amount', 'reason', 'cost_center'])
    // Saving against a different stamp is refused.
    await expect(drafts.saveDesignDraft(ctx(db, BEN), FORM, { fields: V1, expected_updated_at: '1999-01-01T00:00:00Z' })).rejects.toMatchObject({ status: 409 })
    // Partial input keeps the rest of the draft.
    const themed = await drafts.saveDesignDraft(ctx(db, BEN), FORM, { theme: { source: 'custom', overrides: { radius: 4 } } })
    if (themed.mode !== 'draft') throw new Error('expected a draft')
    expect(themed.draft.fields.map((f: any) => f.key)).toEqual(['amount', 'reason', 'cost_center'])
    expect(themed.draft.summary.updated_by?.name).toBe('Ben')
    expect((await db.from('form_design_drafts').select('*')).data).toHaveLength(1)
  })

  it('publish bumps the version, snapshots it with the note and clears the draft', async () => {
    await drafts.saveDesignDraft(ctx(db, ANA), FORM, { fields: V2 })
    const published = await drafts.publishDesignDraft(ctx(db, ANA), FORM, { note: 'Adds the cost center' })
    expect(published).toMatchObject({ version: 2, version_changed: true, note: 'Adds the cost center' })
    const row = (await db.from('forms').select('*').eq('id', FORM).single()).data
    expect(row.version).toBe(2)
    expect(row.fields.map((f: any) => f.key)).toEqual(['amount', 'reason', 'cost_center'])
    const snapshot = (await db.from('form_versions').select('*').eq('form_id', FORM).eq('version', 2).single()).data
    expect(snapshot).toMatchObject({ note: 'Adds the cost center', created_by: ANA })
    expect((await db.from('form_design_drafts').select('*')).data).toEqual([])
    // Audited as a publish (→ the event stream's audit.form.publish).
    expect(vi.mocked(writeAudit).mock.calls.map(([a]) => a.action)).toContain('publish')
    // Nothing left to publish.
    await expect(drafts.publishDesignDraft(ctx(db, ANA), FORM)).rejects.toMatchObject({ status: 404 })
    // End users now get version 2.
    expect((await forms.resolveRuntimeForm(db as any, TENANT, { form_id: FORM })).version).toBe(2)
  })

  it('validation blocks publishing with the problem, and the draft and the published form stay as they were', async () => {
    const broken = [...V1, { key: 'department', label: 'Department', type: 'choice', options: [] }]
    const saved = await drafts.saveDesignDraft(ctx(db, ANA), FORM, { fields: broken })
    if (saved.mode !== 'draft') throw new Error('expected a draft')
    expect(saved.publish_problems.length).toBeGreaterThan(0)
    expect(saved.publish_problems[0]).toContain('department')
    await expect(drafts.publishDesignDraft(ctx(db, ANA), FORM)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^Can't publish: Field "department"/) })
    expect((await db.from('forms').select('version').eq('id', FORM).single()).data.version).toBe(1)
    expect((await db.from('form_design_drafts').select('*')).data).toHaveLength(1)
    // Publishing needs forms.edit.
    await expect(drafts.publishDesignDraft(ctx(db, BEN, ['forms.view']), FORM)).rejects.toMatchObject({ status: 403 })
  })

  it('discard throws the draft away and leaves the published form', async () => {
    await drafts.saveDesignDraft(ctx(db, ANA), FORM, { fields: V2 })
    expect(await drafts.discardDesignDraft(ctx(db, ANA), FORM)).toEqual({ discarded: true, form_id: FORM })
    expect((await db.from('form_design_drafts').select('*')).data).toEqual([])
    expect((await db.from('forms').select('version').eq('id', FORM).single()).data.version).toBe(1)
    await expect(drafts.discardDesignDraft(ctx(db, ANA), FORM)).rejects.toMatchObject({ status: 404 })
  })

  it('restore as draft copies a version into the draft', async () => {
    await drafts.saveDesignDraft(ctx(db, ANA), FORM, { fields: V2 })
    await drafts.publishDesignDraft(ctx(db, ANA), FORM)
    const restored = await drafts.restoreFormVersionAsDraft(ctx(db, ANA), FORM, 1)
    expect(restored.draft.fields.map((f: any) => f.key)).toEqual(['amount', 'reason'])
    expect(restored.draft.base_version).toBe(2)
    const compare = await drafts.compareDesignDraft(ctx(db, ANA), FORM)
    expect(compare.diff.fields.removed.map((f) => f.key)).toEqual(['cost_center'])
  })
})

describe('form drafts: reviewers', () => {
  let db: Db
  beforeEach(() => { db = seed(); drafts.resetDesignDraftAvailability(); vi.mocked(sendEmail).mockClear() })
  const MEMBER = ['forms.submit']

  it('grants a read-only preview to the people and teams it names, enforced in the service, and revokes it', async () => {
    // Nothing to share before there is a draft.
    await expect(drafts.addDraftReviewers(ctx(db, ANA), FORM, { principals: [{ type: 'user', id: BEN }] })).rejects.toMatchObject({ status: 409 })
    await drafts.saveDesignDraft(ctx(db, ANA), FORM, { fields: V2 })
    // No access yet (404, not 403: the draft's existence is not revealed).
    await expect(drafts.getDraftPreview(ctx(db, BEN, MEMBER), FORM)).rejects.toMatchObject({ status: 404 })
    // Sharing needs forms.edit.
    await expect(drafts.addDraftReviewers(ctx(db, BEN, ['forms.view']), FORM, { principals: [{ type: 'user', id: BEN }] })).rejects.toMatchObject({ status: 403 })

    const shared = await drafts.addDraftReviewers(ctx(db, ANA), FORM, { principals: [{ type: 'user', id: BEN }, { type: 'team', id: TEAM }], note: 'Check the new field' })
    expect(shared.added.map((r) => r.name).sort()).toEqual(['Ben', 'Finance'])
    expect(shared.notified).toBe(2)
    expect(shared.preview_path).toBe(`/forms/${FORM}/draft-preview`)
    const notes = (await db.from('notifications').select('*')).data as any[]
    expect(notes.map((n) => [n.user_id, n.type, n.form_id]).sort()).toEqual([[BEN, 'form_draft_shared', FORM], [CARA, 'form_draft_shared', FORM]].sort())
    expect(notes[0].title).toContain('Ana shared a form draft with you')
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1) // Ben, named directly

    // Ben (a person) and Cara (through Finance) may preview it without forms.edit; the draft content comes back.
    const ben = await drafts.getDraftPreview(ctx(db, BEN, MEMBER), FORM)
    expect(ben).toMatchObject({ access: 'reviewer', shared_by: { id: ANA, name: 'Ana' }, form: { published_version: 1 } })
    expect((ben.definition.fields as any[]).map((f) => f.key)).toEqual(['amount', 'reason', 'cost_center'])
    expect((await drafts.getDraftPreview(ctx(db, CARA, []), FORM)).access).toBe('reviewer')
    // Editors may always preview.
    expect((await drafts.getDraftPreview(ctx(db, ANA), FORM)).access).toBe('editor')
    // Reviewers cannot read the draft through the editor reads.
    await expect(drafts.getDesignDraft(ctx(db, BEN, MEMBER), FORM)).rejects.toMatchObject({ status: 403 })

    // Removed → no access.
    const benRow = (await drafts.listDraftReviewers(ctx(db, ANA), FORM)).reviewers.find((r) => r.principal_id === BEN)!
    await drafts.removeDraftReviewer(ctx(db, ANA), FORM, { id: benRow.id })
    await expect(drafts.getDraftPreview(ctx(db, BEN, MEMBER), FORM)).rejects.toMatchObject({ status: 404 })
    expect((await drafts.getDraftPreview(ctx(db, CARA, []), FORM)).access).toBe('reviewer')

    // Published → the draft (and so every reviewer's access) is gone. (The table cascades; the memory stand-in doesn't.)
    await drafts.publishDesignDraft(ctx(db, ANA), FORM)
    await expect(drafts.getDraftPreview(ctx(db, CARA, []), FORM)).rejects.toMatchObject({ status: 404, message: expect.stringContaining('published or discarded') })
  })

  it('refuses people and teams outside the workspace', async () => {
    await drafts.saveDesignDraft(ctx(db, ANA), FORM, { fields: V2 })
    await expect(drafts.addDraftReviewers(ctx(db, ANA), FORM, { principals: [{ type: 'user', id: '99999999-9999-4999-8999-999999999999' }] })).rejects.toMatchObject({ status: 400 })
    await expect(drafts.addDraftReviewers(ctx(db, ANA), FORM, { principals: [{ type: 'role', id: TEAM }] })).rejects.toMatchObject({ status: 400 })
  })
})

describe('form drafts before the migration is applied', () => {
  beforeEach(() => drafts.resetDesignDraftAvailability())

  it('saving publishes straight away (as before), draft reads are empty and draft actions explain why', async () => {
    const memory = seed()
    const db = withoutDraftTables(memory)
    expect(await drafts.designDraftsAvailable(db)).toBe(false)
    const saved = await drafts.saveDesignDraft(ctx(db, ANA), FORM, { fields: V2, expected_updated_at: null })
    expect(saved.mode).toBe('live')
    if (saved.mode !== 'live') return
    expect(saved.form.version).toBe(2)
    expect((await forms.resolveRuntimeForm(db, TENANT, { form_id: FORM }, { useDraft: true })).version).toBe(2)
    const view = await drafts.getDesignDraft(ctx(db, ANA), FORM)
    expect(view).toMatchObject({ available: false, draft: null })
    const got = await forms.getForm(ctx(db, ANA), FORM)
    expect((got as any).draft).toBeNull()
    expect((await forms.listForms(ctx(db, ANA), {}, { limit: 50, offset: 0 })).forms[0].has_draft).toBe(false)
    await expect(drafts.publishDesignDraft(ctx(db, ANA), FORM)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('20270110000000') })
    await expect(drafts.getDraftPreview(ctx(db, BEN, ['forms.submit']), FORM)).rejects.toMatchObject({ status: 404 })
  })
})

describe('compare with published', () => {
  it('summarises fields, rules, layout, theme, buttons and header', () => {
    const published = {
      fields: V1, layout: { rows: [{ columns: 1, cells: [{ field_key: 'amount', span: 1 }] }], rules: [{ id: 'r1', name: 'Big amounts', event: 'value_change', then: [] }, { id: 'r2', name: 'Old', event: 'always', then: [] }] },
      theme: { source: 'workspace' }, buttons: null, header: null,
    }
    const draft = {
      fields: [{ ...V1[0], label: 'Total', required: false }, { key: 'notes', label: 'Notes', type: 'textarea' }],
      layout: { rows: [{ columns: 2, cells: [{ field_key: 'amount', span: 1 }] }], rules: [{ id: 'r1', name: 'Big amounts', event: 'value_change', then: [{ type: 'message', text: 'Over USD 500' }] }, { id: 'r3', name: 'New', event: 'always', then: [] }] },
      theme: { source: 'custom', overrides: { radius: 4 } }, buttons: [{ id: 'submit', label: 'Send', kind: 'submit' }], header: { enabled: true, title: 'Claim' },
    }
    const diff = diffFormContent(published, draft)
    expect(diff.fields.added.map((f) => f.key)).toEqual(['notes'])
    expect(diff.fields.removed.map((f) => f.key)).toEqual(['reason'])
    expect(diff.fields.changed).toEqual([{ key: 'amount', label: 'Total', settings: ['label', 'required'] }])
    expect(diff.rules).toEqual({ added: ['New'], removed: ['Old'], changed: ['Big amounts'] })
    expect(diff).toMatchObject({ layout_changed: true, theme_changed: true, buttons_changed: true, header_changed: true, unchanged: false })
    expect(diff.lines[0]).toBe('Added 1 field: “Notes”')
    expect(diffFormContent(published, JSON.parse(JSON.stringify(published)))).toMatchObject({ unchanged: true, lines: ['No changes from the published version'] })
  })
})

describe('surfaces: REST, MCP, CLI', () => {
  it('registers the draft endpoints, tools and commands with forms.edit', async () => {
    const schemas = await import('@/lib/api-schemas/forms')
    const byOp = new Map(schemas.formEndpoints.map((e) => [e.operationId, e]))
    for (const [op, method, path] of [
      ['getFormDraft', 'GET', '/forms/{id}/draft'], ['saveFormDraft', 'PUT', '/forms/{id}/draft'], ['discardFormDraft', 'DELETE', '/forms/{id}/draft'],
      ['compareFormDraft', 'GET', '/forms/{id}/draft/compare'], ['publishFormDraft', 'POST', '/forms/{id}/publish'],
      ['listFormDraftReviewers', 'GET', '/forms/{id}/draft/reviewers'], ['addFormDraftReviewers', 'POST', '/forms/{id}/draft/reviewers'],
      ['removeFormDraftReviewer', 'DELETE', '/forms/{id}/draft/reviewers/{reviewerId}'], ['restoreFormVersionAsDraft', 'POST', '/forms/{id}/versions/{version}/restore'],
    ] as const) {
      expect(byOp.get(op), op).toMatchObject({ method, path, permission: 'forms.edit' })
    }
    // GET /forms/{id}?version=draft (the CLI flag is --content-version: --version is global).
    const get = byOp.get('getForm')!
    expect((get.query as any).parse({ version: 'draft' })).toEqual({ version: 'draft' })
    expect(get.cli?.flags).toEqual({ version: 'content-version' })
    const { COMMAND_SPECS: COMMANDS } = await import('@/packages/cli/src/generated/commands') as any
    const names = (COMMANDS as any[]).map((c) => `${c.resource} ${c.verb}`)
    expect(names).toEqual(expect.arrayContaining(['forms publish', 'forms draft', 'forms draft-save', 'forms draft-discard', 'forms draft-share', 'forms version-restore']))
    expect((COMMANDS as any[]).find((c) => c.operationId === 'getForm').query).toEqual([expect.objectContaining({ name: 'version', flag: 'content-version' })])

    const { TOOL_PERMISSIONS, READ_TOOL_PERMISSIONS } = await import('@/lib/mcp/authz')
    for (const tool of ['forms_draft_save', 'forms_publish', 'forms_draft_discard', 'forms_draft_reviewers_add', 'forms_draft_reviewers_remove', 'forms_version_restore']) expect(TOOL_PERMISSIONS[tool], tool).toBe('forms.edit')
    for (const tool of ['forms_draft_get', 'forms_draft_compare', 'forms_draft_reviewers_list']) expect(READ_TOOL_PERMISSIONS[tool], tool).toBe('forms.edit')
  })

  it('the Agent saves form edits into the draft and publishing is a confirmed write', async () => {
    const { draftOnlyArgs, FORBIDDEN_ARGS } = await import('@/lib/assistants/tools/designer')
    expect(draftOnlyArgs('forms_update', { form_id: FORM, fields: V2, save_to: 'published' })).toMatchObject({ save_to: 'draft' })
    expect(FORBIDDEN_ARGS.forms_update).toContain('save_to')
    const { DESIGNER_WRITE_TOOLS } = await import('@/lib/assistants/types')
    expect(DESIGNER_WRITE_TOOLS as readonly string[]).toContain('forms_publish')
  })
})
