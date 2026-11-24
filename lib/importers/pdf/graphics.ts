/**
 * A PDF page's graphics for "Bring in styling and images" (server-only:
 * pdf.js operator lists, scripting off — nothing in the PDF is run).
 *
 * One walk over the page's operator list (annotations — the fields'
 * appearance streams — left out) collects:
 *
 *   images   raster images painted on the page (XObjects and inline images)
 *            with their position / size on the page, decoded to raw pixels
 *            by pdf.js and re-encoded here as fresh PNGs (no metadata, no
 *            original bytes: a JPEG's EXIF or an image's ICC / XMP never
 *            survive). Masks and patterns are skipped; SVG never comes out.
 *   fills    filled shapes (their bounding box and colour): header bands,
 *            tinted boxes behind headings.
 *   strokes  stroked paths: horizontal rules and boxes drawn around groups.
 *   runs     where text is drawn, in which font and colour (pdf.js text
 *            content has no colour): matched to text lines later.
 *   fonts    font id → the PDF's font name and its bold / italic flags.
 *
 * Bounded: an operator budget, an image budget (count, pixels) and the
 * caller's deadline. Pure geometry / classification lives in styling.ts.
 */

import type { PdfDoc } from './load'

export type Box = [number, number, number, number]

export interface RawImage {
  page: number
  /** Page space [x0, y0, x1, y1] (y up). */
  rect: Box
  /** Pixel size. */
  width: number
  height: number
  /** sha256 of the pixels (dedupe across pages). */
  hash: string
  /** Fresh PNG (re-encoded; downscaled to the caller's max side / bytes), null when it can't fit the byte cap. */
  png: Buffer | null
  /** Mean colour of the saturated pixels (a logo's brand colour), when there are enough. */
  brand?: string
  /** Mean luminance 0–1 and how much it varies (low-contrast backgrounds). */
  luminance: number
  contrast: number
}

export interface Fill { page: number; rect: Box; color: string }
export interface Stroke { page: number; rect: Box; color: string; width: number }
export interface TextRun { page: number; x: number; y: number; font: string; size: number; color: string }
export interface FontInfo { name: string; bold: boolean; italic: boolean }

export interface PageGraphics {
  page: number
  width: number
  height: number
  images: RawImage[]
  /** Images seen but not decoded (masks, too large, unsupported): counted for the report. */
  skippedImages: Array<{ rect: Box; why: string }>
  fills: Fill[]
  strokes: Stroke[]
  runs: TextRun[]
  fonts: Record<string, FontInfo>
}

export interface GraphicsLimits {
  /** Images decoded at most on this page. */
  maxImages: number
  /** Longest side of a re-encoded image (px). */
  maxSide: number
  /** Largest image decoded (pixels). */
  maxPixels: number
  /** Largest re-encoded PNG (bytes): the image is downscaled until it fits. */
  maxBytes: number
  /** Operators walked at most. */
  maxOps: number
  deadline: number
}

export const GRAPHICS_LIMITS = { maxImages: 12, maxSide: 1600, maxPixels: 25_000_000, maxOps: 400_000 } as const

/* eslint-disable @typescript-eslint/no-explicit-any -- pdf.js operator lists are untyped */

