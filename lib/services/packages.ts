/**
 * Packages — authoring side: a designer picks root artifacts (e.g. a
 * workflow), the package auto-includes everything they depend on
 * (lib/portability/dependencies), the author adds / removes items and picks a
 * data mode per table, and each build produces a signed, versioned .utpkg
 * (lib/packages/format) stored as a published version in this workspace.
 *
 * Shared by /api/v1/packages*, MCP packages_* tools, `usertasks packages …`
 * and the Settings → Packages UI. packages / package_versions are
 * service-role only: every query goes through a service-role client pinned
 * to ctx.tenantId after the permission checks here (packages.view to read,
 * packages.manage to write; building also needs view permission on every
 * section the package exports).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests and rows are free-form JSON */

import { buildManifestExport } from '@/lib/portability/export'
import { DEPENDENCY_TYPES, resolveDependencyClosure, type AssetRef, type ClosureItem, type DependencyAssetType } from '@/lib/portability/dependencies'
import { scrubSecretsForExport } from '@/lib/portability/scrub'
import { exportTableRows, MAX_ROWS_PER_TABLE } from '@/lib/portability/table-rows'
import { countAssets, findSecretLeaks, fromPackageFiles, toPackageFiles, type PackageContents } from '@/lib/packages/build'
import {
  archivePackage,
  PACKAGE_FORMAT_VERSION,
  packPackage,
  unpackPackage,
  type PackageDependency,
  type PackageFileManifest,
  type PackageRequirement,
  type PackageVerification,
} from '@/lib/packages/format'
import { detectRequirements } from '@/lib/packages/requirements'
import { bumpSemver, compareSemver, isSemver, isValidRange, type BumpKind } from '@/lib/packages/semver'
import { getSigningKey, instanceFingerprint, signerTrust, type SignerTrust } from '@/lib/packages/signing'
import { toUrlSlug } from '@/lib/utils/slug'
import { hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { applyPage, audit, dbError, serviceRoleClient, type Page } from './_shared'

export const PACKAGE_LIMITS = { maxFileBytes: 20 * 1024 * 1024, maxAssets: 2000 } as const

/** Section and view permission per asset type a package can carry. */
export const PACKAGE_ASSET_TYPES: Record<DependencyAssetType, { section: string; view: string; label: string }> = {
  workflow: { section: 'workflows', view: 'workflows.view', label: 'Workflow' },
  workflow_activity: { section: 'workflow_activities', view: 'extensibility.view', label: 'Custom step' },
  data_table: { section: 'data_tables', view: 'data.view', label: 'Data table' },
  integration: { section: 'integrations', view: 'integrations.view', label: 'Integration' },
  connector: { section: 'connectors', view: 'integrations.view', label: 'Connector' },
  decision_table: { section: 'decision_tables', view: 'workflows.view', label: 'Decision table' },
  email_template: { section: 'email_templates', view: 'workflows.view', label: 'Email template' },
  agent: { section: 'agents', view: 'agents.view', label: 'Agent' },
  report: { section: 'reports', view: 'reports.view', label: 'Report' },
  role: { section: 'roles', view: 'team.view_members', label: 'Role' },
  mcp_server: { section: 'mcp_servers', view: 'settings.view', label: 'MCP server' },
  retention_policy: { section: 'retention_policies', view: 'settings.view', label: 'Retention policy' },
  log_destination: { section: 'log_destinations', view: 'observability.view', label: 'Log destination' },
  form: { section: 'forms', view: 'forms.view', label: 'Form' },
  form_theme: { section: 'form_themes', view: 'forms.view', label: 'Form theme' },
}

export type DataMode = 'schema' | 'rows'

export interface PackageItemInput { type: DependencyAssetType; id: string }

export interface PackageRow {
  id: string
  package_uid: string
  name: string
  slug: string
  description: string | null
  author: string | null
  icon: string | null
  readme: string | null
  roots: PackageItemInput[]
  items: PackageItemInput[]
  excluded: PackageItemInput[]
  data_modes: Record<string, DataMode>
  latest_version: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

const PACKAGE_COLUMNS = 'id, package_uid, name, slug, description, author, icon, readme, roots, items, excluded, data_modes, latest_version, created_by, created_at, updated_at'
const VERSION_COLUMNS = 'id, package_id, version, checksum, signed, fingerprint, size_bytes, asset_count, notes, created_by, created_at'

async function admin(ctx: ServiceContext): Promise<AnySupabaseClient> {
  return serviceRoleClient(ctx)
}

function refKey(ref: { type: string; id: string }) { return `${ref.type}:${ref.id}` }

function normalizeItems(value: unknown, field: string): PackageItemInput[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw ServiceError.validation(`${field} must be an array of { type, id }`)
  const seen = new Set<string>()
  const out: PackageItemInput[] = []
  for (const item of value) {
    const type = String(item?.type ?? '') as DependencyAssetType
    const id = String(item?.id ?? '')
    if (!DEPENDENCY_TYPES.includes(type)) throw ServiceError.validation(`${field}: unknown type "${type}" (expected ${DEPENDENCY_TYPES.join(', ')})`)
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw ServiceError.validation(`${field}: "${id}" is not an id`)
    if (seen.has(refKey({ type, id }))) continue
    seen.add(refKey({ type, id }))
    out.push({ type, id })
  }
  return out
}

function normalizeDataModes(value: unknown): Record<string, DataMode> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw ServiceError.validation('data_modes must be an object { <table id>: "schema" | "rows" }')
  const out: Record<string, DataMode> = {}
  for (const [id, mode] of Object.entries(value as Record<string, unknown>)) {
    if (mode !== 'schema' && mode !== 'rows') throw ServiceError.validation(`data_modes.${id} must be "schema" or "rows"`)
    out[id] = mode
  }
  return out
}

function presentPackage(row: any): PackageRow {
  return {
    ...row,
    roots: Array.isArray(row.roots) ? row.roots : [],
    items: Array.isArray(row.items) ? row.items : [],
    excluded: Array.isArray(row.excluded) ? row.excluded : [],
    data_modes: row.data_modes && typeof row.data_modes === 'object' ? row.data_modes : {},
  }
}

async function loadPackage(ctx: ServiceContext, db: AnySupabaseClient, packageId: string): Promise<PackageRow> {
  const column = /^[0-9a-f-]{36}$/i.test(packageId) ? 'id' : 'slug'
  const { data, error } = await (db as any).from('packages').select(PACKAGE_COLUMNS).eq('tenant_id', ctx.tenantId).eq(column, packageId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Package not found')
  return presentPackage(data)
}

/** Only ids that exist in this workspace, with their type checked. */
async function assertItemsExist(ctx: ServiceContext, db: AnySupabaseClient, items: PackageItemInput[]) {
  const TABLE: Record<DependencyAssetType, string> = {
    workflow: 'workflows', workflow_activity: 'custom_workflow_activities', data_table: 'custom_tables', integration: 'integrations',
    connector: 'tenant_connectors', decision_table: 'decision_tables', email_template: 'email_templates', agent: 'agents', report: 'reports',
    role: 'roles', mcp_server: 'mcp_servers', retention_policy: 'retention_policies', log_destination: 'log_destinations',
    form: 'forms', form_theme: 'form_themes',
  }
  const byType = new Map<DependencyAssetType, string[]>()
  for (const item of items) byType.set(item.type, [...(byType.get(item.type) ?? []), item.id])
  for (const [type, ids] of byType) {
    const { data, error } = await (db as any).from(TABLE[type]).select('id').eq('tenant_id', ctx.tenantId).in('id', ids)
    if (error) throw dbError(error)
    const found = new Set(((data ?? []) as any[]).map((r) => String(r.id)))
    const missing = ids.filter((id) => !found.has(id))
    if (missing.length) throw ServiceError.validation(`${PACKAGE_ASSET_TYPES[type].label} ${missing.join(', ')} not found in this workspace`)
  }
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function listPackages(ctx: ServiceContext, page: Page) {
  requirePerm(ctx, 'packages.view')
  const db = await admin(ctx)
  const { data, error } = await applyPage((db as any).from('packages').select(PACKAGE_COLUMNS).eq('tenant_id', ctx.tenantId).order('name'), page)
  if (error) throw dbError(error)
  return { packages: ((data ?? []) as any[]).map(presentPackage) }
}

export async function getPackage(ctx: ServiceContext, packageId: string) {
  requirePerm(ctx, 'packages.view')
  const db = await admin(ctx)
  const pkg = await loadPackage(ctx, db, packageId)
  const { data: versions } = await (db as any).from('package_versions').select(VERSION_COLUMNS)
    .eq('tenant_id', ctx.tenantId).eq('package_id', pkg.id).order('created_at', { ascending: false }).limit(20)
  return { package: pkg, versions: versions ?? [] }
}

export interface PackageCreateInput {
  name: string
  slug?: string
  description?: string | null
  author?: string | null
  icon?: string | null
  readme?: string | null
  /** Root artifacts; dependencies are added automatically. */
  roots: PackageItemInput[]
  /** Extra items added by hand (and their dependencies). */
  items?: PackageItemInput[]
  /** Items removed from the auto-included set. */
  excluded?: PackageItemInput[]
  /** Per data table: schema only (default) or schema + rows. */
  data_modes?: Record<string, DataMode>
  /** Keep the same package identity across workspaces (re-creating a package elsewhere). */
  package_uid?: string
}

export async function createPackage(ctx: ServiceContext, input: PackageCreateInput) {
  requirePerm(ctx, 'packages.manage')
  const name = String(input.name ?? '').trim()
  if (!name) throw ServiceError.validation('name is required')
  const slug = toUrlSlug(input.slug?.trim() || name, 80)
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) throw ServiceError.validation('slug must be lower-case letters, digits and dashes')
  const roots = normalizeItems(input.roots, 'roots')
  if (!roots.length) throw ServiceError.validation('roots must name at least one artifact (e.g. { "type": "workflow", "id": "…" })')
  const items = normalizeItems(input.items, 'items')
  const excluded = normalizeItems(input.excluded, 'excluded')
  const db = await admin(ctx)
  await assertItemsExist(ctx, db, [...roots, ...items])
  const { data, error } = await (db as any).from('packages').insert({
    tenant_id: ctx.tenantId,
    ...(input.package_uid && /^[0-9a-f-]{36}$/i.test(input.package_uid) ? { package_uid: input.package_uid } : {}),
    name, slug,
    description: input.description?.trim() || null,
    author: input.author?.trim() || null,
    icon: input.icon?.trim() || null,
    readme: input.readme ?? null,
    roots, items, excluded,
    data_modes: normalizeDataModes(input.data_modes),
    created_by: ctx.actorId,
  }).select(PACKAGE_COLUMNS).single()
  if (error) {
    if ((error as any).code === '23505') throw ServiceError.conflict(`A package with the slug "${slug}" already exists`)
    throw dbError(error)
  }
  await audit({ ...ctx, supabase: db }, { objectType: 'package', objectId: data.id, action: 'create', summary: `Created package "${name}"`, metadata: { roots: roots.length } })
  return { package: presentPackage(data) }
}

export type PackageUpdateInput = Partial<Omit<PackageCreateInput, 'package_uid'>> & {
  /** Convenience: add / remove items without resending the lists. */
  add?: PackageItemInput[]
  remove?: PackageItemInput[]
}

export async function updatePackage(ctx: ServiceContext, packageId: string, input: PackageUpdateInput) {
  requirePerm(ctx, 'packages.manage')
  const db = await admin(ctx)
  const pkg = await loadPackage(ctx, db, packageId)
  const update: Record<string, unknown> = {}
  if (input.name !== undefined && input.name !== null) {
    const name = String(input.name).trim()
    if (!name) throw ServiceError.validation('name cannot be empty')
    update.name = name
  }
  if (input.slug !== undefined && input.slug !== null) update.slug = toUrlSlug(String(input.slug), 80)
  for (const key of ['description', 'author', 'icon', 'readme'] as const) {
    if (input[key] !== undefined) update[key] = input[key] === null ? null : String(input[key])
  }
  let roots = input.roots !== undefined && input.roots !== null ? normalizeItems(input.roots, 'roots') : pkg.roots
  let items = input.items !== undefined && input.items !== null ? normalizeItems(input.items, 'items') : pkg.items
  let excluded = input.excluded !== undefined && input.excluded !== null ? normalizeItems(input.excluded, 'excluded') : pkg.excluded
  const add = normalizeItems(input.add, 'add')
  const remove = normalizeItems(input.remove, 'remove')
  if (add.length) {
    const addKeys = new Set(add.map(refKey))
    excluded = excluded.filter((item) => !addKeys.has(refKey(item)))
    const known = new Set([...roots, ...items].map(refKey))
    items = [...items, ...add.filter((item) => !known.has(refKey(item)))]
  }
  if (remove.length) {
    const removeKeys = new Set(remove.map(refKey))
    roots = roots.filter((item) => !removeKeys.has(refKey(item)))
    items = items.filter((item) => !removeKeys.has(refKey(item)))
    const known = new Set(excluded.map(refKey))
    excluded = [...excluded, ...remove.filter((item) => !known.has(refKey(item)))]
  }
  if (!roots.length) throw ServiceError.validation('A package needs at least one root artifact')
  await assertItemsExist(ctx, db, [...roots, ...add])
  update.roots = roots
  update.items = items
  update.excluded = excluded
  if (input.data_modes !== undefined && input.data_modes !== null) update.data_modes = { ...pkg.data_modes, ...normalizeDataModes(input.data_modes) }
  const { data, error } = await (db as any).from('packages').update(update).eq('id', pkg.id).eq('tenant_id', ctx.tenantId).select(PACKAGE_COLUMNS).single()
  if (error) {
    if ((error as any).code === '23505') throw ServiceError.conflict(`A package with the slug "${update.slug}" already exists`)
    throw dbError(error)
  }
  await audit({ ...ctx, supabase: db }, { objectType: 'package', objectId: pkg.id, action: 'update', summary: `Updated package "${data.name}"`, metadata: { fields: Object.keys(update) } })
  return { package: presentPackage(data) }
}

export async function deletePackage(ctx: ServiceContext, packageId: string) {
  requirePerm(ctx, 'packages.manage')
  const db = await admin(ctx)
  const pkg = await loadPackage(ctx, db, packageId)
  const { error } = await (db as any).from('packages').delete().eq('id', pkg.id).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error)
  await audit({ ...ctx, supabase: db }, { objectType: 'package', objectId: pkg.id, action: 'delete', summary: `Deleted package "${pkg.name}" and its built versions (installed copies elsewhere are unaffected)` })
  return { deleted: true as const, id: pkg.id }
}

// ─── Contents (dependency closure + requirements preview) ──────────────────

export interface PackageContentItem extends ClosureItem {
  section: string
  label: string
  /** root | dependency | manual */
  included_as: 'root' | 'dependency' | 'manual'
  /** Data tables: schema or rows (and the row count). */
  data_mode?: DataMode
  row_count?: number
}

export interface PackageContentsPreview {
  items: PackageContentItem[]
  excluded: Array<PackageItemInput & { name: string | null }>
  missing: Array<{ type: string; id: string; required_by: { type: string; id: string } }>
  requirements: PackageRequirement[]
  warnings: string[]
}

async function resolveContents(ctx: ServiceContext, db: AnySupabaseClient, pkg: PackageRow): Promise<{ preview: PackageContentsPreview; closure: Awaited<ReturnType<typeof resolveDependencyClosure>> }> {
  const excludedKeys = new Set(pkg.excluded.map(refKey))
  const manualKeys = new Set(pkg.items.map(refKey))
  const rootKeys = new Set(pkg.roots.map(refKey))
  const closure = await resolveDependencyClosure(db, ctx.tenantId, [...pkg.roots, ...pkg.items].filter((r) => !excludedKeys.has(refKey(r))) as AssetRef[], { exclude: excludedKeys, maxItems: PACKAGE_LIMITS.maxAssets })
  const warnings: string[] = []

  const tableIds = closure.items.filter((item) => item.type === 'data_table').map((item) => item.id)
  const rowCounts = new Map<string, number>()
  for (const tableId of tableIds) {
    const { count } = await (db as any).from('custom_table_rows').select('id', { count: 'exact', head: true }).eq('tenant_id', ctx.tenantId).eq('table_id', tableId)
    rowCounts.set(tableId, count ?? 0)
  }
  const items: PackageContentItem[] = closure.items.map((item) => ({
    ...item,
    section: PACKAGE_ASSET_TYPES[item.type].section,
    label: PACKAGE_ASSET_TYPES[item.type].label,
    included_as: rootKeys.has(refKey(item)) ? 'root' : manualKeys.has(refKey(item)) ? 'manual' : 'dependency',
    ...(item.type === 'data_table' ? { data_mode: pkg.data_modes[item.id] ?? 'schema', row_count: rowCounts.get(item.id) ?? 0 } : {}),
  }))
  for (const item of items) {
    if (item.type === 'data_table' && item.data_mode === 'rows' && (item.row_count ?? 0) > MAX_ROWS_PER_TABLE) {
      warnings.push(`${item.name}: ${item.row_count} rows; at most ${MAX_ROWS_PER_TABLE} rows per table can be packaged`)
    }
  }
  for (const missing of closure.missing) warnings.push(`A ${missing.type.replace(/_/g, ' ')} (${missing.id}) used by ${missing.required_by.type.replace(/_/g, ' ')} ${missing.required_by.id} does not exist in this workspace`)

  // Requirements preview from the same scrubbed export a build uses.
  const idsByType: Partial<Record<string, string[]>> = {}
  for (const item of closure.items) (idsByType[item.type] ??= []).push(item.id)
  const assets = Object.keys(idsByType).length ? scrubSecretsForExport(await buildManifestExport(db, ctx.tenantId, idsByType)) : {}
  const requirements = detectRequirements(assets, { people: closure.people, systemRoles: closure.system_roles })

  const excludedNames: PackageContentsPreview['excluded'] = []
  for (const item of pkg.excluded) {
    const table = { workflow: 'workflows', workflow_activity: 'custom_workflow_activities', data_table: 'custom_tables', integration: 'integrations', connector: 'tenant_connectors', decision_table: 'decision_tables', email_template: 'email_templates', agent: 'agents', report: 'reports', role: 'roles', mcp_server: 'mcp_servers', retention_policy: 'retention_policies', log_destination: 'log_destinations', form: 'forms', form_theme: 'form_themes' }[item.type]
    const column = item.type === 'connector' ? 'display_name' : 'name'
    const { data } = await (db as any).from(table).select(`id, ${column}`).eq('tenant_id', ctx.tenantId).eq('id', item.id).maybeSingle()
    excludedNames.push({ ...item, name: data ? String(data[column] ?? '') : null })
  }
  return { preview: { items, excluded: excludedNames, missing: closure.missing as any, requirements, warnings }, closure }
}

export async function getPackageContents(ctx: ServiceContext, packageId: string): Promise<PackageContentsPreview> {
  requirePerm(ctx, 'packages.view')
  const db = await admin(ctx)
  const pkg = await loadPackage(ctx, db, packageId)
  return (await resolveContents(ctx, db, pkg)).preview
}

/** Dependency closure of arbitrary roots (the "create package" picker preview). */
export async function previewPackageContents(ctx: ServiceContext, input: { roots: PackageItemInput[]; items?: PackageItemInput[]; excluded?: PackageItemInput[]; data_modes?: Record<string, DataMode> }) {
  requirePerm(ctx, 'packages.view')
  const db = await admin(ctx)
  const pkg = {
    roots: normalizeItems(input.roots, 'roots'), items: normalizeItems(input.items, 'items'), excluded: normalizeItems(input.excluded, 'excluded'), data_modes: normalizeDataModes(input.data_modes),
  } as PackageRow
  return (await resolveContents(ctx, db, pkg)).preview
}

// ─── Build / versions ───────────────────────────────────────────────────────

export interface BuildVersionInput {
  /** Exact semver; default: bump the latest version (`bump`, default patch) or 1.0.0. */
  version?: string
  bump?: BumpKind
  notes?: string | null
  dependencies?: PackageDependency[]
  /** Return the .utpkg bytes (base64) with the result. */
  include_file?: boolean
}

export interface BuiltVersion {
  version: Record<string, any>
  manifest: PackageFileManifest
  warnings: string[]
  file_base64?: string
  file_name: string
}

export function packageFileName(slug: string, version: string) {
  return `${slug}-${version}.utpkg`
}

export async function buildPackageVersion(ctx: ServiceContext, packageId: string, input: BuildVersionInput = {}): Promise<BuiltVersion> {
  requirePerm(ctx, 'packages.manage')
  const db = await admin(ctx)
  const pkg = await loadPackage(ctx, db, packageId)
  const { preview, closure } = await resolveContents(ctx, db, pkg)
  const warnings = [...preview.warnings]
  if (!preview.items.length) throw ServiceError.validation('The package is empty')

  // Exporting a section needs its view permission (as config export).
  const missingView = [...new Set(preview.items.map((item) => PACKAGE_ASSET_TYPES[item.type].view))].filter((perm) => !hasPerm(ctx, perm))
  if (missingView.length) throw ServiceError.forbidden(`Forbidden: building this package needs ${missingView.map((p) => `'${p}'`).join(', ')}`)

  const version = input.version?.trim() || bumpSemver(pkg.latest_version, input.bump ?? 'patch')
  if (!isSemver(version)) throw ServiceError.validation(`"${version}" is not a semantic version (e.g. 1.2.0)`)
  if (pkg.latest_version && compareSemver(version, pkg.latest_version) <= 0) {
    throw ServiceError.conflict(`Version ${version} must be greater than the latest version ${pkg.latest_version}`)
  }
  const dependencies = (input.dependencies ?? []).map((dep) => ({ package_slug: String(dep.package_slug ?? '').trim(), version_range: String(dep.version_range ?? '*').trim() || '*' }))
  for (const dep of dependencies) {
    if (!dep.package_slug) throw ServiceError.validation('dependencies[].package_slug is required')
    if (!isValidRange(dep.version_range)) throw ServiceError.validation(`dependencies: "${dep.version_range}" is not a version range`)
  }

  const idsByType: Partial<Record<string, string[]>> = {}
  for (const item of preview.items) (idsByType[item.type] ??= []).push(item.id)
  const assets = scrubSecretsForExport(await buildManifestExport(db, ctx.tenantId, idsByType))
  if (countAssets(assets) > PACKAGE_LIMITS.maxAssets) throw ServiceError.validation(`Too many assets (limit ${PACKAGE_LIMITS.maxAssets})`)

  const data: PackageContents['data'] = {}
  for (const table of assets.data_tables ?? []) {
    const mode = pkg.data_modes[String(table.id)] ?? 'schema'
    if (mode === 'rows') {
      if (!hasPerm(ctx, 'data.view')) throw ServiceError.forbidden("Forbidden: packaging table rows needs 'data.view'")
      try {
        data[String(table.id)] = { mode: 'rows', rows: await exportTableRows(db, ctx.tenantId, String(table.id)) }
      } catch (error) {
        throw ServiceError.validation(`${table.name}: ${error instanceof Error ? error.message : 'rows could not be exported'}`)
      }
    } else {
      data[String(table.id)] = { mode: 'schema' }
    }
  }
  const requirements = detectRequirements(assets, { people: closure.people, systemRoles: closure.system_roles })

  const { data: tenant } = await (db as any).from('tenants').select('name').eq('id', ctx.tenantId).maybeSingle()
  const contents: PackageContents = {
    header: {
      id: pkg.package_uid,
      name: pkg.name,
      slug: pkg.slug,
      version,
      description: pkg.description,
      author: pkg.author ?? (tenant?.name ? String(tenant.name) : null),
      created_at: new Date().toISOString(),
      ...(pkg.icon ? { icon: pkg.icon } : {}),
      readme: pkg.readme,
    },
    assets,
    data,
    requirements,
    dependencies,
  }
  const laidOut = toPackageFiles(contents)
  const leaks = findSecretLeaks(laidOut.files)
  if (leaks.length) throw new ServiceError('internal', `Refusing to build: credential material found in ${leaks.slice(0, 5).join(', ')}`)

  const signing = await getSigningKey(db)
  if (signing.warning) warnings.push(signing.warning)
  const packed = packPackage({ ...laidOut, signingKeyPem: signing.key?.privateKeyPem ?? null })
  if (packed.bytes.byteLength > PACKAGE_LIMITS.maxFileBytes) throw ServiceError.validation(`The package is too large (${(packed.bytes.byteLength / 1024 / 1024).toFixed(1)} MB; limit ${PACKAGE_LIMITS.maxFileBytes / 1024 / 1024} MB)`)

  const { data: row, error } = await (db as any).from('package_versions').insert({
    tenant_id: ctx.tenantId,
    package_id: pkg.id,
    version,
    manifest: packed.manifest,
    files: packed.files,
    checksum: packed.manifest.checksum,
    signed: Boolean(packed.manifest.signature),
    fingerprint: packed.manifest.signature?.fingerprint ?? null,
    size_bytes: packed.bytes.byteLength,
    asset_count: countAssets(assets),
    notes: input.notes?.trim() || null,
    created_by: ctx.actorId,
  }).select(VERSION_COLUMNS).single()
  if (error) {
    if ((error as any).code === '23505') throw ServiceError.conflict(`Version ${version} already exists`)
    throw dbError(error)
  }
  await (db as any).from('packages').update({ latest_version: version }).eq('id', pkg.id).eq('tenant_id', ctx.tenantId)
  await audit({ ...ctx, supabase: db }, {
    objectType: 'package', objectId: pkg.id, action: 'publish',
    summary: `Built ${pkg.name} ${version} (${countAssets(assets)} assets${packed.manifest.signature ? ', signed' : ', unsigned'})`,
    metadata: { version, checksum: packed.manifest.checksum, requirements: requirements.length, fingerprint: packed.manifest.signature?.fingerprint ?? null },
  })
  return {
    version: row,
    manifest: packed.manifest,
    warnings,
    file_name: packageFileName(pkg.slug, version),
    ...(input.include_file ? { file_base64: Buffer.from(packed.bytes).toString('base64') } : {}),
  }
}

export async function listPackageVersions(ctx: ServiceContext, packageId: string, page: Page) {
  requirePerm(ctx, 'packages.view')
  const db = await admin(ctx)
  const pkg = await loadPackage(ctx, db, packageId)
  const { data, error } = await applyPage((db as any).from('package_versions').select(VERSION_COLUMNS)
    .eq('tenant_id', ctx.tenantId).eq('package_id', pkg.id).order('created_at', { ascending: false }), page)
  if (error) throw dbError(error)
  return { versions: data ?? [] }
}

async function loadVersion(ctx: ServiceContext, db: AnySupabaseClient, packageId: string, versionId: string) {
  const pkg = await loadPackage(ctx, db, packageId)
  const column = /^[0-9a-f-]{36}$/i.test(versionId) ? 'id' : 'version'
  const value = versionId === 'latest' ? pkg.latest_version : versionId
  if (!value) throw ServiceError.notFound('The package has no built versions yet')
  const { data, error } = await (db as any).from('package_versions').select(`${VERSION_COLUMNS}, manifest, files`)
    .eq('tenant_id', ctx.tenantId).eq('package_id', pkg.id).eq(versionId === 'latest' ? 'version' : column, value).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Package version not found')
  return { pkg, version: data }
}

export async function getPackageVersion(ctx: ServiceContext, packageId: string, versionId: string) {
  requirePerm(ctx, 'packages.view')
  const db = await admin(ctx)
  const { version } = await loadVersion(ctx, db, packageId, versionId)
  const { files: _files, ...rest } = version
  return { version: rest }
}

/** The .utpkg bytes of a built version (rebuilt byte-identically from the stored parts). */
export async function downloadPackageVersion(ctx: ServiceContext, packageId: string, versionId: string): Promise<{ file_name: string; bytes: Uint8Array; checksum: string }> {
  requirePerm(ctx, 'packages.view')
  const db = await admin(ctx)
  const { pkg, version } = await loadVersion(ctx, db, packageId, versionId)
  const bytes = archivePackage(version.manifest, version.files ?? [])
  return { file_name: packageFileName(pkg.slug, String(version.version)), bytes, checksum: String(version.checksum) }
}

// ─── Reading package files ──────────────────────────────────────────────────

export interface ReadPackageResult {
  contents: PackageContents
  manifest: PackageFileManifest
  verification: PackageVerification & { trust: SignerTrust }
  size_bytes: number
}

export function decodePackageFile(fileBase64: string): Uint8Array {
  const clean = String(fileBase64 ?? '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
  if (!clean) throw ServiceError.validation('file is required (base64 of a .utpkg file)')
  const bytes = Buffer.from(clean, 'base64')
  if (bytes.byteLength > PACKAGE_LIMITS.maxFileBytes) throw new ServiceError('validation_error', `The package is too large (limit ${PACKAGE_LIMITS.maxFileBytes / 1024 / 1024} MB)`, { status: 413 })
  return new Uint8Array(bytes)
}

/** Unpack + verify; never trusts a package whose checksum, files or signature fail. */
export async function readPackageFile(ctx: ServiceContext, bytes: Uint8Array): Promise<ReadPackageResult> {
  let unpacked
  try {
    unpacked = unpackPackage(bytes)
  } catch (error) {
    throw ServiceError.validation(error instanceof Error ? error.message : 'Not a package file')
  }
  const { contents, errors } = fromPackageFiles(unpacked.manifest, unpacked.files)
  const verification = { ...unpacked.verification, errors: [...unpacked.verification.errors, ...errors] }
  if (errors.length) verification.valid = false
  const db = await admin(ctx)
  const trust = signerTrust(verification.signature_ok ? verification.fingerprint : null, await instanceFingerprint(db).catch(() => null))
  return { contents, manifest: unpacked.manifest, verification: { ...verification, trust }, size_bytes: bytes.byteLength }
}

/** Summary of a package file (no workspace changes): header, verification, contents, requirements. */
export async function inspectPackage(ctx: ServiceContext, input: { file?: string; package_id?: string; version?: string }) {
  requirePerm(ctx, 'packages.view')
  const bytes = input.file ? decodePackageFile(input.file) : input.package_id ? (await downloadPackageVersion(ctx, input.package_id, input.version ?? 'latest')).bytes : null
  if (!bytes) throw ServiceError.validation('Provide file (base64 .utpkg) or package_id')
  const read = await readPackageFile(ctx, bytes)
  return summarizePackage(read)
}

export function summarizePackage(read: ReadPackageResult) {
  const assets: Array<{ section: string; id: string; name: string }> = []
  for (const [section, list] of Object.entries(read.contents.assets)) {
    if (!Array.isArray(list)) continue
    for (const asset of list) assets.push({ section, id: String(section === 'objects' ? asset.generated_reference_id ?? asset.id : asset.id), name: String(asset.name ?? 'untitled') })
  }
  return {
    format_version: read.manifest.format_version ?? PACKAGE_FORMAT_VERSION,
    package: read.contents.header,
    verification: read.verification,
    size_bytes: read.size_bytes,
    assets,
    data: Object.entries(read.contents.data).map(([table_id, entry]) => ({ table_id, mode: entry.mode, rows: entry.rows?.length ?? 0 })),
    requirements: read.contents.requirements,
    dependencies: read.contents.dependencies,
  }
}

