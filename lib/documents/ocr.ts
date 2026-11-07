/**
 * OCR providers for scanned PDF pages (and images).
 *
 * Which provider a document step uses is decided per workspace
 * (lib/documents/ocr-workspace.ts): the workspace's own setting first
 * (Settings → Document OCR: its own Azure key, built-in tesseract, or off),
 * then — only where DOCUMENT_OCR_INSTANCE_DEFAULT allows it — the instance
 * configuration below:
 *
 *   DOCUMENT_OCR_PROVIDER = tesseract (default when installed)
 *                         | azure_document_intelligence
 *                         | none
 *
 * tesseract   tesseract.js (Apache-2.0, WebAssembly — no native code), an
 *             optional package. Language data (`eng.traineddata`) is
 *             downloaded on first use and cached in DOCUMENT_OCR_CACHE_DIR;
 *             air-gapped installs point DOCUMENT_OCR_LANG_PATH at a folder
 *             (or internal URL) that holds `<lang>.traineddata.gz`.
 * azure_document_intelligence
 *             Azure AI Document Intelligence "prebuilt-read"
 *             (AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT / _KEY).
 *
 * Keys never appear in errors, results or logs from this module.
 *
 * Google Document AI and AWS Textract plug in through the same interface
 * (see docs: /docs/workflows/documents/ocr).
 */

import { DOCUMENT_LIMITS, withTimeout } from './limits'

export interface OcrResult {
  text: string
  /** 0–100, or null when the provider gives none. */
  confidence: number | null
  provider: string
}

export interface OcrProvider {
  id: string
  recognize(image: Buffer, options: { languages: string }): Promise<OcrResult>
  close?(): Promise<void>
}

export type OcrProviderId = 'tesseract' | 'azure_document_intelligence' | 'none'

export function configuredOcrProvider(): OcrProviderId {
  const raw = String(process.env.DOCUMENT_OCR_PROVIDER ?? '').trim().toLowerCase()
  if (raw === 'azure_document_intelligence' || raw === 'azure') return 'azure_document_intelligence'
  if (raw === 'none' || raw === 'off' || raw === 'disabled') return 'none'
  return 'tesseract'
}

/**
 * May workspaces without their own OCR setting use the instance's
 * configuration (DOCUMENT_OCR_PROVIDER and its key)? DOCUMENT_OCR_INSTANCE_DEFAULT
 * = true | false; unset → true when self-hosted, false when
 * DEPLOYMENT_MODE=cloud (the hosted cloud never lends a platform key).
 */
export function instanceOcrDefaultAllowed(): boolean {
  const raw = String(process.env.DOCUMENT_OCR_INSTANCE_DEFAULT ?? '').trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(raw)) return true
  if (['false', '0', 'no', 'off'].includes(raw)) return false
  return String(process.env.DEPLOYMENT_MODE ?? '').trim().toLowerCase() !== 'cloud'
}

export class OcrUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OcrUnavailableError'
  }
}

/** Language list as tesseract codes: "eng+deu" (letters, digits, _ only). */
export function normaliseLanguages(raw: unknown): string {
  const langs = String(raw ?? '').split(/[+,\s]+/).map((l) => l.trim()).filter((l) => /^[a-z]{3}(_[a-z]+)?$/i.test(l))
  return (langs.length ? langs.slice(0, 5) : ['eng']).join('+')
}

/* ── tesseract.js ───────────────────────────────────────────────────── */

async function tesseractProvider(languages: string): Promise<OcrProvider> {
  let mod: typeof import('tesseract.js')
  try {
    mod = await import('tesseract.js')
  } catch {
    const { optionalPackageInstallHint } = await import('@/lib/optional-drivers')
    throw new OcrUnavailableError(`OCR needs the optional package tesseract.js: ${optionalPackageInstallHint('tesseract.js')}`)
  }
  const os = await import('node:os')
  const path = await import('node:path')
  const createWorker = (mod as unknown as { createWorker: typeof import('tesseract.js').createWorker }).createWorker
    ?? (mod as unknown as { default: { createWorker: typeof import('tesseract.js').createWorker } }).default.createWorker
  const langPath = process.env.DOCUMENT_OCR_LANG_PATH?.trim()
  const worker = await createWorker(languages, 1, {
    cachePath: process.env.DOCUMENT_OCR_CACHE_DIR?.trim() || path.join(os.tmpdir(), 'usertasks-ocr'),
    ...(langPath ? { langPath } : {}),
    logger: () => {},
    errorHandler: () => {},
  })
  return {
    id: 'tesseract',
    async recognize(image) {
      const { data } = await worker.recognize(image)
      return { text: data.text ?? '', confidence: typeof data.confidence === 'number' ? Math.round(data.confidence * 10) / 10 : null, provider: 'tesseract' }
    },
    async close() {
      await worker.terminate().catch(() => {})
    },
  }
}

