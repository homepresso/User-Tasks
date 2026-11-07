/**
 * Official form controls in the gallery: sources in gallery/controls/<slug>/
 * (manifest.json, the built single-module bundle in dist/, gallery.json,
 * README.md and optional config-as-code extras in assets/ — e.g. the
 * Google Places integration and API reference the address control looks up
 * through), and bundles of them in gallery/controls/bundles/<slug>/.
 *
 * Each becomes a .utpkg like the workflow packages (same layout, same
 * signing key — scripts/gallery-build.ts), whose `form_controls` section
 * installs into Extensibility → Form controls. Official only: the community
 * gallery refuses packages with form controls (lib/gallery/community.ts).
 *
 * Node only (fs); used by the build script, the tests and the verifier.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { filesToManifest, type RepoFile } from '@/lib/github-sync/layout'
import { PACKAGE_LIMITS, type FormControlManifest } from '@/lib/forms/custom-controls/contract'
import { PackageError, parseModulePackage, sha256Hex } from '@/lib/forms/custom-controls/package'
import { normalizeCustomControlConfig } from '@/lib/forms/custom-controls/field'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { isSemver } from '@/lib/packages/semver'
import type { PackageContents } from '@/lib/packages/build'
import { scanAssetReferences } from '@/lib/portability/dependencies'
import { isUuid } from '@/lib/portability/plan'
import { scrubSecretsForExport, SECRET_PLACEHOLDER } from '@/lib/portability/scrub'
import { GALLERY_AUTHOR, galleryRequirements, packGalleryContents, packageAssets, type BuiltGalleryPackage, type GallerySigningKey } from './build'
import type { ControlBundleMeta, ControlGalleryMeta, GalleryControlSummary, GalleryIndexEntry } from './types'
import { FORM_CONTROLS_CATEGORY } from './types'
import { formIssues, type GalleryIssue } from './validate'
import type { ControlCatalogEntry, ControlCatalogItem, CatalogRequirement } from './catalog'

/** gallery/controls (not via ./source: source.ts reads the official controls a workflow package ships). */
export const GALLERY_CONTROLS_DIR = resolve(process.cwd(), 'gallery', 'controls')
export const GALLERY_CONTROL_BUNDLES_DIR = join(GALLERY_CONTROLS_DIR, 'bundles')
const NOT_CONTROLS = new Set(['node_modules', 'scripts', 'shared', 'harness', 'bundles'])

/** Licences a bundled library may have (permissive; no copyleft in a control the gallery signs). */
export const PERMISSIVE_LICENCES = new Set(['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'ISC', '0BSD'])

/** Config-as-code sections a control package may carry besides its control (no workflows, agents or code). */
const EXTRA_SECTIONS = new Set(['integrations', 'references', 'forms', 'form_themes', 'data_tables'])

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export interface ControlSource {
  dir: string
  slug: string
  meta: ControlGalleryMeta
  readme: string
  manifestRaw: unknown
  /** The validated manifest (null when it does not parse). */
  manifest: FormControlManifest | null
  /** The committed single-module bundle (dist/<entry>). */
  bundle: string
  /** Config-as-code extras (assets/), as filesToManifest reads them. */
  extras: Record<string, any>
  paths: Record<string, string[]>
  errors: Array<{ path: string; error: string }>
}

export interface ControlBundleSource {
  dir: string
  slug: string
  meta: ControlBundleMeta
  readme: string
  errors: Array<{ path: string; error: string }>
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

function readJson(path: string, errors: ControlSource['errors'], label: string): any {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    errors.push({ path: label, error: (error as Error).message })
    return null
  }
}

/** Control folders (gallery/controls/<slug> with gallery.json and manifest.json), sorted. */
export function listControlSlugs(root = GALLERY_CONTROLS_DIR): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root).filter((name) => !NOT_CONTROLS.has(name) && !name.startsWith('.') && statSync(join(root, name)).isDirectory()
    && existsSync(join(root, name, 'gallery.json')) && existsSync(join(root, name, 'manifest.json'))).sort()
}

export function listControlBundleSlugs(root = GALLERY_CONTROL_BUNDLES_DIR): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory() && existsSync(join(root, name, 'gallery.json'))).sort()
}

