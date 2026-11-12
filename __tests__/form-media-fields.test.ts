/**
 * Media fields (lib/forms/media-fields.ts, lib/forms/image-metadata.ts):
 *  - Image: config normalization, upload limits / types, value shape and
 *    validation, the default picture, display formatting;
 *  - metadata stripping: JPEG EXIF (GPS) / XMP / COM, PNG eXIf / text
 *    chunks, WebP EXIF / XMP (orientation kept);
 *  - Display image: src validation, alt text (accessibility finding + fix);
 *  - Signature: value shape, required, server-set metadata (browser user /
 *    IP ignored, capture_audit on / off, signed_at plausibility, a draft's
 *    stamp kept), read-only display.
 */
import { describe, expect, it } from 'vitest'
import {
  describeSignature, displayImageSrcProblem, imageUploadConfig, imageValueError, normalizeDisplayImageConfig, normalizeImageConfig, normalizeImageValue,
  normalizeSignatureValue, signatureValueError, stampSignature, SIGNATURE_UPLOAD_CONFIG,
} from '@/lib/forms/media-fields'
import { exifOrientation, stripImageMetadata, stripJpegMetadata, stripPngMetadata, stripWebpMetadata } from '@/lib/forms/image-metadata'
import { verifyAttachmentContent } from '@/lib/forms/attachment-sniff'
import { defaultTaskFieldValues, fieldDefinitionProblems, isDisplayField, normalizeTaskFields, uploadConfigFor, validateTaskFieldValues, valueFields, coerceTaskFieldValues } from '@/lib/task-field-schema'
import { checkFormAccessibility, applyAccessibilityFix } from '@/lib/forms/accessibility'
import { formatFieldValue } from '@/components/forms/form-renderer'
import { displayValue } from '@/lib/assistants/task-form'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const file = (over: Record<string, unknown> = {}) => ({
  id: u(1), name: 'photo.jpg', size: 2048, mime_type: 'image/jpeg', url: `/attachments/${u(1)}`, storage_ref: 'storage://form-files/t/x/photo.jpg',
  uploaded_by: u(9), uploaded_at: '2026-11-11T01:00:00.000Z', checksum_sha256: 'a'.repeat(64), ...over,
})
const png = (over: Record<string, unknown> = {}) => file({ id: u(2), name: 'signature.png', mime_type: 'image/png', ...over })

/* ── Tiny image builders ─────────────────────────────────────────────── */

const bytes = (...parts: Array<number[] | Uint8Array | string>) => {
  const arr: number[] = []
  for (const p of parts) {
    if (typeof p === 'string') for (const c of p) arr.push(c.charCodeAt(0))
    else arr.push(...p)
  }
  return new Uint8Array(arr)
}
const be16 = (n: number) => [n >> 8, n & 0xff]
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
const segment = (marker: number, payload: Uint8Array) => bytes([0xff, marker], be16(payload.length + 2), payload)

/** An APP1 EXIF payload: IFD0 with Orientation + a GPS IFD pointer; the GPS IFD with a latitude ref "S". */
function exifPayload(orientation: number): Uint8Array {
  // TIFF (big-endian): header 8, IFD0 at 8 with 2 entries (2 + 24 + 4 = 30) → GPS IFD at 38.
  const ifd0 = bytes(be16(2),
    be16(0x0112), be16(3), be32(1), be16(orientation), [0, 0],
    be16(0x8825), be16(4), be32(1), be32(38),
    be32(0))
  const gps = bytes(be16(1), be16(0x0001), be16(2), be32(2), 'S', [0, 0, 0], be32(0))
  return bytes('Exif', [0, 0], 'MM', [0, 0x2a], be32(8), ifd0, gps, 'GPSLatitude=-41.29')
}

function jpegWithExif(orientation = 6): Uint8Array {
  return bytes([0xff, 0xd8],
    segment(0xe0, bytes('JFIF', [0, 1, 1, 0, 0, 1, 0, 1, 0, 0])),
    segment(0xe1, exifPayload(orientation)),
    segment(0xe1, bytes('http://ns.adobe.com/xap/1.0/', [0], '<x:xmpmeta>gps</x:xmpmeta>')),
    segment(0xfe, bytes('Taken at 1 Main St')),
    segment(0xdb, bytes([0], new Array(64).fill(1))),
    segment(0xda, bytes([1, 1, 0, 0, 0x3f, 0])), [0x12, 0x34, 0x56], [0xff, 0xd9])
}

