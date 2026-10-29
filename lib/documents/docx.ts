/**
 * Word (.docx) reading and writing on the document model.
 *
 * Reading walks word/document.xml with the safe XML reader (lib/documents/xml)
 * inside the bounded ZIP reader: headings (by style or outline level), lists
 * (numbering), runs (bold / italic / underline / strike, links), tables,
 * comments, tracked changes and the core / app properties.
 *
 * Writing builds a minimal, valid package (styles, numbering, links) from
 * blocks; inserted / deleted runs become either real tracked changes
 * (w:ins / w:del) or redline formatting.
 */

import { openZip, type ZipReader } from './zip'
import { attr, child, childrenByLocal, descendants, elements, escapeXml, parseXml, textOf, type XmlElement } from './xml'
import { inlineText, plain, type Block, type Inline } from './model'

export interface DocxComment { id: string; author: string; date: string | null; text: string }
export interface TrackedChange { type: 'insertion' | 'deletion'; author: string; date: string | null; text: string }

export interface DocxReadResult {
  blocks: Block[]
  properties: OfficeProperties
  comments: DocxComment[]
  trackedChanges: TrackedChange[]
  media: Array<{ name: string; size: number }>
}

export interface OfficeProperties {
  title: string | null
  subject: string | null
  author: string | null
  keywords: string | null
  description: string | null
  last_modified_by: string | null
  created: string | null
  modified: string | null
  pages: number | null
  application: string | null
}

const DOC_MAIN = 'word/document.xml'

/** Core (docProps/core.xml) and extended (docProps/app.xml) properties of any OOXML package. */
export function readOfficeProperties(zip: ZipReader): OfficeProperties {
  const props: OfficeProperties = { title: null, subject: null, author: null, keywords: null, description: null, last_modified_by: null, created: null, modified: null, pages: null, application: null }
  const core = zip.readText('docProps/core.xml')
  if (core) {
    const root = parseXml(core)
    const val = (local: string) => {
      const el = elements(root).find((e) => e.local === local)
      const t = el ? textOf(el).trim() : ''
      return t || null
    }
    props.title = val('title')
    props.subject = val('subject')
    props.author = val('creator')
    props.keywords = val('keywords')
    props.description = val('description')
    props.last_modified_by = val('lastModifiedBy')
    props.created = val('created')
    props.modified = val('modified')
  }
  const app = zip.readText('docProps/app.xml')
  if (app) {
    const root = parseXml(app)
    const pages = child(root, 'Pages') ?? child(root, 'Slides')
    if (pages && Number.isFinite(Number(textOf(pages)))) props.pages = Number(textOf(pages))
    const application = child(root, 'Application')
    if (application) props.application = textOf(application).trim() || null
  }
  return props
}

function relsOf(zip: ZipReader, part: string): Map<string, string> {
  const slash = part.lastIndexOf('/')
  const relPath = `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`
  const xml = zip.readText(relPath)
  const map = new Map<string, string>()
  if (!xml) return map
  for (const rel of descendants(parseXml(xml), 'Relationship')) {
    const id = attr(rel, 'Id')
    const target = attr(rel, 'Target')
    if (id && target) map.set(id, target)
  }
  return map
}

interface StyleInfo { headingLevel: number | null; isTitle: boolean; isCode: boolean; isQuote: boolean; isList: boolean }

function readStyles(zip: ZipReader): Map<string, StyleInfo> {
  const map = new Map<string, StyleInfo>()
  const xml = zip.readText('word/styles.xml')
  if (!xml) return map
  for (const style of descendants(parseXml(xml), 'style')) {
    const id = attr(style, 'styleId')
    if (!id) continue
    const name = (attr(child(style, 'name'), 'val') ?? id).toLowerCase()
    const outline = attr(child(child(style, 'pPr'), 'outlineLvl'), 'val')
    const m = /^heading\s*([1-9])$/.exec(name) ?? /^heading([1-9])$/i.exec(id)
    map.set(id, {
      headingLevel: m ? Number(m[1]) : outline !== undefined && Number(outline) < 9 ? Number(outline) + 1 : null,
      isTitle: name === 'title',
      isCode: /code|source|preformatted|html pre/.test(name),
      isQuote: /quote/.test(name),
      isList: /list/.test(name),
    })
  }
  return map
}

