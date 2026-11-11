/**
 * A bounded, pure-TypeScript reader for Microsoft Cabinet (CAB) archives —
 * the container an InfoPath form template (.xsn) is.
 *
 * Layout (MS-CAB): CFHEADER, then the CFFOLDER entries, then the CFFILE
 * entries (at coffFiles), then each folder's CFDATA blocks (from its
 * coffCabStart). A folder is one compressed stream split into blocks of at
 * most 32 KB uncompressed; files are byte ranges of their folder's
 * uncompressed stream (uoffFolderStart, cbFile).
 *
 * Compression per folder (typeCompress & 0x000f):
 *   0 None    — the blocks are the bytes.
 *   1 MSZIP   — each block is "CK" + a raw deflate stream; the LZ77 window
 *               carries over between blocks, so block n is inflated with
 *               block n-1's output (its last 32 KB) as the preset dictionary.
 *   2 Quantum / 3 LZX — refused with a clear message (InfoPath writes MSZIP;
 *               an LZX cabinet comes from re-packing the files with another tool).
 *
 * Zip-bomb safe: the header's counts are checked before anything is read,
 * every block is inflated with a hard output cap (its declared size, never
 * more than 32 KB), and the total and per-file sizes are capped. Multi-
 * cabinet sets (files continued in another .cab) are refused.
 */

import { inflateRawSync } from 'node:zlib'

export class CabError extends Error {
  constructor(message: string, readonly code: 'not_cab' | 'lzx' | 'unsupported' | 'corrupt' | 'limit' = 'corrupt') {
    super(message)
    this.name = 'CabError'
  }
}

export interface CabLimits {
  /** Files in the cabinet. */
  maxFiles: number
  /** Folders (compressed streams). */
  maxFolders: number
  /** One file, uncompressed. */
  maxFileBytes: number
  /** Everything, uncompressed. */
  maxTotalBytes: number
}

export const DEFAULT_CAB_LIMITS: CabLimits = {
  maxFiles: 1000,
  maxFolders: 64,
  maxFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 96 * 1024 * 1024,
}

export const LZX_MESSAGE = 'This XSN uses LZX compression, which is not supported yet. Open it in InfoPath Designer and save it again (InfoPath saves with MSZIP), or zip the extracted files and upload the .zip.'

export interface CabFile {
  name: string
  size: number
  data: Buffer
}

const MSCF = 0x4643534d // "MSCF" little-endian
const BLOCK_MAX = 32768
const FLAG_PREV = 0x0001
const FLAG_NEXT = 0x0002
const FLAG_RESERVE = 0x0004
const NAME_IS_UTF = 0x80

export function isCab(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x4d && bytes[1] === 0x53 && bytes[2] === 0x43 && bytes[3] === 0x46
}

interface Folder { dataOffset: number; blocks: number; type: number }
interface Entry { name: string; size: number; offset: number; folder: number }

function readZString(buf: Buffer, at: number, utf8: boolean): { value: string; next: number } {
  const end = buf.indexOf(0, at)
  if (end === -1 || end - at > 1024) throw new CabError('The cabinet is damaged (a file name is not terminated)')
  return { value: buf.toString(utf8 ? 'utf8' : 'latin1', at, end), next: end + 1 }
}

/** Compression name of a folder type (for messages). */
export function cabCompressionName(type: number): string {
  return ['none', 'MSZIP', 'Quantum', 'LZX'][type & 0x0f] ?? `type ${type & 0x0f}`
}

/** Parse the cabinet's directory (no decompression): its files and folders. */
function readDirectory(buf: Buffer, limits: CabLimits): { folders: Folder[]; entries: Entry[]; dataReserve: number } {
  if (buf.length < 36 || buf.readUInt32LE(0) !== MSCF) throw new CabError('Not a cabinet (.xsn) file', 'not_cab')
  const cbCabinet = buf.readUInt32LE(8)
  const coffFiles = buf.readUInt32LE(16)
  const major = buf[25]
  const cFolders = buf.readUInt16LE(26)
  const cFiles = buf.readUInt16LE(28)
  const flags = buf.readUInt16LE(30)
  if (major !== 1) throw new CabError(`Unsupported cabinet version ${major}`, 'unsupported')
  if (cbCabinet > buf.length) throw new CabError('The cabinet is truncated (it is shorter than its header says)')
  if (flags & (FLAG_PREV | FLAG_NEXT)) throw new CabError('This cabinet is part of a multi-file set, which is not supported', 'unsupported')
  if (cFolders === 0 || cFolders > limits.maxFolders) throw new CabError(`The cabinet has ${cFolders} folders (at most ${limits.maxFolders})`, 'limit')
  if (cFiles === 0 || cFiles > limits.maxFiles) throw new CabError(`The cabinet has ${cFiles} files (at most ${limits.maxFiles})`, 'limit')
  let at = 36
  let folderReserve = 0
  let dataReserve = 0
  if (flags & FLAG_RESERVE) {
    const headerReserve = buf.readUInt16LE(at)
    folderReserve = buf[at + 2]
    dataReserve = buf[at + 3]
    at += 4 + headerReserve
  }
  const folders: Folder[] = []
  for (let i = 0; i < cFolders; i++) {
    if (at + 8 > buf.length) throw new CabError('The cabinet is truncated (folder table)')
    folders.push({ dataOffset: buf.readUInt32LE(at), blocks: buf.readUInt16LE(at + 4), type: buf.readUInt16LE(at + 6) })
    at += 8 + folderReserve
  }
  const entries: Entry[] = []
  at = coffFiles
  for (let i = 0; i < cFiles; i++) {
    if (at + 16 > buf.length) throw new CabError('The cabinet is truncated (file table)')
    const size = buf.readUInt32LE(at)
    const offset = buf.readUInt32LE(at + 4)
    const folder = buf.readUInt16LE(at + 8)
    const attribs = buf.readUInt16LE(at + 14)
    const name = readZString(buf, at + 16, (attribs & NAME_IS_UTF) !== 0)
    at = name.next
    if (folder >= 0xfffd) throw new CabError('This cabinet continues files from another cabinet, which is not supported', 'unsupported')
    if (folder >= folders.length) throw new CabError('The cabinet is damaged (a file points at a missing folder)')
    if (size > limits.maxFileBytes) throw new CabError(`"${name.value}" is ${size} bytes unpacked (at most ${limits.maxFileBytes})`, 'limit')
    entries.push({ name: name.value.replace(/\\/g, '/'), size, offset, folder })
  }
  const total = entries.reduce((sum, e) => sum + e.size, 0)
  if (total > limits.maxTotalBytes) throw new CabError(`The cabinet unpacks to ${total} bytes (at most ${limits.maxTotalBytes})`, 'limit')
  return { folders, entries, dataReserve }
}

