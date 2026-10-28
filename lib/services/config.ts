/**
 * Config-as-code: export the workspace configuration as GitHub-sync style
 * files and apply such files back (create / update, never delete). Shared by
 * /api/v1/config/export and /api/v1/config/apply (and the `usertasks config`
 * commands on top of them).
 *
 * Export: every section is gated by its own view permission; sections the
 * caller can't view are listed in `skipped` instead of failing the request.
 * Caller-supplied ids are intersected with the tenant before the export runs,
 * and secrets are always scrubbed to '__SECRET__'.
 *
 * Apply: identity is resolved in this order — (1) the incoming id already
 * exists in this tenant (re-applying an export of the same workspace),
 * (2) a github_sync_asset_map row (an earlier apply or GitHub deploy recorded
 * source → local), (3) opt-in adopt_by_name for unique name matches, else
 * (4) create and record the mapping. Applying the same folder twice therefore
 * updates instead of duplicating, and dev → prod promotion matches on the
 * source id. `dry_run` returns the plan only.
 */

import { randomUUID } from 'node:crypto'
import { filesToManifest, manifestToFiles, SECTION_TO_DIR, type RepoFile } from '@/lib/github-sync/layout'
import { GITHUB_CONNECTOR_KEY } from '@/lib/github-sync/connection'
import type { SyncAssetType } from '@/lib/github-sync/enqueue'
import { buildManifestExport } from '@/lib/portability/export'
import { DEPENDENCY_TYPES, resolveDependencyClosure, type AssetRef } from '@/lib/portability/dependencies'
import { exportTableRows, writeTableRows, type PortableRow, type RowMode } from '@/lib/portability/table-rows'
import { createEmptyAssetIdMaps, type AssetIdMaps } from '@/lib/portability/id-maps'
import { importTenantManifest } from '@/lib/portability/import'
import {
  isUuid,
  planKey,
  planManifest,
  PLAN_SECTIONS,
  type AssetPlan,
  type ConfigPlan,
  type MatchKind,
  type PlanAssetType,
} from '@/lib/portability/plan'
import { resolveSecretPlaceholders, scrubSecretsForExport } from '@/lib/portability/scrub'
import { decryptSecret } from '@/lib/secret-crypto'
import { LOG_DESTINATION_TYPES } from '@/lib/api-schemas/log-destinations'
import { connectorGeneratedIdMap, connectorMissingCredentials } from './connectors'
import { decryptCredentials, missingCredentials as logDestinationMissingCredentials, unresolvedSecrets } from './log-destinations'
import { readWorkspaceTheme, resolveManifestWorkspaceTheme, updateWorkspaceTheme, workspaceThemeToManifest } from './workspace-theme'
import { diffValues } from '@/lib/portability/plan'
import type { WorkspaceTheme } from '@/lib/theme/schema'
import { hasPerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError, syncChange } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests and table rows are free-form JSON */

export const CONFIG_FORMAT_VERSION = 3
export const CONFIG_LIMITS = { maxBytes: 5 * 1024 * 1024, maxAssets: 2000 } as const

interface SectionDef {
  section: string
  type: PlanAssetType
  table: string
  view: string
  create: string
  edit: string
  /** Exported/selected on its own (references and objects ride along with integrations). */
  topLevel: boolean
  /** Column matched by adopt_by_name (default `name`). */
  nameColumn?: string
}

/** Permission keys per manifest section (matching the per-resource REST endpoints). */
export const CONFIG_SECTIONS: readonly SectionDef[] = [
  { section: 'workflows', type: 'workflow', table: 'workflows', view: 'workflows.view', create: 'workflows.create', edit: 'workflows.edit', topLevel: true },
  { section: 'decision_tables', type: 'decision_table', table: 'decision_tables', view: 'workflows.view', create: 'workflows.edit', edit: 'workflows.edit', topLevel: true },
  { section: 'workflow_activities', type: 'workflow_activity', table: 'custom_workflow_activities', view: 'extensibility.view', create: 'extensibility.create', edit: 'extensibility.edit', topLevel: true },
  { section: 'data_tables', type: 'data_table', table: 'custom_tables', view: 'data.view', create: 'data.create', edit: 'data.edit_schema', topLevel: true },
  { section: 'integrations', type: 'integration', table: 'integrations', view: 'integrations.view', create: 'integrations.create', edit: 'integrations.edit', topLevel: true },
  { section: 'references', type: 'reference', table: 'integration_references', view: 'integrations.view', create: 'integrations.manage_references', edit: 'integrations.manage_references', topLevel: false },
  { section: 'objects', type: 'object', table: 'integration_objects', view: 'integrations.view', create: 'integrations.edit', edit: 'integrations.edit', topLevel: false },
  { section: 'agents', type: 'agent', table: 'agents', view: 'agents.view', create: 'agents.create', edit: 'agents.edit', topLevel: true },
  { section: 'reports', type: 'report', table: 'reports', view: 'reports.view', create: 'reports.create', edit: 'reports.edit_own', topLevel: true },
  { section: 'retention_policies', type: 'retention_policy', table: 'retention_policies', view: 'settings.view', create: 'settings.edit', edit: 'settings.edit', topLevel: true },
  { section: 'roles', type: 'role', table: 'roles', view: 'team.view_members', create: 'team.change_roles', edit: 'team.change_roles', topLevel: true },
  { section: 'mcp_servers', type: 'mcp_server', table: 'mcp_servers', view: 'settings.view', create: 'settings.edit', edit: 'settings.edit', topLevel: true },
  { section: 'email_templates', type: 'email_template', table: 'email_templates', view: 'workflows.view', create: 'workflows.create', edit: 'workflows.edit', topLevel: true },
  { section: 'connectors', type: 'connector', table: 'tenant_connectors', view: 'integrations.view', create: 'integrations.create', edit: 'integrations.edit', topLevel: true, nameColumn: 'display_name' },
  { section: 'log_destinations', type: 'log_destination', table: 'log_destinations', view: 'observability.view', create: 'settings.edit', edit: 'settings.edit', topLevel: true },
  { section: 'form_themes', type: 'form_theme', table: 'form_themes', view: 'forms.view', create: 'forms.edit', edit: 'forms.edit', topLevel: true },
  { section: 'forms', type: 'form', table: 'forms', view: 'forms.view', create: 'forms.edit', edit: 'forms.edit', topLevel: true },
]

