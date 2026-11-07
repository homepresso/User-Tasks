/**
 * Data table fields and "for each changed row" rules against a LOCAL
 * Supabase stack (real PostgREST): the server-side query (base filter ANDed
 * with the user's filters, numeric sort, paging totals), projection,
 * source resolution and permissions, tenant isolation, the submission check
 * (re-read `before`, rows outside the base filter refused) and the rule
 * executor writing to a real table — idempotent, logged.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/form-data-table-db.test.ts
 * (needs migration 20261205000000_form_table_change_runs applied locally).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'
import { queryDataTable, resolveDataTableValues } from '@/lib/services/form-data-table'
import { runTableChanges } from '@/lib/services/form-table-changes'
import { submitForm } from '@/lib/services/form-submissions'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `f0f0f5d7-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const A = id(0xa)
const B = id(0xb)
const TABLE = id(0x10)
const TABLE_B = id(0x11)
const LOG = id(0x12)
const FORM = id(0x30)
const TASK = id(0x20)
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

const VENDORS = [
  { vendor_id: 'V-1', name: 'Contoso', country: 'NZ', active: true, payment_terms: 30, iban: 'NZ-SECRET-1' },
  { vendor_id: 'V-2', name: 'Fabrikam', country: 'NZ', active: true, payment_terms: 45, iban: 'NZ-SECRET-2' },
  { vendor_id: 'V-3', name: 'Litware', country: 'NZ', active: false, payment_terms: 7, iban: 'NZ-SECRET-3' },
  { vendor_id: 'V-4', name: 'Northwind', country: 'AU', active: true, payment_terms: 60, iban: 'AU-SECRET-4' },
  { vendor_id: 'V-5', name: 'Adatum', country: 'NZ', active: true, payment_terms: 120, iban: 'NZ-SECRET-5' },
  { vendor_id: 'V-6', name: 'Tailspin', country: 'NZ', active: true, payment_terms: 15, iban: 'NZ-SECRET-6' },
]

const DT = {
  source: 'table', table_id: TABLE, mode: 'edit', key_column: 'vendor_id', allow_add: true, allow_delete: true, page_size: 2,
  columns: [
    { key: 'vendor_id', label: 'Vendor', type: 'text', sortable: true },
    { key: 'name', label: 'Name', type: 'text', sortable: true, filterable: true },
    { key: 'payment_terms', label: 'Terms', type: 'number', sortable: true, filterable: true },
  ],
  // Only active vendors of the country chosen on the form.
  base_filter: { match: 'all', conditions: [{ column: 'country', operator: 'eq', value: '{{form.country}}' }, { column: 'active', operator: 'eq', value: 'true' }] },
  sort: [{ column: 'payment_terms', direction: 'desc' }],
}
const FIELDS = [
  { key: 'country', label: 'Country', type: 'text' },
  { key: 'vendors', label: 'Vendors', type: 'data_table', data_table: DT },
]
const BUTTONS = [{
  id: 'submit', label: 'Save', kind: 'submit', style: 'primary',
  actions: [
    { type: 'apply_table_changes', table_changes: { field: 'vendors', target: 'table', table_id: LOG, operation: 'insert', mapping: { vendor_id: '{{key}}', change: '{{change}}', terms: '{{row.payment_terms}}', country: '{{form.country}}' }, on_error: 'continue' } },
    { type: 'apply_table_changes', table_changes: { field: 'vendors', target: 'table', table_id: TABLE, operation: 'auto', match_column: 'vendor_id', mapping: { vendor_id: '{{row.vendor_id}}', name: '{{row.name}}', payment_terms: '{{row.payment_terms}}', country: '{{form.country}}', active: 'true' } } },
    { type: 'message', text: 'Done: {{table_changes_summary}}' },
  ],
}]

describe.skipIf(!DB_URL)('Data table fields and table-change rules (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const ctx = (tenantId: string, perms: string[] = ['forms.submit', 'data.view', 'data.manage_rows', 'tasks.complete'], actorId: string | null = null): ServiceContext =>
    ({ supabase: admin, tenantId, actorId, permissions: new Set(perms), authKind: 'api_key', source: 'api' })
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }

  async function cleanup() {
    for (const t of [A, B]) {
      for (const table of ['form_table_change_runs', 'form_submissions', 'forms', 'tasks', 'custom_table_rows', 'custom_tables']) await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      await db.query('DELETE FROM public.tenants WHERE id = $1', [t])
    }
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'DT A', 'dt-a-test'), ($2, 'DT B', 'dt-b-test')`, [A, B])
    const columns = JSON.stringify([
      { key: 'vendor_id', name: 'Vendor', type: 'text' }, { key: 'name', name: 'Name', type: 'text' }, { key: 'country', name: 'Country', type: 'text' },
      { key: 'active', name: 'Active', type: 'boolean' }, { key: 'payment_terms', name: 'Terms', type: 'number' }, { key: 'iban', name: 'IBAN', type: 'text' },
    ])
    const logColumns = JSON.stringify(['vendor_id', 'change', 'terms', 'country'].map((key) => ({ key, name: key, type: key === 'terms' ? 'number' : 'text' })))
    await db.query(`INSERT INTO public.custom_tables (id, tenant_id, name, slug, columns) VALUES ($1, $2, 'Vendors', 'vendors-dt-test', $3), ($4, $5, 'Vendors', 'vendors-dt-test', $3), ($6, $2, 'Vendor log', 'vendor-log-dt-test', $7)`, [TABLE, A, columns, TABLE_B, B, LOG, logColumns])
    for (const [i, v] of VENDORS.entries()) await db.query(`INSERT INTO public.custom_table_rows (tenant_id, table_id, data, created_at) VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`, [A, TABLE, JSON.stringify(v), String(i)])
    await db.query(`INSERT INTO public.custom_table_rows (tenant_id, table_id, data) VALUES ($1, $2, $3)`, [B, TABLE_B, JSON.stringify({ vendor_id: 'V-B', name: 'Other tenant', country: 'NZ', active: true, payment_terms: 999 })])
    await db.query(`INSERT INTO public.forms (id, tenant_id, name, fields, buttons) VALUES ($1, $2, 'Vendor terms', $3, $4)`, [FORM, A, JSON.stringify(FIELDS), JSON.stringify(BUTTONS)])
    await db.query(`INSERT INTO public.tasks (id, tenant_id, title, status, metadata) VALUES ($1, $2, 'Review vendors', 'todo', $3)`, [TASK, A, JSON.stringify({ fields: FIELDS, template_values: { country: 'NZ' } })])
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
  })

  const q = (query: Record<string, unknown> = {}, values: Record<string, unknown> = { country: 'NZ' }, c = ctx(A)) =>
    queryDataTable(c, { form_id: FORM }, { field_key: 'vendors', query, values })

  it('the base filter (form value + constant) and the default numeric sort run on the server; pages carry the total', async () => {
    const page1 = await q()
    expect(page1.total).toBe(4) // NZ and active: V-1, V-2, V-5, V-6 (V-3 inactive, V-4 AU)
    expect(page1.rows.map((r) => r.key)).toEqual(['V-5', 'V-2'])
    const page2 = await q({ page: 2 })
    expect(page2.rows.map((r) => r.key)).toEqual(['V-1', 'V-6'])
    expect((await q({ page: 9 })).rows).toEqual([])
  })

  it('only the selected columns are returned (no hidden data in the JSON)', async () => {
    const { rows } = await q()
    expect(Object.keys(rows[0].values).sort()).toEqual(['name', 'payment_terms', 'vendor_id'])
    expect(JSON.stringify(rows)).not.toMatch(/SECRET|country|active/)
  })

  it('user filters and search narrow the base filter, never widen it', async () => {
    expect((await q({ filters: [{ column: 'payment_terms', operator: 'gte', value: '30' }], sort: [{ column: 'name', direction: 'asc' }] })).rows.map((r) => r.key)).toEqual(['V-5', 'V-1'])
    expect((await q({ search: 'ware' })).rows).toEqual([]) // Litware is inactive: the base filter still applies
    expect((await q({ search: 'north' })).rows).toEqual([]) // Northwind is AU
    expect((await q({}, { country: 'AU' })).rows.map((r) => r.key)).toEqual(['V-4'])
    // A crafted value can't break out of the term.
    expect((await q({ filters: [{ column: 'name', operator: 'contains', value: '",or(id.not.is.null' }] })).rows).toEqual([])
    await expect(q({ filters: [{ column: 'country', operator: 'eq', value: 'AU' }] })).rejects.toThrow(/can't filter/)
    await expect(q({ sort: [{ column: 'iban' }] })).rejects.toThrow(/can't sort/)
  })

  it('the source comes from the saved form: unknown fields / forms are refused; tenants are isolated', async () => {
    await expect(queryDataTable(ctx(A), { form_id: FORM }, { field_key: 'country' })).rejects.toThrow(/no Data table field "country"/)
    await expect(queryDataTable(ctx(B), { form_id: FORM }, { field_key: 'vendors' })).rejects.toThrow(/Form not found/)
    // A preview (unsaved config) needs edit rights.
    await expect(queryDataTable(ctx(A), { preview_field: { key: 'x', label: 'X', type: 'data_table', data_table: { ...DT, table_id: TABLE_B } } }, {})).rejects.toThrow(/forms.edit/)
    // Even with edit rights, another tenant's table is not reachable.
    await expect(queryDataTable(ctx(A, ['forms.edit', 'data.view']), { preview_field: { key: 'x', label: 'X', type: 'data_table', data_table: { ...DT, table_id: TABLE_B } } }, { values: { country: 'NZ' } })).rejects.toThrow(/no longer exists/)
  })

  it('reading needs data.view unless the author turned on open access', async () => {
    await expect(q({}, { country: 'NZ' }, ctx(A, ['forms.submit']))).rejects.toThrow(/data.view/)
    await db.query(`UPDATE public.forms SET fields = $2 WHERE id = $1`, [FORM, JSON.stringify([FIELDS[0], { ...FIELDS[1], data_table: { ...DT, open_access: true } }])])
    try {
      const open = await q({}, { country: 'NZ' }, ctx(A, ['forms.submit']))
      expect(open.total).toBe(4)
      expect(JSON.stringify(open.rows)).not.toContain('SECRET')
    } finally {
      await db.query(`UPDATE public.forms SET fields = $2 WHERE id = $1`, [FORM, JSON.stringify(FIELDS)])
    }
  })

  it('task forms: the task authorises; the base filter reads the task values', async () => {
    const res = await queryDataTable(ctx(A), { task_id: TASK }, { field_key: 'vendors' })
    expect(res.total).toBe(4)
  })

  it('submission check: `before` is re-read from the table; rows outside the base filter are refused', async () => {
    const fields = normalizeTaskFields(FIELDS)
    const ok = await resolveDataTableValues(ctx(A), A, fields, { country: 'NZ', vendors: { updated: [{ key: 'V-1', before: { name: 'FORGED', payment_terms: 999 }, after: { payment_terms: 35 } }] } }, { strict: true })
    expect(ok.errors).toEqual({})
    expect((ok.values.vendors as any).updated).toEqual([{ key: 'V-1', before: { vendor_id: 'V-1', name: 'Contoso', payment_terms: 30 }, after: { payment_terms: 35 }, changed_fields: ['payment_terms'] }])
    const outside = await resolveDataTableValues(ctx(A), A, fields, { country: 'NZ', vendors: { deleted: [{ key: 'V-4' }] } }, { strict: true })
    expect(outside.errors.vendors).toMatch(/"V-4" is no longer available/)
    const inactive = await resolveDataTableValues(ctx(A), A, fields, { country: 'NZ', vendors: { updated: [{ key: 'V-3', after: { payment_terms: 1 } }] } }, { strict: true })
    expect(inactive.errors.vendors).toMatch(/no longer available/)
  })

  it('submitting runs the rules once: logs every change, writes the vendors table, shows the summary; a repeat is replayed', async () => {
    const values = { country: 'NZ', vendors: { added: [{ vendor_id: 'V-7', name: 'Proseware', payment_terms: 20 }], updated: [{ key: 'V-2', after: { payment_terms: 50 } }], deleted: [{ key: 'V-6' }] } }
    const result = await submitForm(ctx(A), FORM, { values, idempotency_key: 'dt-submit-0001' })
    expect(result.table_changes?.map((t) => t.text)).toEqual(['3 rows added', '1 row deleted, 1 row updated, 1 row added'])
    expect(result.effects.messages.map((m) => m.text)).toEqual(['1 row deleted, 1 row updated, 1 row added', '3 rows added', 'Done: 3 rows added; 1 row deleted, 1 row updated, 1 row added'])
    const { rows: log } = await db.query(`SELECT data FROM public.custom_table_rows WHERE table_id = $1 ORDER BY created_at`, [LOG])
    // Deletes, then updates, then inserts; a new row has no key yet.
    expect(log.map((r: any) => [r.data.vendor_id ?? null, r.data.change, r.data.terms])).toEqual([['V-6', 'deleted', 15], ['V-2', 'updated', 50], [null, 'added', 20]])
    const { rows: v2 } = await db.query(`SELECT data FROM public.custom_table_rows WHERE table_id = $1 AND data->>'vendor_id' = 'V-2'`, [TABLE])
    // Merged into the row: cells the rule doesn't map (iban) are kept.
    expect(v2[0].data).toMatchObject({ payment_terms: 50, iban: 'NZ-SECRET-2', name: 'Fabrikam' })
    const { rows: v7 } = await db.query(`SELECT data FROM public.custom_table_rows WHERE table_id = $1 AND data->>'vendor_id' = 'V-7'`, [TABLE])
    expect(v7).toHaveLength(1)
    const { rows: runRows } = await db.query(`SELECT status, origin, field_key, idempotency_key, summary->>'text' AS text FROM public.form_table_change_runs WHERE tenant_id = $1 ORDER BY created_at`, [A])
    expect(runRows.map((r: any) => r.status)).toEqual(['succeeded', 'succeeded'])
    expect(runRows[0].idempotency_key).toBe(`submit:${result.submission.id}:0`)
    // Double submit: the same idempotency key → the first result, nothing written again.
    const again = await submitForm(ctx(A), FORM, { values, idempotency_key: 'dt-submit-0001' })
    expect(again.replayed).toBe(true)
    const { rows: log2 } = await db.query(`SELECT count(*)::int AS n FROM public.custom_table_rows WHERE table_id = $1`, [LOG])
    expect(log2[0].n).toBe(3)
    // The same rule key run directly is replayed too.
    const direct = await runTableChanges(ctx(A), { config: BUTTONS[0].actions[0].table_changes as any, fields: normalizeTaskFields(FIELDS), values: { country: 'NZ', vendors: values.vendors }, idempotencyKey: `submit:${result.submission.id}:0`, origin: 'submit' })
    expect(direct.replayed).toBe(true)
  })

  it('a submitter without data.manage_rows gets a failed summary, not a write', async () => {
    const result = await submitForm(ctx(A, ['forms.submit', 'data.view']), FORM, { values: { country: 'NZ', vendors: { updated: [{ key: 'V-1', after: { payment_terms: 31 } }] } }, idempotency_key: 'dt-submit-0002' })
    expect(result.table_changes?.[0].text).toMatch(/data.manage_rows/)
    const { rows } = await db.query(`SELECT data FROM public.custom_table_rows WHERE table_id = $1 AND data->>'vendor_id' = 'V-1'`, [TABLE])
    expect(rows[0].data.payment_terms).toBe(30)
  })
  it('form parameters ({{param.x}}): the URL value narrows the base filter on the database; crafted, missing and refused values never widen it', async () => {
    const FORM_P = id(0x31)
    const dt = { ...DT, mode: 'display', base_filter: { match: 'all', conditions: [{ column: 'country', operator: 'eq', value: '{{param.country}}' }, { column: 'active', operator: 'eq', value: 'true' }] } }
    const layout = { rows: [{ columns: 1, cells: [{ field_key: 'vendors', span: 1 }] }], params: [{ name: 'country', type: 'text', source: 'url', required: true, pattern: '[A-Z]{2}' }], variables: [{ name: 'picked', type: 'text' }] }
    await db.query(`INSERT INTO public.forms (id, tenant_id, name, fields, layout) VALUES ($1, $2, 'Vendors by country', $3, $4)`, [FORM_P, A, JSON.stringify([{ key: 'vendors', label: 'Vendors', type: 'data_table', data_table: dt }]), JSON.stringify(layout)])
    const p = (params: Record<string, unknown> | undefined, values?: Record<string, unknown>) => queryDataTable(ctx(A), { form_id: FORM_P }, { field_key: 'vendors', params, values })
    expect((await p({ country: 'AU' })).rows.map((r) => r.key)).toEqual(['V-4'])
    expect((await p({ country: 'NZ' })).rows.every((r) => r.key !== 'V-4')).toBe(true)
    // The browser's path: the parameters ride in the values under their reserved key.
    expect((await p(undefined, { __form_params: { country: 'AU' } })).rows.map((r) => r.key)).toEqual(['V-4'])
    // Crafted values: refused by the declared pattern, or (no pattern) one quoted value that matches nothing.
    await expect(p({ country: 'NZ",or(id.not.is.null' })).rejects.toThrow(/expected format/)
    await expect(p({})).rejects.toThrow(/needs the form parameter "country"/)
    await db.query(`UPDATE public.forms SET layout = $2 WHERE id = $1`, [FORM_P, JSON.stringify({ ...layout, params: [{ name: 'country', type: 'text', source: 'url' }] })])
    expect((await p({ country: 'NZ",or(id.not.is.null),and(country.eq."NZ' })).rows).toEqual([])
    // Optional and absent: the condition matches nothing (empty value), never dropped.
    expect((await p({})).rows).toEqual([])
    // Unknown parameters never reach the query.
    expect((await p({ country: 'AU', table_id: TABLE_B } as any)).rows.map((r) => r.key)).toEqual(['V-4'])
  })
})
