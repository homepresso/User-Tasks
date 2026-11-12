/**
 * Strip metadata from uploaded pictures (Image and Signature fields) before
 * they are stored: camera details, dates, GPS / location, comments, editing
 * history. Pure TypeScript over the bytes (no image decoding, no new
 * dependency); the pixels are never touched.
 *
 *  JPEG  removes APP1 (EXIF — including GPS — and XMP), APP13 (Photoshop /
 *        IPTC) and COM (comments) segments. Keeps APP0 (JFIF), APP2 (ICC
 *        colour profile), APP14 (Adobe colour transform) and the image data.
 *        A picture whose EXIF says it is rotated keeps a minimal EXIF
 *        block holding only the Orientation tag (phones store photos
 *        sideways), so it still shows the right way up.
 *  PNG   removes eXIf (EXIF), tEXt / zTXt / iTXt (text incl. XMP) and tIME
 *        chunks; every other chunk is kept byte for byte (CRCs unchanged).
 *  WebP  removes the EXIF and "XMP " chunks, clears their VP8X flags and
 *        fixes the RIFF size.
 *  GIF   unchanged (GIF has no EXIF / GPS).
 *
 * Bytes that don't parse as the format they claim are returned unchanged
 * (the content sniffing upstream has already refused non-images).
 */

export type StrippableFormat = 'jpeg' | 'png' | 'webp'

export interface StripResult {
  bytes: Uint8Array
  /** What was removed (segment / chunk names), for logs and tests. */
  removed: string[]
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.byteLength }
  return out
}

const ascii = (bytes: Uint8Array, start: number, length: number) => {
  let s = ''
  for (let i = start; i < Math.min(bytes.length, start + length); i++) s += String.fromCharCode(bytes[i])
  return s
}

/* ── JPEG ────────────────────────────────────────────────────────────── */

/** The EXIF Orientation (1–8) in an APP1 payload (after the length), or null. */
export function exifOrientation(payload: Uint8Array): number | null {
  if (ascii(payload, 0, 6) !== 'Exif\0\0') return null
  const tiff = payload.subarray(6)
  if (tiff.length < 8) return null
  const little = tiff[0] === 0x49 && tiff[1] === 0x49
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return null
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const u16 = (o: number) => view.getUint16(o, little)
  const u32 = (o: number) => view.getUint32(o, little)
  const ifd = u32(4)
  if (ifd + 2 > tiff.length) return null
  const count = u16(ifd)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > tiff.length) return null
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8)
      return value >= 1 && value <= 8 ? value : null
    }
  }
  return null
}

/** A minimal APP1 segment holding only the Orientation tag. */
function orientationSegment(orientation: number): Uint8Array {
  const body = [
    ...Array.from('Exif\0\0', (c) => c.charCodeAt(0)),
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF header, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation SHORT ×1
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]
  const length = body.length + 2
  return new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff, ...body])
}

export function stripJpegMetadata(bytes: Uint8Array): StripResult {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { bytes, removed: [] }
  const parts: Uint8Array[] = [bytes.subarray(0, 2)]
  const removed: string[] = []
  let orientation: number | null = null
  let i = 2
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return { bytes, removed: [] } // not a marker: leave the file alone
    // Fill bytes (0xFF padding) before a marker.
    let m = i + 1
    while (m < bytes.length && bytes[m] === 0xff) m++
    if (m >= bytes.length) return { bytes, removed: [] }
    const marker = bytes[m]
    const start = i
    i = m + 1
    // Markers without a length: TEM, RSTn, SOI, EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      parts.push(bytes.subarray(start, i))
      if (marker === 0xd9) { if (i < bytes.length) parts.push(bytes.subarray(i)); break }
      continue
    }
    if (i + 2 > bytes.length) return { bytes, removed: [] }
    const length = (bytes[i] << 8) | bytes[i + 1]
    if (length < 2 || i + length > bytes.length) return { bytes, removed: [] }
    const end = i + length
    if (marker === 0xda) {
      // Start of scan: the rest is image data (and whatever trails it).
      parts.push(bytes.subarray(start))
      i = bytes.length
      break
    }
    const payload = bytes.subarray(i + 2, end)
    if (marker === 0xe1) {
      const kind = ascii(payload, 0, 4) === 'Exif' ? 'APP1 EXIF' : ascii(payload, 0, 4) === 'http' ? 'APP1 XMP' : 'APP1'
      if (kind === 'APP1 EXIF') orientation ??= exifOrientation(payload)
      removed.push(kind)
    } else if (marker === 0xed) {
      removed.push('APP13 IPTC')
    } else if (marker === 0xfe) {
      removed.push('COM')
    } else {
      parts.push(bytes.subarray(start, end))
    }
    i = end
  }
  if (!removed.length) return { bytes, removed }
  // After JFIF's APP0 when there is one (it should follow SOI directly).
  if (orientation && orientation !== 1) parts.splice(parts[1]?.[1] === 0xe0 ? 2 : 1, 0, orientationSegment(orientation))
  return { bytes: concat(parts), removed }
}

/* ── PNG ─────────────────────────────────────────────────────────────── */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'])

export function stripPngMetadata(bytes: Uint8Array): StripResult {
  if (bytes.length < 8 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return { bytes, removed: [] }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const parts: Uint8Array[] = [bytes.subarray(0, 8)]
  const removed: string[] = []
  let i = 8
  while (i + 12 <= bytes.length) {
    const length = view.getUint32(i)
    const type = ascii(bytes, i + 4, 4)
    const end = i + 12 + length
    if (end > bytes.length) return { bytes, removed: [] }
    if (PNG_DROP.has(type)) removed.push(type)
    else parts.push(bytes.subarray(i, end))
    i = end
    if (type === 'IEND') break
  }
  if (i < bytes.length) parts.push(bytes.subarray(i))
  return removed.length ? { bytes: concat(parts), removed } : { bytes, removed }
}

/* ── WebP ────────────────────────────────────────────────────────────── */

export function stripWebpMetadata(bytes: Uint8Array): StripResult {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return { bytes, removed: [] }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const riffEnd = Math.min(bytes.length, 8 + view.getUint32(4, true))
  const chunks: Uint8Array[] = []
  const removed: string[] = []
  let i = 12
  while (i + 8 <= riffEnd) {
    const fourcc = ascii(bytes, i, 4)
    const size = view.getUint32(i + 4, true)
    const end = i + 8 + size + (size % 2)
    if (i + 8 + size > riffEnd) return { bytes, removed: [] }
    if (fourcc === 'EXIF' || fourcc === 'XMP ') removed.push(fourcc.trim())
    else chunks.push(bytes.slice(i, Math.min(end, riffEnd)))
    i = end
  }
  if (!removed.length) return { bytes, removed }
  for (const chunk of chunks) {
    // VP8X flags: clear EXIF (0x08) and XMP (0x04).
    if (ascii(chunk, 0, 4) === 'VP8X' && chunk.length > 8) chunk[8] &= ~0x0c
  }
  const body = concat(chunks)
  const header = new Uint8Array(12)
  header.set([0x52, 0x49, 0x46, 0x46]) // RIFF
  new DataView(header.buffer).setUint32(4, body.byteLength + 4, true)
  header.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
  return { bytes: concat([header, body]), removed }
}

/** Strip a picture's metadata by its (verified) format; other formats come back unchanged. */
export function stripImageMetadata(bytes: Uint8Array, format: string): StripResult {
  if (format === 'jpeg') return stripJpegMetadata(bytes)
  if (format === 'png') return stripPngMetadata(bytes)
  if (format === 'webp') return stripWebpMetadata(bytes)
  return { bytes, removed: [] }
}