const SECTION_BY_NAME = new Map<string, SectionDef>(
  CONFIG_SECTIONS.flatMap((def) => {
    const dir = SECTION_TO_DIR.find((s) => s.section === def.section)?.dir ?? def.section
    return [[def.section, def], [dir, def]] as Array<[string, SectionDef]>
  }),
)

/**
 * The workspace theme: a singleton section (one object, `workspace-theme.json`
 * at the folder root). Any member may export it; applying a change needs
 * settings.edit. Never created or deleted — an apply replaces it.
 */
export const THEME_SECTION = 'workspace_theme'
const THEME_EDIT = 'settings.edit'
const isThemeType = (name: string) => ['workspace_theme', 'workspace-theme'].includes(name.trim())

/** Sections a caller may name in `types` (references/objects travel with integrations). */
export const CONFIG_EXPORT_TYPES = [...CONFIG_SECTIONS.filter((def) => def.topLevel).map((def) => def.section), THEME_SECTION]

const SYNC_TYPE: Partial<Record<PlanAssetType, SyncAssetType>> = {
  workflow: 'workflow', decision_table: 'decision_table', workflow_activity: 'workflow_activity', data_table: 'data_table',
  integration: 'integration', reference: 'reference', object: 'object', agent: 'agent', report: 'report',
  retention_policy: 'retention_policy', role: 'role', mcp_server: 'mcp_server',
  email_template: 'email_template', connector: 'connector', log_destination: 'log_destination',
  form: 'form', form_theme: 'form_theme',
}

const IN_CHUNK = 200

/** Opt-in section with data-table rows: [{ id: table id, name, rows: [{ id, data }] }]. */
export const TABLE_ROWS_SECTION = 'table_rows'

const DEPENDENCY_TABLES: Array<{ type: AssetRef['type']; table: string }> = [
  { type: 'workflow', table: 'workflows' }, { type: 'workflow_activity', table: 'custom_workflow_activities' },
  { type: 'data_table', table: 'custom_tables' }, { type: 'integration', table: 'integrations' },
  { type: 'connector', table: 'tenant_connectors' }, { type: 'decision_table', table: 'decision_tables' },
  { type: 'email_template', table: 'email_templates' }, { type: 'agent', table: 'agents' },
  { type: 'report', table: 'reports' }, { type: 'role', table: 'roles' }, { type: 'mcp_server', table: 'mcp_servers' },
  { type: 'retention_policy', table: 'retention_policies' }, { type: 'log_destination', table: 'log_destinations' },
  { type: 'form', table: 'forms' }, { type: 'form_theme', table: 'form_themes' },
]

/** Asset refs (type + id) for tenant ids of any exportable type. */
export async function typedAssetRefs(ctx: ServiceContext, ids: string[]): Promise<AssetRef[]> {
  const refs: AssetRef[] = []
  const remaining = new Set(ids)
  for (const { type, table } of DEPENDENCY_TABLES) {
    if (!remaining.size) break
    if (!DEPENDENCY_TYPES.includes(type)) continue
    const rows = await selectIn(ctx, table, 'id', 'id', [...remaining]).catch(() => [])
    for (const row of rows) { refs.push({ type, id: String(row.id) }); remaining.delete(String(row.id)) }
  }
  return refs
}

async function expandWithDependencies(ctx: ServiceContext, ids: string[]): Promise<string[]> {
  const roots = await typedAssetRefs(ctx, ids)
  const closure = await resolveDependencyClosure(ctx.supabase, ctx.tenantId, roots)
  return [...new Set([...ids, ...closure.items.map((item) => item.id)])]
}

/** `select … where tenant_id = ctx.tenant and <column> in (values)`, chunked to keep URLs short. */
async function selectIn(ctx: ServiceContext, table: string, columns: string, column: string, values: string[]): Promise<any[]> {
  const unique = [...new Set(values)]
  const rows: any[] = []
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const { data, error } = await (ctx.supabase as any).from(table).select(columns)
      .eq('tenant_id', ctx.tenantId)
      .in(column, unique.slice(i, i + IN_CHUNK))
    if (error) throw dbError(error)
    rows.push(...(data ?? []))
  }
  return rows
}

function resolveSection(name: string): SectionDef {
  const def = SECTION_BY_NAME.get(name.trim())
  if (!def || !def.topLevel) {
    throw ServiceError.validation(`Unknown config type "${name}" (expected ${CONFIG_EXPORT_TYPES.join(', ')}; references and objects are exported with their integrations)`)
  }
  return def
}

// ─── Export ─────────────────────────────────────────────────────────────────

export interface ConfigExportInput {
  /** Section keys (or repo dir names); default every section. */
  types?: string[]
  /** Only these asset ids (any section; integrations bring their references). */
  ids?: string[]
  format?: 'files' | 'manifest'
  /**
   * Also export the rows of every exported data table (needs data.view), as
   * the `table_rows` section (one entry per table: { id: table id, name, rows }).
   */
  include_rows?: boolean
  /**
   * Expand `ids` with everything they depend on (sub-workflows, activities,
   * decision tables, data tables, integrations/connectors, email templates,
   * agents, custom roles, …) — lib/portability/dependencies.
   */
  with_dependencies?: boolean
}

export interface SkippedSection {
  section: string
  permission: string
  reason: string
}

export interface ConfigExportResult {
  format_version: number
  files?: RepoFile[]
  manifest?: Record<string, any>
  skipped: SkippedSection[]
}

