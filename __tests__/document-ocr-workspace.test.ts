/* eslint-disable @typescript-eslint/no-explicit-any -- memory table rows */
/**
 * Document OCR per workspace (bring your own Azure AI Document Intelligence
 * key): the resolution order (workspace → instance only where allowed →
 * clear error), the Azure adapter's request shape, the write-only key (never
 * returned, logged, audited or exported), SSRF rejection of endpoints, and
 * per-step usage (pages sent).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  // 32-byte key so encryptSensitiveFields really encrypts in these tests.
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
})

// DNS: one name that rebinds to a private address, everything else public.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => (host.includes('rebind') ? [{ address: '10.0.0.7', family: 4 }] : [{ address: '20.10.30.40', family: 4 }])),
}))
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/deletion-queue', () => ({ enqueueDeletionJob: vi.fn(async () => {}), kickDeletionProcessor: vi.fn(), processDeletionQueueBatch: vi.fn(async () => {}) }))
vi.mock('@/lib/files/resolve-input', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/files/resolve-input')>()
  return { ...actual, resolveFileInput: vi.fn() }
})

import { writeAudit } from '@/lib/audit-log'
import { resolveFileInput } from '@/lib/files/resolve-input'
import { azureOcrProvider, instanceOcrDefaultAllowed, testAzureOcr } from '@/lib/documents/ocr'
import { decideOcrSource, OCR_NOT_CONFIGURED_MESSAGE, workspaceOcrFromTenantSettings } from '@/lib/documents/ocr-settings'
import { openWorkspaceOcr } from '@/lib/documents/ocr-workspace'
import { runDocumentNode } from '@/lib/documents/handlers'
import * as documentOcr from '@/lib/services/document-ocr'
import { exportConfig } from '@/lib/services/config'
import { getDocumentOcrEndpoint } from '@/lib/api-schemas/document-ocr'
import { prepareRoundTripBody } from '@/lib/api-schemas/registry'
import { updateDocumentOcrEndpoint } from '@/lib/api-schemas/document-ocr'
import type { ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

const TENANT = 'tenant-a'
const OTHER = 'tenant-b'
const KEY = 'azure-key-0123456789abcdef-NOT-REAL'
const ENDPOINT = 'https://acme-ocr.cognitiveservices.azure.com'

function seed(settingsA: Record<string, unknown> = {}) {
  return createMemorySupabase({
    tenants: [{ id: TENANT, name: 'A', settings: { other: 1, ...settingsA } }, { id: OTHER, name: 'B', settings: {} }],
    tenant_connectors: [],
    integrations: [],
    integration_references: [],
  }, { uuids: true })
}

function context(supabase: ReturnType<typeof createMemorySupabase>, permissions = ['settings.view', 'settings.edit', 'integrations.view', 'integrations.create', 'integrations.edit', 'integrations.delete', 'integrations.test']): ServiceContext {
  return { supabase: supabase as any, db: supabase as any, tenantId: TENANT, actorId: 'user-1', permissions: new Set(permissions), authKind: 'api_key', source: 'api' }
}

/** Azure mock: 202 + operation-location on analyze, then succeeded; 200 on /info. */
function azureFetch(options: { status?: number } = {}) {
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; bodyBytes: number }> = []
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
    const method = String(init?.method ?? 'GET')
    calls.push({ method, url: String(url), headers, bodyBytes: init?.body ? (init.body as Uint8Array).byteLength : 0 })
    if (options.status && options.status !== 200) return Response.json({ error: { code: 'Unauthorized', message: 'Access denied due to invalid subscription key.' } }, { status: options.status })
    if (String(url).includes('/info?')) return Response.json({ customDocumentModels: { count: 0, limit: 500 } })
    if (method === 'POST') return new Response(null, { status: 202, headers: { 'operation-location': `${String(url).split('/documentintelligence')[0]}/documentintelligence/documentModels/prebuilt-read/analyzeResults/op-1?api-version=2024-11-30` } })
    return Response.json({ status: 'succeeded', analyzeResult: { content: 'INVOICE 42', pages: [{ words: [{ confidence: 0.9 }, { confidence: 0.7 }] }] } })
  })
  return { impl, calls }
}

const noSleep = async () => {}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.mocked(writeAudit).mockClear()
})

/* ── Resolution order ──────────────────────────────────────────────── */

