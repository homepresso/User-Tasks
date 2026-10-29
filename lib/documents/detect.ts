/**
 * File type detection from content (magic bytes, container parts, text
 * sniffing), falling back to the extension. The name and MIME type a file
 * claims are never trusted on their own.
 */

import { isZip, openZip, ZipLimitError } from './zip'

export type DocumentFormat =
  | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'odt' | 'ods' | 'odp'
  | 'csv' | 'tsv' | 'markdown' | 'html' | 'text' | 'json' | 'xml' | 'yaml' | 'rtf'
  | 'xls' | 'doc' | 'ppt' | 'zip' | 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'tiff' | 'unknown'

export interface DetectedType {
  format: DocumentFormat
  mime_type: string
  extension: string
  label: string
  /** How it was recognised. */
  detected_by: 'content' | 'extension'
  is_text: boolean
  /** The name's extension disagrees with the content. */
  extension_mismatch: boolean
}

const OOXML = 'application/vnd.openxmlformats-officedocument'
const INFO: Record<DocumentFormat, { mime: string; ext: string; label: string; text: boolean }> = {
  pdf: { mime: 'application/pdf', ext: 'pdf', label: 'PDF document', text: false },
  docx: { mime: `${OOXML}.wordprocessingml.document`, ext: 'docx', label: 'Word document', text: false },
  xlsx: { mime: `${OOXML}.spreadsheetml.sheet`, ext: 'xlsx', label: 'Excel workbook', text: false },
  pptx: { mime: `${OOXML}.presentationml.presentation`, ext: 'pptx', label: 'PowerPoint presentation', text: false },
  odt: { mime: 'application/vnd.oasis.opendocument.text', ext: 'odt', label: 'OpenDocument text', text: false },
  ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet', ext: 'ods', label: 'OpenDocument spreadsheet', text: false },
  odp: { mime: 'application/vnd.oasis.opendocument.presentation', ext: 'odp', label: 'OpenDocument presentation', text: false },
  csv: { mime: 'text/csv', ext: 'csv', label: 'CSV', text: true },
  tsv: { mime: 'text/tab-separated-values', ext: 'tsv', label: 'TSV', text: true },
  markdown: { mime: 'text/markdown', ext: 'md', label: 'Markdown', text: true },
  html: { mime: 'text/html', ext: 'html', label: 'HTML', text: true },
  text: { mime: 'text/plain', ext: 'txt', label: 'Plain text', text: true },
  json: { mime: 'application/json', ext: 'json', label: 'JSON', text: true },
  xml: { mime: 'application/xml', ext: 'xml', label: 'XML', text: true },
  yaml: { mime: 'application/yaml', ext: 'yaml', label: 'YAML', text: true },
  rtf: { mime: 'application/rtf', ext: 'rtf', label: 'Rich Text', text: true },
  xls: { mime: 'application/vnd.ms-excel', ext: 'xls', label: 'Excel 97-2003 workbook', text: false },
  doc: { mime: 'application/msword', ext: 'doc', label: 'Word 97-2003 document', text: false },
  ppt: { mime: 'application/vnd.ms-powerpoint', ext: 'ppt', label: 'PowerPoint 97-2003 presentation', text: false },
  zip: { mime: 'application/zip', ext: 'zip', label: 'ZIP archive', text: false },
  png: { mime: 'image/png', ext: 'png', label: 'PNG image', text: false },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG image', text: false },
  gif: { mime: 'image/gif', ext: 'gif', label: 'GIF image', text: false },
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP image', text: false },
  bmp: { mime: 'image/bmp', ext: 'bmp', label: 'BMP image', text: false },
  tiff: { mime: 'image/tiff', ext: 'tiff', label: 'TIFF image', text: false },
  unknown: { mime: 'application/octet-stream', ext: 'bin', label: 'Unknown', text: false },
}

const EXT_FORMATS: Record<string, DocumentFormat> = {
  pdf: 'pdf', docx: 'docx', docm: 'docx', dotx: 'docx', xlsx: 'xlsx', xlsm: 'xlsx', xltx: 'xlsx', pptx: 'pptx', pptm: 'pptx', potx: 'pptx',
  odt: 'odt', ods: 'ods', odp: 'odp', csv: 'csv', tsv: 'tsv', tab: 'tsv', md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  html: 'html', htm: 'html', xhtml: 'html', txt: 'text', text: 'text', log: 'text', json: 'json', geojson: 'json', xml: 'xml', svg: 'xml',
  yaml: 'yaml', yml: 'yaml', rtf: 'rtf', xls: 'xls', doc: 'doc', ppt: 'ppt', zip: 'zip', png: 'png', jpg: 'jpeg', jpeg: 'jpeg',
  gif: 'gif', webp: 'webp', bmp: 'bmp', tif: 'tiff', tiff: 'tiff',
}

