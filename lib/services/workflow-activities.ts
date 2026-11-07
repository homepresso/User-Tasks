/**
 * Custom workflow actions (Extensibility → Workflow actions; the API and the
 * stored rows still call them "workflow activities"): CRUD, uploads of
 * packaged actions (manifest v1 + one ES module), immutable versions with
 * SHA-256 and signatures, the kill switch, administrator grants (HTTP hosts,
 * data tables, secrets), usages, Test runs and portable export / import.
 * Shared by /api/v1/workflow-activities*, the MCP workflow_activities_*
 * tools, the CLI and the Extensibility server actions.
 *
 * Execution: every action runs in the QuickJS WebAssembly sandbox
 * (lib/custom-actions/sandbox.ts) — never in the app's own JavaScript
 * engine — with only the capabilities its manifest declares and an
 * administrator granted. Operators can switch all execution off with
 * CUSTOM_ACTIONS_DISABLED=true (`code_execution_enabled` in responses).
 * Saving never runs the code (an upload only lists the module's operations).
 *
 * Writes use a service-role client with explicit tenant filters (the tables
 * have no client write grants). Deleting an action a workflow uses is
 * refused with the usages.
 */

import {
  exportWorkflowActivityAsset,
  getWorkflowActivityDisplayName,
  getWorkflowActivityInputDefinitions,
  getWorkflowActivityOutputDefinitions,
  getWorkflowActivityPresentation,
  getWorkflowActivityReadiness,
  getWorkflowActivitySummary,
  normalizeWorkflowActivityManifest,
  parseWorkflowActivityImportPayload,
  slugifyWorkflowActivityKey,
  type PortableWorkflowActivityPayload,
  type WorkflowActivitySourceKind,
  type WorkflowActivityStatus,
} from '@/lib/extensibility'
import { processDeletionQueueBatch } from '@/lib/deletion-queue'
import { compareSemver, isSemver, normalizeHosts } from '@/lib/forms/custom-controls/manifest'
import { sha256Hex } from '@/lib/forms/custom-controls/package'
import { actionManifestOf, isActionManifest, parseActionManifest, ActionManifestError } from '@/lib/custom-actions/manifest'
import { ActionPackageError, parseActionModule, parseActionUpload, probeActionModule, type ParsedActionPackage } from '@/lib/custom-actions/package'
import { ActionRunError, executeStoredAction, type StoredAction } from '@/lib/custom-actions/execute'
import type { ActionLogEntry, ActionManifest } from '@/lib/custom-actions/contract'
import type { DataGrant } from '@/lib/custom-actions/host'
import { hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { applyPage, audit, dbError, ilikeTerm, queueDeletion, queueDeletions, serviceRoleClient, syncChange, type Page } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- manifest / demo inputs are free-form JSON */

export const WORKFLOW_ACTIVITY_STATUSES = ['draft', 'active', 'archived'] as const
export const WORKFLOW_ACTIVITY_SOURCE_KINDS = ['upload', 'inline'] as const

const LIST_COLUMNS = 'id, name, description, key, status, source_kind, version, icon_name, color, manifest, tags, enabled, runtime, approved_hosts, data_grants, sha256, signature, origin, created_at, updated_at'

/** Whether custom action code may run on this server (operator kill switch). */
export function customActivityCodeEnabled(): boolean {
  return process.env.CUSTOM_ACTIONS_DISABLED !== 'true'
}

export interface WorkflowActivityInput {
  name: string
  description?: string | null
  key?: string | null
  status?: WorkflowActivityStatus
  source_kind?: WorkflowActivitySourceKind
  version?: string | null
  icon_name?: string | null
  color?: string | null
  source_code: string
  manifest?: Record<string, any> | null
  demo_inputs?: Record<string, any> | null
  tags?: string[] | null
  source_filename?: string | null
}

export interface WorkflowActivityUpdateInput extends Partial<WorkflowActivityInput> {
  /** Kill switch: false = steps using it fail fast and the palette hides it. */
  enabled?: boolean
  /** HTTP hosts approved (a subset of the manifest's capabilities.http.hosts). */
  approved_hosts?: string[]
  /** Data tables granted: [{ table_id, access: 'read' | 'write' }]. */
  data_grants?: Array<{ table_id: string; access?: 'read' | 'write' }>
}

const ENTRY_POINT = /(?:function\s+(run|execute|handler|main)\b|const\s+(run|execute|handler|main)\s*=|let\s+(run|execute|handler|main)\s*=|var\s+(run|execute|handler|main)\s*=|module\.exports\s*=|exports\.default\s*=|module\.exports\.default\s*=)/
// Legacy activities run as an async function body, so the editor's
// body-style code (`return { outputs }` at the top level) is valid too.
const BODY_RETURN = /(^|[;\n}])\s*return\b/
const MODULE_EXPORT = /export\s+default|export\s*\{[^}]*\bdefault\b/

/** Problems with the source shape. */
export function validateWorkflowActivitySource(sourceCode: string, runtime: 'legacy' | 'module' = 'legacy'): string[] {
  const trimmed = sourceCode.trim()
  if (!trimmed) return ['source_code is required']
  if (runtime === 'module') return MODULE_EXPORT.test(trimmed) ? [] : ['source_code must be an ES module with a default export (export default defineAction({ operations: { … } }))']
  if (!ENTRY_POINT.test(trimmed) && !BODY_RETURN.test(trimmed)) {
    return ['source_code must expose one of run, execute, handler, main, module.exports, or module.exports.default (or return its result from the top level)']
  }
  return []
}

function runtimeOf(row: { runtime?: string | null; manifest?: unknown; source_code?: string | null }): 'legacy' | 'module' {
  if (row.runtime === 'module' || row.runtime === 'legacy') return row.runtime
  return isActionManifest(row.manifest) && MODULE_EXPORT.test(String(row.source_code ?? '')) ? 'module' : 'legacy'
}