type M = [number, number, number, number, number, number]
const ID: M = [1, 0, 0, 1, 0, 0]
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
]
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/** A local box through a matrix → its page-space bounding box. */
export function boxThrough(m: M, x0: number, y0: number, x1: number, y1: number): Box {
  const pts = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)]
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const r = (n: number) => Math.round(n * 10) / 10
  return [r(Math.min(...xs)), r(Math.min(...ys)), r(Math.max(...xs)), r(Math.max(...ys))]
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
/** pdf.js colour arguments (hex since v4; numbers for gray / rgb / cmyk) → #rrggbb, or null. */
export function colorArg(args: any[] | null | undefined, kind: 'rgb' | 'gray' | 'cmyk'): string | null {
  if (!args?.length) return null
  if (typeof args[0] === 'string' && /^#[0-9a-f]{6}$/i.test(args[0])) return args[0].toLowerCase()
  const n = args.map(Number)
  if (n.some((v) => !Number.isFinite(v))) return null
  const unit = n.every((v) => v <= 1)
  const s = (v: number) => (unit ? v * 255 : v)
  if (kind === 'gray') return `#${hex2(s(n[0])).repeat(3)}`
  if (kind === 'rgb' && n.length >= 3) return `#${hex2(s(n[0]))}${hex2(s(n[1]))}${hex2(s(n[2]))}`
  if (kind === 'cmyk' && n.length >= 4) {
    const [c, m, y, k] = n.map((v) => (v > 1 ? v / 100 : v))
    return `#${hex2(255 * (1 - c) * (1 - k))}${hex2(255 * (1 - m) * (1 - k))}${hex2(255 * (1 - y) * (1 - k))}`
  }
  return null
}

/** Strip a subset prefix ("ABCDEF+Calibri-Bold" → "Calibri-Bold"). */
export const cleanFontName = (name: string) => String(name ?? '').replace(/^[A-Z]{6}\+/, '').trim().slice(0, 80)

/** Raw pdf.js image data → 1, 3 or 4 channel 8-bit pixels (1-bit gray expanded), or null. */
export function pixelsOf(img: { width: number; height: number; data: Uint8Array | Uint8ClampedArray; kind?: number }): { data: Uint8Array; channels: number } | null {
  const { width: w, height: h, data } = img
  if (!w || !h || !data?.length) return null
  const per = data.length / (w * h)
  if (per === 1 || per === 3 || per === 4) return { data: data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength), channels: per }
  // GRAYSCALE_1BPP: rows padded to a byte, 1 = white.
  const stride = Math.ceil(w / 8)
  if (img.kind === 1 && data.length >= stride * h) {
    const out = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = (data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0
    return { data: out, channels: 1 }
  }
  return null
}

/** Luminance stats and the brand colour (mean of saturated, mid-light pixels) of an image, sampled. */
export function imageStats(data: Uint8Array, w: number, h: number, channels: number): { luminance: number; contrast: number; brand?: string } {
  const total = w * h
  const step = Math.max(1, Math.floor(total / 40_000))
  let n = 0, sum = 0, sq = 0, br = 0, bg = 0, bb = 0, bn = 0
  for (let i = 0; i < total; i += step) {
    const o = i * channels
    const a = channels === 4 ? data[o + 3] / 255 : 1
    if (a < 0.5) continue
    const r = data[o], g = channels >= 3 ? data[o + 1] : r, b = channels >= 3 ? data[o + 2] : r
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    sum += l; sq += l * l; n++
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const light = (max + min) / 510
    const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255))
    if (sat > 0.35 && light > 0.15 && light < 0.85) { br += r; bg += g; bb += b; bn++ }
  }
  if (!n) return { luminance: 1, contrast: 0 }
  const mean = sum / n
  const out: { luminance: number; contrast: number; brand?: string } = { luminance: mean, contrast: Math.sqrt(Math.max(0, sq / n - mean * mean)) }
  if (bn >= Math.max(20, n * 0.04)) out.brand = `#${hex2(br / bn)}${hex2(bg / bn)}${hex2(bb / bn)}`
  return out
}

/**
 * Walk one page (already loaded) and collect its graphics. Never throws for
 * content problems: what can't be read is skipped (and counted).
 */
