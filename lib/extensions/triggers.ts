/**
 * Generic extension trigger API (extensibility plan §2.2): an extension
 * calls `ctx.workflows.trigger(key, payload, { dedupeKey })` (or core calls
 * startExtensionTrigger) and every active workflow of the workspace whose
 * trigger node is `ext.<id>.<key>` — and whose trigger configuration the
 * extension's `matches()` accepts — is queued with the payload as run
 * variables.
 *
 * Dedupe: with a dedupeKey, the first event for (workspace, trigger, key)
 * claims it in extension_trigger_dedupe; repeats start nothing (pollers and
 * receivers that see the same change twice). Gates: the extension must be
 * usable in the workspace (enabled, licensed, runnable) and the trigger's
 * licence feature allowed.
 *
 * The workflow set is cached per workspace and trigger type for 30 s.
 * Server-only.
 */

import { kickQueueProcessor } from '@/lib/process-queue'
import { getServiceDb } from '@/lib/providers/db'
import { extKey } from './manifest'
import { getExtensionManifest } from './registry'
import { getServerExtension } from './server-registry'
import { extensionAccess, isMissingTable } from './state'

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow rows */

interface TriggerWorkflow { workflowId: string; versionId: string | null; config: Record<string, unknown> }

const TTL_MS = 30_000
const cache = new Map<string, { expiresAt: number; defs: Promise<TriggerWorkflow[]> }>()

export function invalidateExtensionTriggerCache(tenantId?: string) {
  if (!tenantId) return cache.clear()
  for (const key of cache.keys()) if (key.startsWith(`${tenantId}:`)) cache.delete(key)
}

async function loadWorkflows(db: any, tenantId: string, triggerType: string): Promise<TriggerWorkflow[]> {
  const { data, error } = await db.from('workflows').select('id, nodes, published_version_id')
    .eq('tenant_id', tenantId).eq('is_active', true).eq('trigger_type', triggerType)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as any[]
  if (!rows.length) return []
  const versionIds = rows.map((w) => w.published_version_id).filter(Boolean)
  const versionNodes = new Map<string, unknown>()
  if (versionIds.length) {
    const { data: versions } = await db.from('workflow_versions').select('id, nodes').in('id', versionIds)
    for (const v of (versions ?? []) as any[]) versionNodes.set(v.id, v.nodes)
  }
  const out: TriggerWorkflow[] = []
  for (const w of rows) {
    const published = w.published_version_id ? versionNodes.get(w.published_version_id) : undefined
    const nodes = (Array.isArray(published) ? published : Array.isArray(w.nodes) ? w.nodes : []) as any[]
    const trigger = nodes.find((n) => n?.type === triggerType)
    if (!trigger) continue
    out.push({ workflowId: w.id, versionId: w.published_version_id ?? null, config: (trigger.config ?? {}) as Record<string, unknown> })
  }
  return out
}

function workflowsFor(db: any, tenantId: string, triggerType: string): Promise<TriggerWorkflow[]> {
  const key = `${tenantId}:${triggerType}`
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.defs
  const entry = { expiresAt: Date.now() + TTL_MS, defs: loadWorkflows(db, tenantId, triggerType) }
  cache.set(key, entry)
  entry.defs.catch(() => { if (cache.get(key) === entry) cache.delete(key) })
  return entry.defs
}

export interface StartTriggerInput {
  tenantId: string
  extensionId: string
  /** The trigger key (manifest.contributes.triggers[].key). */
  key: string
  payload: Record<string, unknown>
  dedupeKey?: string | null
  /** Injected in tests. */
  db?: any
}

export interface StartTriggerResult { started: number; duplicate: boolean; skipped?: string }

/** Claim a dedupe key; false when it was already seen. */
async function claimDedupe(db: any, tenantId: string, triggerType: string, dedupeKey: string): Promise<boolean> {
  const { data, error } = await db.from('extension_trigger_dedupe')
    .upsert({ tenant_id: tenantId, trigger_type: triggerType, dedupe_key: dedupeKey.slice(0, 500) }, { onConflict: 'tenant_id,trigger_type,dedupe_key', ignoreDuplicates: true })
    .select('dedupe_key')
  if (error) {
    // Without the table, dedupe cannot be guaranteed: refuse rather than double-start.
    if (isMissingTable(error)) throw new Error('Extension triggers need migration 20270112000000_extension_framework (extension_trigger_dedupe)')
    throw new Error(error.message)
  }
  return Array.isArray(data) && data.length > 0
}

export async function startExtensionTrigger(input: StartTriggerInput): Promise<StartTriggerResult> {
  const manifest = getExtensionManifest(input.extensionId)
  const trigger = manifest?.contributes.triggers.find((t) => t.key === input.key)
  if (!manifest || !trigger) throw new Error(`Extension "${input.extensionId}" has no trigger "${input.key}"`)
  const access = await extensionAccess(input.tenantId, input.extensionId, trigger.feature)
  if (!access.usable) return { started: 0, duplicate: false, skipped: access.reason ?? 'not usable' }

  const db = input.db ?? getServiceDb()
  const triggerType = extKey(input.extensionId, input.key)
  if (input.dedupeKey) {
    const fresh = await claimDedupe(db, input.tenantId, triggerType, String(input.dedupeKey))
    if (!fresh) return { started: 0, duplicate: true }
  }
  const workflows = await workflowsFor(db, input.tenantId, triggerType)
  const matches = getServerExtension(input.extensionId)?.triggers?.[input.key]?.matches
  const matching = workflows.filter((w) => {
    if (!matches) return true
    try { return matches(w.config, input.payload) } catch { return false }
  })
  let started = 0
  for (const w of matching) {
    const { error } = await db.rpc('enqueue_workflow', {
      p_workflow_id: w.workflowId,
      p_tenant_id: input.tenantId,
      p_task_id: null,
      p_trigger_type: triggerType,
      p_trigger_data: { _version_id: w.versionId, ...input.payload, _extension: input.extensionId, _extension_trigger: input.key, ...(input.dedupeKey ? { _dedupe_key: input.dedupeKey } : {}) },
      p_priority: 0,
      p_delay_seconds: 0,
    })
    if (!error) started++
    else console.warn(`[ext:${input.extensionId}] enqueue failed:`, error.message)
  }
  if (input.dedupeKey && started) {
    await db.from('extension_trigger_dedupe').update({ started }).eq('tenant_id', input.tenantId).eq('trigger_type', triggerType).eq('dedupe_key', String(input.dedupeKey).slice(0, 500))
  }
  if (started) kickQueueProcessor()
  return { started, duplicate: false }
}

/** Purge dedupe keys older than `days` (run by the extension events job). */
export async function purgeTriggerDedupe(days = 30): Promise<void> {
  const before = new Date(Date.now() - days * 86_400_000).toISOString()
  const { error } = await (getServiceDb() as any).from('extension_trigger_dedupe').delete().lt('created_at', before)
  if (error && !isMissingTable(error)) console.warn('[extensions] dedupe purge failed:', error.message)
}