/** Activity row → API shape: manifest summary, operations, grants and readiness (never secret values). */
export function summarizeWorkflowActivity(activity: any, extras: { secrets_set?: string[]; versions?: any[] } = {}) {
  const runtime = runtimeOf(activity)
  const action = actionManifestOf(activity)
  const legacyManifest = runtime === 'legacy' ? activity.manifest : { inputs: action.operations[0]?.inputs ?? [], outputs: action.operations[0]?.outputs ?? [], ...action }
  const inputs = getWorkflowActivityInputDefinitions(legacyManifest)
  const outputs = getWorkflowActivityOutputDefinitions(legacyManifest)
  const presentation = getWorkflowActivityPresentation(legacyManifest)
  const readiness = runtime === 'module'
    ? { score: 5, findings: [], ready: true }
    : getWorkflowActivityReadiness({ manifest: activity.manifest, name: activity.name, key: activity.key })
  const caps = action.capabilities ?? {}
  return {
    ...activity,
    runtime,
    enabled: activity.enabled !== false,
    approved_hosts: Array.isArray(activity.approved_hosts) ? activity.approved_hosts : [],
    data_grants: Array.isArray(activity.data_grants) ? activity.data_grants : [],
    action_manifest: action,
    operations: action.operations.map((op) => ({ id: op.id, label: op.label, description: op.description ?? null, input_count: op.inputs.length, output_count: op.outputs.length })),
    capabilities: {
      http_hosts: caps.http?.hosts ?? [],
      data: caps.data ?? null,
      files: Boolean(caps.files),
      secrets: (caps.credentials ?? []).map((s) => ({ ...s, set: (extras.secrets_set ?? []).includes(s.name) })),
    },
    ...(extras.versions ? { versions: extras.versions } : {}),
    manifest_summary: {
      input_count: inputs.length,
      output_count: outputs.length,
      operation_count: action.operations.length,
      display_name: presentation.displayName ?? (runtime === 'module' ? action.name : null),
      purpose: presentation.purpose ?? action.purpose ?? null,
      recommended_for: presentation.recommendedFor ?? action.recommended_for ?? null,
      summary: runtime === 'module' ? (action.summary ?? action.description ?? `${action.operations.length} function${action.operations.length === 1 ? '' : 's'}`) : getWorkflowActivitySummary(activity.manifest),
      setup_notes: presentation.setupNotes.length ? presentation.setupNotes : action.setup_notes ?? [],
      readiness_score: readiness.score,
      readiness_ready: readiness.ready,
      readiness_findings: readiness.findings,
    },
    display_name: runtime === 'module' ? action.name : getWorkflowActivityDisplayName(activity.manifest, activity.name),
    readiness,
    code_execution_enabled: customActivityCodeEnabled(),
  }
}

export type WorkflowActivitySummary = ReturnType<typeof summarizeWorkflowActivity>

/** Readiness guidance lines (shown after a save). */
export function activityGuidance(activity: WorkflowActivitySummary): string[] {
  return activity.readiness.ready
    ? ['Activity metadata is designer-friendly and ready for workflow use.']
    : activity.readiness.findings.map((finding: { message: string }) => finding.message)
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined || value === null) return undefined
  if (!(allowed as readonly unknown[]).includes(value)) throw ServiceError.validation(`${field} must be one of ${allowed.join(', ')}`)
  return value as T
}

/** Normalise and validate a full activity payload (create, import, or a merged update). */
function buildRow(input: WorkflowActivityInput, runtimeHint?: 'legacy' | 'module') {
  const name = String(input.name ?? '').trim()
  if (!name) throw ServiceError.validation('name is required')
  const sourceCode = String(input.source_code ?? '').trim()
  const runtime = runtimeHint ?? (isActionManifest(input.manifest) && MODULE_EXPORT.test(sourceCode) ? 'module' : 'legacy')
  const problems = validateWorkflowActivitySource(sourceCode, runtime)
  if (problems.length) throw ServiceError.validation(problems.join('; '))
  let manifest: Record<string, any>
  let key: string
  let version = String(input.version ?? '').trim() || '1.0.0'
  if (runtime === 'module') {
    let parsed: ActionManifest
    try {
      parsed = parseActionManifest(input.manifest)
    } catch (error) {
      if (error instanceof ActionManifestError) throw ServiceError.validation(`manifest: ${error.message}`)
      throw error
    }
    manifest = parsed as unknown as Record<string, any>
    key = parsed.key
    version = parsed.version
  } else {
    key = slugifyWorkflowActivityKey(String(input.key ?? '').trim() || name)
    manifest = normalizeWorkflowActivityManifest(input.manifest ?? {})
    if (manifest.inputs.length === 0) throw ServiceError.validation('manifest.inputs must include at least one input')
    if (manifest.outputs.length === 0) throw ServiceError.validation('manifest.outputs must include at least one output')
  }
  if (!key) throw ServiceError.validation('A valid activity key is required')
  const demoInputs = input.demo_inputs && typeof input.demo_inputs === 'object' && !Array.isArray(input.demo_inputs) ? input.demo_inputs : {}
  return {
    name,
    description: String(input.description ?? '').trim() || null,
    key,
    status: oneOf(input.status, WORKFLOW_ACTIVITY_STATUSES, 'status') ?? 'draft',
    source_kind: oneOf(input.source_kind, WORKFLOW_ACTIVITY_SOURCE_KINDS, 'source_kind') ?? 'inline',
    version,
    icon_name: String(input.icon_name ?? '').trim() || 'Puzzle',
    color: String(input.color ?? '').trim() || '#0EA5E9',
    source_code: sourceCode,
    manifest,
    demo_inputs: demoInputs,
    tags: (Array.isArray(input.tags) ? input.tags : []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean),
    source_filename: String(input.source_filename ?? '').trim() || null,
    runtime,
    sha256: sha256Hex(sourceCode),
    updated_at: new Date().toISOString(),
  }
}

/** Supabase error → ServiceError (duplicate key → 409). */
function writeError(error: { code?: string; message?: string } | null | undefined, key: string, fallback: string): Error {
  if (error?.code === '23505') return ServiceError.conflict(`A workflow activity with key "${key}" already exists`)
  return dbError(error, fallback)
}

