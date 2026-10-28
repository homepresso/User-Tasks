import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { archivePackage, canonicalJson, computeChecksum, PACKAGE_FORMAT_VERSION, PACKAGE_KIND, packPackage, unpackPackage, type PackageFileManifest } from '@/lib/packages/format'
import { readZip, writeZip } from '@/lib/packages/zip'
import { fromPackageFiles, toPackageFiles, type PackageContents } from '@/lib/packages/build'
import { bumpSemver, compareSemver, isValidRange, satisfiesRange } from '@/lib/packages/semver'

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

const ROOT = join(__dirname, '..')
const pem = () => generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

function contents(): PackageContents {
  return {
    header: { id: '11111111-1111-4111-8111-111111111111', name: 'Invoice approval', slug: 'invoice-approval', version: '1.0.0', description: 'Approve invoices', author: 'Northwind', created_at: '2026-10-26T00:00:00.000Z', readme: '# Invoice approval\n' },
    assets: {
      workflows: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Invoice approval', nodes: [{ id: 'n1', type: 'decision_table', config: { decision_table_id: '33333333-3333-4333-8333-333333333333' } }], edges: [] }],
      decision_tables: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Policy', inputs: [], outputs: [], rules: [] }],
      data_tables: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Vendors', columns: [{ key: 'name', type: 'text' }] }],
    },
    data: { '44444444-4444-4444-8444-444444444444': { mode: 'rows', rows: [{ id: '55555555-5555-4555-8555-555555555555', data: { name: 'Acme', code: 'A1' } }] } },
    requirements: [],
    dependencies: [],
  }
}

function pack(signingKeyPem?: string) {
  return packPackage({ ...toPackageFiles(contents()), signingKeyPem })
}

/** Rewrite one archive file (keeping the manifest as is). */
function tamper(bytes: Uint8Array, path: string, edit: (text: string) => string): Uint8Array {
  const entries = readZip(bytes).map((entry) => (entry.path === path ? { path, data: Buffer.from(edit(Buffer.from(entry.data).toString('utf8'))) } : entry))
  return writeZip(entries)
}

describe('canonical JSON + checksum', () => {
  it('sorts keys at every depth and drops undefined members', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: undefined, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"x":2,"z":1}]},"b":1}')
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }))
  })

  it('ignores checksum and signature, covers everything else', () => {
    const { manifest } = pack()
    expect(computeChecksum({ ...manifest, checksum: 'x', signature: { alg: 'ed25519', public_key: '', fingerprint: '', value: '' } })).toBe(manifest.checksum)
    expect(computeChecksum({ ...manifest, package: { ...manifest.package, version: '9.9.9' } })).not.toBe(manifest.checksum)
  })
})

