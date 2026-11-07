/**
 * Run a stored custom workflow action: the one path shared by the workflow
 * engine (custom_activity steps), Extensibility → Test and the API / MCP /
 * CLI test endpoints.
 *
 *   1. Load the action (by id, else key) from the workspace — the code is
 *      ALWAYS read from the library, never from the workflow definition, so
 *      only people with Extensibility rights decide what code runs, and the
 *      kill switch applies everywhere at once. A node may pin a version.
 *   2. Refuse a disabled action (kill switch) or one whose operation is gone.
 *   3. Coerce and check the inputs against the declared types.
 *   4. Run it in the QuickJS sandbox with the host services its manifest
 *      declares, limited to the administrator's grants (hosts, tables,
 *      secrets — decrypted only on request).
 *   5. Check the outputs against the declared types (warnings, kept).
 *
 * Server only.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped */

import { decryptSecret } from '@/lib/secret-crypto'
import { ACTION_LIMITS, type ActionErrorCode, type ActionLogEntry, type ActionManifest, type ActionOperation } from './contract'
import { actionManifestOf, checkActionOutputs, clampLimits, operationOf, prepareActionInputs } from './manifest'
import { createActionHost, type DataGrant } from './host'
import { maxTimeoutMs, runInSandbox } from './sandbox'

export const ACTION_COLUMNS = 'id, tenant_id, name, key, status, enabled, runtime, version, source_code, manifest, demo_inputs, approved_hosts, data_grants, sha256'

export interface StoredAction {
  id: string
  tenant_id?: string
  name: string
  key: string
  status?: string
  enabled?: boolean | null
  runtime?: 'legacy' | 'module' | null
  version: string
  source_code: string
  manifest: unknown
  approved_hosts?: string[] | null
  data_grants?: DataGrant[] | null
  sha256?: string | null
}

export class ActionRunError extends Error {
  constructor(message: string, readonly code: ActionErrorCode, readonly retryable = false, readonly logs: ActionLogEntry[] = []) {
    super(message)
    this.name = 'ActionRunError'
  }
}

export interface ExecuteActionResult {
  outputs: Record<string, unknown>
  logs: ActionLogEntry[]
  warnings: string[]
  operation: ActionOperation
  manifest: ActionManifest
  action: { id: string; key: string; name: string; version: string; sha256: string | null; runtime: 'legacy' | 'module' }
  stats: { duration_ms: number; host_calls: number; memory_bytes: number | null }
  /** Legacy activities: the raw return value and helpers.setVariable writes. */
  legacy?: { raw: unknown; variables: Record<string, unknown> }
}