export async function exportConfig(ctx: ServiceContext, input: ConfigExportInput = {}): Promise<ConfigExportResult> {
  const typeList = input.types?.length ? input.types : null
  const requested = typeList ? [...new Set(typeList.filter((t) => !isThemeType(t)).map((t) => resolveSection(t)))] : CONFIG_SECTIONS.filter((d) => d.topLevel)
  let idFilter = input.ids?.length ? input.ids.filter(isUuid) : null
  if (idFilter?.length && input.with_dependencies) idFilter = await expandWithDependencies(ctx, idFilter)
  // An id filter selects assets; the theme comes along only when named.
  const wantTheme = typeList ? typeList.some(isThemeType) : !idFilter

  const skipped: SkippedSection[] = []
  const idsByType: Partial<Record<string, string[]>> = {}
  for (const def of requested) {
    if (!hasPerm(ctx, def.view)) {
      skipped.push({ section: def.section, permission: def.view, reason: `missing permission '${def.view}'` })
      continue
    }
    // Tenant intersection happens HERE, before buildManifestExport sees an id
    // (which also pins every query to the tenant).
    const columns = def.section === 'roles' ? 'id, is_system' : 'id'
    let rows: any[]
    if (idFilter) {
      rows = idFilter.length ? await selectIn(ctx, def.table, columns, 'id', idFilter) : []
    } else {
      const { data, error } = await (ctx.supabase as any).from(def.table).select(columns).eq('tenant_id', ctx.tenantId)
      if (error) throw dbError(error)
      rows = data ?? []
    }
    let ids = rows.filter((row) => !(def.section === 'roles' && row.is_system)).map((row) => String(row.id))
    // Resource-scoped API keys only ever see their allowlisted workflows / tables.
    const allow = def.section === 'workflows' ? ctx.resourceScopes?.workflow_ids
      : def.section === 'data_tables' ? ctx.resourceScopes?.table_ids
      : undefined
    if (allow?.length) ids = ids.filter((id) => allow.includes(id))
    if (ids.length) idsByType[def.type] = ids
  }

  const payload = Object.keys(idsByType).length > 0 ? await buildManifestExport(ctx.supabase, ctx.tenantId, idsByType) : {}
  const manifest: Record<string, any> = { format_version: CONFIG_FORMAT_VERSION, ...scrubSecretsForExport(payload) }
  if (input.include_rows && Array.isArray(manifest.data_tables) && manifest.data_tables.length) {
    if (!hasPerm(ctx, 'data.view')) {
      skipped.push({ section: TABLE_ROWS_SECTION, permission: 'data.view', reason: "missing permission 'data.view'" })
    } else {
      manifest[TABLE_ROWS_SECTION] = []
      for (const table of manifest.data_tables) {
        const rows = await exportTableRows(ctx.supabase, ctx.tenantId, String(table.id))
        manifest[TABLE_ROWS_SECTION].push({ id: String(table.id), name: `${table.name} rows`, rows })
      }
    }
  }
  if (wantTheme) {
    manifest[THEME_SECTION] = workspaceThemeToManifest((await readWorkspaceTheme(ctx.supabase, ctx.tenantId)).theme, ctx.tenantId)
  }

  const total = PLAN_SECTIONS.reduce((sum, { section }) => sum + (Array.isArray(manifest[section]) ? manifest[section].length : 0), 0) + (wantTheme ? 1 : 0)
  await audit(ctx, {
    objectType: 'config', objectId: randomUUID(), action: 'export',
    summary: `Exported ${total} configuration asset${total === 1 ? '' : 's'}`,
    metadata: { types: [...requested.map((d) => d.section), ...(wantTheme ? [THEME_SECTION] : [])], ids: idFilter?.length ?? null, skipped: skipped.map((s) => s.section) },
  })

  if (input.format === 'manifest') return { format_version: CONFIG_FORMAT_VERSION, manifest, skipped }
  return { format_version: CONFIG_FORMAT_VERSION, files: manifestToFiles(manifest), skipped }
}

// ─── Apply ──────────────────────────────────────────────────────────────────

export interface ConfigApplyInput {
  files?: RepoFile[]
  manifest?: Record<string, any>
  dry_run?: boolean
  adopt_by_name?: boolean
  /** Recorded on github_sync_asset_map rows as `cli:<label>` (default "default"). */
  source_label?: string
  /** How `table_rows` are written: merge (default), replace or skip. */
  rows_mode?: RowMode
  /**
   * Packages: source → local ids resolved before anything else (an earlier
   * install of the same package), reported as matched_by 'package'.
   */
  identity_seed?: Partial<Record<keyof AssetIdMaps, Record<string, string>>>
  /** false = don't record source → local mappings in github_sync_asset_map (packages keep their own). */
  record_mappings?: boolean
}

export interface ConfigApplyResult {
  dry_run: boolean
  plan: ConfigPlan
  /** Permissions a real apply would additionally need (dry runs only report them). */
  missing_permissions?: Array<{ section: string; permission: string }>
  warnings: Array<{ asset_type?: string; source_id?: string; file?: string; warning: string }>
  result?: {
    created: Record<string, number>
    updated: Record<string, number>
    errors: Array<{ asset_type: string; source_id: string; error: string }>
    warnings: Array<{ asset_type: string; source_id: string; warning: string }>
    rows?: Array<{ table_id: string; local_table_id: string | null; inserted: number; updated: number; deleted: number; error?: string }>
  }
  /** Real applies: source → local id of every asset in the manifest (after creates). */
  id_map?: AssetIdMaps
}

interface ParsedInput {
  manifest: Record<string, any>
  fileErrors: Array<{ path: string; error: string }>
  /** Source file per asset, parallel to manifest[section]. */
  paths: Record<string, string[]>
}

function parseApplyInput(input: ConfigApplyInput): ParsedInput {
  if (Boolean(input.files) === Boolean(input.manifest)) throw ServiceError.validation('Provide exactly one of files or manifest')

  const bytes = input.files
    ? input.files.reduce((sum, f) => sum + Buffer.byteLength(f.path) + Buffer.byteLength(f.content), 0)
    : Buffer.byteLength(JSON.stringify(input.manifest))
  if (bytes > CONFIG_LIMITS.maxBytes) {
    throw new ServiceError('validation_error', `Configuration is too large (${(bytes / 1024 / 1024).toFixed(1)} MB; limit ${CONFIG_LIMITS.maxBytes / 1024 / 1024} MB)`, { status: 413 })
  }

  let manifest: Record<string, any>
  let fileErrors: ParsedInput['fileErrors'] = []
  let paths: ParsedInput['paths'] = {}
  if (input.files) {
    const parsed = filesToManifest(input.files)
    manifest = parsed.manifest
    fileErrors = parsed.errors
    paths = parsed.paths
  } else {
    manifest = structuredClone(input.manifest!)
  }

  const count = PLAN_SECTIONS.reduce((sum, { section }) => sum + (Array.isArray(manifest[section]) ? manifest[section].length : 0), 0)
  if (count > CONFIG_LIMITS.maxAssets) {
    throw new ServiceError('validation_error', `Too many assets (${count}; limit ${CONFIG_LIMITS.maxAssets}) — apply the configuration in smaller parts`, { status: 413 })
  }
  return { manifest, fileErrors, paths }
}