function pngChunk(type: string, data: Uint8Array) {
  return bytes(be32(data.length), type, data, [0, 0, 0, 0])
}
function pngWithText(): Uint8Array {
  return bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk('IHDR', bytes(be32(1), be32(1), [8, 6, 0, 0, 0])),
    pngChunk('tEXt', bytes('Location', [0], 'Wellington')),
    pngChunk('eXIf', exifPayload(1).subarray(6)),
    pngChunk('iTXt', bytes('XML:com.adobe.xmp', [0, 0, 0, 0, 0], '<gps/>')),
    pngChunk('IDAT', bytes([1, 2, 3])),
    pngChunk('IEND', new Uint8Array(0)))
}

function webpChunk(fourcc: string, data: Uint8Array) {
  return bytes(fourcc, le32(data.length), data, data.length % 2 ? [0] : [])
}
function webpWithExif(): Uint8Array {
  const body = bytes('WEBP',
    webpChunk('VP8X', bytes([0x08 | 0x04 | 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
    webpChunk('VP8 ', bytes([1, 2, 3, 4])),
    webpChunk('EXIF', exifPayload(1).subarray(6)),
    webpChunk('XMP ', bytes('<gps/>')))
  return bytes('RIFF', le32(body.length), body)
}

const ascii = (b: Uint8Array) => Buffer.from(b).toString('latin1')

/* ── Image ───────────────────────────────────────────────────────────── */

describe('image field', () => {
  it('normalizes its config: size capped at 20 MB, formats, camera, a default picture', () => {
    expect(normalizeImageConfig({ max_mb: 50, camera: true, types: ['jpg', 'png', 'svg'] })).toEqual({ max_mb: 20, camera: true, types: ['png', 'jpeg'] })
    expect(normalizeImageConfig({ types: ['png', 'jpeg', 'webp', 'gif'] })).toEqual({})
    expect(normalizeImageConfig({ max_mb: 'x', camera: 'yes' })).toEqual({})
    const [field] = normalizeTaskFields([{ key: 'photo', label: 'Photo', type: 'image', required: true, placeholder: 'x', default: { name: 'logo.png', url: 'storage://task-files/form-images/t/a.png' }, image: { max_mb: 5 } }])
    expect(field).toEqual({ key: 'photo', label: 'Photo', type: 'image', required: true, image: { max_mb: 5, default_file: { name: 'logo.png', url: 'storage://task-files/form-images/t/a.png', mime_type: 'image/png' } } })
    // A default that isn't a stored / https picture is dropped.
    expect(normalizeTaskFields([{ key: 'p', label: 'P', type: 'image', default: { name: 'x.png', url: 'javascript:alert(1)' } }])[0].image).toBeUndefined()
    expect(valueFields(normalizeTaskFields([{ key: 'p', label: 'P', type: 'image' }])).length).toBe(1)
  })

  it('uploads are one picture of the allowed formats within the size (the Attachments pipeline config)', () => {
    expect(imageUploadConfig({ max_mb: 2, types: ['png'] })).toEqual({ max_files: 1, max_file_mb: 2, custom_types: ['.png'] })
    expect(imageUploadConfig(undefined).custom_types).toEqual(['.png', '.jpg', '.jpeg', '.jpe', '.webp', '.gif'])
    expect(uploadConfigFor({ type: 'signature' })).toBe(SIGNATURE_UPLOAD_CONFIG)
    // Content sniffing: a text file renamed .png is refused; an SVG / PDF isn't a picture here.
    const config = imageUploadConfig(undefined)
    expect(verifyAttachmentContent({ name: 'cat.png', bytes: new TextEncoder().encode('just some text'), config })).toMatchObject({ ok: false, reason: /not a valid PNG/ })
    expect(verifyAttachmentContent({ name: 'cat.svg', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), config })).toMatchObject({ ok: false })
    expect(verifyAttachmentContent({ name: 'cat.pdf', bytes: new TextEncoder().encode('%PDF-1.7'), config })).toMatchObject({ ok: false })
    expect(verifyAttachmentContent({ name: 'cat.jpg', bytes: jpegWithExif(), config })).toMatchObject({ ok: true, mime: 'image/jpeg' })
  })

  it('the value is one file object (or null); type and size are checked', () => {
    expect(normalizeImageValue(file())).toMatchObject({ id: u(1), name: 'photo.jpg' })
    expect(normalizeImageValue([file()])).toMatchObject({ id: u(1) })
    expect(normalizeImageValue(null)).toBeNull()
    const field = { label: 'Photo', image: { max_mb: 1, types: ['jpeg' as const] } }
    expect(imageValueError(field, file())).toBeNull()
    expect(imageValueError(field, [file(), file({ id: u(3) })])).toMatch(/one picture/)
    expect(imageValueError(field, file({ size: 2 * 1024 * 1024 }))).toMatch(/larger than 1.0 MB/)
    expect(imageValueError(field, file({ name: 'scan.png', mime_type: 'image/png' }))).toMatch(/JPEG picture/)
    expect(imageValueError(field, file({ name: 'notes.jpg', mime_type: 'text/plain' }))).toMatch(/not a picture/)
  })

  it('validates required (a default picture counts) and coerces to one object', () => {
    const fields = normalizeTaskFields([{ key: 'photo', label: 'Photo', type: 'image', required: true }])
    expect(validateTaskFieldValues(fields, { photo: null })).toEqual({ photo: 'Photo is required' })
    expect(validateTaskFieldValues(fields, { photo: 'not a file' })).toEqual({ photo: 'Photo must be one picture' })
    expect(validateTaskFieldValues(fields, { photo: file() })).toEqual({})
    expect(coerceTaskFieldValues(fields, { photo: [file()] }).photo).toMatchObject({ id: u(1), name: 'photo.jpg' })
    expect(defaultTaskFieldValues(fields)).toEqual({ photo: null })
    const withDefault = normalizeTaskFields([{ key: 'photo', label: 'Photo', type: 'image', required: true, image: { default_file: { name: 'd.png', url: 'https://example.com/d.png' } } }])
    expect(validateTaskFieldValues(withDefault, { photo: null })).toEqual({})
  })

  it('shows the file name in summaries and exports', () => {
    const [field] = normalizeTaskFields([{ key: 'photo', label: 'Photo', type: 'image' }])
    expect(formatFieldValue(field, file())).toBe('photo.jpg')
    expect(formatFieldValue(field, null)).toBe('—')
    expect(displayValue(field, file())).toBe('photo.jpg')
  })
})

/* ── Metadata stripping ──────────────────────────────────────────────── */

describe('image metadata stripping', () => {
  it('JPEG: removes EXIF (GPS), XMP and comments; keeps JFIF, tables and the scan; keeps only the orientation', () => {
    const input = jpegWithExif(6)
    expect(exifOrientation(exifPayload(6))).toBe(6)
    const { bytes: out, removed } = stripJpegMetadata(input)
    expect(removed).toEqual(['APP1 EXIF', 'APP1 XMP', 'COM'])
    const text = ascii(out)
    expect(text).not.toContain('GPSLatitude')
    expect(text).not.toContain('xmpmeta')
    expect(text).not.toContain('1 Main St')
    expect(text).toContain('JFIF')
    // A minimal EXIF with only the Orientation tag (6), right after APP0.
    const app0End = 2 + 2 + 16
    expect([out[app0End], out[app0End + 1]]).toEqual([0xff, 0xe1])
    const len = (out[app0End + 2] << 8) | out[app0End + 3]
    const payload = out.subarray(app0End + 4, app0End + 2 + len)
    expect(exifOrientation(payload)).toBe(6)
    expect(payload.length).toBeLessThan(40)
    // The scan data and EOI are intact.
    expect(Array.from(out.subarray(out.length - 5))).toEqual([0x12, 0x34, 0x56, 0xff, 0xd9])
    expect(out[0]).toBe(0xff); expect(out[1]).toBe(0xd8)
    // Upright pictures get no EXIF at all; clean files come back unchanged.
    expect(ascii(stripJpegMetadata(jpegWithExif(1)).bytes)).not.toContain('Exif')
    expect(stripJpegMetadata(out.subarray(0, 2)).removed).toEqual([])
    const clean = stripJpegMetadata(stripJpegMetadata(jpegWithExif(1)).bytes)
    expect(clean.removed).toEqual([])
  })

  it('PNG: drops eXIf / tEXt / iTXt chunks, keeps the others byte for byte', () => {
    const { bytes: out, removed } = stripPngMetadata(pngWithText())
    expect(removed).toEqual(['tEXt', 'eXIf', 'iTXt'])
    const text = ascii(out)
    expect(text).not.toContain('Wellington')
    expect(text).not.toContain('GPSLatitude')
    expect(text).toContain('IHDR'); expect(text).toContain('IDAT'); expect(text).toContain('IEND')
    expect(verifyAttachmentContent({ name: 'a.png', bytes: out, config: imageUploadConfig(undefined) })).toMatchObject({ ok: true })
  })

  it('WebP: drops EXIF / XMP chunks, clears their VP8X flags, fixes the RIFF size', () => {
    const { bytes: out, removed } = stripWebpMetadata(webpWithExif())
    expect(removed).toEqual(['EXIF', 'XMP'])
    expect(ascii(out)).not.toContain('GPSLatitude')
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
    expect(view.getUint32(4, true)).toBe(out.length - 8)
    expect(out[20] & 0x0c).toBe(0) // VP8X flags (offset 12 + 8)
    expect(out[20] & 0x10).toBe(0x10) // alpha kept
    expect(stripImageMetadata(out, 'gif').removed).toEqual([])
  })
})

/* ── Display image ───────────────────────────────────────────────────── */

describe('display image', () => {
  it('is a display element with a validated source', () => {
    expect(displayImageSrcProblem('https://example.com/logo.png')).toBeNull()
    expect(displayImageSrcProblem('storage://task-files/form-images/t/a.png')).toBeNull()
    expect(displayImageSrcProblem('/files/task-files/form-images/t/a.png')).toBeNull()
    expect(displayImageSrcProblem('data:image/png;base64,iVBORw0KGgo=')).toBeNull()
    expect(displayImageSrcProblem('javascript:alert(1)')).toMatch(/https/)
    expect(displayImageSrcProblem('http://example.com/a.png')).toMatch(/https/)
    expect(displayImageSrcProblem('data:text/html;base64,PGgxPg==')).toMatch(/data: images/)
    expect(displayImageSrcProblem(`data:image/png;base64,${'A'.repeat(800_000)}`)).toMatch(/512 KB/)
    expect(displayImageSrcProblem('')).toMatch(/Choose an image/)
    expect(normalizeDisplayImageConfig({ src: 'javascript:x', alt: ' Logo <b> ', width: 'md', align: 'center' })).toEqual({ src: '', alt: 'Logo b', align: 'center' })
    const fields = normalizeTaskFields([
      { key: 'logo', label: 'Logo', type: 'display_image', required: true, display_image: { src: 'https://example.com/a.png', alt: 'Acme', width: 'sm' } },
      { key: 'broken', label: 'Broken', type: 'display_image', display_image: { src: 'ftp://x' } },
    ])
    expect(fields[0]).toEqual({ key: 'logo', label: 'Logo', type: 'display_image', display_image: { src: 'https://example.com/a.png', alt: 'Acme', width: 'sm' } })
    expect(isDisplayField(fields[0])).toBe(true)
    expect(valueFields(fields)).toEqual([])
    expect(validateTaskFieldValues(fields, { logo: 'x' })).toEqual({})
    expect(fieldDefinitionProblems(fields)).toEqual({ broken: expect.stringMatching(/Choose an image/) })
  })

  it('a picture without alt text is an accessibility finding, fixed by the prompt', () => {
    const def = { fields: normalizeTaskFields([{ key: 'logo', label: 'Logo', type: 'display_image', display_image: { src: 'https://example.com/a.png', alt: '' } }]), theme: { source: 'workspace' }, layout: null, header: null } as any
    const result = checkFormAccessibility(def)
    const finding = result.findings.find((f) => f.id === 'image-alt:logo')
    expect(finding).toMatchObject({ rule: 'image-alt', severity: 'serious', field_key: 'logo', wcag: ['1.1.1'] })
    const fixed = applyAccessibilityFix(def, finding!.fix!, 'Acme Ltd logo')
    expect(fixed.fields[0].display_image).toEqual({ src: 'https://example.com/a.png', alt: 'Acme Ltd logo' })
    expect(checkFormAccessibility(fixed).findings.find((f) => f.id === 'image-alt:logo')).toBeUndefined()
  })
})

/* ── Signature ───────────────────────────────────────────────────────── */

describe('signature field', () => {
  const NOW = new Date('2026-11-11T01:02:00.000Z')
  const sent = (over: Record<string, unknown> = {}) => ({ file: png(), method: 'draw', signed_at: '2026-11-11T01:00:00.000Z', ...over })

  it('normalizes its config and checks the value shape', () => {
    const [field] = normalizeTaskFields([{ key: 'sig', label: 'Signature', type: 'signature', required: true, default: 'x', signature: { mode: 'type', statement: '  I agree  ', capture_audit: true, resign_on_change: 'yes' } }])
    expect(field).toEqual({ key: 'sig', label: 'Signature', type: 'signature', required: true, signature: { mode: 'type', statement: 'I agree', capture_audit: true } })
    expect(signatureValueError(field, sent({ method: 'type', typed_name: 'Ada Lovelace' }))).toBeNull()
    expect(signatureValueError(field, sent())).toMatch(/drawn signatures are not allowed/)
    expect(signatureValueError(field, sent({ method: 'type' }))).toMatch(/type your name/)
    expect(signatureValueError({ label: 'Signature' }, sent({ file: png({ name: 'sig.jpg', mime_type: 'image/jpeg' }) }))).toMatch(/PNG/)
    expect(signatureValueError({ label: 'Signature' }, { method: 'draw' })).toMatch(/invalid signature/)
    expect(signatureValueError({ label: 'Signature' }, 'scribble')).toMatch(/invalid signature/)
    expect(normalizeSignatureValue(sent({ method: 'stamp' }))).toBeNull()
  })

  it('required means a signature is present', () => {
    const fields = normalizeTaskFields([{ key: 'sig', label: 'Signature', type: 'signature', required: true }])
    expect(validateTaskFieldValues(fields, {})).toEqual({ sig: 'Signature: please sign' })
    expect(validateTaskFieldValues(fields, { sig: null })).toEqual({ sig: 'Signature: please sign' })
    expect(validateTaskFieldValues(fields, { sig: sent() })).toEqual({})
    expect(validateTaskFieldValues(fields, { sig: { file: 'x' } })).toEqual({ sig: 'Signature has an invalid signature' })
    expect(coerceTaskFieldValues(fields, { sig: { ...sent(), extra: 'dropped' } }).sig).toEqual(sent())
  })

  it('the server sets who signed, when and (only with capture_audit) from where — never the browser', () => {
    const forged = sent({ user_id: u(66), user_name: 'Mallory', ip: '6.6.6.6', user_agent: 'forged', signed_at: '2020-01-01T00:00:00Z' })
    const off = stampSignature({ signature: {} }, forged, { now: NOW, user: { id: u(9), name: 'Ada Lovelace' }, request: { ip: '203.0.113.7', user_agent: 'Firefox' } })
    expect(off).toEqual({ file: png(), method: 'draw', signed_at: NOW.toISOString(), user_id: u(9), user_name: 'Ada Lovelace' })
    const on = stampSignature({ signature: { capture_audit: true } }, forged, { now: NOW, user: { id: u(9), name: 'Ada Lovelace' }, request: { ip: '203.0.113.7', user_agent: 'Firefox' } })
    expect(on).toMatchObject({ user_id: u(9), ip: '203.0.113.7', user_agent: 'Firefox' })
    // Anonymous visitor: no user recorded (the sent one is dropped).
    const anon = stampSignature({ signature: {} }, forged, { now: NOW, user: null })
    expect(anon).not.toHaveProperty('user_id')
    expect(anon).not.toHaveProperty('ip')
    // A plausible browser time (within the last day) is kept; the future or long ago is not.
    expect(stampSignature({}, sent(), { now: NOW })!.signed_at).toBe('2026-11-11T01:00:00.000Z')
    expect(stampSignature({}, sent({ signed_at: '2026-11-12T00:00:00Z' }), { now: NOW })!.signed_at).toBe(NOW.toISOString())
    expect(stampSignature({}, sent({ signed_at: 'yesterday' }), { now: NOW })!.signed_at).toBe(NOW.toISOString())
    // A saved draft with the same PNG keeps its stamp (not the browser's, not now).
    const previous = { ...sent(), signed_at: '2026-11-10T22:00:00.000Z', user_id: u(9), user_name: 'Ada Lovelace' }
    expect(stampSignature({}, forged, { now: NOW, user: { id: u(41), name: 'Bob' }, previous })).toMatchObject({ signed_at: '2026-11-10T22:00:00.000Z', user_id: u(9), user_name: 'Ada Lovelace' })
  })

  it('reads as "Signed by … on …" once submitted', () => {
    const value = { ...sent(), signed_at: '2026-11-11T14:02:00.000Z', user_id: u(9), user_name: 'Ada Lovelace' }
    expect(describeSignature(value, 'UTC')).toBe('Signed by Ada Lovelace on 11 Nov 2026 14:02')
    expect(describeSignature({ ...sent({ method: 'type', typed_name: 'Ada L' }), signed_at: '2026-11-11T14:02:00.000Z' }, 'Pacific/Auckland')).toBe('Signed by Ada L on 12 Nov 2026 03:02')
    expect(describeSignature(null)).toBe('—')
    const [field] = normalizeTaskFields([{ key: 'sig', label: 'Signature', type: 'signature' }])
    expect(formatFieldValue(field, value)).toMatch(/^Signed by Ada Lovelace on \d{1,2} \w{3} 2026 \d{2}:\d{2}$/)
    expect(displayValue(field, value)).toMatch(/^Signed by Ada Lovelace on /)
  })
})
