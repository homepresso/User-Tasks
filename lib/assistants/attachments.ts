/**
 * The Agent's attachments, server side: one uploaded file → a model-friendly
 * ChatAttachment (lib/assistants/attachments-core). Nothing is stored — the
 * bytes live only for the request that converts them.
 *
 *  - The type is sniffed from the bytes (lib/documents/detect), never trusted
 *    from the name or the browser's MIME type; anything else is refused with
 *    a per-file error.
 *  - Images (PNG / JPEG / WebP, ≤ 5 MB): a base64 data URL for a vision model;
 *    when the workspace's model can't see, the instance's OCR (when
 *    available) reads the text instead, else the model is told it can't read
 *    images.
 *  - PDF: read with pdf.js (lib/documents/pdf — text per page, which pages
 *    are scans). For a model that reads PDFs (lib/agents/pdf-input: Claude
 *    over the native Messages API, OpenAI vision models) the PDF itself is
 *    kept (≤ ATTACHMENT_LIMITS.maxPdfBytes and the model's page limit) as a
 *    `document`, with its text as the fallback. Otherwise: its text; scanned
 *    pages as page images for a vision model (the first maxPageImages), or
 *    read with the instance's OCR; else a clear "this model can't read
 *    scanned PDFs" error.
 *  - Word / Excel: text extracted (lib/agent-files extractFileText);
 *    CSV / text / Markdown: decoded. Truncated at ATTACHMENT_LIMITS.maxTextChars
 *    with a note.
 *  - InfoPath form templates (.xsn): the importer's analysis report as text;
 *    the file itself rides along (never shown to the model) so the
 *    import_infopath_form tool can import it after the person confirms.
 *  - BPMN 2.0 and draw.io / diagrams.net XML: parsed into a compact outline
 *    (tasks with their lanes, gateways, events and the flows between them,
 *    with labels) the model maps onto workflow nodes.
 */
import { inflateRawSync } from 'node:zlib'
import { detectType } from '@/lib/documents/detect'
import { descendants, parseXml, attr, type XmlElement } from '@/lib/documents/xml'
import { ATTACHMENT_LIMITS, INFOPATH_ATTACHMENT_MAX_BYTES, SCANNED_PDF_UNREADABLE } from './attachments-core'
import { isCab } from '@/lib/infopath/cab'
import { analyzeInfoPath } from '@/lib/infopath/analyze'
import { InfoPathFileError } from '@/lib/infopath/archive'
import { generateForms, reportMarkdown } from '@/lib/infopath/generate'
import type { ChatAttachment } from './types'

export class AttachmentError extends Error {
  constructor(message: string) { super(message); this.name = 'AttachmentError' }
}

const IMAGE_BYTES = 5 * 1024 * 1024

export interface ConvertOptions {
  /** The workspace's model takes images. */
  vision: boolean
  /** OCR for images (and scanned PDF pages) when the model can't see (null: none available). */
  ocr?: ((bytes: Buffer) => Promise<string>) | null
  /** The model reads PDFs itself (lib/agents/pdf-input): PDFs are kept whole for it, up to this many pages. */
  pdf?: { maxPages: number } | null
}

/** Scanned pages read with OCR for one PDF (OCR is slow: the upload has a minute). */
const PDF_OCR_MAX_PAGES = 10
/** Pages whose text is read from a PDF (the text is capped at maxTextChars anyway). */
const PDF_TEXT_MAX_PAGES = 150

function truncate(text: string): { text: string; truncated: boolean } {
  const clean = text.replace(/\u0000/g, '').trim()
  if (clean.length <= ATTACHMENT_LIMITS.maxTextChars) return { text: clean, truncated: false }
  return { text: `${clean.slice(0, ATTACHMENT_LIMITS.maxTextChars)}\n[… truncated]`, truncated: true }
}

/* ── Process diagrams ── */

export interface ProcessOutline {
  source: 'bpmn' | 'drawio'
  name: string | null
  lanes: string[]
  nodes: Array<{ id: string; kind: string; label: string; lane?: string | null }>
  flows: Array<{ from: string; to: string; label?: string | null }>
}