/** numId → level → ordered? */
function readNumbering(zip: ZipReader): Map<string, Map<number, boolean>> {
  const out = new Map<string, Map<number, boolean>>()
  const xml = zip.readText('word/numbering.xml')
  if (!xml) return out
  const root = parseXml(xml)
  const abstract = new Map<string, Map<number, boolean>>()
  for (const a of childrenByLocal(root, 'abstractNum')) {
    const levels = new Map<number, boolean>()
    for (const lvl of childrenByLocal(a, 'lvl')) {
      const fmt = attr(child(lvl, 'numFmt'), 'val') ?? 'bullet'
      levels.set(Number(attr(lvl, 'ilvl') ?? 0), fmt !== 'bullet' && fmt !== 'none')
    }
    abstract.set(attr(a, 'abstractNumId') ?? '', levels)
  }
  for (const num of childrenByLocal(root, 'num')) {
    const absId = attr(child(num, 'abstractNumId'), 'val') ?? ''
    out.set(attr(num, 'numId') ?? '', abstract.get(absId) ?? new Map())
  }
  return out
}

function onOff(el: XmlElement | undefined): boolean {
  if (!el) return false
  const v = attr(el, 'val')
  return v === undefined || !['0', 'false', 'off', 'none'].includes(v.toLowerCase())
}

interface Ctx {
  rels: Map<string, string>
  styles: Map<string, StyleInfo>
  numbering: Map<string, Map<number, boolean>>
  tracked: 'accept' | 'show'
  changes: TrackedChange[]
}

function runInlines(run: XmlElement, base: Partial<Inline>, ctx: Ctx): Inline[] {
  const rPr = child(run, 'rPr')
  const fmt: Partial<Inline> = { ...base }
  if (rPr) {
    if (onOff(child(rPr, 'b'))) fmt.bold = true
    if (onOff(child(rPr, 'i'))) fmt.italic = true
    if (onOff(child(rPr, 'strike')) || onOff(child(rPr, 'dstrike'))) fmt.strike = true
    const u = child(rPr, 'u')
    if (u && attr(u, 'val') !== 'none') fmt.underline = true
    const font = attr(child(rPr, 'rFonts'), 'ascii') ?? ''
    if (/courier|consolas|mono/i.test(font)) fmt.code = true
  }
  let text = ''
  for (const el of elements(run)) {
    switch (el.local) {
      case 't': case 'delText': text += textOf(el); break
      case 'tab': text += '\t'; break
      case 'br': case 'cr': text += '\n'; break
      case 'noBreakHyphen': text += '‑'; break
      case 'sym': text += '□'; break
    }
  }
  if (!text) return []
  return [{ ...fmt, text } as Inline]
}

function paragraphInlines(p: XmlElement, ctx: Ctx, base: Partial<Inline> = {}): Inline[] {
  const out: Inline[] = []
  for (const el of elements(p)) {
    switch (el.local) {
      case 'r':
        out.push(...runInlines(el, base, ctx))
        break
      case 'hyperlink': {
        const id = attr(el, 'id')
        const anchor = attr(el, 'anchor')
        const href = id ? ctx.rels.get(id) : anchor ? `#${anchor}` : undefined
        out.push(...paragraphInlines(el, ctx, { ...base, ...(href ? { href } : {}) }))
        break
      }
      case 'ins': {
        const text = inlineText(paragraphInlines(el, { ...ctx, changes: [] }, base))
        ctx.changes.push({ type: 'insertion', author: attr(el, 'author') ?? '', date: attr(el, 'date') ?? null, text })
        out.push(...paragraphInlines(el, ctx, ctx.tracked === 'show' ? { ...base, ins: true } : base))
        break
      }
      case 'del': {
        const text = inlineText(paragraphInlines(el, { ...ctx, changes: [] }, base))
        ctx.changes.push({ type: 'deletion', author: attr(el, 'author') ?? '', date: attr(el, 'date') ?? null, text })
        if (ctx.tracked === 'show') out.push(...paragraphInlines(el, ctx, { ...base, del: true }))
        break
      }
      case 'smartTag': case 'customXml': case 'sdtContent': case 'fldSimple': case 'moveTo':
        out.push(...paragraphInlines(el, ctx, base))
        break
      case 'sdt':
        out.push(...paragraphInlines(child(el, 'sdtContent') ?? el, ctx, base))
        break
    }
  }
  return out
}

