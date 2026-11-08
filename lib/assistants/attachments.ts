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
 *  - PDF / Word / Excel: text extracted (lib/agent-files extractFileText);
 *    CSV / text / Markdown: decoded. Truncated at ATTACHMENT_LIMITS.maxTextChars
 *    with a note.
 *  - BPMN 2.0 and draw.io / diagrams.net XML: parsed into a compact outline
 *    (tasks with their lanes, gateways, events and the flows between them,
 *    with labels) the model maps onto workflow nodes.
 */
import { inflateRawSync } from 'node:zlib'
import { detectType } from '@/lib/documents/detect'
import { descendants, parseXml, attr, type XmlElement } from '@/lib/documents/xml'
import { ATTACHMENT_LIMITS } from './attachments-core'
import type { ChatAttachment } from './types'

export class AttachmentError extends Error {
  constructor(message: string) { super(message); this.name = 'AttachmentError' }
}

const IMAGE_BYTES = 5 * 1024 * 1024

export interface ConvertOptions {
  /** The workspace's model takes images. */
  vision: boolean
  /** OCR for images when the model can't see (null: none available). */
  ocr?: ((bytes: Buffer) => Promise<string>) | null
}

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
  if (bytes.length > ATTACHMENT_LIMITS.maxFileBytes) throw new AttachmentError(`Larger than ${ATTACHMENT_LIMITS.maxFileBytes / 1024 / 1024} MB`)
  const type = detectType(new Uint8Array(bytes), name)
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
    case 'pdf': case 'docx': case 'xlsx': {
      const { extractFileText } = await import('@/lib/agent-files')
      let text: string
      try { text = await extractFileText({ name: `${name.replace(/\.[^.]+$/, '')}.${type.extension}`, mime_type: type.mime_type, bytes: new Uint8Array(bytes) }) } catch { throw new AttachmentError(`Could not read this ${type.label}`) }
      if (!text.trim() && type.format === 'pdf') throw new AttachmentError('This PDF has no text layer (a scan?) — attach it as an image (PNG / JPEG) instead')
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
