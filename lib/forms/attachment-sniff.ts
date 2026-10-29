/**
 * Server-side checks of an uploaded attachment's CONTENT (magic bytes),
 * never just its name or the browser's MIME type:
 *
 *  - executables, scripts and web pages are refused whatever they are
 *    called (MZ / ELF / Mach-O headers, `#!` scripts, HTML in "text");
 *  - a known extension must match its content (a .pdf starts with %PDF,
 *    a .docx is a ZIP with word/ parts and no VBA project, a .png is a PNG,
 *    a .csv is UTF-8 text…);
 *  - an unknown extension (only allowed by "any" or a custom `.ext`) must
 *    not be any of the dangerous contents above.
 *
 * The stored MIME type is the verified kind's, not the browser's.
 * Pure (Uint8Array in), so it is unit-tested without storage.
 */

import { BLOCKED_EXTENSIONS, fileExtension, isTypeAllowed, kindForExtension, type AttachmentsConfig, type FileKind } from './attachments'

export type SniffedContent =
  | 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'tiff' | 'heic' | 'zip' | 'ole' | 'rtf' | 'mp4' | 'mp3' | 'wav'
  | 'executable' | 'script' | 'html' | 'svg' | 'text' | 'binary' | 'empty'

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b)
const ascii = (bytes: Uint8Array, start: number, length: number) => {
  let s = ''
  for (let i = start; i < Math.min(bytes.length, start + length); i++) s += String.fromCharCode(bytes[i])
  return s
}

/** Valid UTF-8 (BOM allowed) without NUL bytes → the decoded text, else null. */
export function decodeText(bytes: Uint8Array, limit = 64 * 1024): string | null {
  const head = bytes.subarray(0, Math.min(bytes.length, limit))
  if (head.includes(0)) return null
  try {
    // Cut at a character boundary: drop up to 3 trailing continuation bytes.
    let end = head.length
    if (bytes.length > limit) {
      let back = 0
      while (back < 4 && end > 0 && (head[end - 1] & 0xc0) === 0x80) { end--; back++ }
      if (end > 0 && head[end - 1] >= 0xc0) end--
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, end)).replace(/^﻿/, '')
  } catch {
    return null
  }
}

const HTML_RE = /<\s*(?:!doctype\s+html|html[\s>]|head[\s>]|body[\s>]|script[\s>]|iframe[\s>]|object[\s>]|embed[\s>]|meta\s+http-equiv)/i

/** What the bytes are, from their signature. */
export function sniffContent(bytes: Uint8Array): SniffedContent {
  if (!bytes || bytes.length === 0) return 'empty'
  // Executables.
  if (startsWith(bytes, [0x4d, 0x5a])) return 'executable' // MZ (PE / DOS)
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return 'executable' // ELF
  if (startsWith(bytes, [0xfe, 0xed, 0xfa, 0xce]) || startsWith(bytes, [0xfe, 0xed, 0xfa, 0xcf])
    || startsWith(bytes, [0xce, 0xfa, 0xed, 0xfe]) || startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe])) return 'executable' // Mach-O
  if (startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe])) return 'executable' // Mach-O fat / Java class
  if (startsWith(bytes, [0x00, 0x61, 0x73, 0x6d])) return 'executable' // WebAssembly
  if (startsWith(bytes, [0x23, 0x21])) return 'script' // #!
  // Documents and images.
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf' // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'gif'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'wav'
  if (ascii(bytes, 0, 2) === 'BM' && bytes.length > 26) return 'bmp'
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff'
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4)
    return /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(brand) ? 'heic' : 'mp4'
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return 'zip'
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole'
  if (ascii(bytes, 0, 5) === '{\\rtf') return 'rtf'
  if (ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'mp3'
  const text = decodeText(bytes)
  if (text !== null) {
    const head = text.slice(0, 4096)
    const trimmed = head.replace(/^\s*(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE\s+svg[^>]*>\s*)?/i, '')
    if (/^<svg[\s>]/i.test(trimmed)) return 'svg'
    if (HTML_RE.test(head)) return 'html'
    return 'text'
  }
  return 'binary'
}

