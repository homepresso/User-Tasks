/**
 * Label fields against a LOCAL Supabase stack (real PostgREST): a stored
 * Label ("Include in submission") is recomputed by the server on submit —
 * an order total over an editable Data table adds up the table's own rows
 * (the first page, read from the database with the author's base filter)
 * plus the person's verified changes; a forged total and forged reported
 * rows are ignored; a label a rule could not have written keeps its default.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/form-label-field-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'
import { submitForm } from '@/lib/services/form-submissions'
import { CONTROLS_KEY } from '@/lib/forms/form-params'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `f0f0a7b1-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const A = id(0xa)
const TABLE = id(0x10)
const FORM = id(0x30)
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

const LINES = [
  { order: 'SO-1', product: 'Chai', qty: 2, price: 18 },
  { order: 'SO-1', product: 'Chang', qty: 1, price: 19 },
  { order: 'SO-2', product: 'Tofu', qty: 10, price: 23.25 },
]

const DT = {
  source: 'table', table_id: TABLE, mode: 'edit', allow_add: true, allow_delete: true, page_size: 10,
  columns: [
    { key: 'product', label: 'Product', type: 'text' },
    { key: 'qty', label: 'Qty', type: 'number' },
    { key: 'price', label: 'Price', type: 'number' },
  ],
  // This order's lines only.
  base_filter: { match: 'all', conditions: [{ column: 'order', operator: 'eq', value: '{{form.order}}' }] },
}
const FIELDS = [
  { key: 'order', label: 'Order', type: 'text' },
  { key: 'lines', label: 'Lines', type: 'data_table', data_table: DT },
  { key: 'total', label: 'Order total', type: 'label', label_config: { expression: 'SUMPRODUCT(control.lines.rows, "qty", "price")', format: { kind: 'currency', currency: 'USD' }, include: true } },
  { key: 'items', label: 'Items', type: 'label', label_config: { expression: 'SUM(control.lines.rows, "qty")', include: true } },
  { key: 'status', label: 'Status', type: 'label', default: 'Draft', label_config: { include: true } },
]

describe.skipIf(!DB_URL)('Label fields: server recompute on submit (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const ctx = (): ServiceContext => ({ supabase: admin, tenantId: A, actorId: null, permissions: new Set(['forms.submit', 'data.view']), authKind: 'api_key', source: 'api' } as ServiceContext)
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }

  async function cleanup() {
    for (const table of ['form_submissions', 'forms', 'custom_table_rows', 'custom_tables']) await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [A]).catch(() => undefined)
    await db.query('DELETE FROM public.tenants WHERE id = $1', [A])
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Label A', 'label-a-test')`, [A])
    const columns = JSON.stringify(['order', 'product', 'qty', 'price'].map((key) => ({ key, name: key, type: key === 'qty' || key === 'price' ? 'number' : 'text' })))
    await db.query(`INSERT INTO public.custom_tables (id, tenant_id, name, slug, columns) VALUES ($1, $2, 'Order lines', 'order-lines-label-test', $3)`, [TABLE, A, columns])
    for (const [i, line] of LINES.entries()) await db.query(`INSERT INTO public.custom_table_rows (tenant_id, table_id, data, created_at) VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`, [A, TABLE, JSON.stringify(line), String(i)])
    await db.query(`INSERT INTO public.forms (id, tenant_id, name, fields) VALUES ($1, $2, 'Order', $3)`, [FORM, A, JSON.stringify(FIELDS)])
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
  })

  const stored = async (submissionId: string) => (await db.query('SELECT values FROM public.form_submissions WHERE id = $1', [submissionId])).rows[0].values

  it('the total is the server\'s: this order\'s rows from the database plus the changes; forged totals and reported rows are ignored', async () => {
    const { rows } = await db.query(`SELECT id, data FROM public.custom_table_rows WHERE table_id = $1 AND data->>'product' = 'Chang'`, [TABLE])
    const chang = rows[0].id as string
    const values = {
      order: 'SO-1',
      // Chang's quantity 1 → 3, and a new line.
      lines: { added: [{ product: 'Ikura', qty: 1, price: 31 }], updated: [{ key: chang, after: { qty: 3 } }], deleted: [] },
      total: 1, items: 999, status: 'Approved by me',
      [CONTROLS_KEY]: { lines: { loaded_rows: [{ product: 'Forged', qty: 1000, price: 1000 }] } },
    }
    const result = await submitForm(ctx(), FORM, { values, idempotency_key: 'label-submit-0001' })
    const saved = await stored(result.submission.id)
    // SO-1 only (the base filter): Chai 2 × 18, Chang 3 × 19 (edited), Ikura 1 × 31 (added).
    expect(saved.total).toBe(2 * 18 + 3 * 19 + 31)
    expect(saved.items).toBe(6)
    // No rule could have written it: the default stands.
    expect(saved.status).toBe('Draft')
  })

  it('another order: other rows; a deleted line drops out', async () => {
    const { rows } = await db.query(`SELECT id FROM public.custom_table_rows WHERE table_id = $1 AND data->>'product' = 'Tofu'`, [TABLE])
    const result = await submitForm(ctx(), FORM, { values: { order: 'SO-2', lines: { added: [], updated: [], deleted: [{ key: rows[0].id }] }, total: 232.5 }, idempotency_key: 'label-submit-0002' })
    const saved = await stored(result.submission.id)
    expect(saved.total).toBe(0)
    expect(saved.items).toBe(0)
  })
})