function paragraphBlock(p: XmlElement, ctx: Ctx): Block {
  const pPr = child(p, 'pPr')
  const styleId = attr(child(pPr, 'pStyle'), 'val') ?? ''
  const style = ctx.styles.get(styleId)
  const inlines = paragraphInlines(p, ctx)
  const outline = attr(child(pPr, 'outlineLvl'), 'val')
  const builtIn = /^heading\s*([1-9])$/i.exec(styleId)
  const level = style?.headingLevel ?? (builtIn ? Number(builtIn[1]) : outline !== undefined && Number(outline) < 9 ? Number(outline) + 1 : null)
  if (style?.isTitle || /^title$/i.test(styleId)) return { type: 'heading', level: 1, inlines }
  if (level) return { type: 'heading', level, inlines }
  const numPr = child(pPr, 'numPr')
  if (numPr) {
    const numId = attr(child(numPr, 'numId'), 'val') ?? ''
    const ilvl = Number(attr(child(numPr, 'ilvl'), 'val') ?? 0)
    if (numId !== '0') return { type: 'list_item', ordered: ctx.numbering.get(numId)?.get(ilvl) ?? false, level: Math.min(8, ilvl), inlines }
  }
  if (style?.isCode) return { type: 'code', text: inlineText(inlines) }
  if (style?.isQuote) return { type: 'quote', inlines }
  return { type: 'paragraph', inlines }
}

function cellText(tc: XmlElement, ctx: Ctx): string {
  const parts: string[] = []
  for (const el of elements(tc)) {
    if (el.local === 'p') parts.push(inlineText(paragraphInlines(el, ctx)))
    else if (el.local === 'tbl') parts.push(tableRows(el, ctx).map((r) => r.join(' | ')).join('\n'))
    else if (el.local === 'sdt') parts.push(cellText(child(el, 'sdtContent') ?? el, ctx))
  }
  return parts.join('\n').trim()
}

function tableRows(tbl: XmlElement, ctx: Ctx): string[][] {
  const rows: string[][] = []
  for (const tr of descendantsShallow(tbl, 'tr')) {
    const row: string[] = []
    for (const tc of descendantsShallow(tr, 'tc')) {
      const text = cellText(tc, ctx)
      const span = Number(attr(child(child(tc, 'tcPr'), 'gridSpan'), 'val') ?? 1)
      row.push(text)
      for (let k = 1; k < Math.min(span, 50); k++) row.push('')
    }
    rows.push(row)
  }
  return rows
}

/** Children (looking through sdt / sdtContent wrappers) with this local name. */
function descendantsShallow(node: XmlElement, local: string): XmlElement[] {
  const out: XmlElement[] = []
  for (const el of elements(node)) {
    if (el.local === local) out.push(el)
    else if (el.local === 'sdt' || el.local === 'sdtContent' || el.local === 'customXml') out.push(...descendantsShallow(el, local))
  }
  return out
}

function bodyBlocks(container: XmlElement, ctx: Ctx, out: Block[]): void {
  for (const el of elements(container)) {
    if (el.local === 'p') {
      const hasPageBreak = descendants(el, 'br').some((br) => attr(br, 'type') === 'page')
      out.push(paragraphBlock(el, ctx))
      if (hasPageBreak) out.push({ type: 'page_break' })
    } else if (el.local === 'tbl') {
      const rows = tableRows(el, ctx)
      if (rows.length) out.push({ type: 'table', rows, header: true })
    } else if (el.local === 'sdt') {
      const content = child(el, 'sdtContent')
      if (content) bodyBlocks(content, ctx, out)
    } else if (el.local === 'customXml') bodyBlocks(el, ctx, out)
  }
}