describe('resolution order', () => {
  it('DOCUMENT_OCR_INSTANCE_DEFAULT: true when self-hosted, false on the cloud, explicit values win', () => {
    vi.stubEnv('DEPLOYMENT_MODE', '')
    vi.stubEnv('DOCUMENT_OCR_INSTANCE_DEFAULT', '')
    expect(instanceOcrDefaultAllowed()).toBe(true)
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    expect(instanceOcrDefaultAllowed()).toBe(false)
    vi.stubEnv('DOCUMENT_OCR_INSTANCE_DEFAULT', 'true')
    expect(instanceOcrDefaultAllowed()).toBe(true)
    vi.stubEnv('DEPLOYMENT_MODE', 'self_hosted')
    vi.stubEnv('DOCUMENT_OCR_INSTANCE_DEFAULT', 'false')
    expect(instanceOcrDefaultAllowed()).toBe(false)
  })

  it('workspace setting first, the instance only when allowed, else a clear error', () => {
    const none = workspaceOcrFromTenantSettings({})
    expect(none).toEqual({ provider: 'instance_default', connector_id: null })
    expect(decideOcrSource(none, { defaultAllowed: true, provider: 'azure_document_intelligence' })).toEqual({ kind: 'instance' })
    expect(decideOcrSource(none, { defaultAllowed: false, provider: 'azure_document_intelligence' })).toMatchObject({ kind: 'error', code: 'not_configured', message: OCR_NOT_CONFIGURED_MESSAGE })
    expect(decideOcrSource(none, { defaultAllowed: true, provider: 'none' })).toMatchObject({ kind: 'error', message: expect.stringMatching(/turned off on this instance/) })
    expect(decideOcrSource({ provider: 'azure_document_intelligence', connector_id: 'c1' }, { defaultAllowed: false, provider: 'none' })).toEqual({ kind: 'workspace_azure', connectorId: 'c1' })
    expect(decideOcrSource({ provider: 'off', connector_id: 'c1' }, { defaultAllowed: true, provider: 'tesseract' })).toMatchObject({ kind: 'error', code: 'off' })
    expect(decideOcrSource({ provider: 'tesseract', connector_id: null }, { defaultAllowed: false, provider: 'none' })).toEqual({ kind: 'workspace_tesseract' })
    expect(OCR_NOT_CONFIGURED_MESSAGE).toMatch(/OCR isn't set up for this workspace\. An admin can add an Azure AI Document Intelligence key in Settings → Document OCR/)
  })

  it('the cloud never falls back to the instance key when the flag is off', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('DOCUMENT_OCR_INSTANCE_DEFAULT', '')
    vi.stubEnv('DOCUMENT_OCR_PROVIDER', 'azure_document_intelligence')
    vi.stubEnv('AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT', 'https://platform.cognitiveservices.azure.com')
    vi.stubEnv('AZURE_DOCUMENT_INTELLIGENCE_KEY', 'platform-key-should-never-be-used')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(openWorkspaceOcr(seed() as any, TENANT, 'eng')).rejects.toThrow(OCR_NOT_CONFIGURED_MESSAGE)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('self-hosted keeps the instance configuration when the workspace has no setting', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', '')
    vi.stubEnv('DOCUMENT_OCR_PROVIDER', 'azure_document_intelligence')
    vi.stubEnv('AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT', 'https://instance.cognitiveservices.azure.com')
    vi.stubEnv('AZURE_DOCUMENT_INTELLIGENCE_KEY', 'instance-key')
    const opened = await openWorkspaceOcr(seed() as any, TENANT, 'eng')
    expect(opened).toMatchObject({ source: 'instance', provider: { id: 'azure_document_intelligence' } })
    vi.stubEnv('DOCUMENT_OCR_PROVIDER', 'none')
    await expect(openWorkspaceOcr(seed() as any, TENANT, 'eng')).rejects.toThrow(/turned off on this instance/)
  })

  it('a workspace that turned OCR off fails even where the instance has OCR', async () => {
    vi.stubEnv('DOCUMENT_OCR_PROVIDER', 'azure_document_intelligence')
    await expect(openWorkspaceOcr(seed({ document_ocr: { provider: 'off' } }) as any, TENANT, 'eng')).rejects.toThrow(/turned off for this workspace/)
  })
})

/* ── Azure adapter ─────────────────────────────────────────────────── */

describe('Azure AI Document Intelligence adapter', () => {
  it('posts the page to prebuilt-read with the key header, then polls the operation', async () => {
    const { impl, calls } = azureFetch()
    const provider = azureOcrProvider({ endpoint: `${ENDPOINT}/`, key: KEY, apiVersion: '2024-11-30' }, { fetchImpl: impl as never, sleep: noSleep })
    const result = await provider.recognize(Buffer.from([1, 2, 3, 4]), { languages: 'deu+eng' })
    expect(result).toEqual({ text: 'INVOICE 42', confidence: 80, provider: 'azure_document_intelligence' })
    expect(calls[0]).toEqual({
      method: 'POST',
      url: `${ENDPOINT}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30&locale=de`,
      headers: { 'Ocp-Apim-Subscription-Key': KEY, 'Content-Type': 'application/octet-stream' },
      bodyBytes: 4,
    })
    expect(calls[1]).toMatchObject({ method: 'GET', url: expect.stringContaining('/analyzeResults/op-1'), headers: { 'Ocp-Apim-Subscription-Key': KEY } })
  })

  it('older API versions use the /formrecognizer path', async () => {
    const { impl, calls } = azureFetch()
    await azureOcrProvider({ endpoint: ENDPOINT, key: KEY, apiVersion: '2023-07-31' }, { fetchImpl: impl as never, sleep: noSleep }).recognize(Buffer.from('x'), { languages: 'eng' })
    expect(calls[0].url).toBe(`${ENDPOINT}/formrecognizer/documentModels/prebuilt-read:analyze?api-version=2023-07-31`)
  })

  it('errors name the status and Azure message, never the key', async () => {
    const { impl } = azureFetch({ status: 401 })
    const error = await azureOcrProvider({ endpoint: ENDPOINT, key: KEY }, { fetchImpl: impl as never, sleep: noSleep }).recognize(Buffer.from('x'), { languages: 'eng' }).then(() => new Error('resolved'), (e) => e as Error)
    expect(error.message).toMatch(/HTTP 401 \(check the key\).*invalid subscription key/)
    expect(error.message).not.toContain(KEY)
    const test = await testAzureOcr({ endpoint: ENDPOINT, key: KEY }, { fetchImpl: impl as never })
    expect(test).toMatchObject({ ok: false, statusCode: 401 })
    expect(JSON.stringify(test)).not.toContain(KEY)
  })

  it('the connection test is the free /info call', async () => {
    const { impl, calls } = azureFetch()
    expect(await testAzureOcr({ endpoint: ENDPOINT, key: KEY }, { fetchImpl: impl as never })).toMatchObject({ ok: true })
    expect(calls).toEqual([{ method: 'GET', url: `${ENDPOINT}/documentintelligence/info?api-version=2024-11-30`, headers: { 'Ocp-Apim-Subscription-Key': KEY }, bodyBytes: 0 }])
  })

  it('refuses plain http', () => {
    expect(() => azureOcrProvider({ endpoint: 'http://acme.example.com', key: KEY })).toThrow(/must be an https:\/\/ URL/)
  })
})

/* ── Service: write-only key, SSRF, audit, export ──────────────────── */

describe('workspace setting (service)', () => {
  beforeEach(() => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
  })

  it('stores the key encrypted in a connector and never returns, audits or exports it', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const view = await documentOcr.updateDocumentOcr(ctx, { provider: 'azure_document_intelligence', endpoint: `${ENDPOINT}/`, key: KEY })
    expect(view).toMatchObject({
      provider: 'azure_document_intelligence',
      azure: { endpoint: ENDPOINT, key: '__SECRET__', key_saved: true, enabled: true },
      effective: { status: 'ready', provider: 'azure_document_intelligence', source: 'workspace' },
      instance: { default_allowed: false },
    })
    expect(JSON.stringify(view)).not.toContain(KEY)
    expect(getDocumentOcrEndpoint.response!.safeParse(view).success).toBe(true)

    // At rest: the setting holds only provider + connector id; the key is ciphertext.
    const tenant = supabase.tables.tenants.find((t) => t.id === TENANT)!
    expect(tenant.settings).toEqual({ other: 1, document_ocr: { provider: 'azure_document_intelligence', connector_id: view.azure!.connector_id } })
    expect(JSON.stringify(supabase.tables)).not.toContain(KEY)
    expect(supabase.tables.tenant_connectors[0]).toMatchObject({ tenant_id: TENANT, connector_key: 'azure_document_intelligence' })

    // Audit rows: set (create), no key anywhere.
    const audits = vi.mocked(writeAudit).mock.calls.map(([row]) => row)
    expect(audits.some((row) => row.objectType === 'workspace' && row.action === 'create' && (row.metadata as any)?.kind === 'document_ocr')).toBe(true)
    expect(JSON.stringify(audits)).not.toContain(KEY)

    // Reads and exports: no key.
    expect(JSON.stringify(await documentOcr.getDocumentOcr(ctx))).not.toContain(KEY)
    const exported = await exportConfig(ctx, { types: ['connectors', 'document_ocr'], format: 'manifest' })
    expect(exported.manifest!.document_ocr).toEqual({ provider: 'azure_document_intelligence', connector_id: view.azure!.connector_id })
    expect(exported.manifest!.connectors[0].credentials).toEqual({ api_key: '__SECRET__' })
    expect(JSON.stringify(exported)).not.toContain(KEY)
  })

  it('changing the endpoint keeps the key; replace and remove are audited', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    await documentOcr.updateDocumentOcr(ctx, { provider: 'azure_document_intelligence', endpoint: ENDPOINT, key: KEY })
    const changed = await documentOcr.updateDocumentOcr(ctx, { provider: 'azure_document_intelligence', endpoint: 'https://acme-two.cognitiveservices.azure.com', key: '__SECRET__', api_version: '2024-11-30' })
    expect(changed.azure).toMatchObject({ endpoint: 'https://acme-two.cognitiveservices.azure.com', key_saved: true, api_version: '2024-11-30' })
    const replaced = await documentOcr.updateDocumentOcr(ctx, { provider: 'azure_document_intelligence', key: 'second-key-NOT-REAL' })
    expect(replaced.azure?.key_saved).toBe(true)
    const removed = await documentOcr.removeDocumentOcrKey(ctx)
    expect(removed).toMatchObject({ provider: 'instance_default', azure: null, effective: { status: 'not_configured', message: OCR_NOT_CONFIGURED_MESSAGE } })
    expect(supabase.tables.tenant_connectors).toHaveLength(0)
    const actions = vi.mocked(writeAudit).mock.calls.map(([row]) => row).filter((row) => (row.metadata as any)?.kind === 'document_ocr').map((row) => row.action)
    expect(actions).toEqual(['create', 'update', 'update', 'delete'])
    expect(JSON.stringify(vi.mocked(writeAudit).mock.calls)).not.toMatch(/NOT-REAL/)
  })

  it.each([
    ['http://acme.cognitiveservices.azure.com', /https/],
    ['https://127.0.0.1', /not allowed/],
    ['https://169.254.169.254', /not allowed/],
    ['https://10.1.2.3', /not allowed/],
    ['https://localhost:8443', /not allowed/],
    ['https://metadata.google.internal', /not allowed/],
    ['https://rebind.attacker.example', /not allowed.*private/],
    ['https://user:pw@acme.cognitiveservices.azure.com', /credentials/],
    ['ftp://acme.example.com', /https/],
  ])('rejects endpoint %s (SSRF rules) and writes nothing', async (endpoint, message) => {
    const supabase = seed()
    await expect(documentOcr.updateDocumentOcr(context(supabase), { provider: 'azure_document_intelligence', endpoint, key: KEY }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(message) })
    expect(supabase.tables.tenant_connectors).toHaveLength(0)
    expect(supabase.tables.tenants.find((t) => t.id === TENANT)!.settings).toEqual({ other: 1 })
  })

  it('needs settings.edit to change and settings.view to read', async () => {
    const supabase = seed()
    await expect(documentOcr.updateDocumentOcr(context(supabase, ['settings.view']), { provider: 'off' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(documentOcr.testDocumentOcr(context(supabase, ['settings.view']))).rejects.toMatchObject({ code: 'forbidden' })
    await expect(documentOcr.getDocumentOcr(context(supabase, []))).rejects.toMatchObject({ code: 'forbidden' })
    await expect(documentOcr.updateDocumentOcr(context(supabase), { provider: 'azure_document_intelligence', endpoint: ENDPOINT })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/key is required/) })
  })

  it('test connection: saved or typed values, recorded and audited without the key', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    await documentOcr.updateDocumentOcr(ctx, { provider: 'azure_document_intelligence', endpoint: ENDPOINT, key: KEY })
    const ok = azureFetch()
    expect(await documentOcr.testDocumentOcr(ctx, {}, { fetchImpl: ok.impl as never })).toEqual({ status: 'success', message: expect.stringMatching(/Connected/), http_status: 200 })
    expect(ok.calls[0].headers['Ocp-Apim-Subscription-Key']).toBe(KEY)
    expect(supabase.tables.tenant_connectors[0]).toMatchObject({ last_test_status: 'success' })
    const bad = azureFetch({ status: 401 })
    const failed = await documentOcr.testDocumentOcr(ctx, { key: 'wrong-key-NOT-REAL' }, { fetchImpl: bad.impl as never })
    expect(failed).toMatchObject({ status: 'error', http_status: 401, message: expect.stringMatching(/check the key/) })
    expect(supabase.tables.tenant_connectors[0]).toMatchObject({ last_test_status: 'success' }) // typed values don't overwrite the saved result
    const ssrf = await documentOcr.testDocumentOcr(ctx, { endpoint: 'https://169.254.169.254' }, { fetchImpl: ok.impl as never })
    expect(ssrf).toMatchObject({ status: 'error', message: expect.stringMatching(/not allowed/) })
    expect(ok.calls).toHaveLength(1)
    const tests = vi.mocked(writeAudit).mock.calls.map(([row]) => row).filter((row) => row.action === 'test')
    expect(tests).toHaveLength(3)
    expect(JSON.stringify(tests)).not.toMatch(/NOT-REAL/)
  })

  it('another workspace cannot use the connector id', async () => {
    const supabase = seed()
    const view = await documentOcr.updateDocumentOcr(context(supabase), { provider: 'azure_document_intelligence', endpoint: ENDPOINT, key: KEY })
    supabase.tables.tenants.find((t) => t.id === OTHER)!.settings = { document_ocr: { provider: 'azure_document_intelligence', connector_id: view.azure!.connector_id } }
    await expect(openWorkspaceOcr(supabase as any, OTHER, 'eng')).rejects.toThrow(/connection was removed/)
  })

  it('an imported connector without its key asks for the key again', async () => {
    const supabase = seed()
    const view = await documentOcr.updateDocumentOcr(context(supabase), { provider: 'azure_document_intelligence', endpoint: ENDPOINT, key: KEY })
    Object.assign(supabase.tables.tenant_connectors[0], { credentials: {}, is_enabled: false })
    expect((await documentOcr.getDocumentOcr(context(supabase))).effective).toMatchObject({ status: 'not_configured', message: expect.stringMatching(/key needs to be entered/) })
    await expect(openWorkspaceOcr(supabase as any, TENANT, 'eng')).rejects.toThrow(/re-entered/)
    expect(view.azure?.connector_id).toBeTruthy()
  })

  it('the GET response round-trips as the PUT body (key stays "__SECRET__")', async () => {
    const view = await documentOcr.updateDocumentOcr(context(seed()), { provider: 'azure_document_intelligence', endpoint: ENDPOINT, key: KEY })
    const body = prepareRoundTripBody(updateDocumentOcrEndpoint.body, updateDocumentOcrEndpoint.roundTrip!, view)
    expect(updateDocumentOcrEndpoint.body!.parse(body)).toEqual({ provider: 'azure_document_intelligence', endpoint: ENDPOINT, key: '__SECRET__' })
  })
})

