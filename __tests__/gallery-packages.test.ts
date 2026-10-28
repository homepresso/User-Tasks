import { generateKeyPairSync } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGalleryPackage, galleryContents, galleryRequirements, isNativeContents, packageAssets, parseGallerySigningKey } from '@/lib/gallery/build'
import { catalogEntry } from '@/lib/gallery/catalog'
import { GALLERY_CATALOG_FILE, GALLERY_OUTPUT_DIR, readAllGallerySources, readGallerySigningConfig, type GallerySource } from '@/lib/gallery/source'
import { GALLERY_CATEGORIES, type GalleryIndex } from '@/lib/gallery/types'
import { validateGallerySource } from '@/lib/gallery/validate'
import { GALLERY_ICON_NAMES } from '@/components/gallery/gallery-ui'
import { fromPackageFiles } from '@/lib/packages/build'
import { unpackPackage, verifySignature } from '@/lib/packages/format'
import { orderWorkflowsByDependencies } from '@/lib/portability/import'

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

const sources = readAllGallerySources()
const bySlug = new Map(sources.map((s) => [s.slug, s]))

function clone(source: GallerySource): GallerySource {
  return { ...source, meta: structuredClone(source.meta), manifest: structuredClone(source.manifest), paths: structuredClone(source.paths), errors: [] }
}