export function readControlSource(slug: string, root = GALLERY_CONTROLS_DIR): ControlSource {
  const dir = join(root, slug)
  const errors: ControlSource['errors'] = []
  const meta = readJson(join(dir, 'gallery.json'), errors, `controls/${slug}/gallery.json`) ?? {}
  const manifestRaw = readJson(join(dir, 'manifest.json'), errors, `controls/${slug}/manifest.json`)
  const readmePath = join(dir, 'README.md')
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : ''
  if (!readme.trim()) errors.push({ path: `controls/${slug}/README.md`, error: 'README.md is missing or empty' })
  const entry = typeof manifestRaw?.entry === 'string' ? manifestRaw.entry : `${manifestRaw?.tag ?? 'index'}.js`
  const bundlePath = join(dir, 'dist', entry)
  const bundle = existsSync(bundlePath) ? readFileSync(bundlePath, 'utf8') : ''
  if (!bundle) errors.push({ path: `controls/${slug}/dist/${entry}`, error: 'the built module is missing (cd gallery/controls && npm ci && npm run build)' })
  let manifest: FormControlManifest | null = null
  if (manifestRaw && bundle) {
    try {
      const parsed = parseModulePackage(bundle, manifestRaw)
      manifest = parsed.manifest
      for (const warning of parsed.warnings) errors.push({ path: `controls/${slug}`, error: warning })
    } catch (error) {
      errors.push({ path: `controls/${slug}/manifest.json`, error: error instanceof PackageError ? error.message : String(error) })
    }
  }
  const assetsDir = join(dir, 'assets')
  const files: RepoFile[] = existsSync(assetsDir)
    ? walk(assetsDir).filter((path) => path.endsWith('.json')).map((path) => ({ path: relative(assetsDir, path).split(sep).join('/'), content: readFileSync(path, 'utf8') }))
    : []
  const parsed = filesToManifest(files, '')
  errors.push(...parsed.errors.map((e) => ({ path: `controls/${slug}/assets/${e.path}`, error: e.error })))
  return { dir, slug, meta, readme, manifestRaw, manifest, bundle, extras: parsed.manifest, paths: parsed.paths, errors }
}

export function readControlBundleSource(slug: string, root = GALLERY_CONTROL_BUNDLES_DIR): ControlBundleSource {
  const dir = join(root, slug)
  const errors: ControlBundleSource['errors'] = []
  const meta = readJson(join(dir, 'gallery.json'), errors, `controls/bundles/${slug}/gallery.json`) ?? {}
  const readmePath = join(dir, 'README.md')
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : ''
  if (!readme.trim()) errors.push({ path: `controls/bundles/${slug}/README.md`, error: 'README.md is missing or empty' })
  return { dir, slug, meta, readme, errors }
}

export function readAllControlSources(root = GALLERY_CONTROLS_DIR): ControlSource[] {
  return listControlSlugs(root).map((slug) => readControlSource(slug, root))
}

export function readAllControlBundleSources(root = GALLERY_CONTROL_BUNDLES_DIR): ControlBundleSource[] {
  return listControlBundleSlugs(root).map((slug) => readControlBundleSource(slug, root))
}

/** Package slug of a control (`form-control-chart`) or a bundle (`form-controls-starter-pack`). */
export function controlPackageSlug(slug: string): string {
  return `form-control-${slug}`
}
export function bundlePackageSlug(slug: string): string {
  return `form-controls-${slug}`
}

export interface BundledLibrary { name: string; version: string; licence: string }

/**
 * The build banner on the first line of a control module:
 * `/*! <tag> <version> | UserTasks gallery form control | Apache-2.0 | bundles lit 3.3.3 (BSD-3-Clause), … *\/`.
 * Null when it is missing.
 */
export function readBundleBanner(bundle: string): { tag: string; version: string; libraries: BundledLibrary[] } | null {
  const first = bundle.slice(0, 2000).split('\n', 1)[0]
  const m = /^\/\*! (\S+) (\S+) \| UserTasks gallery form control \| Apache-2\.0(?: \| bundles (.+?))? \*\/$/.exec(first)
  if (!m) return null
  const libraries = (m[3] ?? '').split(', ').filter(Boolean).flatMap((part) => {
    const lib = /^(\S+) (\S+) \(([^)]+)\)$/.exec(part)
    return lib ? [{ name: lib[1], version: lib[2], licence: lib[3] }] : []
  })
  return { tag: m[1], version: m[2], libraries }
}

