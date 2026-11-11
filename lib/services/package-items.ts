/**
 * Package items — edit what an authored package contains, item by item:
 *
 * - listPackageItems: every item now in the package (roots, added items and
 *   the dependencies they pull in), what each uses and is used by, what
 *   changed since the last built version ("Unpublished changes") and whether
 *   the package is installed in this workspace (the Agent's self-installed
 *   solutions: building can update that install's ownership record).
 * - addPackageItems: add workspace items; `dry_run` lists the dependencies
 *   they would bring in that are not in the package yet (the "add with
 *   dependencies" prompt). with_dependencies (default true) includes them —
 *   also ones the author left out earlier; false leaves them out.
 * - removePackageItems: remove items; refused (409) when another item in the
 *   package still uses one ("Workflow X uses this form") unless `force`.
 *   `dry_run` lists those dependents first. A removed item that something in
 *   the package still pulls in is left out (excluded), so it stays out.
 *
 * Changes edit the package's draft (packages.roots / items / excluded); the
 * next build (POST /packages/{id}/versions, `update_install` for the
 * self-installed case) publishes them. Nothing in the workspace is changed.
 *
 * Shared by /api/v1/packages/{id}/items*, MCP packages_items_*, the CLI and
 * Packages → Authored here. Permissions: packages.view to list and plan,
 * packages.manage to change, plus view permission on each added item's type.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role client, exported assets */

import { buildManifestExport } from '@/lib/portability/export'
import { resolveDependencyClosure, type AssetRef, type DependencyAssetType } from '@/lib/portability/dependencies'
import { fromPackageFiles } from '@/lib/packages/build'
import { PACKAGE_ASSETS_PREFIX } from '@/lib/packages/format'
import { addToDraft } from '@/lib/packages/asset-picker'
import { dependentsOf, describeDependents, itemDependencyGraph, itemKey, removeFromLists, versionChanges, versionItemRefs, type Dependent, type ItemGraph } from '@/lib/packages/items'
import { hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'
import { assertItemsExist, loadPackage, normalizeItems, PACKAGE_ASSET_TYPES, PACKAGE_COLUMNS, PACKAGE_LIMITS, presentPackage, type PackageItemInput, type PackageRow } from './packages'

export interface PackageItemRef { type: DependencyAssetType; id: string; name: string; label: string }

export interface PackageItem extends PackageItemRef {
  section: string
  /** root (started the package) | manual (added by hand) | dependency (used by another item). */
  included_as: 'root' | 'manual' | 'dependency'
  /** Dependencies: the item that first needed it. */
  required_by: PackageItemRef | null
  /** Items in the package this one uses. */
  uses: PackageItemRef[]
  /** Items in the package that use this one (removing it warns). */
  used_by: PackageItemRef[]
  data_mode?: 'schema' | 'rows'
}

export interface PackageChanges {
  /** Latest built version (null: never built). */
  since_version: string | null
  /** True when the package has items no built version has, or lost some (or it was never built). */
  unpublished: boolean
  added: PackageItemRef[]
  removed: PackageItemRef[]
}

export interface PackageItemsResult {
  package: { id: string; name: string; slug: string; package_uid: string; latest_version: string | null }
  items: PackageItem[]
  /** Item counts per type (for grouping). */
  groups: Array<{ type: DependencyAssetType; label: string; count: number }>
  excluded: Array<{ type: string; id: string; name: string | null; label: string }>
  changes: PackageChanges
  /** Installed in this workspace (the package was built and installed here): building can update the install. */
  install: { id: string; version: string; status: string } | null
}

const TABLE: Record<DependencyAssetType, { table: string; name: string }> = {
  workflow: { table: 'workflows', name: 'name' }, workflow_activity: { table: 'custom_workflow_activities', name: 'name' }, data_table: { table: 'custom_tables', name: 'name' },
  integration: { table: 'integrations', name: 'name' }, connector: { table: 'tenant_connectors', name: 'display_name' }, decision_table: { table: 'decision_tables', name: 'name' },
  email_template: { table: 'email_templates', name: 'name' }, agent: { table: 'agents', name: 'name' }, report: { table: 'reports', name: 'name' }, role: { table: 'roles', name: 'name' },
  mcp_server: { table: 'mcp_servers', name: 'name' }, retention_policy: { table: 'retention_policies', name: 'name' }, log_destination: { table: 'log_destinations', name: 'name' },
  form: { table: 'forms', name: 'name' }, form_theme: { table: 'form_themes', name: 'name' }, form_control: { table: 'form_controls', name: 'name' },
}
const TYPE_ORDER = Object.keys(PACKAGE_ASSET_TYPES) as DependencyAssetType[]

const labelOf = (type: string) => PACKAGE_ASSET_TYPES[type as DependencyAssetType]?.label ?? type.replace(/_/g, ' ')
const refOf = (type: string, id: string, name: string): PackageItemRef => ({ type: type as DependencyAssetType, id, name, label: labelOf(type) })

async function namesOf(ctx: ServiceContext, db: AnySupabaseClient, refs: ReadonlyArray<{ type: string; id: string }>): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const byType = new Map<DependencyAssetType, string[]>()
  for (const ref of refs) if (TABLE[ref.type as DependencyAssetType]) byType.set(ref.type as DependencyAssetType, [...(byType.get(ref.type as DependencyAssetType) ?? []), ref.id])
  await Promise.all([...byType].map(async ([type, ids]) => {
    const { table, name } = TABLE[type]
    const { data } = await (db as any).from(table).select(`id, ${name}`).eq('tenant_id', ctx.tenantId).in('id', ids)
    for (const row of data ?? []) out.set(`${type}:${row.id}`, String(row[name] ?? ''))
  }))
  return out
}

