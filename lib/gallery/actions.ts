/**
 * Official custom workflow actions in the gallery: sources in
 * gallery/actions/<slug>/ (manifest.json, the built single module in
 * dist/action.js, gallery.json, README.md, a sample workflow and other
 * config-as-code extras in assets/).
 *
 * Each becomes a .utpkg like the workflow packages (same layout, same
 * signing key — scripts/gallery-build.ts) named workflow-action-<slug>,
 * whose `workflow_activities` section installs into Extensibility →
 * Workflow actions; its sample workflow comes along (inactive). Official
 * only: the community gallery refuses packages with custom code.
 *
 * The build runs every gallery.json example in the sandbox and records the
 * outputs in the catalog (the /gallery/actions pages show them).
 *
 * Node only (fs); used by the build script, the tests and the verifier.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { filesToManifest, type RepoFile } from '@/lib/github-sync/layout'
import { sha256Hex } from '@/lib/forms/custom-controls/package'
import { ActionPackageError, parseActionModule, probeActionModule } from '@/lib/custom-actions/package'
import { checkActionOutputs } from '@/lib/custom-actions/manifest'
import type { ActionField, ActionManifest } from '@/lib/custom-actions/contract'
import { isSemver } from '@/lib/packages/semver'
import type { PackageContents } from '@/lib/packages/build'
import { isUuid } from '@/lib/portability/plan'
import { GALLERY_AUTHOR, galleryRequirements, packGalleryContents, packageAssets, type BuiltGalleryPackage, type GallerySigningKey } from './build'
import { GALLERY_ROOT } from './source'
import { WORKFLOW_ACTIONS_CATEGORY, type ActionGalleryMeta, type GalleryActionSummary, type GalleryChangelogEntry, type GalleryIndexEntry } from './types'
import type { GalleryIssue } from './validate'

export const GALLERY_ACTIONS_DIR = join(GALLERY_ROOT, 'actions')
const NOT_ACTIONS = new Set(['node_modules', 'scripts', 'shared', 'dist'])
/** Config-as-code sections an action package may carry besides its action. */
const EXTRA_SECTIONS = new Set(['workflows', 'data_tables', 'email_templates'])
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const BANNER = /^\/\*! UserTasks action ([a-z][a-z0-9_]+) (\S+) \*\//

export interface ActionSource {
  dir: string
  slug: string
  meta: ActionGalleryMeta
  readme: string
  manifestRaw: unknown
  /** The validated manifest (null when it does not parse). */
  manifest: ActionManifest | null
  /** The committed single module (dist/action.js or the manifest entry). */
  module: string
  extras: Record<string, any>
  paths: Record<string, string[]>
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

function readJson(path: string, errors: ActionSource['errors'], label: string): any {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    errors.push({ path: label, error: (error as Error).message })
    return null
  }
}

/** Action folders (gallery/actions/<slug> with gallery.json and manifest.json), sorted. */
export function listActionSlugs(root = GALLERY_ACTIONS_DIR): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root).filter((name) => !NOT_ACTIONS.has(name) && !name.startsWith('.') && statSync(join(root, name)).isDirectory()
    && existsSync(join(root, name, 'gallery.json')) && existsSync(join(root, name, 'manifest.json'))).sort()
}

export function readActionSource(slug: string, root = GALLERY_ACTIONS_DIR): ActionSource {
  const dir = join(root, slug)
  const errors: ActionSource['errors'] = []
  const meta = readJson(join(dir, 'gallery.json'), errors, `actions/${slug}/gallery.json`) ?? {}
  const manifestRaw = readJson(join(dir, 'manifest.json'), errors, `actions/${slug}/manifest.json`)
  const readmePath = join(dir, 'README.md')
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : ''
  if (!readme.trim()) errors.push({ path: `actions/${slug}/README.md`, error: 'README.md is missing or empty' })
  const entry = typeof manifestRaw?.entry === 'string' ? manifestRaw.entry : 'dist/action.js'
  const modulePath = join(dir, entry)
  const moduleText = existsSync(modulePath) ? readFileSync(modulePath, 'utf8') : ''
  if (!moduleText) errors.push({ path: `actions/${slug}/${entry}`, error: 'the built module is missing (node gallery/actions/scripts/build.mjs)' })
  let manifest: ActionManifest | null = null
  if (manifestRaw && moduleText) {
    try {
      const parsed = parseActionModule(moduleText, manifestRaw)
      manifest = parsed.manifest
      for (const warning of parsed.warnings) errors.push({ path: `actions/${slug}`, error: warning })
    } catch (error) {
      errors.push({ path: `actions/${slug}/manifest.json`, error: error instanceof ActionPackageError ? error.message : String(error) })
    }
  }
  const assetsDir = join(dir, 'assets')
  const files: RepoFile[] = existsSync(assetsDir)
    ? walk(assetsDir).filter((path) => path.endsWith('.json')).map((path) => ({ path: relative(assetsDir, path).split(sep).join('/'), content: readFileSync(path, 'utf8') }))
    : []
  const parsed = filesToManifest(files, '')
  errors.push(...parsed.errors.map((e) => ({ path: `actions/${slug}/assets/${e.path}`, error: e.error })))
  return { dir, slug, meta, readme, manifestRaw, manifest, module: moduleText, extras: parsed.manifest, paths: parsed.paths, errors }
}