/** Inflate one folder's stream up to `needed` bytes. */
function readFolder(buf: Buffer, folder: Folder, dataReserve: number, needed: number, limits: CabLimits): Buffer {
  const kind = folder.type & 0x0f
  if (kind === 3) throw new CabError(LZX_MESSAGE, 'lzx')
  if (kind !== 0 && kind !== 1) throw new CabError(`This XSN uses ${cabCompressionName(folder.type)} compression, which is not supported. Save it again from InfoPath Designer.`, 'unsupported')
  if (folder.blocks * BLOCK_MAX > limits.maxTotalBytes + BLOCK_MAX) throw new CabError('The cabinet declares more data than allowed', 'limit')
  const parts: Buffer[] = []
  let produced = 0
  let at = folder.dataOffset
  let window: Buffer | null = null
  for (let b = 0; b < folder.blocks && produced < needed; b++) {
    if (at + 8 + dataReserve > buf.length) throw new CabError('The cabinet is truncated (data block header)')
    const cbData = buf.readUInt16LE(at + 4)
    const cbUncomp = buf.readUInt16LE(at + 6)
    const start = at + 8 + dataReserve
    const end = start + cbData
    if (end > buf.length) throw new CabError('The cabinet is truncated (data block)')
    if (cbUncomp > BLOCK_MAX) throw new CabError('The cabinet is damaged (a block is larger than 32 KB)')
    if (cbUncomp === 0) throw new CabError('This cabinet continues a block in another cabinet, which is not supported', 'unsupported')
    const raw = buf.subarray(start, end)
    let out: Buffer
    if (kind === 0) {
      if (cbData !== cbUncomp) throw new CabError('The cabinet is damaged (an uncompressed block has the wrong size)')
      out = Buffer.from(raw)
    } else {
      if (raw.length < 2 || raw[0] !== 0x43 || raw[1] !== 0x4b) throw new CabError('The cabinet is damaged (an MSZIP block has no "CK" signature)')
      try {
        out = inflateRawSync(raw.subarray(2), {
          maxOutputLength: cbUncomp,
          ...(window ? { dictionary: window } : {}),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/maxOutputLength|buffer/i.test(message)) throw new CabError('A data block unpacks to more than it declares', 'limit')
        throw new CabError(`The cabinet is damaged (a block could not be decompressed: ${message})`)
      }
      if (out.length !== cbUncomp) throw new CabError('The cabinet is damaged (a block unpacked to the wrong size)')
      // The next block's preset dictionary: the last 32 KB of output (the deflate window).
      window = out.length >= BLOCK_MAX || !window ? out : Buffer.concat([window, out]).subarray(-BLOCK_MAX)
    }
    produced += out.length
    if (produced > limits.maxTotalBytes) throw new CabError('The cabinet unpacks to more than allowed', 'limit')
    parts.push(out)
    at = end
  }
  if (produced < needed) throw new CabError('The cabinet is truncated (a folder has fewer bytes than its files need)')
  return Buffer.concat(parts, produced)
}

/** The cabinet's file names, sizes and each folder's compression (no decompression). */
export function listCab(input: Uint8Array, limits: Partial<CabLimits> = {}): Array<{ name: string; size: number; compression: string }> {
  const lim = { ...DEFAULT_CAB_LIMITS, ...limits }
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  const { folders, entries } = readDirectory(buf, lim)
  return entries.map((e) => ({ name: e.name, size: e.size, compression: cabCompressionName(folders[e.folder].type) }))
}

/** Unpack every file of a cabinet (bounded; see the module comment). */
export function readCab(input: Uint8Array, limits: Partial<CabLimits> = {}): CabFile[] {
  const lim = { ...DEFAULT_CAB_LIMITS, ...limits }
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  const { folders, entries, dataReserve } = readDirectory(buf, lim)
  // LZX anywhere: say so before doing any work.
  if (folders.some((f) => (f.type & 0x0f) === 3)) throw new CabError(LZX_MESSAGE, 'lzx')
  const out: CabFile[] = []
  for (let f = 0; f < folders.length; f++) {
    const files = entries.filter((e) => e.folder === f)
    if (!files.length) continue
    const needed = Math.max(...files.map((e) => e.offset + e.size))
    if (needed > lim.maxTotalBytes) throw new CabError('The cabinet unpacks to more than allowed', 'limit')
    const stream = readFolder(buf, folders[f], dataReserve, needed, lim)
    for (const e of files) out.push({ name: e.name, size: e.size, data: stream.subarray(e.offset, e.offset + e.size) })
  }
  return out
}