interface PackageState {
  items: PackageItem[]
  byKey: Map<string, PackageItem>
  graph: ItemGraph
}

async function closureOf(ctx: ServiceContext, db: AnySupabaseClient, lists: { roots: PackageItemInput[]; items: PackageItemInput[]; excluded: PackageItemInput[] }) {
  const excluded = new Set(lists.excluded.map(itemKey))
  return resolveDependencyClosure(db, ctx.tenantId, [...lists.roots, ...lists.items].filter((ref) => !excluded.has(itemKey(ref))) as AssetRef[], { exclude: excluded, maxItems: PACKAGE_LIMITS.maxAssets })
}

/** Every item in the package now, with its edges inside the package. */
async function packageState(ctx: ServiceContext, db: AnySupabaseClient, pkg: Pick<PackageRow, 'roots' | 'items' | 'excluded' | 'data_modes'>): Promise<PackageState> {
  const closure = await closureOf(ctx, db, pkg)
  const rootKeys = new Set(pkg.roots.map(itemKey))
  const manualKeys = new Set(pkg.items.map(itemKey))
  const idsByType: Partial<Record<string, string[]>> = {}
  for (const item of closure.items) (idsByType[item.type] ??= []).push(item.id)
  const exported = Object.keys(idsByType).length ? await buildManifestExport(db, ctx.tenantId, idsByType) : {}
  const graph = itemDependencyGraph(exported as Record<string, unknown>)
  const names = new Map(closure.items.map((item) => [itemKey(item), item.name]))
  const ref = (key: string): PackageItemRef => {
    const cut = key.indexOf(':')
    return refOf(key.slice(0, cut), key.slice(cut + 1), names.get(key) ?? '')
  }
  const items: PackageItem[] = closure.items.map((item) => {
    const key = itemKey(item)
    return {
      ...refOf(item.type, item.id, item.name),
      section: PACKAGE_ASSET_TYPES[item.type].section,
      included_as: rootKeys.has(key) ? 'root' : manualKeys.has(key) ? 'manual' : 'dependency',
      required_by: item.required_by === 'root' ? null : ref(itemKey(item.required_by)),
      uses: [...(graph.uses.get(key) ?? [])].filter((k) => names.has(k)).map(ref),
      used_by: [...(graph.usedBy.get(key) ?? [])].filter((k) => names.has(k)).map(ref),
      ...(item.type === 'data_table' ? { data_mode: (pkg.data_modes?.[item.id] ?? 'schema') as 'schema' | 'rows' } : {}),
    }
  })
  items.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name))
  return { items, byKey: new Map(items.map((item) => [itemKey(item), item])), graph }
}

