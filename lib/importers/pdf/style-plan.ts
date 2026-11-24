/**
 * What "Bring in styling and images" adds to a built form (pure,
 * client-safe): from the PDF's styling (styling.ts) and the person's
 * options, the display elements placed where the PDF has them, the
 * sections made from styled headings, the form header and the theme.
 *
 *   headings     level 1–2 headings (or text on a coloured band) with boxes
 *                under them that are in no section yet → a section titled
 *                with it (bordered when the PDF draws a box round the group,
 *                plain otherwise); other headings → Heading elements, sized
 *                relative to the body text, in the heading's colour
 *   paragraphs   → read-only text (a Label with no caption, the text as its
 *                value: plain text, never HTML), bold / italic / colour kept
 *   rules        → Dividers
 *   images       figures → Display images (width and alignment from the
 *                PDF), the logo → the form header's image, backgrounds only
 *                when asked for (full width at the top of their page)
 *   footer       a repeated page footer, kept once at the end when asked for
 *   header       the PDF's title (and subtitle) over its header band colour
 *   theme        theme.ts's overrides; label emphasis / colour → field text styles
 *
 * Each element carries its page and top (PDF space) so build.ts can slot it
 * between the fields above and below it. Everything is reported (log).
 */

import type { ImportReportItem } from '@/lib/extensions/sdk'
import type { FormThemeOverrides } from '@/lib/forms/form-theme'
import type { DisplayImageAlign, DisplayImageWidth } from '@/lib/forms/media-fields'
import type { ControlTextStyle, TextStyle } from '@/lib/forms/text-style'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import type { PdfFormModel, PdfSection } from './model'
import type { PdfStyling, StyleImage, StyleText } from './styling'

export interface StyleOptions {
  /** The logo (form header) and pictures (Display images). */
  images: boolean
  /** A form theme from the PDF's colours and fonts (and label emphasis / colour). */
  theme: boolean
  /** Headings, instructions / notes, dividers; styled headings become sections. */
  text: boolean
  /** Full-page / watermark pictures (off by default). */
  backgrounds: boolean
  /** Keep a repeated page footer once, at the end. */
  footer: boolean
}

export const DEFAULT_STYLE_OPTIONS: StyleOptions = { images: true, theme: true, text: true, backgrounds: false, footer: false }

/** A display element to place (no key yet: build.ts gives it one). */
export interface StyleElement {
  id: string
  kind: 'heading' | 'text' | 'divider' | 'image'
  page: number
  /** Top in PDF space (y up); -Infinity / Infinity: the page's start / end. */
  top: number
  /** A key hint ("heading_about_you"). */
  keyHint: string
  field: Omit<TaskFieldDef, 'key'>
  /** Characters of text it carries (the form's size budget). */
  chars: number
}

/** The form header the import creates (image_url: a data: URL until the importer stores it). */
export interface PlannedHeader {
  enabled: true
  image: 'upload' | 'none'
  image_url?: string
  image_alt?: string
  title?: string
  subtitle?: string
  align: 'left' | 'center'
  banner?: boolean
}

export interface StylePlan {
  model: PdfFormModel
  elements: StyleElement[]
  /** Section id → its style (sections made from headings). */
  sectionStyles: Record<string, 'bordered' | 'plain'>
  /** Section id → its heading's top (sections made from headings): text under the heading joins it. */
  sectionTops: Record<string, number>
  header: PlannedHeader | null
  theme: FormThemeOverrides | null
  /** Item id → label text style. */
  labelStyles: Record<string, ControlTextStyle>
  /** The image placed as the header logo. */
  logo: StyleImage | null
  log: ImportReportItem[]
  counts: { headings: number; sections: number; texts: number; dividers: number; images: number }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
/** Plain text only: no placeholders ({{ }} would be read as a value), no control characters. */
export const plainText = (s: string) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\{\{|\}\}/g, (m) => (m === '{{' ? '{ {' : '} }')).replace(/[<>]/g, (m) => (m === '<' ? '‹' : '›')).trim()
const loc = (page: number) => `page ${page}`