function sourceIdOf(section: string, asset: any): string | null {
  const id = section === 'objects' ? asset?.generated_reference_id : asset?.id
  return isUuid(id) ? id : null
}

const roleSlug = (role: any) => role?.slug ?? String(role?.name ?? 'role').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

interface Identity {
  seed: AssetIdMaps
  matches: Record<string, MatchKind>
  /** Matches import won't report through onAssetWritten (name/slug), to record as mappings. */
  toRecord: Array<{ asset_type: string; source_id: string; local_id: string }>
  warnings: ConfigApplyResult['warnings']
}

async function resolveIdentity(ctx: ServiceContext, manifest: Record<string, any>, adoptByName: boolean, preSeed?: ConfigApplyInput['identity_seed']): Promise<Identity> {
  const seed = createEmptyAssetIdMaps()
  const matches: Record<string, MatchKind> = {}
  // (0) Pre-resolved (package installs): only mappings whose local row still exists.
  if (preSeed) {
    for (const def of CONFIG_SECTIONS.filter((d) => Array.isArray(manifest[d.section]))) {
      const mapName = (def.type === 'object' ? 'reference' : def.type) as keyof AssetIdMaps
      const pairs = (manifest[def.section] as any[])
        .map((asset) => sourceIdOf(def.section, asset))
        .filter((id): id is string => Boolean(id && preSeed[mapName]?.[id]))
        .map((id) => [id, preSeed[mapName]![id]] as const)
      if (!pairs.length) continue
      const table = def.type === 'object' ? 'integration_references' : def.table
      const live = new Set((await selectIn(ctx, table, 'id', 'id', pairs.map(([, local]) => local))).map((row) => String(row.id)))
      for (const [source, local] of pairs) {
        if (!live.has(local)) continue
        seed[mapName][source] = local
        matches[planKey(def.section, source)] = 'package'
      }
    }
  }
  const toRecord: Identity['toRecord'] = []
  const warnings: Identity['warnings'] = []
  const defs = CONFIG_SECTIONS.filter((def) => Array.isArray(manifest[def.section]) && manifest[def.section].length > 0)
  const mapKey = (def: SectionDef) => (def.type === 'object' ? 'reference' : def.type) as keyof AssetIdMaps
  const unresolved = (def: SectionDef) => (manifest[def.section] as any[])
    .map((asset) => ({ asset, id: sourceIdOf(def.section, asset) }))
    .filter((entry): entry is { asset: any; id: string } => entry.id !== null && !seed[mapKey(def)][entry.id])

  // (1) Self ids: the asset already exists in THIS tenant under the same id.
  for (const def of defs) {
    const table = def.type === 'object' ? 'integration_references' : def.table
    const ids = unresolved(def).map((entry) => entry.id)
    if (!ids.length) continue
    for (const row of await selectIn(ctx, table, 'id', 'id', ids)) {
      seed[mapKey(def)][String(row.id)] = String(row.id)
      matches[planKey(def.section, String(row.id))] = 'id'
    }
  }

  // (2) Recorded source → local mappings. The table's key is
  // (tenant_id, asset_type, source_id) — source_repo is informational — so
  // every mapping for the tenant counts, whichever apply or deploy wrote it.
  const pending = defs.flatMap((def) => unresolved(def).map((entry) => entry.id))
  if (pending.length) {
    for (const row of await selectIn(ctx, 'github_sync_asset_map', 'asset_type, source_id, local_id', 'source_id', pending)) {
      const key = row.asset_type as keyof AssetIdMaps
      if (seed[key] && !seed[key][String(row.source_id)]) seed[key][String(row.source_id)] = String(row.local_id)
    }
    for (const def of defs) {
      for (const asset of manifest[def.section] as any[]) {
        const id = sourceIdOf(def.section, asset)
        if (id && seed[mapKey(def)][id] && !matches[planKey(def.section, id)]) matches[planKey(def.section, id)] = 'mapping'
      }
    }
  }

  // Implicit matches the import itself makes in upsert mode (roles by slug,
  // MCP servers by name) — mirrored so the plan says "update", not "create".
  const takenLocal = (key: keyof AssetIdMaps) => new Set(Object.values(seed[key]))
  const adopt = (def: SectionDef, sourceId: string, localId: string, kind: MatchKind) => {
    seed[mapKey(def)][sourceId] = localId
    matches[planKey(def.section, sourceId)] = kind
    toRecord.push({ asset_type: mapKey(def), source_id: sourceId, local_id: localId })
  }
  for (const def of defs.filter((d) => d.section === 'roles' || d.section === 'mcp_servers')) {
    const entries = unresolved(def)
    if (!entries.length) continue
    const column = def.section === 'roles' ? 'slug' : 'name'
    const values = entries.map(({ asset }) => (def.section === 'roles' ? roleSlug(asset) : String(asset.name ?? '')))
    const rows = await selectIn(ctx, def.table, `id, ${column}${def.section === 'roles' ? ', is_system' : ''}`, column, values.filter(Boolean))
    const taken = takenLocal(mapKey(def))
    entries.forEach(({ id }, index) => {
      const row = rows.find((r) => r[column] === values[index] && !r.is_system && !taken.has(String(r.id)))
      if (row) { adopt(def, id, String(row.id), def.section === 'roles' ? 'slug' : 'name'); taken.add(String(row.id)) }
    })
  }

  // Email templates match a unique same-name template (as the import does):
  // every tenant is seeded with its own "UserTasks Default".
  for (const def of defs.filter((d) => d.section === 'email_templates')) {
    const entries = unresolved(def)
    if (!entries.length) continue
    const rows = await selectIn(ctx, def.table, 'id, name', 'name', entries.map(({ asset }) => String(asset.name ?? '').trim()).filter(Boolean))
    const taken = takenLocal(mapKey(def))
    for (const { asset, id } of entries) {
      const sameName = rows.filter((r) => r.name === String(asset.name ?? '').trim())
      if (sameName.length === 1 && !taken.has(String(sameName[0].id))) {
        adopt(def, id, String(sameName[0].id), 'name')
        taken.add(String(sameName[0].id))
      }
    }
  }

  // (3) Opt-in: adopt a local asset with the same (unique) name.
  if (adoptByName) {
    for (const def of defs.filter((d) => d.type !== 'object' && d.section !== 'roles' && d.section !== 'mcp_servers' && d.section !== 'email_templates')) {
      const entries = unresolved(def)
      if (!entries.length) continue
      const names = entries.map(({ asset }) => String(asset.name ?? '')).filter(Boolean)
      const nameColumn = def.nameColumn ?? 'name'
      const columns = def.section === 'references' ? 'id, name, integration_id' : `id, ${nameColumn}`
      const fetched = await selectIn(ctx, def.table, columns, nameColumn, names)
      const rows = nameColumn === 'name' ? fetched : fetched.map((row) => ({ ...row, name: row[nameColumn] }))
      const taken = takenLocal(mapKey(def))
      const incomingCount = new Map<string, number>()
      for (const { asset } of entries) {
        const scope = def.section === 'references' ? `${seed.integration[asset.integration_id] ?? '?'}|${asset.name}` : String(asset.name)
        incomingCount.set(scope, (incomingCount.get(scope) ?? 0) + 1)
      }
      for (const { asset, id } of entries) {
        const localIntegration = def.section === 'references' ? seed.integration[asset.integration_id] : undefined
        if (def.section === 'references' && !localIntegration) continue
        const scope = def.section === 'references' ? `${localIntegration}|${asset.name}` : String(asset.name)
        const candidates = rows.filter((row) => row.name === asset.name
          && (def.section !== 'references' || row.integration_id === localIntegration)
          && !taken.has(String(row.id)))
        if (candidates.length === 1 && incomingCount.get(scope) === 1) {
          adopt(def, id, String(candidates[0].id), 'name')
          taken.add(String(candidates[0].id))
        } else if (candidates.length > 1 || (candidates.length === 1 && (incomingCount.get(scope) ?? 0) > 1)) {
          warnings.push({ asset_type: def.type, source_id: id, warning: `Not adopted by name: "${asset.name}" is ambiguous (${candidates.length} local, ${incomingCount.get(scope)} incoming)` })
        }
      }
    }
  }

  // Matched connectors: their generated integration/references map onto the
  // local connector's, so workflows and agents using them remap (and diff clean).
  for (const asset of Array.isArray(manifest.connectors) ? manifest.connectors : []) {
    const localId = isUuid(asset?.id) ? seed.connector[asset.id] : undefined
    if (!localId) continue
    const generated = await connectorGeneratedIdMap(ctx, asset, localId)
    for (const [sourceId, local] of Object.entries(generated.integration)) seed.integration[sourceId] ??= local
    for (const [sourceId, local] of Object.entries(generated.reference)) seed.reference[sourceId] ??= local
  }

  return { seed, matches, toRecord, warnings }
}

