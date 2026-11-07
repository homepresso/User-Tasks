/**
 * Header search box: lib/services/search (every object type, per-type
 * permission gates, workspace scoping, Forms first, ranking, "show more"),
 * the navigation shortcuts (lib/search/pages) and the static docs / gallery
 * index filters (lib/search/static-indexes).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const hoisted = vi.hoisted(() => ({ admin: null as any }))
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => hoisted.admin }))

import type { ServiceContext } from '@/lib/services/context'
import * as search from '@/lib/services/search'
import { matchScore, rankByMatch } from '@/lib/search/rank'
import { PAGE_SHORTCUTS, searchPageShortcuts } from '@/lib/search/pages'
import { searchDocsIndex, searchGalleryIndex } from '@/lib/search/static-indexes'
import { createMemorySupabase } from './fixtures/supabase-memory'

const T = 'tenant-a'
const FORM_PAGE_BUTTONS = [{ id: 'submit', label: 'Submit', kind: 'submit', actions: [{ type: 'start_workflow', workflow_id: 'f0a00000-0000-4000-8000-00000000f001', workflow_name: 'Invoice flow', start_form_page: { key: '4a9f2dab1f503485' } }] }]

function seed() {
  const rows = {
    forms: [
      { id: 'f1', tenant_id: T, name: 'Invoice request', description: null, tags: [], buttons: null, version: 2, updated_at: '3' },
      { id: 'f2', tenant_id: T, name: 'Invoice', description: null, tags: [], buttons: FORM_PAGE_BUTTONS, version: 1, updated_at: '1' },
      { id: 'f3', tenant_id: 'tenant-b', name: 'Invoice other workspace', buttons: null, version: 1, updated_at: '9' },
    ],
    tasks: [
      { id: 't1', tenant_id: T, title: 'Invoice review', status: 'todo', priority: 'high', deleted_at: null, created_at: '2' },
      { id: 't2', tenant_id: T, title: 'Other', description: 'about invoice', status: 'todo', priority: 'low', deleted_at: null, created_at: '1' },
      { id: 't3', tenant_id: 'tenant-b', title: 'Invoice elsewhere', status: 'todo', priority: 'low', deleted_at: null, created_at: '5' },
    ],
    workflows: [
      { id: 'w1', tenant_id: T, name: 'Invoice flow', trigger_type: 'manual', is_active: true, updated_at: '1' },
      { id: 'w2', tenant_id: T, name: 'Nightly invoice sweep', trigger_type: 'schedule', is_active: true, updated_at: '2' },
    ],
    workflow_runs: [{ id: 'r1', tenant_id: T, title: 'Invoice 42', status: 'completed', started_at: '1' }],
    decision_tables: [{ id: 'dt1', tenant_id: T, name: 'Invoice approval limits', updated_at: '1' }],
    email_templates: [{ id: 'e1', tenant_id: T, name: 'Invoice reminder', subject: 'Your invoice', updated_at: '1' }],
    agents: [{ id: 'a1', tenant_id: T, name: 'Invoice assistant', is_active: true, updated_at: '1' }],
    integrations: [{ id: 'i1', tenant_id: T, name: 'Invoice API', type: 'rest', is_active: true }],
    tenant_connectors: [{ id: 'c1', tenant_id: T, display_name: 'Invoice DB', connector_key: 'postgres', is_enabled: true, credentials: { password: 'secret' } }],
    integration_references: [{ id: 'ref1', tenant_id: T, name: 'Get invoice', integration_id: 'i1' }],
    mcp_servers: [{ id: 'm1', tenant_id: T, name: 'Invoice tools', is_active: true }],
    custom_tables: [{ id: 'd1', tenant_id: T, name: 'Invoices' }],
    reports: [
      { id: 'rep1', tenant_id: T, name: 'Invoice ageing', is_shared: true, created_by: 'someone', updated_at: '1' },
    ],
    custom_workflow_activities: [{ id: 's1', tenant_id: T, name: 'Invoice parser', key: 'invoice_parser', status: 'active', updated_at: '1' }],
    retention_policies: [{ id: 'p1', tenant_id: T, name: 'Invoice records 7 years', duration_value: 7, duration_unit: 'years' }],
    teams: [{ id: 'team1', tenant_id: T, name: 'Invoice desk' }],
    users: [
      { id: 'u1', tenant_id: T, display_name: 'Invoice Bot', deleted_at: null },
      { id: 'u2', tenant_id: 'tenant-b', display_name: 'Invoice Other', deleted_at: null },
    ],
  }
  const db: any = createMemorySupabase(rows)
  db.rpc = vi.fn(async (name: string, args: any) => name === 'search_custom_table_rows'
    ? { data: [{ id: 'row1', table_id: 'd1', data: { note: `about ${args.q}` }, table_name: 'Invoices' }], error: null }
    : { data: null, error: { message: `unexpected rpc ${name}` } })
  return db
}

function seedAdmin() {
  return createMemorySupabase({
    packages: [{ id: 'pk1', tenant_id: T, name: 'Invoice pack', slug: 'invoice-pack', latest_version: '1.0.0', updated_at: '1' }],
    form_submissions: [
      { id: 'sub1', tenant_id: T, form_id: 'f1', form_name: 'Invoice request', submitted_by: 'user-1', created_at: '2' },
      { id: 'sub2', tenant_id: T, form_id: 'f1', form_name: 'Invoice request', submitted_by: 'user-2', created_at: '3' },
    ],
    form_files: [
      { id: 'file1', tenant_id: T, name: 'invoice-1.pdf', status: 'bound', uploaded_by: 'user-1', created_at: '2' },
      { id: 'file2', tenant_id: T, name: 'invoice-2.pdf', status: 'bound', uploaded_by: 'user-2', submission_id: 'sub2', created_at: '3' },
    ],
  })
}

const ALL = [
  'forms.view', 'forms.submit', 'tasks.view_own', 'workflows.view', 'workflows.view_runs', 'data.view', 'reports.view',
  'agents.view', 'integrations.view', 'extensibility.view', 'packages.view', 'settings.view', 'team.change_roles', 'team.view_members',
]

function ctx(db: any, permissions: string[] | null, extra: Partial<ServiceContext> = {}): ServiceContext {
  return { db, supabase: db, tenantId: T, actorId: 'user-1', permissions: permissions ? new Set(permissions) : null, authKind: 'session', source: 'ui', ...extra } as ServiceContext
}

const keys = (r: search.GlobalSearchResults) => r.sections.map((s) => s.key)
const section = (r: search.GlobalSearchResults, key: string) => r.sections.find((s) => s.key === key)

describe('globalSearch', () => {
  beforeEach(() => { hoisted.admin = seedAdmin() })

  it('covers every object type, Forms first, only the current workspace', async () => {
    const results = await search.globalSearch(ctx(seed(), ALL), ' invoice ')
    expect(keys(results)).toEqual([
      'forms', 'tasks', 'workflows', 'runs', 'tables', 'rows', 'reports', 'rules', 'email_templates', 'agents',
      'integrations', 'custom_steps', 'packages', 'retention', 'submissions', 'files', 'teams', 'people',
    ])
    // Exact name match first; tenant-b's form never shows.
    expect(section(results, 'forms')!.hits.map((h) => [h.id, h.kind])).toEqual([['f2', 'form_page'], ['f1', 'form']])
    expect(section(results, 'forms')!.hits[0].href).toBe('/fill/f2')
    expect(section(results, 'tasks')!.hits.map((h) => h.id)).toEqual(['t1', 't2'])
    expect(section(results, 'workflows')!.hits.map((h) => h.kind).sort()).toEqual(['schedule', 'workflow'])
    expect(section(results, 'integrations')!.hits.map((h) => h.kind)).toEqual(['integration', 'connector', 'mcp_server', 'reference'])
    expect(section(results, 'people')!.hits.map((h) => h.id)).toEqual(['u1'])
    expect(JSON.stringify(results)).not.toContain('secret')
  })

  it('gates each section on its permission', async () => {
    const db = seed()
    const results = await search.globalSearch(ctx(db, ['workflows.view']), 'invoice')
    expect(keys(results)).toEqual(['workflows', 'rules', 'email_templates'])
    expect(db.rpc).not.toHaveBeenCalled()
    await expect(search.globalSearch(ctx(db, ['workflows.view']), 'a')).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('people who may only fill forms in find form pages, linking to the page', async () => {
    const results = await search.globalSearch(ctx(seed(), ['forms.submit']), 'invoice')
    expect(keys(results)).toEqual(['forms', 'files'])
    expect(section(results, 'forms')!.hits).toEqual([expect.objectContaining({ id: 'f2', kind: 'form_page', href: '/fill/f2' })])
  })

  it('submissions and files: one\'s own without forms.edit', async () => {
    const results = await search.globalSearch(ctx(seed(), ['forms.view', 'forms.submit']), 'invoice')
    expect(section(results, 'submissions')!.hits.map((h) => h.id)).toEqual(['sub1'])
    expect(section(results, 'files')!.hits.map((h) => h.id)).toEqual(['file1'])
    const editor = await search.globalSearch(ctx(seed(), ['forms.view', 'forms.submit', 'forms.edit']), 'invoice')
    expect(section(editor, 'submissions')!.hits.map((h) => h.id)).toEqual(['sub2', 'sub1'])
    expect(section(editor, 'files')!.hits.map((h) => h.id).sort()).toEqual(['file1', 'file2'])
  })

  it('reports: shared or the caller\'s own', async () => {
    const db = seed()
    db.tables.reports.push({ id: 'rep2', tenant_id: T, name: 'Invoice private', is_shared: false, created_by: 'user-1', updated_at: '2' })
    const results = await search.globalSearch(ctx(db, ['reports.view']), 'invoice')
    expect(section(results, 'reports')!.hits.map((h) => h.id).sort()).toEqual(['rep1', 'rep2'])
  })

  it('a uuid finds the task by id', async () => {
    const db = seed()
    const id = '0b4f6a63-3f43-4c58-9d0a-1d2b3c4d5e6f'
    db.tables.tasks.push({ id, tenant_id: T, title: 'Unrelated', status: 'todo', priority: 'low', deleted_at: null, created_at: '0' })
    const results = await search.globalSearch(ctx(db, ['tasks.view_own']), id)
    expect(section(results, 'tasks')!.hits.map((h) => h.id)).toEqual([id])
  })

  it('limits each section and says when there is more; `section` returns just that one, longer', async () => {
    const db = seed()
    for (let i = 0; i < 30; i++) db.tables.agents.push({ id: `ax${i}`, tenant_id: T, name: `Invoice helper ${i}`, is_active: true, updated_at: String(i) })
    const first = await search.globalSearch(ctx(db, ['agents.view']), 'invoice')
    expect(section(first, 'agents')!.hits).toHaveLength(search.SEARCH_DEFAULT_LIMIT)
    expect(section(first, 'agents')!.more).toBe(true)
    const more = await search.globalSearch(ctx(db, ['agents.view', 'workflows.view']), 'invoice', { section: 'agents' })
    expect(keys(more)).toEqual(['agents'])
    expect(section(more, 'agents')!.hits).toHaveLength(search.SEARCH_MORE_LIMIT)
  })

  it('row search needs data.view', async () => {
    const db = seed()
    expect(await search.searchDataTableRows(ctx(db, ['data.view']), 'inv', 50)).toHaveLength(1)
    expect(db.rpc).toHaveBeenLastCalledWith('search_custom_table_rows', { q: 'inv', lim: 50 })
    await expect(search.searchDataTableRows(ctx(db, ['tasks.view_own']), 'inv')).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('ranking', () => {
  it('exact, prefix, word, then contains', () => {
    expect([matchScore('Invoice', 'invoice'), matchScore('Invoice run', 'inv'), matchScore('Late invoice', 'inv'), matchScore('Reinvoice', 'inv')]).toEqual([4, 3, 2, 1])
    expect(rankByMatch(['Reinvoice', 'Late invoice', 'Invoice'], 'invoice', (s) => s)).toEqual(['Invoice', 'Late invoice', 'Reinvoice'])
  })
})

describe('page shortcuts', () => {
  it('only pages the caller may open', () => {
    expect(searchPageShortcuts('api keys', ['settings.manage_api_keys']).map((p) => p.href)).toContain('/settings/api-keys')
    expect(searchPageShortcuts('api keys', ['settings.view']).map((p) => p.href)).not.toContain('/settings/api-keys')
    expect(searchPageShortcuts('webhooks', []).map((p) => p.href)).toEqual([])
    expect(searchPageShortcuts('forms', ['forms.view'])[0].href).toBe('/automations/forms')
    expect(searchPageShortcuts('theme', ['settings.view'])[0].href).toBe('/settings/theme')
    // The theme designer is a workspace settings page (governance audit 2026-11).
    expect(searchPageShortcuts('theme', []).map((p) => p.href)).not.toContain('/settings/theme')
  })

  it('never lists instance-admin pages', () => {
    expect(PAGE_SHORTCUTS.some((p) => p.href.includes('infrastructure') || p.href.includes('gallery-review'))).toBe(false)
  })
})

describe('static indexes', () => {
  it('docs: matches title / section words, docs links only', () => {
    const entries = [
      { t: 'Forms', h: '/docs/forms', s: 'Building blocks' },
      { t: 'Form pages', h: '/docs/forms#form-pages', s: 'Forms' },
      { t: 'Evil', h: 'https://example.com', s: 'forms' },
    ]
    expect(searchDocsIndex(entries, 'form').map((e) => e.h)).toEqual(['/docs/forms', '/docs/forms#form-pages'])
  })

  it('gallery: title, summary and tags; safe slugs only', () => {
    const items = [
      { slug: 'expense-claims', title: 'Expense claims', summary: 'Receipts and approvals', tags: ['finance'] },
      { slug: '../x', title: 'Finance hack' },
    ]
    expect(searchGalleryIndex(items, 'finance').map((p) => p.slug)).toEqual(['expense-claims'])
  })
})