/** Relative heading size: the PDF's size against its body text. */
export function headingSize(size: number, base: number): TextStyle['size'] {
  const r = size / Math.max(4, base)
  return r >= 1.75 ? '2xl' : r >= 1.4 ? 'xl' : r >= 1.15 ? 'lg' : 'base'
}

export function imageWidth(img: Pick<StyleImage, 'rect' | 'pageWidth'>): DisplayImageWidth {
  const r = (img.rect[2] - img.rect[0]) / Math.max(1, img.pageWidth)
  return r < 0.22 ? 'sm' : r < 0.45 ? 'md' : r < 0.7 ? 'lg' : 'full'
}

export function imageAlign(img: Pick<StyleImage, 'rect' | 'pageWidth'>): DisplayImageAlign {
  const c = (img.rect[0] + img.rect[2]) / 2 / Math.max(1, img.pageWidth)
  return c < 0.38 ? 'left' : c > 0.62 ? 'right' : 'center'
}

function textStyleOf(t: Pick<StyleText, 'bold' | 'italic' | 'color'>, extra: TextStyle = {}): TextStyle | undefined {
  const s: TextStyle = { ...extra }
  if (t.bold) s.bold = true
  if (t.italic) s.italic = true
  if (t.color) s.color = t.color
  return Object.keys(s).length ? s : undefined
}

const area = (r: [number, number, number, number]) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1])
const inside = (x: number, y: number, r: [number, number, number, number]) => x >= r[0] - 1 && x <= r[2] + 1 && y >= r[1] - 1 && y <= r[3] + 1

