/**
 * E-signature end to end against a LOCAL Supabase stack and a local mock
 * DocuSign API (no real service, no account):
 *
 *   Send for Signature (a PDF given inline) → the mock records the envelope
 *   → Wait for Signature pauses the run (esign_waits row, run
 *   waiting_for_event) → the mock flips the envelope to completed → a
 *   DocuSign Connect delivery signed with the HMAC key hits the webhook route
 *   → the run is queued for resume → the queue worker resumes it → the
 *   "Completed" edge runs and the signed PDF + certificate are workflow
 *   files in storage (local storage provider). A replayed delivery is
 *   ignored; a forged one is refused.
 *
 * Runs only when EVENT_STREAM_DB_URL is set (migration 20261206000000 applied):
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/esign-e2e-db.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- rows and node outputs are free-form JSON */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createServer, type Server } from 'node:http'
import { createHmac } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { createClient } from './helpers/db-test-client'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const TENANT = '0e5a0000-0000-4000-8000-0000000000a1'
const WF = '0e5a0000-0000-4000-8000-0000000000a2'
const INTEGRATION = '0e5a0000-0000-4000-8000-0000000000a3'
const HMAC_KEY = 'connect-hmac-key-for-tests'
const PDF = Buffer.from('%PDF-1.7\n% signed by everyone\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
const CERT = Buffer.from('%PDF-1.7\n% certificate of completion\n%%EOF\n')

let supabase: SupabaseClient
vi.mock('@/lib/cron-auth', async (orig) => ({ ...(await orig() as object), createServiceClient: () => supabase }))
vi.mock('@/lib/providers/db', async (orig) => ({ ...(await orig() as object), getServiceDb: () => supabase }))
vi.mock('@/lib/process-queue', async (orig) => ({ ...(await orig() as object), kickQueueProcessor: () => {} }))

const mock = { status: 'sent', posts: [] as any[], auth: [] as string[] }

function workflowNodes() {
  return [
    { id: 'start', type: 'manual', label: 'Start', config: {} },
    {
      id: 'send', type: 'esign_send', label: 'Send NDA',
      config: {
        integration_id: INTEGRATION, source: 'documents', documents: '{{contract}}', subject: 'Please sign the NDA', message: 'Thanks!',
        recipients: [{ name: '{{signer_name}}', email: '{{signer_email}}', role: 'Client', routing_order: 1, anchor: '/sn1/' }],
        output_var: 'envelope',
      },
    },
    { id: 'wait', type: 'esign_wait', label: 'Wait for signature', config: { integration_id: INTEGRATION, envelope_id: '{{envelope.envelope_id}}', document: 'both', file_name: 'NDA signed', timeout_days: 7 } },
    { id: 'done', type: 'log', label: 'Signed', config: { message: 'Signed: {{signature.signed_document.name}}' } },
    { id: 'declined', type: 'log', label: 'Declined', config: { message: 'Declined' } },
  ]
}
const edges = [
  { id: 'e1', source: 'start', target: 'send' },
  { id: 'e2', source: 'send', target: 'wait' },
  { id: 'e3', source: 'wait', target: 'done', label: 'Completed' },
  { id: 'e4', source: 'wait', target: 'declined', label: 'Declined' },
]

async function cleanup(db: Client) {
  for (const table of ['esign_events', 'esign_waits', 'esign_envelopes', 'workflow_logs', 'workflow_queue', 'workflow_runs', 'integration_call_logs', 'workflow_versions', 'workflows', 'integrations']) {
    await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [TENANT]).catch(() => undefined)
  }
  await db.query('DELETE FROM public.tenants WHERE id = $1', [TENANT])
}