export function readAllActionSources(root = GALLERY_ACTIONS_DIR): ActionSource[] {
  return listActionSlugs(root).map((slug) => readActionSource(slug, root))
}

/** Package slug of an action: workflow-action-<slug>. */
export function actionPackageSlug(slug: string): string {
  return `workflow-action-${slug}`
}

/** Every custom_activity node in the extras' workflows. */
function sampleActionNodes(source: ActionSource): Array<{ workflow: string; node: any }> {
  const out: Array<{ workflow: string; node: any }> = []
  for (const wf of packageAssets(source.extras).workflows ?? []) {
    for (const node of (wf.nodes ?? []) as any[]) if (node?.type === 'custom_activity') out.push({ workflow: String(wf.name ?? wf.id), node })
  }
  return out
}

/** Every problem with an action source (empty = valid). Sync checks only; examples run in validateActionExamples. */
export function validateActionSource(source: ActionSource): GalleryIssue[] {
  const issues: GalleryIssue[] = source.errors.map((e) => ({ path: e.path, message: e.error }))
  const meta = source.meta ?? ({} as ActionGalleryMeta)
  const at = `actions/${source.slug}/gallery.json`
  const need = (ok: unknown, message: string) => { if (!ok) issues.push({ path: at, message }) }
  need(meta.slug === source.slug && SLUG.test(source.slug), 'slug must equal the folder name (kebab case)')
  need(isUuid(String(meta.id ?? '')), 'id must be a uuid')
  need(isUuid(String(meta.asset_id ?? '')) && meta.asset_id !== meta.id, 'asset_id must be a uuid (different from id)')
  need(typeof meta.title === 'string' && meta.title.length >= 3 && meta.title.length <= 60, 'title: 3-60 characters')
  need(typeof meta.summary === 'string' && meta.summary.length >= 40 && meta.summary.length <= 200, 'summary: 40-200 characters')
  need(typeof meta.description === 'string' && meta.description.length >= 200, 'description must be at least 200 characters')
  need(Array.isArray(meta.tags) && meta.tags.length >= 2, 'at least two tags')
  need(isSemver(String(meta.version ?? '')), 'version must be semver')
  need(Array.isArray(meta.changelog) && meta.changelog.some((c: GalleryChangelogEntry) => c.version === meta.version && DATE.test(String(c.date))), 'changelog must have a dated entry for the current version')
  need(Array.isArray(meta.uses) && meta.uses.length >= 2, 'at least two uses')
  need(Array.isArray(meta.setup) && meta.setup.length >= 1, 'setup steps are required')
  need(Array.isArray(meta.examples) && meta.examples.length >= 2, 'at least two examples')
  const m = source.manifest
  if (m) {
    need(m.version === meta.version, `gallery.json version ${meta.version} differs from manifest.json ${m.version}`)
    need(m.key.startsWith('ut_'), 'official action keys start with ut_')
    need(m.license === 'Apache-2.0', 'manifest license must be Apache-2.0')
    const banner = BANNER.exec(source.module.slice(0, 300))
    need(banner && banner[1] === m.key && banner[2] === m.version, `the module's first line must be the build banner /*! UserTasks action ${m.key} ${m.version} */ (rebuild)`)
    const ops = new Set(m.operations.map((op) => op.id))
    for (const example of meta.examples ?? []) need(ops.has(example.operation), `example "${example.title}": unknown operation ${example.operation}`)
    for (const op of m.operations) need(op.sample && typeof op.sample === 'object', `operation ${op.id} needs a sample (Test uses it)`)
    // Extras: only workflows / tables / email templates, and the workflows must use this action by its asset id and key.
    for (const section of Object.keys(packageAssets(source.extras))) need(EXTRA_SECTIONS.has(section), `assets: ${section} may not ship with an action (only ${[...EXTRA_SECTIONS].join(', ')})`)
    const nodes = sampleActionNodes(source)
    need(nodes.length >= 1, 'assets must include a sample workflow that uses the action')
    for (const { workflow, node } of nodes) {
      const c = node.config ?? {}
      need(c.custom_activity_id === meta.asset_id, `${workflow} › ${node.label}: custom_activity_id must be the gallery asset_id`)
      need(c.custom_activity_key === m.key, `${workflow} › ${node.label}: custom_activity_key must be ${m.key}`)
      need(ops.has(String(c.operation ?? '')), `${workflow} › ${node.label}: operation "${c.operation}" is not in the manifest`)
      const op = m.operations.find((o) => o.id === c.operation)
      for (const name of Object.keys(c.input_mappings ?? {})) need(op?.inputs.some((f) => f.name === name), `${workflow} › ${node.label}: input "${name}" is not declared by ${c.operation}`)
      for (const field of op?.inputs.filter((f) => f.required && f.default === undefined) ?? []) need(String(c.input_mappings?.[field.name] ?? '').trim(), `${workflow} › ${node.label}: required input "${field.name}" is not mapped`)
    }
  }
  return issues
}