/* ── Document step: usage and the not-configured error ─────────────── */

async function tinyPng(): Promise<Uint8Array> {
  const { PNG } = await import('pngjs')
  const png = new PNG({ width: 4, height: 4 })
  png.data.fill(255)
  return new Uint8Array(PNG.sync.write(png))
}

function stepContext(supabase: ReturnType<typeof createMemorySupabase>, tenantId = TENANT) {
  const variables: Record<string, any> = {}
  return {
    type: 'doc_read', config: { source: '{{file}}', ocr: 'auto' }, resolve: (v: unknown) => v,
    supabase: supabase as any, tenantId, variables, setVar: (k: string, v: unknown) => { variables[k] = v }, warn: () => {},
  }
}

describe('document step', () => {
  beforeEach(async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    vi.mocked(resolveFileInput).mockResolvedValue({ bytes: await tinyPng(), name: 'scan.png', mime_type: 'image/png', source: 'file' } as any)
  })

  it('OCRs with the workspace key and reports the pages sent (never the key)', async () => {
    const supabase = seed()
    await documentOcr.updateDocumentOcr(context(supabase), { provider: 'azure_document_intelligence', endpoint: ENDPOINT, key: KEY })
    const { impl, calls } = azureFetch()
    vi.stubGlobal('fetch', impl)
    const ctx = stepContext(supabase)
    const output = await runDocumentNode(ctx as any)
    expect(output).toMatchObject({ format: 'png', ocr: { provider: 'azure_document_intelligence', source: 'workspace', pages_sent: 1 } })
    expect(ctx.variables.document_text).toBe('INVOICE 42')
    expect(calls[0]).toMatchObject({ method: 'POST', url: expect.stringContaining('prebuilt-read:analyze'), headers: { 'Ocp-Apim-Subscription-Key': KEY } })
    expect(JSON.stringify(output)).not.toContain(KEY)
    expect(JSON.stringify(output)).not.toContain(ENDPOINT)
  }, 15_000)

  it('fails with the actionable error in a workspace without OCR', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(runDocumentNode(stepContext(seed()) as any)).rejects.toThrow(OCR_NOT_CONFIGURED_MESSAGE)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
