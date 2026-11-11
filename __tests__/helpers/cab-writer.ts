/**
 * A minimal Microsoft Cabinet writer for tests: one folder, every file in
 * it, compressed with MSZIP (each 32 KB block is "CK" + raw deflate with the
 * previous block's output as the preset dictionary — exactly what InfoPath
 * writes), stored uncompressed ("none"), or labelled LZX (the bytes are
 * not real LZX: readers must refuse before decoding).
 */
import { deflateRawSync } from 'node:zlib'

export type CabCompression = 'mszip' | 'none' | 'lzx'

export interface CabInputFile { name: string; data: Buffer | string }

const BLOCK = 32768

export function writeCab(files: CabInputFile[], compression: CabCompression = 'mszip', options: { blockSize?: number } = {}): Buffer {
  const blockSize = Math.min(BLOCK, options.blockSize ?? BLOCK)
  const datas = files.map((f) => (typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : f.data))
  const stream = Buffer.concat(datas)
  // CFDATA blocks.
  const blocks: Buffer[] = []
  let previous: Buffer | null = null
  for (let at = 0; at < stream.length || (at === 0 && !blocks.length); at += blockSize) {
    const chunk = stream.subarray(at, Math.min(stream.length, at + blockSize))
    let payload: Buffer
    if (compression === 'mszip') {
      const deflated = deflateRawSync(chunk, previous ? { dictionary: previous } : {})
      payload = Buffer.concat([Buffer.from('CK', 'latin1'), deflated])
      previous = previous ? Buffer.concat([previous, chunk]).subarray(-BLOCK) : Buffer.from(chunk)
    } else {
      payload = Buffer.from(chunk)
    }
    const header = Buffer.alloc(8)
    header.writeUInt32LE(0, 0) // no checksum
    header.writeUInt16LE(payload.length, 4)
    header.writeUInt16LE(chunk.length, 6)
    blocks.push(Buffer.concat([header, payload]))
    if (!stream.length) break
  }
  // CFFILE entries.
  const fileEntries: Buffer[] = []
  let offset = 0
  for (let i = 0; i < files.length; i++) {
    const head = Buffer.alloc(16)
    head.writeUInt32LE(datas[i].length, 0)
    head.writeUInt32LE(offset, 4)
    head.writeUInt16LE(0, 8) // folder 0
    head.writeUInt16LE(0x5a21, 10) // date
    head.writeUInt16LE(0x6000, 12) // time
    const utf8 = /[^\x20-\x7e]/.test(files[i].name)
    head.writeUInt16LE(0x20 | (utf8 ? 0x80 : 0), 14)
    fileEntries.push(Buffer.concat([head, Buffer.from(files[i].name, utf8 ? 'utf8' : 'latin1'), Buffer.from([0])]))
    offset += datas[i].length
  }
  const filesBuf = Buffer.concat(fileEntries)
  const headerSize = 36
  const folderSize = 8
  const coffFiles = headerSize + folderSize
  const coffData = coffFiles + filesBuf.length
  const dataBuf = Buffer.concat(blocks)
  const total = coffData + dataBuf.length
  const header = Buffer.alloc(headerSize)
  header.write('MSCF', 0, 'latin1')
  header.writeUInt32LE(total, 8)
  header.writeUInt32LE(coffFiles, 16)
  header[24] = 3
  header[25] = 1
  header.writeUInt16LE(1, 26) // folders
  header.writeUInt16LE(files.length, 28)
  header.writeUInt16LE(0, 30) // flags
  const folder = Buffer.alloc(folderSize)
  folder.writeUInt32LE(coffData, 0)
  folder.writeUInt16LE(blocks.length, 4)
  folder.writeUInt16LE(compression === 'mszip' ? 1 : compression === 'lzx' ? 0x1503 : 0, 6)
  return Buffer.concat([header, folder, filesBuf, dataBuf])
}
