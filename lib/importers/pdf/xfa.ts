/**
 * XFA in a PDF (server-only for readXfaTemplate; parseXfaTemplate is pure).
 *
 * Hybrid PDFs (e.g. IRS forms) carry a static XFA template beside their
 * AcroForm: its captions, tooltips, exclusive groups and required flags are
 * better than what the AcroForm alone says. Dynamic XFA forms (no AcroForm
 * widgets: LiveCycle / AEM forms) are built from the template alone —
 * fields, captions, subforms as sections, required, presence and simple
 * presence scripts.
 *
 * The packets are read with @cantoo/pdf-lib (MIT); the template is parsed
 * with the safe XML reader (lib/documents/xml: no DOCTYPE / entities —
 * a DOCTYPE and processing instructions are stripped first, nothing is
 * resolved). Scripts are text: matched, never run.
 */

import { attr, child, childrenByLocal, elements, parseXml, textOf, type XmlElement } from '@/lib/documents/xml'
import type { PdfItemType, PdfOption } from './model'

export interface XfaField {
  /** SOM name with indices, as AcroForm fields are named ("form1[0].Page1[0].f1_01[0]"). */
  som: string
  name: string
  kind: 'field' | 'exclGroup'
  /** null: not a value (button, barcode, image). */
  type: PdfItemType | null
  ui: string
  caption: string
  tooltip: string
  /** Text drawn in the same subform before the field (the printed question). */
  context: string
  required: boolean
  hidden: boolean
  readOnly: boolean
  maxChars?: number
  picture?: string
  options: PdfOption[]
  /** checkButton: its "on" value (items[0]). */
  onValue?: string
  /** The section (subform) it sits in, by som. */
  section?: string
  /** exclGroup members (their names and on values). */
  members?: Array<{ name: string; caption: string; onValue: string }>
}

export interface XfaSection { som: string; title: string; hidden: boolean; repeats: boolean; depth: number; /** occur max (-1: unlimited) when it repeats. */ max?: number }

export interface XfaScript {
  /** The field / exclGroup / member / subform the script is on (som). */
  owner: string
  /** exclGroup member name when the owner is a radio option. */
  member?: string
  activity: string
  body: string
}

export interface XfaTemplate {
  fields: XfaField[]
  sections: XfaSection[]
  scripts: XfaScript[]
  /** Top-level subforms that look like pages (dynamic forms). */
  pageCount: number
}

const ws = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Plain text of a caption / toolTip / draw (rich exData text included, attributes ignored). */
function textBelow(el: XmlElement | undefined): string {
  return el ? ws(textOf(el)) : ''
}

function captionOf(node: XmlElement): string {
  const caption = child(node, 'caption')
  if (!caption) return ''
  return textBelow(child(caption, 'value') ?? caption)
}

function uiOf(node: XmlElement): { ui: string; el: XmlElement | undefined } {
  const ui = child(node, 'ui')
  const el = ui ? elements(ui).find((e) => e.local !== 'picture' && e.local !== 'extras') : undefined
  return { ui: el?.local ?? 'textEdit', el }
}

function itemValues(list: XmlElement | undefined): string[] {
  if (!list) return []
  return elements(list).map((e) => ws(textOf(e)))
}

function typeOf(ui: string, uiEl: XmlElement | undefined, picture: string): PdfItemType | null {
  switch (ui) {
    case 'textEdit': return attr(uiEl, 'multiLine') === '1' ? 'textarea' : 'text'
    case 'passwordEdit': return 'text'
    case 'checkButton': return 'boolean'
    case 'choiceList': return attr(uiEl, 'open') === 'multiSelect' ? 'multi_choice' : 'choice'
    case 'dateTimeEdit': return 'date'
    case 'numericEdit': return /[$£€¥]|currency/i.test(picture) ? 'currency' : 'number'
    case 'signature': return 'signature'
    default: return null
  }
}

/** Strip what the safe parser refuses / ignores (a DOCTYPE, processing instructions) before parsing. */
export function cleanXfaXml(xml: string): string {
  return xml
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>/gi, '')
}

