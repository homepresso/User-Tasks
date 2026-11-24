/**
 * Published app versions, read side (shared by lib/services/apps.ts, which
 * serves them to an app's audience, and lib/services/app-versions.ts, which
 * writes them). Migration 20270123090000_app_drafts.sql.
 *
 *  - appDraftsAvailable: is public.app_versions there? Before the migration
 *    is applied there are no drafts — every save is live, as before — and
 *    the apps columns it adds are not selected.
 *  - loadPublishedSnapshot: one immutable snapshot (tenant, app, version).
 *    Versions never change, so they are kept in a small in-process cache:
 *    an audience member's page, widget and rule-action reads cost one row
 *    read at most per app version and process.
 *  - loadPublishedSummaries: the Apps menu card fields of many apps' live
 *    versions (no layouts).
 */

import { readSnapshot, readSummary, type AppSnapshot, type SnapshotSummary } from '@/lib/apps/versions'
import type { AnySupabaseClient } from './context'
import { dbError } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- app_versions is not in the generated Database types */

/** PostgREST / Postgres "table or column does not exist" (the drafts migration not applied yet). */
export function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === '42703' || error?.code === 'PGRST204'
    || /Could not find the (table|column)|relation .* does not exist|column .* does not exist/i.test(String(error?.message ?? ''))
}

let availability: { value: boolean; at: number } | null = null

/** For tests: forget the availability check and the snapshot cache. */
export function resetAppDrafts(): void {
  availability = null
  cache.clear()
}

/** Tests can pin the answer (memory stores without the table). */
export function setAppDraftsAvailable(value: boolean | null): void {
  availability = value === null ? null : { value, at: Number.MAX_SAFE_INTEGER / 2 }
}

/**
 * Is the app_versions table there? Remembered once true; a missing table is
 * re-checked after 30 s, so applying the migration takes effect without a
 * redeploy.
 */
export async function appDraftsAvailable(db: AnySupabaseClient): Promise<boolean> {
  if (availability?.value) return true
  if (availability && Date.now() - availability.at < 30_000) return false
  const { error } = await (db as any).from('app_versions').select('id').limit(1)
  if (error && !isMissingRelation(error)) throw dbError(error)
  availability = { value: !error, at: Date.now() }
  return availability.value
}

/* ── Snapshot cache ──────────────────────────────────────────────────── */

const CACHE_MAX = 200
const cache = new Map<string, { snapshot: AppSnapshot; published_at: string }>()

function remember(key: string, value: { snapshot: AppSnapshot; published_at: string }) {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
}

export interface PublishedSnapshot {
  version: number
  snapshot: AppSnapshot
  published_at: string
}

/** One published version of an app (tenant-pinned). Null when that version doesn't exist. */
export async function loadPublishedSnapshot(db: AnySupabaseClient, tenantId: string, appId: string, version: number): Promise<PublishedSnapshot | null> {
  const key = `${tenantId}:${appId}:${version}`
  const hit = cache.get(key)
  if (hit) {
    remember(key, hit)
    return { version, ...hit }
  }
  const { data, error } = await (db as any).from('app_versions').select('version, snapshot, published_at')
    .eq('tenant_id', tenantId).eq('app_id', appId).eq('version', version).maybeSingle()
  if (error) throw dbError(error)
  if (!data) return null
  const value = { snapshot: readSnapshot(data.snapshot), published_at: String(data.published_at ?? '') }
  remember(key, value)
  return { version, ...value }
}

/** The card fields of each app's live version: app id → summary. */
export async function loadPublishedSummaries(db: AnySupabaseClient, tenantId: string, wanted: Array<{ id: string; version: number }>): Promise<Map<string, SnapshotSummary>> {
  const out = new Map<string, SnapshotSummary>()
  if (!wanted.length) return out
  const { data, error } = await (db as any).from('app_versions').select('app_id, version, summary')
    .eq('tenant_id', tenantId).in('app_id', wanted.map((w) => w.id)).in('version', [...new Set(wanted.map((w) => w.version))])
  if (error) throw dbError(error)
  const want = new Map(wanted.map((w) => [w.id, w.version]))
  for (const row of (data ?? []) as any[]) {
    if (want.get(String(row.app_id)) !== Number(row.version)) continue
    const summary = readSummary(row.summary)
    if (summary) out.set(String(row.app_id), summary)
  }
  return out
}