describe('.utpkg pack / unpack', () => {
  it('round-trips contents through the GitHub-sync layout and NDJSON rows', () => {
    const { bytes, manifest } = pack()
    expect(manifest.kind).toBe(PACKAGE_KIND)
    expect(manifest.format_version).toBe(PACKAGE_FORMAT_VERSION)
    const paths = readZip(bytes).map((e) => e.path)
    expect(paths[0]).toBe('manifest.json')
    expect(paths).toEqual(expect.arrayContaining(['README.md', 'assets/manifest.json', expect.stringMatching(/^assets\/workflows\/invoice-approval-22222222\.json$/), expect.stringMatching(/^data\/vendors-44444444\.ndjson$/)]))
    const unpacked = unpackPackage(bytes)
    expect(unpacked.verification).toMatchObject({ valid: true, checksum_ok: true, files_ok: true, signed: false, signature_ok: null })
    const { contents: back, errors } = fromPackageFiles(unpacked.manifest, unpacked.files)
    expect(errors).toEqual([])
    expect(back.assets.workflows[0].nodes[0].config.decision_table_id).toBe('33333333-3333-4333-8333-333333333333')
    expect(back.data['44444444-4444-4444-8444-444444444444']).toEqual({ mode: 'rows', rows: [{ id: '55555555-5555-4555-8555-555555555555', data: { name: 'Acme', code: 'A1' } }] })
    expect(back.header.version).toBe('1.0.0')
  })

  it('rebuilds the same bytes from the stored manifest and files', () => {
    const { bytes, manifest, files } = pack()
    expect(Buffer.from(archivePackage(manifest, [...files].reverse())).equals(Buffer.from(bytes))).toBe(true)
  })

  it('signs with ed25519 and verifies; any tampering is detected', () => {
    const { bytes, manifest } = pack(pem())
    expect(manifest.signature?.fingerprint).toMatch(/^([0-9a-f]{2}:){15}[0-9a-f]{2}$/)
    expect(unpackPackage(bytes).verification).toMatchObject({ valid: true, signed: true, signature_ok: true })

    // An asset file edited after the build.
    const workflowPath = readZip(bytes).map((e) => e.path).find((p) => p.startsWith('assets/workflows/'))!
    const edited = unpackPackage(tamper(bytes, workflowPath, (text) => text.replace('Invoice approval', 'Evil approval')))
    expect(edited.verification.valid).toBe(false)
    expect(edited.verification.files_ok).toBe(false)

    // Rows edited.
    const rows = unpackPackage(tamper(bytes, 'data/vendors-44444444.ndjson', (text) => text.replace('Acme', 'Evil')))
    expect(rows.verification.valid).toBe(false)

    // Header edited (version bumped) — checksum no longer matches.
    const header = unpackPackage(tamper(bytes, 'manifest.json', (text) => text.replace('"version": "1.0.0"', '"version": "2.0.0"')))
    expect(header.verification).toMatchObject({ valid: false, checksum_ok: false })

    // Re-computed checksum but the old signature: signature fails.
    const resummed = unpackPackage(tamper(bytes, 'manifest.json', (text) => {
      const m = JSON.parse(text) as PackageFileManifest
      m.package.version = '2.0.0'
      m.checksum = computeChecksum(m)
      return JSON.stringify(m)
    }))
    expect(resummed.verification).toMatchObject({ valid: false, checksum_ok: true, signature_ok: false })

    // An extra file smuggled in.
    const extra = unpackPackage(writeZip([...readZip(bytes), { path: 'assets/workflows/x.json', data: Buffer.from('{}') }]))
    expect(extra.verification.valid).toBe(false)
    expect(extra.verification.errors.join(' ')).toContain('Unlisted file')
  })

  it('rejects things that are not packages', () => {
    expect(() => unpackPackage(Buffer.from('not a zip'))).toThrow(/Not a ZIP/)
    expect(() => unpackPackage(writeZip([{ path: 'x.json', data: Buffer.from('{}') }]))).toThrow(/manifest.json is missing/)
    expect(() => unpackPackage(writeZip([{ path: 'manifest.json', data: Buffer.from('{"kind":"other"}') }]))).toThrow(/kind/)
    expect(() => writeZip([{ path: '../evil', data: Buffer.from('x') }])).toThrow(/Unsafe path/)
  })

  it('the CLI copies of the format and zip modules stay identical', () => {
    const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
    expect(read('packages/cli/src/package-zip.ts')).toBe(read('lib/packages/zip.ts'))
    expect(read('packages/cli/src/package-format.ts')).toBe(read('lib/packages/format.ts').replace("from './zip'", "from './package-zip'"))
  })
})

describe('semver', () => {
  it('compares, bumps and matches ranges', () => {
    expect(compareSemver('1.2.10', '1.2.9')).toBe(1)
    expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBe(-1)
    expect(bumpSemver(null)).toBe('1.0.0')
    expect(bumpSemver('1.2.3', 'minor')).toBe('1.3.0')
    expect(bumpSemver('1.2.3', 'major')).toBe('2.0.0')
    expect(satisfiesRange('1.4.0', '^1.2.0')).toBe(true)
    expect(satisfiesRange('2.0.0', '^1.2.0')).toBe(false)
    expect(satisfiesRange('1.2.9', '~1.2.0')).toBe(true)
    expect(satisfiesRange('1.3.0', '~1.2.0')).toBe(false)
    expect(satisfiesRange('1.5.0', '>=1.0.0 <2.0.0')).toBe(true)
    expect(satisfiesRange('3.0.0', '1.x || 3.x')).toBe(true)
    expect(satisfiesRange('0.3.1', '^0.3.0')).toBe(true)
    expect(satisfiesRange('0.4.0', '^0.3.0')).toBe(false)
    expect(isValidRange('^1.0.0')).toBe(true)
    expect(isValidRange('banana')).toBe(false)
  })
})

describe('archives carry no stray data', () => {
  it('manifest.json lists exactly the other files', () => {
    const { bytes, manifest } = pack()
    expect(manifest.files.map((f: any) => f.path).sort()).toEqual(readZip(bytes).map((e) => e.path).filter((p) => p !== 'manifest.json').sort())
  })
})
