/**
 * Packages — install side: the package library of a workspace.
 *
 * install / upgrade (one code path, `planPackageInstall` = dry run):
 *   1. read + verify the .utpkg (checksum, every file hash, signature) —
 *      a tampered package is refused
 *   2. identity: package asset id → local id from package_install_assets
 *      (upgrade in place), then the config-as-code rules (same id here,
 *      recorded mapping, optional adopt-by-name on first install)
 *   3. requirements: values supplied now ⊕ values kept from the last install
 *      (non-secret ones are stored with the install; secrets stay only in the
 *      asset rows, where '__SECRET__' keeps them) ⊕ defaults. Unmet required
 *      ones fail the install unless keep_incomplete: then the affected assets
 *      are installed DISABLED ("Needs configuration") and workflows that
 *      depend on them stay inactive and cannot be activated or published
 *      until "Complete setup" (completePackageInstall) fills them
 *   4. the dry-run plan per asset (create / update / unchanged, field diffs,
 *      locally modified since install, removed in the new version — never
 *      deleted), data rows per table (merge / replace / skip)
 *   5. apply through lib/services/config (every section's own create / edit
 *      permission applies), then record the install + asset map and publish
 *      the workflows that are active in the package
 *
 * uninstall removes package-owned assets (dry run lists them first); assets
 * changed locally since install are skipped unless forced, and a data table
 * that holds rows is kept unless delete_data is set. Unfinished runs of the
 * package's workflows block it unless cancel_runs (deleting a workflow
 * deletes its runs); every section's own delete permission is checked first.
 *
 * Every install / upgrade / complete setup / uninstall — and every failed
 * attempt after the permission gate — is recorded in package_events
 * (lib/services/package-events) with the plan that was applied.
 *
 * Tables are service-role only; permissions: packages.view (read / plan),
 * packages.install (install, upgrade, complete, uninstall).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests and rows are free-form JSON */

import { buildManifestExport } from '@/lib/portability/export'
import { scanAssetReferences } from '@/lib/portability/dependencies'
import { createEmptyAssetIdMaps, type AssetIdMaps } from '@/lib/portability/id-maps'
import { isUuid, type AssetPlan, type ConfigPlan } from '@/lib/portability/plan'
import { scrubSecretsForExport, SECRET_PLACEHOLDER } from '@/lib/portability/scrub'
import { writeTableRows, type RowMode } from '@/lib/portability/table-rows'
import { PACKAGE_SECTIONS, type PackageContents } from '@/lib/packages/build'
import { canonicalJson, sha256Hex, type PackageRequirement, type RequirementField } from '@/lib/packages/format'
import { applyRequirementValues, nonSecretValues, requirementStatus, setAt, type RequirementState, type RequirementValues } from '@/lib/packages/requirements'
import { compareSemver, satisfiesRange } from '@/lib/packages/semver'
import { applyConfig, type ConfigApplyResult } from './config'
import { hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { applyPage, audit, dbError, serviceRoleClient, type Page } from './_shared'
import { eventChannel, recordPackageEvent, requirementChanges, type PackageEventAction } from './package-events'
import { actOnWorkflowRun } from './workflow-runs'
import { decodePackageFile, downloadPackageVersion, readPackageFile, summarizePackage, type ReadPackageResult } from './packages'
import { deleteConnector } from './connectors'
import { deleteDataTable } from './data-tables'
import { deleteDecisionTable } from './decision-tables'
import { deleteEmailTemplate } from './email-templates'
import { deleteIntegration } from './integrations'
import { deleteLogDestination } from './log-destinations'
import { deleteForm, deleteFormTheme } from './forms'
import { deleteRole } from './roles'
import { deleteWorkflowActivity } from './workflow-activities'
import { deleteWorkflow, publishWorkflow } from './workflows'

const INSTALL_COLUMNS = 'id, package_uid, name, slug, version, previous_version, description, source, source_label, checksum, signed, signature_valid, fingerprint, status, requirements, requirement_values, manifest, installed_by, installed_at, updated_at'
const ASSET_COLUMNS = 'id, install_id, asset_type, section, source_id, local_id, name, content_hash, status, blocked_by, updated_at'

/** Manifest section → install asset type (objects are identified by their generated reference). */
const SECTION_ASSET_TYPE: Record<string, string> = {
  email_templates: 'email_template', connectors: 'connector', data_tables: 'data_table', integrations: 'integration',
  references: 'reference', objects: 'object', decision_tables: 'decision_table', retention_policies: 'retention_policy',
  roles: 'role', mcp_servers: 'mcp_server', workflow_activities: 'workflow_activity', reports: 'report', agents: 'agent',
  workflows: 'workflow', log_destinations: 'log_destination', form_themes: 'form_theme', forms: 'form',
}
/** Install asset type → id map key used by config apply. */
const MAP_KEY: Record<string, keyof AssetIdMaps> = {
  email_template: 'email_template', connector: 'connector', data_table: 'data_table', integration: 'integration', reference: 'reference',
  object: 'reference', decision_table: 'decision_table', retention_policy: 'retention_policy', role: 'role', mcp_server: 'mcp_server',
  workflow_activity: 'workflow_activity', report: 'report', agent: 'agent', workflow: 'workflow', log_destination: 'log_destination',
  form: 'form', form_theme: 'form_theme',
}
/** Activation flag per section (disabled while incomplete). */
const ACTIVE_FLAG: Record<string, string> = {
  connectors: 'is_enabled', integrations: 'is_active', mcp_servers: 'is_active', log_destinations: 'enabled', workflows: 'is_active', agents: 'is_active',
}
const sourceIdOf = (section: string, asset: any) => String(section === 'objects' ? asset?.generated_reference_id ?? '' : asset?.id ?? '')

export type InstallMode = 'install' | 'upgrade' | 'reinstall' | 'downgrade'

export interface PackageInstallInput {
  /** Base64 .utpkg. */
  file?: string
  /** Or a package built in this workspace (its latest version unless `version`). */
  package_id?: string
  version?: string
  /** { <requirement id>: { <field key>: value } } */
  values?: RequirementValues
  /** Install even when required values are missing: affected assets are disabled until Complete setup. */
  keep_incomplete?: boolean
  /** First install only: adopt existing assets with the same unique name. */
  adopt_by_name?: boolean
  /** Per data table (package table id): merge (default), replace or skip its rows. */
  data?: Record<string, RowMode>
  /** Upgrade: keep assets changed here since the last install instead of overwriting them. */
  keep_local_changes?: boolean
  allow_downgrade?: boolean
  /** Install despite unmet package dependencies. */
  ignore_dependencies?: boolean
  source?: 'file' | 'library' | 'api' | 'cli' | 'mcp'
  source_label?: string
  /** History: the file name the caller uploaded (named in failed attempts that never got as far as the package header). */
  file_name?: string
}

/** What a failed install attempt got as far as (for its history event). */
interface InstallTrace {
  header?: PackageContents['header']
  verification?: ReadPackageResult['verification']
  existing?: any
  mode?: InstallMode
  plan?: InstallPlanResult
}

const errorMessage = (error: unknown, fallback = 'Failed') =>
  error instanceof Error ? error.message
    : error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string' ? String((error as { message: string }).message)
      : fallback

async function recordInstallFailure(ctx: ServiceContext, input: PackageInstallInput, trace: InstallTrace, error: unknown) {
  const header = trace.header
  const existing = trace.existing
  await recordPackageEvent(ctx, {
    install_id: existing?.id ?? null,
    package_uid: header?.id ?? existing?.package_uid ?? null,
    package_name: header?.name ?? existing?.name ?? input.source_label ?? input.file_name ?? 'Unknown package',
    package_slug: header?.slug ?? existing?.slug ?? null,
    action: trace.mode ?? (existing ? 'upgrade' : 'install'),
    status: 'failed',
    from_version: existing?.version ? String(existing.version) : null,
    to_version: header?.version ?? null,
    channel: eventChannel(ctx, input.source),
    source: input.source ?? (input.package_id ? 'library' : 'file'),
    source_label: input.source_label ?? input.file_name ?? null,
    signed: trace.verification?.signed ?? null,
    signature_valid: trace.verification?.signature_ok ?? null,
    fingerprint: trace.verification?.fingerprint ?? null,
    trust: trace.verification?.trust ?? null,
    options: installOptions(input),
    plan: trace.plan ?? null,
    error: errorMessage(error, 'Install failed'),
    summary: `Failed to ${trace.mode === 'upgrade' || (!trace.mode && existing) ? 'upgrade' : 'install'} ${header?.name ?? existing?.name ?? 'a package'}${header?.version ? ` ${header.version}` : ''}`,
  })
}

function installOptions(input: PackageInstallInput) {
  const out: Record<string, unknown> = {}
  for (const key of ['keep_incomplete', 'adopt_by_name', 'keep_local_changes', 'allow_downgrade', 'ignore_dependencies'] as const) if (input[key]) out[key] = true
  if (input.data && Object.keys(input.data).length) out.data = input.data
  if (input.package_id) { out.package_id = input.package_id; if (input.version) out.version = input.version }
  return out
}

export interface RequirementPlan extends PackageRequirement {
  status: 'met' | 'missing'
  field_states: RequirementState['fields']
}

export interface InstallPlanAsset extends AssetPlan {
  locally_modified?: boolean
  needs_config?: boolean
  blocked_by?: string[]
  skipped?: string
}

export interface InstallPlanResult {
  dry_run: boolean
  mode: InstallMode
  package: PackageContents['header']
  verification: ReadPackageResult['verification']
  installed_version: string | null
  plan: { assets: InstallPlanAsset[]; summary: ConfigPlan['summary'] }
  removed_upstream: Array<{ section: string; source_id: string; local_id: string; name: string | null }>
  requirements: RequirementPlan[]
  data: Array<{ table_id: string; name: string; rows: number; mode: RowMode }>
  dependencies: Array<{ package_slug: string; version_range: string; installed_version: string | null; ok: boolean }>
  /** Why a real install would be refused (empty = it can proceed). */
  blockers: string[]
  missing_permissions?: Array<{ section: string; permission: string }>
  warnings: Array<{ warning: string; asset_type?: string; source_id?: string }>
  install?: Record<string, any>
  result?: ConfigApplyResult['result'] & { published?: string[]; rows?: any[] }
}

async function admin(ctx: ServiceContext): Promise<AnySupabaseClient> {
  return serviceRoleClient(ctx)
}

// ─── Hashing (local-change detection) ───────────────────────────────────────

const HASH_IGNORED = new Set(['id', 'created_at', 'updated_at', 'tenant_id', 'created_by', 'updated_by', 'exported_at', 'is_active', 'is_enabled', 'enabled', 'generated_integration_id', 'generated_references', 'generated_reference_id', 'credentials'])
function stripForHash(value: unknown, depth = 0): unknown {
  if (depth > 40) return value
  if (Array.isArray(value)) return value.map((item) => stripForHash(item, depth + 1))
  if (!value || typeof value !== 'object') return value === SECRET_PLACEHOLDER ? null : value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (depth === 0 && HASH_IGNORED.has(key)) continue
    if (key === 'created_at' || key === 'updated_at') continue
    out[key] = stripForHash(child, depth + 1)
  }
  return out
}
export function assetContentHash(asset: unknown): string {
  return sha256Hex(canonicalJson(stripForHash(asset)))
}