const MOCK_SECRET = 'example-secret'

async function runExample(source: ActionSource, operation: string, inputs: Record<string, unknown>) {
  const { runAction } = await import('../../packages/action/src/testing')
  const secrets = Object.fromEntries((source.manifest?.capabilities.credentials ?? []).map((s) => [s.name, MOCK_SECRET]))
  return runAction({ module: source.module, manifest: source.manifest!, operation, inputs, mocks: { secrets } })
}

export interface ActionExampleResult {
  operation: string
  title: string
  note: string | null
  inputs: Record<string, unknown>
  /** null when the outputs differ between runs (random / time based). */
  outputs: Record<string, unknown> | null
  varies: boolean
}

/** Run the samples and gallery examples in the sandbox: problems are issues, results go to the catalog. */
export async function runActionExamples(source: ActionSource): Promise<{ issues: GalleryIssue[]; examples: ActionExampleResult[] }> {
  const issues: GalleryIssue[] = []
  const examples: ActionExampleResult[] = []
  const m = source.manifest
  if (!m) return { issues, examples }
  const at = `actions/${source.slug}`
  for (const problem of await probeActionModule({ module: source.module, manifest: m })) issues.push({ path: `${at}/dist`, message: problem })
  for (const op of m.operations) {
    const r = await runExample(source, op.id, op.sample ?? {})
    if (!r.ok) issues.push({ path: `${at}/manifest.json`, message: `sample of ${op.id} fails: ${r.error?.code}: ${r.error?.message}` })
    else for (const w of checkActionOutputs(op, r.outputs)) issues.push({ path: `${at}/manifest.json`, message: `sample of ${op.id}: ${w}` })
  }
  for (const example of source.meta.examples ?? []) {
    const first = await runExample(source, example.operation, example.inputs ?? {})
    if (!first.ok) {
      issues.push({ path: `${at}/gallery.json`, message: `example "${example.title}" fails: ${first.error?.code}: ${first.error?.message}` })
      continue
    }
    const second = await runExample(source, example.operation, example.inputs ?? {})
    const varies = JSON.stringify(first.outputs) !== JSON.stringify(second.outputs)
    examples.push({ operation: example.operation, title: example.title, note: example.note ?? null, inputs: example.inputs ?? {}, outputs: varies ? null : first.outputs, varies })
  }
  return { issues, examples }
}

/** The portable workflow_activity asset (what config-as-code and packages carry). */
export function actionAsset(source: ActionSource): Record<string, any> {
  const m = source.manifest
  if (!m) throw new Error(`${source.slug}: the manifest is invalid`)
  return {
    id: source.meta.asset_id,
    name: m.name,
    description: m.description ?? null,
    key: m.key,
    status: 'active',
    source_kind: 'upload',
    version: m.version,
    icon_name: m.icon ?? 'puzzle',
    color: m.color ?? '#0EA5E9',
    source_code: source.module.trim(),
    manifest: m,
    demo_inputs: m.operations[0]?.sample ?? {},
    tags: m.tags ?? [],
    source_filename: m.entry ?? 'dist/action.js',
    runtime: 'module',
    sha256: sha256Hex(source.module.trim()),
    enabled: true,
  }
}

function releaseOf(changelog: GalleryChangelogEntry[] | undefined, version: string): string {
  return (changelog ?? []).find((c) => c.version === version)?.date ?? '1970-01-01'
}

