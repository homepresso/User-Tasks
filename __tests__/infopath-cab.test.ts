import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { CabError, LZX_MESSAGE, isCab, listCab, readCab } from '@/lib/infopath/cab'
import { InfoPathFileError, openInfoPathPackage, partText } from '@/lib/infopath/archive'
import { writeZip } from '@/lib/packages/zip'
import { writeCab } from './helpers/cab-writer'
import { fixtureFiles, fixtureXsn } from './helpers/infopath-fixtures'

/** Text that compresses well and repeats across 32 KB blocks (back-references into the previous block). */
function bigText(n: number): string {
  const words = ['manifest', 'view', 'binding', 'expense', 'total', 'repeating', 'section', 'rule']
  let s = ''
  for (let i = 0; s.length < n; i++) s += `${words[i % words.length]}-${i % 97} `
  return s.slice(0, n)
}

describe('CAB reader', () => {
  it('reads MSZIP cabinets across blocks, carrying the window between blocks', () => {
    const a = bigText(90_000)
    const b = bigText(5000).toUpperCase()
    const cab = writeCab([{ name: 'a.txt', data: a }, { name: 'b.txt', data: b }, { name: 'empty.xml', data: '' }], 'mszip')
    expect(isCab(cab)).toBe(true)
    const files = readCab(cab)
    expect(files.map((f) => f.name)).toEqual(['a.txt', 'b.txt', 'empty.xml'])
    expect(files[0].data.toString()).toBe(a)
    expect(files[1].data.toString()).toBe(b)
    expect(files[2].size).toBe(0)
    expect(listCab(cab)[0]).toEqual({ name: 'a.txt', size: 90_000, compression: 'MSZIP' })
  })

  it('needs the previous block as the dictionary (a block alone does not inflate to the same bytes)', () => {
    const text = bigText(70_000)
    const cab = writeCab([{ name: 'x', data: text }], 'mszip')
    expect(readCab(cab)[0].data.toString()).toBe(text)
  })

  it('reads uncompressed ("none") cabinets', () => {
    const cab = writeCab([{ name: 'manifest.xsf', data: '<x/>' }, { name: 'view1.xsl', data: bigText(40_000) }], 'none')
    const files = readCab(cab)
    expect(files[1].data.toString()).toBe(bigText(40_000))
    expect(listCab(cab)[0].compression).toBe('none')
  })

  it('refuses LZX with a clear message before decoding anything', () => {
    const cab = writeCab([{ name: 'manifest.xsf', data: '<x/>' }], 'lzx')
    expect(() => readCab(cab)).toThrow(LZX_MESSAGE)
    try { readCab(cab) } catch (e) { expect((e as CabError).code).toBe('lzx') }
    expect(() => openInfoPathPackage(cab)).toThrow(/LZX compression, which is not supported yet/)
  })

  it('stops zip bombs: declared sizes over the caps and blocks that inflate past what they declare', () => {
    const cab = writeCab([{ name: 'a', data: bigText(50_000) }], 'mszip')
    expect(() => readCab(cab, { maxFileBytes: 10_000 })).toThrow(/at most 10000/)
    expect(() => readCab(cab, { maxTotalBytes: 20_000 })).toThrow(CabError)
    // A block whose deflate stream is far bigger than its cbUncomp.
    const huge = Buffer.alloc(32768, 0x41)
    const payload = Buffer.concat([Buffer.from('CK'), deflateRawSync(huge)])
    const forged = writeCab([{ name: 'a', data: 'x'.repeat(100) }], 'none')
    const dataAt = forged.readUInt32LE(36) // coffCabStart of folder 0
    const head = Buffer.alloc(8)
    head.writeUInt16LE(payload.length, 4)
    head.writeUInt16LE(100, 6)
    const bomb = Buffer.concat([forged.subarray(0, dataAt), head, payload])
    bomb.writeUInt16LE(1, 42) // folder compression: MSZIP
    bomb.writeUInt32LE(bomb.length, 8)
    expect(() => readCab(bomb)).toThrow(/more than it declares|wrong size/)
  })

  it('caps the file count and refuses truncated or foreign files', () => {
    const many = writeCab(Array.from({ length: 30 }, (_, i) => ({ name: `f${i}.xml`, data: '<a/>' })), 'mszip')
    expect(() => readCab(many, { maxFiles: 10 })).toThrow(/30 files/)
    const cab = writeCab([{ name: 'a', data: bigText(10_000) }], 'mszip')
    expect(() => readCab(cab.subarray(0, cab.length - 50))).toThrow(/truncated/)
    expect(() => readCab(Buffer.from('PK not a cab at all, honestly'))).toThrow(/Not a cabinet/)
  })
})

describe('InfoPath package', () => {
  it('opens an .xsn and keeps the text parts', () => {
    const pkg = openInfoPathPackage(fixtureXsn('expense-report'))
    expect(pkg.format).toBe('xsn')
    expect(pkg.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(partText(pkg, 'MANIFEST.XSF')).toContain('xDocumentClass')
    expect(pkg.names).toContain('view1.xsl')
  })

  it('accepts a zip of the extracted source files (also inside a folder)', () => {
    const zip = writeZip(fixtureFiles('leave-request').map((f) => ({ path: `Leave Request/${f.name}`, data: new Uint8Array(f.data) })))
    const pkg = openInfoPathPackage(zip)
    expect(pkg.format).toBe('zip')
    expect(partText(pkg, 'view2.xsl')).toContain('Manager approval')
  })

  it('refuses a cabinet without a manifest and anything else', () => {
    expect(() => openInfoPathPackage(writeCab([{ name: 'readme.txt', data: 'hi' }]))).toThrow(/no manifest.xsf/)
    expect(() => openInfoPathPackage(writeZip([{ path: 'a.txt', data: new Uint8Array([1]) }]))).toThrow(InfoPathFileError)
    expect(() => openInfoPathPackage(Buffer.from('%PDF-1.4'))).toThrow(/not an InfoPath form template/)
  })
})