/** Items of the latest built version (added / removed since → "Unpublished changes"). */
async function builtItems(ctx: ServiceContext, db: AnySupabaseClient, pkg: PackageRow): Promise<PackageItemRef[] | null> {
  if (!pkg.latest_version) return null
  const { data, error } = await (db as any).from('package_versions').select('manifest, files')
    .eq('tenant_id', ctx.tenantId).eq('package_id', pkg.id).eq('version', pkg.latest_version).maybeSingle()
  if (error) throw dbError(error)
  if (!data) return null
  const { contents } = fromPackageFiles(data.manifest ?? {}, ((data.files ?? []) as any[]).filter((file) => String(file?.path ?? '').startsWith(`${PACKAGE_ASSETS_PREFIX}/`)))
  return versionItemRefs(contents.assets as Record<string, unknown>).map((r) => refOf(r.type, r.id, r.name))
}

async function selfInstall(ctx: ServiceContext, db: AnySupabaseClient, packageUid: string) {
  const { data } = await (db as any).from('package_installs').select('id, version, status').eq('tenant_id', ctx.tenantId).eq('package_uid', packageUid).maybeSingle()
  return data ? { id: String(data.id), version: String(data.version), status: String(data.status) } : null
}

export async function listPackageItems(ctx: ServiceContext, packageId: string): Promise<PackageItemsResult> {
  requirePerm(ctx, 'packages.view')
  const db = await serviceRoleClient(ctx)
  const pkg = await loadPackage(ctx, db, packageId)
  const [state, built, install] = await Promise.all([packageState(ctx, db, pkg), builtItems(ctx, db, pkg), selfInstall(ctx, db, pkg.package_uid)])
  const current = state.items.map(({ type, id, name, label }) => ({ type, id, name, label }))
  const diff = built ? versionChanges(current, built) : { added: current, removed: [] }
  const excludedNames = await namesOf(ctx, db, pkg.excluded)
  const groups: PackageItemsResult['groups'] = []
  for (const item of state.items) {
    const group = groups.find((g) => g.type === item.type)
    if (group) group.count += 1
    else groups.push({ type: item.type, label: item.label, count: 1 })
  }
  return {
    package: { id: pkg.id, name: pkg.name, slug: pkg.slug, package_uid: pkg.package_uid, latest_version: pkg.latest_version },
    items: state.items,
    groups,
    excluded: pkg.excluded.map((ref) => ({ ...ref, name: excludedNames.get(itemKey(ref)) ?? null, label: labelOf(ref.type) })),
    changes: { since_version: pkg.latest_version, unpublished: !built || diff.added.length > 0 || diff.removed.length > 0, ...diff },
    install,
  }
}

async function saveLists(ctx: ServiceContext, db: AnySupabaseClient, pkg: PackageRow, lists: { roots: PackageItemInput[]; items: PackageItemInput[]; excluded: PackageItemInput[] }, summary: string, metadata: Record<string, unknown>) {
  const { data, error } = await (db as any).from('packages').update({ roots: lists.roots, items: lists.items, excluded: lists.excluded })
    .eq('id', pkg.id).eq('tenant_id', ctx.tenantId).select(PACKAGE_COLUMNS).single()
  if (error) throw dbError(error)
  await audit({ ...ctx, supabase: db }, { objectType: 'package', objectId: pkg.id, action: 'update', summary, metadata })
  return presentPackage(data)
}

// ─── Add ────────────────────────────────────────────────────────────────────

export interface AddPackageItemsInput {
  items: PackageItemInput[]
  /** Also add what the items use that is not in the package yet (default true). */
  with_dependencies?: boolean
  /** Only list what would be added (the dependency prompt). */
  dry_run?: boolean
}