/** Names of the entries of a ZIP (local file headers; bounded). */
export function zipEntryNames(bytes: Uint8Array, max = 2000): string[] {
  const names: string[] = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i + 30 <= bytes.length && names.length < max; i++) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b || bytes[i + 2] !== 0x03 || bytes[i + 3] !== 0x04) continue
    const nameLength = view.getUint16(i + 26, true)
    const extraLength = view.getUint16(i + 28, true)
    if (i + 30 + nameLength > bytes.length) break
    names.push(new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLength)))
    const compressed = view.getUint32(i + 18, true)
    // Skip the entry's data when its size is known (bit 3 unset); else keep scanning.
    const flags = view.getUint16(i + 6, true)
    i += 29 + nameLength + extraLength + ((flags & 0x08) === 0 ? compressed : 0)
  }
  return names
}

function contentMatchesKind(kind: FileKind, sniffed: SniffedContent, bytes: Uint8Array): boolean {
  switch (kind.magic) {
    case 'pdf': case 'png': case 'jpeg': case 'gif': case 'webp': case 'bmp': case 'tiff': case 'heic':
    case 'ole': case 'rtf': case 'mp4': case 'mp3': case 'wav': case 'svg':
      return sniffed === kind.magic
    case 'text':
      return sniffed === 'text'
    case 'zip':
      return sniffed === 'zip'
    case 'ooxml-word': case 'ooxml-sheet': case 'ooxml-slides': {
      if (sniffed !== 'zip') return false
      const names = zipEntryNames(bytes)
      if (!names.includes('[Content_Types].xml')) return false
      // Macro-enabled documents renamed to .docx / .xlsx / .pptx.
      if (names.some((n) => /(^|\/)vbaProject\.bin$/i.test(n))) return false
      const prefix = kind.magic === 'ooxml-word' ? 'word/' : kind.magic === 'ooxml-sheet' ? 'xl/' : 'ppt/'
      return names.some((n) => n.startsWith(prefix))
    }
    case 'odf': {
      if (sniffed !== 'zip') return false
      const mimeEntry = ascii(bytes, 30, 8) === 'mimetype' ? ascii(bytes, 38, 60) : ''
      return mimeEntry.startsWith(kind.mime)
    }
    default:
      return false
  }
}

export type VerifiedUpload =
  | { ok: true; kind: FileKind | null; mime: string; ext: string; sniffed: SniffedContent }
  | { ok: false; reason: string }

/**
 * Verify an upload's content against its name and the field's allowed
 * types. `name` is the sanitised display name.
 */
export function verifyAttachmentContent(input: { name: string; bytes: Uint8Array; config?: AttachmentsConfig }): VerifiedUpload {
  const ext = fileExtension(input.name)
  if (BLOCKED_EXTENSIONS.has(ext)) return { ok: false, reason: `.${ext} files are not allowed` }
  const sniffed = sniffContent(input.bytes)
  if (sniffed === 'empty') return { ok: false, reason: 'The file is empty' }
  if (sniffed === 'executable' || sniffed === 'script') return { ok: false, reason: 'Programs and scripts are not allowed' }
  if (sniffed === 'html') return { ok: false, reason: 'Web pages (HTML) are not allowed' }
  const kind = kindForExtension(ext)
  if (!isTypeAllowed(input.config, ext, kind)) return { ok: false, reason: ext ? `.${ext} files are not allowed here` : 'Files without an extension are not allowed here' }
  if (kind) {
    if (!contentMatchesKind(kind, sniffed, input.bytes)) return { ok: false, reason: `The file's content is not a valid ${kind.label} file` }
    return { ok: true, kind, mime: kind.mime, ext, sniffed }
  }
  // Unknown extension ("any" or a custom .ext): never something a browser would run.
  if (sniffed === 'svg') return { ok: false, reason: 'SVG images must use the .svg extension' }
  return { ok: true, kind: null, mime: 'application/octet-stream', ext, sniffed }
}