const BPMN_NODE = /^(task|userTask|manualTask|serviceTask|scriptTask|sendTask|receiveTask|businessRuleTask|callActivity|subProcess|startEvent|endEvent|intermediateThrowEvent|intermediateCatchEvent|boundaryEvent|exclusiveGateway|parallelGateway|inclusiveGateway|eventBasedGateway|complexGateway)$/

/** BPMN 2.0 XML → outline (null when it isn't BPMN). */
export function parseBpmn(xml: string): ProcessOutline | null {
  let root: XmlElement
  try { root = parseXml(xml, { maxNodes: 50_000 }) } catch { return null }
  if (root.local !== 'definitions' || !descendants(root, 'process').length) return null
  const laneOf = new Map<string, string>()
  const lanes: string[] = []
  for (const lane of descendants(root, 'lane')) {
    const name = attr(lane, 'name') ?? attr(lane, 'id') ?? 'Lane'
    lanes.push(name)
    for (const ref of descendants(lane, 'flowNodeRef')) {
      const id = ref.children.map((c) => (typeof c === 'string' ? c : '')).join('').trim()
      if (id) laneOf.set(id, name)
    }
  }
  const nodes: ProcessOutline['nodes'] = []
  const flows: ProcessOutline['flows'] = []
  const walk = (el: XmlElement) => {
    for (const c of el.children) {
      if (typeof c === 'string') continue
      if (BPMN_NODE.test(c.local)) {
        const id = attr(c, 'id') ?? `n${nodes.length}`
        nodes.push({ id, kind: c.local, label: (attr(c, 'name') ?? '').trim(), lane: laneOf.get(id) ?? null })
      } else if (c.local === 'sequenceFlow') {
        const from = attr(c, 'sourceRef'); const to = attr(c, 'targetRef')
        if (from && to) flows.push({ from, to, label: attr(c, 'name') ?? null })
      }
      if (c.local === 'process' || c.local === 'subProcess' || c.local === 'laneSet') walk(c)
    }
  }
  for (const p of descendants(root, 'process')) walk(p)
  const process = descendants(root, 'process')[0]
  return { source: 'bpmn', name: attr(process, 'name') ?? null, lanes, nodes, flows }
}

const stripHtml = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()

/** draw.io / diagrams.net XML (plain or compressed) → outline (null when it isn't one). */
export function parseDrawio(xml: string): ProcessOutline | null {
  let root: XmlElement
  try { root = parseXml(xml, { maxNodes: 50_000 }) } catch { return null }
  let model: XmlElement | undefined = root.local === 'mxGraphModel' ? root : descendants(root, 'mxGraphModel')[0]
  if (!model && root.local === 'mxfile') {
    const diagram = descendants(root, 'diagram')[0]
    const packed = diagram?.children.map((c) => (typeof c === 'string' ? c : '')).join('').trim()
    if (packed) {
      try {
        const inflated = decodeURIComponent(inflateRawSync(Buffer.from(packed, 'base64')).toString('utf8'))
        const inner = parseXml(inflated, { maxNodes: 50_000 })
        model = inner.local === 'mxGraphModel' ? inner : descendants(inner, 'mxGraphModel')[0]
      } catch { return null }
    }
  }
  if (!model) return null
  const cells = descendants(model, 'mxCell')
  const label = (c: XmlElement) => stripHtml(attr(c, 'value') ?? '')
  const lanes: string[] = []
  const laneIds = new Map<string, string>()
  for (const c of cells) if (/swimlane/.test(attr(c, 'style') ?? '') && attr(c, 'vertex') === '1') { lanes.push(label(c) || 'Lane'); laneIds.set(attr(c, 'id')!, label(c) || 'Lane') }
  const nodes: ProcessOutline['nodes'] = []
  for (const c of cells) {
    if (attr(c, 'vertex') !== '1' || laneIds.has(attr(c, 'id') ?? '')) continue
    const style = attr(c, 'style') ?? ''
    const text = label(c)
    const kind = /rhombus/.test(style) ? 'gateway' : /ellipse/.test(style) ? 'event' : 'task'
    if (!text && kind === 'task') continue
    nodes.push({ id: attr(c, 'id') ?? `n${nodes.length}`, kind, label: text, lane: laneIds.get(attr(c, 'parent') ?? '') ?? null })
  }
  const flows = cells.filter((c) => attr(c, 'edge') === '1' && attr(c, 'source') && attr(c, 'target'))
    .map((c) => ({ from: attr(c, 'source')!, to: attr(c, 'target')!, label: label(c) || null }))
  return { source: 'drawio', name: null, lanes, nodes, flows }
}

