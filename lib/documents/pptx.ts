/**
 * PowerPoint (.pptx) reading: slides in presentation order with their title,
 * body text (paragraphs, bullet levels), tables and speaker notes.
 */

import type { ZipReader } from './zip'
import { attr, child, descendants, elements, parseXml, textOf, type XmlElement } from './xml'
import { readOfficeProperties, type OfficeProperties } from './docx'
import type { Block } from './model'

export interface SlideOut {
  number: number
  title: string
  text: string
  notes: string
  tables: string[][][]
  hidden: boolean
}

export interface PptxReadResult {
  slides: SlideOut[]
  blocks: Block[]
  properties: OfficeProperties
  media: Array<{ name: string; size: number }>
}

function partRels(zip: ZipReader, part: string): Map<string, { target: string; type: string }> {
  const slash = part.lastIndexOf('/')
  const xml = zip.readText(`${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`)
  const map = new Map<string, { target: string; type: string }>()
  if (!xml) return map
  for (const rel of descendants(parseXml(xml), 'Relationship')) {
    const id = attr(rel, 'Id')
    const target = attr(rel, 'Target')
    if (id && target) map.set(id, { target, type: attr(rel, 'Type') ?? '' })
  }
  return map
}

function resolvePart(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').slice(0, -1)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

function paragraphs(txBody: XmlElement): Array<{ text: string; level: number }> {
  return elements(txBody).filter((e) => e.local === 'p').map((p) => {
    let text = ''
    for (const el of elements(p)) {
      if (el.local === 'r' || el.local === 'fld') text += textOf(child(el, 't') ?? el)
      else if (el.local === 'br') text += '\n'
    }
    return { text, level: Number(attr(child(p, 'pPr'), 'lvl') ?? 0) }
  })
}

function shapeIsTitle(sp: XmlElement): boolean {
  const ph = descendants(sp, 'ph')[0]
  const type = ph ? attr(ph, 'type') : undefined
  return type === 'title' || type === 'ctrTitle'
}

export function readPptxZip(zip: ZipReader, options: { from?: number; to?: number } = {}): PptxReadResult {
  const presXml = zip.readText('ppt/presentation.xml')
  if (!presXml) throw new Error('Not a PowerPoint presentation (ppt/presentation.xml is missing)')
  const pres = parseXml(presXml)
  const rels = partRels(zip, 'ppt/presentation.xml')
  // The relationship id is r:id (the plain `id` attribute is the slide number).
  const relId = (el: XmlElement) => Object.entries(el.attrs).find(([k]) => k.endsWith(':id'))?.[1] ?? ''
  const order = descendants(pres, 'sldId').map((s) => rels.get(relId(s))?.target).filter((t): t is string => Boolean(t)).map((t) => resolvePart('ppt/presentation.xml', t))
  const slides: SlideOut[] = []
  const blocks: Block[] = []
  order.forEach((part, idx) => {
    const number = idx + 1
    if ((options.from && number < options.from) || (options.to && number > options.to)) return
    const xml = zip.readText(part)
    if (!xml) return
    const root = parseXml(xml)
    let title = ''
    const body: Array<{ text: string; level: number }> = []
    const tables: string[][][] = []
    for (const sp of descendants(root, 'sp')) {
      const tx = child(sp, 'txBody')
      if (!tx) continue
      const paras = paragraphs(tx)
      if (!title && shapeIsTitle(sp)) title = paras.map((p) => p.text).join(' ').trim()
      else body.push(...paras.filter((p) => p.text.trim()))
    }
    for (const tbl of descendants(root, 'tbl')) {
      tables.push(descendants(tbl, 'tr').map((tr) => descendants(tr, 'tc').map((tc) => descendants(tc, 'p').map((p) => descendants(p, 't').map(textOf).join('')).join('\n').trim())))
    }
    let notes = ''
    const slideRels = partRels(zip, part)
    for (const rel of slideRels.values()) {
      if (!rel.type.endsWith('/notesSlide')) continue
      const notesXml = zip.readText(resolvePart(part, rel.target))
      if (!notesXml) continue
      const nroot = parseXml(notesXml)
      notes = descendants(nroot, 'sp')
        .filter((sp) => (attr(descendants(sp, 'ph')[0], 'type') ?? 'body') === 'body')
        .flatMap((sp) => (child(sp, 'txBody') ? paragraphs(child(sp, 'txBody')!) : []))
        .map((p) => p.text).join('\n').trim()
    }
    const text = [title, ...body.map((p) => p.text)].filter(Boolean).join('\n')
    slides.push({ number, title, text, notes, tables, hidden: attr(root, 'show') === '0' })
    blocks.push({ type: 'heading', level: 2, inlines: [{ text: title || `Slide ${number}` }] })
    for (const p of body) blocks.push(p.level > 0 ? { type: 'list_item', ordered: false, level: p.level - 1, inlines: [{ text: p.text }] } : { type: 'paragraph', inlines: [{ text: p.text }] })
    for (const t of tables) blocks.push({ type: 'table', rows: t, header: true })
    if (notes) blocks.push({ type: 'quote', inlines: [{ text: `Notes: ${notes}` }] })
  })
  const media = zip.names().filter((n) => n.startsWith('ppt/media/')).map((n) => ({ name: n.slice('ppt/media/'.length), size: zip.entries.get(n)!.uncompressedSize }))
  return { slides, blocks, properties: { ...readOfficeProperties(zip), pages: order.length }, media }
}
