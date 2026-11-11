/** Build .xsn test files from the self-authored fixture folders (__tests__/fixtures/infopath/<name>). */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeCab, type CabCompression } from './cab-writer'

const ROOT = join(__dirname, '..', 'fixtures', 'infopath')

export function fixtureFiles(name: 'expense-report' | 'leave-request'): Array<{ name: string; data: Buffer }> {
  const dir = join(ROOT, name)
  return readdirSync(dir).sort((a, b) => (a === 'manifest.xsf' ? -1 : b === 'manifest.xsf' ? 1 : a.localeCompare(b))).map((f) => ({ name: f, data: readFileSync(join(dir, f)) }))
}

/** The fixture as an .xsn (small blocks so the MSZIP window crosses blocks). */
export function fixtureXsn(name: 'expense-report' | 'leave-request', compression: CabCompression = 'mszip'): Buffer {
  return writeCab(fixtureFiles(name), compression, { blockSize: 4096 })
}