export interface AddPackageItemsResult {
  dry_run: boolean
  /** The items asked for (already_in: in the package already, as a dependency or added). */
  adding: Array<PackageItemRef & { already_in: boolean }>
  /** What they use that is not in the package yet (left_out: the author left it out earlier). */
  dependencies: Array<PackageItemRef & { required_by: PackageItemRef | null; left_out: boolean }>
  /** Dependencies included (with_dependencies) or left out (without). */
  dependencies_added: number
  dependencies_left_out: number
  package?: PackageRow
}

export async function addPackageItems(ctx: ServiceContext, packageId: string, input: AddPackageItemsInput): Promise<AddPackageItemsResult> {
  requirePerm(ctx, input.dry_run ? 'packages.view' : 'packages.manage')
  const refs = normalizeItems(input.items, 'items')
  if (!refs.length) throw ServiceError.validation('items must name at least one item ({ type, id })')
  const hidden = [...new Set(refs.map((ref) => PACKAGE_ASSET_TYPES[ref.type].view))].filter((perm) => !hasPerm(ctx, perm))
  if (hidden.length) throw ServiceError.forbidden(`Forbidden: adding these items needs ${hidden.map((p) => `'${p}'`).join(', ')}`)
  const db = await serviceRoleClient(ctx)
  const pkg = await loadPackage(ctx, db, packageId)
  await assertItemsExist(ctx, db, refs)
  const withDeps = input.with_dependencies !== false

  const before = await closureOf(ctx, db, pkg)
  const beforeKeys = new Set(before.items.map(itemKey))
  const refKeys = new Set(refs.map(itemKey))
  const excludedKeys = new Set(pkg.excluded.map(itemKey))
  // What the new items use, whether or not the author left it out before.
  const theirs = await resolveDependencyClosure(db, ctx.tenantId, refs as AssetRef[], { maxItems: PACKAGE_LIMITS.maxAssets })
  const names = new Map(theirs.items.map((item) => [itemKey(item), item.name]))
  const deps = theirs.items.filter((item) => !refKeys.has(itemKey(item)) && !beforeKeys.has(itemKey(item)))
  const adding = refs.map((ref) => ({ ...refOf(ref.type, ref.id, names.get(itemKey(ref)) ?? ''), already_in: beforeKeys.has(itemKey(ref)) || pkg.roots.concat(pkg.items).some((r) => itemKey(r) === itemKey(ref)) }))
  const dependencies = deps.map((item) => ({
    ...refOf(item.type, item.id, item.name),
    required_by: item.required_by === 'root' ? null : refOf(item.required_by.type, item.required_by.id, names.get(itemKey(item.required_by)) ?? ''),
    left_out: excludedKeys.has(itemKey(item)),
  }))
  const result: AddPackageItemsResult = { dry_run: Boolean(input.dry_run), adding, dependencies, dependencies_added: withDeps ? dependencies.length : 0, dependencies_left_out: withDeps ? 0 : dependencies.filter((d) => !d.left_out).length }
  if (input.dry_run) return result

  const draft = addToDraft({ roots: pkg.roots, items: pkg.items, excluded: pkg.excluded }, refs) as { roots: PackageItemInput[]; items: PackageItemInput[]; excluded: PackageItemInput[] }
  const depKeys = new Set(deps.map(itemKey))
  const excluded = withDeps
    ? draft.excluded.filter((ref) => !depKeys.has(itemKey(ref)))
    : [...draft.excluded, ...deps.filter((d) => !excludedKeys.has(itemKey(d))).map((d) => ({ type: d.type, id: d.id }))]
  const fresh = adding.filter((a) => !a.already_in)
  const saved = await saveLists(ctx, db, pkg, { roots: draft.roots, items: draft.items, excluded },
    `Added ${fresh.length || adding.length} item${(fresh.length || adding.length) === 1 ? '' : 's'} to package "${pkg.name}"${dependencies.length ? (withDeps ? ` with ${dependencies.length} dependenc${dependencies.length === 1 ? 'y' : 'ies'}` : `, leaving out ${dependencies.length} dependenc${dependencies.length === 1 ? 'y' : 'ies'}`) : ''}`,
    { added: refs.map(itemKey), with_dependencies: withDeps, dependencies: deps.map(itemKey) })
  return { ...result, package: saved }
}