/** The outline as compact text for the model. */
export function outlineText(o: ProcessOutline): string {
  const byId = new Map(o.nodes.map((n) => [n.id, n]))
  const name = (id: string) => { const n = byId.get(id); return n ? `${n.label || n.kind} [${n.id}]` : id }
  return [
    `Process diagram (${o.source === 'bpmn' ? 'BPMN 2.0' : 'draw.io'})${o.name ? `: ${o.name}` : ''}`,
    o.lanes.length ? `Lanes (roles / teams): ${o.lanes.join(', ')}` : '',
    'Steps:',
    ...o.nodes.map((n) => `- [${n.id}] ${n.kind}: ${n.label || '(no label)'}${n.lane ? ` — lane ${n.lane}` : ''}`),
    'Flows:',
    ...o.flows.map((f) => `- ${name(f.from)} → ${name(f.to)}${f.label ? ` (${f.label})` : ''}`),
  ].filter(Boolean).join('\n')
}

/* ── One file ── */

export async function convertAttachment(bytes: Buffer, fileName: string, options: ConvertOptions): Promise<ChatAttachment> {
  const name = String(fileName || 'file').replace(/[\r\n]/g, ' ').slice(0, 200)
  if (!bytes.length) throw new AttachmentError('The file is empty')
  // An InfoPath form template (a CAB archive): its analysis for the model, the file kept for "Import this InfoPath form".
  if (isCab(bytes) || /\.xsn$/i.test(name)) return convertInfoPath(bytes, name)
  const type = detectType(new Uint8Array(bytes), name)
  const limit = type.format === 'pdf' && options.pdf ? ATTACHMENT_LIMITS.maxPdfBytes : ATTACHMENT_LIMITS.maxFileBytes
  if (bytes.length > limit) throw new AttachmentError(`Larger than ${limit / 1024 / 1024} MB${type.format === 'pdf' ? (options.pdf ? ' (the most for a PDF the model reads itself)' : ' (the most for a PDF with this model — models that read PDFs themselves, such as Claude, take up to 20 MB)') : ''}`)
  const base = { name, mime_type: type.mime_type, size: bytes.length }
  const textOf = (text: string, note: string): ChatAttachment => {
    const t = truncate(text)
    if (!t.text) throw new AttachmentError('No readable text in this file')
    return { ...base, kind: 'text', text: t.text, note: t.truncated ? `${note}, truncated at ${ATTACHMENT_LIMITS.maxTextChars.toLocaleString('en-US')} characters` : note }
  }
  switch (type.format) {
    case 'png': case 'jpeg': case 'webp': {
      if (bytes.length > IMAGE_BYTES) throw new AttachmentError('Images can be at most 5 MB')
      if (!options.vision && options.ocr) {
        try {
          const text = (await options.ocr(bytes)).trim()
          if (text) return textOf(text, 'Text read from the image with OCR (the model can\'t see images)')
        } catch { /* fall back to the image (the model is told it can't read it) */ }
      }
      return { ...base, kind: 'image', data_url: `data:${type.mime_type};base64,${bytes.toString('base64')}`, note: options.vision ? 'Image' : 'Image (this model can\'t read images)' }
    }
    case 'pdf':
      return convertPdf(bytes, base, options)
    case 'docx': case 'xlsx': {
      const { extractFileText } = await import('@/lib/agent-files')
      let text: string
      try { text = await extractFileText({ name: `${name.replace(/\.[^.]+$/, '')}.${type.extension}`, mime_type: type.mime_type, bytes: new Uint8Array(bytes) }) } catch { throw new AttachmentError(`Could not read this ${type.label}`) }
      return textOf(text, type.format === 'xlsx' ? 'Excel sheets as CSV' : `Text of a ${type.label}`)
    }
    case 'csv': case 'tsv': case 'markdown': case 'text': case 'xml': case 'json': {
      const text = bytes.toString('utf8')
      if (type.format === 'xml' || /\.(bpmn|drawio)$/i.test(name)) {
        const outline = parseBpmn(text) ?? parseDrawio(text)
        if (outline) {
          if (!outline.nodes.length) throw new AttachmentError('The diagram has no steps')
          return { ...base, mime_type: outline.source === 'bpmn' ? 'application/bpmn+xml' : 'application/vnd.jgraph.mxfile', kind: 'text', text: truncate(outlineText(outline)).text, note: `${outline.source === 'bpmn' ? 'BPMN' : 'draw.io'} process: ${outline.nodes.length} steps, ${outline.flows.length} flows` }
        }
        if (type.format === 'xml') throw new AttachmentError('Only BPMN 2.0 and draw.io XML files are read')
      }
      return textOf(text, type.format === 'csv' || type.format === 'tsv' ? 'CSV' : type.label)
    }
    default:
      throw new AttachmentError(`${type.label === 'Unknown' ? 'This file type' : `A ${type.label}`} can't be attached — use an image (PNG, JPEG, WebP), PDF, Word, Excel, text, Markdown, CSV, BPMN or draw.io file`)
  }
}

