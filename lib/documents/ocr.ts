/**
 * OCR providers for scanned PDF pages (and images).
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

/* ── Azure AI Document Intelligence (prebuilt-read) ─────────────────── */

export function azureProvider(fetchImpl: typeof fetch = fetch): OcrProvider {
  const endpoint = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT ?? '').trim().replace(/\/+$/, '')
  const key = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY ?? '').trim()
  if (!endpoint || !key) throw new OcrUnavailableError('DOCUMENT_OCR_PROVIDER=azure_document_intelligence needs AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY')
  if (!/^https:\/\//i.test(endpoint)) throw new OcrUnavailableError('AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT must be an https:// URL')
  const apiVersion = process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION?.trim() || '2024-11-30'
  return {
    id: 'azure_document_intelligence',
    async recognize(image, { languages }) {
      const locale = languages.split('+')[0] === 'eng' ? '' : `&locale=${encodeURIComponent(languages.split('+')[0].slice(0, 2))}`
      const start = await fetchImpl(`${endpoint}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=${apiVersion}${locale}`, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(image),
        signal: AbortSignal.timeout(30_000),
      })
      if (start.status !== 202) throw new Error(`Azure Document Intelligence: HTTP ${start.status}`)
      const op = start.headers.get('operation-location')
      if (!op || !op.startsWith(endpoint)) throw new Error('Azure Document Intelligence: no operation location')
      for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise((r) => setTimeout(r, attempt < 5 ? 500 : 1000))
        const res = await fetchImpl(op, { headers: { 'Ocp-Apim-Subscription-Key': key }, signal: AbortSignal.timeout(30_000) })
        if (!res.ok) throw new Error(`Azure Document Intelligence: HTTP ${res.status}`)
        const body = await res.json() as { status?: string; analyzeResult?: { content?: string; pages?: Array<{ words?: Array<{ confidence?: number }> }> } }
        if (body.status === 'succeeded') {
          const words = (body.analyzeResult?.pages ?? []).flatMap((p) => p.words ?? [])
          const confidence = words.length ? Math.round((words.reduce((s, w) => s + (w.confidence ?? 0), 0) / words.length) * 1000) / 10 : null
          return { text: body.analyzeResult?.content ?? '', confidence, provider: 'azure_document_intelligence' }
        }
        if (body.status === 'failed') throw new Error('Azure Document Intelligence could not read the page')
      }
      throw new Error('Azure Document Intelligence did not finish in time')
    },
  }
}

/** The configured provider, ready to use (close() it when done). */
export async function openOcrProvider(languages: string): Promise<OcrProvider> {
  const id = configuredOcrProvider()
  if (id === 'none') throw new OcrUnavailableError('OCR is turned off on this instance (DOCUMENT_OCR_PROVIDER=none)')
  if (id === 'azure_document_intelligence') return azureProvider()
  return withTimeout(tesseractProvider(languages), DOCUMENT_LIMITS.ocrTimeoutMs, 'Starting OCR')
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
