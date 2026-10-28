/**
 * Minimal, dependency-free ZIP reader/writer for package files (.utpkg).
 *
 * Writes deterministic archives: entries in the given order, DEFLATE via
 * node:zlib, a fixed 1980-01-01 timestamp and no extra fields, so the same
 * files always produce the same bytes. Reads stored (0) and deflated (8)
 * entries only, with limits on entry count and total uncompressed size, and
 * rejects absolute or `..` paths.
 *
 * packages/cli/src/package-zip.ts is an identical copy (the CLI is a separate
 * package and cannot import app code); __tests__/packages-format.test.ts
 * checks the copies stay identical.
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  path: string
  data: Uint8Array
}

export interface ZipLimits {
  maxEntries: number
  maxTotalBytes: number
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 5000, maxTotalBytes: 64 * 1024 * 1024 }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// 1980-01-01 00:00:00 in MS-DOS date/time.
const DOS_TIME = 0
const DOS_DATE = (0 << 9) | (1 << 5) | 1

function safePath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`Unsafe path in archive: ${path}`)
  }
  return normalized
}

/** Build a ZIP archive from entries (written in the given order). */
export function writeZip(entries: ReadonlyArray<ZipEntry>): Uint8Array {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(safePath(entry.path), 'utf8')
    const raw = Buffer.from(entry.data)
    const deflated = deflateRawSync(raw, { level: 9 })
    const useDeflate = deflated.length < raw.length
    const body = useDeflate ? deflated : raw
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(useDeflate ? 8 : 0, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + body.length
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, ...centrals, end]))
}

/** Read every entry of a ZIP archive (directories are skipped). */
export function readZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive (no end of central directory)')
  const count = buf.readUInt16LE(eocd + 10)
  const centralOffset = buf.readUInt32LE(eocd + 16)
  if (count > limits.maxEntries) throw new Error(`Archive has too many entries (${count}; limit ${limits.maxEntries})`)

  const entries: ZipEntry[] = []
  let total = 0
  let pos = centralOffset
  for (let i = 0; i < count; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('Corrupt ZIP central directory')
    const method = buf.readUInt16LE(pos + 10)
    const compressedSize = buf.readUInt32LE(pos + 20)
    const size = buf.readUInt32LE(pos + 24)
    const nameLength = buf.readUInt16LE(pos + 28)
    const extraLength = buf.readUInt16LE(pos + 30)
    const commentLength = buf.readUInt16LE(pos + 32)
    const localOffset = buf.readUInt32LE(pos + 42)
    const name = buf.subarray(pos + 46, pos + 46 + nameLength).toString('utf8')
    pos += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue

    total += size
    if (total > limits.maxTotalBytes) throw new Error(`Archive is too large when extracted (limit ${limits.maxTotalBytes / 1024 / 1024} MB)`)
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Corrupt ZIP entry ${name}`)
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28)
    const body = buf.subarray(dataStart, dataStart + compressedSize)
    let data: Buffer
    if (method === 0) data = Buffer.from(body)
    else if (method === 8) data = inflateRawSync(body, { maxOutputLength: Math.max(size, 1) })
    else throw new Error(`Unsupported compression method ${method} for ${name}`)
    if (data.length !== size) throw new Error(`Size mismatch for ${name}`)
    if (crc32(data) !== buf.readUInt32LE(pos - (46 + nameLength + extraLength + commentLength) + 16)) throw new Error(`CRC mismatch for ${name}`)
    entries.push({ path: safePath(name), data: new Uint8Array(data) })
  }
  return entries
}
