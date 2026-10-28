/**
 * Seed the "Northwind Trading" demo workspace used for the docs/marketing
 * screenshots. Re-runnable: everything is find-or-create by name.
 *
 *   scripts/screenshots/README.md has the full recipe. In short:
 *   node scripts/screenshots/mock-services.mjs &          # mock ERP / Splunk / webhooks
 *   npx tsx scripts/screenshots/seed-demo.ts              # with local-stack env exported
 *
 * Only the tenant bootstrap and the API-key mint use the service role; all
 * other data goes through the public REST API (/api/v1) so it is realistic.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed API payloads */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  APP_URL, DEMO, FAKE_TOKEN, MOCK_URL, OUT, assertLocal, ensureDir, makeApi, readState, requireTool, sleep, writeState,
} from './common'

assertLocal()

const CRON_SECRET = process.env.CRON_SECRET ?? ''
const state = readState()
const log = (msg: string) => console.log(`• ${msg}`)

// ─── Service-role steps: tenant + API key ───

async function ensureTenantAndKey(): Promise<string> {
  const { createClient } = requireTool('@supabase/supabase-js')
  const bcrypt = requireTool('bcryptjs')
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  let { data: tenant } = await sb.from('tenants').select('id, name, slug').eq('slug', DEMO.slug).maybeSingle()
  if (!tenant) {
    const { provisionTenant } = await import('../../lib/tenant-provisioning')
    const result = await provisionTenant(sb, {
      fullName: DEMO.name, email: DEMO.email, password: DEMO.password, company: DEMO.org,
      onboardingCompleted: false, userMetadata: { bootstrap: true },
      settings: { bootstrap: { source: 'screenshots', created_at: new Date().toISOString() } },
    })
    if (!result.ok) throw new Error(`provisionTenant failed: ${result.ok === false ? (result as any).error ?? (result as any).reason : ''}`)
    ;({ data: tenant } = await sb.from('tenants').select('id, name, slug').eq('slug', DEMO.slug).single())
    log(`created tenant ${DEMO.org}`)
  }
  const { data: user, error: uerr } = await sb.from('users').select('id, tenant_id').eq('email', DEMO.email).eq('tenant_id', tenant.id).maybeSingle()
  if (uerr || !user) throw new Error(`demo owner ${DEMO.email} not found in tenant ${tenant.id}: ${uerr?.message ?? ''}`)
  state.tenant_id = tenant.id
  state.user_id = user.id

  const keyFile = join(OUT, 'api-key.txt')
  if (existsSync(keyFile)) {
    const existing = (await import('node:fs')).readFileSync(keyFile, 'utf8').trim()
    const res = await fetch(`${APP_URL}/api/v1/me`, { headers: { authorization: `Bearer ${existing}` } })
    if (res.ok) {
      // Keep the demo key on every permission (new ones appear as features ship).
      const { PERMISSION_KEYS } = await import('../../lib/permissions')
      await sb.from('api_keys').update({ permissions: [...PERMISSION_KEYS] }).eq('tenant_id', tenant.id).eq('key_prefix', existing.slice(0, 8))
      return existing
    }
  }
  const { PERMISSION_KEYS } = await import('../../lib/permissions')
  const token = 'ut_' + randomBytes(32).toString('hex')
  const { error } = await sb.from('api_keys').insert({
    tenant_id: tenant.id, name: 'Screenshots demo', key_prefix: token.slice(0, 8), key_hash: await bcrypt.hash(token, 10),
    key_type: 'tenant', created_by: user.id, permissions: [...PERMISSION_KEYS],
  })
  if (error) throw new Error(`api key insert failed: ${error.message}`)
  ensureDir(OUT)
  writeFileSync(join(OUT, '.gitignore'), '*\n')
  writeFileSync(keyFile, token + '\n', { mode: 0o600 })
  log('minted demo API key → scripts/screenshots/.out/api-key.txt')
  return token
}

/** --reset-runs: delete the demo workflows' runs, queue jobs and tasks so a fresh batch can be started. */
async function resetRuns(workflowIds: string[]) {
  const { createClient } = requireTool('@supabase/supabase-js')
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const ids = workflowIds.filter(Boolean)
  for (const [table, column] of [['tasks', 'workflow_id'], ['workflow_queue', 'workflow_id'], ['workflow_runs', 'workflow_id']] as const) {
    const { error } = await sb.from(table).delete().eq('tenant_id', state.tenant_id).in(column, ids)
    if (error) throw new Error(`reset ${table}: ${error.message}`)
  }
  log('reset demo runs, queue jobs and tasks')
}

// ─── REST helpers ───

type Api = ReturnType<typeof makeApi>

/** The list payload's array (lists come back as { <resource>: [...], total }). */
function items(data: any): any[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    for (const value of Object.values(data)) if (Array.isArray(value)) return value
  }
  return []
}

async function findByName(api: Api, listPath: string, name: string): Promise<any | null> {
  const list = items(await api('GET', `${listPath}${listPath.includes('?') ? '&' : '?'}limit=200`))
  return list.find((row) => row.name === name) ?? null
}