/** Load an action by id or key (current version, or a pinned one). */
export async function loadStoredAction(db: any, tenantId: string, ref: { id?: string | null; key?: string | null; version?: string | null }): Promise<StoredAction | null> {
  const id = String(ref.id ?? '').trim()
  const key = String(ref.key ?? '').trim()
  let row: StoredAction | null = null
  if (id) {
    // A non-uuid id is a database error ("invalid input syntax"): treated as not found.
    const { data } = await db.from('custom_workflow_activities').select(ACTION_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle()
    row = data ?? null
  }
  if (!row && key) {
    const { data } = await db.from('custom_workflow_activities').select(ACTION_COLUMNS).eq('tenant_id', tenantId).eq('key', key).maybeSingle()
    row = data ?? null
  }
  if (!row) return null
  const pinned = String(ref.version ?? '').trim()
  if (pinned && pinned !== row.version) {
    const { data: version } = await db.from('custom_workflow_activity_versions').select('version, runtime, manifest, source_code, sha256')
      .eq('tenant_id', tenantId).eq('activity_id', row.id).eq('version', pinned).maybeSingle()
    if (!version) throw new ActionRunError(`Version ${pinned} of "${row.name}" is not installed`, 'invalid')
    row = { ...row, version: version.version, runtime: version.runtime, manifest: version.manifest, source_code: version.source_code, sha256: version.sha256 }
  }
  return row
}

/** Declared secret name → stored ciphertext. */
async function loadSecretValues(db: any, tenantId: string, activityId: string): Promise<Record<string, string>> {
  const { data, error } = await db.from('custom_workflow_activity_secrets').select('name, value').eq('tenant_id', tenantId).eq('activity_id', activityId)
  if (error) return {}
  return Object.fromEntries(((data ?? []) as Array<{ name: string; value: string }>).map((r) => [r.name, r.value]))
}

export interface ExecuteActionParams {
  /** Service-role client (grants, secrets, data tables). */
  db: any
  tenantId: string
  action: StoredAction
  operation?: string | null
  /** Resolved (not yet coerced) input values by name. */
  inputs: Record<string, unknown>
  actorId?: string | null
  run?: { id?: string | null; workflow_id?: string | null; step_id?: string | null; test?: boolean }
  /** Per-step override (ms), clamped to the action's limits and the operator ceiling. */
  timeoutMs?: number | null
  /** Legacy activities: context + variables + expression resolver for their helpers. */
  legacy?: { context: Record<string, unknown>; variables: Record<string, unknown>; resolveExpression?: (expression: string) => unknown }
  fetchImpl?: typeof fetch
}

/** Run an action. Throws ActionRunError (with code, retryable and the logs so far) on failure. */
export async function executeStoredAction(params: ExecuteActionParams): Promise<ExecuteActionResult> {
  const { action } = params
  if (process.env.CUSTOM_ACTIONS_DISABLED === 'true') throw new ActionRunError('Custom action execution is switched off on this server (CUSTOM_ACTIONS_DISABLED)', 'disabled')
  if (action.enabled === false) throw new ActionRunError(`The action "${action.name}" is disabled (Extensibility → Workflow actions)`, 'disabled')
  if (action.status === 'archived') throw new ActionRunError(`The action "${action.name}" is archived`, 'disabled')
  const runtime = action.runtime === 'module' ? 'module' : 'legacy'
  const manifest = actionManifestOf(action)
  const operation = operationOf(manifest, params.operation)
  if (!operation) throw new ActionRunError(`The action "${action.name}" has no operation "${String(params.operation)}" (version ${action.version})`, 'invalid')

  const { inputs, errors } = runtime === 'module'
    ? prepareActionInputs(operation, params.inputs)
    : { inputs: params.inputs, errors: [] as string[] }
  if (errors.length) throw new ActionRunError(`Invalid inputs: ${errors.join('; ')}`, 'invalid')

  const limits = clampLimits((manifest as { limits?: unknown }).limits)
  const requested = Number(params.timeoutMs)
  const timeoutMs = Math.min(maxTimeoutMs(), Number.isFinite(requested) && requested > 0 ? Math.min(requested, ACTION_LIMITS.maxTimeoutMs) : limits.timeout_ms)
  const started = Date.now()

  const needsSecrets = (manifest.capabilities?.credentials?.length ?? 0) > 0
  const secretValues = needsSecrets ? await loadSecretValues(params.db, params.tenantId, action.id) : {}
  const host = createActionHost({
    manifest,
    operation,
    inputs,
    grants: {
      approved_hosts: Array.isArray(action.approved_hosts) ? action.approved_hosts : [],
      data_grants: Array.isArray(action.data_grants) ? action.data_grants : [],
      secret_values: secretValues,
    },
    deps: {
      tenantId: params.tenantId,
      supabase: params.db,
      actorId: params.actorId ?? null,
      fetchImpl: params.fetchImpl,
      decrypt: decryptSecret,
    },
    remainingMs: () => Math.max(0, started + timeoutMs - Date.now()),
  })

  const result = await runInSandbox({
    source: action.source_code,
    mode: runtime,
    operation: operation.id,
    inputs,
    timeoutMs,
    memoryMb: limits.memory_mb,
    host,
    run: params.run,
    legacy: runtime === 'legacy' ? params.legacy ?? { context: {}, variables: {} } : undefined,
  })
  if (!result.ok) {
    throw new ActionRunError(result.error?.message ?? 'The action failed', result.error?.code ?? 'action', result.error?.retryable ?? false, result.logs)
  }
  const warnings = runtime === 'module' ? checkActionOutputs(operation, result.outputs) : []
  return {
    outputs: result.outputs,
    logs: result.logs,
    warnings,
    operation,
    manifest,
    action: { id: action.id, key: action.key, name: action.name, version: action.version, sha256: action.sha256 ?? null, runtime },
    stats: result.stats,
    ...(runtime === 'legacy' ? { legacy: { raw: result.raw ?? null, variables: result.variables ?? {} } } : {}),
  }
}
