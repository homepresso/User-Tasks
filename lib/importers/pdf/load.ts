/**
 * Opening a PDF for the form importer (server-only: pdf.js via unpdf).
 *
 * Embedded JavaScript is NEVER run: pdf.js is opened with eval, scripting
 * and XFA rendering off; scripts are only read as text and pattern-matched
 * (js-actions.ts, xfa.ts). Bounded by PDF_IMPORT_LIMITS (size, pages, time).
 */

import { DOCUMENT_LIMITS, DocumentLimitError } from '@/lib/documents/limits'

const MB = 1024 * 1024

export const PDF_IMPORT_LIMITS = {
  /** Largest PDF (the document actions' cap, at most 25 MB here). */
  get maxInputBytes() { return Math.min(DOCUMENT_LIMITS.maxInputBytes, 25 * MB) },
  /** Pages read at most. */
  get maxPages() { return Math.min(DOCUMENT_LIMITS.maxPdfPages, 60) },
  /** Widgets (fields) read at most. */
  maxWidgets: 3000,
  /** The whole analysis (parsing + XFA + routing). */
  get timeoutMs() { return Math.min(DOCUMENT_LIMITS.timeoutMs, 45_000) },
  /** XFA template packet (characters). */
  maxXfaChars: 8_000_000,
}

/** Lower limits for the anonymous public preview. */
export const PUBLIC_PDF_LIMITS = { maxInputBytes: 4 * MB, maxPages: 20, timeoutMs: 12_000 }

export class PdfImportError extends Error {
  constructor(message: string, readonly code: 'not_pdf' | 'encrypted' | 'limit' | 'unreadable' = 'unreadable') {
    super(message)
    this.name = 'PdfImportError'
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- pdf.js proxy types come from the bundled build */
export type PdfDoc = any

const OPEN_OPTIONS = {
  isEvalSupported: false,
  enableScripting: false,
  enableXfa: false,
  useSystemFonts: false,
  disableFontFace: true,
  stopAtErrors: false,
  verbosity: 0,
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1')
  return head.includes('%PDF-')
}

export async function openPdfForImport(bytes: Uint8Array, limits: { maxInputBytes: number; maxPages: number } = PDF_IMPORT_LIMITS): Promise<PdfDoc> {
  if (!bytes?.length) throw new PdfImportError('The file is empty', 'not_pdf')
  if (bytes.length > limits.maxInputBytes) throw new PdfImportError(`The PDF is larger than ${Math.round(limits.maxInputBytes / MB)} MB`, 'limit')
  if (!looksLikePdf(bytes)) throw new PdfImportError('This file is not a PDF', 'not_pdf')
  ;(await import('@/lib/documents/pdf')).polyfillArrayBuffer()
  const { getDocumentProxy } = await import('unpdf')
  let doc: PdfDoc
  try {
    doc = await getDocumentProxy(new Uint8Array(bytes), OPEN_OPTIONS as never)
  } catch (e) {
    const name = (e as { name?: string }).name ?? ''
    if (name === 'PasswordException' || /password/i.test(String((e as Error).message))) throw new PdfImportError('The PDF is password-protected: remove the password and try again', 'encrypted')
    throw new PdfImportError('The PDF could not be read (it may be damaged)', 'unreadable')
  }
  if (doc.numPages > limits.maxPages) {
    await doc.destroy?.().catch?.(() => {})
    throw new PdfImportError(`The PDF has ${doc.numPages} pages; the importer reads forms of up to ${limits.maxPages} pages`, 'limit')
  }
  return doc
}

export interface TextItem { str: string; x: number; y: number; w: number; h: number; /** pdf.js font id (styling: font name, bold, colour). */ font?: string }
export interface TextLine { y: number; x0: number; x1: number; h: number; str: string; items: TextItem[] }

/** A page's text as lines (PDF user space, y up), merged by baseline and proximity. */
export async function pageTextLines(page: PdfDoc): Promise<TextLine[]> {
  const tc = await page.getTextContent({ includeMarkedContent: false })
  const items: TextItem[] = []
  for (const i of tc.items as any[]) {
    if (typeof i?.str !== 'string' || !i.str.trim() || !Array.isArray(i.transform)) continue
    items.push({ str: i.str, x: i.transform[4], y: i.transform[5], w: Number(i.width) || 0, h: Math.abs(i.transform[3]) || Number(i.height) || 8, ...(typeof i.fontName === 'string' ? { font: i.fontName } : {}) })
  }
  return linesFromItems(items)
}

/** Text items → lines (pure; exported for tests). */
export function linesFromItems(input: TextItem[]): TextLine[] {
  const items = [...input].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: Array<TextLine & { lastX: number }> = []
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, it.h * 0.35) && it.x >= l.x1 - 1 && it.x - l.x1 < Math.max(12, it.h * 1.6))
    if (line) {
      line.items.push(it)
      line.str += (it.x - line.lastX > it.h * 0.15 ? ' ' : '') + it.str
      line.x1 = Math.max(line.x1, it.x + it.w)
      line.lastX = it.x + it.w
    } else {
      lines.push({ y: it.y, x0: it.x, x1: it.x + it.w, lastX: it.x + it.w, h: it.h, str: it.str, items: [it] })
    }
  }
  return lines.map((l) => ({ y: l.y, x0: l.x0, x1: l.x1, h: l.h, items: l.items, str: l.str.replace(/\s+/g, ' ').trim() })).filter((l) => l.str)
}

export async function closePdf(doc: PdfDoc): Promise<void> {
  try { await doc?.destroy?.() } catch { /* already closed */ }
}

export function limitError(message: string): DocumentLimitError {
  return new DocumentLimitError(message)
}