/** The template packet → fields, sections and scripts. */
export function parseXfaTemplate(xml: string): XfaTemplate {
  const root = parseXml(cleanXfaXml(xml), { maxNodes: 400_000, maxDepth: 256 })
  const template = root.local === 'template' ? root : (root.children.find((c): c is XmlElement => typeof c !== 'string' && c.local === 'template') ?? root)
  const out: XfaTemplate = { fields: [], sections: [], scripts: [], pageCount: 0 }

  const scriptsOf = (node: XmlElement, owner: string, member?: string) => {
    for (const ev of childrenByLocal(node, 'event')) {
      for (const sc of childrenByLocal(ev, 'script')) {
        const body = textOf(sc).trim()
        if (body) out.scripts.push({ owner, ...(member ? { member } : {}), activity: attr(ev, 'activity') ?? attr(ev, 'ref') ?? '', body: body.slice(0, 20_000) })
      }
    }
  }

  const nextSom = (counts: Map<string, number>, base: string, name: string) => {
    const n = counts.get(name) ?? 0
    counts.set(name, n + 1)
    return `${base ? `${base}.` : ''}${name}[${n}]`
  }

  /** Walk a container: `base` = SOM of the nearest named ancestor; `counts` = its same-name counters (unnamed containers are transparent). */
  const walk = (node: XmlElement, base: string, counts: Map<string, number>, depth: number, section: string | undefined, context: string[]) => {
    for (const el of elements(node)) {
      const local = el.local
      if (local === 'draw') {
        const t = textBelow(child(el, 'value'))
        if (t && t.length <= 400) context.push(t)
        continue
      }
      if (local === 'subform' || local === 'subformSet' || local === 'area') {
        const name = attr(el, 'name') ?? ''
        if (!name || local !== 'subform') { walk(el, base, counts, depth, section, context); continue }
        const som = nextSom(counts, base, name)
        const occur = child(el, 'occur')
        const max = occur ? Number(attr(occur, 'max') ?? '1') : 1
        const hidden = /^(hidden|invisible|inactive)$/.test(attr(el, 'presence') ?? '')
        const ownContext: string[] = []
        // The first short drawn text inside is its title.
        const firstDraw = elements(el).find((x) => x.local === 'draw')
        const title = firstDraw ? textBelow(child(firstDraw, 'value')) : ''
        out.sections.push({ som, title: title.length <= 120 ? title : '', hidden, repeats: max === -1 || max > 1, depth, ...(max === -1 || max > 1 ? { max } : {}) })
        if (depth === 1) out.pageCount++
        scriptsOf(el, som)
        walk(el, som, new Map(), depth + 1, depth === 2 ? som : section, ownContext)
        continue
      }
      if (local === 'field' || local === 'exclGroup') {
        const name = attr(el, 'name') ?? ''
        if (!name) continue
        const som = nextSom(counts, base, name)
        const assist = child(el, 'assist')
        const tooltip = textBelow(child(assist, 'toolTip')) || textBelow(child(assist, 'speak'))
        const required = attr(child(el, 'validate'), 'nullTest') === 'error'
        const hidden = /^(hidden|invisible|inactive)$/.test(attr(el, 'presence') ?? '')
        const readOnly = /^(readOnly|protected|nonInteractive)$/.test(attr(el, 'access') ?? '')
        const ctxText = context.slice(-2).join(' ').slice(0, 400)
        if (local === 'exclGroup') {
          const members = childrenByLocal(el, 'field').map((f) => {
            const on = itemValues(childrenByLocal(f, 'items')[0])[0] ?? attr(f, 'name') ?? ''
            return { name: attr(f, 'name') ?? '', caption: captionOf(f) || textBelow(child(child(f, 'assist'), 'toolTip')), onValue: on }
          })
          out.fields.push({
            som, name, kind: 'exclGroup', type: 'choice', ui: 'exclGroup', caption: captionOf(el), tooltip, context: ctxText, required, hidden, readOnly,
            options: members.map((m) => ({ value: m.onValue, label: m.caption || m.onValue })), members, section,
          })
          scriptsOf(el, som)
          for (const f of childrenByLocal(el, 'field')) scriptsOf(f, som, attr(f, 'name') ?? '')
          continue
        }
        const { ui, el: uiEl } = uiOf(el)
        const pictureEl = child(child(el, 'format'), 'picture') ?? child(child(el, 'ui'), 'picture')
        const picture = pictureEl ? ws(textOf(pictureEl)) : ''
        const lists = childrenByLocal(el, 'items')
        let options: PdfOption[] = []
        let onValue: string | undefined
        if (ui === 'choiceList') {
          const shown = lists.find((l) => attr(l, 'save') !== '1') ?? lists[0]
          const saved = lists.find((l) => attr(l, 'save') === '1')
          const labels = itemValues(shown)
          const values = saved ? itemValues(saved) : labels
          options = labels.map((label, i) => ({ value: values[i] ?? label, label })).filter((o) => o.value || o.label)
        } else if (ui === 'checkButton') {
          onValue = itemValues(lists[0])[0] ?? '1'
        }
        const maxChars = Number(attr(child(child(el, 'value'), 'text'), 'maxChars') ?? NaN)
        out.fields.push({
          som, name, kind: 'field', type: typeOf(ui, uiEl, picture), ui, caption: captionOf(el), tooltip, context: ctxText, required, hidden, readOnly,
          ...(Number.isFinite(maxChars) && maxChars > 0 ? { maxChars } : {}), ...(picture ? { picture } : {}), options, ...(onValue !== undefined ? { onValue } : {}), section,
        })
        scriptsOf(el, som)
      }
    }
  }
  walk(template, '', new Map(), 0, undefined, [])
  return out
}