/** Find-or-create by name; `update` (optional) brings an existing record in line. */
async function upsert(api: Api, label: string, listPath: string, name: string, create: () => Promise<any>, update?: (existing: any) => Promise<any>): Promise<any> {
  const existing = await findByName(api, listPath, name)
  if (existing) {
    if (update) await update(existing)
    log(`${label} "${name}" exists (${existing.id})`)
    return existing
  }
  const created = await create()
  const record = created?.[Object.keys(created).find((k) => created[k] && typeof created[k] === 'object' && 'id' in created[k]) ?? ''] ?? created
  log(`${label} "${name}" created (${record?.id ?? record?.workflow_id ?? '?'})`)
  return (await findByName(api, listPath, name)) ?? record
}

// ─── Data ───

const VENDOR_ROWS = [
  { vendor_id: 'V-1001', name: 'Contoso Office Supplies', category: 'Office', risk: 'Low', country: 'New Zealand', iban: 'GB33BUKB20201555555555', payment_terms: 30, active: true },
  { vendor_id: 'V-1002', name: 'Fabrikam Logistics', category: 'Logistics', risk: 'Medium', country: 'Australia', iban: 'DE89370400440532013000', payment_terms: 45, active: true },
  { vendor_id: 'V-1003', name: 'Litware Hardware', category: 'Capex', risk: 'High', country: 'United States', iban: 'FR1420041010050500013M02606', payment_terms: 30, active: true },
  { vendor_id: 'V-1004', name: 'Tailspin Consulting', category: 'Services', risk: 'Medium', country: 'New Zealand', iban: 'NL91ABNA0417164300', payment_terms: 20, active: true },
  { vendor_id: 'V-1005', name: 'Adventure Works Catering', category: 'Facilities', risk: 'Low', country: 'New Zealand', iban: 'GB29NWBK60161331926819', payment_terms: 14, active: true },
  { vendor_id: 'V-1006', name: 'Proseware Software', category: 'IT', risk: 'Low', country: 'Ireland', iban: 'IE29AIBK93115212345678', payment_terms: 30, active: true },
  { vendor_id: 'V-1007', name: 'Wide World Importers', category: 'Logistics', risk: 'High', country: 'Singapore', iban: 'SG00WWIB00000000000000', payment_terms: 60, active: false },
  { vendor_id: 'V-1099', name: 'Woodgrove Utilities', category: 'Facilities', risk: 'Medium', country: 'New Zealand', iban: 'GB82WEST12345698765432', payment_terms: 20, active: true },
]

const EMAIL_HTML = `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
  <h2 style="margin:0 0 12px">Invoice {{invoice_number}} approved</h2>
  <p>Hi {{requester_name}},</p>
  <p>Your invoice from <strong>{{vendor_name}}</strong> for <strong>{{currency}} {{=FORMAT_NUMBER(amount, 2)}}</strong> was approved by {{approver_level}} and is scheduled for payment.</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0">
    <tr><td style="padding:6px 0;color:#64748b">Cost centre</td><td style="padding:6px 0">{{task_data.cost_centre}}</td></tr>
    <tr><td style="padding:6px 0;color:#64748b">Approver comment</td><td style="padding:6px 0">{{task_data.comment}}</td></tr>
  </table>
  <p style="color:#64748b;font-size:13px">Northwind Trading · Accounts payable</p>
</div>`

const IBAN_SOURCE = `/**
 * Validate an IBAN (ISO 13616): length per country + mod-97 checksum.
 */
async function run(inputs) {
  const iban = String(inputs.iban ?? '').replace(/\\s+/g, '').toUpperCase()
  const lengths = { DE: 22, FR: 27, GB: 22, IE: 22, NL: 18, NZ: 0 }
  const country = iban.slice(0, 2)
  if (!/^[A-Z]{2}\\d{2}[A-Z0-9]+$/.test(iban)) {
    return { outputs: { valid: false, reason: 'Malformed IBAN', country } }
  }
  if (lengths[country] && iban.length !== lengths[country]) {
    return { outputs: { valid: false, reason: 'Wrong length for ' + country, country } }
  }
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let remainder = 0
  for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97
  return { outputs: { valid: remainder === 1, reason: remainder === 1 ? 'OK' : 'Checksum mismatch', country } }
}
module.exports = { run }
`

// Canvas layout: node cards are 224 px wide (x/y are the card's top-left);
// three 264 px columns, 135 px rows; offset so the graph sits centred in the
// designer canvas at 60% zoom.
const COL = { left: 300, mid: 564, right: 828 }
const ROW = (n: number) => 30 + n * 135

