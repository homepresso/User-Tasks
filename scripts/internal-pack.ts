/**
 * Internal packages (internal/packages/<slug>): packages for the operators of
 * an instance, never published — not in gallery/packages, so the gallery
 * build, catalog and index never see them, and internal/** is left out of the
 * public export (.public-exclude). Same source layout and validator as the
 * gallery; the built .utpkg goes to internal/dist/ (git-ignored), ready for
 * Packages → Import a package (file).
 *
 *   npm run internal:pack -- cloud-admin             # validate + build internal/dist/cloud-admin-<version>.utpkg
 *   npm run internal:pack -- --validate cloud-admin  # validate only
 *
 * Unsigned (the gallery key signs public gallery packages only).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildGalleryPackage, packageAssets } from '@/lib/gallery/build'
import { listGallerySlugs, readGallerySource } from '@/lib/gallery/source'
import { validateGallerySource } from '@/lib/gallery/validate'
import { validateWorkflowWiring } from '@/lib/workflow-wiring'
import { reservedFormContextNames } from '@/lib/forms/form-params'

export const INTERNAL_PACKAGES_DIR = resolve(process.cwd(), 'internal', 'packages')
const OUT = resolve(process.cwd(), 'internal', 'dist')

const args = process.argv.slice(2)
const validateOnly = args.includes('--validate')
const slugs = args.filter((a) => !a.startsWith('--'))
const targets = slugs.length ? slugs : listGallerySlugs(INTERNAL_PACKAGES_DIR)

let failed = false
for (const slug of targets) {
  const source = readGallerySource(slug, INTERNAL_PACKAGES_DIR)
  // Internal packages are not listed in the gallery: they need no gallery screenshots.
  const issues = validateGallerySource(source).filter((i) => !/screenshots must list/.test(i.message))
  if (issues.length) {
    failed = true
    console.error(`${slug}: ${issues.length} issue(s)`)
    for (const i of issues) console.error(`  ${i.path}: ${i.message}`)
    continue
  }
  // The workflow wiring check (the designer's / workflows_validate warnings): every variable a step reads is set before it.
  const assets = packageAssets(source.manifest) as Record<string, any[]>
  const forms = Object.fromEntries((assets.forms ?? []).map((f: any) => [String(f.id), { fields: f.fields, layout: f.layout, version: 1, name: f.name }]))
  let warnings = 0
  for (const wf of assets.workflows ?? []) {
    const found = validateWorkflowWiring({ nodes: wf.nodes ?? [], edges: wf.edges ?? [], workflowVariables: wf.user_variables ?? [], linkedForms: forms }).filter((w) => w.severity !== 'info')
    for (const w of found) console.error(`  ${wf.name} › ${w.node_label}: ${w.message}`)
    warnings += found.length
  }
  // Form parameters the install would refuse (reserved names).
  for (const f of assets.forms ?? []) for (const r of reservedFormContextNames(f.layout)) { console.error(`  ${f.name}: ${r.kind} ${r.problem}`); warnings++ }
  if (warnings) { failed = true; console.error(`${slug}: ${warnings} wiring warning(s)`); continue }
  console.log(`${slug}: wiring check — 0 warnings`)
  if (validateOnly) { console.log(`${slug}: valid`); continue }
  const built = buildGalleryPackage(source)
  mkdirSync(OUT, { recursive: true })
  const file = join(OUT, built.fileName)
  writeFileSync(file, built.bytes)
  console.log(`${slug}: ${file} (${built.bytes.length} bytes, unsigned)`)
}
if (failed) process.exit(1)
