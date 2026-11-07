/**
 * Autocomplete display value vs stored value: label / secondary-text
 * templates, search on the stored value, `<key>_label` stored beside the
 * value (never from the client; a field that owns the key keeps it), label
 * resolution of stored values from the declared source only (same
 * permission rules as a search), read-only display and the data picker.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fake rows */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lookupConfigProblem, lookupItemFields, lookupStoredLabels, normalizeLookupConfig, storedItemLabel, toLookupItem } from '@/lib/forms/lookup'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import { buildTableQueryPlan, clearLookupCache, lookupTaskField, resolveLookupSelections } from '@/lib/services/form-lookup'
import { buildDataTree } from '@/lib/workflow-data-picker'
import type { ServiceContext } from '@/lib/services/context'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const TENANT = u(1)
const TABLE = u(10)
const ASSIGNEE = u(30)
const OTHER_USER = u(31)
const TASK = u(40)

type Row = Record<string, any>

function fakeDb(tables: Record<string, Row[]>) {
  const get = (row: Row, field: string) => {
    const [col, key] = field.split('->>')
    if (key === undefined) return row[col]
    const v = row[col]?.[key]
    return v === undefined || v === null ? null : String(v)
  }
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = []
      let single = false
      const api: any = {
        select() { return api },
        eq(f: string, v: unknown) { filters.push((r) => String(get(r, f)) === String(v)); return api },
        is(f: string, v: unknown) { filters.push((r) => (get(r, f) ?? null) === v); return api },
        in(f: string, vs: unknown[]) { filters.push((r) => vs.map(String).includes(String(get(r, f)))); return api },
        or() { return api },
        order() { return api },
        limit() { return api },
        abortSignal() { return api },
        maybeSingle() { single = true; return api },
        then(resolve: (v: unknown) => unknown) {
          const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
          return Promise.resolve(single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }).then(resolve)
        },
      }
      return api
    },
  }
}

const lookup = { source: 'table', table_id: TABLE, search_columns: ['name'], label_template: '{{name}} ({{region}})', filters: [{ column: 'region', operator: 'eq', value: '{{task_data.region}}' }] }
const FIELDS = [
  { key: 'region', label: 'Region', type: 'text' },
  { key: 'customer', label: 'Customer', type: 'lookup', required: true, lookup },
]

function seed() {
  return {
    custom_tables: [{ id: TABLE, tenant_id: TENANT, columns: [{ key: 'name' }, { key: 'region' }, { key: 'code' }] }],
    custom_table_rows: [
      { id: u(101), tenant_id: TENANT, table_id: TABLE, data: { name: 'Alfreds', region: 'EU', code: 'ALFKI' } },
      { id: u(102), tenant_id: TENANT, table_id: TABLE, data: { name: 'Ana', region: 'LATAM', code: 'ANATR' } },
      { id: u(104), tenant_id: u(2), table_id: TABLE, data: { name: 'Other tenant', region: 'EU' } },
    ],
    tasks: [{ id: TASK, tenant_id: TENANT, title: 'T', status: 'todo', priority: 'medium', assignee_id: ASSIGNEE, assigned_team_id: null, deleted_at: null, metadata: { fields: FIELDS, template_values: { region: 'EU' } } }],
    task_assignees: [],
    user_teams: [],
  }
}

let db: ReturnType<typeof fakeDb>
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => db }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: () => db }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }))

const ctx = (over: Partial<ServiceContext> = {}): ServiceContext => ({
  supabase: db as any, tenantId: TENANT, actorId: ASSIGNEE, permissions: new Set(['tasks.complete']), authKind: 'session', source: 'ui', ...over,
})

describe('label templates', () => {
  it('show "name (code)" while the value stays the id; secondary text has its own template', () => {
    const config = normalizeLookupConfig({ source: 'table', table_id: TABLE, search_columns: ['name'], label_template: '{{name}} ({{code}})', description_template: '{{region}}', search_value: true })
    expect(config).toMatchObject({ label_template: '{{name}} ({{code}})', description_template: '{{region}}', search_value: true })
    expect(lookupConfigProblem(config, 'customer', [])).toBeNull()
    expect(lookupItemFields(config)).toEqual(expect.arrayContaining(['row_id', 'name', 'code', 'region']))
    const item = toLookupItem(config, { row_id: u(101), name: 'Alfreds', code: 'ALFKI', region: 'EU', secret: 'x' })!
    expect(item).toMatchObject({ value: u(101), label: 'Alfreds (ALFKI)', description: 'EU' })
    expect(item.fields).not.toHaveProperty('secret')
    expect(toLookupItem(config, { row_id: u(102), name: 'Ana' })!.label).toBe('Ana')
    expect(storedItemLabel(config, { name: 'Alfreds', code: 'ALFKI' }, u(101))).toBe('Alfreds (ALFKI)')
    expect(lookupStoredLabels(config, u(101), { row_id: u(101), name: 'Alfreds', code: 'ALFKI' })).toBe('Alfreds (ALFKI)')
    expect(lookupStoredLabels({ ...config, multiple: true }, ['free'], [])).toEqual(['free'])
  })

  it('only name valid columns / paths (anything else is dropped)', () => {
    expect(normalizeLookupConfig({ source: 'table', label_template: '{{name}} {{bad-col}}' }).label_template).toBeUndefined()
    expect(normalizeLookupConfig({ source: 'table', label_template: 'no placeholders' }).label_template).toBeUndefined()
    expect(normalizeLookupConfig({ source: 'reference', label_template: '{{customer.name}} <{{id}}>' }).label_template).toBe('{{customer.name}} {{id}}')
  })

  it('old configs (no template) keep the first shown column as the label', () => {
    const config = normalizeLookupConfig({ source: 'table', table_id: TABLE, search_columns: ['name'], display_columns: ['name', 'code'] })
    expect(toLookupItem(config, { row_id: u(1), name: 'A', code: 'C' })).toMatchObject({ label: 'A', description: 'C' })
    expect(lookupConfigProblem({ ...config, display_columns: undefined }, 'x', [])).toBe('Choose at least one column to show')
  })
})

