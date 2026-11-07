/**
 * Official gallery form controls (gallery/controls): every source passes the
 * contract checks (manifest, self-contained module under the limit, build
 * banner = manifest dependencies with permissive licences, a11y + display
 * metadata), packages build deterministically, sign with the gallery key and
 * carry their control through the package format; the community gallery
 * refuses form controls; the host-side rules of the new file / report
 * services hold.
 */
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GALLERY_OUTPUT_DIR } from '@/lib/gallery/source'
import type { GalleryIndex } from '@/lib/gallery/types'
import { describe, expect, it } from 'vitest'
import {
  buildControlBundlePackage, buildControlPackage, bundlePackageSlug, controlAsset, controlPackageSlug, controlCatalogEntry, controlIndexEntry, readAllControlBundleSources, readAllControlSources,
  readBundleBanner, validateControlBundleSource, validateControlSource, PERMISSIVE_LICENCES,
} from '@/lib/gallery/controls'
import { parseGallerySigningKey } from '@/lib/gallery/build'
import { validateCommunityPackage } from '@/lib/gallery/community'
import { validateMeta } from '@/lib/gallery/validate'
import { readAllGallerySources } from '@/lib/gallery/source'
import { fromPackageFiles, toPackageFiles } from '@/lib/packages/build'
import { unpackPackage } from '@/lib/packages/format'
import { parseFormControlManifest } from '@/lib/forms/custom-controls/manifest'
import { PACKAGE_LIMITS } from '@/lib/forms/custom-controls/contract'
import { networkControls } from '@/lib/forms/custom-controls/package'
import { controlReportId, readableFileIds } from '@/lib/forms/custom-controls/field'
import { reportIdOfField } from '@/lib/services/form-control-report'

const controls = readAllControlSources()
const bySlug = new Map(controls.map((c) => [c.slug, c]))
const bundles = readAllControlBundleSources()

