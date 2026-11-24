/**
 * Tags on every object type (migration 20270122150000_tags_everywhere):
 *
 *  - tag lists are tidied, de-duplicated case-insensitively and bounded
 *    (normalizeTagList / manifestTags); list filters match the usual case
 *    variants (tagFilterValues);
 *  - each type's own service accepts and normalises `tags` on create /
 *    update behind that type's edit permission: data tables
 *    (data.edit_schema), business rules and email templates
 *    (workflows.edit), form controls (extensibility.edit), packages
 *    (packages.manage), reports (reports.edit_own, and only the creator);
 *    apps validate tags in their schema;
 *  - list services filter by tag;
 *  - before the migration is applied, reads degrade to untagged rows and
 *    writes of real tags answer "apply migration …";
 *  - the row "Tags…" path (applyObjectTags) routes every new type through
 *    its own service; apps defer to the app's editors;
 *  - Settings → Tags covers every type with its view permission; reports,
 *    apps and packages are listed by their own read rules;
 *  - every create / update / list endpoint carries tags and the tag filter.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))

import { recordAssetChange } from '@/lib/github-sync/enqueue'
import type { ServiceContext } from '@/lib/services/context'
import { manifestTags, normalizeTagList, tagFilterValues, hasTag, TagListError } from '@/lib/tags/normalize'
import { TAG_EDIT_PERMISSIONS, TAG_OBJECT_TYPE_KEYS } from '@/lib/tags/object-types'
import { isMissingTagsColumn, selectWithTags, tagsSafeWrite, withTags } from '@/lib/services/tags-column'
import * as dataTables from '@/lib/services/data-tables'
import * as decisionTables from '@/lib/services/decision-tables'
import * as emailTemplates from '@/lib/services/email-templates'
import * as formControls from '@/lib/services/form-controls'
import * as packages from '@/lib/services/packages'
import * as reports from '@/lib/services/reports'
import * as tags from '@/lib/services/tags'
import { TAGGABLE, TAGGABLE_TYPES, canEditTagsOf } from '@/lib/services/object-tags'
import { appCreateSchema, appUpdateSchema } from '@/lib/apps/schema'
import { API_ENDPOINTS } from '@/lib/api-schemas'
import { createMemorySupabase } from './fixtures/supabase-memory'

function ctx(db: any, permissions: string[], extra: Partial<ServiceContext> = {}): ServiceContext {
  return { db, supabase: db, tenantId: 'tenant-a', actorId: 'user-1', permissions: new Set(permissions), authKind: 'api_key', source: 'api', ...extra } as ServiceContext
}

const MISSING_TAGS = { code: '42703', message: 'column custom_tables.tags does not exist' }

describe('tag lists', () => {
  it('tidies, de-duplicates case-insensitively (first spelling wins) and drops blanks', () => {
    expect(normalizeTagList([' Finance ', 'finance', 'Cost   centre', '', null, 'HR'])).toEqual(['Finance', 'Cost centre', 'HR'])
    expect(normalizeTagList(undefined)).toEqual([])
    expect(normalizeTagList(null)).toEqual([])
  })

  it('refuses non-arrays, objects, over-long names and more than 30 tags', () => {
    expect(() => normalizeTagList('finance')).toThrow(TagListError)
    expect(() => normalizeTagList([{ a: 1 }])).toThrow(TagListError)
    expect(() => normalizeTagList(['x'.repeat(61)])).toThrow(/60 characters/)
    expect(() => normalizeTagList(Array.from({ length: 31 }, (_, i) => `t${i}`))).toThrow(/30 tags/)
  })

  it('manifest tags never throw: bad entries dropped, capped at 30', () => {
    expect(manifestTags(['ok', 5, 'x'.repeat(61), 'OK', ' two  words '])).toEqual(['ok', 'two words'])
    expect(manifestTags('nope')).toEqual([])
    expect(manifestTags(Array.from({ length: 40 }, (_, i) => `t${i}`))).toHaveLength(30)
  })

  it('list filters match the usual case variants; hasTag is case- and space-insensitive', () => {
    expect(tagFilterValues('finance')).toEqual(expect.arrayContaining(['finance', 'Finance', 'FINANCE']))
    expect(tagFilterValues('cost centre')).toEqual(expect.arrayContaining(['Cost Centre', 'Cost centre']))
    expect(tagFilterValues('  ')).toEqual([])
    expect(hasTag(['Cost  Centre'], 'cost centre')).toBe(true)
    expect(hasTag(['a'], 'b')).toBe(false)
  })
})

describe('before migration 20270122150000 is applied', () => {
  it('selects retry without tags when the column is missing', async () => {
    const run = vi.fn(async (columns: string) => (columns.includes('tags') ? { data: null, error: MISSING_TAGS } : { data: [{ id: 'x' }], error: null }))
    const result = await selectWithTags('id, name', run)
    expect(run.mock.calls.map((c) => c[0])).toEqual(['id, name, tags', 'id, name'])
    expect(result.data).toEqual([{ id: 'x' }])
    expect(withTags('*')).toBe('*')
    expect(isMissingTagsColumn({ code: '42703', message: 'column "other" does not exist' })).toBe(false)
  })

  it('writes drop an empty tag list and refuse real tags with "apply the migration"', async () => {
    const run = vi.fn(async (values: Record<string, unknown>) => ('tags' in values ? { data: null, error: MISSING_TAGS } : { data: values, error: null }))
    const ok = await tagsSafeWrite('data tables', { name: 'A', tags: [] }, 'id', run)
    expect(ok.data).toEqual({ name: 'A' })
    await expect(tagsSafeWrite('data tables', { name: 'A', tags: ['x'] }, 'id', run)).rejects.toThrow(/20270122150000/)
  })
})

describe('data tables', () => {
  let db: any
  beforeEach(() => {
    db = createMemorySupabase({
      custom_tables: [
        { id: 't1', tenant_id: 'tenant-a', name: 'Clients', slug: 'clients', description: null, columns: [], tags: ['Finance'] },
        { id: 't2', tenant_id: 'tenant-a', name: 'Leads', slug: 'leads', description: null, columns: [], tags: [] },
        { id: 't3', tenant_id: 'tenant-b', name: 'Other', slug: 'other', description: null, columns: [], tags: ['Finance'] },
      ],
    })
  })

  it('create normalises tags; update needs data.edit_schema', async () => {
    const created = await dataTables.createDataTable(ctx(db, ['data.create']), { name: 'Vendors', tags: [' Finance ', 'finance', 'Ops'] })
    expect(created.tags).toEqual(['Finance', 'Ops'])
    await expect(dataTables.updateDataTable(ctx(db, ['data.view']), 't2', { tags: ['x'] })).rejects.toMatchObject({ code: 'forbidden' })
    const updated = await dataTables.updateDataTable(ctx(db, ['data.edit_schema']), 't2', { tags: ['Sales', 'sales'] })
    expect(updated.tags).toEqual(['Sales'])
    expect(recordAssetChange).toHaveBeenCalled()
    await expect(dataTables.updateDataTable(ctx(db, ['data.edit_schema']), 't2', { tags: ['x'.repeat(61)] })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('the list filters by tag in any usual case, within the workspace', async () => {
    const { data_tables } = await dataTables.listDataTables(ctx(db, ['data.view']), { tag: 'finance' }, { limit: null, offset: 0 })
    expect(data_tables.map((t: any) => t.id)).toEqual(['t1'])
  })
})

describe('business rules', () => {
  let db: any
  beforeEach(() => {
    db = createMemorySupabase({ decision_tables: [{ id: 'd1', tenant_id: 'tenant-a', name: 'Routing', description: null, inputs: [], outputs: [], rules: [], tags: [] }] })
  })

  it('create and a tags-only update go through the service with workflows.edit', async () => {
    const created = await decisionTables.createDecisionTable(ctx(db, ['workflows.create']), { name: 'Approvals', tags: ['Finance', 'FINANCE'] })
    expect(created.tags).toEqual(['Finance'])
    await expect(decisionTables.updateDecisionTable(ctx(db, ['workflows.view']), 'd1', { tags: ['x'] })).rejects.toMatchObject({ code: 'forbidden' })
    const updated = await decisionTables.updateDecisionTable(ctx(db, ['workflows.edit']), 'd1', { tags: ['Routing'] })
    expect(updated).toMatchObject({ changed: true, tags: ['Routing'] })
    const again = await decisionTables.updateDecisionTable(ctx(db, ['workflows.edit']), 'd1', { tags: ['Routing'] })
    expect(again.changed).toBe(false)
  })

  it('exports tags only when the table has some, and imports them', async () => {
    const plain = await decisionTables.exportDecisionTable(ctx(db, ['workflows.view']), 'd1')
    expect('tags' in plain.decision_table).toBe(false)
    await decisionTables.updateDecisionTable(ctx(db, ['workflows.edit']), 'd1', { tags: ['Routing'] })
    const tagged = await decisionTables.exportDecisionTable(ctx(db, ['workflows.view']), 'd1')
    expect(tagged.decision_table.tags).toEqual(['Routing'])
    const imported = await decisionTables.importDecisionTable(ctx(db, ['workflows.create']), { payload: tagged })
    expect(imported.tags).toEqual(['Routing'])
  })
})

describe('email templates', () => {
  it('a tags-only update is a change (workflows.edit), not "no fields to update"', async () => {
    const db = createMemorySupabase({ email_templates: [{ id: 'e1', tenant_id: 'tenant-a', name: 'Welcome', description: null, subject: 'Hi', html_body: '<p>Hi</p>', text_body: 'Hi', is_default: false, tags: [], created_at: '', updated_at: '' }] })
    await expect(emailTemplates.updateEmailTemplate(ctx(db, ['workflows.view']), 'e1', { tags: ['x'] })).rejects.toMatchObject({ code: 'forbidden' })
    const updated = await emailTemplates.updateEmailTemplate(ctx(db, ['workflows.edit']), 'e1', { tags: [' Onboarding '] })
    expect(updated.tags).toEqual(['Onboarding'])
    expect(updated.subject).toBe('Hi')
  })
})

describe('form controls', () => {
  it('tags change with extensibility.edit; the list filters by tag', async () => {
    const db = createMemorySupabase({
      form_controls: [
        { id: '11111111-1111-4111-8111-111111111111', tenant_id: 'tenant-a', tag: 'ut-rating', name: 'Rating', description: null, icon: null, latest_version: '1.0.0', enabled: true, trusted: false, approved_hosts: [], tags: [], created_at: '', updated_at: '' },
        { id: '22222222-2222-4222-8222-222222222222', tenant_id: 'tenant-a', tag: 'ut-map', name: 'Map', description: null, icon: null, latest_version: '1.0.0', enabled: true, trusted: false, approved_hosts: [], tags: ['Geo'], created_at: '', updated_at: '' },
      ],
      form_control_versions: [],
    })
    await expect(formControls.updateFormControl(ctx(db, ['extensibility.view']), 'ut-rating', { tags: ['x'] })).rejects.toMatchObject({ code: 'forbidden' })
    const updated = await formControls.updateFormControl(ctx(db, ['extensibility.edit']), 'ut-rating', { tags: ['Survey', 'survey'] })
    expect(updated.tags).toEqual(['Survey'])
    const { form_controls } = await formControls.listFormControls(ctx(db, ['extensibility.view']), { tag: 'geo' })
    expect(form_controls.map((c) => c.tag)).toEqual(['ut-map'])
  })
})

const PKG = '33333333-3333-4333-8333-333333333333'

/**
 * The memory client ignores .or(); reports scoping uses
 * `created_by.eq.<actor>,is_shared.eq.true` (lib/reports-access), so apply it here.
 */
