/**
 * Build the package gallery: every gallery/packages/<slug> source becomes a
 * .utpkg in public/gallery/, plus public/gallery/index.json (checksums,
 * sizes, signer fingerprint) and lib/gallery/catalog.json (the data the
 * /gallery pages render).
 *
 *   npm run gallery:build                     # build (signed when GALLERY_SIGNING_KEY is set)
 *   npm run gallery:build -- --require-signature   # release build: fail without the key
 *   npm run gallery:check                     # CI: sources and committed outputs agree (no writes)
 *   npm run gallery:build -- --print-key      # fingerprint + public key of GALLERY_SIGNING_KEY
 *   npm run gallery:build -- --pin            # …and pin them in gallery/signing.json
 *   npm run gallery:build -- --validate expense-claims   # validate one package, no output
 *   npm run gallery:build -- --out /tmp/g expense-claims  # build a subset elsewhere (for gallery:verify --dir)
 *
 * Official form controls (gallery/controls/<slug>: manifest, the committed
 * module in dist/, gallery.json, README, optional assets/) and control
 * bundles (gallery/controls/bundles/<slug>) are built the same way, signed
 * with the same key, into form-control-<slug>-<version>.utpkg /
 * form-controls-<slug>-<version>.utpkg, listed in index.json with
 * `kind: form_control | control_bundle` and in the catalog's `controls`.
 * Name a control by its folder slug (`--validate chart`).
 *
 * Official workflow actions (gallery/actions/<slug>: manifest v1, the
 * committed module in dist/action.js, gallery.json, README, a sample
 * workflow in assets/) become workflow-action-<slug>-<version>.utpkg, listed
 * with `kind: workflow_action` and in the catalog's `actions` (each
 * gallery.json example is run in the sandbox and its outputs recorded).
 *
 * GALLERY_SIGNING_KEY is the "UserTasks Gallery" ed25519 private key (PEM,
 * PKCS#8; `\n` escapes allowed). It is never committed: see gallery/README.md
 * for how the maintainer creates and stores it. Its public fingerprint is
 * pinned in gallery/signing.json and the build refuses any other key.
 * Without a key the packages are built unsigned and index.json says so.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { unpackPackage } from '@/lib/packages/format'
import { buildGalleryPackage, isNativeContents, parseGallerySigningKey, releaseDate, type BuiltGalleryPackage } from '@/lib/gallery/build'
import { catalogEntry, type GalleryCatalog } from '@/lib/gallery/catalog'
import { GALLERY_CATALOG_FILE, GALLERY_OUTPUT_DIR, GALLERY_SIGNING_FILE, readAllGallerySources, readGallerySigningConfig, readGallerySource, type GallerySource } from '@/lib/gallery/source'
import { GALLERY_CATEGORIES, type GalleryIndex, type GalleryIndexEntry } from '@/lib/gallery/types'
import { validateGallerySource } from '@/lib/gallery/validate'
import {
  buildControlBundlePackage, buildControlPackage, companionControls, controlBundleCatalogEntry, controlCatalogEntry, controlIndexEntry, listControlBundleSlugs, listControlSlugs,
  readAllControlBundleSources, readAllControlSources, validateControlBundleSource, validateControlSource,
  type ControlBundleSource, type ControlSource,
} from '@/lib/gallery/controls'
import type { ControlCatalogEntry } from '@/lib/gallery/catalog'
import {
  actionCatalogEntry, actionIndexEntry, buildActionPackage, listActionSlugs, readAllActionSources, runActionExamples, validateActionSource,
  type ActionCatalogEntry, type ActionExampleResult, type ActionSource,
} from '@/lib/gallery/actions'

const args = process.argv.slice(2)
const check = args.includes('--check')
const requireSignature = args.includes('--require-signature')
const validateOnly = args.includes('--validate')
/** --out <dir>: build only the named packages into <dir> (index.json there, no catalog) — for local verification. */
const outDir = args.includes('--out') ? resolve(args[args.indexOf('--out') + 1]) : null
const only = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--out')

function fail(message: string): never {
  console.error(`gallery: ${message}`)
  process.exit(1)
}