describe('search on the stored value', () => {
  it('adds the value column (and an exact id match for row ids)', () => {
    const byCode = normalizeLookupConfig({ source: 'table', table_id: TABLE, search_columns: ['name'], display_columns: ['name'], value_column: 'code', search_value: true })
    expect(buildTableQueryPlan(byCode, ['name', 'code'], { search: 'alf', values: {} }).search).toContain('data->>code.ilike')
    const byId = normalizeLookupConfig({ source: 'table', table_id: TABLE, search_columns: ['name'], display_columns: ['name'], search_value: true })
    expect(buildTableQueryPlan(byId, ['name'], { search: u(101), values: {} }).search).toContain(`id.eq.${u(101)}`)
    expect(buildTableQueryPlan(byId, ['name'], { search: 'alf', values: {} }).search).not.toContain('id.eq')
    const off = normalizeLookupConfig({ source: 'table', table_id: TABLE, search_columns: ['name'], display_columns: ['name'], value_column: 'code' })
    expect(buildTableQueryPlan(off, ['name', 'code'], { search: 'alf', values: {} }).search).not.toContain('code')
  })
})

describe('<key>_label on save, and resolving stored values', () => {
  beforeEach(() => { db = fakeDb(seed()); clearLookupCache() })

  it('completion stores the label from the source (never the client\'s); a field owning <key>_label keeps it', async () => {
    const { mergeTaskFieldValuesChecked } = await import('@/lib/forms/task-values')
    const meta = seed().tasks[0].metadata
    const ok = await mergeTaskFieldValuesChecked(db as any, TENANT, meta, { customer: u(101), customer_label: 'Forged', region: 'EU' }, { taskId: TASK })
    expect(ok.errors).toEqual({})
    expect(ok.templateValues.customer).toBe(u(101))
    expect(ok.templateValues.customer_label).toBe('Alfreds (EU)')
    const bad = await mergeTaskFieldValuesChecked(db as any, TENANT, meta, { customer: u(102), region: 'EU' }, { taskId: TASK })
    expect(bad.errors.customer).toMatch(/choose one of the suggestions/)
    const owned = normalizeTaskFields([...FIELDS, { key: 'customer_label', label: 'Own', type: 'text' }])
    const res = await resolveLookupSelections(db as any, TENANT, owned, { customer: u(101), region: 'EU' }, { strict: true, taskId: TASK })
    expect(res.items).toHaveProperty('customer_item')
    expect(res.items).not.toHaveProperty('customer_label')
  })

  it('resolve returns items of stored values from the declared source only (filters, tenant and task access apply)', async () => {
    const res = await lookupTaskField(ctx(), TASK, { field_key: 'customer', resolve: [u(101), u(102), u(104)], values: { region: 'EU' } })
    expect(res.items.map((i) => [i.value, i.label])).toEqual([[u(101), 'Alfreds (EU)']])
    await expect(lookupTaskField(ctx({ actorId: OTHER_USER }), TASK, { field_key: 'customer', resolve: [u(101)] })).rejects.toThrow(/cannot act/)
  })
})

describe('downstream', () => {
  it('the data picker offers <key>_label next to the value and the item', () => {
    const groups = buildDataTree({
      nodes: [{ id: 'ut', type: 'user_task', label: 'Review', config: { fields: FIELDS } }, { id: 'log', type: 'log', label: 'Log', config: {} }] as any,
      edges: [{ source: 'ut', target: 'log' }] as any,
      currentNodeId: 'log',
    })
    const roots = groups.flatMap((g) => g.roots)
    expect(roots.find((r) => r.path === 'task_data.customer_label')?.schema).toMatchObject({ type: 'string' })
    expect(roots.find((r) => r.path === 'task_data.customer_item')).toBeTruthy()
  })
})
