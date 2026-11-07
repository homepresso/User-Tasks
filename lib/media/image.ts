/**
 * Image pixels in pure JavaScript (server; works on Vercel): decode PNG
 * (pngjs) and JPEG (jpeg-js), apply the JPEG EXIF orientation, redact
 * regions (blur, pixelate, solid box), resize, and encode PNG / JPEG.
 *
 * Re-encoding drops every metadata block (EXIF GPS position, camera serial,
 * thumbnails that would still show the original), which is what a redacted
 * copy needs. Other formats (WebP, GIF, BMP, HEIC, TIFF) are converted with
 * FFmpeg first when it is available (lib/media/ffmpeg.ts).
 */

import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'
import type { Box } from './types'
import { MediaLimitError } from './types'
import { MEDIA_LIMITS } from './limits'
import { toPixels, type PixelBox } from './geometry'

export interface RgbaImage { width: number; height: number; data: Uint8Array }

export type ImageKind = 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp' | 'tiff' | 'heic' | 'unknown'

/** Image type from the first bytes. */
export function sniffImage(bytes: Uint8Array): ImageKind {
  const b = bytes
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif'
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp'
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a))) return 'tiff'
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && /^(heic|heix|mif1|msf1|avif)$/.test(String.fromCharCode(b[8], b[9], b[10], b[11]))) return 'heic'
  return 'unknown'
}

export const IMAGE_MIME: Record<'png' | 'jpeg', string> = { png: 'image/png', jpeg: 'image/jpeg' }

/** Width / height from the header without decoding (PNG, JPEG), else null. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const kind = sniffImage(bytes)
  if (kind === 'png' && bytes.length >= 24) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { width: dv.getUint32(16), height: dv.getUint32(20) }
  }
  if (kind === 'jpeg') {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue }
      const marker = bytes[i + 1]
      const len = (bytes[i + 2] << 8) | bytes[i + 3]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] }
      }
      i += 2 + len
    }
  }
  return null
}

/** EXIF orientation (1–8) of a JPEG, 1 when absent. */
export function jpegOrientation(bytes: Uint8Array): number {
  let i = 2
  while (i + 4 < bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1]
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    if (marker === 0xe1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) {
      const tiff = i + 10
      if (tiff + 8 > bytes.length) return 1
      const little = bytes[tiff] === 0x49
      const u16 = (o: number) => (little ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1])
      const u32 = (o: number) => (little ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0 : ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0)
      const ifd = tiff + u32(tiff + 4)
      if (ifd + 2 > bytes.length) return 1
      const count = u16(ifd)
      for (let k = 0; k < count; k++) {
        const entry = ifd + 2 + k * 12
        if (entry + 12 > bytes.length) break
        if (u16(entry) === 0x0112) {
          const value = u16(entry + 8)
          return value >= 1 && value <= 8 ? value : 1
        }
      }
      return 1
    }
    if (marker === 0xda) break
    i += 2 + len
  }
  return 1
}

/** Rotate / flip pixels so EXIF orientation 1 is upright. */
export function applyOrientation(img: RgbaImage, orientation: number): RgbaImage {
  if (orientation <= 1 || orientation > 8) return img
  const swap = orientation >= 5
  const W = swap ? img.height : img.width
  const H = swap ? img.width : img.height
  const out = new Uint8Array(W * H * 4)
  const w = img.width
  const h = img.height
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number
      let ny: number
      switch (orientation) {
        case 2: nx = w - 1 - x; ny = y; break
        case 3: nx = w - 1 - x; ny = h - 1 - y; break
        case 4: nx = x; ny = h - 1 - y; break
        case 5: nx = y; ny = x; break
        case 6: nx = h - 1 - y; ny = x; break
        case 7: nx = h - 1 - y; ny = w - 1 - x; break
        default: nx = y; ny = w - 1 - x; break // 8
      }
      const src = (y * w + x) * 4
      const dst = (ny * W + nx) * 4
      out[dst] = img.data[src]
      out[dst + 1] = img.data[src + 1]
      out[dst + 2] = img.data[src + 2]
      out[dst + 3] = img.data[src + 3]
    }
  }
  return { width: W, height: H, data: out }
}