function stable(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

async function main() {
  if (args.includes('--print-key') || args.includes('--pin')) {
    // Public values of GALLERY_SIGNING_KEY only (never the private key).
    const key = parseGallerySigningKey(process.env.GALLERY_SIGNING_KEY)
    if (!key) fail('set GALLERY_SIGNING_KEY to the gallery private key (PEM)')
    console.log(`fingerprint ${key.fingerprint}\npublic_key  ${key.publicKey}`)
    if (args.includes('--pin')) {
      const current = readGallerySigningConfig()
      writeFileSync(GALLERY_SIGNING_FILE, stable({ key_name: current.key_name, fingerprint: key.fingerprint, public_key: key.publicKey }))
      console.log('pinned in gallery/signing.json — commit it, then run npm run gallery:build -- --require-signature')
    }
    return
  }
  const controlSlugs = new Set(listControlSlugs())
  const bundleSlugs = new Set(listControlBundleSlugs())
  const actionSlugs = new Set(listActionSlugs())
  const processOnly = only.filter((slug) => !controlSlugs.has(slug) && !bundleSlugs.has(slug) && !actionSlugs.has(slug))
  let sources: GallerySource[] = only.length ? processOnly.map((slug) => readGallerySource(slug)) : readAllGallerySources()
  // Form controls: every control (bundles need their members), or the named ones.
  const allControls: ControlSource[] = readAllControlSources()
  const controlsBySlug = new Map(allControls.map((c) => [c.slug, c]))
  let controls: ControlSource[] = only.length ? allControls.filter((c) => only.includes(c.slug)) : allControls
  let bundles: ControlBundleSource[] = only.length ? readAllControlBundleSources().filter((b) => only.includes(b.slug)) : readAllControlBundleSources()
  // --skip-invalid (local previews while packages are being written): build only the valid ones.
  if (args.includes('--skip-invalid')) {
    const skipped = sources.filter((source) => validateGallerySource(source).length)
    for (const source of skipped) console.warn(`gallery: skipping invalid ${source.slug}`)
    sources = sources.filter((source) => !skipped.includes(source))
  }
  if (args.includes('--skip-invalid')) {
    const skipped = controls.filter((c) => validateControlSource(c, controlsBySlug).length)
    for (const c of skipped) console.warn(`gallery: skipping invalid control ${c.slug}`)
    controls = controls.filter((c) => !skipped.includes(c))
    for (const c of skipped) controlsBySlug.delete(c.slug)
    bundles = bundles.filter((b) => !validateControlBundleSource(b, controlsBySlug).length)
  }
  // Workflow actions (gallery/actions): every one, or the named ones.
  let actions: ActionSource[] = only.length ? readAllActionSources().filter((a) => only.includes(a.slug)) : readAllActionSources()
  const actionExamples = new Map<string, ActionExampleResult[]>()
  const actionIssues = new Map<string, Array<{ path: string; message: string }>>()
  for (const action of actions) {
    const issues = validateActionSource(action)
    if (!issues.length) {
      const ran = await runActionExamples(action)
      issues.push(...ran.issues)
      actionExamples.set(action.slug, ran.examples)
    }
    actionIssues.set(action.slug, issues)
  }
  if (args.includes('--skip-invalid')) {
    for (const a of actions.filter((a) => actionIssues.get(a.slug)?.length)) console.warn(`gallery: skipping invalid action ${a.slug}`)
    actions = actions.filter((a) => !actionIssues.get(a.slug)?.length)
  }
  if (!sources.length && !controls.length && !bundles.length && !actions.length) fail('no packages in gallery/packages')

  let invalid = 0
  const report = (slug: string, issues: Array<{ path: string; message: string }>) => {
    if (!issues.length) return
    invalid++
    console.error(`\n✗ ${slug}`)
    for (const issue of issues) console.error(`  ${issue.path}: ${issue.message}`)
  }
  for (const source of sources) report(source.slug, validateGallerySource(source))
  for (const control of controls) report(`controls/${control.slug}`, validateControlSource(control, controlsBySlug))
  for (const bundle of bundles) report(`controls/bundles/${bundle.slug}`, validateControlBundleSource(bundle, controlsBySlug))
  for (const action of actions) report(`actions/${action.slug}`, actionIssues.get(action.slug) ?? [])
  const total = sources.length + controls.length + bundles.length + actions.length
  if (invalid) fail(`${invalid} package${invalid === 1 ? '' : 's'} failed validation`)
  if (validateOnly) {
    console.log(`✓ ${total} package${total === 1 ? '' : 's'} valid${controls.length + bundles.length ? ` (${controls.length} form control${controls.length === 1 ? '' : 's'}, ${bundles.length} bundle${bundles.length === 1 ? '' : 's'})` : ''}${actions.length ? ` (${actions.length} workflow action${actions.length === 1 ? '' : 's'})` : ''}`)
    return
  }
  if (only.length && !outDir) fail('building a subset would drop the other packages from index.json; pass --validate to check one package, or --out <dir>')

  const signing = readGallerySigningConfig()
  const key = check ? null : parseGallerySigningKey(process.env.GALLERY_SIGNING_KEY)
  if (key && signing.fingerprint && key.fingerprint !== signing.fingerprint) {
    fail(`GALLERY_SIGNING_KEY has fingerprint ${key.fingerprint}, but gallery/signing.json pins ${signing.fingerprint}. Use the gallery key, or update signing.json deliberately.`)
  }
  if (key && !signing.fingerprint) console.warn(`gallery: signing with ${key.fingerprint}; pin it in gallery/signing.json (fingerprint + public_key) before publishing`)
  if (requireSignature && !key) fail('--require-signature: set GALLERY_SIGNING_KEY')
  if (!key && !check) console.warn('gallery: GALLERY_SIGNING_KEY is not set — building UNSIGNED development packages')

  const built: Array<{ source: GallerySource; pkg: BuiltGalleryPackage }> = sources.map((source) => ({ source, pkg: buildGalleryPackage(source, { signingKey: key }) }))
  const builtControls = controls.map((source) => ({ source, pkg: buildControlPackage(source, { signingKey: key, all: controlsBySlug }) }))
  const builtBundles = bundles.map((source) => ({ source, pkg: buildControlBundlePackage(source, controlsBySlug, { signingKey: key }) }))
  const builtActions = actions.map((source) => ({ source, pkg: buildActionPackage(source, { signingKey: key }) }))
  const ids = new Set<string>()
  for (const { id, slug } of [...built.map((b) => ({ id: b.source.meta.id, slug: b.source.slug })), ...builtControls.map((b) => ({ id: b.source.meta.id, slug: b.pkg.slug })), ...builtBundles.map((b) => ({ id: b.source.meta.id, slug: b.pkg.slug })), ...builtActions.map((b) => ({ id: b.source.meta.id, slug: b.pkg.slug }))]) {
    if (ids.has(id)) fail(`${slug}: package id ${id} is used by another package`)
    ids.add(id)
  }
  const fileNames = [...built, ...builtControls, ...builtBundles, ...builtActions].map((b) => b.pkg.fileName)

  const entries: GalleryIndexEntry[] = built.map(({ source, pkg }) => ({
    id: source.meta.id,
    slug: source.meta.slug,
    title: source.meta.title,
    category: source.meta.category,
    summary: source.meta.summary,
    trigger: source.meta.trigger,
    version: source.meta.version,
    released: releaseDate(source),
    tags: source.meta.tags,
    needs: source.meta.needs,
    optional_needs: source.meta.optional_needs ?? [],
    difficulty: source.meta.difficulty,
    setup_minutes: source.meta.setup_minutes,
    file: `/gallery/${pkg.fileName}`,
    file_name: pkg.fileName,
    size_bytes: pkg.bytes.byteLength,
    sha256: pkg.sha256,
    checksum: pkg.manifest.checksum,
    signed: Boolean(pkg.manifest.signature),
    fingerprint: pkg.manifest.signature?.fingerprint ?? null,
    asset_count: pkg.assetCount,
    requirement_count: pkg.manifest.requirements.length,
    page: `/gallery/${source.meta.slug}`,
    source: 'official',
    systems: source.meta.systems ?? [],
    native: isNativeContents(pkg.contents),
  }))
  // Form controls and bundles: kind form_control / control_bundle in the same list (category form-controls).
  for (const { source, pkg } of builtControls) entries.push(controlIndexEntry(source.meta, 'form_control', `/gallery/controls/${source.slug}`, pkg, [source, ...companionControls(source, controlsBySlug)]))
  for (const { source, pkg } of builtBundles) entries.push(controlIndexEntry({ ...source.meta, systems: [] }, 'control_bundle', `/gallery/controls/${source.slug}`, pkg, source.meta.controls.map((slug) => controlsBySlug.get(slug)!).filter(Boolean)))
  // Workflow actions: kind workflow_action (category workflow-actions).
  for (const { source, pkg } of builtActions) entries.push(actionIndexEntry(source, pkg))
  const order = new Map(GALLERY_CATEGORIES.map((c, i) => [c.id as string, i]))
  const kindOrder = (e: GalleryIndexEntry) => (e.kind === 'control_bundle' ? 1 : 0)
  entries.sort((a, b) => (order.get(a.category)! - order.get(b.category)!) || kindOrder(a) - kindOrder(b) || a.title.localeCompare(b.title))
  const index: GalleryIndex = {
    format_version: 1,
    generator: 'usertasks-gallery',
    updated: entries.map((e) => e.released).sort().pop() ?? '1970-01-01',
    signing: {
      signed: Boolean(key),
      fingerprint: key?.fingerprint ?? null,
      public_key: key?.publicKey ?? null,
      key_name: signing.key_name,
      note: key ? `Signed with the ${signing.key_name} key (ed25519).` : 'Development build: these packages are not signed. Verify the sha256 checksums below.',
    },
    categories: GALLERY_CATEGORIES.map((c) => ({ id: c.id, title: c.title, summary: c.summary, count: entries.filter((e) => e.category === c.id).length })),
    packages: entries,
  }
  const bySlug = new Map(built.map((b) => [b.source.slug, b]))
  const controlCatalog: ControlCatalogEntry[] = [
    ...builtControls.map(({ source, pkg }) => controlCatalogEntry(source, pkg, controlsBySlug)).sort((a, b) => a.title.localeCompare(b.title)),
    ...builtBundles.map(({ source, pkg }) => controlBundleCatalogEntry(source, pkg, controlsBySlug)),
  ]
  const catalog: GalleryCatalog = {
    format_version: 1,
    packages: entries.filter((e) => (e.kind ?? 'process') === 'process').map((e) => catalogEntry(bySlug.get(e.slug)!.source, bySlug.get(e.slug)!.pkg)),
    ...(controlCatalog.length ? { controls: controlCatalog } : {}),
    ...(builtActions.length ? { actions: builtActions.map(({ source, pkg }) => actionCatalogEntry(source, pkg, actionExamples.get(source.slug) ?? [])).sort((a, b) => a.title.localeCompare(b.title)) as ActionCatalogEntry[] } : {}),
  }
  const allBuilt = new Map([...built, ...builtControls, ...builtBundles, ...builtActions].map((b) => [b.pkg.slug === b.source.slug ? b.source.slug : b.pkg.slug, b.pkg]))

  if (check) {
    const problems: string[] = []
    const indexFile = join(GALLERY_OUTPUT_DIR, 'index.json')
    if (!existsSync(indexFile)) problems.push('public/gallery/index.json is missing')
    else {
      const committed = JSON.parse(readFileSync(indexFile, 'utf8')) as GalleryIndex
      const bySlugCommitted = new Map(committed.packages.map((p) => [p.slug, p]))
      for (const entry of entries) {
        const old = bySlugCommitted.get(entry.slug)
        if (!old) { problems.push(`${entry.slug}: not in index.json`); continue }
        if (old.checksum !== entry.checksum) problems.push(`${entry.slug}: index.json checksum is stale (sources changed)`)
        const file = join(GALLERY_OUTPUT_DIR, entry.file_name)
        if (!existsSync(file)) { problems.push(`${entry.slug}: ${entry.file_name} is missing`); continue }
        const unpacked = unpackPackage(new Uint8Array(readFileSync(file)))
        if (!unpacked.verification.valid) problems.push(`${entry.slug}: ${entry.file_name} fails verification (${unpacked.verification.errors.join('; ')})`)
        if (unpacked.manifest.checksum !== entry.checksum) problems.push(`${entry.slug}: ${entry.file_name} is stale`)
        if (committed.signing.signed && !unpacked.verification.signed) problems.push(`${entry.slug}: index.json says signed but the file is not`)
      }
      for (const slug of bySlugCommitted.keys()) if (!allBuilt.has(slug)) problems.push(`${slug}: in index.json but has no source`)
    }
    const catalogText = existsSync(GALLERY_CATALOG_FILE) ? readFileSync(GALLERY_CATALOG_FILE, 'utf8') : ''
    if (catalogText !== stable(catalog)) problems.push('lib/gallery/catalog.json is stale')
    if (problems.length) {
      for (const problem of problems) console.error(`  ${problem}`)
      fail('outputs are out of date: run npm run gallery:build (with GALLERY_SIGNING_KEY for a release)')
    }
    console.log(`✓ gallery up to date (${entries.length} packages)`)
    return
  }

  if (outDir) {
    mkdirSync(outDir, { recursive: true })
    for (const pkg of allBuilt.values()) writeFileSync(join(outDir, pkg.fileName), pkg.bytes)
    writeFileSync(join(outDir, 'index.json'), stable(index))
    console.log(`✓ ${entries.length} package${entries.length === 1 ? '' : 's'} → ${outDir}`)
    return
  }
  mkdirSync(GALLERY_OUTPUT_DIR, { recursive: true })
  const keep = new Set([...fileNames, 'index.json'])
  for (const name of readdirSync(GALLERY_OUTPUT_DIR)) if (!keep.has(name) && name.endsWith('.utpkg')) rmSync(join(GALLERY_OUTPUT_DIR, name))
  for (const pkg of allBuilt.values()) writeFileSync(join(GALLERY_OUTPUT_DIR, pkg.fileName), pkg.bytes)
  writeFileSync(join(GALLERY_OUTPUT_DIR, 'index.json'), stable(index))
  writeFileSync(GALLERY_CATALOG_FILE, stable(catalog))
  for (const entry of entries) console.log(`  ${entry.signed ? 'signed  ' : 'unsigned'} ${entry.file_name.padEnd(52)} ${(entry.size_bytes / 1024).toFixed(1).padStart(6)} KB  ${entry.requirement_count} requirements`)
  console.log(`✓ ${entries.length} packages → public/gallery/ (${key ? `signed, ${key.fingerprint}` : 'UNSIGNED'})`)
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