/**
 * Every problem with a control source (empty = valid). `all` (every control
 * source, by slug): a sample form may use another official control, which then
 * ships in the same package (companionControls); without it, only this
 * control's own tag is available.
 */
export function validateControlSource(source: ControlSource, all?: Map<string, ControlSource>): GalleryIssue[] {
  const { slug, meta, manifest, bundle } = source
  const at = `controls/${slug}/gallery.json`
  const issues: GalleryIssue[] = source.errors.map((e) => ({ path: e.path, message: e.error }))
  const need = (cond: unknown, message: string, path = at) => { if (!cond) issues.push({ path, message }) }
  need(isUuid(meta.id), 'id must be a uuid')
  need(isUuid(meta.asset_id) && meta.asset_id !== meta.id, 'asset_id must be a uuid (different from id)')
  need(meta.slug === slug && SLUG.test(slug), `slug "${meta.slug}" must match the folder name "${slug}" (lowercase words and hyphens)`)
  need(typeof meta.title === 'string' && meta.title.trim().length >= 3, 'title is required')
  need(meta.kind === 'input' || meta.kind === 'display', 'kind must be input or display')
  need(typeof meta.summary === 'string' && meta.summary.length >= 40 && meta.summary.length <= 200, 'summary must be 40-200 characters')
  need(typeof meta.description === 'string' && meta.description.length >= 200, 'description must be at least 200 characters')
  need(Array.isArray(meta.tags) && meta.tags.length >= 2 && meta.tags.every((t) => typeof t === 'string' && t.trim()), 'at least two tags')
  need(isSemver(String(meta.version ?? '')), 'version must be semver')
  need(Array.isArray(meta.changelog) && meta.changelog.some((c) => c.version === meta.version), 'changelog must have an entry for the current version')
  for (const entry of meta.changelog ?? []) need(isSemver(String(entry.version ?? '')) && DATE.test(String(entry.date ?? '')) && String(entry.notes ?? '').trim(), `changelog entry ${entry.version}: version, date (YYYY-MM-DD) and notes are required`)
  need(Array.isArray(meta.uses) && meta.uses.length >= 2, 'at least two example uses')
  need(Array.isArray(meta.setup) && meta.setup.length >= 1, 'setup steps are required')
  need(meta.preview && typeof meta.preview === 'object' && !Array.isArray(meta.preview), 'preview must be an object')
  if (meta.systems !== undefined) need(Array.isArray(meta.systems) && meta.systems.every((s) => typeof s === 'string' && s.length >= 2 && s.length <= 40), 'systems must be names (2-40 characters)')

  if (manifest) {
    const mpath = `controls/${slug}/manifest.json`
    need(manifest.version === meta.version, `manifest version ${manifest.version} and gallery.json version ${meta.version} differ`, mpath)
    need(/^ut-[a-z0-9-]+$/.test(manifest.tag), 'official controls use the ut- prefix', mpath)
    need(manifest.author === 'UserTasks' && manifest.license === 'Apache-2.0', 'author "UserTasks" and license "Apache-2.0"', mpath)
    need(manifest.homepage === `https://usertasks.com/gallery/controls/${slug}`, `homepage must be https://usertasks.com/gallery/controls/${slug}`, mpath)
    need(Boolean(manifest.display?.template || manifest.display?.format), 'a display formatter (template or format) for read-only views', mpath)
    need(Boolean(manifest.accessibility?.role && manifest.accessibility?.keyboard), 'accessibility.role and accessibility.keyboard are required', mpath)
    need(manifest.accessibility?.labelled_by_host !== false, 'official controls use the host label as their accessible name', mpath)
    need(Boolean(manifest.icon), 'an icon', mpath)
    const banner = readBundleBanner(bundle)
    if (!banner) issues.push({ path: mpath, message: 'the module has no build banner — rebuild it with gallery/controls/scripts/build.mjs' })
    else {
      need(banner.tag === manifest.tag && banner.version === manifest.version, `the module was built for ${banner.tag} ${banner.version} — rebuild it`, mpath)
      const declared = manifest.dependencies ?? {}
      for (const lib of banner.libraries) {
        need(declared[lib.name] === lib.version, `bundles ${lib.name} ${lib.version} but manifest.dependencies says ${declared[lib.name] ?? '(missing)'}`, mpath)
        need(PERMISSIVE_LICENCES.has(lib.licence), `${lib.name} is ${lib.licence}, not a permissive licence`, mpath)
      }
      for (const name of Object.keys(declared)) need(banner.libraries.some((lib) => lib.name === name), `manifest.dependencies lists ${name}, which the module does not bundle`, mpath)
    }
    need(Buffer.byteLength(bundle, 'utf8') <= PACKAGE_LIMITS.moduleBytes, `the module is over ${PACKAGE_LIMITS.moduleBytes / 1024 / 1024} MB`, mpath)
    if (manifest.capabilities.includes('network')) need((meta.systems ?? []).length > 0, 'a control with network access names the services it calls in systems')
  }

  // Extras: the sections a control may bring, uuids, secrets scrubbed, ids resolve, forms valid.
  const extras = packageAssets(source.extras)
  const assetsPath = `controls/${slug}/assets`
  for (const key of Object.keys(source.extras)) {
    if (key === 'format_version' || key === 'table_rows') continue
    if (!EXTRA_SECTIONS.has(key)) issues.push({ path: assetsPath, message: `section "${key}" cannot ship with a form control (allowed: ${[...EXTRA_SECTIONS].join(', ')})` })
  }
  const ids = new Set<string>([String(meta.asset_id)])
  for (const [section, list] of Object.entries(extras)) {
    for (const asset of list as any[]) {
      if (!isUuid(asset?.id) || ids.has(String(asset.id))) issues.push({ path: `${assetsPath}/${section}`, message: `id "${asset?.id}" must be a unique uuid` })
      ids.add(String(asset?.id))
      if (!String(asset?.name ?? '').trim()) issues.push({ path: `${assetsPath}/${section}`, message: 'name is required' })
    }
  }
  if (JSON.stringify(scrubSecretsForExport(extras)) !== JSON.stringify(extras)) issues.push({ path: assetsPath, message: `a value under a credential-shaped key is not "${SECRET_PLACEHOLDER}"` })
  // A custom control the extras use must ship in the package: this control, or an official companion.
  const shipped = new Set<string>([manifest?.tag ?? '', ...[...(all?.values() ?? [])].map((c) => c.manifest?.tag ?? '')].filter(Boolean))
  for (const [section, list] of Object.entries(extras)) {
    for (const asset of list as any[]) {
      for (const tag of new Set(scanAssetReferences(asset).controlTags)) {
        if (!shipped.has(tag)) issues.push({ path: `${assetsPath}/${section}`, message: `"${asset?.name}" uses form control ${tag}, which is not in the package (only ${manifest?.tag ?? 'this control'} and official controls in gallery/controls can ship with it)` })
      }
    }
  }
  for (const [section, list] of Object.entries(extras)) {
    for (const asset of list as any[]) {
      for (const ref of scanAssetReferences(asset).refs) {
        if (ref.type === 'form_control') continue
        if (!ids.has(ref.id) && ref.id !== String(asset.id)) issues.push({ path: `${assetsPath}/${section}`, message: `${ref.path.join('.')} points at ${ref.type} ${ref.id}, which is not in the package` })
      }
    }
  }
  for (const integration of extras.integrations ?? []) {
    try {
      need(new URL(String(integration.config?.base_url ?? '')).protocol === 'https:', `integration "${integration.name}": base_url must be https`, assetsPath)
    } catch {
      issues.push({ path: assetsPath, message: `integration "${integration.name}": base_url must be an absolute URL` })
    }
  }
  for (const reference of extras.references ?? []) {
    need((extras.integrations ?? []).some((i: any) => String(i.id) === String(reference.integration_id)), `reference "${reference.name}": its integration is not in the package`, assetsPath)
    need(Boolean(reference.request_config?.response_schema?.root), `reference "${reference.name}": add request_config.response_schema`, assetsPath)
  }
  const tablesById = new Map<string, any>((extras.data_tables ?? []).map((t: any) => [String(t.id), t]))
  for (const form of extras.forms ?? []) {
    const def = normalizeFormDefinition(form)
    issues.push(...formIssues(def, tablesById, `${assetsPath}/forms (${form.name})`))
    for (const field of (form.fields ?? []) as any[]) {
      if (field?.type !== 'custom') continue
      const config = normalizeCustomControlConfig(field.custom)
      if (!config) { issues.push({ path: `${assetsPath}/forms`, message: `field "${field.key}": the custom control config is invalid` }); continue }
      // A sample form may use this control or another official one (by tag); the version must be published.
      if (manifest && config.tag === manifest.tag) need(config.version === manifest.version, `field "${field.key}" pins ${config.tag} ${config.version}, the package has ${manifest.version}`, `${assetsPath}/forms`)
    }
  }
  return issues
}

