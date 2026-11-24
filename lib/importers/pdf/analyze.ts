/**
 * Read a PDF form into the intermediate model (server-only).
 *
 *   fillable AcroForm         widgets → items (infer.ts), hybrid XFA captions /
 *                             groups / required when the PDF carries a template
 *   dynamic XFA               the template alone (xfa-model.ts)
 *   flat / scanned            detected and said so: no items (the AI assist, when
 *                             the person turns it on, reads these — ai.ts)
 *
 * Printed routing text is linked to the questions afterwards (routing.ts).
 * Bounded: size, pages, widgets, one overall time budget (withTimeout).
 * Nothing in the PDF is executed.
 */

import { createHash } from 'node:crypto'
import { withTimeout, DocumentLimitError } from '@/lib/documents/limits'
import { readAcroForm, type PageText } from './acroform'
import { inferFromAcroForm } from './infer'
import { closePdf, openPdfForImport, PDF_IMPORT_LIMITS, PdfImportError, type PdfDoc } from './load'
import { cleanLabel, type PdfFormModel } from './model'
import { linkRouting } from './routing'
import { parseXfaTemplate, readWithPdfLib, templateXml, type XfaTemplate } from './xfa'
import { modelFromXfa } from './xfa-model'
import { readGraphics } from './graphics'
import { analyzeStyling, STYLING_LIMITS, type PdfStyling, type StyleGraphicsInput } from './styling'

export interface PdfAnalysis {
  model: PdfFormModel
  fileName: string
  hash: string
  /** The page text with positions (the AI assist's input). */
  pages: PageText[]
  stats: { pages: number; widgets: number; xfaFields: number; textChars: number; ms: number }
  warnings: string[]
  /** "Bring in styling and images" (only when asked for): the PDF's look, images carried as data URLs within the mode's caps. */
  styling?: PdfStyling
}

/**
 * How images are carried: `full` for an import (stored as form images
 * afterwards), `preview` for the signed-in dry run (smaller, only shown),
 * `public` for the anonymous preview (smallest; never stored).
 */
export type StylingImageMode = 'full' | 'preview' | 'public'
export interface AnalyzeOptions { styling?: { images: StylingImageMode } | false }

const MB = 1024 * 1024
/** Per mode: longest side, largest PNG, all images together. A form image is at most 2 MB, a header image 1 MB. */
export const STYLING_IMAGE_CAPS: Record<StylingImageMode, { maxSide: number; maxBytes: number; totalBytes: number }> = {
  full: { maxSide: 1600, maxBytes: 1 * MB, totalBytes: 8 * MB },
  preview: { maxSide: 640, maxBytes: 200 * 1024, totalBytes: 1.5 * MB },
  public: { maxSide: 480, maxBytes: 120 * 1024, totalBytes: 600 * 1024 },
}

export interface AnalyzeLimits { maxInputBytes: number; maxPages: number; timeoutMs: number; maxWidgets?: number }

function titleFrom(fileName: string, info: Record<string, unknown> | null, pages: PageText[]): string {
  const meta = typeof info?.Title === 'string' ? cleanLabel(info.Title) : ''
  if (meta && meta.length >= 3 && !/^(untitled|microsoft word|document\d*)/i.test(meta) && !/\.(docx?|pdf)$/i.test(meta)) return meta.slice(0, 100)
  // The tallest text near the top of page 1.
  const first = pages[0]
  if (first) {
    const top = first.lines.filter((l) => l.y > first.height * 0.6 && l.str.length >= 4 && l.str.length <= 90 && /[A-Za-z]{3}/.test(l.str))
    const big = top.sort((a, b) => b.h - a.h || b.y - a.y)[0]
    if (big && big.h >= 11) return cleanLabel(big.str).slice(0, 100)
  }
  return fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 100) || 'Imported PDF form'
}