/* ── InfoPath ── */

/** An .xsn: the analysis report (Markdown) for the model, and the file itself for the import tool (never shown to the model). */
function convertInfoPath(bytes: Buffer, name: string): ChatAttachment {
  if (bytes.length > INFOPATH_ATTACHMENT_MAX_BYTES) throw new AttachmentError(`InfoPath templates can be at most ${INFOPATH_ATTACHMENT_MAX_BYTES / 1024 / 1024} MB here`)
  let report: ReturnType<typeof generateForms>['report']
  try {
    report = generateForms(analyzeInfoPath(bytes, { fileName: name })).report
  } catch (error) {
    throw new AttachmentError(error instanceof InfoPathFileError ? error.message : 'Could not read this InfoPath form template')
  }
  const s = report.summary
  const text = [
    'InfoPath form template — the importer\'s analysis (what each part becomes in UserTasks). The person can import it with the import_infopath_form tool.',
    '',
    reportMarkdown(report),
  ].join('\n')
  return {
    name, mime_type: 'application/vnd.ms-infopath', size: bytes.length, kind: 'text', text: truncate(text).text,
    note: `InfoPath form: ${s.views} view${s.views === 1 ? '' : 's'}, ${s.fields} fields, ${s.rules.converted} of ${s.rules.total} rules convert`,
    infopath: { file_base64: bytes.toString('base64') },
  }
}

/* ── PDFs ── */

interface PdfPages { count: number | null; pages: Array<{ number: number; text: string; scanned: boolean }> }

/** Text per page and which pages are scans (pdf.js; the simple stream reader when pdf.js can't open it). */
async function readPdfPages(bytes: Buffer): Promise<PdfPages> {
  try {
    const { readPdf } = await import('@/lib/documents/pdf')
    const r = await readPdf(new Uint8Array(bytes), { tables: false, to: PDF_TEXT_MAX_PAGES })
    return { count: r.page_count, pages: r.pages.map((p) => ({ number: p.number, text: p.has_text_layer ? p.text.trim() : '', scanned: !p.has_text_layer && p.image_count > 0 })) }
  } catch (error) {
    if (/password/i.test(String((error as Error)?.message))) throw new AttachmentError('The PDF is password-protected — remove the password and attach it again')
    const { extractFileText } = await import('@/lib/agent-files')
    const text = await extractFileText({ name: 'file.pdf', mime_type: 'application/pdf', bytes: new Uint8Array(bytes) }).catch(() => '')
    return { count: null, pages: text.trim() ? [{ number: 1, text: text.trim(), scanned: false }] : [] }
  }
}

const joinPages = (pages: Array<{ number: number; text: string }>, many: boolean) => pages.filter((p) => p.text).map((p) => (many ? `[Page ${p.number}]\n${p.text}` : p.text)).join('\n\n')
const pageList = (n: number[]) => (n.length > 6 ? `${n.slice(0, 6).join(', ')}…` : n.join(', '))

