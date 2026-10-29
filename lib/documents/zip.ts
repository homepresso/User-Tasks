/**
 * Bounded ZIP reader for OOXML / ODF containers (DOCX, XLSX, PPTX, ODT …).
 *
 * Zip-bomb safe: the central directory is checked first (entry count, the
 * declared sizes), and every entry is inflated with a hard output cap
 * (zlib `maxOutputLength`), so a lying header cannot make it allocate more
 * than the limits below. Encrypted entries and ZIP64 archives are refused.
 */

import { inflateRawSync } from 'node:zlib'
import { DOCUMENT_LIMITS } from './limits'

export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipLimitError'
  }
}

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  encrypted: boolean
}

export interface ZipLimits {
  maxEntries: number
  maxEntryBytes: number
  maxTotalBytes: number
}

export interface ZipReader {
  entries: Map<string, ZipEntry>
  names(): string[]
  has(name: string): boolean
  read(name: string): Buffer | null
  readText(name: string): string | null
  /** Inflate every entry once (bounded), proving the real sizes are within the limits. */
  verifyAll(): void
}

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6)
}

export function openZip(input: Uint8Array, limits: Partial<ZipLimits> = {}): ZipReader {
  const lim: ZipLimits = {
    maxEntries: limits.maxEntries ?? DOCUMENT_LIMITS.zipMaxEntries,
    maxEntryBytes: limits.maxEntryBytes ?? DOCUMENT_LIMITS.zipMaxEntryBytes,
    maxTotalBytes: limits.maxTotalBytes ?? DOCUMENT_LIMITS.zipMaxTotalBytes,
  }
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  // End of central directory: the last 22..65557 bytes.
  let eocd = -1
  for (let p = buf.length - 22; p >= Math.max(0, buf.length - 65557); p--) {
    if (buf.readUInt32LE(p) === EOCD_SIG) { eocd = p; break }
  }
  if (eocd === -1) throw new Error('Not a valid ZIP container (no central directory)')
  const total = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (total === 0xffff || cdOffset === 0xffffffff) throw new ZipLimitError('ZIP64 archives are not supported')
  if (total > lim.maxEntries) throw new ZipLimitError(`The file has too many parts (${total}; at most ${lim.maxEntries})`)
  if (cdOffset + cdSize > buf.length) throw new Error('Not a valid ZIP container (truncated)')

  const entries = new Map<string, ZipEntry>()
  let declaredTotal = 0
  let p = cdOffset
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) throw new Error('Not a valid ZIP container (bad directory entry)')
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const uncompressedSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localHeaderOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw new ZipLimitError('ZIP64 archives are not supported')
    if (uncompressedSize > lim.maxEntryBytes) throw new ZipLimitError(`A part of the file is too large when unpacked ("${name.slice(0, 60)}")`)
    declaredTotal += uncompressedSize
    if (declaredTotal > lim.maxTotalBytes) throw new ZipLimitError(`The file is too large when unpacked (more than ${Math.round(lim.maxTotalBytes / 1024 / 1024)} MB)`)
    // Normalise: OOXML part names have no leading slash; refuse traversal-looking names.
    const clean = name.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!clean.split('/').includes('..')) entries.set(clean, { name: clean, method, compressedSize, uncompressedSize, localHeaderOffset, encrypted: (flags & 1) === 1 })
    p += 46 + nameLen + extraLen + commentLen
  }

  let actualTotal = 0
  const cache = new Map<string, Buffer>()

  function read(name: string): Buffer | null {
    const clean = name.replace(/^\/+/, '')
    const cached = cache.get(clean)
    if (cached) return cached
    const entry = entries.get(clean)
    if (!entry) return null
    if (entry.encrypted) throw new Error('Encrypted (password-protected) files are not supported')
    const lp = entry.localHeaderOffset
    if (lp + 30 > buf.length || buf.readUInt32LE(lp) !== LOC_SIG) throw new Error('Not a valid ZIP container (bad local header)')
    const start = lp + 30 + buf.readUInt16LE(lp + 26) + buf.readUInt16LE(lp + 28)
    const end = start + entry.compressedSize
    if (end > buf.length) throw new Error('Not a valid ZIP container (truncated entry)')
    const raw = buf.subarray(start, end)
    let out: Buffer
    if (entry.method === 0) out = Buffer.from(raw)
    else if (entry.method === 8) {
      const remaining = lim.maxTotalBytes - actualTotal
      const cap = Math.max(1, Math.min(lim.maxEntryBytes, remaining))
      try {
        out = inflateRawSync(raw, { maxOutputLength: cap })
      } catch (e) {
        const code = (e as { code?: string }).code
        if (code === 'ERR_BUFFER_TOO_LARGE' || /too large|maxOutputLength|Cannot create a Buffer/i.test(String((e as Error).message))) {
          throw new ZipLimitError(`The file is too large when unpacked ("${clean.slice(0, 60)}")`)
        }
        throw new Error(`Could not unpack "${clean.slice(0, 60)}": ${(e as Error).message}`)
      }
    } else throw new Error(`Unsupported ZIP compression method ${entry.method}`)
    actualTotal += out.byteLength
    if (actualTotal > lim.maxTotalBytes) throw new ZipLimitError(`The file is too large when unpacked (more than ${Math.round(lim.maxTotalBytes / 1024 / 1024)} MB)`)
    // Only small parts are cached (XML parts are read once in practice).
    if (out.byteLength < 4 * 1024 * 1024) cache.set(clean, out)
    return out
  }

  return {
    entries,
    names: () => [...entries.keys()],
    has: (name) => entries.has(name.replace(/^\/+/, '')),
    read,
    readText(name) {
      const b = read(name)
      return b ? b.toString('utf8') : null
    },
    verifyAll() {
      for (const name of entries.keys()) {
        if (name.endsWith('/')) continue
        read(name)
        cache.delete(name)
      }
      // Proven within the limits; later reads count afresh.
      actualTotal = 0
    },
  }
}