/**
 * A connector that has no credentials here (created disabled by an earlier
 * apply) stays disabled until credentials are supplied, so an `is_enabled`
 * difference alone is not a pending change — only a "needs credentials"
 * warning. Mirrors applyConnectorManifest.
 */
function settleConnectorPlans(plan: ConfigPlan, manifest: Record<string, any>, raw: Record<string, any>, warnings: ConfigApplyResult['warnings']) {
  const incoming = new Map<string, any>((Array.isArray(manifest.connectors) ? manifest.connectors : []).map((asset: any) => [String(asset?.id), asset]))
  const local = new Map<string, any>((Array.isArray(raw.connectors) ? raw.connectors : []).map((row: any) => [String(row.id), row]))
  for (const asset of plan.assets) {
    if (asset.section !== 'connectors' || !asset.source_id) continue
    const source = incoming.get(asset.source_id)
    if (!source) continue
    const row = asset.local_id ? local.get(asset.local_id) : undefined
    const credentials = resolveSecretPlaceholders(source.credentials ?? {}, row?.credentials ?? {})
    const missing = connectorMissingCredentials(String(source.connector_key ?? ''), { ...(row?.credentials ?? {}), ...credentials })
    if (!missing.length) continue
    warnings.push({
      asset_type: 'connector', source_id: asset.source_id,
      warning: `Connector "${asset.name}" needs credentials (${missing.join(', ')}); it ${asset.action === 'create' ? 'will be created' : 'stays'} disabled`,
    })
    if (asset.action !== 'update' || !row || row.is_enabled) continue
    asset.diffs = (asset.diffs ?? []).filter((d) => d.path !== 'is_enabled')
    if (asset.diffs.length === 0) {
      delete asset.diffs
      asset.action = 'unchanged'
      plan.summary.update--
      plan.summary.unchanged++
    }
  }
}

/**
 * Log destinations without their token / API key / signing secret here stay
 * disabled (applyLogDestinationManifest), so an `enabled` difference alone is
 * not a pending change — only a "needs credentials" warning.
 */
function settleLogDestinationPlans(plan: ConfigPlan, manifest: Record<string, any>, raw: Record<string, any>, warnings: ConfigApplyResult['warnings']) {
  const incoming = new Map<string, any>((Array.isArray(manifest.log_destinations) ? manifest.log_destinations : []).map((asset: any) => [String(asset?.id), asset]))
  const local = new Map<string, any>((Array.isArray(raw.log_destinations) ? raw.log_destinations : []).map((row: any) => [String(row.id), row]))
  for (const asset of plan.assets) {
    if (asset.section !== 'log_destinations' || !asset.source_id) continue
    const source = incoming.get(asset.source_id)
    if (!source) continue
    const row = asset.local_id ? local.get(asset.local_id) : undefined
    let stored: Record<string, unknown> = {}
    try { stored = row ? decryptCredentials(row.credentials) : {} } catch { stored = {} }
    const credentials = { ...stored, ...resolveSecretPlaceholders(source.credentials ?? {}, stored) }
    const type = String(source.type ?? '')
    if (!(LOG_DESTINATION_TYPES as readonly string[]).includes(type)) continue
    const missing = [...new Set([...logDestinationMissingCredentials(type as 'splunk_hec', credentials), ...unresolvedSecrets(source.credentials, credentials)])]
    if (!missing.length) continue
    warnings.push({
      asset_type: 'log_destination', source_id: asset.source_id,
      warning: `Log destination "${asset.name}" needs credentials (${missing.join(', ')}); it ${asset.action === 'create' ? 'will be created' : 'stays'} disabled`,
    })
    if (asset.action !== 'update' || !row || row.enabled) continue
    asset.diffs = (asset.diffs ?? []).filter((d) => d.path !== 'enabled')
    if (asset.diffs.length === 0) {
      delete asset.diffs
      asset.action = 'unchanged'
      plan.summary.update--
      plan.summary.unchanged++
    }
  }
}