export function planStyling(model: PdfFormModel, styling: PdfStyling, options: StyleOptions): StylePlan {
  const log: ImportReportItem[] = []
  const elements: StyleElement[] = []
  const sectionStyles: Record<string, 'bordered' | 'plain'> = {}
  const sectionTops: Record<string, number> = {}
  const counts = { headings: 0, sections: 0, texts: 0, dividers: 0, images: 0 }
  // A copy: sections are added and items assigned to them.
  const m: PdfFormModel = { ...model, sections: [...model.sections], items: model.items.map((i) => ({ ...i })) }
  const base = styling.baseSize || 10
  // Pages without fields are instructions / notes pages (tax forms carry several): their content isn't brought in.
  const fieldPages = new Set(m.items.map((i) => i.page))
  const onFieldPage = (page: number) => !fieldPages.size || fieldPages.has(page)
  const offPage = { texts: 0, images: 0, pages: new Set<number>() }
  const off = (page: number, what: 'texts' | 'images') => { offPage[what]++; offPage.pages.add(page) }

  /* Text: headings (→ sections or Heading elements), paragraphs, dividers. */
  // A flat PDF has no boxes to tell labels from instructions: its printed text is the questions (the AI assist reads them).
  const flat = model.kind === 'flat' || model.kind === 'scanned'
  if (options.text && flat) log.push({ kind: 'text', name: 'Printed text', status: 'info', detail: 'Not brought in for a flat PDF: without fillable boxes its printed text is the questions themselves.' })
  if (options.text && !flat) {
    const headings = styling.texts.filter((t) => t.kind === 'heading').sort((a, b) => a.page - b.page || b.top - a.top)
    let made = 0
    for (const h of headings) {
      if (!onFieldPage(h.page)) { off(h.page, 'texts'); continue }
      const below = headings.filter((x) => x.page === h.page && x.top < h.bottom - 1).sort((a, b) => b.top - a.top)[0]
      const owns = m.items.filter((i) => i.page === h.page && i.rect && i.rect[3] < h.bottom + 2 && (!below || i.rect[3] > below.top) && !i.section)
      const sectionLike = (h.level ?? 3) <= 2 || Boolean(h.band)
      if (sectionLike && owns.length && made < 30) {
        const id = `pdfs_${++made}`
        const s: PdfSection = { id, title: clip(plainText(h.text), 120), page: h.page, origin: 'deterministic' }
        m.sections.push(s)
        for (const i of owns) i.section = id
        const box = styling.boxes.find((b) => b.page === h.page && owns.every((i) => inside((i.rect![0] + i.rect![2]) / 2, (i.rect![1] + i.rect![3]) / 2, b.rect)))
        sectionStyles[id] = box ? 'bordered' : 'plain'
        sectionTops[id] = h.top
        counts.sections++
        log.push({ kind: 'heading', name: clip(h.text, 120), status: 'info', mappedTo: `Section "${s.title}" (${sectionStyles[id]})`, detail: `A ${h.band ? 'heading on a coloured band' : `level ${h.level} heading`} with ${owns.length} field${owns.length === 1 ? '' : 's'} under it${box ? ', inside a drawn box' : ''}: a section titled with it.`, location: loc(h.page) })
        continue
      }
      const size = headingSize(h.size, base)
      const style = textStyleOf({ bold: false, italic: h.italic, color: h.color }, size && size !== 'base' ? { size } : {})
      elements.push({
        id: h.id, kind: 'heading', page: h.page, top: h.top, keyHint: `heading_${h.text}`.slice(0, 40), chars: h.text.length,
        field: { label: clip(plainText(h.text), 200), type: 'heading', ...(style ? { text_style: { label: style } } : {}) },
      })
      counts.headings++
      log.push({ kind: 'heading', name: clip(h.text, 120), status: 'info', mappedTo: `Heading (${size ?? 'base'}${h.color ? `, ${h.color}` : ''})`, detail: `Level ${h.level} heading (${Math.round(h.size * 10) / 10} pt against ${base} pt body text)${h.band ? `, on a ${h.band} band` : ''}.`, location: loc(h.page) })
    }
    for (const t of styling.texts.filter((x) => x.kind === 'paragraph')) {
      if (!onFieldPage(t.page)) { off(t.page, 'texts'); continue }
      const text = plainText(t.text)
      if (text.length < 2) continue
      const small = t.size <= base * 0.85
      const style = textStyleOf(t, small ? { size: 'sm' } : {})
      elements.push({
        id: t.id, kind: 'text', page: t.page, top: t.top, keyHint: `note_${text}`.slice(0, 30), chars: text.length,
        field: { label: clip(text, 80), type: 'label', default: clip(text, 5000), label_config: { hide_caption: true }, ...(style ? { text_style: { value: style } } : {}) } as Omit<TaskFieldDef, 'key'>,
      })
      counts.texts++
    }
    if (counts.texts) log.push({ kind: 'text', name: `${counts.texts} text block${counts.texts === 1 ? '' : 's'}`, status: 'info', mappedTo: 'Read-only text (Label, no caption)', detail: `Instructions, notes and other printed text that isn't a field's label: placed where the PDF has them${styling.texts.some((x) => x.kind === 'paragraph' && (x.bold || x.italic || x.color)) ? ', with their bold / italic / colour' : ''}.` })
    // Dividers that separate something: content above (since the last divider) and below on their page.
    const tops = (page: number) => [
      ...m.items.filter((i) => i.page === page && i.rect).map((i) => i.rect![3]),
      ...styling.texts.filter((t) => t.page === page && (t.kind === 'heading' || t.kind === 'paragraph')).map((t) => t.top),
    ]
    let lastY = Infinity
    let lastPage = -1
    for (const r of [...styling.rules].sort((a, b) => a.page - b.page || b.y - a.y)) {
      if (r.page !== lastPage) { lastPage = r.page; lastY = Infinity }
      if (!onFieldPage(r.page)) continue
      const t = tops(r.page)
      if (!t.some((y) => y > r.y + 1 && y < lastY - 1) || !t.some((y) => y < r.y - 1)) continue
      lastY = r.y
      elements.push({ id: r.id, kind: 'divider', page: r.page, top: r.y, keyHint: 'divider', chars: 0, field: { label: 'Divider', type: 'divider' } })
      counts.dividers++
    }
    if (counts.dividers) log.push({ kind: 'divider', name: `${counts.dividers} rule${counts.dividers === 1 ? '' : 's'}`, status: 'info', mappedTo: 'Divider', detail: 'Horizontal lines drawn across the page (lines under fields, table grids and band edges are not dividers).' })
    const skipped = styling.texts.filter((t) => t.kind === 'page_header' || t.kind === 'page_footer' || t.kind === 'page_number')
    const footer = options.footer ? skipped.find((t) => t.kind === 'page_footer' && (t.pages?.length ?? 0) >= 2 && !/^[\d\s/of-]+$/i.test(t.text)) : undefined
    if (footer) {
      const text = plainText(footer.text)
      elements.push({ id: footer.id, kind: 'text', page: Number.MAX_SAFE_INTEGER, top: -Infinity, keyHint: 'footer', chars: text.length, field: { label: 'Footer', type: 'label', default: clip(text, 5000), label_config: { hide_caption: true }, text_style: { value: { size: 'xs', color: 'muted' } } } as Omit<TaskFieldDef, 'key'> })
      log.push({ kind: 'text', name: clip(text, 120), status: 'info', mappedTo: 'Read-only text at the end', detail: `The page footer (repeated on pages ${footer.pages!.join(', ')}): kept once, at the end of the form.` })
    }
    const groups = new Map<string, { kind: string; pages: Set<number>; n: number }>()
    for (const t of skipped) {
      if (t === footer) continue
      const k = `${t.kind}:${t.text.toLowerCase().replace(/\d+/g, '#')}`
      const g = groups.get(k) ?? { kind: t.kind, pages: new Set<number>(), n: 0 }
      g.pages.add(t.page); g.n++
      groups.set(k, g)
    }
    for (const [k, g] of [...groups.entries()].slice(0, 20)) {
      const text = k.slice(k.indexOf(':') + 1)
      const what = g.kind === 'page_number' ? 'Page number' : g.kind === 'page_header' ? 'Repeated page header' : 'Repeated page footer'
      log.push({ kind: 'text', name: clip(text, 120), status: 'info', detail: `${what} on page${g.pages.size === 1 ? '' : 's'} ${[...g.pages].join(', ')}: not brought in${g.kind === 'page_footer' && !options.footer ? ' (turn on "Keep the footer once" to keep it)' : ''}.` })
    }
  }
  if (offPage.texts) log.push({ kind: 'text', name: `${offPage.texts} text block${offPage.texts === 1 ? '' : 's'} on pages without fields`, status: 'info', detail: `Pages ${[...offPage.pages].sort((a, b) => a - b).join(', ')} have no fields (instructions or notes): their headings and text are left out — add what you need in the designer.` })
  if (styling.stats.skippedText) log.push({ kind: 'text', name: `${styling.stats.skippedText} more text blocks`, status: 'info', detail: 'Over the text an import brings in: add them in the designer if you need them.' })

  /* Images. */
  let logo: StyleImage | null = null
  for (const img of styling.images) {
    const where = `${loc(img.page)}${img.pages.length > 1 ? ` (and ${img.pages.length - 1} more)` : ''} · ${img.width}×${img.height}px`
    const skip = (why: string) => log.push({ kind: 'image', name: img.alt, status: 'info', detail: `Not brought in: ${why}.`, location: where })
    if (!options.images) { skip('images are turned off'); continue }
    if (img.skip) { skip(img.skip); continue }
    if (img.role === 'decoration') { skip(img.why); continue }
    if (img.role === 'background' && !options.backgrounds) { skip(`${img.why} — turn on "Backgrounds" to include it`); continue }
    if (img.role !== 'logo' && !onFieldPage(img.page)) { off(img.page, 'images'); skip(`it is on page ${img.page}, which has no fields (an instructions page)`); continue }
    if (!img.src) { skip('over the size cap'); continue }
    if (img.role === 'logo') {
      logo = img
      counts.images++
      log.push({ kind: 'image', name: img.alt, status: 'info', mappedTo: 'The form header\'s image', detail: `The logo (${img.why}): shown once, in the form header. Check its alt text.`, location: where })
      continue
    }
    const background = img.role === 'background'
    const width = background ? 'full' : imageWidth(img)
    const align = background ? 'left' : imageAlign(img)
    elements.push({
      id: img.id, kind: 'image', page: img.page, top: background ? Infinity : img.rect[3], keyHint: `image_page_${img.page}`, chars: 0,
      field: { label: img.alt, type: 'display_image', display_image: { src: img.src, alt: img.alt, ...(width !== 'md' ? { width } : {}), ...(align !== 'left' ? { align } : {}) } } as Omit<TaskFieldDef, 'key'>,
    })
    counts.images++
    log.push({ kind: 'image', name: img.alt, status: 'info', mappedTo: `Display image (${width}, ${align})`, detail: `${background ? 'A background picture, included as asked: full width at the top of its page' : `A picture ${img.why}: placed where the PDF has it`}. Check its alt text.`, location: where })
  }
  if (styling.stats.imagesSkipped) log.push({ kind: 'image', name: `${styling.stats.imagesSkipped} more image${styling.stats.imagesSkipped === 1 ? '' : 's'}`, status: 'info', detail: 'Image masks (one-colour stencils), unsupported or very large images, or over the images read per page: not brought in.' })

  /* Header and theme. */
  const theme = options.theme && styling.theme ? styling.theme.overrides : null
  const anyOn = options.images || options.theme || options.text
  const title = styling.header.title ? clip(plainText(styling.header.title), 120) : undefined
  const subtitle = styling.header.subtitle ? clip(plainText(styling.header.subtitle), 300) : undefined
  const header: PlannedHeader | null = anyOn && (logo || title || (theme && styling.header.banner))
    ? {
      enabled: true, image: logo ? 'upload' : 'none', ...(logo ? { image_url: logo.src!, image_alt: logo.alt } : {}),
      ...(title ? { title } : {}), ...(subtitle && options.text ? { subtitle } : {}), align: styling.header.align,
      ...(theme?.header?.banner_color ? { banner: true } : {}),
    }
    : null
  if (header) log.push({ kind: 'header', name: header.title ?? 'Form header', status: 'info', mappedTo: 'Form header', detail: [header.image === 'upload' ? 'the logo' : 'no image', header.title ? `the title "${header.title}"` : '', header.subtitle ? `the subtitle "${header.subtitle}"` : '', header.banner ? `on the header band colour ${theme?.header?.banner_color}` : '', `aligned ${header.align}`].filter(Boolean).join(', ') + '.' })
  if (styling.theme) {
    log.push(options.theme
      ? { kind: 'theme', name: 'Form theme', status: 'info', mappedTo: 'A new form theme named after the form', detail: `${styling.theme.chosen.join('; ')}.${styling.theme.adjusted.length ? ` Adjusted for contrast (WCAG AA): ${styling.theme.adjusted.join('; ')}.` : ' Every colour meets WCAG AA contrast as it is.'}` }
      : { kind: 'theme', name: 'Form theme', status: 'info', detail: 'Not created: the form uses the workspace theme (as asked).' })
  } else if (anyOn) log.push({ kind: 'theme', name: 'Form theme', status: 'info', detail: 'No distinctive colours or fonts in the PDF: the form uses the workspace theme.' })
  for (const f of styling.fonts.slice(0, 6)) log.push({ kind: 'font', name: f.pdf, status: 'info', mappedTo: f.mapped ?? 'the theme font', detail: `${f.role === 'body' ? 'Body text' : f.role === 'heading' ? 'Headings' : 'Other text'} (${f.chars} characters). ${f.mapped ? 'Mapped to the closest font the theme serves' : 'No close match: the theme font is used'}; the PDF's own font files are never embedded.` })

  /* Label emphasis / colour (field text styles). */
  const labelStyles: Record<string, ControlTextStyle> = {}
  if (options.theme) for (const [id, s] of Object.entries(styling.labelStyles)) labelStyles[id] = { label: s }
  const n = Object.keys(labelStyles).length
  if (n) log.push({ kind: 'text', name: `${n} label${n === 1 ? '' : 's'} with their own look`, status: 'info', mappedTo: 'Field text style', detail: 'Labels printed bold, italic or in colour (unlike most labels) keep it.' })
  for (const note of styling.notes) log.push({ kind: 'note', name: note.slice(0, 120), status: 'info', detail: note })
  return { model: m, elements, sectionStyles, sectionTops, header, theme, labelStyles, logo, log, counts }
}

/** Largest image area on a page, for tests. */
export const imageArea = (img: StyleImage) => area(img.rect)