/** The XFA packets of a PDF (template first), or null when it has none. */
export async function readXfaPackets(bytes: Uint8Array): Promise<Record<string, string> | null> {
  return (await readWithPdfLib(bytes)).packets
}

/**
 * One pdf-lib pass: the XFA packets, and each field's tooltip (/TU) — pdf.js reports a
 * widget's own /TU only, while many PDFs keep it on the parent field (radio groups,
 * fields with several widgets).
 */
export async function readWithPdfLib(bytes: Uint8Array): Promise<{ packets: Record<string, string> | null; tooltips: Map<string, string> }> {
  const lib = await import('@cantoo/pdf-lib')
  const { PDFDocument, PDFName, PDFArray, PDFRawStream, PDFString, PDFHexString, PDFStream, decodePDFRawStream } = lib
  const tooltips = new Map<string, string>()
  let pdf
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false, preserveXFA: true } as never)
  } catch {
    return { packets: null, tooltips }
  }
  try {
    const textOfObj = (v: unknown) => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '')
    for (const field of pdf.getForm().getFields().slice(0, 5000)) {
      let tip = textOfObj(field.acroField.dict.lookup(PDFName.of('TU')))
      if (!tip) for (const w of field.acroField.getWidgets()) { tip = textOfObj(w.dict.lookup(PDFName.of('TU'))); if (tip) break }
      if (tip.trim()) tooltips.set(field.getName(), tip.trim().slice(0, 2000))
    }
  } catch { /* a damaged form tree: tooltips from pdf.js only */ }
  const acro = pdf.catalog.lookup(PDFName.of('AcroForm'))
  if (!acro || typeof (acro as { lookup?: unknown }).lookup !== 'function') return { packets: null, tooltips }
  const xfa = (acro as unknown as { lookup(n: unknown): unknown }).lookup(PDFName.of('XFA'))
  if (!xfa) return { packets: null, tooltips }
  const decode = (s: unknown): string => {
    try {
      if (s instanceof PDFRawStream) return Buffer.from(decodePDFRawStream(s).decode()).toString('utf8')
      if (s instanceof PDFStream) return Buffer.from((s as unknown as { getContents(): Uint8Array }).getContents()).toString('utf8')
    } catch { return '' }
    return ''
  }
  const packets: Record<string, string> = {}
  let total = 0
  if (xfa instanceof PDFArray) {
    for (let i = 0; i + 1 < xfa.size(); i += 2) {
      const n = xfa.lookup(i)
      const name = n instanceof PDFString || n instanceof PDFHexString ? n.decodeText() : String(n)
      const text = decode(xfa.lookup(i + 1))
      total += text.length
      if (total > 40_000_000) break
      packets[name] = (packets[name] ?? '') + text
    }
  } else {
    packets.xdp = decode(xfa)
  }
  return { packets, tooltips }
}

/** The template packet's XML from the packets (an xdp holds it inside). */
export function templateXml(packets: Record<string, string> | null): string | null {
  if (!packets) return null
  if (packets.template?.trim()) return packets.template
  const all = packets.xdp ?? Object.values(packets).join('')
  const m = /<template[\s>][\s\S]*<\/template>/.exec(all)
  return m ? m[0] : null
}