export function actionContents(source: ActionSource): PackageContents {
  const { meta } = source
  const assets: Record<string, any> = { ...packageAssets(source.extras), workflow_activities: [actionAsset(source)] }
  const data: PackageContents['data'] = {}
  for (const table of assets.data_tables ?? []) data[String(table.id)] = { mode: 'schema' }
  return {
    header: {
      id: meta.id,
      name: `${meta.title} workflow action`,
      slug: actionPackageSlug(meta.slug),
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

export function buildActionPackage(source: ActionSource, options: { signingKey?: GallerySigningKey | null } = {}): BuiltGalleryPackage {
  const slug = actionPackageSlug(source.meta.slug)
  return packGalleryContents(slug, `${slug}-${source.meta.version}.utpkg`, actionContents(source), options)
}

export function actionSummary(source: ActionSource): GalleryActionSummary {
  const m = source.manifest!
  const caps = m.capabilities ?? {}
  return {
    key: m.key,
    operations: m.operations.map((op) => ({ id: op.id, label: op.label })),
    capabilities: (['http', 'data', 'files', 'credentials'] as const).filter((c) => (c === 'credentials' ? (caps.credentials?.length ?? 0) > 0 : Boolean(caps[c]))).map((c) => (c === 'credentials' ? 'secrets' : c)),
    hosts: caps.http?.hosts ?? [],
    secrets: (caps.credentials ?? []).map((s) => s.name),
    module_bytes: Buffer.byteLength(source.module, 'utf8'),
    sha256: sha256Hex(source.module.trim()),
  }
}

export function actionIndexEntry(source: ActionSource, pkg: BuiltGalleryPackage): GalleryIndexEntry {
  const { meta } = source
  return {
    kind: 'workflow_action',
    action: actionSummary(source),
    id: meta.id,
    slug: pkg.slug,
    title: meta.title,
    category: WORKFLOW_ACTIONS_CATEGORY,
    summary: meta.summary,
    version: meta.version,
    released: releaseOf(meta.changelog, meta.version),
    tags: meta.tags,
    needs: [],
    optional_needs: [],
    difficulty: 'starter',
    setup_minutes: (source.manifest?.capabilities.credentials?.length ?? 0) > 0 ? 5 : 2,
    file: `/gallery/${pkg.fileName}`,
    file_name: pkg.fileName,
    size_bytes: pkg.bytes.byteLength,
    sha256: pkg.sha256,
    checksum: pkg.manifest.checksum,
    signed: Boolean(pkg.manifest.signature),
    fingerprint: pkg.manifest.signature?.fingerprint ?? null,
    asset_count: pkg.assetCount,
    requirement_count: pkg.manifest.requirements.length,
    page: `/gallery/actions/${meta.slug}`,
    source: 'official',
    systems: [],
    native: pkg.contents.requirements.length === 0,
  }
}

/** One action as the /gallery/actions pages show it. */
export interface ActionCatalogEntry {
  kind: 'workflow_action'
  id: string
  slug: string
  package_slug: string
  title: string
  summary: string
  description: string
  icon: string | null
  color: string | null
  tags: string[]
  version: string
  changelog: GalleryChangelogEntry[]
  released: string
  uses: string[]
  setup: string[]
  readme: string
  file_name: string
  checksum: string
  asset_count: number
  key: string
  name: string
  operations: Array<{ id: string; label: string; description: string | null; inputs: ActionField[]; outputs: ActionField[] }>
  capabilities: GalleryActionSummary
  limits: { timeout_ms: number; memory_mb: number }
  examples: ActionExampleResult[]
  sample_workflows: Array<{ name: string; description: string | null; steps: number }>
}

export function actionCatalogEntry(source: ActionSource, pkg: BuiltGalleryPackage, examples: ActionExampleResult[]): ActionCatalogEntry {
  const { meta } = source
  const m = source.manifest!
  return {
    kind: 'workflow_action',
    id: meta.id,
    slug: meta.slug,
    package_slug: pkg.slug,
    title: meta.title,
    summary: meta.summary,
    description: meta.description,
    icon: meta.icon ?? m.icon ?? null,
    color: m.color ?? null,
    tags: meta.tags,
    version: meta.version,
    changelog: meta.changelog,
    released: releaseOf(meta.changelog, meta.version),
    uses: meta.uses,
    setup: meta.setup,
    readme: source.readme,
    file_name: pkg.fileName,
    checksum: pkg.manifest.checksum,
    asset_count: pkg.assetCount,
    key: m.key,
    name: m.name,
    operations: m.operations.map((op) => ({ id: op.id, label: op.label, description: op.description ?? null, inputs: op.inputs, outputs: op.outputs })),
    capabilities: actionSummary(source),
    limits: m.limits,
    examples,
    sample_workflows: (packageAssets(source.extras).workflows ?? []).map((wf: any) => ({ name: String(wf.name ?? ''), description: wf.description ?? null, steps: Array.isArray(wf.nodes) ? wf.nodes.length : 0 })),
  }
}