/** Built-in tesseract, started (bounded by DOCUMENT_OCR_TIMEOUT_SECONDS). */
export function openTesseract(languages: string): Promise<OcrProvider> {
  return withTimeout(tesseractProvider(languages), DOCUMENT_LIMITS.ocrTimeoutMs, 'Starting OCR')
}

/* ── Azure AI Document Intelligence (prebuilt-read) ─────────────────── */

export const AZURE_DI_DEFAULT_API_VERSION = '2024-11-30'

export interface AzureOcrSettings {
  endpoint: string
  key: string
  apiVersion?: string | null
}

export interface AzureOcrOptions {
  fetchImpl?: typeof fetch
  /**
   * Egress-guard every request (lib/integrations/http connectorFetch): on for
   * endpoints a workspace typed in, off for the instance's own env endpoint.
   */
  guarded?: boolean
  /** Poll delay (injected in tests). */
  sleep?: (ms: number) => Promise<void>
}

/** API versions before 2023-10-31 serve the model under /formrecognizer. */
export function azureServicePath(apiVersion: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(apiVersion) && apiVersion.slice(0, 10) < '2023-10-31' ? 'formrecognizer' : 'documentintelligence'
}

/** Normalised endpoint (no trailing slash), API version and service path. */
export function azureTarget(settings: Pick<AzureOcrSettings, 'endpoint' | 'apiVersion'>) {
  const endpoint = String(settings.endpoint ?? '').trim().replace(/\/+$/, '')
  const apiVersion = String(settings.apiVersion ?? '').trim() || AZURE_DI_DEFAULT_API_VERSION
  if (!/^[0-9a-z-]{4,40}$/i.test(apiVersion)) throw new OcrUnavailableError('The Azure AI Document Intelligence API version is not valid (for example 2024-11-30)')
  return { endpoint, apiVersion, service: azureServicePath(apiVersion) }
}

/** http://localhost endpoints are accepted only for local mocks (ALLOW_PRIVATE_EGRESS=true). */
export function isLocalMockEndpoint(endpoint: string): boolean {
  return process.env.ALLOW_PRIVATE_EGRESS === 'true' && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(endpoint)
}

async function azureFetch(url: string, init: RequestInit, options: AzureOcrOptions): Promise<Response> {
  if (options.guarded) {
    const { connectorFetch } = await import('@/lib/integrations/http')
    // The analyze POST is never retried (the page would be billed twice).
    return connectorFetch(url, init, { timeoutMs: 30_000, maxAttempts: init.method === 'POST' ? 1 : 2, retry: init.method === 'POST' ? 'never' : 'auto', fetchImpl: options.fetchImpl })
  }
  return (options.fetchImpl ?? fetch)(url, { ...init, signal: AbortSignal.timeout(30_000) })
}

/** Error text from an Azure error body ({ error: { code, message } }); never the key. */
async function azureError(res: Response): Promise<string> {
  let detail = ''
  try {
    const body = await res.json() as { error?: { code?: string; message?: string } }
    detail = [body?.error?.code, body?.error?.message].filter(Boolean).join(': ')
  } catch { /* not JSON */ }
  const hint = res.status === 401 ? ' (check the key)' : res.status === 404 ? ' (check the endpoint and API version)' : ''
  return `Azure AI Document Intelligence: HTTP ${res.status}${hint}${detail ? ` — ${detail.slice(0, 300)}` : ''}`
}