function invoiceWorkflow(ids: { getVendor: string; createPayment: string; table: string; template: string; userId: string }) {
  const nodes = [
    { id: 'trigger', type: 'webhook_received', label: 'Invoice received', position: { x: COL.mid, y: ROW(0) }, config: {} },
    { id: 'title', type: 'set_title', label: 'Set title', position: { x: COL.mid, y: ROW(1) }, config: { title: 'Invoice {{invoice_number}} · {{currency}} {{amount}}' } },
    {
      id: 'vendor', type: 'call_reference', label: 'Get vendor', position: { x: COL.mid, y: ROW(2) },
      config: {
        reference_id: ids.getVendor,
        input_mappings: { vendor_id: '{{vendor_id}}' },
        output_mappings: {
          name: { enabled: true, variableName: 'vendor_name' },
          risk: { enabled: true, variableName: 'vendor_risk' },
          category: { enabled: true, variableName: 'vendor_category' },
        },
      },
    },
    {
      id: 'policy', type: 'decision_table', label: 'Approval policy', position: { x: COL.mid, y: ROW(3) },
      config: { decision_table_id: ids.table, input_mappings: { amount: '{{amount}}', vendor_risk: '{{vendor_risk}}', category: '{{vendor_category}}' } },
    },
    {
      id: 'auto', type: 'condition', label: 'Auto-approve?', position: { x: COL.mid, y: ROW(4) },
      config: { branches: [{ label: 'Auto-approve', logic: 'and', rules: [{ field: '{{auto_approve}}', operator: 'equals', value: 'true' }] }], has_else: true },
    },
    { id: 'log_auto', type: 'log', label: 'Log auto-approval', position: { x: COL.left, y: ROW(5) }, config: { message: 'Invoice {{invoice_number}} auto-approved by policy rule "{{rule_label}}"', level: 'info' } },
    {
      id: 'approve', type: 'user_task', label: 'Approve invoice', position: { x: COL.right, y: ROW(5) },
      config: {
        task_title: 'Approve invoice {{invoice_number}} — {{vendor_name}}',
        task_description: '{{vendor_name}} invoiced {{currency}} {{amount}}. Policy rule "{{rule_label}}" requires {{approver_level}} approval.',
        task_priority: 'high',
        outcomes: ['Approved', 'Rejected'],
        assignment_type: 'individual',
        assignee_mode: 'specific',
        assignee_id: ids.userId,
        due_date_mode: 'relative', due_offset_amount: 2, due_offset_unit: 'days',
        fields: [
          { key: 'amount', label: 'Amount', type: 'number', required: true, default: '{{amount}}' },
          { key: 'cost_centre', label: 'Cost centre', type: 'choice', required: true, options: ['CC-100 Operations', 'CC-200 Sales', 'CC-300 IT', 'CC-400 Facilities'] },
          { key: 'comment', label: 'Comment', type: 'text', placeholder: 'Reason for approving or rejecting' },
        ],
      },
    },
    {
      id: 'notify', type: 'send_email', label: 'Email requester', position: { x: COL.mid, y: ROW(6) + 25 }, onError: 'continue',
      config: { to: '{{requester_email}}', email_template_id: ids.template },
    },
    { id: 'log_reject', type: 'log', label: 'Log rejection', position: { x: COL.right, y: ROW(6) + 25 }, config: { message: 'Invoice {{invoice_number}} rejected: {{task_data.comment}}', level: 'warn' } },
    {
      id: 'pay', type: 'call_reference', label: 'Create payment', position: { x: COL.mid, y: ROW(7) + 20 },
      config: {
        reference_id: ids.createPayment,
        input_mappings: { vendor_id: '{{vendor_id}}', amount: '{{amount}}', invoice_number: '{{invoice_number}}' },
        output_mappings: { payment_id: { enabled: true, variableName: 'payment_id' } },
      },
    },
    { id: 'end', type: 'end_workflow', label: 'Done', position: { x: COL.mid, y: ROW(8) + 15 }, config: { reason: 'Invoice {{invoice_number}} processed' } },
  ]
  const edges = [
    { id: 'e-trigger-title', source: 'trigger', target: 'title' },
    { id: 'e-title-vendor', source: 'title', target: 'vendor' },
    { id: 'e-vendor-policy', source: 'vendor', target: 'policy' },
    { id: 'e-policy-auto', source: 'policy', target: 'auto' },
    { id: 'e-auto-yes', source: 'auto', target: 'log_auto', label: 'Auto-approve' },
    { id: 'e-auto-no', source: 'auto', target: 'approve', label: 'Else' },
    { id: 'e-approved', source: 'approve', target: 'notify', label: 'Approved' },
    { id: 'e-rejected', source: 'approve', target: 'log_reject', label: 'Rejected' },
    { id: 'e-auto-pay', source: 'log_auto', target: 'pay' },
    { id: 'e-notify-pay', source: 'notify', target: 'pay' },
    { id: 'e-pay-end', source: 'pay', target: 'end' },
    { id: 'e-reject-end', source: 'log_reject', target: 'end' },
  ]
  const user_variables = [
    { id: 'v-invoice', name: 'invoice_number', type: 'string', defaultValue: '', description: 'Supplier invoice number' },
    { id: 'v-vendor', name: 'vendor_id', type: 'string', defaultValue: '', description: 'ERP vendor id (V-1001…)' },
    { id: 'v-amount', name: 'amount', type: 'number', defaultValue: '0', description: 'Invoice total' },
    { id: 'v-currency', name: 'currency', type: 'string', defaultValue: 'NZD', description: 'ISO currency code' },
    { id: 'v-req', name: 'requester_email', type: 'string', defaultValue: '', description: 'Who submitted the invoice' },
  ]
  return { nodes, edges, user_variables }
}