export function readDocxZip(zip: ZipReader, options: { trackedChanges?: 'accept' | 'show' } = {}): DocxReadResult {
  const xml = zip.readText(DOC_MAIN)
  if (!xml) throw new Error('Not a Word document (word/document.xml is missing)')
  const ctx: Ctx = {
    rels: relsOf(zip, DOC_MAIN),
    styles: readStyles(zip),
    numbering: readNumbering(zip),
    tracked: options.trackedChanges ?? 'accept',
    changes: [],
  }
  const root = parseXml(xml)
  const body = child(root, 'body')
  const blocks: Block[] = []
  if (body) bodyBlocks(body, ctx, blocks)

  const comments: DocxComment[] = []
  const commentsXml = zip.readText('word/comments.xml')
  if (commentsXml) {
    for (const c of descendants(parseXml(commentsXml), 'comment')) {
      comments.push({
        id: attr(c, 'id') ?? '',
        author: attr(c, 'author') ?? '',
        date: attr(c, 'date') ?? null,
        text: descendants(c, 'p').map((p) => inlineText(paragraphInlines(p, { ...ctx, changes: [] }))).join('\n').trim(),
      })
    }
  }
  const media = zip.names().filter((n) => n.startsWith('word/media/')).map((n) => ({ name: n.slice('word/media/'.length), size: zip.entries.get(n)!.uncompressedSize }))
  return { blocks, properties: readOfficeProperties(zip), comments, trackedChanges: ctx.changes, media }
}

export function readDocx(bytes: Uint8Array, options: { trackedChanges?: 'accept' | 'show' } = {}): DocxReadResult {
  return readDocxZip(openZip(bytes), options)
}

/* ── Writing ─────────────────────────────────────────────────────────── */

export interface WriteDocxOptions {
  title?: string
  author?: string
  /** Inserted / deleted runs: real tracked changes, or coloured underline / strikethrough. */
  redlineStyle?: 'tracked' | 'formatting'
  changeAuthor?: string
  changeDate?: string
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

function xmlText(text: string): string {
  return escapeXml(text)
}

function runXml(i: Inline, opts: WriteDocxOptions, ids: { next: number }): string {
  const props: string[] = []
  if (i.code) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>')
  if (i.bold) props.push('<w:b/>')
  if (i.italic) props.push('<w:i/>')
  const formatting = opts.redlineStyle === 'formatting'
  if (i.strike || (i.del && formatting)) props.push('<w:strike/>')
  if (i.ins && formatting) props.push('<w:color w:val="0B7A3B"/>')
  if (i.del && formatting) props.push('<w:color w:val="B42318"/>')
  if (i.underline || (i.ins && formatting)) props.push('<w:u w:val="single"/>')
  if (i.href) props.push('<w:rStyle w:val="Hyperlink"/>')
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''
  const deleted = i.del && !formatting
  const parts = i.text.split(/(\n|\t)/)
  const body = parts.map((part) => {
    if (part === '\n') return '<w:br/>'
    if (part === '\t') return '<w:tab/>'
    if (!part) return ''
    return deleted ? `<w:delText xml:space="preserve">${xmlText(part)}</w:delText>` : `<w:t xml:space="preserve">${xmlText(part)}</w:t>`
  }).join('')
  const run = `<w:r>${rPr}${body}</w:r>`
  if (!formatting && (i.ins || i.del)) {
    const tag = i.ins ? 'w:ins' : 'w:del'
    return `<${tag} w:id="${ids.next++}" w:author="${xmlText(opts.changeAuthor ?? 'UserTasks')}" w:date="${xmlText(opts.changeDate ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'))}">${run}</${tag}>`
  }
  return run
}

function inlinesXml(inlines: Inline[], opts: WriteDocxOptions, rels: string[], ids: { next: number }): string {
  return inlines.map((i) => {
    const run = runXml(i, opts, ids)
    if (i.href && /^(https?:|mailto:)/i.test(i.href)) {
      rels.push(i.href)
      return `<w:hyperlink r:id="rIdLink${rels.length}">${run}</w:hyperlink>`
    }
    return run
  }).join('')
}

function paragraphXml(style: string | null, inner: string, extraPPr = ''): string {
  const pPr = style || extraPPr ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extraPPr}</w:pPr>` : ''
  return `<w:p>${pPr}${inner}</w:p>`
}

function tableXml(rows: string[][], header: boolean): string {
  const width = Math.max(1, ...rows.map((r) => r.length))
  const grid = `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(width)}</w:tblGrid>`
  const trs = rows.map((r, idx) => {
    const cells = Array.from({ length: width }, (_, k) => {
      const lines = String(r[k] ?? '').split('\n')
      const runs = lines.map((l, n) => `${n ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlText(l)}</w:t>`).join('')
      const rPr = header && idx === 0 ? '<w:rPr><w:b/></w:rPr>' : ''
      return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p><w:r>${rPr}${runs}</w:r></w:p></w:tc>`
    }).join('')
    const trPr = header && idx === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''
    return `<w:tr>${trPr}${cells}</w:tr>`
  }).join('')
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr>${grid}${trs}</w:tbl><w:p/>`
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>
${[1, 2, 3, 4, 5, 6].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="${n < 3 ? 240 : 160}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${[36, 30, 26, 24, 22, 22][n - 1]}"/></w:rPr></w:style>`).join('\n')}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="SourceCode"><w:name w:val="Source Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="A0A0A0"/><w:left w:val="single" w:sz="4" w:space="0" w:color="A0A0A0"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="A0A0A0"/><w:right w:val="single" w:sz="4" w:space="0" w:color="A0A0A0"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="A0A0A0"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="A0A0A0"/></w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`

