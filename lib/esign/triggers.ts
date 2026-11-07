/**
 * "E-signature event" trigger (esign_event): active workflows of the tenant
 * whose trigger listens to an integration (or any e-sign integration) and
 * event type are queued when a verified webhook (or a poll that sees an
 * envelope finish) reports it. The trigger set is cached per tenant for 30 s;
 * workflow publish / activate paths may call invalidateEsignTriggerCache().
 *
 * Run variables: esign_event, esign_provider, esign_integration_id,
 * esign_envelope_id, esign_status, esign_recipient, esign_envelope.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { kickQueueProcessor } from '@/lib/process-queue'
import { ESIGN_TRIGGER_TYPE, type EsignEventType } from './catalog'
import { envelopeOutput, type LoadedEsign } from './service'
import type { EsignEnvelope, EsignWebhookEvent } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow rows */

interface TriggerDef { workflowId: string; versionId: string | null; integrationId: string | null; events: string[] }

const CACHE_TTL_MS = 30_000
const cache = new Map<string, { expiresAt: number; defs: Promise<TriggerDef[]> }>()

export function invalidateEsignTriggerCache(tenantId?: string) {
  if (tenantId) cache.delete(tenantId)
  else cache.clear()
}

/** The trigger node's filters (exported for the engine's trigger check). */
export function esignTriggerFilters(config: Record<string, any> | undefined): { integrationId: string | null; events: string[] } {
  const c = config ?? {}
  return {
    integrationId: typeof c.integration_id === 'string' && c.integration_id.trim() ? c.integration_id.trim() : null,
    events: Array.isArray(c.events) ? c.events.filter((e: unknown): e is string => typeof e === 'string' && e.length > 0) : [],
  }
}

async function loadDefs(db: SupabaseClient, tenantId: string): Promise<TriggerDef[]> {
  const { data: workflows, error } = await (db as any).from('workflows').select('id, nodes, published_version_id')
    .eq('tenant_id', tenantId).eq('is_active', true).eq('trigger_type', ESIGN_TRIGGER_TYPE)
  if (error) throw new Error(error.message)
  const rows = (workflows ?? []) as any[]
  if (!rows.length) return []
  const versionIds = rows.map((w) => w.published_version_id).filter(Boolean)
  const versionNodes = new Map<string, unknown>()
  if (versionIds.length) {
    const { data: versions } = await (db as any).from('workflow_versions').select('id, nodes').in('id', versionIds)
    for (const v of (versions ?? []) as any[]) versionNodes.set(v.id, v.nodes)
  }
  const defs: TriggerDef[] = []
  for (const w of rows) {
    const published = w.published_version_id ? versionNodes.get(w.published_version_id) : undefined
    const nodes = (Array.isArray(published) ? published : Array.isArray(w.nodes) ? w.nodes : []) as any[]
    const trigger = nodes.find((n) => n?.type === ESIGN_TRIGGER_TYPE)
    if (!trigger) continue
    defs.push({ workflowId: w.id, versionId: w.published_version_id ?? null, ...esignTriggerFilters(trigger.config) })
  }
  return defs
}

function defsFor(db: SupabaseClient, tenantId: string): Promise<TriggerDef[]> {
  const hit = cache.get(tenantId)
  if (hit && hit.expiresAt > Date.now()) return hit.defs
  const entry = { expiresAt: Date.now() + CACHE_TTL_MS, defs: loadDefs(db, tenantId) }
  cache.set(tenantId, entry)
  entry.defs.catch(() => { if (cache.get(tenantId) === entry) cache.delete(tenantId) })
  return entry.defs
}

/** Trigger variables for one event. */
export function esignTriggerData(params: { loaded: Pick<LoadedEsign, 'ctx' | 'provider'>; type: EsignEventType; envelopeId: string; envelope: EsignEnvelope | null; recipient?: EsignWebhookEvent['recipient'] }) {
  const recipient = params.recipient?.email || params.recipient?.id
    ? (() => {
      const match = params.envelope?.recipients.find((r) => (params.recipient?.email && r.email.toLowerCase() === params.recipient.email.toLowerCase()) || (params.recipient?.id && r.id === params.recipient.id))
      return match ? { name: match.name, email: match.email, role: match.role, status: match.status, signed_at: match.signed_at } : { name: params.recipient?.name ?? '', email: params.recipient?.email ?? '', role: null, status: null, signed_at: null }
    })()
    : null
  return {
    esign_event: params.type,
    esign_provider: params.loaded.provider,
    esign_integration_id: params.loaded.ctx.integrationId,
    esign_envelope_id: params.envelopeId,
    esign_status: params.envelope?.status ?? null,
    esign_recipient: recipient,
    esign_envelope: params.envelope ? envelopeOutput(params.envelope) : { envelope_id: params.envelopeId },
  }
}

export async function enqueueEsignTriggers(params: { db: SupabaseClient; loaded: LoadedEsign; type: EsignEventType; envelopeId: string; envelope: EsignEnvelope | null; recipient?: EsignWebhookEvent['recipient'] }): Promise<number> {
  const { db, loaded } = params
  let defs: TriggerDef[]
  try {
    defs = await defsFor(db, loaded.ctx.tenantId)
  } catch {
    return 0
  }
  const matching = defs.filter((d) => (!d.integrationId || d.integrationId === loaded.ctx.integrationId) && (!d.events.length || d.events.includes(params.type)))
  if (!matching.length) return 0
  const data = esignTriggerData(params)
  let enqueued = 0
  for (const d of matching) {
    const { error } = await (db as any).rpc('enqueue_workflow', {
      p_workflow_id: d.workflowId,
      p_tenant_id: loaded.ctx.tenantId,
      p_task_id: null,
      p_trigger_type: ESIGN_TRIGGER_TYPE,
      p_trigger_data: { _version_id: d.versionId, ...data },
      p_priority: 0,
      p_delay_seconds: 0,
    })
    if (!error) enqueued++
    else console.warn('[esign-triggers] enqueue failed:', error.message)
  }
  if (enqueued) kickQueueProcessor()
  return enqueued
}