const INVOICES = [
  { invoice_number: 'INV-24017', vendor_id: 'V-1001', amount: 420.5, currency: 'NZD', requester_name: 'Grace Hopper', requester_email: 'grace@northwind.example' },
  { invoice_number: 'INV-24018', vendor_id: 'V-1002', amount: 8950, currency: 'NZD', requester_name: 'Alan Turing', requester_email: 'alan@northwind.example' },
  { invoice_number: 'INV-24019', vendor_id: 'V-1003', amount: 32400, currency: 'USD', requester_name: 'Katherine Johnson', requester_email: 'katherine@northwind.example' },
  { invoice_number: 'INV-24020', vendor_id: 'V-1004', amount: 12600, currency: 'NZD', requester_name: 'Grace Hopper', requester_email: 'grace@northwind.example' },
  { invoice_number: 'INV-24021', vendor_id: 'V-1099', amount: 2310.75, currency: 'NZD', requester_name: 'Alan Turing', requester_email: 'alan@northwind.example' },
  { invoice_number: 'INV-24022', vendor_id: 'V-1006', amount: 4200, currency: 'EUR', requester_name: 'Margaret Hamilton', requester_email: 'margaret@northwind.example' },
  { invoice_number: 'INV-24023', vendor_id: 'V-1005', amount: 760, currency: 'NZD', requester_name: 'Margaret Hamilton', requester_email: 'margaret@northwind.example' },
  { invoice_number: 'INV-24024', vendor_id: 'V-1002', amount: 5480, currency: 'NZD', requester_name: 'Katherine Johnson', requester_email: 'katherine@northwind.example' },
]

// ─── Steps ───

async function seedIntegration(api: Api) {
  const config = { base_url: `${MOCK_URL}`, auth_type: 'bearer', auth_config: { token: FAKE_TOKEN }, headers: {} }
  const integration = await upsert(api, 'integration', '/integrations', 'Northwind ERP',
    () => api('POST', '/integrations', { name: 'Northwind ERP', type: 'rest_api', config, tags: ['finance', 'erp'] }))
  const refs = items(await api('GET', `/integrations/${integration.id}/references?limit=100`))
  const ensureRef = async (name: string, body: any) => {
    const found = refs.find((r) => r.name === name)
    if (found) return found
    const created = await api('POST', `/integrations/${integration.id}/references`, { name, ...body })
    log(`reference "${name}" created`)
    return created?.reference ?? created
  }
  const getVendor = await ensureRef('Get vendor', {
    description: 'Fetch the vendor master record (name, category, risk rating, IBAN)',
    method: 'GET', path_template: '/vendors/{{vendor_id}}',
    inputs: [{ name: 'vendor_id', type: 'string', required: true, location: 'path' }],
    outputs: [
      { name: 'name', path: 'name', type: 'string' }, { name: 'category', path: 'category', type: 'string' },
      { name: 'risk', path: 'risk', type: 'string' }, { name: 'iban', path: 'iban', type: 'string' },
      { name: 'payment_terms_days', path: 'payment_terms_days', type: 'number' },
    ],
    tags: ['vendors'],
  })
  const createPayment = await ensureRef('Create payment', {
    description: 'Schedule a vendor payment in the ERP',
    method: 'POST', path_template: '/payments',
    body_template: '{"vendor_id":"{{vendor_id}}","amount":{{amount}},"invoice_number":"{{invoice_number}}"}',
    inputs: [
      { name: 'vendor_id', type: 'string', required: true, location: 'body' },
      { name: 'amount', type: 'number', required: true, location: 'body' },
      { name: 'invoice_number', type: 'string', required: true, location: 'body' },
    ],
    outputs: [{ name: 'payment_id', path: 'payment_id', type: 'string' }, { name: 'status', path: 'status', type: 'string' }, { name: 'scheduled_for', path: 'scheduled_for', type: 'string' }],
    tags: ['payments'],
  })
  await ensureRef('List vendors', {
    description: 'All vendors in the ERP', method: 'GET', path_template: '/vendors', inputs: [],
    outputs: [{ name: 'vendors', path: 'vendors', type: 'array' }], tags: ['vendors'],
  })
  try { await api('POST', `/integrations/${integration.id}/test`, {}) } catch (e) { log(`integration test: ${(e as Error).message}`) }
  state.integration_id = integration.id
  state.get_vendor_reference_id = getVendor.id
  state.create_payment_reference_id = createPayment.id
  return { getVendor: getVendor.id as string, createPayment: createPayment.id as string }
}

