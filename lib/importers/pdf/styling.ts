/**
 * "Bring in styling and images" — the PDF's look, read deterministically
 * (pure, client-safe; the raw graphics come from graphics.ts on the server):
 *
 *   images     deduped by pixel hash and classified: the logo (top of page 1
 *              or repeated at the top of pages → once, in the form header),
 *              backgrounds (full-page / large low-contrast pictures →
 *              skipped unless asked for), page decorations (repeated or tiny
 *              ornaments → skipped) and figures (→ a Display image where the
 *              PDF has it). Caps on count and size; a reason for each.
 *   text       lines that are not a field's label, option, caption or table
 *              header: the title (→ the form header), headings (larger or
 *              bold text, or text on a coloured band → section titles /
 *              Heading elements with relative sizes), paragraphs
 *              (instructions, notes, legal text → read-only text), repeated
 *              page headers / footers and page numbers (detected by
 *              repetition → skipped; the footer can be kept once).
 *   vectors    horizontal rules → dividers; filled bands behind headings →
 *              section titles and the theme's colours; boxes drawn around
 *              groups of boxes → bordered sections.
 *   typography the body size, label emphasis / colour (field text styles),
 *              fonts → the closest theme fonts (theme.ts; never embedded).
 *   theme      theme.ts: accent, background, text, fonts, header banner —
 *              contrast-checked.
 *
 * Nothing here runs anything from the PDF; text is carried as plain text
 * (rendered as text, never HTML) and images only as re-encoded PNGs.
 */

import type { PageText } from './acroform'
import type { TextLine } from './load'
import type { PdfFormModel, PdfItem } from './model'
import { cleanLabel } from './model'
import { deriveTheme, isBrandColor, isNearBlack, isNearWhite, isWhite, mapPdfFont, type DerivedTheme, type FontPick } from './theme'

export type Box = [number, number, number, number]

/* ── input (from graphics.ts, images already encoded) ────────────────── */

export interface StyleImageInput {
  page: number
  rect: Box
  width: number
  height: number
  hash: string
  /** data:image/png;base64,… (null: over the size caps, not carried). */
  src: string | null
  bytes: number
  brand?: string
  luminance: number
  contrast: number
}

export interface StyleGraphicsInput {
  page: number
  width: number
  height: number
  images: StyleImageInput[]
  skippedImages: Array<{ rect: Box; why: string }>
  fills: Array<{ rect: Box; color: string }>
  strokes: Array<{ rect: Box; color: string; width: number }>
  runs: Array<{ x: number; y: number; font: string; size: number; color: string }>
  fonts: Record<string, { name: string; bold: boolean; italic: boolean }>
}

export interface StylingInput {
  model: PdfFormModel
  pages: PageText[]
  graphics: StyleGraphicsInput[]
  /** Every widget's rectangle (all of a radio group's buttons, not only the first). */
  widgets: Array<{ page: number; rect: Box }>
}

/* ── output ──────────────────────────────────────────────────────────── */

export type ImageRole = 'logo' | 'background' | 'figure' | 'decoration'

export interface StyleImage {
  id: string
  hash: string
  page: number
  /** Every page it is painted on. */
  pages: number[]
  rect: Box
  pageWidth: number
  pageHeight: number
  role: ImageRole
  /** Why it got its role ("top of page 1, repeated on 3 pages"). */
  why: string
  src: string | null
  bytes: number
  width: number
  height: number
  alt: string
  /** Never placed, whatever the options (too small, over the caps). */
  skip?: string
}

export type TextKind = 'title' | 'heading' | 'paragraph' | 'page_header' | 'page_footer' | 'page_number'

export interface TextStyleFacts {
  size: number
  bold: boolean
  italic: boolean
  /** #rrggbb when not near black. */
  color?: string
  font?: string
}

export interface StyleText extends TextStyleFacts {
  id: string
  page: number
  /** Top / bottom of the block (page space, y up). */
  top: number
  bottom: number
  x0: number
  x1: number
  /** Paragraph text: lines joined with spaces (line breaks inside a sentence dropped). */
  text: string
  kind: TextKind
  /** Headings: 1 (largest) – 3. */
  level?: 1 | 2 | 3
  /** The coloured band behind it. */
  band?: string
  /** Repeated page headers / footers: the pages it repeats on. */
  pages?: number[]
}