/** The tenant's current (scrubbed) export of every local row the seed points at. */
async function loadCurrent(ctx: ServiceContext, seed: AssetIdMaps): Promise<{ current: Record<string, any>; raw: Record<string, any> }> {
  const idsByType: Partial<Record<string, string[]>> = {}
  for (const def of CONFIG_SECTIONS.filter((d) => d.topLevel)) {
    const ids = [...new Set(Object.values(seed[def.type as keyof AssetIdMaps] ?? {}))]
    if (ids.length) idsByType[def.type] = ids
  }
  // References (incl. objects' generated references) export through their integration.
  const integrationIds = new Set(idsByType.integration ?? [])
  const referenceIds = Object.values(seed.reference)
  if (referenceIds.length) {
    for (const row of await selectIn(ctx, 'integration_references', 'id, integration_id', 'id', referenceIds)) {
      integrationIds.add(String(row.integration_id))
    }
  }
  if (integrationIds.size) idsByType.integration = [...integrationIds]
  if (Object.keys(idsByType).length === 0) return { current: {}, raw: {} }
  const raw = await buildManifestExport(ctx.supabase, ctx.tenantId, idsByType, { keepCredentials: true })
  return { current: scrubSecretsForExport(raw), raw }
}

/** Decrypt a stored credential for comparison; undefined when it can't be read. */
function revealSecret(stored: string): string | undefined {
  try {
    return decryptSecret(stored)
  } catch {
    return undefined
  }
}

/** Only the assets that will change, plus integrations whose references change. */
function changedManifest(manifest: Record<string, any>, plan: ConfigPlan): Record<string, any> {
  const changing = new Set(plan.assets
    .filter((a) => (a.action === 'create' || a.action === 'update') && a.source_id)
    .map((a) => planKey(a.section, a.source_id!)))
  const out: Record<string, any> = { format_version: manifest.format_version ?? CONFIG_FORMAT_VERSION }
  const references = (manifest.references ?? []).filter((r: any) => changing.has(planKey('references', String(r?.id))))
  const neededIntegrations = new Set(references.map((r: any) => String(r.integration_id)))
  for (const { section } of PLAN_SECTIONS) {
    if (!Array.isArray(manifest[section])) continue
    const kept = section === 'references' ? references : manifest[section].filter((asset: any) => {
      const id = section === 'objects' ? asset?.generated_reference_id : asset?.id
      return changing.has(planKey(section, String(id))) || (section === 'integrations' && neededIntegrations.has(String(id)))
    })
    if (kept.length) out[section] = kept
  }
  return out
}

function missingPermissions(ctx: ServiceContext, plan: ConfigPlan, kind: 'create' | 'update') {
  const missing: Array<{ section: string; permission: string }> = []
  for (const def of CONFIG_SECTIONS) {
    if (!plan.assets.some((a) => a.section === def.section && a.action === kind)) continue
    const permission = kind === 'create' ? def.create : def.edit
    if (!hasPerm(ctx, permission) && !missing.some((m) => m.permission === permission && m.section === def.section)) {
      missing.push({ section: def.section, permission })
    }
  }
  return missing
}

function forbidden(missing: Array<{ section: string; permission: string }>) {
  const list = [...new Set(missing.map((m) => m.permission))].map((p) => `'${p}'`).join(', ')
  return new ServiceError('forbidden', `Forbidden: missing permission${missing.length === 1 ? '' : 's'} ${list}`, { details: { missing } })
}

const MAX_THEME_DIFFS = 50

/**
 * Plan for the `workspace_theme` section: update or unchanged against the
 * stored theme (compared in manifest form, after uploads and logos were
 * resolved for this workspace), or error when the theme is invalid.
 */
async function planWorkspaceThemeSection(ctx: ServiceContext, value: unknown, file: string | undefined): Promise<{ asset: AssetPlan; theme?: WorkspaceTheme; warnings: string[] }> {
  const base = { section: THEME_SECTION, asset_type: 'workspace_theme' as const, source_id: null, local_id: ctx.tenantId, ...(file ? { file } : {}) }
  const name = String((value as any)?.meta?.name ?? 'Workspace theme')
  const resolved = await resolveManifestWorkspaceTheme(ctx, value)
  if (!resolved.theme) return { asset: { ...base, name, action: 'error', error: resolved.error }, warnings: resolved.warnings }
  const current = await readWorkspaceTheme(ctx.supabase, ctx.tenantId)
  const diffs = diffValues(workspaceThemeToManifest(current.theme, ctx.tenantId), workspaceThemeToManifest(resolved.theme, ctx.tenantId))
  const asset: AssetPlan = { ...base, name: resolved.theme.meta.name, action: diffs.length ? 'update' : 'unchanged', matched_by: 'id' }
  if (diffs.length) {
    asset.diffs = diffs.slice(0, MAX_THEME_DIFFS)
    if (diffs.length > MAX_THEME_DIFFS) asset.diffs_truncated = true
  }
  return { asset, theme: resolved.theme, warnings: resolved.warnings }
}

