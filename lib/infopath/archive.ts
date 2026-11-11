/**
 * Open what the person uploaded: an .xsn (a CAB archive) or — the fallback —
 * a .zip of the extracted form files (File → Export Source Files /
 * "Save as Source Files" in InfoPath Designer, then zipped). Either way the
 * result is the form's files by name, bounded:
 *
 *   input       INFOPATH_LIMITS.maxInputBytes (INFOPATH_MAX_MB, default 20 MB)
 *   files       at most 1000
 *   unpacked    at most 32 MB a file, 96 MB in all (zip bombs stop at the cap)
 *
 * Only the parts the analyzer reads are kept as text (manifest, views,
 * schemas, template / sample data); images and code are listed by name.
 */

import { createHash } from 'node:crypto'
import { CabError, isCab, readCab } from './cab'
import { isZip, openZip, ZipLimitError } from '@/lib/documents/zip'

const MB = 1024 * 1024

function envMb(name: string, fallback: number, max: number): number {
  const raw = typeof process !== 'undefined' ? process.env?.[name] : undefined
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback
}

export const INFOPATH_LIMITS = {
  /** Largest upload (INFOPATH_MAX_MB, default 20 MB). Hosted (serverless) uploads are capped lower by the request body limit: see INFOPATH_UPLOAD_MAX_BYTES. */
  get maxInputBytes() { return envMb('INFOPATH_MAX_MB', 20, 100) * MB },
  maxFiles: 1000,
  maxFileBytes: 32 * MB,
  maxTotalBytes: 96 * MB,
  /** Text parts read (manifest, views, schemas, template). */
  maxTextBytes: 24 * MB,
  /** Views converted. */
  maxViews: 40,
} as const

/** A browser upload straight to the app: serverless platforms cap request bodies at ~4.5 MB. */
export const INFOPATH_UPLOAD_MAX_BYTES = 4 * MB

export class InfoPathFileError extends Error {
  constructor(message: string, readonly code: 'not_infopath' | 'lzx' | 'limit' | 'corrupt' | 'unsupported' = 'corrupt') {
    super(message)
    this.name = 'InfoPathFileError'
  }
}

export interface InfoPathPackage {
  format: 'xsn' | 'zip'
  hash: string
  /** Lower-cased file name → bytes. */
  files: Map<string, Buffer>
  /** Names as stored. */
  names: string[]
}

const TEXT_EXT = /\.(xsf|xsl|xslt|xsd|xml)$/i

export interface PackageLimits { maxInputBytes?: number; maxFiles?: number; maxTotalBytes?: number }

export function openInfoPathPackage(bytes: Uint8Array, limits: PackageLimits = {}): InfoPathPackage {
  const maxInput = Math.min(limits.maxInputBytes ?? Infinity, INFOPATH_LIMITS.maxInputBytes)
  const maxFiles = Math.min(limits.maxFiles ?? Infinity, INFOPATH_LIMITS.maxFiles)
  const maxTotal = Math.min(limits.maxTotalBytes ?? Infinity, INFOPATH_LIMITS.maxTotalBytes)
  const maxEntry = Math.min(INFOPATH_LIMITS.maxFileBytes, maxTotal)
  if (bytes.length > maxInput) {
    throw new InfoPathFileError(`The file is ${(bytes.length / MB).toFixed(1)} MB; the most is ${(maxInput / MB).toFixed(0)} MB`, 'limit')
  }
  const hash = createHash('sha256').update(bytes).digest('hex')
  const files = new Map<string, Buffer>()
  const names: string[] = []
  let textBytes = 0
  const keep = (name: string, data: Buffer) => {
    const clean = name.replace(/\\/g, '/').replace(/^\/+/, '')
    names.push(clean)
    if (!TEXT_EXT.test(clean) && !/\.js$|\.vbs$|\.dll$/i.test(clean)) return
    textBytes += data.length
    if (textBytes > INFOPATH_LIMITS.maxTextBytes) throw new InfoPathFileError('The form\'s files are too large to read', 'limit')
    files.set(clean.toLowerCase(), data)
  }
  if (isCab(bytes)) {
    try {
      for (const f of readCab(bytes, { maxFiles, maxFileBytes: maxEntry, maxTotalBytes: maxTotal })) keep(f.name, f.data)
    } catch (error) {
      if (error instanceof CabError) throw new InfoPathFileError(error.message, error.code === 'not_cab' ? 'not_infopath' : error.code)
      throw error
    }
    if (!files.has('manifest.xsf')) throw new InfoPathFileError('This cabinet has no manifest.xsf: it is not an InfoPath form template', 'not_infopath')
    return { format: 'xsn', hash, files, names }
  }
  if (isZip(bytes)) {
    let zip
    try {
      zip = openZip(bytes, { maxEntries: maxFiles, maxEntryBytes: maxEntry, maxTotalBytes: maxTotal })
    } catch (error) {
      if (error instanceof ZipLimitError) throw new InfoPathFileError(error.message, 'limit')
      throw new InfoPathFileError(`The zip could not be read: ${(error as Error).message}`)
    }
    const all = zip.names().filter((n) => !n.endsWith('/') && !/(^|\/)(__MACOSX|\.DS_Store)/.test(n))
    // The folder holding manifest.xsf (the zip may wrap the files in one folder).
    const manifest = all.find((n) => /(^|\/)manifest\.xsf$/i.test(n))
    // A zipped .xsn: unpack the cabinet inside.
    const xsn = all.find((n) => /\.xsn$/i.test(n))
    if (!manifest && xsn) {
      const inner = zip.read(xsn)
      if (inner && isCab(inner)) return openInfoPathPackage(inner, limits)
    }
    if (!manifest) throw new InfoPathFileError('The zip has no manifest.xsf. Zip the files InfoPath Designer exports with "Export Source Files", or upload the .xsn itself.', 'not_infopath')
    const prefix = manifest.slice(0, manifest.length - 'manifest.xsf'.length)
    try {
      for (const n of all) {
        if (!n.startsWith(prefix) || n.slice(prefix.length).includes('/')) continue
        const data = zip.read(n)
        if (data) keep(n.slice(prefix.length), data)
      }
    } catch (error) {
      if (error instanceof ZipLimitError) throw new InfoPathFileError(error.message, 'limit')
      throw error
    }
    return { format: 'zip', hash, files, names }
  }
  throw new InfoPathFileError('This is not an InfoPath form template. Upload the .xsn file (or a .zip of its extracted files).', 'not_infopath')
}

/** A text part (UTF-8 / UTF-16 with BOM). */
export function partText(pkg: InfoPathPackage, name: string): string | null {
  const data = pkg.files.get(name.toLowerCase())
  if (!data) return null
  if (data[0] === 0xff && data[1] === 0xfe) return data.subarray(2).toString('utf16le')
  if (data[0] === 0xfe && data[1] === 0xff) {
    const swapped = Buffer.from(data.subarray(2, 2 + ((data.length - 2) & ~1)))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  return data.toString('utf8')
}