// ─── Remove ─────────────────────────────────────────────────────────────────

export interface RemovePackageItemsInput {
  items: PackageItemInput[]
  /** Remove even when other items in the package use them (they are left out of the package). */
  force?: boolean
  dry_run?: boolean
}

export interface RemovePackageItemsResult {
  dry_run: boolean
  removing: PackageItemRef[]
  /** Items being removed that something staying in the package uses. */
  dependents: Array<Dependent<PackageItemRef>>
  /** One line per dependent: "Workflow “Approve” uses form “Request”". */
  warnings: string[]
  /** Removed items that stay out of the package although something still uses them (excluded). */
  left_out: PackageItemRef[]
  package?: PackageRow
}

export async function removePackageItems(ctx: ServiceContext, packageId: string, input: RemovePackageItemsInput): Promise<RemovePackageItemsResult> {
  requirePerm(ctx, input.dry_run ? 'packages.view' : 'packages.manage')
  const refs = normalizeItems(input.items, 'items')
  if (!refs.length) throw ServiceError.validation('items must name at least one item ({ type, id })')
  const db = await serviceRoleClient(ctx)
  const pkg = await loadPackage(ctx, db, packageId)
  const state = await packageState(ctx, db, pkg)
  const listed = new Set([...pkg.roots, ...pkg.items].map(itemKey))
  const missing = refs.filter((ref) => !state.byKey.has(itemKey(ref)) && !listed.has(itemKey(ref)))
  if (missing.length) throw ServiceError.notFound(`Not in the package: ${missing.map((ref) => `${labelOf(ref.type)} ${ref.id}`).join(', ')}`)
  const removing = refs.map((ref) => state.byKey.get(itemKey(ref)) ?? refOf(ref.type, ref.id, ''))
    .map(({ type, id, name, label }) => ({ type, id, name, label }))
  const refsByKey = new Map<string, PackageItemRef>([...state.byKey].map(([key, item]) => [key, { type: item.type, id: item.id, name: item.name, label: item.label }]))
  const dependents = dependentsOf(state.graph, refs, refsByKey)
  const warnings = describeDependents(dependents)

  // Removed items that the rest of the package still pulls in are left out explicitly.
  const candidate = removeFromLists(pkg, refs, new Set())
  if (!candidate.roots.length) throw ServiceError.validation('A package needs at least one item: delete the package instead')
  const after = await closureOf(ctx, db, candidate as typeof pkg)
  const removingKeys = new Set(refs.map(itemKey))
  const stillPulled = new Set(after.items.map(itemKey).filter((key) => removingKeys.has(key)))
  const leftOut = removing.filter((ref) => stillPulled.has(itemKey(ref)))
  const result: RemovePackageItemsResult = { dry_run: Boolean(input.dry_run), removing, dependents, warnings, left_out: leftOut }
  if (input.dry_run) return result
  if (dependents.length && !input.force) {
    throw new ServiceError('conflict', `${warnings.join('; ')}. Remove anyway with force (the package then needs ${dependents.length === 1 ? 'it' : 'them'} to exist where it is installed)`, { details: { dependents } })
  }
  const lists = removeFromLists(pkg, refs, stillPulled) as { roots: PackageItemInput[]; items: PackageItemInput[]; excluded: PackageItemInput[] }
  const saved = await saveLists(ctx, db, pkg, lists,
    `Removed ${removing.length === 1 ? `${removing[0].label.toLowerCase()} "${removing[0].name}"` : `${removing.length} items`} from package "${pkg.name}"${dependents.length ? ' (still used by other items: removed anyway)' : ''}`,
    { removed: refs.map(itemKey), forced: dependents.length > 0, left_out: leftOut.map(itemKey) })
  return { ...result, package: saved }
}