/** PNG / JPEG → RGBA (upright), within the pixel limit. */
export function decodeImage(bytes: Uint8Array, maxPixels = MEDIA_LIMITS.maxImagePixels): RgbaImage & { kind: 'png' | 'jpeg' } {
  const kind = sniffImage(bytes)
  const size = imageSize(bytes)
  if (size && size.width * size.height > maxPixels) {
    throw new MediaLimitError(`The image is ${size.width}×${size.height} (${(size.width * size.height / 1e6).toFixed(1)} MP); at most ${Math.round(maxPixels / 1e6)} MP (MEDIA_MAX_IMAGE_MEGAPIXELS)`)
  }
  if (kind === 'png') {
    const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    return { kind, width: png.width, height: png.height, data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength) }
  }
  if (kind === 'jpeg') {
    const raw = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: Math.ceil(maxPixels / 1e6), maxMemoryUsageInMB: 1024 })
    const upright = applyOrientation({ width: raw.width, height: raw.height, data: raw.data as Uint8Array }, jpegOrientation(bytes))
    return { kind, ...upright }
  }
  throw new MediaLimitError(`This image format (${kind === 'unknown' ? 'not recognised' : kind.toUpperCase()}) is read as PNG or JPEG only${kind === 'unknown' ? '' : ' — convert it first (Media Utilities → Convert needs FFmpeg)'}`)
}

export function encodeImage(img: RgbaImage, format: 'png' | 'jpeg', quality = 90): Uint8Array {
  if (format === 'png') {
    const png = new PNG({ width: img.width, height: img.height })
    png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength)
    return new Uint8Array(PNG.sync.write(png))
  }
  const out = jpeg.encode({ width: img.width, height: img.height, data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength) }, quality)
  return new Uint8Array(out.data)
}

/** Bilinear resize (used to fit provider size limits). */
export function resizeImage(img: RgbaImage, width: number, height: number): RgbaImage {
  const W = Math.max(1, Math.round(width))
  const H = Math.max(1, Math.round(height))
  const out = new Uint8Array(W * H * 4)
  const sx = img.width / W
  const sy = img.height / H
  for (let y = 0; y < H; y++) {
    const fy = Math.min(img.height - 1, (y + 0.5) * sy - 0.5)
    const y0 = Math.max(0, Math.floor(fy))
    const y1 = Math.min(img.height - 1, y0 + 1)
    const wy = Math.max(0, fy - y0)
    for (let x = 0; x < W; x++) {
      const fx = Math.min(img.width - 1, (x + 0.5) * sx - 0.5)
      const x0 = Math.max(0, Math.floor(fx))
      const x1 = Math.min(img.width - 1, x0 + 1)
      const wx = Math.max(0, fx - x0)
      for (let c = 0; c < 4; c++) {
        const a = img.data[(y0 * img.width + x0) * 4 + c]
        const b = img.data[(y0 * img.width + x1) * 4 + c]
        const d = img.data[(y1 * img.width + x0) * 4 + c]
        const e = img.data[(y1 * img.width + x1) * 4 + c]
        out[(y * W + x) * 4 + c] = Math.round((a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy)
      }
    }
  }
  return { width: W, height: H, data: out }
}

/**
 * An upright JPEG / PNG of at most `maxBytes` (and `maxSide` px) for a
 * provider: the same pixels the redaction works on, so returned boxes line up.
 */
export function imageForProvider(img: RgbaImage, options: { maxBytes?: number; maxSide?: number; format?: 'jpeg' | 'png' } = {}): { bytes: Uint8Array; mime_type: string; scale: number } {
  const format = options.format ?? 'jpeg'
  let current = img
  let scale = 1
  const maxSide = options.maxSide ?? 4096
  if (Math.max(img.width, img.height) > maxSide) {
    scale = maxSide / Math.max(img.width, img.height)
    current = resizeImage(img, img.width * scale, img.height * scale)
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const bytes = encodeImage(current, format, 88)
    if (!options.maxBytes || bytes.byteLength <= options.maxBytes) return { bytes, mime_type: IMAGE_MIME[format], scale }
    scale *= 0.7
    current = resizeImage(img, Math.max(16, img.width * scale), Math.max(16, img.height * scale))
  }
  throw new MediaLimitError('The image could not be made small enough for the provider')
}

/* ── Redaction ─────────────────────────────────────────────────────── */

export type ImageRedactStyle = 'blur' | 'pixelate' | 'box'

/** "#1a2b3c" / "1a2b3c" / "black" → [r, g, b]. */
export function parseColor(value: unknown): [number, number, number] {
  const s = String(value ?? '').trim().toLowerCase()
  const named: Record<string, string> = { black: '000000', white: 'ffffff', gray: '808080', grey: '808080' }
  const hex = named[s] ?? s.replace(/^#/, '')
  if (/^[0-9a-f]{6}$/.test(hex)) return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
  if (/^[0-9a-f]{3}$/.test(hex)) return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)]
  return [0, 0, 0]
}