/** prebuilt-read on one image per call (a PDF page rendered to PNG): one billed page each. */
export function azureOcrProvider(settings: AzureOcrSettings, options: AzureOcrOptions = {}): OcrProvider {
  const { endpoint, apiVersion, service } = azureTarget(settings)
  const key = String(settings.key ?? '').trim()
  if (!endpoint || !key) throw new OcrUnavailableError('Azure AI Document Intelligence needs an endpoint and a key')
  if (!/^https:\/\//i.test(endpoint) && !(options.guarded && isLocalMockEndpoint(endpoint))) {
    throw new OcrUnavailableError('The Azure AI Document Intelligence endpoint must be an https:// URL')
  }
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  return {
    id: 'azure_document_intelligence',
    async recognize(image, { languages }) {
      const lang = languages.split('+')[0]
      const locale = lang === 'eng' ? '' : `&locale=${encodeURIComponent(lang.slice(0, 2))}`
      const start = await azureFetch(`${endpoint}/${service}/documentModels/prebuilt-read:analyze?api-version=${encodeURIComponent(apiVersion)}${locale}`, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(image),
      }, options)
      if (start.status !== 202) throw new Error(await azureError(start))
      const op = start.headers.get('operation-location')
      if (!op || !op.startsWith(endpoint)) throw new Error('Azure AI Document Intelligence: no operation location')
      for (let attempt = 0; attempt < 120; attempt++) {
        await sleep(attempt < 5 ? 500 : 1000)
        const res = await azureFetch(op, { method: 'GET', headers: { 'Ocp-Apim-Subscription-Key': key } }, options)
        if (!res.ok) throw new Error(await azureError(res))
        const body = await res.json() as { status?: string; analyzeResult?: { content?: string; pages?: Array<{ words?: Array<{ confidence?: number }> }> } }
        if (body.status === 'succeeded') {
          const words = (body.analyzeResult?.pages ?? []).flatMap((p) => p.words ?? [])
          const confidence = words.length ? Math.round((words.reduce((s, w) => s + (w.confidence ?? 0), 0) / words.length) * 1000) / 10 : null
          return { text: body.analyzeResult?.content ?? '', confidence, provider: 'azure_document_intelligence' }
        }
        if (body.status === 'failed') throw new Error('Azure AI Document Intelligence could not read the page')
      }
      throw new Error('Azure AI Document Intelligence did not finish in time')
    },
  }
}

/**
 * Connection test without a billed page: GET <endpoint>/documentintelligence/info
 * (the resource's model count and limit) with the key.
 */
export async function testAzureOcr(settings: AzureOcrSettings, options: AzureOcrOptions = {}): Promise<{ ok: boolean; message: string; statusCode?: number }> {
  try {
    azureOcrProvider(settings, options) // the same endpoint / key checks as a run
    const { endpoint, apiVersion, service } = azureTarget(settings)
    const res = await azureFetch(`${endpoint}/${service}/info?api-version=${encodeURIComponent(apiVersion)}`, { method: 'GET', headers: { 'Ocp-Apim-Subscription-Key': String(settings.key).trim() } }, options)
    if (!res.ok) return { ok: false, message: await azureError(res), statusCode: res.status }
    await res.body?.cancel().catch(() => {})
    return { ok: true, message: `Connected to Azure AI Document Intelligence (API version ${apiVersion})`, statusCode: res.status }
  } catch (error) {
    return { ok: false, message: (error as Error)?.message || 'Connection failed' }
  }
}

/** The instance's own Azure resource (AZURE_DOCUMENT_INTELLIGENCE_* env). */
export function azureProvider(fetchImpl: typeof fetch = fetch): OcrProvider {
  const endpoint = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT ?? '').trim().replace(/\/+$/, '')
  const key = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY ?? '').trim()
  if (!endpoint || !key) throw new OcrUnavailableError('DOCUMENT_OCR_PROVIDER=azure_document_intelligence needs AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY')
  if (!/^https:\/\//i.test(endpoint)) throw new OcrUnavailableError('AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT must be an https:// URL')
  return azureOcrProvider({ endpoint, key, apiVersion: process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION }, { fetchImpl })
}

/** The instance's configured provider (env), ready to use (close() it when done). */
export async function openOcrProvider(languages: string): Promise<OcrProvider> {
  const id = configuredOcrProvider()
  if (id === 'none') throw new OcrUnavailableError('OCR is turned off on this instance (DOCUMENT_OCR_PROVIDER=none)')
  if (id === 'azure_document_intelligence') return azureProvider()
  return openTesseract(languages)
}

/** True when the default provider can be loaded (for tests and the docs). */
export async function tesseractInstalled(): Promise<boolean> {
  try {
    await import('tesseract.js')
    return true
  } catch {
    return false
  }
}

/**
 * Can this instance run built-in tesseract for a workspace that picks it?
 * Not on Vercel (its worker and language files are not traced into the
 * functions), not when the instance turned OCR off, and only with the
 * optional package installed.
 */
export async function instanceTesseractAvailable(): Promise<boolean> {
  if (process.env.VERCEL) return false
  if (configuredOcrProvider() === 'none') return false
  return tesseractInstalled()
}