export async function applyConfig(ctx: ServiceContext, input: ConfigApplyInput): Promise<ConfigApplyResult> {
  const label = (input.source_label ?? 'default').trim() || 'default'
  if (ctx.resourceScopes?.workflow_ids?.length || ctx.resourceScopes?.table_ids?.length) {
    throw ServiceError.forbidden('Forbidden: config apply is not available to API keys restricted to specific workflows or tables')
  }
  const { manifest, fileErrors, paths } = parseApplyInput(input)

  // Up front: reading the current state for the plan needs view permission
  // on every section the files touch.
  const present = CONFIG_SECTIONS.filter((def) => Array.isArray(manifest[def.section]) && manifest[def.section].length > 0)
  const missingView = present.filter((def) => !hasPerm(ctx, def.view)).map((def) => ({ section: def.section, permission: def.view }))
  if (missingView.length) throw forbidden(missingView)

  // At most one default email template: the first one flagged wins (the
  // import applies the same rule), so plans don't report perpetual drift.
  const defaultWarnings: ConfigApplyResult['warnings'] = []
  let defaultSeen = false
  for (const template of Array.isArray(manifest.email_templates) ? manifest.email_templates : []) {
    if (template?.is_default !== true) continue
    if (!defaultSeen) { defaultSeen = true; continue }
    template.is_default = false
    defaultWarnings.push({ asset_type: 'email_template', source_id: String(template.id ?? ''), warning: `"${template.name}" is not made the default: another template in the files already is` })
  }

  const identity = await resolveIdentity(ctx, manifest, Boolean(input.adopt_by_name), input.identity_seed)
  identity.warnings.unshift(...defaultWarnings)
  const { current, raw } = await loadCurrent(ctx, identity.seed)
  const plan = planManifest({
    incoming: manifest, current, idSeed: identity.seed, matches: identity.matches, paths,
    secrets: { current: raw, reveal: revealSecret },
  })
  settleConnectorPlans(plan, manifest, raw, identity.warnings)
  settleLogDestinationPlans(plan, manifest, raw, identity.warnings)
  const themePlan = manifest[THEME_SECTION] !== undefined
    ? await planWorkspaceThemeSection(ctx, manifest[THEME_SECTION], paths[THEME_SECTION]?.[0])
    : null
  if (themePlan) {
    plan.assets.push(themePlan.asset)
    plan.summary[themePlan.asset.action]++
    for (const warning of themePlan.warnings) identity.warnings.push({ asset_type: 'workspace_theme', warning })
  }
  for (const fileError of fileErrors) {
    plan.assets.unshift({ section: 'files', asset_type: 'workflow', source_id: null, local_id: null, name: fileError.path, action: 'error', error: fileError.error, file: fileError.path })
    plan.summary.error++
  }
  const missing = [...missingPermissions(ctx, plan, 'create'), ...missingPermissions(ctx, plan, 'update')]
  if (themePlan?.asset.action === 'update' && !hasPerm(ctx, THEME_EDIT)) missing.push({ section: THEME_SECTION, permission: THEME_EDIT })
  const rowsMode: RowMode = input.rows_mode ?? 'merge'
  const rowSets = tableRowSets(manifest)
  for (const set of rowSets) {
    const localTable = identity.seed.data_table[set.id] ?? null
    const asset: AssetPlan = {
      section: TABLE_ROWS_SECTION, asset_type: 'data_table', source_id: set.id, local_id: localTable,
      name: `${set.name} (${set.rows.length} row${set.rows.length === 1 ? '' : 's'}, ${rowsMode})`,
      action: rowsMode === 'skip' ? 'unchanged' : localTable ? 'update' : 'create',
      ...(paths[TABLE_ROWS_SECTION]?.[rowSets.indexOf(set)] ? { file: paths[TABLE_ROWS_SECTION][rowSets.indexOf(set)] } : {}),
    }
    plan.assets.push(asset)
    plan.summary[asset.action]++
  }
  if (rowSets.length && rowsMode !== 'skip' && !hasPerm(ctx, 'data.manage_rows')) missing.push({ section: TABLE_ROWS_SECTION, permission: 'data.manage_rows' })

  if (input.dry_run) {
    return { dry_run: true, plan, ...(missing.length ? { missing_permissions: missing } : {}), warnings: identity.warnings }
  }
  if (missing.length) throw forbidden(missing)

  const toApply = changedManifest(manifest, plan)
  const written: Identity['toRecord'] = []
  const hasChanges = PLAN_SECTIONS.some(({ section }) => Array.isArray(toApply[section]))
  const result: any = hasChanges
    ? await importTenantManifest({
        supabase: ctx.supabase,
        tenantId: ctx.tenantId,
        actingUserId: ctx.actorId,
        manifest: toApply,
        mode: 'upsert',
        // Email templates and connectors are written through their services.
        serviceContext: ctx,
        // importManifest mutates the seed in place, so afterwards it also
        // holds the local ids of everything it created.
        idMapSeed: identity.seed,
        onAssetWritten: (assetType, sourceId, localId) => { written.push({ asset_type: assetType, source_id: sourceId, local_id: localId }) },
      })
    : { counts: {}, updated: {}, errors: [] }

  // Record source → local for created and adopted assets (self ids need none).
  const mappings = [...identity.toRecord, ...written].filter((m) => isUuid(m.source_id) && m.source_id !== m.local_id)
  if (mappings.length && input.record_mappings !== false) {
    const now = new Date().toISOString()
    for (let i = 0; i < mappings.length; i += 500) {
      const { error } = await (ctx.supabase as any).from('github_sync_asset_map').upsert(
        mappings.slice(i, i + 500).map((m) => ({ tenant_id: ctx.tenantId, ...m, source_repo: `cli:${label}`, updated_at: now })),
        { onConflict: 'tenant_id,asset_type,source_id' },
      )
      if (error) throw dbError(error, 'Failed to record asset mappings')
    }
  }

  const importErrors: Array<{ asset_type: string; source_id: string; error: string }> = result?.errors ?? []
  if (themePlan?.asset.action === 'update' && themePlan.theme) {
    try {
      await updateWorkspaceTheme(ctx, themePlan.theme, { summary: `Applied the workspace theme "${themePlan.theme.meta.name}" from configuration (cli:${label})` })
      result.updated = { ...(result.updated ?? {}), workspace_theme: 1 }
    } catch (error) {
      importErrors.push({ asset_type: 'workspace_theme', source_id: '', error: error instanceof Error ? error.message : 'Could not update the workspace theme' })
    }
  }
  const rowResults = rowSets.length && rowsMode !== 'skip'
    ? await applyTableRowSets(ctx, rowSets, identity.seed, rowsMode, `cli:${label}`)
    : []
  const failed = new Set(importErrors.map((e) => `${e.asset_type}:${e.source_id}`))
  const changed: AssetPlan[] = []
  for (const asset of plan.assets) {
    if ((asset.action !== 'create' && asset.action !== 'update') || !asset.source_id) continue
    if (failed.has(`${asset.asset_type}:${asset.source_id}`)) continue
    if (asset.action === 'create' && asset.asset_type !== 'object') {
      asset.local_id = identity.seed[asset.asset_type as keyof AssetIdMaps][asset.source_id] ?? null
    }
    changed.push(asset)
  }
  await enqueueSync(ctx, changed)

  const created: Record<string, number> = Object.fromEntries(Object.entries(result?.counts ?? {}).filter(([, n]) => Number(n) > 0)) as Record<string, number>
  const updated: Record<string, number> = result?.updated ?? {}
  const sum = (record: Record<string, number>) => Object.values(record).reduce((a, b) => a + Number(b), 0)
  await audit(ctx, {
    objectType: 'config', objectId: randomUUID(), action: 'import',
    summary: `Applied configuration (cli:${label}): ${sum(created)} created, ${sum(updated)} updated, ${plan.summary.unchanged} unchanged, ${importErrors.length + plan.summary.error} errors`,
    metadata: { source_label: label, plan: plan.summary, created, updated, errors: importErrors.length },
  })

  return {
    dry_run: false,
    plan,
    warnings: identity.warnings,
    result: { created, updated, errors: importErrors, warnings: result?.warnings ?? [], ...(rowResults.length ? { rows: rowResults } : {}) },
    id_map: identity.seed,
  }
}

