/**
 * App drafts in memory stores (lib/services/app-versions.ts): publish every
 * seeded app as version 1 — what migration 20270123090000 does to existing
 * apps — so tests of the audience's view see them.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */
import { buildAppSnapshot, snapshotSummary } from '@/lib/apps/versions'
import { resetAppDrafts } from '@/lib/services/app-published'

export function publishSeededApps(db: { tables: Record<string, any[]> }, stamp = '2026-11-20T10:00:00.000Z'): void {
  resetAppDrafts()
  db.tables.app_versions ??= []
  for (const app of db.tables.apps ?? []) {
    if (app.published_version != null) continue
    const pages = (db.tables.app_pages ?? []).filter((p: any) => p.app_id === app.id)
    const snapshot = buildAppSnapshot(app, pages)
    db.tables.app_versions.push({ id: `v-${app.id}`, tenant_id: app.tenant_id, app_id: app.id, version: 1, snapshot, summary: snapshotSummary(snapshot), note: null, source: 'initial', published_by: null, published_at: stamp })
    Object.assign(app, { published_version: 1, published_at: stamp, published_by: null, has_draft_changes: false, draft_updated_at: null, draft_updated_by: null })
  }
}
