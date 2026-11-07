/**
 * Idempotency ledger of custom reference writes (Create / Execute with an
 * idempotency key input). Server-only; uses the service role.
 *
 * The first call with a key CLAIMS it (a unique row per tenant, reference
 * and key hash); a retry with the same key — a workflow step retried, a
 * double-clicked button — gets the first call's stored result instead of
 * writing again. A failed call releases its claim so a retry can run.
 * A claim left "running" for more than 5 minutes (a crashed call) can be
 * taken over; results are kept for 24 hours.
 *
 * Until migration 20261216000000 is applied the ledger is unavailable and
 * calls run as before (the key is still sent to the API as a header).
 *
 * Table: public.custom_reference_writes (see the migration).
 */

import { createHash } from 'node:crypto'
import type { ExecuteReferenceResult } from '@/lib/reference-executor'
import { truncateForStorage } from '@/lib/truncate'

/* eslint-disable @typescript-eslint/no-explicit-any -- service client rows */

const TABLE = 'custom_reference_writes'
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000
export const IDEMPOTENCY_STALE_MS = 5 * 60 * 1000

export type ClaimResult =
  | { kind: 'claimed'; id: string }
  | { kind: 'replay'; result: ExecuteReferenceResult }
  | { kind: 'busy' }
  | { kind: 'unavailable' }

export const idempotencyDeps = {
  db: async (): Promise<any> => {
    const { createServiceClient } = await import('@/lib/cron-auth')
    return createServiceClient()
  },
  now: () => Date.now(),
}

export function hashIdempotencyKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

const missingTable = (error: any) => /42P01|PGRST205|does not exist|schema cache/i.test(`${error?.code ?? ''} ${error?.message ?? ''}`)

export async function claimIdempotencyKey(input: { tenantId: string; referenceId: string; key: string }): Promise<ClaimResult> {
  let db: any
  try { db = await idempotencyDeps.db() } catch { return { kind: 'unavailable' } }
  const keyHash = hashIdempotencyKey(input.key)
  const nowIso = new Date(idempotencyDeps.now()).toISOString()
  const { data: inserted, error } = await db.from(TABLE)
    .insert({ tenant_id: input.tenantId, reference_id: input.referenceId, key_hash: keyHash, state: 'running', created_at: nowIso })
    .select('id').maybeSingle()
  if (!error && inserted?.id) return { kind: 'claimed', id: String(inserted.id) }
  if (error && missingTable(error)) return { kind: 'unavailable' }
  if (error && error.code !== '23505') throw new Error(`Idempotency ledger: ${error.message ?? error}`)

  const { data: existing } = await db.from(TABLE)
    .select('id, state, status, response, created_at')
    .eq('tenant_id', input.tenantId).eq('reference_id', input.referenceId).eq('key_hash', keyHash).maybeSingle()
  if (!existing) return { kind: 'busy' }
  const age = idempotencyDeps.now() - Date.parse(existing.created_at)
  if (existing.state === 'succeeded' && age < IDEMPOTENCY_TTL_MS) {
    const response = existing.response ?? {}
    return { kind: 'replay', result: { status: Number(existing.status ?? 200), data: response.data ?? null, ...(response.shaping ? { shaping: response.shaping } : {}) } }
  }
  const takeOver = existing.state === 'succeeded' ? age >= IDEMPOTENCY_TTL_MS : age >= IDEMPOTENCY_STALE_MS
  if (!takeOver) return { kind: 'busy' }
  // Take over an expired result or a stale claim (only if nobody else just did).
  const { data: taken } = await db.from(TABLE)
    .update({ state: 'running', status: null, response: null, created_at: nowIso, finished_at: null })
    .eq('id', existing.id).eq('created_at', existing.created_at)
    .select('id').maybeSingle()
  return taken?.id ? { kind: 'claimed', id: String(taken.id) } : { kind: 'busy' }
}

export async function completeIdempotencyKey(id: string, result: ExecuteReferenceResult): Promise<void> {
  try {
    const db = await idempotencyDeps.db()
    await db.from(TABLE).update({
      state: 'succeeded',
      status: result.status ?? 200,
      response: truncateForStorage({ data: result.data ?? null, ...(result.shaping ? { shaping: result.shaping } : {}) }, 64 * 1024),
      finished_at: new Date(idempotencyDeps.now()).toISOString(),
    }).eq('id', id)
  } catch (error) {
    console.warn('[custom-references] idempotency complete failed:', error)
  }
}

export async function releaseIdempotencyKey(id: string): Promise<void> {
  try {
    const db = await idempotencyDeps.db()
    await db.from(TABLE).delete().eq('id', id).eq('state', 'running')
  } catch (error) {
    console.warn('[custom-references] idempotency release failed:', error)
  }
}
