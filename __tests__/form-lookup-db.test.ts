/**
 * Autocomplete / lookup fields against a LOCAL Supabase stack (real
 * PostgREST): the search `or` filter on JSON columns, special characters
 * matching literally (%, _, commas, parentheses, quotes, *, backslashes),
 * prefix match, filters with {{task_data}} expressions, sort, tenant
 * isolation, closed tasks, and completion storing `<key>_item` / refusing a
 * value that isn't in the table.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/form-lookup-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'
import { lookupTaskField } from '@/lib/services/form-lookup'
import { mergeTaskFieldValuesChecked } from '@/lib/forms/task-values'
import { submitForm } from '@/lib/services/form-submissions'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `f0f0f501-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const A = id(0xa)
const B = id(0xb)
const TABLE = id(0x10)
const TABLE_B = id(0x11)
const TASK = id(0x20)
const CLOSED = id(0x21)
const FORM = id(0x30)
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

const NAMES = ['Alfreds Futterkiste', 'Ana Trujillo Emparedados', '50% Off Store', 'Under_score Ltd', 'Comma, Paren (Co)', 'O\'Brien "Quoted" Inc', 'Star*Gazers', 'Back\\slash Bros']
const FIELDS = [
  { key: 'region', label: 'Region', type: 'text' },
  {
    key: 'customer', label: 'Customer', type: 'lookup', required: true,
    lookup: { source: 'table', table_id: TABLE, search_columns: ['name', 'city'], display_columns: ['name', 'city'], filters: [{ column: 'region', operator: 'eq', value: '{{task_data.region}}' }], sort: { column: 'name', direction: 'asc' }, max_results: 20, fill: [{ from: 'email', to: 'email' }] },
  },
  { key: 'email', label: 'Email', type: 'email' },
]

describe.skipIf(!DB_URL)('form lookups (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const ctx = (tenantId: string): ServiceContext => ({ supabase: admin, tenantId, actorId: null, permissions: new Set(['tasks.complete']), authKind: 'api_key', source: 'api' })
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }

  async function cleanup() {
    for (const t of [A, B]) {
      for (const table of ['form_submissions', 'forms', 'tasks', 'custom_table_rows', 'custom_tables']) await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      await db.query('DELETE FROM public.tenants WHERE id = $1', [t])
    }
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Lookup A', 'lookup-a-test'), ($2, 'Lookup B', 'lookup-b-test')`, [A, B])
    const columns = JSON.stringify(['name', 'city', 'region', 'email', 'secret'].map((key) => ({ key, name: key, type: 'text' })))
    await db.query(`INSERT INTO public.custom_tables (id, tenant_id, name, slug, columns) VALUES ($1, $2, 'Customers', 'customers-lookup-test', $3), ($4, $5, 'Customers', 'customers-lookup-test', $3)`, [TABLE, A, columns, TABLE_B, B])
    for (const [i, name] of NAMES.entries()) {
      await db.query(`INSERT INTO public.custom_table_rows (tenant_id, table_id, data) VALUES ($1, $2, $3)`, [A, TABLE, JSON.stringify({ name, city: i % 2 ? 'México D.F.' : 'Berlin', region: i === 1 ? 'LATAM' : 'EU', email: `c${i}@example.test`, secret: `secret-${i}` })])
    }
    // Same table id in tenant B must never leak into A (and B's own table).
    await db.query(`INSERT INTO public.custom_table_rows (tenant_id, table_id, data) VALUES ($1, $2, $3)`, [B, TABLE_B, JSON.stringify({ name: 'Alfa B-only', city: 'Oslo', region: 'EU', email: 'b@example.test' })])
    await db.query(`INSERT INTO public.custom_table_rows (tenant_id, table_id, data) VALUES ($1, $2, $3)`, [B, TABLE, JSON.stringify({ name: 'Alfa wrong tenant', city: 'Oslo', region: 'EU', email: 'x@example.test' })]).catch(() => undefined)
    const meta = JSON.stringify({ fields: FIELDS, template_values: { region: 'EU' } })
    await db.query(`INSERT INTO public.tasks (id, tenant_id, title, status, metadata) VALUES ($1, $2, 'Complaint', 'todo', $3), ($4, $2, 'Done', 'completed', $3)`, [TASK, A, meta, CLOSED])
    // A standalone form whose lookup fills a READ-ONLY field (like the equipment request's category / cost).
    const formFields = FIELDS.map((f) => (f.key === 'email' ? { ...f, read_only: true } : f))
    await db.query(`INSERT INTO public.forms (id, tenant_id, name, fields) VALUES ($1, $2, 'Lookup form', $3)`, [FORM, A, JSON.stringify(formFields)])
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
  })

  const search = async (query: string, values: Record<string, unknown> = { region: 'EU' }) =>
    (await lookupTaskField(ctx(A), TASK, { field_key: 'customer', query, values })).items.map((i) => i.label)

  it('searches the configured columns with the filter from the form values, sorted, trimmed', async () => {
    expect(await search('alf')).toEqual(['Alfreds Futterkiste'])
    expect(await search('mexico')).toEqual([])
    expect(await search('d.f.')).toEqual(['Back\\slash Bros', 'O\'Brien "Quoted" Inc', 'Under_score Ltd'])
    expect(await search('ana', { region: 'LATAM' })).toEqual(['Ana Trujillo Emparedados'])
    const { items } = await lookupTaskField(ctx(A), TASK, { field_key: 'customer', query: 'alf', values: { region: 'EU' } })
    expect(Object.keys(items[0].fields).sort()).toEqual(['city', 'email', 'name', 'row_id'])
    expect(JSON.stringify(items)).not.toContain('secret')
  })

  it('special characters match literally (no wildcards, no filter injection)', async () => {
    expect(await search('50%')).toEqual(['50% Off Store'])
    expect(await search('a_e')).toEqual([]) // as a wildcard it would match "Gazers"
    expect(await search('under_')).toEqual(['Under_score Ltd'])
    expect(await search('Comma, Paren (Co)')).toEqual(['Comma, Paren (Co)'])
    expect(await search("O'Brien")).toEqual(['O\'Brien "Quoted" Inc'])
    // `*` (PostgREST's wildcard alias) is dropped from the text, never a wildcard.
    expect(await search('star*')).toEqual(['Star*Gazers'])
    expect(await search('s*r')).toEqual([])
    expect(await search('Star')).toEqual(['Star*Gazers'])
    expect(await search('back\\slash')).toEqual(['Back\\slash Bros'])
    expect(await search('%')).toEqual(['50% Off Store'])
    expect(await search('name.ilike.*')).toEqual([])
  })

  it('tenant isolation: rows of another tenant are never returned', async () => {
    expect(await search('alfa')).toEqual([])
    await expect(lookupTaskField(ctx(B), TASK, { field_key: 'customer', query: 'alf' })).rejects.toThrow(/Task not found/)
  })

  it('closed tasks are refused', async () => {
    await expect(lookupTaskField(ctx(A), CLOSED, { field_key: 'customer', query: 'alf' })).rejects.toThrow(/closed/)
  })

  it('completion stores <key>_item from the table and refuses a value outside the filter', async () => {
    const { items } = await lookupTaskField(ctx(A), TASK, { field_key: 'customer', query: 'alf', values: { region: 'EU' } })
    const meta = { fields: FIELDS, template_values: { region: 'EU' } }
    const ok = await mergeTaskFieldValuesChecked(admin as any, A, meta, { customer: items[0].value, email: 'c0@example.test' }, { taskId: TASK })
    expect(ok.errors).toEqual({})
    expect(ok.templateValues.customer_item).toEqual({ name: 'Alfreds Futterkiste', city: 'Berlin', row_id: items[0].value, email: 'c0@example.test' })
    const wrongRegion = await mergeTaskFieldValuesChecked(admin as any, A, meta, { customer: items[0].value, region: 'LATAM' }, { taskId: TASK })
    expect(wrongRegion.errors.customer).toMatch(/choose one of the suggestions/)
    const notUuid = await mergeTaskFieldValuesChecked(admin as any, A, meta, { customer: 'Alfreds Futterkiste' }, { taskId: TASK })
    expect(notUuid.errors.customer).toMatch(/choose one of the suggestions/)
  })

  it('a real form submission stores the read-only fill-ins from the server-verified item (client values ignored)', async () => {
    const { items } = await lookupTaskField(ctx(A), TASK, { field_key: 'customer', query: 'alf', values: { region: 'EU' } })
    const submitCtx: ServiceContext = { ...ctx(A), permissions: new Set(['forms.submit']) }
    const res = await submitForm(submitCtx, FORM, { values: { region: 'EU', customer: items[0].value, email: 'forged@evil.test' } }, { source: 'api' })
    const { rows } = await db.query('SELECT values FROM public.form_submissions WHERE id = $1', [res.submission.id])
    expect(rows[0].values.email).toBe('c0@example.test')
    expect(rows[0].values.customer_item.email).toBe('c0@example.test')
  })
})
