/**
 * Unified object audit log helper.
 *
 * Every server action that creates, updates, deletes, publishes, or otherwise
 * mutates a first-class entity should call writeAudit() AFTER the mutation
 * succeeds. The call is fire-and-forget (never throws, never blocks) so an
 * audit failure can't break a real mutation.
 *
 * The audit rows drive:
 *   - The global activity feed at /activity
 *   - Per-entity history tabs on detail pages
 *   - Compliance reporting (who changed what, when)
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type AuditObjectType =
  | 'workflow'
  | 'workflow_activity'
  | 'email_template'
  | 'decision_table'
  | 'workflow_run'
  | 'agent'
  | 'agent_run'
  | 'integration'
  | 'integration_reference'
  | 'report'
  | 'data_table'
  | 'team'
  | 'role'
  | 'api_key'
  | 'webhook'
  | 'theme'
  | 'mcp_server'
  | 'github_sync'
  | 'config'
  | 'oauth_client'
  | 'directory_sync'
  | 'log_destination'
  | 'workspace'
  | 'package'
  | 'package_install'
  | 'form'
  | 'form_theme'
  | 'task'
  | 'member'

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'publish'
  | 'unpublish'
  | 'rename'
  | 'move'
  | 'restore'
  | 'duplicate'
  | 'share'
  | 'unshare'
  | 'execute'
  | 'grant'
  | 'revoke'
  | 'toggle'
  | 'apply'

export interface WriteAuditParams {
  supabase: SupabaseClient<any, any, any>
  tenantId: string
  actorId: string | null
  objectType: AuditObjectType
  objectId: string
  action: AuditAction | string
  /** Human-readable one-liner like "Added node 'Send Email'" or "Renamed from Old to New" */
  summary?: string
  /** Shallow diff of fields that mattered. Keep it small — don't dump whole blobs. */
  diff?: Record<string, { before: any; after: any }>
  /** Extra context: actor role snapshot, request ip, user agent, etc. */
  metadata?: Record<string, any>
}

/**
 * Write an audit row. Never throws — errors are logged and swallowed so that
 * an audit write failure can't cascade and break the user's real action.
 */
export async function writeAudit(params: WriteAuditParams): Promise<void> {
  try {
    const { supabase, tenantId, actorId, objectType, objectId, action, summary, diff, metadata } = params
    if (!tenantId || !objectType || !objectId || !action) return

    await (supabase as any).from('object_audit_log').insert({
      tenant_id: tenantId,
      actor_id: actorId,
      object_type: objectType,
      object_id: String(objectId),
      action,
      summary: summary ?? null,
      diff: diff ?? null,
      metadata: metadata ?? null,
    })
  } catch (err) {
    // Swallow — audit writes must never break the real action
    console.warn('[audit-log] writeAudit failed:', err)
  }
}

/**
 * Compute a shallow diff between two objects, restricted to the keys caller
 * cares about. Returns undefined if nothing changed — the caller can pass the
 * result directly to writeAudit().
 */
export function shallowDiff<T extends Record<string, any>>(
  before: T | null | undefined,
  after: T | null | undefined,
  keys: (keyof T)[],
): Record<string, { before: any; after: any }> | undefined {
  const result: Record<string, { before: any; after: any }> = {}
  const b = (before ?? {}) as any
  const a = (after ?? {}) as any
  for (const key of keys) {
    const k = String(key)
    const bv = b[k]
    const av = a[k]
    // Compare as JSON for objects/arrays, direct === for primitives
    const bs = typeof bv === 'object' ? JSON.stringify(bv) : bv
    const as_ = typeof av === 'object' ? JSON.stringify(av) : av
    if (bs !== as_) {
      result[k] = { before: bv ?? null, after: av ?? null }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}