async function seedDecisionTable(api: Api) {
  const body = {
    name: 'Invoice approval policy',
    description: 'Who must approve a vendor invoice, by amount, vendor risk and spend category. First matching rule wins.',
    inputs: [
      { key: 'amount', label: 'Amount', type: 'number' },
      { key: 'vendor_risk', label: 'Vendor risk', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
    ],
    outputs: [
      { key: 'approver_level', label: 'Approver level', type: 'text' },
      { key: 'auto_approve', label: 'Auto-approve', type: 'boolean' },
    ],
    rules: [
      { label: 'Small, low-risk', conditions: [{ inputKey: 'amount', operator: 'less_than', value: '1000' }, { inputKey: 'vendor_risk', operator: 'equals', value: 'low' }], outputs: { approver_level: 'None', auto_approve: true } },
      { label: 'High-risk vendor', conditions: [{ inputKey: 'vendor_risk', operator: 'equals', value: 'high' }], outputs: { approver_level: 'CFO', auto_approve: false } },
      { label: 'Large invoice', conditions: [{ inputKey: 'amount', operator: 'greater_than_or_equal', value: '25000' }], outputs: { approver_level: 'CFO', auto_approve: false } },
      { label: 'Capital expenditure', conditions: [{ inputKey: 'category', operator: 'equals', value: 'capex' }], outputs: { approver_level: 'Finance director', auto_approve: false } },
      { label: 'Mid-size invoice', conditions: [{ inputKey: 'amount', operator: 'greater_than_or_equal', value: '5000' }], outputs: { approver_level: 'Finance manager', auto_approve: false } },
      { label: 'Everything else', conditions: [], outputs: { approver_level: 'Team lead', auto_approve: false } },
    ],
  }
  const table = await upsert(api, 'decision table', '/decision-tables', body.name, () => api('POST', '/decision-tables', body))
  state.decision_table_id = table.id
  return table.id as string
}

async function seedEmailTemplate(api: Api) {
  const body = {
    name: 'Invoice approved',
    description: 'Sent to the requester when an invoice is approved',
    subject: 'Invoice {{invoice_number}} from {{vendor_name}} approved',
    html_body: EMAIL_HTML,
  }
  const template = await upsert(api, 'email template', '/email-templates', body.name, () => api('POST', '/email-templates', body))
  state.email_template_id = template.id
  return template.id as string
}

async function seedActivity(api: Api) {
  const body = {
    name: 'Validate IBAN',
    description: 'Checks an IBAN\'s country length and mod-97 checksum before a payment is scheduled.',
    source_code: IBAN_SOURCE,
    status: 'active',
    version: '1.2.0',
    icon_name: 'ShieldCheck',
    color: '#0EA5E9',
    tags: ['finance', 'payments'],
    demo_inputs: { iban: 'GB33BUKB20201555555555' },
    manifest: {
      display_name: 'Validate IBAN',
      purpose: 'Reject payments to malformed bank accounts',
      summary: 'Country length + ISO 7064 mod-97 checksum',
      inputs: [{ name: 'iban', label: 'IBAN', type: 'string', required: true, description: 'International bank account number' }],
      outputs: [
        { name: 'valid', label: 'Valid', type: 'boolean' },
        { name: 'reason', label: 'Reason', type: 'string' },
        { name: 'country', label: 'Country', type: 'string' },
      ],
    },
  }
  const activity = await upsert(api, 'custom step', '/workflow-activities', body.name, () => api('POST', '/workflow-activities', body))
  state.activity_id = activity.id
}

async function seedDataTable(api: Api) {
  const body = {
    name: 'Vendors',
    description: 'Approved vendor master (mirrors the ERP)',
    columns: [
      { key: 'vendor_id', name: 'Vendor ID', type: 'text', required: true },
      { key: 'name', name: 'Name', type: 'text', required: true },
      { key: 'category', name: 'Category', type: 'select', options: ['Office', 'Logistics', 'Capex', 'Services', 'Facilities', 'IT'] },
      { key: 'risk', name: 'Risk', type: 'select', options: ['Low', 'Medium', 'High'] },
      { key: 'country', name: 'Country', type: 'text' },
      { key: 'iban', name: 'IBAN', type: 'text' },
      { key: 'payment_terms', name: 'Payment terms (days)', type: 'number' },
      { key: 'active', name: 'Active', type: 'boolean' },
    ],
  }
  const table = await upsert(api, 'data table', '/data-tables', body.name, () => api('POST', '/data-tables', body))
  const rows = items(await api('GET', `/data-tables/${table.id}/rows?limit=200`))
  if (rows.length === 0) {
    await api('POST', `/data-tables/${table.id}/rows`, { rows: VENDOR_ROWS.map((data) => ({ data })) })
    log(`inserted ${VENDOR_ROWS.length} vendor rows`)
  }
  state.data_table_id = table.id
}

async function upsertWorkflow(api: Api, name: string, body: any, notes: string): Promise<string> {
  const existing = await findByName(api, '/workflows', name)
  let id: string
  if (!existing) {
    const created = await api('POST', '/workflows', { name, ...body, is_active: true, publish: true, publish_notes: notes })
    id = created.workflow_id ?? created.id ?? created.workflow?.id
    state.workflow_signatures = { ...(state.workflow_signatures ?? {}), [name]: createHash('sha1').update(JSON.stringify(body)).digest('hex') }
    log(`workflow "${name}" created + published (${id})`)
  } else {
    id = existing.id
    const sig = createHash('sha1').update(JSON.stringify(body)).digest('hex')
    state.workflow_signatures ??= {}
    if (state.workflow_signatures[name] === sig) {
      log(`workflow "${name}" unchanged (${id})`)
      return id
    }
    state.workflow_signatures[name] = sig
    const res = await api('PATCH', `/workflows/${id}`, body)
    if (res?.changed) {
      await api('POST', `/workflows/${id}/publish`, { notes })
      log(`workflow "${name}" updated + republished (${id})`)
    } else {
      log(`workflow "${name}" unchanged (${id})`)
    }
  }
  try { await api('POST', `/workflows/${id}/activate`, {}) } catch { /* already active */ }
  return id
}

async function seedWorkflows(api: Api, ids: { getVendor: string; createPayment: string; table: string; template: string }) {
  const invoice = invoiceWorkflow({ ...ids, userId: state.user_id })
  state.workflow_id = await upsertWorkflow(api, 'Invoice approval', {
    description: 'Look up the vendor, apply the approval policy, route to an approver and schedule the payment.',
    trigger_type: 'webhook_received', tags: ['finance', 'accounts-payable'], ...invoice,
  }, 'Route by approval policy; email requester on approval')

  state.onboarding_workflow_id = await upsertWorkflow(api, 'Vendor onboarding', {
    description: 'Collect and review new vendor details before they can be paid.',
    trigger_type: 'webhook_received', tags: ['finance', 'vendors'],
    nodes: [
      { id: 'trigger', type: 'webhook_received', label: 'Vendor requested', position: { x: COL.mid, y: ROW(0) }, config: {} },
      { id: 'title', type: 'set_title', label: 'Set title', position: { x: COL.mid, y: ROW(1) }, config: { title: 'Onboard {{vendor_name}}' } },
      {
        id: 'review', type: 'user_task', label: 'Review vendor documents', position: { x: COL.mid, y: ROW(2) },
        config: {
          task_title: 'Review vendor documents — {{vendor_name}}', task_priority: 'medium', outcomes: ['Approve', 'Request changes'],
          assignment_type: 'individual', assignee_id: state.user_id,
          fields: [{ key: 'iban', label: 'IBAN', type: 'text', required: true }, { key: 'risk', label: 'Risk rating', type: 'choice', options: ['Low', 'Medium', 'High'] }],
        },
      },
      { id: 'add', type: 'log', label: 'Add to vendor master', position: { x: COL.mid, y: ROW(3) }, config: { message: 'Vendor {{vendor_name}} approved' } },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'title' }, { id: 'e2', source: 'title', target: 'review' },
      { id: 'e3', source: 'review', target: 'add', label: 'Approve' },
    ],
  }, 'Initial version')

  state.sync_workflow_id = await upsertWorkflow(api, 'Nightly payment sync', {
    description: 'Every night, pull the vendor list from the ERP and log the sync.',
    trigger_type: 'schedule', trigger_config: { cron: '0 2 * * *', timezone: 'Pacific/Auckland' }, tags: ['finance', 'sync'],
    nodes: [
      { id: 'trigger', type: 'schedule', label: 'Every night at 02:00', position: { x: COL.mid, y: ROW(0) }, config: { cron: '0 2 * * *', timezone: 'Pacific/Auckland' } },
      { id: 'fetch', type: 'call_reference', label: 'List vendors', position: { x: COL.mid, y: ROW(1) }, config: { reference_id: state.list_vendors_reference_id ?? '' } },
      { id: 'log', type: 'log', label: 'Log sync', position: { x: COL.mid, y: ROW(2) }, config: { message: 'Vendor sync complete' } },
    ],
    edges: [{ id: 'e1', source: 'trigger', target: 'fetch' }, { id: 'e2', source: 'fetch', target: 'log' }],
  }, 'Initial version')

  // Three typed inputs for the Run dialog shot (text required, number with a default, boolean).
  state.welcome_workflow_id = await upsertWorkflow(api, 'Customer welcome pack', {
    description: 'Send a new customer their welcome pack and set their opening credit limit.',
    trigger_type: 'webhook_received', tags: ['sales', 'customers'],
    user_variables: [
      { id: 'customer_name', name: 'customer_name', type: 'string', defaultValue: '', description: 'Legal name as it appears on the contract', required: true },
      { id: 'credit_limit', name: 'credit_limit', type: 'number', defaultValue: '5000', description: 'Opening credit limit in NZD' },
      { id: 'vip', name: 'vip', type: 'boolean', defaultValue: 'false', description: 'Assign an account manager straight away' },
    ],
    nodes: [
      { id: 'trigger', type: 'webhook_received', label: 'New customer', position: { x: COL.mid, y: ROW(0) }, config: {} },
      { id: 'log', type: 'log', label: 'Send welcome pack', position: { x: COL.mid, y: ROW(1) }, config: { message: 'Welcome pack for {{customer_name}} · credit limit {{credit_limit}} · VIP {{vip}}' } },
    ],
    edges: [{ id: 'e1', source: 'trigger', target: 'log' }],
  }, 'Initial version')
}