async function loadOwned(db: AnySupabaseClient, ctx: ServiceContext, activityIdOrKey: string, select = '*') {
  const byId = await (db as any).from('custom_workflow_activities').select(select).eq('id', activityIdOrKey).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (byId.error && !/uuid/i.test(byId.error.message ?? '')) throw dbError(byId.error)
  let data = byId.data
  if (!data) {
    const byKey = await (db as any).from('custom_workflow_activities').select(select).eq('key', activityIdOrKey).eq('tenant_id', ctx.tenantId).maybeSingle()
    if (byKey.error) throw dbError(byKey.error)
    data = byKey.data
  }
  if (!data) throw ServiceError.notFound('Workflow activity not found')
  return data as any
}

async function secretNames(db: AnySupabaseClient, tenantId: string, activityId: string): Promise<string[]> {
  const { data, error } = await (db as any).from('custom_workflow_activity_secrets').select('name').eq('tenant_id', tenantId).eq('activity_id', activityId)
  if (error) return []
  return ((data ?? []) as Array<{ name: string }>).map((r) => r.name)
}

async function listVersions(db: AnySupabaseClient, tenantId: string, activityId: string) {
  const { data, error } = await (db as any).from('custom_workflow_activity_versions')
    .select('version, runtime, sha256, size_bytes, origin, signature, created_by, created_at')
    .eq('tenant_id', tenantId).eq('activity_id', activityId)
  if (error) return []
  return ((data ?? []) as any[]).sort((a, b) => (isSemver(a.version) && isSemver(b.version) ? compareSemver(b.version, a.version) : String(b.created_at).localeCompare(String(a.created_at))))
}

/** Record the activity's current code as a version (no-op when that version already holds the same bytes). */
async function recordVersion(db: AnySupabaseClient, ctx: ServiceContext, row: any, origin: string, signature: unknown = null) {
  const { data: existing } = await (db as any).from('custom_workflow_activity_versions').select('sha256')
    .eq('tenant_id', ctx.tenantId).eq('activity_id', row.id).eq('version', row.version).maybeSingle()
  if (existing) return
  const { error } = await (db as any).from('custom_workflow_activity_versions').insert({
    tenant_id: ctx.tenantId, activity_id: row.id, version: row.version, runtime: row.runtime ?? 'legacy', manifest: row.manifest,
    source_code: row.source_code, sha256: row.sha256 ?? sha256Hex(row.source_code ?? ''), size_bytes: Buffer.byteLength(String(row.source_code ?? ''), 'utf8'),
    origin, signature: signature ?? null, created_by: ctx.actorId,
  })
  if (error && error.code !== '23505') throw dbError(error, 'Failed to record the version')
}

/** Next patch version (1.2.3 → 1.2.4); non-semver gets ".1". */
function bumpPatch(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : `${version}.1`
}

