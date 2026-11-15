import { generateKeyPairSync } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUNDLE_FILES, INSTALLER_FILES, RELEASE_IMAGE_REPO, assertVersion, buildManifest, bundleName, embeddedKey, fingerprintOf,
  manifestJson, newMigrations, parseSums, publicKeyPem, releaseJson, releaseNotesValues, renderTemplate, signSums, sumsText,
  verifySums, withEmbeddedKey,
} from '../scripts/release-bundle-helpers'

const ROOT = path.resolve(__dirname, '..')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')
const DIGEST = `sha256:${'a'.repeat(64)}`

describe('release bundle helpers (scripts/release-bundle.ts)', () => {
  it('accepts release versions and rejects anything else', () => {
    expect(assertVersion('0.2.0')).toBe('0.2.0')
    expect(assertVersion('v1.2.3-rc.1')).toBe('1.2.3-rc.1')
    for (const bad of ['1.2', 'latest', '1.2.3;rm', '1.2.3 ', '../1.2.3']) expect(() => assertVersion(bad), bad).toThrow()
    expect(bundleName('0.2.0')).toBe('usertasks-0.2.0.tar.gz')
  })

  it('builds a manifest that pins the image digest and counts migrations', () => {
    const m = buildManifest({ version: '0.2.0', imageDigest: DIGEST, migrations: ['b.sql', 'a.sql', 'README.md'], createdAt: new Date('2026-11-14T00:00:00Z'), gitCommit: 'abc' })
    expect(m).toEqual({
      schema: 1, version: '0.2.0', image: `${RELEASE_IMAGE_REPO}:0.2.0`, imageDigest: DIGEST, createdAt: '2026-11-14T00:00:00.000Z',
      gitCommit: 'abc', migrations: { count: 2, latest: 'b' }, minimumUpgradeFrom: null,
    })
    expect(() => buildManifest({ version: '0.2.0', imageDigest: 'sha256:short', migrations: [] })).toThrow(/digest/)
    expect(() => buildManifest({ version: '0.2.0', image: 'evil" image', migrations: [] })).toThrow(/image/)
    expect(buildManifest({ version: '0.2.0', migrations: [] }).imageDigest).toBeUndefined()
  })

  it('writes the manifest with one "key": "value" per line (the shell wrapper greps it)', () => {
    const text = manifestJson(buildManifest({ version: '0.2.0', imageDigest: DIGEST, migrations: [] }))
    expect(text).toMatch(/^ {2}"version": "0\.2\.0",$/m)
    expect(text).toMatch(/^ {2}"image": "ghcr\.io\/homepresso\/usertasks:0\.2\.0",$/m)
    expect(text).toMatch(new RegExp(`^ {2}"imageDigest": "${DIGEST}",$`, 'm'))
    const rel = JSON.parse(releaseJson(buildManifest({ version: '0.2.0', migrations: [] })))
    expect(rel).toEqual({ version: '0.2.0', image: `${RELEASE_IMAGE_REPO}:0.2.0`, imageDigest: null, bundle: 'usertasks-0.2.0.tar.gz' })
  })

  it('round-trips SHA256SUMS and refuses paths or bad hashes', () => {
    const entries = { 'usertasks-0.2.0.tar.gz': 'b'.repeat(64), 'install.sh': 'c'.repeat(64) }
    const text = sumsText(entries)
    expect(text).toBe(`${'c'.repeat(64)}  install.sh\n${'b'.repeat(64)}  usertasks-0.2.0.tar.gz\n`)
    expect(parseSums(text)).toEqual(entries)
    expect(() => sumsText({ '../x': 'b'.repeat(64) })).toThrow()
    expect(() => sumsText({ x: 'nothex' })).toThrow()
    expect(() => parseSums('garbage line')).toThrow()
  })

  it('signs SHA256SUMS with ed25519 and detects any change', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const sums = sumsText({ 'install.sh': 'c'.repeat(64) })
    const sig = signSums(sums, privateKey)
    expect(verifySums(sums, sig, publicKey)).toBe(true)
    expect(verifySums(`${sums}\n`, sig, publicKey)).toBe(false)
    expect(verifySums(sums, sig, generateKeyPairSync('ed25519').publicKey)).toBe(false)
    expect(() => signSums(sums, generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey)).toThrow(/ed25519/)
    expect(fingerprintOf(publicKey)).toMatch(/^([0-9a-f]{2}:){15}[0-9a-f]{2}$/)
  })

  it('embeds the release key in both installers, and only an ed25519 key', () => {
    const { publicKey } = generateKeyPairSync('ed25519')
    const pem = publicKeyPem(publicKey)
    for (const name of INSTALLER_FILES) {
      const script = read(`deploy/install/${name}`)
      const updated = withEmbeddedKey(script, pem)
      expect(embeddedKey(updated)).toBe(pem)
      expect(withEmbeddedKey(updated, pem)).toBe(updated)
      expect(updated.length - script.length).toBeLessThan(200)
      expect(() => withEmbeddedKey(script, publicKeyPem(generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey))).toThrow(/ed25519/)
    }
  })

  it('keeps the committed release key, install.sh and install.ps1 in step', () => {
    const sh = embeddedKey(read('deploy/install/install.sh'))
    const ps = embeddedKey(read('deploy/install/install.ps1'))
    expect(sh).toBe(ps)
    const keyFile = path.join(ROOT, 'deploy/install/release-key.pub.pem')
    if (existsSync(keyFile)) expect(sh.trim()).toBe(readFileSync(keyFile, 'utf8').trim())
    else expect(sh).toBe('')
  })

  it('renders the release notes template with every placeholder known', () => {
    const { publicKey } = generateKeyPairSync('ed25519')
    const manifest = buildManifest({ version: '0.2.0', imageDigest: DIGEST, migrations: ['20270101000000_a.sql'] })
    const notes = renderTemplate(read('deploy/install/RELEASE_NOTES.template.md'), releaseNotesValues({
      manifest, fingerprint: fingerprintOf(publicKey), previousVersion: '0.1.0', newMigrations: ['20270101000000_a.sql'],
    }))
    expect(notes).not.toMatch(/\{\{/)
    expect(notes).toContain('usertasks upgrade --to 0.2.0')
    expect(notes).toContain(`ghcr.io/homepresso/usertasks:0.2.0@${DIGEST}`)
    expect(notes).toContain('- `20270101000000_a.sql`')
    expect(notes).toContain('1 new since 0.1.0')
    expect(() => renderTemplate('{{nope}}', {})).toThrow(/nope/)
  })

  it('lists migrations new since the previous release', () => {
    expect(newMigrations(['a.sql', 'b.sql', 'c.sql', 'x.md'], ['a.sql'])).toEqual(['b.sql', 'c.sql'])
  })

  it('bundles files that exist', () => {
    for (const [src] of BUNDLE_FILES) expect(existsSync(path.join(ROOT, src)), src).toBe(true)
    for (const name of INSTALLER_FILES) expect(existsSync(path.join(ROOT, 'deploy/install', name)), name).toBe(true)
  })
})