function withReportScoping(db: any) {
  const from = db.from.bind(db)
  db.from = (table: string) => {
    const query = from(table)
    if (table !== 'reports') return query
    query.or = (filter: string) => {
      const actor = /created_by\.eq\.([^,]+),is_shared\.eq\.true/.exec(filter)?.[1]
      const rows = (db.tables?.reports ?? db._tables?.reports ?? REPORT_ROWS) as any[]
      return query.in('id', rows.filter((r) => r.created_by === actor || r.is_shared).map((r) => r.id))
    }
    return query
  }
  return db
}
let REPORT_ROWS: any[] = []

describe('packages', () => {
  it('setPackageTags needs packages.manage and leaves the item lists alone', async () => {
    const db = createMemorySupabase({ packages: [{ id: PKG, tenant_id: 'tenant-a', package_uid: 'u1', name: 'Invoices', slug: 'invoices', roots: [{ type: 'workflow', id: 'gone' }], items: [], excluded: [], data_modes: {}, tags: [] }] })
    await expect(packages.setPackageTags(ctx(db, ['packages.view']), PKG, ['x'])).rejects.toMatchObject({ code: 'forbidden' })
    const row = await packages.setPackageTags(ctx(db, ['packages.manage']), PKG, ['Finance', 'finance'])
    expect(row.tags).toEqual(['Finance'])
    const { packages: list } = await packages.listPackages(ctx(db, ['packages.view']), { limit: null, offset: 0 }, { tag: 'FINANCE' })
    expect(list.map((p) => p.id)).toEqual([PKG])
  })
})