export function extensionOf(name: string | null | undefined): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(name ?? '').split(/[?#]/)[0])
  return m ? m[1].toLowerCase() : ''
}

export function formatInfo(format: DocumentFormat) {
  return INFO[format]
}

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v)

function zipFormat(bytes: Uint8Array): DocumentFormat {
  try {
    const zip = openZip(bytes)
    if (zip.has('word/document.xml')) return 'docx'
    if (zip.has('xl/workbook.xml')) return 'xlsx'
    if (zip.has('ppt/presentation.xml')) return 'pptx'
    const mimetype = zip.entries.get('mimetype')
    if (mimetype && mimetype.uncompressedSize < 200) {
      const m = zip.readText('mimetype')?.trim() ?? ''
      if (m.endsWith('opendocument.text')) return 'odt'
      if (m.endsWith('opendocument.spreadsheet')) return 'ods'
      if (m.endsWith('opendocument.presentation')) return 'odp'
    }
  } catch (e) {
    // A zip bomb is reported as such; anything else is just not an Office file.
    if (e instanceof ZipLimitError) throw e
  }
  return 'zip'
}

/** Is this UTF-8 (or UTF-16 with BOM) text? Returns the decoded text, or null for binary. */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  const sample = bytes.subarray(0, 65536)
  let control = 0
  for (const b of sample) {
    if (b === 0) return null
    if (b < 9 || (b > 13 && b < 32)) control++
  }
  if (sample.length && control / sample.length > 0.02) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // Legacy single-byte text (Windows-1252).
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

function sniffText(text: string, ext: string): DocumentFormat {
  const head = text.slice(0, 4000).replace(/^﻿/, '').trimStart()
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return 'markdown'
  if (ext === 'yaml' || ext === 'yml') return 'yaml'
  if (ext === 'csv') return 'csv'
  if (ext === 'tsv' || ext === 'tab') return 'tsv'
  if (head.startsWith('{\\rtf')) return 'rtf'
  if (head.startsWith('{') || head.startsWith('[')) {
    try { JSON.parse(text); return 'json' } catch { /* not JSON */ }
  }
  if (/^<!doctype html|^<html[\s>]/i.test(head) || (/<(body|div|p|table|h[1-6])[\s>]/i.test(head) && ext !== 'xml')) return 'html'
  if (head.startsWith('<?xml') || /^<[a-zA-Z_][\w:.-]*[\s>]/.test(head)) return ext === 'html' || ext === 'htm' ? 'html' : 'xml'
  if (ext === 'json') return 'json'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (/^---\r?\n[\s\S]*?\r?\n---/.test(head) || /^#{1,6} \S/m.test(head) && /(^|\n)(\s*[-*] |\s*\d+\. |```|\[[^\]]+\]\()/.test(head)) return 'markdown'
  // Delimited data: consistent delimiter counts over the first lines.
  const lines = head.split(/\r?\n/).filter(Boolean).slice(0, 8)
  if (lines.length >= 2) {
    for (const [d, f] of [[',', 'csv'], ['\t', 'tsv'], [';', 'csv']] as const) {
      const counts = lines.map((l) => l.split(d).length - 1)
      if (counts[0] >= 1 && counts.every((c) => c === counts[0])) return f
    }
  }
  return 'text'
}

export function detectType(bytes: Uint8Array, name?: string | null): DetectedType {
  const ext = extensionOf(name)
  let format: DocumentFormat = 'unknown'
  let by: DetectedType['detected_by'] = 'content'
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46])) format = 'pdf'
  else if (isZip(bytes)) format = zipFormat(bytes)
  else if (starts(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) format = ext === 'doc' ? 'doc' : ext === 'ppt' ? 'ppt' : 'xls'
  else if (starts(bytes, [0x89, 0x50, 0x4e, 0x47])) format = 'png'
  else if (starts(bytes, [0xff, 0xd8, 0xff])) format = 'jpeg'
  else if (starts(bytes, [0x47, 0x49, 0x46, 0x38])) format = 'gif'
  else if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) format = 'webp'
  else if (starts(bytes, [0x42, 0x4d])) format = 'bmp'
  else if (starts(bytes, [0x49, 0x49, 0x2a, 0x00]) || starts(bytes, [0x4d, 0x4d, 0x00, 0x2a])) format = 'tiff'
  else {
    const text = decodeText(bytes)
    if (text !== null) format = sniffText(text, ext)
    else if (EXT_FORMATS[ext]) { format = EXT_FORMATS[ext]; by = 'extension' }
  }
  const info = INFO[format]
  const claimed = EXT_FORMATS[ext]
  const mismatch = Boolean(ext && claimed && claimed !== format && !(INFO[claimed].text && info.text) && format !== 'unknown')
  return { format, mime_type: info.mime, extension: info.ext, label: info.label, detected_by: by, is_text: info.text, extension_mismatch: mismatch }
}