async function convertPdf(bytes: Buffer, base: { name: string; mime_type: string; size: number }, options: ConvertOptions): Promise<ChatAttachment> {
  const read = await readPdfPages(bytes)
  const many = (read.count ?? read.pages.length) > 1
  const scanned = read.pages.filter((p) => p.scanned).map((p) => p.number)
  const t = truncate(joinPages(read.pages, many))
  const pagesNote = read.count ? `, ${read.count} page${read.count === 1 ? '' : 's'}` : ''
  const cut = t.truncated ? `, text truncated at ${ATTACHMENT_LIMITS.maxTextChars.toLocaleString('en-US')} characters` : ''

  // A model that reads PDFs: the PDF itself (its text is the fallback if the provider refuses it).
  let tooBig = ''
  if (options.pdf) {
    if (read.count !== null && read.count > options.pdf.maxPages) tooBig = `${read.count} pages — more than the ${options.pdf.maxPages} this model reads at once`
    else {
      return {
        ...base, kind: 'document', data_url: `data:application/pdf;base64,${bytes.toString('base64')}`,
        ...(t.text ? { text: t.text } : {}), ...(read.count ? { pages: read.count } : {}),
        note: `PDF${pagesNote} — the model reads it directly${scanned.length ? ' (including scanned pages)' : ''}`,
      }
    }
  }

  // Scanned pages, for a model that can't read PDFs: page images (vision), else OCR.
  let text = t.text
  const ocrPages: number[] = []
  const pageImages: Array<{ page: number; data_url: string }> = []
  if (scanned.length && (options.vision || options.ocr)) {
    const { openPdf, pageImageForModel, pageImagePng } = await import('@/lib/documents/pdf')
    const pdf = await openPdf(new Uint8Array(bytes)).catch(() => null)
    if (pdf) {
      try {
        if (options.vision) {
          let chars = 0
          for (const n of scanned.slice(0, ATTACHMENT_LIMITS.maxPageImages)) {
            const png = await pageImageForModel(pdf, n).catch(() => null)
            if (!png) continue
            const url = `data:image/png;base64,${png.toString('base64')}`
            if (url.length > ATTACHMENT_LIMITS.maxImageDataUrlChars || chars + url.length > ATTACHMENT_LIMITS.maxPageImageChars) break
            chars += url.length
            pageImages.push({ page: n, data_url: url })
          }
        } else if (options.ocr) {
          const ocrText = new Map<number, string>()
          for (const n of scanned.slice(0, PDF_OCR_MAX_PAGES)) {
            const png = await pageImagePng(pdf, n).catch(() => null)
            if (!png) continue
            const got = (await options.ocr(png).catch(() => '')).trim()
            if (got) { ocrText.set(n, got); ocrPages.push(n) }
          }
          if (ocrText.size) text = truncate(joinPages(read.pages.map((p) => ({ number: p.number, text: p.text || ocrText.get(p.number) || '' })), many)).text
        }
      } finally {
        await pdf.destroy?.().catch?.(() => {})
      }
    }
  }
  const unread = scanned.filter((n) => !ocrPages.includes(n) && !pageImages.some((p) => p.page === n))
  const why = tooBig ? ` — ${tooBig}, so its text is sent instead` : ''
  if (pageImages.length) {
    return {
      ...base, kind: 'document', ...(text ? { text } : {}), ...(read.count ? { pages: read.count } : {}), page_images: pageImages,
      note: `PDF${pagesNote}${why} — scanned page${pageImages.length === 1 ? '' : 's'} ${pageList(pageImages.map((p) => p.page))} sent as images${unread.length ? ` (page${unread.length === 1 ? '' : 's'} ${pageList(unread)} not included)` : ''}${cut}`,
    }
  }
  if (!text) {
    if (scanned.length) throw new AttachmentError(tooBig ? `This PDF is a scan with ${tooBig} — attach fewer pages` : SCANNED_PDF_UNREADABLE)
    throw new AttachmentError('No readable text in this PDF (its pages may be drawn as shapes) — attach page images (PNG / JPEG) instead')
  }
  const parts = [
    `Text of a PDF${pagesNote}${why}`,
    ocrPages.length ? `scanned page${ocrPages.length === 1 ? '' : 's'} ${pageList(ocrPages)} read with OCR` : '',
    unread.length ? `page${unread.length === 1 ? '' : 's'} ${pageList(unread)} ${unread.length === 1 ? 'is a scan' : 'are scans'} this model can't read` : '',
  ].filter(Boolean)
  return { ...base, kind: 'text', text, note: `${parts.join('; ')}${cut}` }
}
