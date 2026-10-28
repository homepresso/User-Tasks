/**
 * Side effects every mutating service performs, bound to a ServiceContext so
 * services don't repeat tenant/actor plumbing. All three are best-effort in
 * the same way as the helpers they wrap: audit and sync capture never throw;
 * queueDeletion throws only when the queue insert itself fails.
 */

import { writeAudit, type AuditAction, type AuditObjectType, type WriteAuditParams } from '@/lib/audit-log'
import { recordAssetChange, type SyncAssetType } from '@/lib/github-sync/enqueue'
import { enqueueDeletionJob, kickDeletionProcessor, type DeletionTargetType } from '@/lib/deletion-queue'
import { getDb, type AnySupabaseClient, type ServiceContext } from './context'

export function audit(ctx: ServiceContext, entry: {
  objectType: AuditObjectType
  objectId: string
  action: AuditAction | string
  summary?: string
  diff?: WriteAuditParams['diff']
  metadata?: WriteAuditParams['metadata']
}): Promise<void> {
  return writeAudit({
    supabase: ctx.supabase,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    ...entry,
    metadata: { via: ctx.source, ...(ctx.jobId ? { job_id: ctx.jobId } : {}), ...entry.metadata },
  })
}

/** Queue a GitHub-sync change for the asset (no-op when sync is off). */
export function syncChange(
  ctx: ServiceContext,
  assetType: SyncAssetType,
  asset: { id: string; name?: string | null },
  action: 'save' | 'delete' = 'save',
): Promise<void> {
  return recordAssetChange({
    supabase: ctx.supabase,
    tenantId: ctx.tenantId,
    assetType,
    assetId: asset.id,
    assetName: asset.name ?? null,
    action,
    actorId: ctx.actorId,
  })
}

/** Enqueue a deferred hard delete and nudge the processor. */
export async function queueDeletion(
  ctx: ServiceContext,
  targetType: DeletionTargetType,
  targetId: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await enqueueDeletionJob(ctx.supabase, {
    tenantId: ctx.tenantId,
    createdBy: ctx.actorId,
    targetType,
    targetId,
    payload,
  })
  kickDeletionProcessor()
}

/**
 * Enqueue deferred hard deletes for many targets — 25 queue inserts at a time
 * instead of one after the other — then nudge the processor once (queueDeletion
 * per item sent one processor request per item).
 */
export async function queueDeletions(
  ctx: ServiceContext,
  targetType: DeletionTargetType,
  items: Array<{ id: string; payload?: Record<string, unknown> }>,
): Promise<void> {
  if (items.length === 0) return
  for (let i = 0; i < items.length; i += 25) {
    await Promise.all(items.slice(i, i + 25).map((item) => enqueueDeletionJob(ctx.supabase, {
      tenantId: ctx.tenantId,
      createdBy: ctx.actorId,
      targetType,
      targetId: item.id,
      payload: item.payload,
    })))
  }
  kickDeletionProcessor()
}

/**
 * Mask credential material for API/MCP responses: every value under a
 * sensitive key, every blocklisted auth field and every `enc:v1:` ciphertext
 * becomes the '__SECRET__' sentinel (same rules as config export). Sending
 * the sentinel back on an update keeps the stored value (see resolveSecretPlaceholders).
 */
export { scrubSecretsForExport as maskSecrets, resolveSecretPlaceholders, SECRET_PLACEHOLDER } from '@/lib/portability/scrub'

export interface PageInput { limit?: number | null; offset?: number | null }
export interface Page { limit: number | null; offset: number }

/** limit/offset with parsePagination semantics: default 50, 1–100, 0 = no limit. */
export function resolvePage(input: PageInput = {}): Page {
  const raw = input.limit ?? 50
  const limit = raw === 0 ? null : Math.min(Math.max(raw, 1), 100)
  return { limit, offset: Math.max(input.offset ?? 0, 0) }
}

/** Apply a Page to a PostgREST query builder. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyPage<T extends { range: (...args: any[]) => T; limit: (n: number) => T }>(query: T, page: Page): T {
  if (page.offset > 0) return query.range(page.offset, page.offset + (page.limit ?? 1000) - 1)
  if (page.limit) return query.limit(page.limit)
  return query
}

/**
 * Make free text safe inside a PostgREST `or=(…ilike…)` filter: escape LIKE
 * wildcards and drop the characters that delimit filter expressions.
 */
export function ilikeTerm(search: string): string {
  return search.trim().replace(/[,()]/g, ' ').replace(/[%_\\]/g, '\\$&')
}

/** Error from a Supabase call → plain Error (apiRoute maps it to a 500, MCP shows the message). */
export function dbError(error: { message?: string } | null | undefined, fallback = 'Database error'): Error {
  return new Error(error?.message || fallback)
}

/**
 * Client for tables with no client grants (event_stream, log_destinations).
 * API and MCP contexts are service-role already; the cookie-bound session
 * client is swapped for a service-role one. Callers filter tenant_id.
 */
export async function serviceRoleClient(ctx: ServiceContext): Promise<AnySupabaseClient> {
  if (ctx.authKind !== 'session') return getDb(ctx)
  // Via lib/cron-auth (which wraps lib/providers/db) so existing mocks apply.
  const { createServiceClient } = await import('@/lib/cron-auth')
  return createServiceClient()
}