export function validateControlBundleSource(source: ControlBundleSource, controls: Map<string, ControlSource>): GalleryIssue[] {
  const { slug, meta } = source
  const at = `controls/bundles/${slug}/gallery.json`
  const issues: GalleryIssue[] = source.errors.map((e) => ({ path: e.path, message: e.error }))
  const need = (cond: unknown, message: string) => { if (!cond) issues.push({ path: at, message }) }
  need(isUuid(meta.id), 'id must be a uuid')
  need(meta.slug === slug && SLUG.test(slug), 'slug must match the folder name')
  need(typeof meta.title === 'string' && meta.title.trim().length >= 3, 'title is required')
  need(typeof meta.summary === 'string' && meta.summary.length >= 40 && meta.summary.length <= 200, 'summary must be 40-200 characters')
  need(typeof meta.description === 'string' && meta.description.length >= 200, 'description must be at least 200 characters')
  need(Array.isArray(meta.tags) && meta.tags.length >= 2, 'at least two tags')
  need(isSemver(String(meta.version ?? '')), 'version must be semver')
  need(Array.isArray(meta.changelog) && meta.changelog.some((c) => c.version === meta.version), 'changelog must have an entry for the current version')
  need(Array.isArray(meta.controls) && meta.controls.length >= 2, 'a bundle lists at least two controls')
  for (const control of meta.controls ?? []) need(controls.has(control), `control "${control}" is not in gallery/controls`)
  return issues
}

