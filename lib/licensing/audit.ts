/**
 * Licence audit trail.
 *
 * Every licence event is written to `licence_events` (instance level, service
 * role only; migration 20270112000100). Events about one workspace (a denied
 * check, a cloud entitlement granted or revoked) are also written to that
 * workspace's object_audit_log (object_type `licence`), which the event_stream
 * trigger turns into `audit.licence.<action>` events for log export.
 *
 * Denials are rate limited: one per workspace, extension and state per hour
 * (shared through the cache provider), so a busy trigger can't flood the log.
 * Never throws.
 */

export type LicenceEventType =
  | 'installed'
  | 'replaced'
  | 'removed'
  | 'expiring'
  | 'expired'
  | 'denied'
  | 'entitlement_granted'
  | 'entitlement_revoked'

export interface LicenceEvent {
  event: LicenceEventType
  licenceId?: string | null
  extensionId?: string | null
  tenantId?: string | null
  /** A user id (UUID) when a person did it. */
  actorId?: string | null
  /** Free-text actor (CLI user, `api`, `job`). */
  actor?: string | null
  summary: string
  detail?: Record<string, unknown>
}

export const DENIAL_AUDIT_WINDOW_MS = 60 * 60 * 1000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Workspace audit action for each event. */
const ACTION: Record<LicenceEventType, string> = {
  installed: 'create',
  replaced: 'update',
  removed: 'delete',
  expiring: 'update',
  expired: 'update',
  denied: 'denied',
  entitlement_granted: 'grant',
  entitlement_revoked: 'revoke',
}

export async function recordLicenceEvent(e: LicenceEvent): Promise<void> {
  try {
    const { hasServiceDb, getServiceDb } = await import('@/lib/providers/db')
    if (!hasServiceDb()) {
      console.info(`[licensing] ${e.event}: ${e.summary}`)
      return
    }
    const db = getServiceDb()
    const { error } = await db.from('licence_events').insert({
      event: e.event,
      licence_id: e.licenceId ?? null,
      extension_id: e.extensionId ?? null,
      tenant_id: e.tenantId && UUID.test(e.tenantId) ? e.tenantId : null,
      actor_id: e.actorId && UUID.test(e.actorId) ? e.actorId : null,
      actor: e.actor ?? null,
      summary: e.summary.slice(0, 500),
      detail: e.detail ?? {},
    })
    if (error) console.warn(`[licensing] licence_events insert failed (${e.event}): ${error.message}`)
    if (e.tenantId && UUID.test(e.tenantId)) {
      const { writeAudit } = await import('@/lib/audit-log')
      await writeAudit({
        supabase: db as never,
        tenantId: e.tenantId,
        actorId: e.actorId && UUID.test(e.actorId) ? e.actorId : null,
        objectType: 'licence',
        objectId: e.extensionId ?? e.licenceId ?? 'licence',
        action: ACTION[e.event],
        summary: e.summary.slice(0, 500),
        metadata: { event: e.event, licence_id: e.licenceId ?? null, extension_id: e.extensionId ?? null, ...(e.detail ?? {}) },
      })
    }
  } catch (error) {
    console.warn(`[licensing] audit failed (${e.event}): ${(error as Error).message}`)
  }
}

/** True when this denial should be audited now (first in its window). */
export async function shouldAuditDenial(tenantId: string | null, extensionId: string, state: string): Promise<boolean> {
  try {
    const { getCacheStore } = await import('@/lib/providers/cache')
    const store = await getCacheStore()
    return await store.setIfAbsent(`lic:deny:${tenantId ?? 'instance'}:${extensionId}:${state}`, '1', DENIAL_AUDIT_WINDOW_MS)
  } catch {
    return false
  }
}