function fill(img: RgbaImage, r: PixelBox, rgb: [number, number, number]) {
  for (let y = r.top; y < r.top + r.height; y++) {
    for (let x = r.left; x < r.left + r.width; x++) {
      const i = (y * img.width + x) * 4
      img.data[i] = rgb[0]
      img.data[i + 1] = rgb[1]
      img.data[i + 2] = rgb[2]
      img.data[i + 3] = 255
    }
  }
}

function pixelate(img: RgbaImage, r: PixelBox, block: number) {
  for (let by = r.top; by < r.top + r.height; by += block) {
    for (let bx = r.left; bx < r.left + r.width; bx += block) {
      const ey = Math.min(r.top + r.height, by + block)
      const ex = Math.min(r.left + r.width, bx + block)
      let sr = 0, sg = 0, sb = 0, n = 0
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const i = (y * img.width + x) * 4; sr += img.data[i]; sg += img.data[i + 1]; sb += img.data[i + 2]; n++ }
      if (!n) continue
      const cr = Math.round(sr / n), cg = Math.round(sg / n), cb = Math.round(sb / n)
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const i = (y * img.width + x) * 4; img.data[i] = cr; img.data[i + 1] = cg; img.data[i + 2] = cb; img.data[i + 3] = 255 }
    }
  }
}

/** Separable box blur of the region (3 passes ≈ Gaussian), reading only inside the region. */
function blur(img: RgbaImage, r: PixelBox, radius: number) {
  const w = r.width
  const h = r.height
  if (w < 2 || h < 2) return
  const buf = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((r.top + y) * img.width + (r.left + x)) * 4
    const j = (y * w + x) * 3
    buf[j] = img.data[i]; buf[j + 1] = img.data[i + 1]; buf[j + 2] = img.data[i + 2]
  }
  const tmp = new Float32Array(buf.length)
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const len = horizontal ? w : h
    const lines = horizontal ? h : w
    const rad = Math.max(1, Math.min(radius, len - 1))
    for (let line = 0; line < lines; line++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0
        const at = (k: number) => {
          const kk = Math.max(0, Math.min(len - 1, k))
          return src[(horizontal ? line * w + kk : kk * w + line) * 3 + c]
        }
        for (let k = -rad; k <= rad; k++) sum += at(k)
        for (let k = 0; k < len; k++) {
          dst[(horizontal ? line * w + k : k * w + line) * 3 + c] = sum / (2 * rad + 1)
          sum += at(k + rad + 1) - at(k - rad)
        }
      }
    }
  }
  for (let p = 0; p < 3; p++) { pass(buf, tmp, true); pass(tmp, buf, false) }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((r.top + y) * img.width + (r.left + x)) * 4
    const j = (y * w + x) * 3
    img.data[i] = Math.round(buf[j]); img.data[i + 1] = Math.round(buf[j + 1]); img.data[i + 2] = Math.round(buf[j + 2]); img.data[i + 3] = 255
  }
}

/**
 * Hide every box in place. Blur is strong (radius ≈ a third of the box's
 * short side, at least 8 px) and is applied after a coarse pixelation, so
 * the original cannot be recovered by sharpening; pixelate uses about 10
 * blocks across the short side.
 */
export function redactRegions(img: RgbaImage, boxes: Box[], style: ImageRedactStyle, color: [number, number, number] = [0, 0, 0]): PixelBox[] {
  const done: PixelBox[] = []
  for (const box of boxes) {
    const r = toPixels(box, img.width, img.height)
    if (r.width < 1 || r.height < 1) continue
    const short = Math.min(r.width, r.height)
    if (style === 'box') fill(img, r, color)
    else if (style === 'pixelate') pixelate(img, r, Math.max(4, Math.round(short / 10)))
    else {
      pixelate(img, r, Math.max(3, Math.round(short / 16)))
      blur(img, r, Math.max(8, Math.round(short / 3)))
    }
    done.push(r)
  }
  return done
}