/** The portable form_control asset of a control (what config-as-code and packages carry). */
export function controlAsset(source: ControlSource): Record<string, any> {
  const manifest = source.manifest
  if (!manifest) throw new Error(`${source.slug}: the manifest is invalid`)
  return {
    id: source.meta.asset_id,
    tag: manifest.tag,
    name: manifest.name,
    description: manifest.description ?? null,
    icon: manifest.icon ?? null,
    enabled: true,
    versions: [{ version: manifest.version, manifest, bundle: source.bundle, sha256: sha256Hex(source.bundle), signature: null }],
  }
}

function releaseOf(changelog: Array<{ version: string; date: string }> | undefined, version: string): string {
  return (changelog ?? []).find((c) => c.version === version)?.date ?? '1970-01-01'
}

/** Other official controls the extras' sample forms use (by tag): they ship in the same package. */
export function companionControls(source: ControlSource, all?: Map<string, ControlSource>): ControlSource[] {
  if (!all) return []
  const tags = new Set<string>()
  for (const form of packageAssets(source.extras).forms ?? []) {
    for (const field of (form.fields ?? []) as any[]) if (field?.type === 'custom' && typeof field.custom?.tag === 'string') tags.add(field.custom.tag)
  }
  tags.delete(source.manifest?.tag ?? '')
  return [...all.values()].filter((c) => c.slug !== source.slug && c.manifest && tags.has(c.manifest.tag))
}

