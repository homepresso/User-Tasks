/**
 * "Agent error" trigger dispatch (server only): when an agent fails for good
 * (lib/agents/error-trigger.ts), queue every active workflow of the
 * workspace that starts on agent_error and whose filters match — the same
 * way the other event triggers start (lib/esign/triggers.ts,
 * lib/extensions/triggers.ts): the workspace's agent_error workflows (the
 * published version's trigger node first) cached for 30 s, then one
 * `enqueue_workflow` job each with the payload as run variables, then a
 * kick of the queue processor. Tenant isolation: only the failing run's own
 * workspace is read and queued (tenant_id on every query and job).
 *
 * Callers: lib/agents/run.ts (workflow agents and agent runs started
 * anywhere), the Run Agent step when the agent can't even start (not
 * configured), lib/assistants/chat.ts and the chat route (the Agent).
 * Fire-and-forget: reportAgentError never throws and never delays the
 * caller's own error handling by more than its queries.
 *
 * Safety
 *  - Loop guard: an event from a run whose variables carry agent_error_depth
 *    (a run this trigger started, or one of its sub-workflows), or from a
 *    workflow that itself starts on agent_error, is not reported.
 *  - De-dupe / burst limit: per trigger workflow, at most `max_per_window`
 *    runs per agent (or Agent profile) and error kind every `window_minutes`
 *    (default 3 per 5 minutes). Skipped events are counted; the next run
 *    that starts gets the count as agent_error_suppressed. Counted in the
 *    configured cache store (lib/providers/cache): shared by every replica
 *    with postgres / redis, per instance with the default memory store.
 *  - Test runs (Save & Test) and evaluations never report.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { kickQueueProcessor } from '@/lib/process-queue'
import { getCacheStore } from '@/lib/providers/cache'
import { createMemoryCacheStore } from '@/lib/providers/cache/memory'
import type { CacheStore } from '@/lib/providers/cache/types'
import {
  AGENT_ERROR_MAX_DEPTH, AGENT_ERROR_TRIGGER, agentErrorKindOf, agentErrorPayload, agentErrorSubject, matchesAgentErrorConfig,
  normalizeAgentErrorConfig, type AgentErrorEvent, type AgentErrorTriggerConfig,
} from './error-trigger'

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow rows */

interface TriggerDef { workflowId: string; versionId: string | null; config: AgentErrorTriggerConfig }

const CACHE_TTL_MS = 30_000
const cache = new Map<string, { expiresAt: number; defs: Promise<TriggerDef[]> }>()

export function invalidateAgentErrorTriggerCache(tenantId?: string) {
  if (tenantId) cache.delete(tenantId)
  else cache.clear()
}