describe('reports', () => {
  it('only the report\'s creator may change its tags (reports.edit_own)', async () => {
    const db = createMemorySupabase({
      reports: [
        { id: 'r-mine', tenant_id: 'tenant-a', created_by: 'user-1', name: 'Mine', is_shared: false, tags: [] },
        { id: 'r-theirs', tenant_id: 'tenant-a', created_by: 'user-2', name: 'Theirs', is_shared: true, tags: [] },
      ],
    })
    await expect(reports.setReportTags(ctx(db, ['reports.view']), 'r-mine', ['x'])).rejects.toMatchObject({ code: 'forbidden' })
    await expect(reports.setReportTags(ctx(db, ['reports.edit_own']), 'r-theirs', ['x'])).rejects.toMatchObject({ code: 'forbidden' })
    const row = await reports.setReportTags(ctx(db, ['reports.edit_own']), 'r-mine', ['Weekly', 'weekly'])
    expect(row.tags).toEqual(['Weekly'])
  })
})

describe('apps', () => {
  it('the app schema accepts tags (bounded) on create and update', () => {
    expect(appCreateSchema.parse({ name: 'Ops', tags: ['Finance'] }).tags).toEqual(['Finance'])
    expect(appUpdateSchema.parse({ tags: [] }).tags).toEqual([])
    expect(() => appUpdateSchema.parse({ tags: ['x'.repeat(61)] })).toThrow()
    expect(() => appUpdateSchema.parse({ tags: Array.from({ length: 31 }, (_, i) => `t${i}`) })).toThrow()
  })
})