export async function listWorkflowActivities(
  ctx: ServiceContext,
  filters: { search?: string; status?: WorkflowActivityStatus; enabled?: boolean } = {},
  page: Page,
) {
  requirePerm(ctx, 'extensibility.view')
  let query = (ctx.supabase as any).from('custom_workflow_activities')
    .select(LIST_COLUMNS, { count: 'exact' })
    .eq('tenant_id', ctx.tenantId)
    .order('updated_at', { ascending: false })
  if (filters.status) query = query.eq('status', oneOf(filters.status, WORKFLOW_ACTIVITY_STATUSES, 'status'))
  if (typeof filters.enabled === 'boolean') query = query.eq('enabled', filters.enabled)
  if (filters.search?.trim()) {
    const term = ilikeTerm(filters.search)
    query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%,key.ilike.%${term}%`)
  }
  const { data, count, error } = await applyPage(query, page)
  if (error) throw dbError(error)
  return {
    workflow_activities: (data ?? []).map((row: any) => summarizeWorkflowActivity(row)) as WorkflowActivitySummary[],
    total: (count ?? (data ?? []).length) as number,
  }
}

/** Full activity (source code, manifest, versions, which secrets are set) with its summary. */
export async function getWorkflowActivity(ctx: ServiceContext, activityId: string) {
  requirePerm(ctx, 'extensibility.view')
  const db = await serviceRoleClient(ctx)
  const row = await loadOwned(db, ctx, activityId)
  return summarizeWorkflowActivity(row, { secrets_set: await secretNames(db, ctx.tenantId, row.id), versions: await listVersions(db, ctx.tenantId, row.id) })
}

async function insertActivity(ctx: ServiceContext, input: WorkflowActivityInput, auditAction: 'create' | 'import', extras: { origin?: string; signature?: unknown; runtime?: 'legacy' | 'module' } = {}) {
  const row = buildRow(input, extras.runtime)
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('custom_workflow_activities').insert({
    ...row,
    enabled: true,
    approved_hosts: [],
    data_grants: [],
    origin: extras.origin ?? (auditAction === 'import' ? 'import' : 'editor'),
    signature: extras.signature ?? null,
    tenant_id: ctx.tenantId,
    created_by: ctx.actorId,
    updated_by: ctx.actorId,
  }).select('*').single()
  if (error || !data) throw writeError(error, row.key, 'Failed to create workflow activity')
  await recordVersion(db, ctx, data, data.origin ?? 'editor', extras.signature)
  await audit(ctx, {
    objectType: 'workflow_activity', objectId: data.id, action: 'create',
    summary: `${auditAction === 'import' ? 'Imported' : 'Created'} workflow activity "${data.name}"`,
    metadata: { ...(auditAction === 'import' ? { imported: true } : {}), version: data.version, sha256: data.sha256 ?? row.sha256, runtime: row.runtime },
  })
  void syncChange(ctx, 'workflow_activity', data)
  return summarizeWorkflowActivity(data)
}

export async function createWorkflowActivity(ctx: ServiceContext, input: WorkflowActivityInput) {
  requirePerm(ctx, 'extensibility.create')
  return insertActivity(ctx, input, 'create')
}

/** Approved hosts must be declared by the manifest. */
function checkHosts(manifest: ActionManifest, hosts: unknown): string[] {
  const normalized = normalizeHosts(hosts)
  const declared = new Set((manifest.capabilities.http?.hosts ?? []).map((h) => h.toLowerCase()))
  const extra = normalized.filter((h) => !declared.has(h))
  if (extra.length) throw ServiceError.validation(`approved_hosts must be hosts the manifest declares (capabilities.http.hosts): ${extra.join(', ')} ${extra.length === 1 ? 'is' : 'are'} not`)
  return normalized
}

/** Granted tables must exist in the workspace; write grants need a manifest that declares data.write. */
async function checkGrants(db: AnySupabaseClient, ctx: ServiceContext, manifest: ActionManifest, grants: unknown): Promise<DataGrant[]> {
  if (!Array.isArray(grants)) throw ServiceError.validation('data_grants must be a list of { table_id, access }')
  if (grants.length && !manifest.capabilities.data) throw ServiceError.validation('This action does not declare data access (capabilities.data)')
  const wanted = grants.map((g: any) => ({ table_id: String(g?.table_id ?? '').trim(), access: g?.access === 'write' ? 'write' as const : 'read' as const })).filter((g) => g.table_id)
  if (wanted.some((g) => g.access === 'write') && !manifest.capabilities.data?.write) throw ServiceError.validation('This action declares read-only data access; grant tables as read')
  if (!wanted.length) return []
  const { data, error } = await (db as any).from('custom_tables').select('id, name').eq('tenant_id', ctx.tenantId).in('id', wanted.map((g) => g.table_id))
  if (error) throw dbError(error)
  const names = new Map(((data ?? []) as any[]).map((t) => [String(t.id), String(t.name)]))
  const missing = wanted.filter((g) => !names.has(g.table_id))
  if (missing.length) throw ServiceError.validation(`Unknown data table: ${missing.map((g) => g.table_id).join(', ')}`)
  const seen = new Set<string>()
  return wanted.filter((g) => (seen.has(g.table_id) ? false : (seen.add(g.table_id), true))).map((g) => ({ ...g, name: names.get(g.table_id) }))
}

/** Partial update: omitted fields keep their stored values. Editing the code of a version that already exists bumps the patch version. */
export async function updateWorkflowActivity(ctx: ServiceContext, activityId: string, input: WorkflowActivityUpdateInput) {
  requirePerm(ctx, 'extensibility.edit')
  const db = await serviceRoleClient(ctx)
  const existing = await loadOwned(db, ctx, activityId)
  const pick = <K extends keyof WorkflowActivityInput>(key: K) => (input[key] !== undefined ? input[key] : existing[key])
  const runtime = runtimeOf(existing)
  const codeTouched = input.source_code !== undefined || input.manifest !== undefined || input.version !== undefined
  const row = buildRow({
    name: pick('name') as string,
    description: pick('description'),
    key: runtime === 'module' ? existing.key : pick('key'),
    status: pick('status'),
    source_kind: pick('source_kind'),
    version: pick('version'),
    icon_name: pick('icon_name'),
    color: pick('color'),
    source_code: pick('source_code') as string,
    manifest: pick('manifest'),
    demo_inputs: pick('demo_inputs'),
    tags: pick('tags'),
    source_filename: pick('source_filename'),
  }, input.source_code !== undefined || input.manifest !== undefined ? undefined : runtime)
  if (runtime === 'module' && row.key !== existing.key) throw ServiceError.validation(`The manifest key "${row.key}" does not match this action ("${existing.key}")`)
  const patch: Record<string, any> = { ...row }
  // Code changed but the version did not: versions are immutable, so the edit becomes the next patch.
  if (codeTouched && row.sha256 !== existing.sha256 && row.version === existing.version) {
    const { data: same } = await (db as any).from('custom_workflow_activity_versions').select('sha256')
      .eq('tenant_id', ctx.tenantId).eq('activity_id', existing.id).eq('version', row.version).maybeSingle()
    if (same && same.sha256 !== row.sha256) {
      if (runtime === 'module' && input.version === undefined && input.manifest !== undefined) {
        throw ServiceError.conflict(`Version ${row.version} of ${row.key} already exists with different code — versions are immutable; bump the version in the manifest`)
      }
      patch.version = bumpPatch(row.version)
      if (runtime === 'module') patch.manifest = { ...row.manifest, version: patch.version }
    }
  }
  const manifestForGrants = actionManifestOf({ ...existing, ...patch })
  if (input.enabled !== undefined) patch.enabled = Boolean(input.enabled)
  if (input.approved_hosts !== undefined) patch.approved_hosts = checkHosts(manifestForGrants, input.approved_hosts)
  if (input.data_grants !== undefined) patch.data_grants = await checkGrants(db, ctx, manifestForGrants, input.data_grants)
  if (!codeTouched) {
    delete patch.sha256
  }
  const { data, error } = await (db as any).from('custom_workflow_activities')
    .update({ ...patch, updated_by: ctx.actorId ?? existing.updated_by ?? null })
    .eq('id', existing.id).eq('tenant_id', ctx.tenantId)
    .select('*').single()
  if (error || !data) throw writeError(error, row.key, 'Failed to update workflow activity')
  if (codeTouched) await recordVersion(db, ctx, data, 'editor')
  await audit(ctx, {
    objectType: 'workflow_activity', objectId: existing.id, action: 'update',
    summary: input.enabled !== undefined && Object.keys(input).length === 1
      ? `${input.enabled ? 'Enabled' : 'Disabled'} workflow action "${data.name}"`
      : `Updated workflow activity "${data.name}"`,
    metadata: {
      fields: Object.keys(input).filter((key) => (input as Record<string, unknown>)[key] !== undefined),
      ...(codeTouched ? { version: data.version, sha256: data.sha256 } : {}),
      ...(input.approved_hosts !== undefined ? { approved_hosts: data.approved_hosts } : {}),
      ...(input.data_grants !== undefined ? { data_grants: (data.data_grants ?? []).map((g: DataGrant) => `${g.name ?? g.table_id}:${g.access}`) } : {}),
    },
  })
  void syncChange(ctx, 'workflow_activity', data)
  return summarizeWorkflowActivity(data, { secrets_set: await secretNames(db, ctx.tenantId, data.id) })
}

// ── usages ─────────────────────────────────────────────────────────────────

export interface WorkflowActivityUsage {
  kind: 'workflow'
  id: string
  name: string
  where: 'draft' | 'published'
  node_label: string
  operation: string | null
  version: string | null
}

function nodeUses(node: any, activity: { id: string; key: string }): boolean {
  if (node?.type !== 'custom_activity') return false
  const c = node.config ?? {}
  return c.custom_activity_id === activity.id || (Boolean(activity.key) && c.custom_activity_key === activity.key)
}

/** Workflows (drafts and active published versions) with a step that runs the action. */
export async function activityUsages(db: AnySupabaseClient, tenantId: string, activity: { id: string; key: string }): Promise<WorkflowActivityUsage[]> {
  const out: WorkflowActivityUsage[] = []
  const { data: deleting } = await (db as any).from('deletion_queue').select('target_id')
    .eq('tenant_id', tenantId).eq('target_type', 'workflow').in('status', ['pending', 'processing', 'failed'])
  const gone = new Set(((deleting ?? []) as any[]).map((r) => String(r.target_id)))
  const { data: workflows, error } = await (db as any).from('workflows').select('id, name, nodes').eq('tenant_id', tenantId).limit(5000)
  if (error) throw dbError(error)
  const names = new Map<string, string>()
  for (const wf of (workflows ?? []) as any[]) {
    if (gone.has(String(wf.id))) continue
    names.set(wf.id, wf.name)
    for (const node of (Array.isArray(wf.nodes) ? wf.nodes : []) as any[]) {
      if (nodeUses(node, activity)) out.push({ kind: 'workflow', id: wf.id, name: wf.name, where: 'draft', node_label: String(node.label ?? node.id), operation: node.config?.operation ?? null, version: node.config?.custom_activity_version ?? null })
    }
  }
  const { data: versions } = await (db as any).from('workflow_versions').select('workflow_id, nodes').eq('tenant_id', tenantId).eq('is_active', true).limit(5000)
  for (const v of (versions ?? []) as any[]) {
    if (gone.has(String(v.workflow_id))) continue
    for (const node of (Array.isArray(v.nodes) ? v.nodes : []) as any[]) {
      if (nodeUses(node, activity)) out.push({ kind: 'workflow', id: v.workflow_id, name: names.get(v.workflow_id) ?? 'Workflow', where: 'published', node_label: String(node.label ?? node.id), operation: node.config?.operation ?? null, version: node.config?.custom_activity_version ?? null })
    }
  }
  return out
}

export async function getWorkflowActivityUsages(ctx: ServiceContext, activityId: string): Promise<WorkflowActivityUsage[]> {
  requirePerm(ctx, 'extensibility.view')
  const db = await serviceRoleClient(ctx)
  const row = await loadOwned(db, ctx, activityId, 'id, key')
  return activityUsages(db, ctx.tenantId, row)
}

function inUseError(name: string, usages: WorkflowActivityUsage[]): ServiceError {
  const list = usages.slice(0, 10).map((u) => `"${u.name}" › ${u.node_label} (${u.where})`).join('; ')
  return new ServiceError('conflict', `"${name}" is used by ${usages.length} workflow step${usages.length === 1 ? '' : 's'}: ${list}${usages.length > 10 ? ` and ${usages.length - 10} more` : ''}. Remove it from those workflows first (or disable it).`, { details: { usages } })
}

/**
 * Queue the activity for deletion (deletion queue, audit, sync). Refused
 * while a workflow uses it. By default the queue is drained inline so the
 * row — and its key — are gone on return.
 */
export async function deleteWorkflowActivity(ctx: ServiceContext, activityId: string, options: { processInline?: boolean } = {}) {
  requirePerm(ctx, 'extensibility.delete')
  const db = await serviceRoleClient(ctx)
  const existing = await loadOwned(db, ctx, activityId, 'id, name, key')
  const usages = await activityUsages(db, ctx.tenantId, existing)
  if (usages.length) throw inUseError(existing.name, usages)
  await queueDeletion(ctx, 'workflow_activity', existing.id, { name: existing.name ?? null })
  await audit(ctx, {
    objectType: 'workflow_activity', objectId: existing.id, action: 'delete',
    summary: `Queued deletion for workflow activity "${existing.name}"`,
  })
  void syncChange(ctx, 'workflow_activity', existing, 'delete')
  if (options.processInline !== false) await processDeletionQueueBatch({ batchSize: 10 })
  return { deleted: true as const, id: existing.id }
}

/** Delete several activities (ids outside the tenant are ignored; ones in use are skipped and reported). */
export async function bulkDeleteWorkflowActivities(ctx: ServiceContext, activityIds: string[]) {
  requirePerm(ctx, 'extensibility.delete')
  if (activityIds.length === 0) return { deleted: 0, ids: [] as string[] }
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('custom_workflow_activities')
    .select('id, name, key').eq('tenant_id', ctx.tenantId).in('id', activityIds)
  if (error) throw dbError(error)
  const rows: Array<{ id: string; name: string | null; key: string }> = []
  const skipped: Array<{ id: string; name: string | null; usages: number }> = []
  for (const row of (data ?? []) as Array<{ id: string; name: string | null; key: string }>) {
    const usages = await activityUsages(db, ctx.tenantId, row)
    if (usages.length) skipped.push({ id: row.id, name: row.name, usages: usages.length })
    else rows.push(row)
  }
  if (rows.length) await queueDeletions(ctx, 'workflow_activity', rows.map((row) => ({ id: row.id, payload: { name: row.name ?? null } })))
  for (const existing of rows) {
    await audit(ctx, {
      objectType: 'workflow_activity', objectId: existing.id, action: 'delete',
      summary: `Queued deletion for workflow activity "${existing.name}"`,
    })
    void syncChange(ctx, 'workflow_activity', existing, 'delete')
  }
  return { deleted: rows.length, ids: rows.map((row) => row.id), ...(skipped.length ? { skipped } : {}) }
}

// ── uploads (packaged actions) ─────────────────────────────────────────────

export interface ActionUploadResult {
  workflow_activity: WorkflowActivitySummary
  version: string
  outcome: 'created' | 'version' | 'unchanged'
  warnings: string[]
}

function packageError(error: unknown): never {
  if (error instanceof ActionPackageError || error instanceof ActionManifestError) throw ServiceError.validation(error.message)
  throw error
}

/**
 * Store a parsed package: a new action, or a new version of the action with
 * the same key (the current one when it is the newest). Re-uploading
 * identical bytes is a no-op; different bytes for an existing version are
 * refused (immutable versions).
 */
export async function storeActionPackage(ctx: ServiceContext, parsed: ParsedActionPackage, origin: 'upload' | 'import' | 'package' = 'upload', options: { status?: WorkflowActivityStatus } = {}): Promise<ActionUploadResult> {
  const problems = await probeActionModule(parsed)
  if (problems.length) throw ServiceError.validation(problems.join('; '))
  const db = await serviceRoleClient(ctx)
  const { manifest } = parsed
  const { data: existing, error } = await (db as any).from('custom_workflow_activities').select('*').eq('tenant_id', ctx.tenantId).eq('key', manifest.key).maybeSingle()
  if (error) throw dbError(error)
  const row = {
    name: manifest.name,
    description: manifest.description ?? null,
    key: manifest.key,
    source_kind: 'upload' as const,
    version: manifest.version,
    icon_name: manifest.icon ?? 'puzzle',
    color: manifest.color ?? '#0EA5E9',
    source_code: parsed.module,
    manifest,
    demo_inputs: manifest.operations[0]?.sample ?? {},
    tags: manifest.tags ?? [],
    source_filename: manifest.entry ?? 'dist/action.js',
    runtime: 'module' as const,
    sha256: parsed.sha256,
    origin,
    signature: parsed.signature,
  }
  if (!existing) {
    requirePerm(ctx, 'extensibility.create')
    const { data, error: insertError } = await (db as any).from('custom_workflow_activities').insert({
      ...row, status: options.status ?? 'active', enabled: true, approved_hosts: [], data_grants: [],
      tenant_id: ctx.tenantId, created_by: ctx.actorId, updated_by: ctx.actorId,
    }).select('*').single()
    if (insertError || !data) throw writeError(insertError, manifest.key, 'Failed to create the action')
    await recordVersion(db, ctx, data, origin, parsed.signature)
    await audit(ctx, { objectType: 'workflow_activity', objectId: data.id, action: 'create', summary: `Added workflow action ${manifest.key}@${manifest.version} (${origin})`, metadata: { version: manifest.version, sha256: parsed.sha256, origin, signature_verified: parsed.signature?.verified ?? null } })
    void syncChange(ctx, 'workflow_activity', data)
    return { workflow_activity: summarizeWorkflowActivity(data), version: manifest.version, outcome: 'created', warnings: parsed.warnings }
  }
  requirePerm(ctx, 'extensibility.edit')
  const { data: same } = await (db as any).from('custom_workflow_activity_versions').select('sha256')
    .eq('tenant_id', ctx.tenantId).eq('activity_id', existing.id).eq('version', manifest.version).maybeSingle()
  if (same || (existing.version === manifest.version && existing.sha256)) {
    const sha = same?.sha256 ?? existing.sha256
    if (sha === parsed.sha256) return { workflow_activity: summarizeWorkflowActivity(existing), version: manifest.version, outcome: 'unchanged', warnings: parsed.warnings }
    throw ServiceError.conflict(`Version ${manifest.version} of ${manifest.key} already exists with different content — versions are immutable; bump the version in manifest.json`)
  }
  const newest = !isSemver(existing.version) || compareSemver(manifest.version, existing.version) >= 0
  if (!newest) {
    await recordVersion(db, ctx, { id: existing.id, version: manifest.version, runtime: 'module', manifest, source_code: parsed.module, sha256: parsed.sha256 }, origin, parsed.signature)
    await audit(ctx, { objectType: 'workflow_activity', objectId: existing.id, action: 'update', summary: `Added older version ${manifest.key}@${manifest.version} (${origin})`, metadata: { version: manifest.version, sha256: parsed.sha256 } })
    return { workflow_activity: summarizeWorkflowActivity(existing), version: manifest.version, outcome: 'version', warnings: parsed.warnings }
  }
  // Grants for hosts the new version no longer declares are dropped.
  const declared = new Set((manifest.capabilities.http?.hosts ?? []).map((h) => h.toLowerCase()))
  const approved = (Array.isArray(existing.approved_hosts) ? existing.approved_hosts : []).filter((h: string) => declared.has(h.toLowerCase()))
  const grants = manifest.capabilities.data ? (Array.isArray(existing.data_grants) ? existing.data_grants : []).map((g: DataGrant) => (manifest.capabilities.data?.write ? g : { ...g, access: 'read' })) : []
  const { data, error: updateError } = await (db as any).from('custom_workflow_activities')
    .update({ ...row, approved_hosts: approved, data_grants: grants, updated_by: ctx.actorId, updated_at: new Date().toISOString() })
    .eq('id', existing.id).eq('tenant_id', ctx.tenantId).select('*').single()
  if (updateError || !data) throw dbError(updateError, 'Failed to store the version')
  await recordVersion(db, ctx, data, origin, parsed.signature)
  await audit(ctx, { objectType: 'workflow_activity', objectId: data.id, action: 'update', summary: `Added version ${manifest.key}@${manifest.version} (${origin})`, metadata: { version: manifest.version, sha256: parsed.sha256, origin, signature_verified: parsed.signature?.verified ?? null } })
  void syncChange(ctx, 'workflow_activity', data)
  return { workflow_activity: summarizeWorkflowActivity(data), version: manifest.version, outcome: 'version', warnings: parsed.warnings }
}

/** Upload a packaged action: zip bytes, or a module plus its manifest. */
export async function uploadWorkflowAction(ctx: ServiceContext, input: { zip?: Uint8Array | null; module?: string | null; manifest?: unknown; signature?: unknown }): Promise<ActionUploadResult> {
  if (!hasPerm(ctx, 'extensibility.create') && !hasPerm(ctx, 'extensibility.edit')) requirePerm(ctx, 'extensibility.create')
  let parsed: ParsedActionPackage
  try {
    parsed = await parseActionUpload(input)
  } catch (error) {
    packageError(error)
  }
  return storeActionPackage(ctx, parsed, 'upload')
}

/** One stored version (with its module when asked). */
export async function getWorkflowActivityVersion(ctx: ServiceContext, activityId: string, version: string, options: { includeSource?: boolean } = {}) {
  requirePerm(ctx, 'extensibility.view')
  const db = await serviceRoleClient(ctx)
  const row = await loadOwned(db, ctx, activityId, 'id, key, name')
  const { data, error } = await (db as any).from('custom_workflow_activity_versions')
    .select(`version, runtime, manifest, sha256, size_bytes, origin, signature, created_by, created_at${options.includeSource ? ', source_code' : ''}`)
    .eq('tenant_id', ctx.tenantId).eq('activity_id', row.id).eq('version', version).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound(`Version ${version} not found`)
  return { activity_id: row.id, key: row.key, name: row.name, ...data }
}

// ── secrets ────────────────────────────────────────────────────────────────

/**
 * Set (value) or clear (null) the secrets an action declares. Values are
 * encrypted before they are stored and are never returned.
 */
export async function setWorkflowActivitySecrets(ctx: ServiceContext, activityId: string, values: Record<string, string | null>) {
  requirePerm(ctx, 'extensibility.edit')
  const db = await serviceRoleClient(ctx)
  const row = await loadOwned(db, ctx, activityId)
  const manifest = actionManifestOf(row)
  const declared = new Set((manifest.capabilities.credentials ?? []).map((s) => s.name))
  const entries = Object.entries(values ?? {})
  if (!entries.length) throw ServiceError.validation('No secrets given')
  for (const [name] of entries) if (!declared.has(name)) throw ServiceError.validation(`"${name}" is not a secret this action declares (${[...declared].join(', ') || 'none'})`)
  const { encryptSecret, isEncrypted } = await import('@/lib/secret-crypto')
  for (const [name, value] of entries) {
    if (value === null || value === '') {
      await (db as any).from('custom_workflow_activity_secrets').delete().eq('tenant_id', ctx.tenantId).eq('activity_id', row.id).eq('name', name)
      continue
    }
    if (String(value).length > 10_000) throw ServiceError.validation(`${name}: at most 10,000 characters`)
    const sealed = encryptSecret(String(value))
    if (!isEncrypted(sealed)) throw ServiceError.validation('Secrets cannot be stored: this server has no encryption key (ENCRYPTION_KEY or a KMS data key)')
    const { error } = await (db as any).from('custom_workflow_activity_secrets')
      .upsert({ tenant_id: ctx.tenantId, activity_id: row.id, name, value: sealed, updated_by: ctx.actorId, updated_at: new Date().toISOString() }, { onConflict: 'activity_id,name' })
    if (error) throw dbError(error, 'Failed to store the secret')
  }
  await audit(ctx, { objectType: 'workflow_activity', objectId: row.id, action: 'update', summary: `Updated secrets of workflow action "${row.name}"`, metadata: { secrets: entries.map(([name, v]) => `${name}:${v === null || v === '' ? 'cleared' : 'set'}`) } })
  const set = await secretNames(db, ctx.tenantId, row.id)
  return { secrets: (manifest.capabilities.credentials ?? []).map((spec) => ({ name: spec.name, label: spec.label ?? spec.name, set: set.includes(spec.name) })) }
}

// ── test runs ──────────────────────────────────────────────────────────────

export interface ActionTestResult {
  ok: boolean
  operation: string
  version: string
  outputs: Record<string, unknown>
  logs: ActionLogEntry[]
  warnings: string[]
  error: { message: string; code: string; retryable: boolean } | null
  stats: { duration_ms: number; host_calls: number; memory_bytes: number | null } | null
}

/**
 * Run an operation once with the given inputs (default: its sample) — the
 * Test button, POST /workflow-activities/{id}/test, MCP and CLI. Runs with
 * the action's real grants (ctx.run.test is true so the code can tell).
 */
export async function testWorkflowActivity(ctx: ServiceContext, activityId: string, input: { operation?: string | null; inputs?: Record<string, unknown> | null; version?: string | null } = {}): Promise<ActionTestResult> {
  requirePerm(ctx, 'extensibility.edit')
  const db = await serviceRoleClient(ctx)
  const owned = await loadOwned(db, ctx, activityId, 'id, key')
  const { loadStoredAction } = await import('@/lib/custom-actions/execute')
  let action: StoredAction | null
  try {
    action = await loadStoredAction(db, ctx.tenantId, { id: owned.id, version: input.version ?? null })
  } catch (error) {
    if (error instanceof ActionRunError) throw ServiceError.validation(error.message)
    throw error
  }
  if (!action) throw ServiceError.notFound('Workflow activity not found')
  const manifest = actionManifestOf(action)
  const op = input.operation ? manifest.operations.find((o) => o.id === input.operation) : manifest.operations[0]
  if (!op) throw ServiceError.validation(`Unknown operation "${input.operation}" (${manifest.operations.map((o) => o.id).join(', ')})`)
  const sample = op.sample ?? Object.fromEntries(op.inputs.filter((f) => f.example !== undefined).map((f) => [f.name, f.example]))
  const inputs = input.inputs && typeof input.inputs === 'object' ? input.inputs : (runtimeOf(action) === 'legacy' ? ((action as any).demo_inputs ?? sample) : sample)
  await audit(ctx, { objectType: 'workflow_activity', objectId: action.id, action: 'test', summary: `Test run of ${action.key}@${action.version} ${op.id}`, metadata: { operation: op.id, version: action.version } })
  if (!customActivityCodeEnabled()) {
    return { ok: false, operation: op.id, version: action.version, outputs: {}, logs: [], warnings: [], error: { message: 'Custom action execution is switched off on this server (CUSTOM_ACTIONS_DISABLED)', code: 'disabled', retryable: false }, stats: null }
  }
  try {
    const result = await executeStoredAction({
      db, tenantId: ctx.tenantId, action: { ...action, enabled: true }, operation: op.id, inputs, actorId: ctx.actorId,
      run: { id: null, workflow_id: null, step_id: null, test: true },
      legacy: { context: { tenantId: ctx.tenantId, variables: {} }, variables: {} },
    })
    const outputs = result.legacy ? ((result.legacy.raw as any)?.outputs ?? result.outputs) : result.outputs
    return { ok: true, operation: op.id, version: action.version, outputs, logs: result.logs, warnings: result.warnings, error: null, stats: result.stats }
  } catch (error) {
    if (error instanceof ActionRunError) {
      return { ok: false, operation: op.id, version: action.version, outputs: {}, logs: error.logs, warnings: [], error: { message: error.message, code: error.code, retryable: error.retryable }, stats: null }
    }
    throw error
  }
}

// ── export / import ────────────────────────────────────────────────────────

/** Portable JSON export (no ids, tenant data, grants or secrets), accepted by importWorkflowActivity. */
export async function exportWorkflowActivity(ctx: ServiceContext, activityId: string): Promise<PortableWorkflowActivityPayload> {
  requirePerm(ctx, 'extensibility.view')
  const db = await serviceRoleClient(ctx)
  const row = await loadOwned(db, ctx, activityId)
  const payload = exportWorkflowActivityAsset(row)
  return { ...payload, workflow_activity: { ...payload.workflow_activity, runtime: runtimeOf(row), sha256: row.sha256 ?? sha256Hex(String(row.source_code ?? '')) } as any }
}

/**
 * Create an activity from a portable export (JSON text or object; either the
 * `{ asset_type, workflow_activity }` envelope or the bare activity).
 * `publish` makes it active regardless of the exported status. A packaged
 * (module) action is validated like an upload and, when its key exists,
 * becomes a new version.
 */
export async function importWorkflowActivity(
  ctx: ServiceContext,
  source: string | object,
  options: { publish?: boolean } = {},
) {
  requirePerm(ctx, 'extensibility.create')
  const { payload, error } = parseWorkflowActivityImportPayload(typeof source === 'string' ? source : JSON.stringify(source))
  if (error || !payload) throw ServiceError.validation(error ?? 'Invalid import payload')
  if (!String(payload.name ?? '').trim()) throw ServiceError.validation('Imported activity name is required')
  const sourceCode = String(payload.source_code ?? '')
  if (payload.sha256 && payload.sha256 !== sha256Hex(sourceCode.trim()) && payload.sha256 !== sha256Hex(sourceCode)) {
    throw ServiceError.validation('The source code does not match its recorded SHA-256')
  }
  if (payload.runtime === 'module' || (isActionManifest(payload.manifest) && MODULE_EXPORT.test(sourceCode))) {
    let parsed: ParsedActionPackage
    try {
      parsed = parseActionModule(sourceCode, payload.manifest)
    } catch (e) {
      packageError(e)
    }
    const result = await storeActionPackage(ctx, parsed, 'import', { status: options.publish ? 'active' : (payload.status ?? 'active') })
    return result.workflow_activity
  }
  return insertActivity(ctx, {
    name: String(payload.name),
    description: payload.description ?? null,
    key: payload.key ?? null,
    status: options.publish ? 'active' : (payload.status ?? 'draft'),
    source_kind: payload.source_kind ?? 'inline',
    version: payload.version ?? null,
    icon_name: payload.icon_name ?? null,
    color: payload.color ?? null,
    source_code: sourceCode,
    manifest: payload.manifest && typeof payload.manifest === 'object' ? payload.manifest : {},
    demo_inputs: payload.demo_inputs && typeof payload.demo_inputs === 'object' ? payload.demo_inputs : {},
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    source_filename: payload.source_filename ?? null,
  }, 'import')
}

/**
 * After a package install: actions whose code still matches what the
 * package carried record the PACKAGE's verified signature (signer
 * fingerprint, via 'package') — Extensibility shows "Signed package".
 */
export async function recordActionPackageSignatures(
  db: AnySupabaseClient,
  tenantId: string,
  activities: unknown[] | undefined,
  verification: { signed?: boolean; signature_ok?: boolean | null; fingerprint?: string | null },
): Promise<number> {
  if (!verification.signed || verification.signature_ok !== true || !verification.fingerprint || !Array.isArray(activities) || !activities.length) return 0
  let marked = 0
  const signature = { alg: 'ed25519', key_fingerprint: String(verification.fingerprint), verified: true, via: 'package' }
  for (const activity of activities as any[]) {
    const key = typeof activity?.key === 'string' ? activity.key : ''
    const code = typeof activity?.source_code === 'string' ? activity.source_code.trim() : ''
    if (!key || !code) continue
    const sha = sha256Hex(code)
    const { data, error } = await (db as any).from('custom_workflow_activities').update({ signature, origin: 'package' })
      .eq('tenant_id', tenantId).eq('key', key).eq('sha256', sha).select('id')
    if (error) continue
    for (const row of (data ?? []) as any[]) {
      await (db as any).from('custom_workflow_activity_versions').update({ signature, origin: 'package' })
        .eq('tenant_id', tenantId).eq('activity_id', row.id).eq('sha256', sha)
      marked += 1
    }
  }
  return marked
}
