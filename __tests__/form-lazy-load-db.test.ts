/**
 * When to load against a LOCAL Supabase stack (real PostgREST): the server
 * does not care about lazy mounting.
 *  - a form saved through the service keeps `load` / `preload` on its tabs
 *    and sections (versions, the API);
 *  - a lazy tab's required field is still enforced on submit, whatever the
 *    browser claims it loaded;
 *  - a never-mounted part's defaults (and other values) are stored;
 *  - the loaded list (`__form_state.loaded`) is never stored.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/form-lazy-load-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import * as forms from '@/lib/services/forms'
import { submitForm } from '@/lib/services/form-submissions'
import { FORM_STATE_KEY } from '@/lib/forms/form-state'
import { defaultTaskFieldValues, normalizeTaskFields } from '@/lib/task-field-schema'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const A = 'f0f01a2b-0000-4000-8000-00000000000a'
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

const FIELDS = [
  { key: 'name', label: 'Full name', type: 'text', required: true },
  { key: 'region', label: 'Region', type: 'choice', options: ['EMEA', 'APAC'], default: 'EMEA' },
  { key: 'budget', label: 'Budget', type: 'number', required: true },
  { key: 'approver', label: 'Approver email', type: 'email', required: true },
  { key: 'notes', label: 'Notes', type: 'textarea', default: 'None' },
]
const LAYOUT = {
  mode: 'tabs',
  rows: [],
  pages: [
    { id: 'applicant', title: 'Applicant', rows: [{ columns: 1, cells: [{ field_key: 'name', span: 1 }] }] },
    { id: 'money', title: 'Money', load: 'visible', preload: true, rows: [{ columns: 2, cells: [{ field_key: 'region', span: 1 }, { field_key: 'budget', span: 1 }] }] },
    { id: 'approval', title: 'Approval', load: 'rule', rows: [{ columns: 1, cells: [{ field_key: 'approver', span: 1 }], section: 'signoff' }, { columns: 1, cells: [{ field_key: 'notes', span: 1 }] }] },
  ],
  sections: [{ key: 'signoff', title: 'Sign-off', load: 'visible' }],
}

describe.skipIf(!DB_URL)('When to load: server validation unchanged (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const ctx = (): ServiceContext => ({ supabase: admin, tenantId: A, actorId: null, permissions: null, authKind: 'api_key', source: 'api' } as ServiceContext)
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
  let formId = ''

  async function cleanup() {
    for (const table of ['form_submissions', 'form_versions', 'forms', 'object_audit_log']) await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [A]).catch(() => undefined)
    await db.query('DELETE FROM public.tenants WHERE id = $1', [A])
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Lazy A', 'lazy-a-test')`, [A])
    formId = (await forms.createForm(ctx(), { name: 'Purchase request', fields: FIELDS, layout: LAYOUT })).id
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
  })

  const stored = async (submissionId: string) => (await db.query('SELECT values FROM public.form_submissions WHERE id = $1', [submissionId])).rows[0].values

  it('the saved form keeps When to load on its tabs and sections', async () => {
    const form: any = await forms.getForm(ctx(), formId)
    expect(form.layout.pages.map((p: any) => [p.id, p.load ?? null, p.preload ?? null])).toEqual([['applicant', null, null], ['money', 'visible', true], ['approval', 'rule', null]])
    expect(form.layout.sections).toEqual([{ key: 'signoff', title: 'Sign-off', load: 'visible' }])
  })

  it('a lazy tab\'s required field is still enforced — even when the browser says nothing loaded', async () => {
    const values = { ...defaultTaskFieldValues(normalizeTaskFields(FIELDS)), name: 'Ann', approver: 'boss@example.com', [FORM_STATE_KEY]: { flags: {}, hidden: [], loaded: [] } }
    await expect(submitForm(ctx(), formId, { values, idempotency_key: 'lazy-submit-0001' })).rejects.toMatchObject({ status: 400 })
    // …and the rule-loaded tab's section too.
    const noApprover = { ...defaultTaskFieldValues(normalizeTaskFields(FIELDS)), name: 'Ann', budget: 500, [FORM_STATE_KEY]: { flags: {}, hidden: [], loaded: ['page:money'] } }
    await expect(submitForm(ctx(), formId, { values: noApprover, idempotency_key: 'lazy-submit-0002' })).rejects.toThrow(/Approver email/)
  })

  it('a never-mounted part\'s defaults and values are stored; the loaded list is not', async () => {
    // The browser's initial values (defaults) — the Money and Approval tabs never mounted.
    const values = { ...defaultTaskFieldValues(normalizeTaskFields(FIELDS)), name: 'Ann', budget: 1200, approver: 'boss@example.com', [FORM_STATE_KEY]: { flags: {}, hidden: [], loaded: [] } }
    const result = await submitForm(ctx(), formId, { values, idempotency_key: 'lazy-submit-0003' })
    const saved = await stored(result.submission.id)
    expect(saved).toMatchObject({ name: 'Ann', region: 'EMEA', budget: 1200, approver: 'boss@example.com', notes: 'None' })
    expect(saved).not.toHaveProperty(FORM_STATE_KEY)
    expect(JSON.stringify(saved)).not.toContain('loaded')
  })
})