describe('object tags registry', () => {
  it('covers every object type, each with its edit permission', () => {
    expect([...TAGGABLE_TYPES]).toEqual([...TAG_OBJECT_TYPE_KEYS])
    for (const type of TAGGABLE_TYPES) expect(TAGGABLE[type].editPerm).toBe(TAG_EDIT_PERMISSIONS[type])
    expect(Object.keys(tags.TAG_OBJECT_TYPES).sort()).toEqual([...TAG_OBJECT_TYPE_KEYS].sort())
  })

  it('apps defer to the app\'s editors (apps.view) — updateApp checks the app', () => {
    const db = createMemorySupabase({})
    expect(canEditTagsOf(ctx(db, ['apps.view']), 'apps')).toBe(true)
    expect(canEditTagsOf(ctx(db, ['tasks.view_own']), 'apps')).toBe(false)
    expect(canEditTagsOf(ctx(db, ['packages.view']), 'packages')).toBe(false)
    expect(canEditTagsOf(ctx(db, ['data.edit_schema']), 'data_tables')).toBe(true)
  })

  it('every new type links to where it opens', () => {
    expect(tags.tagObjectHref('data_tables', 't1', 'Clients', null)).toBe('/data/t1')
    expect(tags.tagObjectHref('reports', 'r1', 'R', null)).toBe('/reports/r1')
    expect(tags.tagObjectHref('business_rules', 'd1', 'D', null)).toBe('/automations/rules/d1')
    expect(tags.tagObjectHref('email_templates', 'e1', 'E', null)).toBe('/automations/email-templates?open=e1')
    expect(tags.tagObjectHref('form_controls', 'c1', 'Rating', null)).toContain('tab=form-controls')
    expect(tags.tagObjectHref('apps', 'a1', 'Ops', null, 'ops')).toBe('/apps/ops')
    expect(tags.tagObjectHref('packages', 'p1', 'Invoices', null)).toContain('tab=authored')
  })
})