export interface StyleRule { id: string; page: number; y: number; x0: number; x1: number; color: string }
export interface StyleBox { page: number; rect: Box }

export interface PdfStyling {
  images: StyleImage[]
  texts: StyleText[]
  rules: StyleRule[]
  boxes: StyleBox[]
  header: { title: string | null; subtitle: string | null; logo: string | null; banner: string | null; align: 'left' | 'center' }
  theme: DerivedTheme | null
  fonts: Array<{ pdf: string; mapped: string | null; chars: number; role: 'body' | 'heading' | 'other' }>
  /** Item id → the style of the text its label came from (only what differs from the usual label). */
  labelStyles: Record<string, { bold?: boolean; italic?: boolean; color?: string }>
  /** Body text size (pt). */
  baseSize: number
  notes: string[]
  stats: { images: number; imagesSkipped: number; texts: number; skippedText: number }
}

/** Caps for the styling a form carries. */
export const STYLING_LIMITS = {
  /** Images placed (logo included). */
  images: 20,
  /** Text blocks (headings + paragraphs) per import. */
  texts: 80,
  /** Characters of one paragraph (a label holds 5000). */
  paragraphChars: 4000,
  /** Dividers per page. */
  rulesPerPage: 8,
} as const

/* ── helpers ─────────────────────────────────────────────────────────── */

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim()
const area = (r: Box) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1])
const overlapX = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
const inside = (x: number, y: number, r: Box, pad = 0) => x >= r[0] - pad && x <= r[2] + pad && y >= r[1] - pad && y <= r[3] + pad
/** A line's box: baseline y, cap height ≈ h above it, descenders below. */
const lineTop = (l: TextLine) => l.y + l.h * 0.8
const lineBottom = (l: TextLine) => l.y - l.h * 0.25
const PAGE_NUMBER = /^(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$|^[-–—]\s*\d{1,4}\s*[-–—]$|^\d{1,4}\s*\|\s*page$/i
const repeatKey = (s: string) => norm(s).replace(/\d+/g, '#')

function median(values: number[]): number {
  if (!values.length) return 10
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/* ── the analysis ────────────────────────────────────────────────────── */

export function analyzeStyling(input: StylingInput): PdfStyling {
  const { model, pages, graphics } = input
  const notes: string[] = []
  const gOf = new Map(graphics.map((g) => [g.page, g]))
  const fontsById = new Map<string, { name: string; bold: boolean; italic: boolean }>()
  for (const g of graphics) for (const [id, f] of Object.entries(g.fonts)) if (!fontsById.has(id)) fontsById.set(id, f)

  /* Line styles: font (bold / italic / name) and colour from the drawing runs. */
  const styleOf = new Map<TextLine, TextStyleFacts>()
  for (const p of pages) {
    const runs = gOf.get(p.page)?.runs ?? []
    for (const l of p.lines) {
      const first = l.items[0]
      const fontId = first?.font ?? ''
      const f = fontsById.get(fontId)
      const run = runs.filter((r) => r.font === fontId && Math.abs(r.y - l.y) < Math.max(1.5, l.h * 0.3) && r.x <= (first?.x ?? l.x0) + 2)
        .sort((a, b) => b.x - a.x)[0] ?? runs.filter((r) => Math.abs(r.y - l.y) < Math.max(1.5, l.h * 0.3)).sort((a, b) => Math.abs(a.x - l.x0) - Math.abs(b.x - l.x0))[0]
      const color = run?.color && !isNearBlack(run.color) ? run.color : undefined
      styleOf.set(l, { size: l.h, bold: Boolean(f?.bold), italic: Boolean(f?.italic), ...(color ? { color } : {}), ...(f?.name ? { font: f.name } : {}) })
    }
  }

  /* Body size: the size most characters are set in. */
  const sizeVotes = new Map<number, number>()
  for (const p of pages) for (const l of p.lines) { const s = Math.round(l.h * 2) / 2; sizeVotes.set(s, (sizeVotes.get(s) ?? 0) + l.str.length) }
  const baseSize = [...sizeVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10

  /* Fonts: characters per PDF font. */
  const fontChars = new Map<string, { chars: number; heading: number }>()
  for (const [l, s] of styleOf) {
    if (!s.font) continue
    const e = fontChars.get(s.font) ?? { chars: 0, heading: 0 }
    e.chars += l.str.length
    if (l.h >= baseSize * 1.18 || (s.bold && l.h >= baseSize)) e.heading += l.str.length
    fontChars.set(s.font, e)
  }

  /* Widgets and table zones: text there belongs to fields. */
  const widgetsOf = new Map<number, Box[]>()
  for (const w of input.widgets) { const list = widgetsOf.get(w.page) ?? []; list.push(w.rect); widgetsOf.set(w.page, list) }
  for (const i of model.items) if (i.rect) { const list = widgetsOf.get(i.page) ?? []; if (!list.some((r) => r.join() === i.rect!.join())) list.push(i.rect as Box); widgetsOf.set(i.page, list) }
  const tableZones: Array<{ page: number; rect: Box }> = []
  const itemById = new Map(model.items.map((i) => [i.id, i]))
  for (const t of model.tables ?? []) {
    for (const page of t.pages) {
      const rects = t.itemIds.map((id) => itemById.get(id)).filter((i): i is PdfItem => Boolean(i?.rect) && i!.page === page).map((i) => i.rect as Box)
      if (!rects.length) continue
      // The header row(s) above the boxes and the row labels left of them belong to the table.
      tableZones.push({ page, rect: [Math.min(...rects.map((r) => r[0])) - 120, Math.min(...rects.map((r) => r[1])) - 4, Math.max(...rects.map((r) => r[2])) + 4, Math.max(...rects.map((r) => r[3])) + 46] })
    }
  }
  const labelTexts = new Set<string>()
  for (const i of model.items) {
    for (const t of [i.label, i.help ?? '', ...(i.options ?? []).map((o) => o.label)]) { const n = norm(t); if (n.length >= 3) labelTexts.add(n) }
  }
  const sectionTitles = new Set(model.sections.map((s) => norm(s.title)))

  const linesOfPage = new Map(pages.map((p) => [p.page, p.lines]))
  /** A widget with text on its own row to its left (its label): a line above it is not its label. */
  const leftLabelled = new Map<string, boolean>()
  const hasLeftLabel = (page: number, r: Box) => {
    const k = `${page}:${r.join()}`
    if (!leftLabelled.has(k)) leftLabelled.set(k, (linesOfPage.get(page) ?? []).some((x) => x.x1 <= r[0] + 2 && r[0] - x.x1 < 260 && Math.min(lineTop(x), r[3] + 2) - Math.max(lineBottom(x), r[1] - 2) > 0))
    return leftLabelled.get(k)!
  }
  /** Is this line part of a field (its label, an option, a caption, a table)? */
  const fieldText = (page: number, l: TextLine): boolean => {
    const top = lineTop(l), bottom = lineBottom(l)
    for (const r of widgetsOf.get(page) ?? []) {
      const sameRow = Math.min(top, r[3] + 2) - Math.max(bottom, r[1] - 2) > 0
      if (sameRow && (overlapX(l.x0, l.x1, r[0], r[2]) > 0 || (r[0] - l.x1 >= -2 && r[0] - l.x1 < 260) || (l.x0 - r[2] >= -2 && l.x0 - r[2] < 200))) return true
      const above = bottom - r[3]
      // A label above its box: close, body-sized, and the box has no label of its own on its row.
      if (above >= -2 && above <= 14 && l.h <= baseSize * 1.15 && overlapX(l.x0 - 40, l.x1 + 40, r[0], r[2]) > 0 && !hasLeftLabel(page, r)) return true
      const below = r[1] - top
      if (below >= -2 && below <= 12 && l.str.length <= 60 && overlapX(l.x0, l.x1, r[0], r[2]) > 0) return true
    }
    if (tableZones.some((z) => z.page === page && inside((l.x0 + l.x1) / 2, l.y, z.rect))) return true
    const n = norm(l.str)
    if (n.length >= 3 && [...labelTexts].some((t) => t === n || (n.length <= 120 && t.length >= 6 && (t.startsWith(n) || n.startsWith(t))))) return true
    return false
  }

  /* Repeated page headers / footers (same text, digits ignored, in the top / bottom margin of several pages). */
  const margin = (p: PageText, l: TextLine): 'top' | 'bottom' | null => (l.y > p.height * 0.9 ? 'top' : l.y < p.height * 0.09 ? 'bottom' : null)
  const repeats = new Map<string, Set<number>>()
  for (const p of pages) for (const l of p.lines) {
    const m = margin(p, l)
    if (!m) continue
    const k = `${m}:${repeatKey(l.str)}`
    const set = repeats.get(k) ?? new Set<number>()
    set.add(p.page)
    repeats.set(k, set)
  }
  const repeatedOn = (p: PageText, l: TextLine): number[] | null => {
    const m = margin(p, l)
    if (!m || pages.length < 2) return null
    const set = repeats.get(`${m}:${repeatKey(l.str)}`)
    return set && set.size >= 2 && set.size >= Math.ceil(pages.length / 2) ? [...set].sort((a, b) => a - b) : null
  }

  /* Bands: coloured filled shapes wide enough to sit behind a heading or a header. */
  const bandsOf = (page: number) => (gOf.get(page)?.fills ?? []).filter((f) => {
    const g = gOf.get(page)!
    const w = f.rect[2] - f.rect[0], h = f.rect[3] - f.rect[1]
    if (isNearWhite(f.color) || w < g.width * 0.25 || h < 8 || h > 170) return false
    // A field's highlight (boxes drawn behind widgets) is not a band.
    const covered = (widgetsOf.get(page) ?? []).reduce((n, r) => n + area([Math.max(r[0], f.rect[0]), Math.max(r[1], f.rect[1]), Math.min(r[2], f.rect[2]), Math.min(r[3], f.rect[3])]), 0)
    return covered < area(f.rect) * 0.3
  })

  /* Text blocks. */
  const titleKey = norm(model.title)
  const texts: StyleText[] = []
  let skippedText = 0
  let n = 0
  for (const p of pages) {
    const bands = bandsOf(p.page)
    const free: Array<{ l: TextLine; s: TextStyleFacts; kind: TextKind | null; pages?: number[] }> = []
    for (const l of [...p.lines].sort((a, b) => b.y - a.y || a.x0 - b.x0)) {
      const s = styleOf.get(l) ?? { size: l.h, bold: false, italic: false }
      const str = l.str.trim()
      if (!str) continue
      if (margin(p, l) && PAGE_NUMBER.test(str)) { free.push({ l, s, kind: 'page_number' }); continue }
      // The form's title (often repeated in a header band on every page): the header, once.
      if (titleKey && norm(str) === titleKey) { free.push({ l, s, kind: p.page === 1 && !texts.some((t) => t.kind === 'title') ? 'title' : 'page_header', ...(p.page === 1 ? {} : { pages: [p.page] }) }); continue }
      const rep = repeatedOn(p, l)
      if (rep) { free.push({ l, s, kind: margin(p, l) === 'top' ? 'page_header' : 'page_footer', pages: rep }); continue }
      if (fieldText(p.page, l)) continue
      if (sectionTitles.has(norm(str))) continue
      free.push({ l, s, kind: null })
    }
    // Paragraphs: free lines of one style, close together, in one column, no field between them.
    // Several blocks stay open at once: a page's columns interleave when read top to bottom.
    type Block = { lines: TextLine[]; s: TextStyleFacts; kind: TextKind | null; pages?: number[] }
    const blocks: Block[] = []
    for (const f of free) {
      let best: { b: Block; gap: number } | null = null
      for (const b of blocks) {
        if (b.kind === 'page_number' || b.kind === 'title' || b.kind !== f.kind) continue
        const prev = b.lines[b.lines.length - 1]
        const gap = lineBottom(prev) - lineTop(f.l)
        if (gap < -2 || gap >= Math.max(prev.h, f.l.h) * 0.9) continue
        // A sentence that runs on in another weight ("NOTICE: … cannot ask" / "employees for …") is one paragraph.
        const runsOn = b.kind === null && !/[.:!?]$/.test(prev.str.trim()) && /^[a-z]/.test(f.l.str.trim())
        const sameStyle = Math.abs(b.s.size - f.s.size) <= 0.6 && (b.s.bold === f.s.bold || runsOn)
        const column = overlapX(prev.x0, prev.x1, f.l.x0, f.l.x1) > 0 || Math.abs(prev.x0 - f.l.x0) < 30
        if (!sameStyle || !column) continue
        if (b.kind === null && b.s.bold && /[.:!?]$/.test(prev.str.trim())) continue
        if ((widgetsOf.get(p.page) ?? []).some((r) => r[3] < lineBottom(prev) && r[1] > lineTop(f.l) - 1 && overlapX(r[0], r[2], prev.x0, prev.x1) > 0)) continue
        if (!best || gap < best.gap) best = { b, gap }
      }
      if (best) { if (best.b.s.bold && !f.s.bold) best.b.s = { ...best.b.s, bold: false }; best.b.lines.push(f.l) }
      else blocks.push({ lines: [f.l], s: f.s, kind: f.kind, ...(f.pages ? { pages: f.pages } : {}) })
    }
    for (const b of blocks.sort((x, y) => lineTop(y.lines[0]) - lineTop(x.lines[0]) || x.lines[0].x0 - y.lines[0].x0)) {
      const lines = b.lines
      const text = lines.map((x) => x.str.trim()).reduce((acc, line) => (acc.endsWith('-') && /^[a-z]/.test(line) ? acc.slice(0, -1) + line : acc ? `${acc} ${line}` : line), '')
      // Junk: no word in it (a lone "!", "—", "____").
      if (!/\p{L}{2}/u.test(text)) continue
      const top = Math.max(...lines.map(lineTop)), bottom = Math.min(...lines.map(lineBottom))
      const x0 = Math.min(...lines.map((x) => x.x0)), x1 = Math.max(...lines.map((x) => x.x1))
      const band = bands.find((bd) => inside((x0 + Math.min(x1, x0 + 200)) / 2, (top + bottom) / 2, bd.rect, 2))
      texts.push({
        id: `t${++n}`, page: p.page, top, bottom, x0, x1, text: text.slice(0, STYLING_LIMITS.paragraphChars),
        kind: b.kind ?? 'paragraph', ...b.s, ...(band ? { band: band.color } : {}), ...(b.pages ? { pages: b.pages } : {}),
      })
    }
  }

  /* Title, headings and their levels. */
  for (const t of texts) {
    if (t.kind !== 'paragraph') continue
    if (t.page === 1 && norm(t.text) === titleKey) { t.kind = 'title'; continue }
    const short = t.text.length <= 120 && t.text.split(' ').length <= 16
    const big = t.size >= baseSize * 1.18
    const boldShort = t.bold && t.size >= baseSize * 0.95 && t.text.length <= 80 && !/[:,;]$/.test(t.text) && !/\.\s+\S/.test(t.text)
    const filler = /^(and|or|of|the|to|sign|here|yes|no|n\/a|date|signature)$/i.test(t.text.trim()) || t.text.replace(/[^\p{L}]/gu, '').length < 3
    if (short && !filler && (big || boldShort || (t.band && t.text.length <= 90)) && !/^\(?[a-z]/.test(t.text)) t.kind = 'heading'
  }
  // The title may be a line the field readers skipped (a line equal to the PDF's title metadata elsewhere): the largest text on top of page 1.
  if (!texts.some((t) => t.kind === 'title')) {
    const p1 = pages[0]
    const cand = texts.filter((t) => t.page === 1 && t.kind === 'heading' && p1 && t.top > p1.height * 0.6).sort((a, b) => b.size - a.size || b.top - a.top)[0]
    if (cand && cand.size >= baseSize * 1.3 && norm(cand.text).length >= 3 && (titleKey.includes(norm(cand.text)) || norm(cand.text).includes(titleKey))) cand.kind = 'title'
  }
  const headingSizes = [...new Set(texts.filter((t) => t.kind === 'heading').map((t) => Math.round(t.size)))].sort((a, b) => b - a)
  for (const t of texts) {
    if (t.kind !== 'heading') continue
    const idx = headingSizes.indexOf(Math.round(t.size))
    t.level = (t.size < baseSize * 1.18 ? 3 : Math.min(3, Math.max(1, idx + 1))) as 1 | 2 | 3
  }
  const counted = texts.filter((t) => t.kind === 'heading' || t.kind === 'paragraph')
  if (counted.length > STYLING_LIMITS.texts) {
    const drop = new Set(counted.slice(STYLING_LIMITS.texts).map((t) => t.id))
    skippedText += drop.size
    for (let i = texts.length - 1; i >= 0; i--) if (drop.has(texts[i].id)) texts.splice(i, 1)
    notes.push(`Only the first ${STYLING_LIMITS.texts} text blocks were brought in.`)
  }

  /* Dividers: long thin strokes (or thin fills) away from fields and tables, not a grid. */
  const rules: StyleRule[] = []
  let r = 0
  for (const g of graphics) {
    const cands: StyleRule[] = []
    const lines = [...g.strokes, ...g.fills.filter((f) => f.rect[3] - f.rect[1] <= 2.5)]
    for (const s of lines) {
      const w = s.rect[2] - s.rect[0], h = s.rect[3] - s.rect[1]
      if (h > 3 || w < g.width * 0.45 || isNearWhite(s.color)) continue
      const y = (s.rect[1] + s.rect[3]) / 2
      if ((widgetsOf.get(g.page) ?? []).some((x) => y >= x[1] - 6 && y <= x[3] + 3 && overlapX(s.rect[0], s.rect[2], x[0], x[2]) > 0)) continue
      if (tableZones.some((z) => z.page === g.page && inside((s.rect[0] + s.rect[2]) / 2, y, z.rect))) continue
      // The edges of a band are the band, not a rule.
      if (bandsOf(g.page).some((b) => Math.abs(b.rect[1] - y) < 2 || Math.abs(b.rect[3] - y) < 2)) continue
      if (cands.some((c) => Math.abs(c.y - y) < 3)) continue
      cands.push({ id: '', page: g.page, y, x0: s.rect[0], x1: s.rect[2], color: s.color })
    }
    // A grid / ruled area (many rules close together) is a drawing, not dividers.
    const kept = cands.filter((c) => cands.filter((d) => Math.abs(d.y - c.y) < 60).length < 4)
    kept.sort((a, b) => b.y - a.y).slice(0, STYLING_LIMITS.rulesPerPage).forEach((c) => rules.push({ ...c, id: `r${++r}` }))
  }

  /* Boxes drawn around groups of boxes (bordered sections). */
  const boxes: StyleBox[] = []
  for (const g of graphics) {
    for (const s of [...g.strokes, ...g.fills.filter((f) => !isNearWhite(f.color) && (hslSat(f.color) < 0.2))]) {
      const a = area(s.rect)
      if (a < g.width * g.height * 0.03 || a > g.width * g.height * 0.85) continue
      if (s.rect[2] - s.rect[0] < 40 || s.rect[3] - s.rect[1] < 30) continue
      const centres = (widgetsOf.get(g.page) ?? []).filter((x) => inside((x[0] + x[2]) / 2, (x[1] + x[3]) / 2, s.rect))
      if (centres.length >= 2 && !boxes.some((b) => b.page === g.page && b.rect.join() === s.rect.join())) boxes.push({ page: g.page, rect: s.rect })
    }
  }

  /* Images: dedupe by hash, classify. */
  const byHash = new Map<string, { first: StyleImageInput; pages: Set<number>; all: StyleImageInput[] }>()
  let imagesSkipped = 0
  for (const g of graphics) {
    imagesSkipped += g.skippedImages.length
    for (const img of g.images) {
      const e = byHash.get(img.hash)
      if (e) { e.pages.add(img.page); e.all.push(img) } else byHash.set(img.hash, { first: img, pages: new Set([img.page]), all: [img] })
    }
  }
  const images: StyleImage[] = []
  let m = 0
  const altFor = (role: ImageRole, page: number) => (role === 'logo' ? `${model.title} logo` : `Image from page ${page} of the PDF`).slice(0, 200)
  for (const { first, pages: on, all } of byHash.values()) {
    const g = gOf.get(first.page)!
    const pageArea = g.width * g.height
    const w = first.rect[2] - first.rect[0], h = first.rect[3] - first.rect[1]
    const ratio = Math.max(...all.map((x) => area(x.rect))) / pageArea
    const atTop = first.rect[1] > g.height * 0.72
    const list = [...on].sort((a, b) => a - b)
    let role: ImageRole = 'figure'
    let why = `on page ${first.page}`
    let skip: string | undefined
    if (w < 12 || h < 12 || first.width < 16 || first.height < 16) { role = 'decoration'; why = 'too small (a bullet, tick or spacer)'; skip = why }
    else if (h < 6 || w / Math.max(1, h) > 18) { role = 'decoration'; why = 'a thin strip (a rule drawn as a picture)'; skip = why }
    else if (ratio >= 0.45) { role = 'background'; why = `covers ${Math.round(ratio * 100)}% of page ${first.page} (a page background)` }
    else if (ratio >= 0.18 && first.luminance > 0.82 && first.contrast < 0.14) { role = 'background'; why = 'a large, faint picture (a watermark)' }
    else if (atTop && ratio < 0.2 && first.page === 1) { role = 'logo'; why = `top of page ${first.page}${list.length > 1 ? `, repeated on ${list.length} pages` : ''}` }
    else if (list.length >= 2 && list.length >= Math.ceil(pages.length / 2)) { role = 'decoration'; why = `repeated on ${list.length} pages (a page decoration)`; skip = why }
    images.push({
      id: `img${++m}`, hash: first.hash, page: first.page, pages: list, rect: first.rect, pageWidth: g.width, pageHeight: g.height,
      role, why, src: first.src, bytes: first.bytes, width: first.width, height: first.height, alt: altFor(role, first.page),
      ...(skip ? { skip } : !first.src ? { skip: 'over the import\'s image size cap' } : {}),
    })
  }
  // One logo: the largest on the earliest page; the others become figures at the top.
  const logos = images.filter((i) => i.role === 'logo' && !i.skip).sort((a, b) => a.page - b.page || area(b.rect) - area(a.rect))
  for (const extra of logos.slice(1)) { extra.role = 'figure'; extra.why = `${extra.why} (a second picture in the header area)`; extra.alt = altFor('figure', extra.page) }
  let placed = 0
  for (const i of images) {
    if (i.skip || i.role === 'decoration') continue
    if (++placed > STYLING_LIMITS.images) i.skip = `over the ${STYLING_LIMITS.images} images an import brings in`
  }

  /* Header: title, logo, banner (a coloured band at the top of page 1). */
  const p1 = pages[0]
  const g1 = gOf.get(1)
  const titleBlock = texts.find((t) => t.kind === 'title')
  const topBand = g1 ? bandsOf(1).filter((b) => b.rect[3] > g1.height * 0.8 && b.rect[2] - b.rect[0] > g1.width * 0.55).sort((a, b) => area(b.rect) - area(a.rect))[0] : undefined
  const logo = images.find((i) => i.role === 'logo' && !i.skip) ?? null
  // A smaller line right under the title (a subtitle / form number) on the band or near it.
  const subtitle = titleBlock ? texts.find((t) => t.page === 1 && t.kind === 'paragraph' && t.top < titleBlock.bottom && titleBlock.bottom - t.top < 24 && t.text.length <= 140 && overlapX(t.x0, t.x1, titleBlock.x0 - 60, titleBlock.x1 + 60) > 0) : undefined
  if (subtitle) subtitle.kind = 'title'
  const centre = titleBlock && p1 ? Math.abs((titleBlock.x0 + titleBlock.x1) / 2 - p1.width / 2) < p1.width * 0.05 : false

  /* Label emphasis / colour (only what differs from most labels). */
  const labelStyles: PdfStyling['labelStyles'] = {}
  const labelFacts: Array<{ id: string; s: TextStyleFacts }> = []
  for (const it of model.items) {
    if (it.labelSource !== 'nearby_text' || !it.rect) continue
    const p = pages.find((x) => x.page === it.page)
    if (!p) continue
    const key = norm(cleanLabel(it.label))
    if (key.length < 2) continue
    const line = p.lines.filter((l) => norm(l.str).startsWith(key.slice(0, 40)) && Math.abs(l.y - it.rect![1]) < 40).sort((a, b) => Math.abs(a.y - it.rect![1]) - Math.abs(b.y - it.rect![1]))[0]
    const s = line ? styleOf.get(line) : undefined
    if (s) labelFacts.push({ id: it.id, s })
  }
  if (labelFacts.length) {
    const share = (f: (s: TextStyleFacts) => boolean) => labelFacts.filter((x) => f(x.s)).length / labelFacts.length
    const boldUsual = share((s) => s.bold) > 0.5
    const italicUsual = share((s) => s.italic) > 0.5
    for (const { id, s } of labelFacts) {
      const out: { bold?: boolean; italic?: boolean; color?: string } = {}
      if (s.bold && !boldUsual) out.bold = true
      if (s.italic && !italicUsual) out.italic = true
      if (s.color) out.color = s.color
      if (Object.keys(out).length) labelStyles[id] = out
    }
    if (boldUsual) notes.push('Most labels are bold in the PDF: the theme sets the label look, so they are not made bold one by one.')
  }

  /* Fonts → theme fonts. */
  const fontList = [...fontChars.entries()].sort((a, b) => b[1].chars - a[1].chars)
  const bodyName = [...fontChars.entries()].sort((a, b) => (b[1].chars - b[1].heading) - (a[1].chars - a[1].heading))[0]?.[0]
  const headingName = [...fontChars.entries()].filter(([name]) => name !== bodyName).sort((a, b) => b[1].heading - a[1].heading)[0]?.[0]
  const picks = new Map<string, FontPick | null>()
  const pick = (name: string | undefined) => { if (!name) return null; if (!picks.has(name)) picks.set(name, mapPdfFont(name)); return picks.get(name) ?? null }
  const bodyFont = pick(bodyName)
  const headingFont = headingName && (fontChars.get(headingName)?.heading ?? 0) > 0 ? pick(headingName) : null
  const fonts: PdfStyling['fonts'] = fontList.slice(0, 12).map(([name, e]) => {
    const p = pick(name)
    return { pdf: name, mapped: p?.label ?? null, chars: e.chars, role: name === bodyName ? 'body' : name === headingName ? 'heading' : 'other' }
  })

  /* Theme. */
  const votes: Array<{ color: string; weight: number; source: string }> = []
  if (topBand) votes.push({ color: topBand.color, weight: 6, source: 'the header band' })
  for (const t of texts) {
    if (t.band && t.kind !== 'page_footer' && t.kind !== 'page_header') votes.push({ color: t.band, weight: 3, source: 'the band behind a heading' })
    if ((t.kind === 'heading' || t.kind === 'title') && t.color) votes.push({ color: t.color, weight: 2 + Math.min(2, t.text.length / 40), source: 'the heading colour' })
  }
  if (logo) {
    const brand = byHash.get(logo.hash)?.first.brand
    if (brand) votes.push({ color: brand, weight: 2.5, source: 'the logo' })
  }
  for (const rule of rules) if (isBrandColor(rule.color)) votes.push({ color: rule.color, weight: 1, source: 'the divider lines' })
  for (const g of graphics) for (const f of g.fills) if (isBrandColor(f.color) && area(f.rect) > g.width * g.height * 0.01) votes.push({ color: f.color, weight: Math.min(2, area(f.rect) / (g.width * g.height) * 10), source: 'coloured areas' })
  const pageTint = (() => {
    for (const g of graphics) {
      const f = g.fills.find((x) => area(x.rect) >= g.width * g.height * 0.8 && !isWhite(x.color))
      if (f) return f.color
    }
    return null
  })()
  const textColors = new Map<string, number>()
  for (const [l, s] of styleOf) if (l.h <= baseSize * 1.1) textColors.set(s.color ?? '#000000', (textColors.get(s.color ?? '#000000') ?? 0) + l.str.length)
  const bodyText = [...textColors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const theme = deriveTheme({ votes, banner: topBand?.color ?? null, pageTint, bodyText, bodyFont, headingFont, baseSize })

  const stats = { images: images.length, imagesSkipped, texts: texts.filter((t) => t.kind === 'heading' || t.kind === 'paragraph').length, skippedText }
  return {
    images, texts, rules, boxes,
    header: { title: titleBlock?.text ?? null, subtitle: subtitle?.text ?? null, logo: logo?.id ?? null, banner: topBand?.color ?? null, align: centre ? 'center' : 'left' },
    theme, fonts, labelStyles, baseSize, notes, stats,
  }
}

function hslSat(color: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (!m) return 1
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max === min) return 0
  const l = (max + min) / 2
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min)
}

/** Median helper for callers (exported for tests). */
export const medianOf = median