/** Local exports (scrubbed) keyed by `${section}:${local id}`. */
async function localExports(db: AnySupabaseClient, tenantId: string, rows: Array<{ asset_type: string; local_id: string }>, keepCredentials = false): Promise<Map<string, any>> {
  const idsByType: Partial<Record<string, string[]>> = {}
  for (const row of rows) {
    if (row.asset_type === 'data_row' || row.asset_type === 'reference' || row.asset_type === 'object') continue
    ;(idsByType[row.asset_type] ??= []).push(String(row.local_id))
  }
  const out = new Map<string, any>()
  if (!Object.keys(idsByType).length) return out
  const raw = await buildManifestExport(db, tenantId, idsByType, { keepCredentials })
  const exported = keepCredentials ? raw : scrubSecretsForExport(raw)
  for (const section of PACKAGE_SECTIONS) {
    for (const asset of Array.isArray(exported[section]) ? exported[section] : []) out.set(`${section}:${asset.id}`, asset)
  }
  return out
}

// ─── Package dependency graph (which workflows an incomplete asset blocks) ──

function packageGraph(assets: Record<string, any>): Map<string, Set<string>> {
  const referenceOwner = new Map<string, string>()
  for (const reference of assets.references ?? []) referenceOwner.set(String(reference.id), `integrations:${reference.integration_id}`)
  for (const connector of assets.connectors ?? []) {
    for (const ref of connector.generated_references ?? []) referenceOwner.set(String(ref.id), `connectors:${connector.id}`)
    if (connector.generated_integration_id) referenceOwner.set(`integration:${connector.generated_integration_id}`, `connectors:${connector.id}`)
  }
  const keyOf = (type: string, id: string): string | null => {
    if (type === 'reference') return referenceOwner.get(id) ?? null
    if (type === 'integration' && referenceOwner.has(`integration:${id}`)) return referenceOwner.get(`integration:${id}`)!
    const section = Object.entries(SECTION_ASSET_TYPE).find(([, t]) => t === type)?.[0]
    return section ? `${section}:${id}` : null
  }
  const graph = new Map<string, Set<string>>()
  for (const section of PACKAGE_SECTIONS) {
    for (const asset of Array.isArray(assets[section]) ? assets[section] : []) {
      const self = `${section}:${sourceIdOf(section, asset)}`
      const edges = new Set<string>()
      for (const ref of scanAssetReferences(asset).refs) {
        const target = keyOf(ref.type, ref.id)
        if (target && target !== self) edges.add(target)
      }
      graph.set(self, edges)
    }
  }
  return graph
}

function closureOf(graph: Map<string, Set<string>>, start: string): Set<string> {
  const seen = new Set<string>([start])
  const stack = [start]
  while (stack.length) {
    for (const next of graph.get(stack.pop()!) ?? []) if (!seen.has(next)) { seen.add(next); stack.push(next) }
  }
  return seen
}

// ─── Value resolution ───────────────────────────────────────────────────────

function mergeValues(...sets: Array<RequirementValues | undefined | null>): RequirementValues {
  const out: RequirementValues = {}
  for (const set of sets) {
    for (const [id, fields] of Object.entries(set ?? {})) {
      if (!fields || typeof fields !== 'object') continue
      out[id] = { ...(out[id] ?? {}) }
      for (const [key, value] of Object.entries(fields)) if (value !== undefined && value !== null && value !== '') out[id][key] = value
    }
  }
  return out
}

async function makeResolver(ctx: ServiceContext, db: AnySupabaseClient, requirements: PackageRequirement[], values: RequirementValues, warnings: InstallPlanResult['warnings']) {
  const slugs = new Set<string>()
  const emails = new Set<string>()
  for (const requirement of requirements) {
    for (const field of requirement.fields) {
      const value = values[requirement.id]?.[field.key] ?? (requirement.kind === 'role' ? field.default : undefined)
      if (requirement.kind === 'role' && typeof value === 'string') slugs.add(value)
      if (field.type === 'user' && typeof value === 'string' && value.includes('@')) emails.add(value.trim().toLowerCase())
    }
  }
  const roleBySlug = new Map<string, string>()
  if (slugs.size) {
    const { data } = await (db as any).from('roles').select('id, slug').eq('tenant_id', ctx.tenantId).in('slug', [...slugs])
    for (const row of data ?? []) roleBySlug.set(String(row.slug), String(row.id))
  }
  const userByEmail = new Map<string, string>()
  if (emails.size) {
    const { data } = await (db as any).from('users').select('id, email').in('email', [...emails])
    for (const row of data ?? []) userByEmail.set(String(row.email).toLowerCase(), String(row.id))
  }
  return (requirement: PackageRequirement, field: RequirementField, value: unknown): unknown => {
    if (requirement.kind === 'role') {
      const id = typeof value === 'string' ? roleBySlug.get(value) ?? (isUuid(value) ? value : undefined) : undefined
      if (!id) warnings.push({ warning: `${requirement.label}: no role "${String(value)}" in this workspace; the step keeps its original role id` })
      return id
    }
    if (field.type === 'user' && typeof value === 'string' && value.includes('@')) {
      const id = userByEmail.get(value.trim().toLowerCase())
      if (!id) warnings.push({ warning: `${requirement.label}: no user with the email ${value}` })
      return id
    }
    return value
  }
}

