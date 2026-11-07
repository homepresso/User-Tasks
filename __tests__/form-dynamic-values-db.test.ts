/**
 * Dynamic properties (lib/forms/dynamic-values.ts) against a LOCAL Supabase
 * stack (real PostgREST): options from a Countries data table filtered by a
 * URL parameter, sorted and capped; the declared projection only; tenant
 * isolation; and the submission — the chosen value judged against the
 * options the server resolves for that submission's parameters, a number
 * field's maximum from a variable.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/form-dynamic-values-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'
import { resolveDynamicValue } from '@/lib/services/form-dynamic-values'
import { submitForm } from '@/lib/services/form-submissions'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `f0f0d7a1-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const A = id(0xa)
const B = id(0xb)
const TABLE = id(0x10)
const TABLE_B = id(0x11)
const FORM = id(0x30)
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

const COUNTRIES = [
  { code: 'NZ', name: 'New Zealand', region: 'Oceania', iso_secret: 'X1' },
  { code: 'AU', name: 'Australia', region: 'Oceania', iso_secret: 'X2' },
  { code: 'FJ', name: 'Fiji', region: 'Oceania', iso_secret: 'X3' },
  { code: 'FR', name: 'France', region: 'Europe', iso_secret: 'X4' },
  { code: 'DE', name: 'Germany', region: 'Europe', iso_secret: 'X5' },
]

const FIELDS = [
  {
    key: 'country', label: 'Country', type: 'choice', options: ['Preview'], required: true,
    dynamic: { options: { kind: 'table', table_id: TABLE, value: 'code', label: 'name', sort: [{ column: 'name', direction: 'asc' }], base_filter: { match: 'all', conditions: [{ column: 'region', operator: 'eq', value: '{{param.region}}' }] } } },
  },
  { key: 'qty', label: 'Quantity', type: 'number', max: 100, dynamic: { max: { kind: 'expr', expr: '{{var.limit}}' } } },
]
const LAYOUT = {
  rows: [{ columns: 1, cells: [{ field_key: 'country', span: 1 }] }, { columns: 1, cells: [{ field_key: 'qty', span: 1 }] }],
  params: [{ name: 'region', type: 'text', source: 'url', allowed: ['Oceania', 'Europe'], default: 'Oceania' }],
  variables: [{ name: 'limit', type: 'number', initial: { kind: 'constant', value: '5' } }],
}

describe.skipIf(!DB_URL)('dynamic properties (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const ctx = (tenantId: string, perms: string[] = ['forms.submit', 'data.view']): ServiceContext =>
    ({ supabase: admin, tenantId, actorId: null, permissions: new Set(perms), authKind: 'api_key', source: 'api' })
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }

  async function cleanup() {
    for (const t of [A, B]) {
      for (const table of ['form_submissions', 'forms', 'custom_table_rows', 'custom_tables']) await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      await db.query('DELETE FROM public.tenants WHERE id = $1', [t])
    }
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'DV A', 'dv-a-test'), ($2, 'DV B', 'dv-b-test')`, [A, B])
    const columns = JSON.stringify(['code', 'name', 'region', 'iso_secret'].map((key) => ({ key, name: key, type: 'text' })))
    await db.query(`INSERT INTO public.custom_tables (id, tenant_id, name, slug, columns) VALUES ($1, $2, 'Countries', 'countries-dv-test', $3), ($4, $5, 'Countries', 'countries-dv-test', $3)`, [TABLE, A, columns, TABLE_B, B])
    for (const c of COUNTRIES) await db.query(`INSERT INTO public.custom_table_rows (tenant_id, table_id, data) VALUES ($1, $2, $3)`, [A, TABLE, JSON.stringify(c)])
    await db.query(`INSERT INTO public.custom_table_rows (tenant_id, table_id, data) VALUES ($1, $2, $3)`, [B, TABLE_B, JSON.stringify({ code: 'XX', name: 'Other tenant', region: 'Oceania' })])
    await db.query(`INSERT INTO public.forms (id, tenant_id, name, fields, layout) VALUES ($1, $2, 'Shipping', $3, $4)`, [FORM, A, JSON.stringify(FIELDS), JSON.stringify(LAYOUT)])
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
  })

  const options = (region: string | undefined, c = ctx(A)) => resolveDynamicValue(c, { form_id: FORM }, { field_key: 'country', prop: 'options', ...(region ? { params: { region } } : {}) })

  it('options from the table, filtered by the URL parameter, sorted, the declared columns only', async () => {
    const oceania = await options('Oceania')
    expect(oceania.value).toEqual([{ value: 'AU', label: 'Australia' }, { value: 'FJ', label: 'Fiji' }, { value: 'NZ', label: 'New Zealand' }])
    expect(JSON.stringify(oceania)).not.toMatch(/X\d|iso_secret|Other tenant/)
    expect((await options('Europe')).value).toEqual([{ value: 'FR', label: 'France' }, { value: 'DE', label: 'Germany' }])
    // The parameter's default applies when none is given.
    expect((await options(undefined)).value).toHaveLength(3)
    await expect(options('Mars')).rejects.toThrow(/allowed values/)
  })

  it('tenant isolation and data.view', async () => {
    await expect(options('Oceania', ctx(B))).rejects.toThrow(/Form not found/)
    await expect(options('Oceania', ctx(A, ['forms.submit']))).rejects.toThrow(/data.view/)
  })

  it('submitting: the value must be among the options the server resolves for this submission; the max comes from the variable', async () => {
    await expect(submitForm(ctx(A), FORM, { values: { country: 'FR', qty: 1 }, params: { region: 'Oceania' } })).rejects.toMatchObject({ details: { fields: { country: expect.stringMatching(/must be one of: AU, FJ, NZ/) } } })
    await expect(submitForm(ctx(A), FORM, { values: { country: 'Preview', qty: 1 }, params: { region: 'Oceania' } })).rejects.toMatchObject({ details: { fields: { country: expect.stringMatching(/must be one of/) } } })
    await expect(submitForm(ctx(A), FORM, { values: { country: 'NZ', qty: 6 }, params: { region: 'Oceania' } })).rejects.toMatchObject({ details: { fields: { qty: 'Quantity must be at most 5' } } })
    const ok = await submitForm(ctx(A), FORM, { values: { country: 'FR', qty: 8 }, params: { region: 'Europe' }, variables: { limit: 10 } })
    expect(ok.submission.id).toBeTruthy()
    const { rows } = await db.query(`SELECT values FROM public.form_submissions WHERE id = $1`, [ok.submission.id])
    expect(rows[0].values).toMatchObject({ country: 'FR', qty: 8 })
  })
})