export async function readPageGraphics(page: any, pageNumber: number, limits: GraphicsLimits): Promise<PageGraphics> {
  const view = page.view ?? [0, 0, 612, 792]
  const out: PageGraphics = { page: pageNumber, width: view[2] - view[0], height: view[3] - view[1], images: [], skippedImages: [], fills: [], strokes: [], runs: [], fonts: {} }
  const { OPS } = await import('unpdf/pdfjs')
  let list: { fnArray: number[]; argsArray: any[] }
  try {
    // annotationMode 0 (DISABLE): the fields' own boxes are not page graphics.
    list = await page.getOperatorList({ annotationMode: 0 })
  } catch {
    return out
  }
  const { createHash } = await import('node:crypto')
  const { encodePng, downscalePixels } = await import('@/lib/documents/pdf')
  const fill = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke])
  const stroke = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke])
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat])
  const maskOps = new Set([OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup, OPS.paintImageMaskXObjectRepeat, OPS.paintSolidColorImageMask, OPS.paintInlineImageXObjectGroup])
  const textShow = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText])

  type G = { ctm: M; fill: string; stroke: string; lw: number }
  let g: G = { ctm: ID, fill: '#000000', stroke: '#000000', lw: 1 }
  const stack: G[] = []
  let tm: M = ID
  let lm: M = ID
  let leading = 0
  let font = ''
  let size = 0
  let inAnnotation = 0
  const fontIds = new Set<string>()
  const n = Math.min(list.fnArray.length, limits.maxOps)
  for (let i = 0; i < n; i++) {
    if ((i & 1023) === 0 && Date.now() > limits.deadline) break
    const fn = list.fnArray[i]
    const a = list.argsArray[i]
    if (fn === OPS.beginAnnotation) { inAnnotation++; continue }
    if (fn === OPS.endAnnotation) { inAnnotation = Math.max(0, inAnnotation - 1); continue }
    if (inAnnotation) continue
    switch (fn) {
      case OPS.save: stack.push({ ...g }); break
      case OPS.restore: g = stack.pop() ?? g; break
      case OPS.transform: if (Array.isArray(a) && a.length >= 6) g.ctm = mul(g.ctm, a.map(Number) as M); break
      case OPS.paintFormXObjectBegin: {
        stack.push({ ...g })
        const m = Array.isArray(a?.[0]) || ArrayBuffer.isView(a?.[0]) ? Array.from(a[0] as ArrayLike<number>) : null
        if (m && m.length >= 6) g.ctm = mul(g.ctm, m.map(Number) as M)
        break
      }
      case OPS.paintFormXObjectEnd: g = stack.pop() ?? g; break
      case OPS.setFillRGBColor: g.fill = colorArg(a, 'rgb') ?? g.fill; break
      case OPS.setFillGray: g.fill = colorArg(a, 'gray') ?? g.fill; break
      case OPS.setFillCMYKColor: g.fill = colorArg(a, 'cmyk') ?? g.fill; break
      case OPS.setStrokeRGBColor: g.stroke = colorArg(a, 'rgb') ?? g.stroke; break
      case OPS.setStrokeGray: g.stroke = colorArg(a, 'gray') ?? g.stroke; break
      case OPS.setStrokeCMYKColor: g.stroke = colorArg(a, 'cmyk') ?? g.stroke; break
      case OPS.setLineWidth: g.lw = Number(a?.[0]) || g.lw; break
      case OPS.constructPath: {
        // pdf.js 5: [paint op, [path data], minMax]
        const op = Number(a?.[0])
        const mm = a?.[2]
        if (!mm || mm.length < 4 || !Number.isFinite(Number(mm[0]))) break
        const rect = boxThrough(g.ctm, Number(mm[0]), Number(mm[1]), Number(mm[2]), Number(mm[3]))
        if (fill.has(op)) out.fills.push({ page: pageNumber, rect, color: g.fill })
        if (stroke.has(op)) out.strokes.push({ page: pageNumber, rect, color: g.stroke, width: Math.abs(g.lw * Math.hypot(g.ctm[0], g.ctm[1])) })
        break
      }
      case OPS.beginText: tm = ID; lm = ID; break
      case OPS.setFont: font = String(a?.[0] ?? ''); size = Number(a?.[1]) || size; if (font) fontIds.add(font); break
      case OPS.setLeading: leading = Number(a?.[0]) || 0; break
      case OPS.setTextMatrix: {
        const m = Array.isArray(a?.[0]) || ArrayBuffer.isView(a?.[0]) ? Array.from(a[0] as ArrayLike<number>) : a
        if (m && m.length >= 6) { tm = m.map(Number) as M; lm = tm }
        break
      }
      case OPS.moveText: case OPS.setLeadingMoveText:
        lm = mul(lm, [1, 0, 0, 1, Number(a?.[0]) || 0, Number(a?.[1]) || 0]); tm = lm
        if (fn === OPS.setLeadingMoveText) leading = -(Number(a?.[1]) || 0)
        break
      case OPS.nextLine: lm = mul(lm, [1, 0, 0, 1, 0, -leading]); tm = lm; break
      default:
        if (textShow.has(fn)) {
          if (fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) { lm = mul(lm, [1, 0, 0, 1, 0, -leading]); tm = lm }
          const m = mul(g.ctm, tm)
          const [x, y] = apply(m, 0, 0)
          if (out.runs.length < 20_000) out.runs.push({ page: pageNumber, x, y, font, size: Math.abs(size * Math.hypot(m[2], m[3])) || size, color: g.fill })
        } else if (imageOps.has(fn)) {
          const rect = boxThrough(g.ctm, 0, 0, 1, 1)
          if (out.images.length >= limits.maxImages) { out.skippedImages.push({ rect, why: 'over the images read per page' }); break }
          try {
            const img = fn === OPS.paintInlineImageXObject ? a?.[0] : await objectOf(page, String(a?.[0] ?? ''))
            if (!img?.width || !img?.height || !img?.data) { out.skippedImages.push({ rect, why: 'not decodable' }); break }
            if (img.width * img.height > limits.maxPixels) { out.skippedImages.push({ rect, why: 'too large to read' }); break }
            const px = pixelsOf(img)
            if (!px) { out.skippedImages.push({ rect, why: 'an unsupported image format' }); break }
            const hash = createHash('sha256').update(px.data).digest('hex')
            const stats = imageStats(px.data, img.width, img.height, px.channels)
            let png: Buffer | null = null
            let size = { width: img.width, height: img.height }
            for (const f of [1, 0.75, 0.5, 0.35, 0.25]) {
              const side = Math.max(48, Math.round(limits.maxSide * f))
              if (f < 1 && side >= Math.max(img.width, img.height)) continue
              const small = downscalePixels(px.data, img.width, img.height, px.channels, side)
              const bytes = await encodePng(small.data, small.width, small.height, px.channels)
              size = { width: small.width, height: small.height }
              if (bytes.length <= limits.maxBytes) { png = bytes; break }
            }
            out.images.push({ page: pageNumber, rect, width: size.width, height: size.height, hash, png, luminance: stats.luminance, contrast: stats.contrast, ...(stats.brand ? { brand: stats.brand } : {}) })
          } catch {
            out.skippedImages.push({ rect, why: 'not decodable' })
          }
        } else if (maskOps.has(fn)) {
          // Masks (one-colour stencils, often a logo's shape): not decoded; a filled area in the mask's colour.
          const rect = boxThrough(g.ctm, 0, 0, 1, 1)
          if ((rect[2] - rect[0]) * (rect[3] - rect[1]) > 16) out.skippedImages.push({ rect, why: 'an image mask (a stencil, not a picture)' })
        }
    }
  }
  for (const id of fontIds) {
    try {
      const f = (id.startsWith('g_') ? page.commonObjs : page.objs).get(id)
      const name = cleanFontName(f?.name ?? f?.loadedName ?? '')
      out.fonts[id] = { name, bold: Boolean(f?.bold || f?.black) || /bold|black|heavy|semibold|demi/i.test(name), italic: Boolean(f?.italic) || /italic|oblique/i.test(name) }
    } catch { /* not resolved: unknown font */ }
  }
  return out
}

