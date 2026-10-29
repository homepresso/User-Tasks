import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readDocument } from '@/lib/documents/read'
import { azureProvider, configuredOcrProvider, normaliseLanguages, openOcrProvider, tesseractInstalled, type OcrProvider } from '@/lib/documents/ocr'
import { invoicePdf, scannedPdf } from './helpers/document-fixtures'

/**
 * OCR for scanned PDFs: pages without a text layer are detected; with OCR on
 * only those pages are recognised (per-page confidence). The tesseract test
 * runs where tesseract.js and its English data can be loaded (the data is
 * downloaded once and cached; offline runs skip it). The Azure provider is
 * tested against a stubbed service.
 */

const fakeProvider = (text: string): OcrProvider & { calls: number } => {
  const p = { id: 'fake', calls: 0, async recognize() { p.calls++; return { text, confidence: 91.5, provider: 'fake' } } }
  return p
}

describe('scanned pages', () => {
  it('a page without a text layer is flagged, with a warning, when OCR is off', async () => {
    const r = await readDocument(await scannedPdf(), 'scan.pdf', null)
    const pages = r.structure.pages as Array<{ has_text_layer: boolean; image_count: number }>
    expect(pages[0]).toMatchObject({ has_text_layer: false, image_count: 1 })
    expect(r.warnings.join(' ')).toMatch(/no text layer.*turn on OCR/)
  })

  it('auto OCR recognises only the pages without text (PNG of the page image handed to the provider)', async () => {
    const provider = fakeProvider('HELLO 42')
    const seen: Buffer[] = []
    const scan = await scannedPdf()
    const r = await readDocument(scan, 'scan.pdf', null, { ocr: 'auto', openOcr: async () => ({ ...provider, recognize: async (png: Buffer) => { seen.push(png); return provider.recognize(png, { languages: 'eng' }) } }) })
    expect(r.text).toBe('HELLO 42')
    expect((r.structure.pages as Array<{ ocr: unknown }>)[0].ocr).toEqual({ provider: 'fake', confidence: 91.5, characters: 7 })
    expect(seen[0].subarray(1, 4).toString()).toBe('PNG')
    const textPdf = await readDocument(await invoicePdf(), 'inv.pdf', null, { ocr: 'auto', openOcr: async () => provider })
    expect(provider.calls).toBe(1) // the text PDF needed no OCR
    expect(textPdf.text).toContain('Invoice INV-2026-0042')
  })

  it('page limit for OCR', async () => {
    const provider = fakeProvider('x')
    const { PDFDocument } = await import('@cantoo/pdf-lib')
    const one = await PDFDocument.load(await scannedPdf())
    const doc = await PDFDocument.create()
    for (let k = 0; k < 3; k++) for (const p of await doc.copyPages(one, [0])) doc.addPage(p)
    const r = await readDocument(await doc.save(), 'scan3.pdf', null, { ocr: 'auto', ocrMaxPages: 2, openOcr: async () => provider })
    expect(provider.calls).toBe(2)
    expect(r.warnings.join(' ')).toMatch(/OCR stopped after 2 pages/)
  })
})

describe('providers', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('configuration', () => {
    expect(configuredOcrProvider()).toBe('tesseract')
    vi.stubEnv('DOCUMENT_OCR_PROVIDER', 'azure_document_intelligence')
    expect(configuredOcrProvider()).toBe('azure_document_intelligence')
    vi.stubEnv('DOCUMENT_OCR_PROVIDER', 'none')
    return expect(openOcrProvider('eng')).rejects.toThrow(/turned off/)
  })

  it('language lists are sanitised', () => {
    expect(normaliseLanguages('eng+deu')).toBe('eng+deu')
    expect(normaliseLanguages('../../etc/passwd')).toBe('eng')
    expect(normaliseLanguages('')).toBe('eng')
  })

  it('Azure Document Intelligence: analyze, poll, text and mean word confidence', async () => {
    vi.stubEnv('AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT', 'https://ut-test.cognitiveservices.azure.com/')
    vi.stubEnv('AZURE_DOCUMENT_INTELLIGENCE_KEY', 'test-key-not-real')
    const calls: string[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (init?.method === 'POST') return new Response(null, { status: 202, headers: { 'operation-location': 'https://ut-test.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-read/analyzeResults/1' } })
      return Response.json({ status: 'succeeded', analyzeResult: { content: 'HELLO 42', pages: [{ words: [{ confidence: 0.9 }, { confidence: 0.8 }] }] } })
    })
    const r = await azureProvider(fetchImpl as never).recognize(Buffer.from('png'), { languages: 'eng' })
    expect(r).toEqual({ text: 'HELLO 42', confidence: 85, provider: 'azure_document_intelligence' })
    expect(calls[0]).toMatch(/^POST https:\/\/ut-test\.cognitiveservices\.azure\.com\/documentintelligence\/documentModels\/prebuilt-read:analyze\?api-version=/)
  })

  it('Azure: missing configuration is a clear error', () => {
    expect(() => azureProvider()).toThrow(/AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT/)
  })
})

describe('tesseract.js (optional package)', () => {
  let provider: OcrProvider | null = null
  let reason = ''
  beforeAll(async () => {
    if (!(await tesseractInstalled())) { reason = 'tesseract.js is not installed'; return }
    try {
      provider = await openOcrProvider('eng')
    } catch (e) {
      reason = `tesseract could not start (offline?): ${(e as Error).message}`
    }
  }, 120_000)

  it('reads the text of an image-only PDF page with a confidence', async (ctx) => {
    if (!provider) { console.warn(`skipped: ${reason}`); ctx.skip(); return }
    try {
      const r = await readDocument(await scannedPdf('HELLO 42'), 'scan.pdf', null, { ocr: 'auto', openOcr: async () => provider! })
      expect(r.text.replace(/\s+/g, ' ').trim()).toMatch(/HELLO\s*42/)
      const page = (r.structure.pages as Array<{ ocr: { confidence: number } }>)[0]
      expect(page.ocr.confidence).toBeGreaterThan(50)
    } finally {
      await provider.close?.()
    }
  }, 120_000)
})