describe('Settings → Tags for reports and packages', () => {
  function seed() {
    REPORT_ROWS = [
      { id: 'r-mine', tenant_id: 'tenant-a', created_by: 'user-1', name: 'Mine', is_shared: false, tags: ['Finance'] },
      { id: 'r-shared', tenant_id: 'tenant-a', created_by: 'user-2', name: 'Shared', is_shared: true, tags: ['finance'] },
      { id: 'r-private', tenant_id: 'tenant-a', created_by: 'user-2', name: 'Private', is_shared: false, tags: ['Finance'] },
      { id: 'r-other', tenant_id: 'tenant-b', created_by: 'user-1', name: 'Elsewhere', is_shared: true, tags: ['Finance'] },
    ]
    const db = withReportScoping(createMemorySupabase({
      tenants: [{ id: 'tenant-a', settings: {} }],
      tag_styles: [],
      reports: REPORT_ROWS,
      packages: [{ id: 'p1', tenant_id: 'tenant-a', name: 'Invoices', slug: 'invoices', tags: ['Finance'] }],
    })) as any
    db.rpc = vi.fn(async (name: string) => (name === 'tag_usage'
      // The invoker function would also count reports; the service counts them itself.
      ? { data: [{ name_key: 'finance', name: 'Finance', object_type: 'reports', uses: 99 }, { name_key: 'finance', name: 'Finance', object_type: 'data_tables', uses: 2 }], error: null }
      : { data: [], error: null }))
    return db
  }

  it('counts reports by their own read rule (own + shared), packages behind packages.view, data tables from tag_usage', async () => {
    const db = seed()
    const { tags: list, object_types } = await tags.listTags(ctx(db, ['reports.view', 'packages.view', 'data.view']))
    const finance = list.find((t) => t.key === 'finance')!
    expect(finance.usage).toEqual({ reports: 2, packages: 1, data_tables: 2 })
    expect(object_types.map((t) => t.type)).toEqual(['data_tables', 'reports', 'packages'])
    const noPackages = await tags.listTags(ctx(db, ['reports.view']))
    expect(noPackages.tags.find((t) => t.key === 'finance')!.usage).toEqual({ reports: 2 })
  })

  it('lists a tag\'s reports without other people\'s private ones', async () => {
    const db = seed()
    const result = await tags.listTagObjects(ctx(db, ['reports.view']), { name: 'FINANCE', type: 'reports' })
    expect(result.items.map((i) => i.id)).toEqual(['r-mine', 'r-shared'])
    expect(result.total).toBe(2)
    await expect(tags.listTagObjects(ctx(db, ['reports.view']), { name: 'finance', type: 'packages' })).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('API surface', () => {
  const endpoints = API_ENDPOINTS
  const find = (operationId: string) => {
    const endpoint = endpoints.find((e) => e.operationId === operationId)
    if (!endpoint) throw new Error(`no endpoint ${operationId}`)
    return endpoint
  }
  const shapeOf = (schema: any): Record<string, unknown> => schema?.shape ?? schema?._def?.shape?.() ?? {}

  it.each([
    ['createDataTable'], ['updateDataTable'], ['createReport'], ['updateReport'], ['createDecisionTable'], ['updateDecisionTable'],
    ['createEmailTemplate'], ['updateEmailTemplate'], ['updateFormControl'], ['createApp'], ['updateApp'], ['createPackage'], ['updatePackage'],
  ])('%s accepts tags', (operationId) => {
    expect(Object.keys(shapeOf(find(operationId).body))).toContain('tags')
  })

  it.each([
    ['listDataTables', 'tag'], ['listReports', 'tag'], ['listDecisionTables', 'tag'], ['listEmailTemplates', 'tag'],
    ['listFormControls', 'tagged'], ['listApps', 'tag'], ['listPackages', 'tag'],
  ])('%s filters by %s', (operationId, param) => {
    expect(Object.keys(shapeOf(find(operationId).query))).toContain(param)
  })

  it('the tag endpoints take every object type', () => {
    for (const operationId of ['applyTags', 'listTagObjects']) {
      const endpoint = find(operationId)
      const type: any = shapeOf(endpoint.body ?? endpoint.query).type
      expect(type.options ?? type._def?.values ?? Object.values(type.enum ?? {})).toEqual(expect.arrayContaining([...TAG_OBJECT_TYPE_KEYS]))
    }
  })
})