function objectOf(page: any, key: string): Promise<any> {
  if (!key) return Promise.resolve(null)
  const objs = key.startsWith('g_') ? page.commonObjs : page.objs
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 2000)
    try { objs.get(key, (v: unknown) => { clearTimeout(timer); resolve(v) }) } catch { clearTimeout(timer); resolve(null) }
  })
}

/** Read every page's graphics (bounded by the deadline and an import-wide image budget). */
export async function readGraphics(doc: PdfDoc, opts: { pages: number; deadline: number; maxImages: number; maxSide: number; maxBytes: number }): Promise<PageGraphics[]> {
  const out: PageGraphics[] = []
  // The budget counts distinct pictures: a logo on every page is one.
  const seen = new Set<string>()
  for (let p = 1; p <= Math.min(opts.pages, doc.numPages); p++) {
    if (Date.now() > opts.deadline) break
    const page = await doc.getPage(p)
    const left = Math.max(1, opts.maxImages - seen.size)
    const g = await readPageGraphics(page, p, { maxImages: Math.min(GRAPHICS_LIMITS.maxImages, left), maxSide: opts.maxSide, maxBytes: opts.maxBytes, maxPixels: GRAPHICS_LIMITS.maxPixels, maxOps: GRAPHICS_LIMITS.maxOps, deadline: opts.deadline })
    for (const i of g.images) seen.add(i.hash)
    out.push(g)
  }
  return out
}