// ─── Install / upgrade ──────────────────────────────────────────────────────

async function loadInstallByUid(db: AnySupabaseClient, tenantId: string, uid: string) {
  const { data, error } = await (db as any).from('package_installs').select(INSTALL_COLUMNS).eq('tenant_id', tenantId).eq('package_uid', uid).maybeSingle()
  if (error) throw dbError(error)
  return data
}

async function loadInstallAssets(db: AnySupabaseClient, tenantId: string, installId: string): Promise<any[]> {
  const rows: any[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await (db as any).from('package_install_assets').select(ASSET_COLUMNS).eq('tenant_id', tenantId).eq('install_id', installId).order('id').range(offset, offset + 999)
    if (error) throw dbError(error)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return rows
}

async function readInput(ctx: ServiceContext, input: PackageInstallInput): Promise<ReadPackageResult> {
  if (input.file) return readPackageFile(ctx, decodePackageFile(input.file))
  if (input.package_id) return readPackageFile(ctx, (await downloadPackageVersion(ctx, input.package_id, input.version ?? 'latest')).bytes)
  throw ServiceError.validation('Provide file (base64 of a .utpkg) or package_id')
}

export async function planPackageInstall(ctx: ServiceContext, input: PackageInstallInput): Promise<InstallPlanResult> {
  requirePerm(ctx, 'packages.view')
  return runInstall(ctx, input, true)
}

export async function installPackage(ctx: ServiceContext, input: PackageInstallInput): Promise<InstallPlanResult> {
  requirePerm(ctx, 'packages.install')
  const trace: InstallTrace = {}
  try {
    return await runInstall(ctx, input, false, undefined, trace)
  } catch (error) {
    await recordInstallFailure(ctx, input, trace, error)
    throw error
  }
}

async function runInstall(ctx: ServiceContext, input: PackageInstallInput, dryRun: boolean, preRead?: ReadPackageResult, trace: InstallTrace = {}): Promise<InstallPlanResult> {
  const db = await admin(ctx)
  const actx: ServiceContext = { ...ctx, supabase: db }
  const read = preRead ?? await readInput(ctx, input)
  const { contents, verification } = read
  const header = contents.header
  trace.header = header
  trace.verification = verification
  if (!verification.valid) {
    throw ServiceError.validation(`Package failed verification: ${verification.errors.join('; ') || 'checksum mismatch'}`, { verification })
  }
  if (!isUuid(header.id)) throw ServiceError.validation('Package id is not a uuid')

  const warnings: InstallPlanResult['warnings'] = []
  const blockers: string[] = []
  const existing = await loadInstallByUid(db, ctx.tenantId, header.id)
  const cmp = existing ? compareSemver(header.version, String(existing.version)) : 1
  const mode: InstallMode = !existing ? 'install' : cmp > 0 ? 'upgrade' : cmp === 0 ? 'reinstall' : 'downgrade'
  trace.existing = existing
  trace.mode = mode
  if (mode === 'downgrade' && !input.allow_downgrade) blockers.push(`Version ${header.version} is older than the installed ${existing.version} (pass allow_downgrade to downgrade)`)
  if (verification.trust === 'unsigned') warnings.push({ warning: 'The package is not signed' })
  else if (verification.trust === 'untrusted') warnings.push({ warning: `Signed by a key this workspace does not know (fingerprint ${verification.fingerprint})` })

  // Dependencies: other packages that must be installed here.
  const dependencies: InstallPlanResult['dependencies'] = []
  for (const dep of contents.dependencies) {
    const { data } = await (db as any).from('package_installs').select('version').eq('tenant_id', ctx.tenantId).eq('slug', dep.package_slug).maybeSingle()
    const installedVersion = data?.version ? String(data.version) : null
    const ok = Boolean(installedVersion && satisfiesRange(installedVersion, dep.version_range))
    dependencies.push({ ...dep, installed_version: installedVersion, ok })
    if (!ok && !input.ignore_dependencies) blockers.push(`Needs package "${dep.package_slug}" ${dep.version_range}${installedVersion ? ` (installed: ${installedVersion})` : ' (not installed)'}`)
  }

  // Identity from the previous install.
  const installAssets = existing ? await loadInstallAssets(db, ctx.tenantId, existing.id) : []
  const seed: Partial<Record<keyof AssetIdMaps, Record<string, string>>> = {}
  for (const row of installAssets) {
    const key = MAP_KEY[row.asset_type]
    if (!key) continue
    ;(seed[key] ??= {})[String(row.source_id)] = String(row.local_id)
  }
  const bySource = new Map<string, any>(installAssets.map((row) => [`${row.section}:${row.source_id}`, row]))

  const manifest: Record<string, any> = { format_version: 3, ...structuredClone(contents.assets) }
  const requirements = contents.requirements

  // Locally stored values: the mapped local rows (secrets) + stored non-secret values.
  const mappedLocal = installAssets.filter((row) => row.asset_type !== 'data_row')
  const localRaw = mappedLocal.length ? await localExports(db, ctx.tenantId, mappedLocal, true) : new Map<string, any>()
  const localOf = (section: string, sourceId: string) => {
    const row = bySource.get(`${section}:${sourceId}`)
    return row ? localRaw.get(`${section}:${row.local_id}`) : undefined
  }
  const storedAt = (requirement: PackageRequirement, field: RequirementField) => {
    const local = localOf(field.target.section, field.target.asset_id)
    if (!local) return false
    let node: any = local
    for (const seg of field.target.path) { if (node === null || typeof node !== 'object') return false; node = node[seg as any] }
    return node !== undefined && node !== null && node !== '' && node !== SECRET_PLACEHOLDER
  }
  const values = mergeValues(existing?.requirement_values, input.values)
  const knownReqs = new Map(requirements.map((r) => [r.id, r]))
  for (const [id, fields] of Object.entries(input.values ?? {})) {
    const requirement = knownReqs.get(id)
    if (!requirement) { warnings.push({ warning: `Unknown requirement "${id}" (ignored)` }); continue }
    for (const key of Object.keys(fields ?? {})) if (!requirement.fields.some((f) => f.key === key)) warnings.push({ warning: `Requirement "${id}" has no field "${key}" (ignored)` })
  }
  const states = requirementStatus(requirements, values, storedAt)
  const stateById = new Map(states.map((s) => [s.id, s]))
  const unmet = new Set(states.filter((s) => s.status === 'missing').map((s) => s.id))
  if (unmet.size && !input.keep_incomplete) {
    blockers.push(`Missing required values for ${[...unmet].map((id) => knownReqs.get(id)?.label ?? id).join('; ')} (supply them, or keep the install incomplete)`)
  }

  // Patch requirement values into the manifest.
  applyRequirementValues(manifest, requirements, values, await makeResolver(ctx, db, requirements, values, warnings))

  // Incomplete: disable the assets that need configuration and block what depends on them.
  const graph = packageGraph(manifest)
  const needsConfig = new Map<string, string[]>() // asset key → requirement ids
  for (const id of unmet) {
    const requirement = knownReqs.get(id)!
    const key = `${requirement.ref.section}:${requirement.ref.asset_id}`
    needsConfig.set(key, [...(needsConfig.get(key) ?? []), id])
  }
  const blockedBy = new Map<string, string[]>()
  for (const section of ['workflows', 'agents']) {
    for (const asset of manifest[section] ?? []) {
      const self = `${section}:${asset.id}`
      const reqs = [...closureOf(graph, self)].flatMap((key) => needsConfig.get(key) ?? [])
      if (reqs.length) blockedBy.set(self, [...new Set(reqs)])
    }
  }
  // Workflows active in the package are published after install (unless blocked).
  const activate: string[] = []
  for (const section of PACKAGE_SECTIONS) {
    const flag = ACTIVE_FLAG[section]
    for (const asset of manifest[section] ?? []) {
      const key = `${section}:${sourceIdOf(section, asset)}`
      const local = localOf(section, sourceIdOf(section, asset))
      // Upgrades re-publish what is live here; first installs what is live in the package.
      // Blocked ones are published by Complete setup.
      if (section === 'workflows' && (local ? local.is_active : asset.is_active)) activate.push(String(asset.id))
      // Agents switched off only because they wait on setup are switched back on by Complete setup.
      if (section === 'agents' && blockedBy.has(key) && (local ? local.is_active : asset.is_active !== false)) activate.push(String(asset.id))
      if (!flag) continue
      if (needsConfig.has(key) || blockedBy.has(key)) asset[flag] = false
      else if (local && section !== 'connectors') asset[flag] = Boolean(local[flag]) // upgrades keep the local on/off state
    }
  }
  // Workflows go in inactive and are published (activated) once recorded.
  for (const asset of manifest.workflows ?? []) {
    const local = localOf('workflows', String(asset.id))
    if (!local) asset.is_active = false
  }

  // Local changes since the last install.
  const modified = new Set<string>()
  if (existing && mappedLocal.length) {
    const localScrubbed = await localExports(db, ctx.tenantId, mappedLocal)
    for (const row of mappedLocal) {
      const local = localScrubbed.get(`${row.section}:${row.local_id}`)
      if (local && row.content_hash && assetContentHash(local) !== row.content_hash) modified.add(`${row.section}:${row.source_id}`)
    }
  }
  if (input.keep_local_changes && modified.size) {
    for (const section of PACKAGE_SECTIONS) {
      if (!Array.isArray(manifest[section])) continue
      manifest[section] = manifest[section].filter((asset: any) => !modified.has(`${section}:${sourceIdOf(section, asset)}`))
    }
    warnings.push({ warning: `Kept ${modified.size} asset${modified.size === 1 ? '' : 's'} changed in this workspace since the last install` })
  }

  // Removed in this version: flagged, never deleted.
  const incomingKeys = new Set(PACKAGE_SECTIONS.flatMap((section) => (contents.assets[section] ?? []).map((asset: any) => `${section}:${sourceIdOf(section, asset)}`)))
  const removedUpstream = installAssets
    .filter((row) => row.asset_type !== 'data_row' && row.section !== 'references' && !incomingKeys.has(`${row.section}:${row.source_id}`))
    .map((row) => ({ section: String(row.section), source_id: String(row.source_id), local_id: String(row.local_id), name: row.name ?? null }))
  if (removedUpstream.length) warnings.push({ warning: `${removedUpstream.length} asset${removedUpstream.length === 1 ? ' is' : 's are'} no longer in this version; ${removedUpstream.length === 1 ? 'it is' : 'they are'} kept (uninstall or delete by hand)` })

  // Data rows.
  const tableNames = new Map<string, string>((contents.assets.data_tables ?? []).map((t: any) => [String(t.id), String(t.name)]))
  const data: InstallPlanResult['data'] = Object.entries(contents.data)
    .filter(([, entry]) => entry.mode === 'rows')
    .map(([tableId, entry]) => ({ table_id: tableId, name: tableNames.get(tableId) ?? tableId, rows: entry.rows?.length ?? 0, mode: input.data?.[tableId] ?? 'merge' }))
  if (data.some((d) => d.mode !== 'skip') && !hasPerm(ctx, 'data.manage_rows')) blockers.push("Writing table rows needs 'data.manage_rows' (or skip them)")

  const applied = await applyConfig(actx, {
    manifest,
    dry_run: dryRun || blockers.length > 0,
    adopt_by_name: !existing && Boolean(input.adopt_by_name),
    source_label: `package:${header.slug}`,
    identity_seed: seed,
    record_mappings: false,
  })
  const planAssets: InstallPlanAsset[] = applied.plan.assets.map((asset) => {
    const key = asset.source_id ? `${asset.section}:${asset.source_id}` : ''
    return {
      ...asset,
      ...(modified.has(key) ? { locally_modified: true } : {}),
      ...(needsConfig.has(key) || blockedBy.has(key) ? { needs_config: true } : {}),
      ...(blockedBy.has(key) ? { blocked_by: blockedBy.get(key) } : {}),
    }
  })
  if (input.keep_local_changes) {
    for (const key of modified) {
      const cut = key.indexOf(':')
      const section = key.slice(0, cut)
      const sourceId = key.slice(cut + 1)
      const row = bySource.get(key)
      planAssets.push({ section, asset_type: (SECTION_ASSET_TYPE[section] ?? 'workflow') as any, source_id: sourceId, local_id: row?.local_id ?? null, name: row?.name ?? sourceId, action: 'unchanged', locally_modified: true, skipped: 'changed locally; kept' })
    }
  }
  const requirementPlans: RequirementPlan[] = requirements.map((requirement) => ({ ...requirement, status: stateById.get(requirement.id)!.status, field_states: stateById.get(requirement.id)!.fields }))
  const result: InstallPlanResult = {
    dry_run: dryRun || blockers.length > 0,
    mode,
    package: header,
    verification,
    installed_version: existing ? String(existing.version) : null,
    plan: { assets: planAssets, summary: applied.plan.summary },
    removed_upstream: removedUpstream,
    requirements: requirementPlans,
    data,
    dependencies,
    blockers,
    ...(applied.missing_permissions?.length ? { missing_permissions: applied.missing_permissions } : {}),
    warnings: [...warnings, ...applied.warnings],
  }
  trace.plan = result
  if (dryRun) return result
  if (blockers.length) throw ServiceError.validation(`Cannot install: ${blockers.join('; ')}`, { plan: result })

  // ── Record the install ──
  const idMap = applied.id_map ?? createEmptyAssetIdMaps()
  const localIdFor = (section: string, sourceId: string): string | null => {
    const key = MAP_KEY[SECTION_ASSET_TYPE[section]]
    return (key && idMap[key]?.[sourceId]) || bySource.get(`${section}:${sourceId}`)?.local_id || null
  }
  const status = unmet.size ? 'incomplete' : 'complete'
  const installRow = {
    tenant_id: ctx.tenantId,
    package_uid: header.id,
    name: header.name,
    slug: header.slug,
    version: header.version,
    previous_version: existing && mode !== 'reinstall' ? String(existing.version) : existing?.previous_version ?? null,
    description: header.description ?? null,
    source: input.source ?? (input.package_id ? 'library' : 'file'),
    source_label: input.source_label ?? null,
    checksum: String(verification.checksum),
    signed: verification.signed,
    signature_valid: verification.signature_ok,
    fingerprint: verification.fingerprint,
    status,
    requirements: requirementPlans.map(({ field_states, ...rest }) => ({ ...rest, field_states })),
    requirement_values: nonSecretValues(requirements, values),
    manifest: {
      package: header,
      dependencies: contents.dependencies,
      data: Object.fromEntries(Object.entries(contents.data).map(([id, entry]) => [id, { mode: entry.mode, rows: entry.rows?.length ?? 0 }])),
      activate,
      asset_count: incomingKeys.size,
      trust: verification.trust,
    },
    installed_by: ctx.actorId,
    installed_at: new Date().toISOString(),
  }
  const { data: saved, error: saveError } = await (db as any).from('package_installs').upsert(installRow, { onConflict: 'tenant_id,package_uid' }).select(INSTALL_COLUMNS).single()
  if (saveError || !saved) throw dbError(saveError, 'Failed to record the install')

  // Asset map with content hashes of what is installed now.
  const assetRows: any[] = []
  for (const section of PACKAGE_SECTIONS) {
    for (const asset of contents.assets[section] ?? []) {
      const sourceId = sourceIdOf(section, asset)
      const localId = localIdFor(section, sourceId)
      if (!sourceId || !localId) continue
      const key = `${section}:${sourceId}`
      assetRows.push({
        tenant_id: ctx.tenantId, install_id: saved.id, asset_type: SECTION_ASSET_TYPE[section], section, source_id: sourceId, local_id: localId,
        name: String(asset.name ?? ''), status: needsConfig.has(key) || blockedBy.has(key) ? 'needs_config' : 'ok', blocked_by: [...new Set([...(needsConfig.get(key) ?? []), ...(blockedBy.get(key) ?? [])])],
        ...(modified.has(key) && input.keep_local_changes ? { content_hash: bySource.get(key)?.content_hash ?? null } : {}),
      })
    }
  }
  const fresh = await localExports(db, ctx.tenantId, assetRows)
  for (const row of assetRows) {
    if (row.content_hash !== undefined) continue
    const local = fresh.get(`${row.section}:${row.local_id}`)
    row.content_hash = local ? assetContentHash(local) : null
  }
  for (const removed of removedUpstream) {
    assetRows.push({ tenant_id: ctx.tenantId, install_id: saved.id, asset_type: SECTION_ASSET_TYPE[removed.section] ?? removed.section, section: removed.section, source_id: removed.source_id, local_id: removed.local_id, name: removed.name, status: 'removed_upstream', blocked_by: [], content_hash: bySource.get(`${removed.section}:${removed.source_id}`)?.content_hash ?? null })
  }
  for (let i = 0; i < assetRows.length; i += 500) {
    const { error } = await (db as any).from('package_install_assets').upsert(assetRows.slice(i, i + 500), { onConflict: 'install_id,asset_type,source_id' })
    if (error) throw dbError(error, 'Failed to record installed assets')
  }

  // Data rows.
  const rowResults: any[] = []
  const rowMappings: Record<string, string> = Object.fromEntries(installAssets.filter((row) => row.asset_type === 'data_row').map((row) => [String(row.source_id), String(row.local_id)]))
  for (const entry of data) {
    const localTable = localIdFor('data_tables', entry.table_id)
    if (!localTable || entry.mode === 'skip') { rowResults.push({ ...entry, inserted: 0, updated: 0, deleted: 0, skipped: true }); continue }
    try {
      const written = await writeTableRows({ supabase: db, tenantId: ctx.tenantId, tableId: localTable, rows: contents.data[entry.table_id].rows ?? [], mode: entry.mode, actorId: ctx.actorId, existingMappings: rowMappings })
      const mappingRows = Object.entries(written.mappings).map(([source_id, local_id]) => ({ tenant_id: ctx.tenantId, install_id: saved.id, asset_type: 'data_row', section: 'table_rows', source_id, local_id, name: entry.name, status: 'ok', blocked_by: [] }))
      for (let i = 0; i < mappingRows.length; i += 500) {
        const { error } = await (db as any).from('package_install_assets').upsert(mappingRows.slice(i, i + 500), { onConflict: 'install_id,asset_type,source_id' })
        if (error) throw dbError(error)
      }
      rowResults.push({ ...entry, inserted: written.inserted, updated: written.updated, deleted: written.deleted })
    } catch (error) {
      rowResults.push({ ...entry, inserted: 0, updated: 0, deleted: 0, error: error instanceof Error ? error.message : 'Failed to write rows' })
    }
  }

  // Publish the workflows that are active in the package (now that the map exists).
  const published = await publishWorkflows(actx, activate.filter((sourceId) => !blockedBy.has(`workflows:${sourceId}`)).map((sourceId) => localIdFor('workflows', sourceId)).filter((id): id is string => Boolean(id)), `${header.name} ${header.version}`, warnings)

  await audit(actx, {
    objectType: 'package_install', objectId: saved.id, action: mode === 'install' ? 'create' : 'update',
    summary: `${mode === 'install' ? 'Installed' : mode === 'upgrade' ? `Upgraded ${existing.version} →` : mode === 'downgrade' ? `Downgraded ${existing.version} →` : 'Reinstalled'} package "${header.name}" ${header.version}${status === 'incomplete' ? ' (setup incomplete)' : ''}`,
    metadata: { version: header.version, mode, status, checksum: verification.checksum, signed: verification.signed, fingerprint: verification.fingerprint, unmet: [...unmet] },
  })
  const final: InstallPlanResult = {
    ...result,
    dry_run: false,
    warnings: [...result.warnings],
    install: presentInstall(saved),
    result: { ...(applied.result ?? { created: {}, updated: {}, errors: [], warnings: [] }), rows: rowResults, published },
  }
  const applyErrors = (applied.result?.errors ?? []).length
  const rowErrors = rowResults.filter((r) => r.error).length
  const sum = (key: 'inserted' | 'updated' | 'deleted') => rowResults.reduce((n, r) => n + (Number(r[key]) || 0), 0)
  await recordPackageEvent(ctx, {
    install_id: saved.id,
    package_uid: header.id,
    package_name: header.name,
    package_slug: header.slug,
    action: mode,
    status: applyErrors + rowErrors > 0 ? 'partial' : 'succeeded',
    from_version: existing ? String(existing.version) : null,
    to_version: header.version,
    channel: eventChannel(ctx, input.source),
    source: installRow.source,
    source_label: installRow.source_label,
    signed: verification.signed,
    signature_valid: verification.signature_ok,
    fingerprint: verification.fingerprint,
    trust: verification.trust,
    counts: {
      created: applied.plan.summary.create ?? 0,
      updated: applied.plan.summary.update ?? 0,
      unchanged: applied.plan.summary.unchanged ?? 0,
      skipped: planAssets.filter((a) => a.skipped).length,
      errors: applyErrors + rowErrors,
      rows_inserted: sum('inserted'), rows_updated: sum('updated'), rows_deleted: sum('deleted'),
    },
    requirement_changes: requirementChanges(existing?.requirements, requirementPlans),
    options: installOptions(input),
    plan: { ...final, install: undefined },
    errors: [...(applied.result?.errors ?? []), ...rowResults.filter((r) => r.error).map((r) => ({ asset_type: 'table_rows', name: r.name, error: r.error }))],
    summary: `${mode === 'install' ? 'Installed' : mode === 'upgrade' ? 'Upgraded' : mode === 'downgrade' ? 'Downgraded' : 'Reinstalled'} ${header.name} ${header.version}${status === 'incomplete' ? ' (setup incomplete)' : ''}`,
  })
  return final
}

/** Upgrade (or plan the upgrade of) an existing install; the file must be the same package. */
export async function upgradePackageInstall(ctx: ServiceContext, installId: string, input: PackageInstallInput & { dry_run?: boolean }): Promise<InstallPlanResult> {
  requirePerm(ctx, input.dry_run ? 'packages.view' : 'packages.install')
  const db = await admin(ctx)
  const install = await loadInstall(ctx, db, installId)
  const trace: InstallTrace = { existing: install, mode: 'upgrade' }
  try {
    const read = await readInput(ctx, input)
    if (read.contents.header.id !== install.package_uid) {
      throw ServiceError.validation(`This file is package "${read.contents.header.name}", not the installed "${install.name}"`)
    }
    return await runInstall(ctx, input, Boolean(input.dry_run), read, trace)
  } catch (error) {
    if (!input.dry_run) {
      // A different package's file: the attempt is about this install.
      if (trace.header && trace.header.id !== install.package_uid) { trace.header = undefined; trace.mode = 'upgrade' }
      await recordInstallFailure(ctx, input, trace, error)
    }
    throw error
  }
}

async function publishWorkflows(ctx: ServiceContext, localIds: string[], label: string, warnings: InstallPlanResult['warnings']): Promise<string[]> {
  const published: string[] = []
  if (!localIds.length) return published
  if (!hasPerm(ctx, 'workflows.activate')) {
    warnings.push({ warning: `Workflows were installed inactive: activating them needs 'workflows.activate'` })
    return published
  }
  for (const id of localIds) {
    try {
      await publishWorkflow(ctx, id, `Installed from package ${label}`)
      published.push(id)
    } catch (error) {
      warnings.push({ asset_type: 'workflow', source_id: id, warning: `Not activated: ${error instanceof Error ? error.message : 'publish failed'}` })
    }
  }
  return published
}

// ─── Library ────────────────────────────────────────────────────────────────

function presentInstall(row: any) {
  const requirements = Array.isArray(row.requirements) ? row.requirements : []
  return {
    ...row,
    requirements,
    checklist: requirements.map((req: any) => ({ id: req.id, label: req.label, kind: req.kind, required: req.required, status: req.status ?? 'met' })),
    incomplete_count: requirements.filter((req: any) => req.status === 'missing').length,
  }
}

export async function listPackageInstalls(ctx: ServiceContext, page: Page) {
  requirePerm(ctx, 'packages.view')
  const db = await admin(ctx)
  const { data, error } = await applyPage((db as any).from('package_installs').select(INSTALL_COLUMNS).eq('tenant_id', ctx.tenantId).order('name'), page)
  if (error) throw dbError(error)
  return { installs: ((data ?? []) as any[]).map(presentInstall) }
}

async function loadInstall(ctx: ServiceContext, db: AnySupabaseClient, installId: string) {
  const column = isUuid(installId) ? 'id' : 'slug'
  const { data, error } = await (db as any).from('package_installs').select(INSTALL_COLUMNS).eq('tenant_id', ctx.tenantId).eq(column, installId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Package install not found')
  return data
}

export async function getPackageInstall(ctx: ServiceContext, installId: string) {
  requirePerm(ctx, 'packages.view')
  const db = await admin(ctx)
  const install = await loadInstall(ctx, db, installId)
  const assets = (await loadInstallAssets(db, ctx.tenantId, install.id)).filter((row) => row.asset_type !== 'data_row')
  const { count: rowCount } = await (db as any).from('package_install_assets').select('id', { count: 'exact', head: true }).eq('tenant_id', ctx.tenantId).eq('install_id', install.id).eq('asset_type', 'data_row')
  return { install: presentInstall(install), assets, data_rows: rowCount ?? 0 }
}

// ─── Complete setup ─────────────────────────────────────────────────────────

export interface CompleteInstallInput {
  values?: RequirementValues
  dry_run?: boolean
  /** History: the calling surface when it is the CLI. */
  source?: 'api' | 'cli' | 'mcp'
}

export async function completePackageInstall(ctx: ServiceContext, installId: string, input: CompleteInstallInput = {}) {
  requirePerm(ctx, input.dry_run ? 'packages.view' : 'packages.install')
  const db = await admin(ctx)
  const install = await loadInstall(ctx, db, installId)
  if (input.dry_run) return runComplete(ctx, db, install, input)
  try {
    const done = await runComplete(ctx, db, install, input)
    const errors = ('result' in done ? (done.result as any)?.errors : null) ?? []
    await recordPackageEvent(ctx, {
      install_id: install.id, package_uid: install.package_uid, package_name: install.name, package_slug: install.slug,
      action: 'reconfigure', status: errors.length ? 'partial' : 'succeeded',
      from_version: String(install.version), to_version: String(install.version),
      channel: eventChannel(ctx, input.source), source: install.source, source_label: install.source_label,
      signed: install.signed, signature_valid: install.signature_valid, fingerprint: install.fingerprint, trust: install.manifest?.trust ?? null,
      counts: { updated: done.plan?.summary?.update ?? 0, unchanged: done.plan?.summary?.unchanged ?? 0, errors: errors.length },
      requirement_changes: requirementChanges(install.requirements, done.requirements),
      options: { values_for: Object.keys(input.values ?? {}) },
      plan: { ...done, install: undefined },
      errors,
      summary: `Completed setup of ${install.name} ${install.version}${done.status === 'incomplete' ? ' (still incomplete)' : ''}`,
    })
    return done
  } catch (error) {
    await recordPackageEvent(ctx, {
      install_id: install.id, package_uid: install.package_uid, package_name: install.name, package_slug: install.slug,
      action: 'reconfigure', status: 'failed', from_version: String(install.version), to_version: String(install.version),
      channel: eventChannel(ctx, input.source), source: install.source, source_label: install.source_label,
      options: { values_for: Object.keys(input.values ?? {}) }, error: errorMessage(error, 'Complete setup failed'),
      summary: `Failed to complete setup of ${install.name} ${install.version}`,
    })
    throw error
  }
}

async function runComplete(ctx: ServiceContext, db: AnySupabaseClient, install: any, input: CompleteInstallInput) {
  const actx: ServiceContext = { ...ctx, supabase: db }
  const assets = await loadInstallAssets(db, ctx.tenantId, install.id)
  const bySource = new Map<string, any>(assets.map((row) => [`${row.section}:${row.source_id}`, row]))
  const requirements: PackageRequirement[] = (Array.isArray(install.requirements) ? install.requirements : []).map(({ status: _s, field_states: _f, ...rest }: any) => rest)
  const warnings: InstallPlanResult['warnings'] = []

  // The requirement targets, re-pointed at the local assets.
  const localRequirements: PackageRequirement[] = requirements.flatMap((requirement) => {
    const row = bySource.get(`${requirement.ref.section}:${requirement.ref.asset_id}`)
    if (!row) return []
    return [{
      ...requirement,
      ref: { ...requirement.ref, asset_id: String(row.local_id) },
      fields: requirement.fields.map((field) => {
        const target = bySource.get(`${field.target.section}:${field.target.asset_id}`)
        return { ...field, target: { ...field.target, asset_id: String(target?.local_id ?? field.target.asset_id) } }
      }),
    }]
  })
  const valueKeys = new Map(requirements.map((r) => [r.id, r]))
  for (const id of Object.keys(input.values ?? {})) if (!valueKeys.has(id)) warnings.push({ warning: `Unknown requirement "${id}" (ignored)` })
  const values = mergeValues(install.requirement_values, input.values)
  const touched = assets.filter((row) => localRequirements.some((r) => r.fields.some((f) => f.target.asset_id === String(row.local_id))) && row.asset_type !== 'data_row')
  const localRaw = await localExports(db, ctx.tenantId, touched, true)
  const storedAt = (_requirement: PackageRequirement, field: RequirementField) => {
    const local = localRaw.get(`${field.target.section}:${field.target.asset_id}`)
    let node: any = local
    for (const seg of field.target.path) { if (node === null || typeof node !== 'object') return false; node = node[seg as any] }
    return node !== undefined && node !== null && node !== '' && node !== SECRET_PLACEHOLDER
  }
  const states = requirementStatus(localRequirements, values, storedAt)
  const stateById = new Map(states.map((s) => [s.id, s]))
  const unmet = new Set(states.filter((s) => s.status === 'missing').map((s) => s.id))

  // Manifest of the touched local assets (scrubbed; secrets resolve from the rows), values patched in.
  const localManifest: Record<string, any> = { format_version: 3 }
  const scrubbed = await localExports(db, ctx.tenantId, touched)
  for (const [key, asset] of scrubbed) {
    const section = key.split(':')[0]
    ;(localManifest[section] ??= []).push(structuredClone(asset))
  }
  applyRequirementValues(localManifest, localRequirements, values, await makeResolver(ctx, db, localRequirements, values, warnings))
  for (const requirement of localRequirements) {
    if (unmet.has(requirement.id)) continue
    const flag = ACTIVE_FLAG[requirement.ref.section]
    const asset = (localManifest[requirement.ref.section] ?? []).find((a: any) => String(a.id) === requirement.ref.asset_id)
    if (flag && asset) setAt(asset, [flag], true)
  }
  // Integrations generated by a connector are refreshed through the connector.
  const applied = await applyConfig(actx, { manifest: localManifest, dry_run: Boolean(input.dry_run), source_label: `package:${install.slug}`, record_mappings: false })

  const requirementPlans = requirements.map((requirement) => ({ ...requirement, status: stateById.get(requirement.id)?.status ?? 'met', field_states: stateById.get(requirement.id)?.fields ?? [] }))
  const response = {
    dry_run: Boolean(input.dry_run),
    install_id: install.id,
    requirements: requirementPlans,
    plan: applied.plan,
    warnings: [...warnings, ...applied.warnings],
    status: unmet.size ? 'incomplete' as const : 'complete' as const,
  }
  if (input.dry_run) return response

  // Unblock assets whose requirements are all met now.
  const published: string[] = []
  const activateSources = new Set<string>(Array.isArray(install.manifest?.activate) ? install.manifest.activate.map(String) : [])
  const toPublish: string[] = []
  for (const row of assets) {
    if (row.status !== 'needs_config') continue
    const remaining = (Array.isArray(row.blocked_by) ? row.blocked_by : []).filter((id: string) => unmet.has(id))
    const update: Record<string, unknown> = { blocked_by: remaining, status: remaining.length ? 'needs_config' : 'ok' }
    await (db as any).from('package_install_assets').update(update).eq('id', row.id).eq('tenant_id', ctx.tenantId)
    if (!remaining.length && row.section === 'workflows' && activateSources.has(String(row.source_id))) toPublish.push(String(row.local_id))
    if (!remaining.length && row.section === 'agents' && activateSources.has(String(row.source_id))) {
      await (db as any).from('agents').update({ is_active: true }).eq('id', row.local_id).eq('tenant_id', ctx.tenantId)
    }
  }
  await (db as any).from('package_installs').update({
    status: response.status,
    requirements: requirementPlans,
    requirement_values: nonSecretValues(requirements, values),
  }).eq('id', install.id).eq('tenant_id', ctx.tenantId)
  published.push(...await publishWorkflows(actx, toPublish, `${install.name} ${install.version}`, response.warnings))

  // Refresh content hashes of what was just changed.
  const fresh = await localExports(db, ctx.tenantId, touched)
  for (const row of touched) {
    const local = fresh.get(`${row.section}:${row.local_id}`)
    if (local) await (db as any).from('package_install_assets').update({ content_hash: assetContentHash(local) }).eq('id', row.id).eq('tenant_id', ctx.tenantId)
  }
  await audit(actx, {
    objectType: 'package_install', objectId: install.id, action: 'update',
    summary: `Completed setup of package "${install.name}" ${install.version}${unmet.size ? ` (${unmet.size} still missing)` : ''}`,
    metadata: { met: requirements.length - unmet.size, missing: [...unmet] },
  })
  const { data: saved } = await (db as any).from('package_installs').select(INSTALL_COLUMNS).eq('id', install.id).maybeSingle()
  return { ...response, install: presentInstall(saved ?? install), result: { ...applied.result, published } }
}

// ─── Uninstall ──────────────────────────────────────────────────────────────

export interface UninstallInput {
  dry_run?: boolean
  /** Also remove assets changed here since install. */
  force?: boolean
  /** Also delete data tables that hold rows (and so their rows). */
  delete_data?: boolean
  /** Cancel unfinished runs of the package's workflows first (otherwise they block the uninstall). */
  cancel_runs?: boolean
  /** History: the calling surface when it is the CLI. */
  source?: 'api' | 'cli' | 'mcp'
}

// Workflows before forms before form themes: a form (or theme) still in use is refused by its service.
const UNINSTALL_ORDER = ['workflows', 'agents', 'reports', 'log_destinations', 'forms', 'form_themes', 'decision_tables', 'workflow_activities', 'email_templates', 'mcp_servers', 'roles', 'retention_policies', 'integrations', 'connectors', 'data_tables']
/** The permissions each section's delete needs (as in deleteAsset → the section services). */
export const UNINSTALL_PERMISSIONS: Record<string, string[]> = {
  workflows: ['workflows.delete'], agents: ['agents.delete'], reports: ['reports.delete'], log_destinations: ['observability.view', 'settings.edit'],
  forms: ['forms.delete'], form_themes: ['forms.delete'],
  decision_tables: ['workflows.delete'], workflow_activities: ['extensibility.delete'], email_templates: ['workflows.edit'], mcp_servers: ['settings.edit'],
  roles: ['team.change_roles'], retention_policies: ['settings.edit'], integrations: ['integrations.delete'], connectors: ['integrations.delete'], data_tables: ['data.delete'],
}
const FINISHED_RUN_STATUSES = ['completed', 'failed', 'cancelled', 'canceled']

export interface UninstallPlanEntry {
  section: string
  local_id: string
  name: string | null
  action: 'delete' | 'skip' | 'gone'
  reason?: string
  /** Data tables: rows that are deleted with the table (delete) or that keep it (skip). */
  rows?: number
  /** What goes with it (e.g. an integration's references and objects). */
  note?: string
  locally_modified?: boolean
}

export interface UninstallRun { id: string; workflow_id: string; workflow_name: string | null; status: string; started_at: string | null; title: string | null }

async function planUninstall(ctx: ServiceContext, db: AnySupabaseClient, install: any, input: UninstallInput) {
  const assets = (await loadInstallAssets(db, ctx.tenantId, install.id)).filter((row) => UNINSTALL_ORDER.includes(row.section))
  const current = await localExports(db, ctx.tenantId, assets)
  const plan: UninstallPlanEntry[] = []
  for (const section of UNINSTALL_ORDER) {
    for (const row of assets.filter((a) => a.section === section)) {
      const local = current.get(`${section}:${row.local_id}`)
      const base = { section, local_id: String(row.local_id), name: row.name ?? null }
      if (!local) { plan.push({ ...base, action: 'gone', reason: 'already deleted' }); continue }
      const modified = Boolean(row.content_hash && assetContentHash(local) !== row.content_hash)
      let rows: number | undefined
      if (section === 'data_tables') {
        const { count } = await (db as any).from('custom_table_rows').select('id', { count: 'exact', head: true }).eq('tenant_id', ctx.tenantId).eq('table_id', row.local_id)
        rows = count ?? 0
      }
      const extra = { ...(rows !== undefined ? { rows } : {}), ...(modified ? { locally_modified: true } : {}), ...(section === 'integrations' ? { note: 'its references and objects go with it' } : section === 'connectors' ? { note: 'its generated integration goes with it' } : {}) }
      if (modified && !input.force) { plan.push({ ...base, ...extra, action: 'skip', reason: 'changed in this workspace since install (use force to remove it)' }); continue }
      if (section === 'data_tables' && (rows ?? 0) > 0 && !input.delete_data) {
        plan.push({ ...base, ...extra, action: 'skip', reason: `holds ${rows} row${rows === 1 ? '' : 's'} (use delete_data to remove the table and its rows)` }); continue
      }
      if (section === 'email_templates' && local.is_default) { plan.push({ ...base, ...extra, action: 'skip', reason: 'is the workspace default email template' }); continue }
      plan.push({ ...base, ...extra, action: 'delete' })
    }
  }
  const summary = {
    delete: plan.filter((p) => p.action === 'delete').length,
    skip: plan.filter((p) => p.action === 'skip').length,
    gone: plan.filter((p) => p.action === 'gone').length,
    rows: plan.filter((p) => p.action === 'delete').reduce((n, p) => n + (p.rows ?? 0), 0),
  }

  // Unfinished runs of the workflows that would be deleted (they are deleted with them).
  const workflowIds = plan.filter((p) => p.action === 'delete' && p.section === 'workflows').map((p) => p.local_id)
  const names = new Map(plan.map((p) => [p.local_id, p.name]))
  let activeRuns: UninstallRun[] = []
  let activeRunCount = 0
  if (workflowIds.length) {
    const { data, count, error } = await (db as any).from('workflow_runs').select('id, workflow_id, status, started_at, title', { count: 'exact' })
      .eq('tenant_id', ctx.tenantId).in('workflow_id', workflowIds).not('status', 'in', `(${FINISHED_RUN_STATUSES.join(',')})`)
      .order('started_at', { ascending: false }).limit(200)
    if (error) throw dbError(error)
    activeRuns = (data ?? []).map((r: any) => ({ id: String(r.id), workflow_id: String(r.workflow_id), workflow_name: names.get(String(r.workflow_id)) ?? null, status: String(r.status), started_at: r.started_at ?? null, title: r.title ?? null }))
    activeRunCount = count ?? activeRuns.length
  }

  const needed = new Set(plan.filter((p) => p.action === 'delete').flatMap((p) => UNINSTALL_PERMISSIONS[p.section] ?? []))
  if (activeRunCount && input.cancel_runs) needed.add('workflows.activate')
  const missingPermissions = [...needed].filter((perm) => !hasPerm(ctx, perm))
  const blockers: string[] = []
  if (missingPermissions.length) blockers.push(`Removing these items needs ${missingPermissions.map((p) => `'${p}'`).join(', ')}`)
  if (activeRunCount && !input.cancel_runs) blockers.push(`${activeRunCount} run${activeRunCount === 1 ? ' is' : 's are'} still in progress for the package's workflows (cancel them first, or pass cancel_runs)`)
  return { plan, summary, active_runs: activeRuns, active_run_count: activeRunCount, missing_permissions: missingPermissions, blockers }
}

export async function uninstallPackage(ctx: ServiceContext, installId: string, input: UninstallInput = {}) {
  requirePerm(ctx, input.dry_run ? 'packages.view' : 'packages.install')
  const db = await admin(ctx)
  const actx: ServiceContext = { ...ctx, supabase: db }
  const install = await loadInstall(ctx, db, installId)
  const options = { force: Boolean(input.force), delete_data: Boolean(input.delete_data), cancel_runs: Boolean(input.cancel_runs) }
  const head = { install_id: install.id, name: install.name, slug: install.slug, version: install.version }
  const event = {
    install_id: install.id, package_uid: install.package_uid, package_name: install.name, package_slug: install.slug,
    action: 'uninstall' as PackageEventAction, from_version: String(install.version), to_version: null,
    channel: eventChannel(ctx, input.source), source: install.source, source_label: install.source_label,
    signed: install.signed, signature_valid: install.signature_valid, fingerprint: install.fingerprint, trust: install.manifest?.trust ?? null, options,
  }

  let planned: Awaited<ReturnType<typeof planUninstall>> | null = null
  try {
    planned = await planUninstall(ctx, db, install, input)
    const { plan, summary, blockers } = planned
    if (input.dry_run) return { dry_run: true, ...head, ...planned, errors: [] as Array<{ section: string; local_id: string; name?: string | null; error: string }>, runs_cancelled: 0 }
    if (blockers.length) {
      throw planned.missing_permissions.length
        ? ServiceError.forbidden(`Forbidden: ${blockers[0]}`)
        : ServiceError.conflict(`Cannot uninstall: ${blockers.join('; ')}`)
    }

    // Unfinished runs first: cancelled (closing their open tasks) through the run service.
    const runErrors: Array<{ section: string; local_id: string; error: string }> = []
    let cancelled = 0
    if (planned.active_run_count && input.cancel_runs) {
      const workflowIds = plan.filter((p) => p.action === 'delete' && p.section === 'workflows').map((p) => p.local_id)
      for (let round = 0; round < 50; round += 1) {
        const { data } = await (db as any).from('workflow_runs').select('id, workflow_id')
          .eq('tenant_id', ctx.tenantId).in('workflow_id', workflowIds).not('status', 'in', `(${FINISHED_RUN_STATUSES.join(',')})`).limit(200)
        const batch = ((data ?? []) as any[]).filter((r) => !runErrors.some((e) => e.local_id === String(r.id)))
        if (!batch.length) break
        for (const run of batch) {
          try { await actOnWorkflowRun(actx, { runId: String(run.id) }, { action: 'cancel' }); cancelled += 1 } catch (error) {
            runErrors.push({ section: 'workflow_runs', local_id: String(run.id), error: errorMessage(error, 'cancel failed') })
          }
        }
      }
      if (runErrors.length) throw ServiceError.conflict(`Could not cancel ${runErrors.length} run${runErrors.length === 1 ? '' : 's'}: ${runErrors[0].error}`)
    }

    const errors: Array<{ section: string; local_id: string; name?: string | null; error: string }> = []
    for (const entry of plan.filter((p) => p.action === 'delete')) {
      try {
        await deleteAsset(actx, entry.section, entry.local_id)
      } catch (error) {
        errors.push({ section: entry.section, local_id: entry.local_id, name: entry.name, error: errorMessage(error, 'delete failed') })
      }
    }
    const kept = plan.filter((p) => p.action === 'skip')
    const { error } = await (db as any).from('package_installs').delete().eq('id', install.id).eq('tenant_id', ctx.tenantId)
    if (error) throw dbError(error)
    const removed = summary.delete - errors.length
    await audit(actx, {
      objectType: 'package_install', objectId: install.id, action: 'delete',
      summary: `Uninstalled package "${install.name}" ${install.version}: ${removed} removed, ${kept.length} kept`,
      metadata: { removed, kept: kept.map((k) => `${k.section}:${k.local_id}`), errors: errors.length, ...options, runs_cancelled: cancelled },
    })
    const result = { dry_run: false, ...head, ...planned, errors, runs_cancelled: cancelled }
    await recordPackageEvent(ctx, {
      ...event,
      status: errors.length ? 'partial' : 'succeeded',
      counts: { removed, skipped: kept.length, gone: summary.gone, errors: errors.length, rows_deleted: summary.rows, runs_cancelled: cancelled },
      plan: result,
      errors,
      summary: `Uninstalled ${install.name} ${install.version}: ${removed} removed, ${kept.length} kept${cancelled ? `, ${cancelled} run${cancelled === 1 ? '' : 's'} cancelled` : ''}`,
    })
    return result
  } catch (error) {
    if (!input.dry_run) {
      await recordPackageEvent(ctx, {
        ...event, status: 'failed', plan: planned ? { dry_run: false, ...head, ...planned } : null,
        counts: planned ? { skipped: planned.summary.skip } : {}, error: errorMessage(error, 'Uninstall failed'),
        summary: `Failed to uninstall ${install.name} ${install.version}`,
      })
    }
    throw error
  }
}

async function deleteAsset(ctx: ServiceContext, section: string, id: string) {
  const db = ctx.supabase as any
  const direct = async (table: string) => {
    const { error } = await db.from(table).delete().eq('id', id).eq('tenant_id', ctx.tenantId)
    if (error) throw dbError(error)
  }
  switch (section) {
    case 'workflows': return deleteWorkflow(ctx, id)
    case 'decision_tables': return deleteDecisionTable(ctx, id)
    case 'workflow_activities': return deleteWorkflowActivity(ctx, id)
    case 'email_templates': return deleteEmailTemplate(ctx, id)
    case 'roles': return deleteRole(ctx, id)
    case 'integrations': return deleteIntegration(ctx, id)
    case 'connectors': return deleteConnector(ctx, id)
    case 'data_tables': return deleteDataTable(ctx, id)
    case 'log_destinations': return deleteLogDestination(ctx, id)
    case 'forms': return deleteForm(ctx, id)
    case 'form_themes': return deleteFormTheme(ctx, id)
    case 'agents': requirePerm(ctx, 'agents.delete'); return direct('agents')
    case 'reports': requirePerm(ctx, 'reports.delete'); return direct('reports')
    case 'mcp_servers': requirePerm(ctx, 'settings.edit'); return direct('mcp_servers')
    case 'retention_policies': requirePerm(ctx, 'settings.edit'); return direct('retention_policies')
    default: throw new Error(`Cannot uninstall ${section}`)
  }
}

/** Library summary of a package file against this workspace (inspect + install state). */
export async function inspectAgainstWorkspace(ctx: ServiceContext, input: { file: string }) {
  requirePerm(ctx, 'packages.view')
  const read = await readPackageFile(ctx, decodePackageFile(input.file))
  const db = await admin(ctx)
  const existing = await loadInstallByUid(db, ctx.tenantId, read.contents.header.id).catch(() => null)
  return { ...summarizePackage(read), installed: existing ? { id: existing.id, version: existing.version, status: existing.status } : null }
}