interface TableRowSet { id: string; name: string; rows: PortableRow[] }

function tableRowSets(manifest: Record<string, any>): TableRowSet[] {
  const sets = Array.isArray(manifest[TABLE_ROWS_SECTION]) ? manifest[TABLE_ROWS_SECTION] : []
  return sets
    .filter((set: any) => isUuid(set?.id) && Array.isArray(set?.rows))
    .map((set: any) => ({
      id: String(set.id),
      name: String(set.name ?? 'Table rows'),
      rows: (set.rows as any[]).filter((row) => row && typeof row === 'object').map((row, index) => ({
        id: isUuid(row.id) ? String(row.id) : `${set.id}:${index}`,
        data: (row.data && typeof row.data === 'object' ? row.data : {}) as Record<string, unknown>,
      })),
    }))
}

/** Write `table_rows` for tables that exist here; row identity via github_sync_asset_map ('data_row'). */
async function applyTableRowSets(ctx: ServiceContext, sets: TableRowSet[], seed: AssetIdMaps, mode: RowMode, sourceRepo: string) {
  const results: NonNullable<NonNullable<ConfigApplyResult['result']>['rows']> = []
  for (const set of sets) {
    const localTable = seed.data_table[set.id] ?? (await selectIn(ctx, 'custom_tables', 'id', 'id', [set.id]))[0]?.id ?? null
    if (!localTable) {
      results.push({ table_id: set.id, local_table_id: null, inserted: 0, updated: 0, deleted: 0, error: 'The data table does not exist in this workspace (include it in the files)' })
      continue
    }
    try {
      const sourceIds = set.rows.map((row) => row.id).filter(isUuid)
      const existing: Record<string, string> = {}
      if (sourceIds.length) {
        for (const row of await selectIn(ctx, 'github_sync_asset_map', 'source_id, local_id, asset_type', 'source_id', sourceIds)) {
          if (row.asset_type === 'data_row') existing[String(row.source_id)] = String(row.local_id)
        }
        // Re-applying this workspace's own export: the row ids are local already.
        const unmapped = sourceIds.filter((id) => !existing[id])
        for (let i = 0; i < unmapped.length; i += IN_CHUNK) {
          const { data } = await (ctx.supabase as any).from('custom_table_rows').select('id')
            .eq('tenant_id', ctx.tenantId).eq('table_id', String(localTable)).in('id', unmapped.slice(i, i + IN_CHUNK))
          for (const row of data ?? []) existing[String(row.id)] = String(row.id)
        }
      }
      const written = await writeTableRows({ supabase: ctx.supabase, tenantId: ctx.tenantId, tableId: String(localTable), rows: set.rows, mode, actorId: ctx.actorId, existingMappings: existing })
      const now = new Date().toISOString()
      const mappings = Object.entries(written.mappings).filter(([source, local]) => isUuid(source) && source !== local)
      for (let i = 0; i < mappings.length; i += 500) {
        const { error } = await (ctx.supabase as any).from('github_sync_asset_map').upsert(
          mappings.slice(i, i + 500).map(([source_id, local_id]) => ({ tenant_id: ctx.tenantId, asset_type: 'data_row', source_id, local_id, source_repo: sourceRepo, updated_at: now })),
          { onConflict: 'tenant_id,asset_type,source_id' },
        )
        if (error) throw dbError(error, 'Failed to record row mappings')
      }
      results.push({ table_id: set.id, local_table_id: String(localTable), inserted: written.inserted, updated: written.updated, deleted: written.deleted })
    } catch (error) {
      results.push({ table_id: set.id, local_table_id: String(localTable), inserted: 0, updated: 0, deleted: 0, error: error instanceof Error ? error.message : 'Failed to write rows' })
    }
  }
  return results
}

/** Queue GitHub-sync changes for written assets (one connector check, not one per asset). */
async function enqueueSync(ctx: ServiceContext, changed: AssetPlan[]) {
  if (!changed.length) return
  const { data: connector } = await (ctx.supabase as any).from('tenant_connectors')
    .select('is_enabled').eq('tenant_id', ctx.tenantId).eq('connector_key', GITHUB_CONNECTOR_KEY).maybeSingle()
  if (!connector?.is_enabled) return
  for (const asset of changed) {
    const type = SYNC_TYPE[asset.asset_type]
    if (type && asset.local_id) await syncChange(ctx, type, { id: asset.local_id, name: asset.name })
  }
}
