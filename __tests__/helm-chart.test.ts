import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROVIDER_AREAS, PROVIDER_IDS } from '@/lib/config/schema'
import { keyFingerprint, publicKeyBase64 } from '@/lib/packages/format'
import { HELM_OPTIONS_FILE, HELM_SCHEMA_FILE, helmProviderOptions, renderHelmOptions, renderHelmSchema } from '../scripts/helm-options'
import { checksums, fingerprintOf, targetRef, verifyBundle } from '../scripts/bundle'

const CHART = path.resolve(__dirname, '../deploy/helm/usertasks')

describe('Helm chart provider options', () => {
  it('files/provider-options.json is generated from the providers’ option maps (npx tsx scripts/helm-options.ts)', () => {
    expect(readFileSync(HELM_OPTIONS_FILE, 'utf8')).toBe(renderHelmOptions())
    const schema = readFileSync(HELM_SCHEMA_FILE, 'utf8')
    expect(schema).toBe(renderHelmSchema(schema))
  })

  it('covers every provider area and id, and marks the code’s secret options', () => {
    const { areas } = helmProviderOptions()
    expect(Object.keys(areas).sort()).toEqual([...PROVIDER_AREAS].sort())
    for (const area of PROVIDER_AREAS) expect(areas[area].ids).toEqual(PROVIDER_IDS[area])
    expect(areas.email.secretOptions).toContain('smtp_password')
    expect(areas.cache.secretOptions).toContain('redis_password')
    expect(areas.storage.options.endpoint).toBe('S3_ENDPOINT')
  })

  it('values.schema.json allows exactly the provider ids and options of the table', () => {
    const schema = JSON.parse(readFileSync(path.join(CHART, 'values.schema.json'), 'utf8'))
    const { areas } = helmProviderOptions()
    for (const area of PROVIDER_AREAS) {
      const def = schema.properties.providers.properties[area]
      expect(def.properties.provider.enum).toEqual(['', ...PROVIDER_IDS[area]])
      expect(Object.keys(def.properties.options.properties).sort()).toEqual(Object.keys(areas[area].options).sort())
      expect(def.properties.options.additionalProperties).toBe(false)
    }
  })

  it('values.yaml has a block for every provider area', () => {
    const values = readFileSync(path.join(CHART, 'values.yaml'), 'utf8')
    const block = values.slice(values.indexOf('\nproviders:\n'), values.indexOf('\nlogExport:'))
    for (const area of PROVIDER_AREAS) expect(block).toMatch(new RegExp(`\\n  ${area}:\\n    # `))
  })
})

describe('air-gapped bundle signing', () => {
  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  function makeBundle() {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bundle-test-'))
    dirs.push(dir)
    mkdirSync(path.join(dir, 'images'))
    writeFileSync(path.join(dir, 'README.md'), '# bundle\n')
    writeFileSync(path.join(dir, 'images/images.txt'), 'app.tar.gz usertasks:1 app\n')
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    writeFileSync(path.join(dir, 'signing-key.pub.pem'), publicKey.export({ type: 'spki', format: 'pem' }))
    return { dir, privateKey, publicKey }
  }

  async function seal(dir: string, key: ReturnType<typeof generateKeyPairSync>['privateKey']) {
    const sums = await checksums(dir)
    writeFileSync(path.join(dir, 'SHA256SUMS'), sums)
    writeFileSync(path.join(dir, 'SHA256SUMS.sig'), sign(null, Buffer.from(sums), key))
  }

  it('uses the package-signing fingerprint format', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    expect(fingerprintOf(privateKey)).toBe(keyFingerprint(publicKeyBase64(privateKey)))
  })

  it('accepts an intact bundle signed by its key, and checks the expected fingerprint', async () => {
    const { dir, privateKey } = makeBundle()
    await seal(dir, privateKey)
    const ok = await verifyBundle(dir, fingerprintOf(privateKey))
    expect(ok).toMatchObject({ ok: true, problems: [], files: 3 })
    const other = generateKeyPairSync('ed25519').privateKey
    const wrong = await verifyBundle(dir, fingerprintOf(other))
    expect(wrong.ok).toBe(false)
    expect(wrong.problems.join()).toMatch(/is not the expected/)
  })

  it('rejects a changed file, an added file and a signature by another key', async () => {
    const { dir, privateKey } = makeBundle()
    await seal(dir, privateKey)
    writeFileSync(path.join(dir, 'README.md'), '# changed\n')
    expect((await verifyBundle(dir)).problems).toContain('checksum mismatch: README.md')
    writeFileSync(path.join(dir, 'README.md'), '# bundle\n')
    writeFileSync(path.join(dir, 'images/extra.tar.gz'), 'x')
    expect((await verifyBundle(dir)).problems).toContain('not covered by SHA256SUMS: images/extra.tar.gz')
    rmSync(path.join(dir, 'images/extra.tar.gz'))
    expect((await verifyBundle(dir)).ok).toBe(true)
    // Re-signed SHA256SUMS by someone else, with the original public key left in place.
    const sums = readFileSync(path.join(dir, 'SHA256SUMS'))
    writeFileSync(path.join(dir, 'SHA256SUMS.sig'), sign(null, sums, generateKeyPairSync('ed25519').privateKey))
    expect((await verifyBundle(dir)).problems.join()).toMatch(/signature check failed/)
  })

  it('maps image references onto a private registry', () => {
    expect(targetRef('postgres:16-alpine', 'registry.corp:5000/usertasks')).toBe('registry.corp:5000/usertasks/postgres:16-alpine')
    expect(targetRef('pgsty/minio:latest', 'r.corp/ut/')).toBe('r.corp/ut/pgsty/minio:latest')
    expect(targetRef('quay.io/keycloak/keycloak:26.0', 'r.corp/ut')).toBe('r.corp/ut/keycloak/keycloak:26.0')
    expect(targetRef('localhost/usertasks:1', 'r.corp/ut')).toBe('r.corp/ut/usertasks:1')
  })
})

describe('air-gapped bundle build args', () => {
  it('accepts only the Dockerfile’s optional-driver args', async () => {
    const { driverBuildArgs, DRIVER_BUILD_ARGS } = await import('../scripts/bundle')
    expect(DRIVER_BUILD_ARGS.sort()).toEqual(['INCLUDE_OPTIONAL_DB_DRIVERS', 'INCLUDE_PROVIDER_SDKS', 'INCLUDE_STORAGE_SDKS'])
    const dockerfile = readFileSync(path.resolve(__dirname, '../Dockerfile'), 'utf8')
    for (const arg of DRIVER_BUILD_ARGS) expect(dockerfile).toContain(`ARG ${arg}=`)
    expect(driverBuildArgs(['INCLUDE_OPTIONAL_DB_DRIVERS=true'])).toEqual({ INCLUDE_OPTIONAL_DB_DRIVERS: 'true' })
    expect(() => driverBuildArgs(['NEXT_PUBLIC_APP_URL=https://x'])).toThrow(/expected one of/)
    expect(() => driverBuildArgs(['INCLUDE_STORAGE_SDKS=yes'])).toThrow()
  })
})