export function controlContents(source: ControlSource, all?: Map<string, ControlSource>): PackageContents {
  const { meta } = source
  const assets: Record<string, any> = { ...packageAssets(source.extras), form_controls: [controlAsset(source), ...companionControls(source, all).map(controlAsset)] }
  const data: PackageContents['data'] = {}
  for (const table of assets.data_tables ?? []) data[String(table.id)] = { mode: 'schema' }
  return {
    header: {
      id: meta.id,
      name: `${meta.title} form control`,
      slug: controlPackageSlug(meta.slug),
      version: meta.version,
      description: meta.summary,
      author: GALLERY_AUTHOR,
      created_at: `${releaseOf(meta.changelog, meta.version)}T00:00:00.000Z`,
      icon: meta.icon ?? source.manifest?.icon ?? 'puzzle',
      readme: source.readme,
    },
    assets,
    data,
    requirements: galleryRequirements(assets),
    dependencies: [],
  }
}

export function controlBundleContents(source: ControlBundleSource, controls: Map<string, ControlSource>): PackageContents {
  const { meta } = source
  const members = meta.controls.map((slug) => controls.get(slug)!).filter(Boolean)
  const assets = { form_controls: members.map(controlAsset) }
  return {
    header: {
      id: meta.id,
      name: meta.title,
      slug: bundlePackageSlug(meta.slug),
      version: meta.version,
      description: meta.summary,
      author: GALLERY_AUTHOR,
      created_at: `${releaseOf(meta.changelog, meta.version)}T00:00:00.000Z`,
      icon: meta.icon ?? 'layers',
      readme: source.readme,
    },
    assets,
    data: {},
    requirements: [],
    dependencies: [],
  }
}

/** `all`: every control source, so a sample form's other official controls (the address package's map) ship with it. */
export function buildControlPackage(source: ControlSource, options: { signingKey?: GallerySigningKey | null; all?: Map<string, ControlSource> } = {}): BuiltGalleryPackage {
  const slug = controlPackageSlug(source.meta.slug)
  return packGalleryContents(slug, `${slug}-${source.meta.version}.utpkg`, controlContents(source, options.all), options)
}

export function buildControlBundlePackage(source: ControlBundleSource, controls: Map<string, ControlSource>, options: { signingKey?: GallerySigningKey | null } = {}): BuiltGalleryPackage {
  const slug = bundlePackageSlug(source.meta.slug)
  return packGalleryContents(slug, `${slug}-${source.meta.version}.utpkg`, controlBundleContents(source, controls), options)
}

function controlItem(source: ControlSource): ControlCatalogItem {
  const m = source.manifest!
  const libraries = readBundleBanner(source.bundle)?.libraries ?? []
  return {
    slug: source.slug,
    tag: m.tag,
    name: m.name,
    version: m.version,
    description: m.description ?? null,
    icon: m.icon ?? null,
    kind: source.meta.kind,
    value: m.value,
    props: m.props,
    context: m.context,
    capabilities: m.capabilities,
    hosts: m.network?.allowed_hosts ?? [],
    display: m.display ?? null,
    output: m.output ?? null,
    accessibility: m.accessibility ?? null,
    size: m.size,
    validation: m.validation,
    libraries,
    module_bytes: Buffer.byteLength(source.bundle, 'utf8'),
    sha256: sha256Hex(source.bundle),
  }
}

/** The index.json summary of a set of controls. */
export function controlSummary(sources: ControlSource[], kind?: ControlSource['meta']['kind']): GalleryControlSummary {
  const items = sources.map(controlItem)
  const uniq = (values: string[]) => [...new Set(values)].sort()
  return {
    tags: items.map((i) => i.tag),
    ...(kind ? { kind } : sources.length === 1 ? { kind: sources[0].meta.kind } : {}),
    value_types: uniq(items.map((i) => i.value.type)),
    capabilities: uniq(items.flatMap((i) => i.capabilities)),
    hosts: uniq(items.flatMap((i) => i.hosts)),
    libraries: uniq(items.flatMap((i) => i.libraries.map((l) => `${l.name} ${l.version} (${l.licence})`))),
    module_bytes: items.reduce((sum, i) => sum + i.module_bytes, 0),
  }
}

function requirementsOf(pkg: BuiltGalleryPackage): CatalogRequirement[] {
  return pkg.contents.requirements.map((r) => ({
    id: r.id, kind: r.kind, label: r.label, description: r.description, required: r.required,
    fields: r.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, secret: f.secret, required: r.required && (r.kind === 'integration_auth' ? f.secret : true) })),
  }))
}