function numberingXml(): string {
  const lvls = (ordered: boolean) => Array.from({ length: 9 }, (_, l) => ordered
    ? `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${['decimal', 'lowerLetter', 'lowerRoman'][l % 3]}"/><w:lvlText w:val="%${l + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
    : `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${['•', '◦', '▪'][l % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W_NS}><w:abstractNum w:abstractNumId="0">${lvls(false)}</w:abstractNum><w:abstractNum w:abstractNumId="1">${lvls(true)}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
}

/** Blocks → .docx bytes. */
export async function writeDocx(blocks: Block[], options: WriteDocxOptions = {}): Promise<Buffer> {
  const rels: string[] = []
  const ids = { next: 1 }
  const body: string[] = []
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        body.push(paragraphXml(`Heading${Math.min(6, Math.max(1, b.level))}`, inlinesXml(b.inlines, options, rels, ids)))
        break
      case 'paragraph':
        body.push(paragraphXml(null, inlinesXml(b.inlines, options, rels, ids)))
        break
      case 'quote':
        body.push(paragraphXml('Quote', inlinesXml(b.inlines, options, rels, ids)))
        break
      case 'list_item':
        body.push(paragraphXml('ListParagraph', inlinesXml(b.inlines, options, rels, ids), `<w:numPr><w:ilvl w:val="${Math.min(8, b.level)}"/><w:numId w:val="${b.ordered ? 2 : 1}"/></w:numPr>`))
        break
      case 'table':
        if (b.rows.length) body.push(tableXml(b.rows, b.header))
        break
      case 'code':
        for (const line of b.text.split('\n')) body.push(paragraphXml('SourceCode', inlinesXml(plain(line || ' '), options, rels, ids)))
        break
      case 'hr':
        body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="A0A0A0"/></w:pBdr></w:pPr></w:p>')
        break
      case 'page_break':
        body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
        break
    }
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${rels.map((href, k) => `<Relationship Id="rIdLink${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlText(href)}" TargetMode="External"/>`).join('')}</Relationships>`
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(options.title ?? '')}</dc:title><dc:creator>${xmlText(options.author ?? 'UserTasks')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
  const PizZip = (await import('pizzip')).default
  const zip = new PizZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`)
  zip.file('word/document.xml', document)
  zip.file('word/styles.xml', STYLES_XML)
  zip.file('word/numbering.xml', numberingXml())
  zip.file('word/_rels/document.xml.rels', docRels)
  zip.file('docProps/core.xml', core)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}