async function seedReport(api: Api) {
  const body = {
    name: 'Invoice approvals by outcome',
    description: 'Invoice approval runs grouped by status',
    category: 'Finance',
    is_shared: true,
    config: {
      data_source: 'workflow_runs',
      columns: ['status'],
      filters: [],
      group_by: ['status'],
      aggregations: [{ fn: 'COUNT', field: '' }],
      visualization: 'bar',
      sort: { field: '_count', direction: 'desc' },
      row_limit: 100,
      chart_style: { title: 'Invoice approvals by outcome', x_axis_label: 'Run status', y_axis_label: 'Runs' },
    },
  }
  const report = await upsert(api, 'report', '/reports', body.name, () => api('POST', '/reports', body),
    (existing) => api('PATCH', `/reports/${existing.id}`, { description: body.description, config: body.config }))
  state.report_id = report.id
}

async function seedPeople(api: Api) {
  const role = await upsert(api, 'role', '/roles', 'Finance approver',
    () => api('POST', '/roles', {
      name: 'Finance approver', description: 'Approves vendor invoices and views finance workflows and reports',
      permissions: ['tasks.view_own', 'tasks.view_all', 'tasks.complete', 'tasks.redirect', 'workflows.view', 'workflows.view_runs', 'reports.view', 'data.view'],
    }))
  state.role_id = role.id
  const team = await upsert(api, 'team', '/teams', 'Accounts payable',
    () => api('POST', '/teams', { name: 'Accounts payable', description: 'Vendor invoices, payments and supplier queries' }))
  state.team_id = team.id
  try { await api('PUT', `/teams/${team.id}/members/${state.user_id}`, { role: 'lead' }) } catch (e) { log(`team member: ${(e as Error).message}`) }
  const invites = items(await api('GET', '/invitations?limit=100'))
  if (!invites.some((i) => i.email === 'grace@northwind.example')) {
    try {
      await api('POST', '/invitations', { email: 'grace@northwind.example', role: 'member' })
      log('invitation sent to grace@northwind.example')
    } catch (e) { log(`invitation: ${(e as Error).message}`) }
  }
}