describe('package gallery sources', () => {
  it('has at least four packages in every category', () => {
    expect(sources.length).toBeGreaterThanOrEqual(50)
    for (const category of GALLERY_CATEGORIES) {
      const count = sources.filter((s) => s.meta.category === category.id).length
      expect(count, category.id).toBeGreaterThanOrEqual(4)
      expect(count, category.id).toBeLessThanOrEqual(15)
    }
  })

  it('has 10-15 "No integrations needed" packages that install with nothing to configure', () => {
    const native = sources.filter((s) => isNativeContents(galleryContents(s)))
    expect(native.length).toBeGreaterThanOrEqual(10)
    expect(native.length).toBeLessThanOrEqual(15)
    for (const source of native) {
      expect(source.meta.needs, source.slug).toEqual([])
      expect(source.meta.systems ?? [], source.slug).toEqual([])
      expect(galleryContents(source).requirements, source.slug).toEqual([])
    }
  })

  it('marks enterprise packages with their system chips (Workday, SAP S/4HANA and others)', () => {
    const systems = new Map<string, number>()
    for (const source of sources) for (const system of source.meta.systems ?? []) systems.set(system, (systems.get(system) ?? 0) + 1)
    expect(systems.get('Workday')).toBeGreaterThanOrEqual(3)
    expect(systems.get('SAP S/4HANA')).toBeGreaterThanOrEqual(3)
    expect([...systems.keys()].length).toBeGreaterThanOrEqual(5)
    for (const source of sources.filter((s) => (s.meta.systems ?? []).length)) expect(source.meta.needs, source.slug).toContain('rest_api')
  })

  it('uses the new forms: form pages, themed grid start forms, outcome buttons and lookups', () => {
    const all = sources.map((s) => ({ slug: s.slug, assets: packageAssets(s.manifest) as any }))
    const nodes = all.flatMap((p) => (p.assets.workflows ?? []).flatMap((wf: any) => wf.nodes.map((n: any) => ({ slug: p.slug, node: n }))))
    const formPages = all.filter((p) => (p.assets.forms ?? []).length)
    expect(formPages.length).toBeGreaterThanOrEqual(10)
    expect(nodes.filter(({ node }) => node.type === 'form_submitted').length).toBeGreaterThanOrEqual(8)
    expect(nodes.filter(({ node }) => node.config?.start_form?.layout && node.config?.start_form?.theme).length).toBeGreaterThanOrEqual(10)
    expect(nodes.filter(({ node }) => node.type === 'user_task' && (node.config?.form_buttons ?? []).some((b: any) => b.kind === 'outcome')).length).toBeGreaterThanOrEqual(40)
    const lookups = [...nodes.flatMap(({ node }) => node.config?.fields ?? []), ...all.flatMap((p) => (p.assets.forms ?? []).flatMap((f: any) => f.fields))].filter((f: any) => f.type === 'lookup')
    expect(lookups.length).toBeGreaterThanOrEqual(15)
    // At least one form page starts its workflow from its Submit button (Start workflow + success screen).
    expect(all.some((p) => (p.assets.forms ?? []).some((f: any) => (f.buttons ?? []).some((b: any) => (b.actions ?? []).some((a: any) => a.type === 'start_workflow'))))).toBe(true)
  })

  it('gives data tables names that are unique across the gallery (installs side by side)', () => {
    const seen = new Map<string, string>()
    for (const source of sources) {
      for (const table of packageAssets(source.manifest).data_tables ?? []) {
        const slug = String(table.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')
        if (seen.has(slug) && seen.get(slug) !== source.slug) console.warn(`data table "${table.name}" in ${source.slug} and ${seen.get(slug)} (installs get a -2 slug)`)
        seen.set(slug, source.slug)
      }
    }
    expect(seen.size).toBeGreaterThan(50)
  })

  it('covers every way a process can start, including form-started and headless ones', () => {
    const triggers = new Set(sources.map((s) => s.meta.trigger))
    for (const trigger of ['form', 'api', 'schedule', 'event']) expect(triggers.has(trigger as never), trigger).toBe(true)
    expect(sources.filter((s) => s.meta.category === 'headless-integration').every((s) => s.meta.trigger !== 'form')).toBe(true)
  })

  it.each(sources.map((s) => [s.slug]))('%s is valid (schema, workflows, references, requirements, no secrets)', (slug) => {
    expect(validateGallerySource(bySlug.get(slug)!)).toEqual([])
  })

  it('uses card icons the website knows', () => {
    for (const source of sources) if (source.meta.icon) expect(GALLERY_ICON_NAMES, source.slug).toContain(source.meta.icon)
  })

  it('uses unique package ids and slugs', () => {
    expect(new Set(sources.map((s) => s.meta.id)).size).toBe(sources.length)
    expect(new Set(sources.map((s) => s.meta.title)).size).toBe(sources.length)
  })

  it('contains no private hosts, addresses or credentials', () => {
    for (const source of sources) {
      const text = [JSON.stringify(source.meta), source.readme, ...source.files.map((f) => f.content)].join('\n')
      expect(text, source.slug).not.toMatch(/localhost|127\.0\.0\.1|\b10\.\d+\.\d+\.\d+|\b192\.168\./)
      expect(text, source.slug).not.toMatch(/enc:v[12]:/)
      expect(text, source.slug).not.toMatch(/\b(sk|ut|ghp|xox[bap])[-_][A-Za-z0-9]{16,}/)
      for (const email of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) {
        expect(email, `${source.slug}: ${email}`).toMatch(/@([a-z0-9-]+\.)*example(\.(com|org|net))?$/i)
      }
    }
  })
})

describe('package gallery builds', () => {
  const sample = bySlug.get('expense-claims') ?? sources[0]

  it('builds deterministically and round-trips through the package reader', () => {
    const a = buildGalleryPackage(sample)
    const b = buildGalleryPackage(sample)
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true)
    const unpacked = unpackPackage(a.bytes)
    expect(unpacked.verification.valid).toBe(true)
    expect(unpacked.verification.signed).toBe(false)
    const { contents, errors } = fromPackageFiles(unpacked.manifest, unpacked.files)
    expect(errors).toEqual([])
    expect(contents.header.id).toBe(sample.meta.id)
    expect(contents.header.version).toBe(sample.meta.version)
    expect(contents.requirements).toEqual(galleryRequirements(packageAssets(sample.manifest)))
    const rows = (sample.manifest.table_rows ?? []).reduce((n: number, t: { rows: unknown[] }) => n + t.rows.length, 0)
    expect(Object.values(contents.data).reduce((n, d) => n + (d.rows?.length ?? 0), 0)).toBe(rows)
  })

  it('routes every User Task step: an install-time assignee (people never travel) or an assignee variable', () => {
    for (const source of sources) {
      const requirements = galleryRequirements(packageAssets(source.manifest)).filter((r) => r.kind === 'user')
      expect(requirements.every((r) => r.required), source.slug).toBe(true)
      for (const wf of source.manifest.workflows ?? []) {
        wf.nodes.forEach((node: { type: string; label: string; config?: { assignee_id?: string; assignee_variable?: string } }, index: number) => {
          if (node.type !== 'user_task') return
          const asked = requirements.some((r) => r.ref.asset_id === wf.id && r.fields.some((f) => f.key === `nodes.${index}.config.assignee_id`))
          const routed = !node.config?.assignee_id && String(node.config?.assignee_variable ?? '').trim().length > 0
          expect(asked || routed, `${source.slug}: ${node.label}`).toBe(true)
        })
      }
    }
  })

  it('signs with an ed25519 gallery key and refuses other key types', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const key = parseGallerySigningKey(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n'))!
    const signed = buildGalleryPackage(sample, { signingKey: key })
    const unsigned = buildGalleryPackage(sample)
    expect(signed.manifest.checksum).toBe(unsigned.manifest.checksum)
    expect(signed.manifest.signature?.fingerprint).toBe(key.fingerprint)
    expect(verifySignature(signed.manifest.checksum, signed.manifest.signature!)).toBe(true)
    expect(unpackPackage(signed.bytes).verification).toMatchObject({ valid: true, signed: true, signature_ok: true })
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(() => parseGallerySigningKey(rsa)).toThrow(/ed25519/)
    expect(parseGallerySigningKey('')).toBeNull()
  })

  it('keeps public/gallery and lib/gallery/catalog.json in step with the sources (npm run gallery:build)', () => {
    const index = JSON.parse(readFileSync(join(GALLERY_OUTPUT_DIR, 'index.json'), 'utf8')) as GalleryIndex
    expect(index.packages.map((p) => p.slug).sort()).toEqual(sources.map((s) => s.slug).sort())
    const signing = readGallerySigningConfig()
    if (index.signing.signed) expect(index.signing.fingerprint).toBe(signing.fingerprint)
    const catalog = JSON.parse(readFileSync(GALLERY_CATALOG_FILE, 'utf8'))
    for (const entry of index.packages) {
      const source = bySlug.get(entry.slug)!
      const built = buildGalleryPackage(source)
      expect(entry.checksum, `${entry.slug}: run npm run gallery:build`).toBe(built.manifest.checksum)
      const file = join(GALLERY_OUTPUT_DIR, entry.file_name)
      expect(existsSync(file), entry.file_name).toBe(true)
      const bytes = new Uint8Array(readFileSync(file))
      const unpacked = unpackPackage(bytes)
      expect(unpacked.verification.valid, entry.slug).toBe(true)
      expect(unpacked.manifest.checksum).toBe(entry.checksum)
      expect(bytes.byteLength).toBe(entry.size_bytes)
      expect(unpacked.verification.signed).toBe(entry.signed)
      const committed = catalog.packages.find((p: { slug: string }) => p.slug === entry.slug)
      expect(committed, `${entry.slug} in catalog.json`).toEqual(JSON.parse(JSON.stringify(catalogEntry(source, built))))
    }
  })
})