async function loadDefs(db: SupabaseClient, tenantId: string): Promise<TriggerDef[]> {
  const { data: workflows, error } = await (db as any).from('workflows').select('id, nodes, published_version_id')
    .eq('tenant_id', tenantId).eq('is_active', true).eq('trigger_type', AGENT_ERROR_TRIGGER)
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
    const trigger = nodes.find((n) => n?.type === AGENT_ERROR_TRIGGER)
    if (!trigger) continue
    defs.push({ workflowId: String(w.id), versionId: w.published_version_id ?? null, config: normalizeAgentErrorConfig(trigger.config) })
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

/* ── De-dupe ── */

let fallbackStore: CacheStore | null = null
function localStore(): CacheStore {
  return (fallbackStore ??= createMemoryCacheStore())
}

async function storeFor(deps: DispatchDeps): Promise<CacheStore> {
  if (deps.store) return deps.store
  try { return await getCacheStore() } catch { return localStore() }
}

/**
 * Admit one event for a trigger workflow: `{ ok, suppressed }` — ok false
 * when the window is full (the skip is counted); on ok, `suppressed` is how
 * many were skipped since the last admitted one (and the count restarts).
 */
export async function admitAgentError(store: CacheStore, key: string, config: Pick<AgentErrorTriggerConfig, 'max_per_window' | 'window_minutes'>): Promise<{ ok: boolean; suppressed: number }> {
  const windowKey = `agent-error:w:${key}`
  const suppressedKey = `agent-error:s:${key}`
  const hit = await store.hit(windowKey, { max: config.max_per_window, windowMs: config.window_minutes * 60_000 })
  if (!hit.ok) {
    await store.incr(suppressedKey)
    return { ok: false, suppressed: 0 }
  }
  const raw = await store.get(suppressedKey)
  const suppressed = Number(raw) || 0
  if (suppressed) await store.delete(suppressedKey)
  return { ok: true, suppressed }
}

/* ── Dispatch ── */

export interface DispatchDeps {
  /** Injected in tests (default: the configured cache store). */
  store?: CacheStore
  /** Injected in tests (default: kick the workflow queue processor). */
  kick?: () => void
}

export interface DispatchResult { started: number; suppressed: number; skipped?: 'cancelled' | 'loop' | 'test' | 'no_workflows' | 'error' }

async function loopGuarded(db: SupabaseClient, event: AgentErrorEvent): Promise<boolean> {
  if ((Number(event.depth) || 0) >= AGENT_ERROR_MAX_DEPTH) return true
  if (event.source !== 'workflow' || !event.workflowId) return false
  // A workflow that starts on agent_error never reports its own agents (even if the depth variable was cleared).
  const { data } = await (db as any).from('workflows').select('trigger_type, name').eq('id', event.workflowId).eq('tenant_id', event.tenantId).maybeSingle()
  if (data && !event.workflowName) event.workflowName = String(data.name ?? '') || null
  return data?.trigger_type === AGENT_ERROR_TRIGGER
}

/**
 * Report one final agent failure: queue the matching agent_error workflows.
 * Never throws.
 */
export async function reportAgentError(db: SupabaseClient, input: AgentErrorEvent & { test?: boolean }, deps: DispatchDeps = {}): Promise<DispatchResult> {
  try {
    if (!input.tenantId) return { started: 0, suppressed: 0, skipped: 'error' }
    if (!agentErrorKindOf(input.code)) return { started: 0, suppressed: 0, skipped: 'cancelled' }
    if (input.test) return { started: 0, suppressed: 0, skipped: 'test' }
    const event: AgentErrorEvent = { ...input, at: input.at ?? new Date().toISOString() }
    const defs = await defsFor(db, event.tenantId)
    const matching = defs.filter((d) => matchesAgentErrorConfig(d.config, event))
    if (!matching.length) return { started: 0, suppressed: 0, skipped: 'no_workflows' }
    if (await loopGuarded(db, event)) {
      console.warn(`[agent-error] not reported: the agent failed in a run started by an Agent error trigger (loop guard; ${event.source}${event.workflowId ? ` workflow ${event.workflowId}` : ''})`)
      return { started: 0, suppressed: 0, skipped: 'loop' }
    }
    const store = await storeFor(deps)
    const kind = agentErrorKindOf(event.code)!
    const subject = agentErrorSubject(event)
    let started = 0
    let suppressedNow = 0
    for (const d of matching) {
      const key = `${event.tenantId}:${d.workflowId}:${subject}:${kind}`
      let admitted: { ok: boolean; suppressed: number }
      try {
        admitted = await admitAgentError(store, key, d.config)
      } catch {
        admitted = await admitAgentError(localStore(), key, d.config)
      }
      if (!admitted.ok) { suppressedNow++; continue }
      const { error } = await (db as any).rpc('enqueue_workflow', {
        p_workflow_id: d.workflowId,
        p_tenant_id: event.tenantId,
        p_task_id: null,
        p_trigger_type: AGENT_ERROR_TRIGGER,
        p_trigger_data: { _version_id: d.versionId, ...agentErrorPayload(event, admitted.suppressed) },
        p_priority: 0,
        p_delay_seconds: 0,
      })
      if (!error) started++
      else console.warn('[agent-error] enqueue failed:', error.message)
    }
    if (started) (deps.kick ?? kickQueueProcessor)()
    return { started, suppressed: suppressedNow }
  } catch (error) {
    console.warn('[agent-error] could not report the agent failure:', (error as Error)?.message)
    return { started: 0, suppressed: 0, skipped: 'error' }
  }
}