async function seedLogDestinations(api: Api) {
  const splunk = await upsert(api, 'log destination', '/log-destinations', 'Splunk (SOC)',
    () => api('POST', '/log-destinations', {
      name: 'Splunk (SOC)', type: 'splunk_hec',
      config: { url: `${MOCK_URL}/services/collector/event`, index: 'usertasks', sourcetype: 'usertasks:event', source: 'northwind-trading' },
      credentials: { token: FAKE_TOKEN },
      filters: {}, start_from: 'now',
    }))
  const hook = await upsert(api, 'log destination', '/log-destinations', 'Ops webhook',
    () => api('POST', '/log-destinations', {
      name: 'Ops webhook', type: 'webhook',
      config: { url: `${MOCK_URL}/hooks/ops-events` },
      credentials: { signing_secret: 'whsec_' + '0'.repeat(32) },
      filters: { categories: ['workflow', 'integration'], min_severity: 'info' }, start_from: 'now',
    }))
  state.splunk_destination_id = splunk.id
  state.webhook_destination_id = hook.id
}

// ─── Runs ───

async function cron(path: string, method = 'POST') {
  const res = await fetch(`${APP_URL}${path}`, { method, headers: { authorization: `Bearer ${CRON_SECRET}`, 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined })
  const text = await res.text()
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text.slice(0, 200)}`)
  try { return JSON.parse(text) } catch { return text }
}

export async function drainQueue(rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    const r = await cron('/api/workflows/process')
    if (!r?.processed && !r?.more) break
    await sleep(500)
  }
}

export async function ship(times = 2) {
  for (let i = 0; i < times; i++) await cron('/api/cron/ship-events?budget_ms=4000')
}

async function seedRuns(api: Api) {
  const existing = items(await api('GET', `/workflows/runs?workflow_id=${state.workflow_id}&limit=100`))
  if (existing.length > 0 && !process.argv.includes('--more-runs')) {
    log(`runs exist (${existing.length}); pass --more-runs to start another batch`)
    return
  }
  if (!CRON_SECRET) throw new Error('CRON_SECRET must be set to drive the queue processor')
  const started: string[] = []
  for (const vars of INVOICES) {
    const res = await api('POST', '/workflows/start', { workflow_id: state.workflow_id, variables: vars, async: true })
    started.push(res?.run_id ?? res?.queue_id ?? res?.id ?? JSON.stringify(res))
    await sleep(300)
  }
  log(`started ${started.length} invoice runs`)
  // The V-1099 vendor lookup hangs past the engine's 30 s HTTP timeout.
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await drainQueue(3)
    const runs = items(await api('GET', `/workflows/runs?workflow_id=${state.workflow_id}&limit=100`))
    const busy = runs.filter((r) => ['pending', 'queued', 'running'].includes(r.status))
    if (runs.length >= INVOICES.length && busy.length === 0) break
    await sleep(3000)
  }
  // Approve one waiting invoice and reject another so both outcome paths have history.
  const tasks = items(await api('GET', '/tasks?is_workflow_task=true&limit=100')).filter((t) => t.status !== 'completed' && /^Approve invoice/.test(t.title))
  const pick = (inv: string) => tasks.find((t) => t.title.includes(inv))
  const approve = pick('INV-24018')
  const reject = pick('INV-24022')
  if (approve) {
    await api('POST', `/tasks/${approve.id}/action`, { action: 'complete', outcome: 'Approved', values: { amount: 8950, cost_centre: 'CC-100 Operations', comment: 'Matches PO-7781, goods received.' } })
    log(`approved task ${approve.id}`)
  }
  if (reject) {
    await api('POST', `/tasks/${reject.id}/action`, { action: 'complete', outcome: 'Rejected', values: { amount: 4200, cost_centre: 'CC-300 IT', comment: 'Duplicate of INV-23988 — already paid.' } })
    log(`rejected task ${reject.id}`)
  }
  await sleep(1000)
  await drainQueue(4)
}

/** Two vendor-onboarding requests (medium priority → they wait in the Task Queue for acceptance). */
async function seedOnboardingRuns(api: Api) {
  const existing = items(await api('GET', `/workflows/runs?workflow_id=${state.onboarding_workflow_id}&limit=100`))
  if (existing.length > 0) return
  for (const vendor_name of ['Northwind Packaging Ltd', 'Blue Yonder Airlines']) {
    await api('POST', '/workflows/start', { workflow_id: state.onboarding_workflow_id, variables: { vendor_name }, async: true })
  }
  await drainQueue(3)
  log('started 2 vendor onboarding runs')
}

/**
 * Publish v2 of "Vendor onboarding" (adds a sanctions screening step after
 * the review) once its runs wait on v1, so the live-instance migration
 * screenshots have instances on an older version. Skipped when v2 exists.
 */
async function seedOnboardingV2(api: Api) {
  const id = state.onboarding_workflow_id
  const def = await api('GET', `/workflows/${id}/definition`)
  if ((def?.nodes ?? []).some((n: any) => n.id === 'screen')) return
  const nodes = (def.nodes as any[]).map((n) => n.id === 'add' ? { ...n, position: { ...n.position, y: ROW(4) } } : n)
  nodes.push({ id: 'screen', type: 'log', label: 'Sanctions screening', position: { x: COL.mid, y: ROW(3) }, config: { message: 'Screened {{vendor_name}} against sanctions lists' } })
  const edges = (def.edges as any[]).filter((e) => !(e.source === 'review' && e.target === 'add'))
  edges.push({ id: 'e3', source: 'review', target: 'screen', label: 'Approve' }, { id: 'e4', source: 'screen', target: 'add' })
  await api('PATCH', `/workflows/${id}`, { nodes, edges })
  await api('POST', `/workflows/${id}/publish`, { notes: 'Add sanctions screening before the vendor master' })
  log('published Vendor onboarding v2 (sanctions screening); its runs stay on v1')
}

// ─── Main ───

async function main() {
  const health = await fetch(`${MOCK_URL}/health`).catch(() => null)
  if (!health?.ok) throw new Error(`mock services not reachable at ${MOCK_URL}: start node scripts/screenshots/mock-services.mjs first`)

  const key = await ensureTenantAndKey()
  const api = makeApi(key)
  await api('GET', '/me')
  writeState(state)

  const refs = await seedIntegration(api)
  const listVendors = items(await api('GET', `/integrations/${state.integration_id}/references?limit=100`)).find((r) => r.name === 'List vendors')
  state.list_vendors_reference_id = listVendors?.id
  const table = await seedDecisionTable(api)
  const template = await seedEmailTemplate(api)
  await seedActivity(api)
  await seedDataTable(api)
  await seedLogDestinations(api)
  await seedWorkflows(api, { ...refs, table, template })
  if (process.argv.includes('--reset-runs')) await resetRuns([state.workflow_id, state.onboarding_workflow_id])
  await seedPeople(api)
  writeState(state)

  await seedRuns(api)
  await seedOnboardingRuns(api)
  await seedOnboardingV2(api)
  await seedReport(api)
  if (CRON_SECRET) await ship(3)

  const runs = items(await api('GET', `/workflows/runs?workflow_id=${state.workflow_id}&limit=100`))
  state.runs = runs.map((r) => ({ id: r.id, status: r.status, title: r.title }))
  state.failed_run_id = runs.find((r) => r.status === 'failed')?.id
  state.completed_run_id = runs.find((r) => r.status === 'completed')?.id
  state.auto_approved_run_id = runs.find((r) => r.status === 'completed' && /INV-24017/.test(r.title ?? ''))?.id
  state.approved_run_id = runs.find((r) => r.status === 'completed' && /INV-24018/.test(r.title ?? ''))?.id
  const openTasks = items(await api('GET', '/tasks?is_workflow_task=true&limit=100')).filter((t) => t.status !== 'completed')
  state.task_id = openTasks.find((t) => /INV-24020/.test(t.title))?.id ?? openTasks[0]?.id
  writeState(state)
  console.log('\nRuns:')
  for (const r of state.runs) console.log(`  ${r.status.padEnd(10)} ${r.title ?? ''} ${r.id}`)
  console.log(`\nDemo state → ${join(OUT, 'demo-state.json')}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