describe('gallery form control sources', () => {
  it('has at least eight official controls', () => {
    expect(controls.length).toBeGreaterThanOrEqual(8)
  })

  it.each(controls.map((c) => [c.slug, c] as const))('%s passes the contract checks', (_slug, source) => {
    expect(validateControlSource(source, bySlug)).toEqual([])
    const manifest = source.manifest!
    expect(manifest.tag).toMatch(/^ut-/)
    expect(Buffer.byteLength(source.bundle)).toBeLessThanOrEqual(PACKAGE_LIMITS.moduleBytes)
    // Accessibility metadata, a read-only formatter, theme tokens and the contract events.
    expect(manifest.accessibility?.role).toBeTruthy()
    expect(manifest.accessibility?.keyboard?.length).toBeGreaterThan(20)
    expect(manifest.display?.template || manifest.display?.format).toBeTruthy()
    expect(source.bundle).toContain('--ut-')
    expect(source.bundle).toContain('ut-change')
    expect(source.bundle).toMatch(/customElements\.(define|get)/)
    // No external imports or remote code.
    expect(source.bundle).not.toMatch(/\bimport\s*\(\s*["'`]https?:/)
    // Licences: banner = manifest.dependencies, permissive only.
    const banner = readBundleBanner(source.bundle)!
    expect(banner.tag).toBe(manifest.tag)
    for (const lib of banner.libraries) expect(PERMISSIVE_LICENCES.has(lib.licence)).toBe(true)
    expect(Object.fromEntries(banner.libraries.map((l) => [l.name, l.version]))).toEqual(manifest.dependencies ?? {})
    // A capability-free control has no network; a network control names its hosts and services.
    if (manifest.capabilities.includes('network')) {
      expect(manifest.network?.allowed_hosts.length).toBeGreaterThan(0)
      expect(source.meta.systems?.length).toBeGreaterThan(0)
    }
  })

  it('uses unique ids, tags and slugs', () => {
    const ids = controls.flatMap((c) => [c.meta.id, c.meta.asset_id]).concat(bundles.map((b) => b.meta.id))
    expect(new Set(ids).size).toBe(ids.length)
    const tags = controls.map((c) => c.manifest?.tag)
    expect(new Set(tags).size).toBe(tags.length)
    const processIds = new Set(readAllGallerySources().map((s) => s.meta.id))
    for (const id of ids) expect(processIds.has(id)).toBe(false)
  })

  it('bundles list existing controls', () => {
    for (const bundle of bundles) expect(validateControlBundleSource(bundle, bySlug)).toEqual([])
  })

  it('workflow packages may not claim the form controls category', () => {
    const source = readAllGallerySources()[0]
    expect(validateMeta({ ...source.meta, category: 'form-controls' as never }, source.slug).map((i) => i.message).join(' ')).toMatch(/form controls live in gallery\/controls/)
  })
})

describe('gallery form control packages', () => {
  const rating = bySlug.get('rating')!

  it('build deterministically and round-trip the control through the package format', () => {
    const a = buildControlPackage(rating)
    const b = buildControlPackage(rating)
    expect(a.manifest.checksum).toBe(b.manifest.checksum)
    expect(a.fileName).toBe(`form-control-rating-${rating.meta.version}.utpkg`)
    const unpacked = unpackPackage(a.bytes)
    expect(unpacked.verification.valid).toBe(true)
    const { contents, errors } = fromPackageFiles(unpacked.manifest, unpacked.files)
    expect(errors).toEqual([])
    const [control] = (contents.assets as Record<string, any[]>).form_controls
    expect(control).toMatchObject({ id: rating.meta.asset_id, tag: 'ut-rating', enabled: true })
    expect(control.versions[0].bundle).toBe(rating.bundle)
    expect(parseFormControlManifest(control.versions[0].manifest).tag).toBe('ut-rating')
  })

  it('sign with the gallery key like every gallery package', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const key = parseGallerySigningKey(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString())!
    const pkg = buildControlPackage(rating, { signingKey: key })
    const unpacked = unpackPackage(pkg.bytes)
    expect(unpacked.verification).toMatchObject({ valid: true, signed: true, signature_ok: true, fingerprint: key.fingerprint })
    // Signing does not change the checksum (gallery:check compares unsigned builds).
    expect(pkg.manifest.checksum).toBe(buildControlPackage(rating).manifest.checksum)
  })

  it('index and catalog entries describe the control', () => {
    const pkg = buildControlPackage(rating)
    const entry = controlIndexEntry(rating.meta, 'form_control', '/gallery/controls/rating', pkg, [rating])
    expect(entry).toMatchObject({ kind: 'form_control', category: 'form-controls', slug: 'form-control-rating', page: '/gallery/controls/rating', source: 'official' })
    expect(entry.control).toMatchObject({ tags: ['ut-rating'], value_types: ['number'], capabilities: [], hosts: [] })
    expect(entry.trigger).toBeUndefined()
    const catalog = controlCatalogEntry(rating, pkg)
    expect(catalog.controls[0]).toMatchObject({ tag: 'ut-rating', kind: 'input' })
    expect(catalog.controls[0].libraries.map((l) => l.licence)).toContain('BSD-3-Clause')
  })

  it('workflow packages that use a control are listed on its page ("Used in")', async () => {
    const { packagesUsingControls, GALLERY_PACKAGES } = await import('@/lib/gallery/site')
    const processes = readAllGallerySources()
    for (const control of controls) {
      const tag = control.manifest!.tag
      const expected = processes.filter((s) => s.controls.some((c) => c.tag === tag)).map((s) => s.slug).filter((slug) => GALLERY_PACKAGES.some((p) => p.slug === slug)).sort()
      expect(packagesUsingControls([tag]).map((p) => p.slug).sort(), tag).toEqual(expected)
      if (tag !== 'ut-address' && tag !== 'ut-map') expect(expected.length, `${tag} is used by a gallery package`).toBeGreaterThanOrEqual(1)
    }
  })

  it('public/gallery is in step with the control sources (npm run gallery:build)', () => {
    const index = JSON.parse(readFileSync(join(GALLERY_OUTPUT_DIR, 'index.json'), 'utf8')) as GalleryIndex
    const entries = index.packages.filter((p) => p.kind === 'form_control' || p.kind === 'control_bundle')
    // Until the first build with controls (the release build) the index may not list them yet.
    if (!entries.length) return
    expect(entries.map((e) => e.slug).sort()).toEqual([...controls.map((c) => controlPackageSlug(c.slug)), ...bundles.map((b) => bundlePackageSlug(b.slug))].sort())
    for (const entry of entries) {
      const control = controls.find((c) => controlPackageSlug(c.slug) === entry.slug)
      const built = control ? buildControlPackage(control, { all: bySlug }) : buildControlBundlePackage(bundles.find((b) => bundlePackageSlug(b.slug) === entry.slug)!, bySlug)
      expect(entry.checksum, `${entry.slug}: run npm run gallery:build`).toBe(built.manifest.checksum)
      const unpacked = unpackPackage(new Uint8Array(readFileSync(join(GALLERY_OUTPUT_DIR, entry.file_name))))
      expect(unpacked.verification.valid).toBe(true)
      expect(unpacked.manifest.checksum).toBe(entry.checksum)
    }
  })

  it('a sample form\'s other official controls ship in the same package (address → map)', () => {
    const address = bySlug.get('address')!
    const tags = ((buildControlPackage(address, { all: bySlug }).contents.assets as Record<string, any[]>).form_controls).map((c) => c.tag)
    expect(tags).toEqual(['ut-address', 'ut-map'])
  })

  it('a sample form may only use controls that ship in the package', () => {
    const address = bySlug.get('address')!
    // Alone (no other official controls known), the map its sample form uses would be missing.
    expect(validateControlSource(address).map((i) => i.message).join('\n')).toMatch(/uses form control ut-map, which is not in the package/)
    expect(validateControlSource(address, bySlug)).toEqual([])
    // A tag that is not an official control is never allowed.
    const forms = JSON.parse(JSON.stringify(address.extras.forms)) as any[]
    forms[0].fields.find((f: any) => f.custom?.tag === 'ut-map').custom.tag = 'ut-nowhere'
    const broken = { ...address, extras: { ...address.extras, forms } }
    expect(validateControlSource(broken, bySlug).some((i) => i.message.includes('ut-nowhere'))).toBe(true)
  })

  it('the install summary lists the network hosts the package\'s controls need (address → map tiles)', () => {
    const address = bySlug.get('address')!
    const assets = buildControlPackage(address, { all: bySlug }).contents.assets as Record<string, unknown>
    expect(networkControls(assets)).toEqual([{ tag: 'ut-map', name: 'Map', hosts: ['tile.openstreetmap.org'] }])
  })

  it('every control and bundle builds', () => {
    for (const source of controls) expect(() => buildControlPackage(source)).not.toThrow()
    for (const bundle of bundles) {
      const pkg = buildControlBundlePackage(bundle, bySlug)
      expect((pkg.contents.assets as Record<string, unknown[]>).form_controls.length).toBe(bundle.meta.controls.length)
    }
  })

  it('the community gallery refuses form controls (official only)', () => {
    const result = validateCommunityPackage(buildControlPackage(rating).bytes)
    expect(result.ok).toBe(false)
    expect(result.issues.map((i) => i.message).join(' ')).toMatch(/custom form controls/)
  })

  it('form controls travel in the config-as-code layout (packages, config export)', () => {
    const asset = controlAsset(rating)
    const files = toPackageFiles({ header: { id: rating.meta.id, name: 'x', slug: 'x', version: '1.0.0', description: '', author: 'a', created_at: '2026-10-31T00:00:00.000Z' } as never, assets: { form_controls: [asset] }, data: {}, requirements: [], dependencies: [] }).files
    expect(files.map((f) => f.path)).toContain(`assets/form-controls/rating-${rating.meta.asset_id.slice(0, 8)}.json`)
  })
})

describe('file and report host services', () => {
  it('a control reads only files in its value or context', () => {
    const ids = readableFileIds([{ id: 'own' }], { doc: [{ id: 'ctx' }, { id: '../x' }], other: 'text' })
    expect([...ids].sort()).toEqual(['ctx', 'own'])
    expect(readableFileIds(null, null).size).toBe(0)
  })

  it('a report comes from the field config of a reports control only', () => {
    const id = '0b9f6a4e-7c1d-4e2a-9f3b-1a2b3c4d5e6f'
    expect(controlReportId({ capabilities: ['reports'], props: { report_id: ` ${id.toUpperCase()} ` } })).toBe(id)
    expect(controlReportId({ capabilities: ['lookup'], props: { report_id: id } })).toBeNull()
    expect(controlReportId({ capabilities: ['reports'], props: { report_id: 'not-a-uuid' } })).toBeNull()
    const field = { key: 'r', type: 'custom', label: 'R', custom: { tag: 'ut-saved-report', version: '1.0.0', value_type: 'json', capabilities: ['reports'], props: { report_id: id } } }
    expect(reportIdOfField(field as never)).toBe(id)
    expect(reportIdOfField({ ...field, type: 'text' } as never)).toBeNull()
  })
})

describe('map tile service', () => {
  it('validates tile coordinates', async () => {
    const { tileCoords } = await import('@/lib/services/form-control-tiles')
    expect(tileCoords('12', '4036', '2564.png')).toEqual({ z: 12, x: 4036, y: 2564 })
    expect(tileCoords(2, 4, 0)).toBeNull()
    expect(tileCoords(20, 0, 0)).toBeNull()
    expect(tileCoords('1', '../', '0')).toBeNull()
  })

  it('fetches with an identifying User-Agent and Referer, checks the type and caches', async () => {
    const { clearTileCache, fetchTile } = await import('@/lib/services/form-control-tiles')
    clearTileCache()
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> })
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })
    }) as unknown as typeof fetch
    const a = await fetchTile({ z: 3, x: 1, y: 2 }, { fetch: fake })
    await fetchTile({ z: 3, x: 1, y: 2 }, { fetch: fake })
    expect(a.type).toBe('image/png')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://tile.openstreetmap.org/3/1/2.png')
    expect(calls[0].headers['User-Agent']).toMatch(/UserTasks/)
    expect(calls[0].headers.Referer).toMatch(/^https?:\/\//)
    const html = (async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch
    await expect(fetchTile({ z: 3, x: 2, y: 2 }, { fetch: html })).rejects.toThrow(/not return an image/)
  })

  it('serves a workspace control only when the tile host is approved', async () => {
    const { controlTile } = await import('@/lib/services/form-control-tiles')
    const db = (row: unknown) => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }) }) })
    const ctx = (row: unknown) => ({ tenantId: 't1', actorId: 'u1', permissions: null, supabase: db(row), db: db(row) }) as never
    await expect(controlTile(ctx({ enabled: true, approved_hosts: [] }), 'ut-map', { z: 1, x: 0, y: 0 })).rejects.toThrow(/not approved/)
    await expect(controlTile(ctx({ enabled: false, approved_hosts: ['tile.openstreetmap.org'] }), 'ut-map', { z: 1, x: 0, y: 0 })).rejects.toThrow(/not found/)
    await expect(controlTile(ctx(null), 'ut-map', { z: 1, x: 0, y: 0 })).rejects.toThrow(/not found/)
  })

  it('the bridge accepts tile requests in range only, under network', async () => {
    const { acceptFrameMessage } = await import('@/lib/forms/custom-controls/bridge')
    const frameWindow = {}
    const req = (payload: unknown, capabilities: Array<'network' | 'lookup'>) => acceptFrameMessage({ source: frameWindow, origin: 'null', data: { ut: 1, channel: 'c', type: 'request', request_id: 'r1', kind: 'tile', payload } }, { frameWindow, channel: 'c', capabilities })
    expect(req({ z: 2, x: 3, y: 1 }, ['network'])).toMatchObject({ ok: true, message: { payload: { z: 2, x: 3, y: 1 } } })
    expect(req({ z: 2, x: 4, y: 1 }, ['network'])).toMatchObject({ ok: false, reason: 'shape' })
    expect(req({ z: 2, x: 1, y: 1, url: 'https://evil' }, ['network'])).toMatchObject({ ok: true, message: { payload: { z: 2, x: 1, y: 1 } } })
    expect(req({ z: 2, x: 1, y: 1 }, ['lookup'])).toMatchObject({ ok: false, reason: 'capability' })
  })
})