export function controlIndexEntry(meta: { id: string; title: string; summary: string; version: string; tags: string[]; changelog: ControlGalleryMeta['changelog']; systems?: string[] }, kind: 'form_control' | 'control_bundle', page: string, pkg: BuiltGalleryPackage, sources: ControlSource[]): GalleryIndexEntry {
  return {
    kind,
    control: controlSummary(sources, kind === 'form_control' ? sources[0]?.meta.kind : undefined),
    id: meta.id,
    slug: pkg.slug,
    title: meta.title,
    category: FORM_CONTROLS_CATEGORY,
    summary: meta.summary,
    version: meta.version,
    released: releaseOf(meta.changelog, meta.version),
    tags: meta.tags,
    needs: pkg.contents.requirements.length ? ['rest_api'] : [],
    optional_needs: [],
    difficulty: 'starter',
    setup_minutes: pkg.contents.requirements.length || sources.some((s) => s.manifest?.capabilities.some((c) => c !== 'files')) ? 10 : 2,
    file: `/gallery/${pkg.fileName}`,
    file_name: pkg.fileName,
    size_bytes: pkg.bytes.byteLength,
    sha256: pkg.sha256,
    checksum: pkg.manifest.checksum,
    signed: Boolean(pkg.manifest.signature),
    fingerprint: pkg.manifest.signature?.fingerprint ?? null,
    asset_count: pkg.assetCount,
    requirement_count: pkg.manifest.requirements.length,
    page,
    source: 'official',
    systems: meta.systems ?? [],
    native: pkg.contents.requirements.length === 0 && !(pkg.contents.assets.integrations ?? []).length,
  }
}

/** `all`: every control source, so the entry lists the companion controls its package ships (address → map). */
export function controlCatalogEntry(source: ControlSource, pkg: BuiltGalleryPackage, all?: Map<string, ControlSource>): ControlCatalogEntry {
  const { meta } = source
  return {
    kind: 'form_control',
    id: meta.id,
    slug: meta.slug,
    package_slug: pkg.slug,
    title: meta.title,
    control_kind: meta.kind,
    summary: meta.summary,
    description: meta.description,
    icon: meta.icon ?? source.manifest?.icon ?? null,
    tags: meta.tags,
    version: meta.version,
    changelog: meta.changelog,
    released: releaseOf(meta.changelog, meta.version),
    uses: meta.uses,
    setup: meta.setup,
    systems: meta.systems ?? [],
    preview: meta.preview,
    readme: source.readme,
    file_name: pkg.fileName,
    checksum: pkg.manifest.checksum,
    asset_count: pkg.assetCount,
    controls: [source, ...companionControls(source, all)].map(controlItem),
    extras: Object.entries(packageAssets(source.extras)).flatMap(([section, list]) => (list as any[]).map((asset) => ({ section, name: String(asset.name ?? ''), description: asset.description ?? null }))),
    requirements: requirementsOf(pkg),
  }
}

export function controlBundleCatalogEntry(source: ControlBundleSource, pkg: BuiltGalleryPackage, controls: Map<string, ControlSource>): ControlCatalogEntry {
  const { meta } = source
  const members = meta.controls.map((slug) => controls.get(slug)!).filter(Boolean)
  return {
    kind: 'control_bundle',
    id: meta.id,
    slug: meta.slug,
    package_slug: pkg.slug,
    title: meta.title,
    control_kind: null,
    summary: meta.summary,
    description: meta.description,
    icon: meta.icon ?? 'layers',
    tags: meta.tags,
    version: meta.version,
    changelog: meta.changelog,
    released: releaseOf(meta.changelog, meta.version),
    uses: [],
    setup: ['Install the package: every control appears in Extensibility → Form controls and in the form designer\'s palette under Custom.'],
    systems: [...new Set(members.flatMap((m) => m.meta.systems ?? []))],
    preview: null,
    readme: source.readme,
    file_name: pkg.fileName,
    checksum: pkg.manifest.checksum,
    asset_count: pkg.assetCount,
    controls: members.map(controlItem),
    extras: [],
    requirements: requirementsOf(pkg),
  }
}

/** True when a package carries form controls (the community gallery refuses those). */
export function hasFormControls(assets: Record<string, unknown[] | undefined>): boolean {
  return (assets.form_controls ?? []).length > 0
}