async function readAll(doc: PdfDoc, bytes: Uint8Array, fileName: string, limits: AnalyzeLimits, started: number, options: AnalyzeOptions = {}): Promise<PdfAnalysis> {
  const warnings: string[] = []
  const deadline = started + limits.timeoutMs - 500
  const acro = await readAcroForm(doc, { maxWidgets: limits.maxWidgets ?? PDF_IMPORT_LIMITS.maxWidgets, deadline })
  if (acro.truncated) warnings.push(`The PDF is large: only the first ${acro.pages.length} page(s) / ${Math.min(acro.widgetCount, limits.maxWidgets ?? PDF_IMPORT_LIMITS.maxWidgets)} fields were read.`)
  let info: Record<string, unknown> | null = null
  try { info = ((await doc.getMetadata())?.info ?? null) as Record<string, unknown> | null } catch { info = null }
  const title = titleFrom(fileName, info, acro.pages)
  // XFA (hybrid and dynamic forms): the packets are read with pdf-lib.
  let xfa: XfaTemplate | null = null
  if (Date.now() < deadline - 2000) {
    try {
      const lib = await readWithPdfLib(bytes)
      for (const f of acro.fields) if (!f.tooltip.trim() && lib.tooltips.get(f.name)) f.tooltip = lib.tooltips.get(f.name)!
      const xml = templateXml(lib.packets)
      if (xml && xml.length <= PDF_IMPORT_LIMITS.maxXfaChars) xfa = parseXfaTemplate(xml)
      else if (xml) warnings.push('The PDF\'s XFA template is too large to read: its captions were not used.')
    } catch {
      warnings.push('The PDF\'s XFA template could not be read: its captions were not used.')
    }
  }
  const textChars = acro.pages.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.str.length, 0), 0)
  let model: PdfFormModel
  // A dynamic XFA form may still carry a few AcroForm widgets (a signature): its template is the form then.
  const xfaValueFields = xfa?.fields.filter((f) => f.type).length ?? 0
  const dynamicXfa = xfaValueFields > 0 && acro.fields.length * 3 < xfaValueFields
  if (acro.fields.length && !dynamicXfa) {
    const { model: m, routingTexts } = inferFromAcroForm({ title, fields: acro.fields, pages: acro.pages, xfa })
    let n = m.rules.length
    linkRouting({ model: m, texts: routingTexts, nextId: () => `rule_${++n}` })
    model = m
  } else if (xfa && xfaValueFields > 0) {
    model = modelFromXfa(xfa, title)
    model.notes.unshift('A dynamic XFA form (Adobe LiveCycle / AEM Designer): built from its template.')
  } else {
    const scanned = textChars < 40 * Math.max(1, acro.pages.length)
    model = {
      title, kind: scanned ? 'scanned' : 'flat', pages: acro.pages.length || doc.numPages, sections: [], items: [], rules: [],
      notes: [scanned
        ? 'This PDF has no fillable fields and almost no text: it looks scanned. Turn on "Use AI for the hard parts" to read it, or build the form by hand.'
        : 'This PDF has no fillable fields (a flat, print-only form). Turn on "Use AI for the hard parts" to read its questions, or build the form by hand.'],
    }
  }
  // Styling and images: the page graphics in what time is left (the fields come first).
  let styling: PdfStyling | undefined
  if (options.styling && model.kind !== 'xfa' && model.kind !== 'scanned') {
    if (Date.now() < deadline - 1500) {
      try {
        styling = await readStyling(doc, model, acro, options.styling.images, deadline - 800)
      } catch {
        warnings.push('The PDF\'s styling and images could not be read: the form is imported without them.')
      }
    } else warnings.push('The PDF took too long to read to also bring in its styling and images.')
  } else if (options.styling && model.kind === 'xfa') {
    warnings.push('Styling and images are not read from dynamic XFA forms (their look is built at run time): the workspace theme is used.')
  }
  return { model, fileName, hash: createHash('sha256').update(bytes).digest('hex'), pages: acro.pages, stats: { pages: acro.pages.length, widgets: acro.widgetCount, xfaFields: xfa?.fields.length ?? 0, textChars, ms: Date.now() - started }, warnings, ...(styling ? { styling } : {}) }
}

async function readStyling(doc: PdfDoc, model: PdfFormModel, acro: { fields: Array<{ widgets: Array<{ page: number; rect: [number, number, number, number] }> }>; pages: PageText[] }, mode: StylingImageMode, deadline: number): Promise<PdfStyling> {
  const caps = STYLING_IMAGE_CAPS[mode]
  const raw = await readGraphics(doc, { pages: acro.pages.length, deadline, maxImages: STYLING_LIMITS.images + 6, maxSide: caps.maxSide, maxBytes: caps.maxBytes })
  // Images become data URLs (each re-encoded PNG once per hash) until the mode's total is used up.
  const urls = new Map<string, string | null>()
  let total = 0
  const graphics: StyleGraphicsInput[] = raw.map((g) => ({
    page: g.page, width: g.width, height: g.height, skippedImages: g.skippedImages, fills: g.fills, strokes: g.strokes, runs: g.runs, fonts: g.fonts,
    images: g.images.map((img) => {
      if (!urls.has(img.hash)) {
        const fits = img.png && total + img.png.length <= caps.totalBytes
        if (fits) total += img.png!.length
        urls.set(img.hash, fits ? `data:image/png;base64,${img.png!.toString('base64')}` : null)
      }
      return { page: img.page, rect: img.rect, width: img.width, height: img.height, hash: img.hash, src: urls.get(img.hash) ?? null, bytes: img.png?.length ?? 0, luminance: img.luminance, contrast: img.contrast, ...(img.brand ? { brand: img.brand } : {}) }
    }),
  }))
  const widgets = acro.fields.flatMap((f) => f.widgets.map((w) => ({ page: w.page, rect: w.rect })))
  return analyzeStyling({ model, pages: acro.pages, graphics, widgets })
}

/** Analyse a PDF (bounded by `limits`; nothing is stored, nothing is run). */
export async function analyzePdf(bytes: Uint8Array, fileName: string, limits: AnalyzeLimits = PDF_IMPORT_LIMITS, options: AnalyzeOptions = {}): Promise<PdfAnalysis> {
  const started = Date.now()
  const doc = await withTimeout(openPdfForImport(bytes, limits), limits.timeoutMs, 'Opening the PDF')
  try {
    return await withTimeout(readAll(doc, bytes, fileName, limits, started, options), limits.timeoutMs, 'Reading the PDF form')
  } catch (error) {
    if (error instanceof DocumentLimitError) throw new PdfImportError(`${error.message}: the PDF is too complex to import here`, 'limit')
    throw error
  } finally {
    await closePdf(doc)
  }
}