describe.skipIf(!DB_URL)('e-signature end to end (local stack + mock DocuSign)', () => {
  const db = new Client({ connectionString: DB_URL })
  let server: Server
  let base = ''
  let storageRoot = ''
  const saved: Record<string, string | undefined> = {}

  beforeAll(async () => {
    storageRoot = await mkdtemp(path.join(tmpdir(), 'ut-esign-store-'))
    for (const [k, v] of Object.entries({ STORAGE_PROVIDER: 'local', STORAGE_LOCAL_ROOT: storageRoot, ALLOW_PRIVATE_EGRESS: 'true', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, NEXT_PUBLIC_SUPABASE_URL: API_URL })) {
      saved[k] = process.env[k]
      process.env[k] = v
    }
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      mock.auth.push(String(req.headers.authorization ?? ''))
      const url = String(req.url)
      const send = (status: number, body: unknown, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)) }
      const A = '/restapi/v2.1/accounts/acct-1'
      if (req.method === 'POST' && url === `${A}/envelopes`) { mock.posts.push(JSON.parse(Buffer.concat(chunks).toString())); return send(201, { envelopeId: 'env-e2e', status: 'sent' }) }
      if (url.startsWith(`${A}/envelopes/env-e2e?`)) {
        return send(200, {
          envelopeId: 'env-e2e', status: mock.status, emailSubject: 'Please sign the NDA', completedDateTime: mock.status === 'completed' ? '2026-11-05T10:00:00Z' : undefined,
          recipients: { signers: [{ recipientId: '1', name: 'Ada Lovelace', email: 'ada@example.com', roleName: 'Client', routingOrder: '1', status: mock.status === 'completed' ? 'completed' : 'sent', signedDateTime: mock.status === 'completed' ? '2026-11-05T09:59:00Z' : undefined }] },
        })
      }
      if (url === `${A}/envelopes/env-e2e/documents/combined`) return send(200, PDF, 'application/pdf')
      if (url === `${A}/envelopes/env-e2e/documents/certificate`) return send(200, CERT, 'application/pdf')
      send(404, { errorCode: 'NOT_FOUND', message: url })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/restapi`

    await db.connect()
    await cleanup(db)
    supabase = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'E-sign E2E', 'esign-e2e')`, [TENANT])
    // As lib/services/connectors builds a DocuSign integration (API base URL override → the mock).
    const { getConnectorDefinition } = await import('@/lib/connectors/registry')
    const { connectorTemplateVars } = await import('@/lib/connectors/template-vars')
    const { encryptSensitiveFields } = await import('@/lib/secret-fields')
    const def = getConnectorDefinition('docusign')!
    const cfg = { environment: 'demo', base_url: 'auto', account_id: 'acct-1', api_base_url: base }
    const creds = { auth_method: 'authorization_code', access_token: 'mock-access-token', webhook_secret: HMAC_KEY }
    const config = encryptSensitiveFields({ ...def.buildIntegrationConfig(cfg, creds), template_vars: connectorTemplateVars(def, cfg, creds) })
    await db.query(`INSERT INTO public.integrations (id, tenant_id, name, type, config, is_active) VALUES ($1, $2, 'DocuSign (mock)', 'docusign', $3::jsonb, true)`, [INTEGRATION, TENANT, JSON.stringify(config)])
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type, nodes, edges) VALUES ($1, $2, 'NDA e-signature', true, 'manual', $3::jsonb, $4::jsonb)`,
      [WF, TENANT, JSON.stringify(workflowNodes()), JSON.stringify(edges)],
    )
  })

  afterAll(async () => {
    await cleanup(db).catch(() => undefined)
    await db.end()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    await rm(storageRoot, { recursive: true, force: true })
  })

  const webhook = async (body: string, signature: string) => {
    const { POST } = await import('@/app/api/webhooks/esign/[provider]/[integrationId]/route')
    const request = new NextRequest(`http://localhost/api/webhooks/esign/docusign/${INTEGRATION}`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-docusign-signature-1': signature } })
    return POST(request, { params: Promise.resolve({ provider: 'docusign', integrationId: INTEGRATION }) })
  }

  it('sends, waits, resumes on the signed Connect webhook and stores the signed PDF', async () => {
    const { executeWorkflow } = await import('@/lib/workflow-engine')
    const started = await executeWorkflow(WF, undefined, false, {
      contract: { base64: PDF.toString('base64'), name: 'NDA.pdf', mime_type: 'application/pdf' },
      signer_name: 'Ada Lovelace', signer_email: 'ada@example.com',
    }, undefined, undefined, undefined, { supabase })
    expect(started.error).toBeUndefined()
    expect(started.status).toBe('waiting_for_event')

    // The envelope as the mock received it.
    expect(mock.posts).toHaveLength(1)
    expect(mock.posts[0]).toMatchObject({
      emailSubject: 'Please sign the NDA', status: 'sent',
      documents: [{ name: 'NDA.pdf', fileExtension: 'pdf', documentBase64: PDF.toString('base64') }],
      recipients: { signers: [{ email: 'ada@example.com', name: 'Ada Lovelace', roleName: 'Client', tabs: { signHereTabs: [{ anchorString: '/sn1/' }] } }] },
    })
    expect(mock.auth.every((a) => a === 'Bearer mock-access-token')).toBe(true)

    const { rows: [run] } = await db.query(`SELECT id, status, event_id FROM public.workflow_runs WHERE tenant_id = $1 AND workflow_id = $2`, [TENANT, WF])
    expect(run.status).toBe('waiting_for_event')
    expect(run.event_id).toMatch(/^esignwait_/)
    const { rows: [wait] } = await db.query(`SELECT * FROM public.esign_waits WHERE tenant_id = $1`, [TENANT])
    expect(wait).toMatchObject({ envelope_id: 'env-e2e', status: 'waiting', provider: 'docusign', run_id: run.id, event_id: run.event_id })
    const { rows: [ledger] } = await db.query(`SELECT status, envelope_id FROM public.esign_envelopes WHERE tenant_id = $1`, [TENANT])
    expect(ledger).toEqual({ status: 'sent', envelope_id: 'env-e2e' })

    // A forged delivery is refused and changes nothing.
    const body = JSON.stringify({ event: 'envelope-completed', apiVersion: 'v2.1', generatedDateTime: new Date().toISOString(), configurationId: '42', data: { accountId: 'acct-1', envelopeId: 'env-e2e' } })
    const forged = await webhook(body, createHmac('sha256', 'wrong-key').update(body).digest('base64'))
    expect(forged.status).toBe(401)

    // The signer finishes; DocuSign Connect posts the completion.
    mock.status = 'completed'
    const signature = createHmac('sha256', HMAC_KEY).update(body).digest('base64')
    const delivered = await webhook(body, signature)
    expect(delivered.status).toBe(200)
    expect(await delivered.json()).toMatchObject({ ok: true, processed: 1, resumed: 1 })

    // Replay of the same delivery: acknowledged, not processed again.
    const replay = await webhook(body, signature)
    expect(await replay.json()).toMatchObject({ duplicates: 1, processed: 0 })

    // The queue worker resumes the run.
    const { processWorkflowQueueBatch } = await import('@/lib/workflow-queue-processor')
    await processWorkflowQueueBatch({ batchSize: 5 })
    const { rows: [after] } = await db.query(`SELECT status, node_results FROM public.workflow_runs WHERE id = $1`, [run.id])
    expect(after.status).toBe('completed')
    const out = after.node_results.wait.output
    expect(out).toMatchObject({ outcome: 'completed', status: 'completed', envelope_id: 'env-e2e', signed_count: 1, recipients: [{ email: 'ada@example.com', status: 'signed' }] })
    expect(out.signed_document).toMatchObject({ _file: true, name: 'NDA signed.pdf', size: PDF.byteLength, mime_type: 'application/pdf' })
    expect(out.certificate).toMatchObject({ name: 'NDA signed-certificate.pdf', size: CERT.byteLength })
    expect(after.node_results.done?.status).toBe('success')
    expect(after.node_results.declined).toBeUndefined()

    // The stored file is the signed PDF (storage provider, tenant folder).
    const { getStorageProvider } = await import('@/lib/providers/storage')
    const storage = await getStorageProvider()
    expect(out.signed_document.path).toContain(`workflow-files/${TENANT}/`)
    const stored = await storage.get('task-files', out.signed_document.path)
    expect(Buffer.from(await new Response(stored!.body as BodyInit).arrayBuffer())).toEqual(PDF)

    const { rows: [waitAfter] } = await db.query(`SELECT status, outcome FROM public.esign_waits WHERE id = $1`, [wait.id])
    expect(waitAfter).toEqual({ status: 'resumed', outcome: 'completed' })
    const { rows: logs } = await db.query(`SELECT message FROM public.workflow_logs WHERE tenant_id = $1`, [TENANT])
    expect(JSON.stringify(after.node_results.done)).toContain('Signed: NDA signed.pdf')
    // No credential reached the run, its logs or the ledger.
    const everything = JSON.stringify([after, logs, (await db.query(`SELECT * FROM public.esign_envelopes WHERE tenant_id = $1`, [TENANT])).rows])
    expect(everything).not.toContain('mock-access-token')
    expect(everything).not.toContain(HMAC_KEY)
  }, 60_000)
})