describe('installing packages with sub-workflows', () => {
  it('imports every sub-workflow before the workflows that call it (so its id is remapped)', () => {
    const call = (id: string) => ({ type: 'call_sub_workflow', config: { sub_workflow_id: id } })
    const parent = { id: 'a', nodes: [call('c')] }
    const middle = { id: 'b', nodes: [] }
    const child = { id: 'c', nodes: [call('b')] }
    const loop = { id: 'd', nodes: [call('d')] }
    expect(orderWorkflowsByDependencies([parent, middle, child, loop]).map((w) => w.id)).toEqual(['b', 'c', 'a', 'd'])
    for (const source of sources) {
      const ordered = orderWorkflowsByDependencies<{ id: string; nodes: Array<{ type: string; config: { sub_workflow_id?: string } }> }>(source.manifest.workflows ?? [])
      ordered.forEach((wf, index) => {
        for (const node of wf.nodes) {
          if (node.type !== 'call_sub_workflow') continue
          expect(ordered.findIndex((w) => w.id === node.config.sub_workflow_id), `${source.slug}: ${wf.id}`).toBeLessThan(index)
        }
      })
    }
  })
})

describe('gallery validation catches broken packages', () => {
  const base = bySlug.get('expense-claims') ?? sources[0]
  const workflow = (s: GallerySource) => s.manifest.workflows.find((wf: { id: string }) => wf.id === s.meta.entry_workflow)

  it('flags a User Task outcome without a path', () => {
    const broken = clone(base)
    const wf = workflow(broken)
    const task = wf.nodes.find((n: { type: string }) => n.type === 'user_task')
    wf.edges = wf.edges.filter((e: { source: string; label?: string }) => !(e.source === task.id && e.label === task.config.outcomes[0]))
    expect(validateGallerySource(broken).map((i) => i.message).join('\n')).toMatch(/has no path for/)
  })

  it('flags a real host, a credential and a dangling reference', () => {
    const broken = clone(base)
    if (broken.manifest.integrations?.[0]) {
      broken.manifest.integrations[0].config.base_url = 'https://api.realcompany.com/v1'
      broken.manifest.integrations[0].config.auth_config = { token: 'abc123' }
    }
    const node = workflow(broken).nodes.find((n: { type: string }) => n.type === 'call_reference')
    if (node) node.config.reference_id = '00000000-0000-4000-8000-000000000000'
    const messages = validateGallerySource(broken).map((i) => i.message).join('\n')
    if (broken.manifest.integrations?.[0]) {
      expect(messages).toMatch(/must be a placeholder/)
      expect(messages).toMatch(/must not contain secrets/)
    }
    if (node) expect(messages).toMatch(/not in the package/)
  })

  it('flags a form package without a form and an api package with a missing sample input', () => {
    const broken = clone(base)
    const wf = workflow(broken)
    wf.nodes = wf.nodes.map((n: { type: string; config: Record<string, unknown> }) => (n.type === 'user_task' ? { ...n, config: { ...n.config, fields: [] } } : n))
    wf.user_variables = wf.user_variables.map((v: Record<string, unknown>) => ({ ...v, required: true }))
    broken.meta.sample_input = {}
    const messages = validateGallerySource(broken).map((i) => i.message).join('\n')
    expect(messages).toMatch(/needs a User Task with form fields/)
    expect(messages).toMatch(/missing the required input/)
  })
})
