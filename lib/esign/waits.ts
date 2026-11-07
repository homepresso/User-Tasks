/**
 * "Wait for signature" (server only): a workflow run pauses until an
 * envelope completes, is declined, voided or expires — or the step's
 * timeout passes — then resumes with the outcome, the recipients and
 * (optionally) the signed PDF stored as a workflow file.
 *
 *   registerWait()      the engine, when an esign_wait step runs: one row in
 *                       esign_waits, the run pauses on its 'esignwait_…' event.
 *   handleEnvelopeEvent() a verified webhook event (or a poll): the envelope's
 *                       state is read from the PROVIDER (never trusted from the
 *                       payload) and every wait on it in that tenant +
 *                       integration resumes when it is final.
 *   pollDueWaits()      the `esign-poll` tick job: the polling fallback (every
 *                       few minutes without webhooks, a slow safety net with
 *                       them), timeouts, and cancelled runs.
 *
 * The resume goes through the signed workflow resume queue with
 * `_esign_node_output`; the engine records it as the step's output and
 * follows the outgoing edge whose label matches the outcome.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { TERMINAL_STATUSES, type EsignEventType, type WaitOutcome } from './catalog'
import { downloadToStorage, envelopeOutput, loadEsignIntegration, serviceDb, type LoadedEsign } from './service'
import type { EsignEnvelope, EsignWebhookEvent } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- service-role rows */

export const ESIGN_WAIT_EVENT_PREFIX = 'esignwait_'
export const ESIGN_EVENT_MESSAGE = 'This event belongs to a Wait for signature step — it resumes by itself when the envelope completes, is declined, voided or expires'

export function isEsignManagedEvent(eventId: unknown): boolean {
  return typeof eventId === 'string' && eventId.startsWith(ESIGN_WAIT_EVENT_PREFIX)
}

export const DEFAULT_POLL_MINUTES = 5
/** With webhooks configured, polling is only a safety net. */
export const WEBHOOK_SAFETY_POLL_MINUTES = 30
export const DEFAULT_TIMEOUT_DAYS = 30

export interface WaitConfig {
  output_var: string
  download: boolean
  document: string
  file_name?: string
  poll_minutes: number
}

export function outcomeFor(envelope: EsignEnvelope): WaitOutcome | null {
  if (!TERMINAL_STATUSES.has(envelope.status)) return null
  return envelope.status as WaitOutcome
}

export async function registerWait(params: {
  db?: SupabaseClient
  loaded: Pick<LoadedEsign, 'ctx' | 'provider'>
  envelopeId: string
  runId: string
  workflowId?: string | null
  nodeId: string
  nodeLabel?: string | null
  config: WaitConfig
  timeoutDays?: number
}): Promise<string> {
  const db = params.db ?? (await serviceDb())
  const eventId = `${ESIGN_WAIT_EVENT_PREFIX}${crypto.randomUUID().replace(/-/g, '')}`
  const hasWebhooks = Boolean(params.loaded.ctx.integrationConfig?.auth_config?.webhook_secret)
  const pollMinutes = hasWebhooks ? Math.max(params.config.poll_minutes, WEBHOOK_SAFETY_POLL_MINUTES) : params.config.poll_minutes
  const timeoutDays = params.timeoutDays && params.timeoutDays > 0 ? params.timeoutDays : DEFAULT_TIMEOUT_DAYS
  const { error } = await (db as any).from('esign_waits').insert({
    tenant_id: params.loaded.ctx.tenantId,
    integration_id: params.loaded.ctx.integrationId,
    provider: params.loaded.provider,
    envelope_id: params.envelopeId,
    run_id: params.runId,
    workflow_id: params.workflowId ?? null,
    node_id: params.nodeId,
    node_label: params.nodeLabel ?? null,
    event_id: eventId,
    config: { ...params.config, poll_minutes: pollMinutes },
    next_poll_at: new Date(Date.now() + pollMinutes * 60_000).toISOString(),
    deadline_at: new Date(Date.now() + timeoutDays * 86_400_000).toISOString(),
  })
  if (error) throw new Error(`Could not register the signature wait: ${error.message}${/does not exist|schema cache/i.test(error.message) ? ' (apply migration 20261206000000_esign.sql)' : ''}`)
  return eventId
}

/** The step output a wait resumes with (also used when the envelope is already final). */
export async function waitOutput(loaded: Pick<LoadedEsign, 'ctx' | 'adapter'>, envelope: EsignEnvelope, outcome: WaitOutcome, config: Pick<WaitConfig, 'download' | 'document' | 'file_name'>, waitedMs: number) {
  const output: Record<string, any> = envelopeOutput(envelope, { outcome, waited_ms: waitedMs })
  if (outcome === 'completed' && config.download !== false) {
    try {
      const files = await downloadToStorage(loaded, envelope.envelope_id, { kind: config.document || 'combined', fileName: config.file_name })
      output.signed_document = files.file
      output.certificate = files.certificate
      output.files = files.files
      if (files.warnings.length) output.warnings = files.warnings
    } catch (error) {
      // The outcome stands; the step reports the download problem instead of failing the run.
      output.signed_document = null
      output.download_error = String((error as Error)?.message ?? error).slice(0, 500)
    }
  }
  return output
}

async function resumeWait(db: SupabaseClient, wait: any, output: Record<string, unknown>) {
  const { enqueueResume } = await import('@/lib/workflow-resume-queue')
  const { RunNotResumableError } = await import('@/lib/workflow-run-errors')
  try {
    await enqueueResume({ supabase: db, tenantId: wait.tenant_id, eventId: wait.event_id, variables: { _esign_node_output: output } })
    await (db as any).from('esign_waits').update({ status: 'resumed', outcome: output.outcome, resumed_at: new Date().toISOString(), locked_by: null, locked_at: null, updated_at: new Date().toISOString(), error: null })
      .eq('id', wait.id).eq('tenant_id', wait.tenant_id)
  } catch (error) {
    const gone = error instanceof RunNotResumableError
    await (db as any).from('esign_waits').update({
      status: gone ? 'cancelled' : 'waiting',
      error: gone ? 'The workflow run is no longer waiting' : String((error as Error)?.message ?? error).slice(0, 1000),
      next_poll_at: new Date(Date.now() + 60_000).toISOString(),
      locked_by: null, locked_at: null, updated_at: new Date().toISOString(),
    }).eq('id', wait.id).eq('tenant_id', wait.tenant_id)
    if (!gone) throw error
  }
}

/** Finish one wait that this worker holds (status processing). */
async function finishWait(db: SupabaseClient, loaded: LoadedEsign, wait: any, envelope: EsignEnvelope, outcome: WaitOutcome) {
  const waited = Math.max(0, Date.now() - Date.parse(wait.created_at ?? new Date().toISOString()))
  const output = await waitOutput(loaded, envelope, outcome, wait.config ?? {}, waited)
  await resumeWait(db, wait, output)
}

/** Claim a waiting row for this worker (compare-and-set) — false when another worker has it. */
async function claim(db: SupabaseClient, wait: any, worker: string): Promise<boolean> {
  const { data } = await (db as any).from('esign_waits').update({ status: 'processing', locked_by: worker, locked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', wait.id).eq('tenant_id', wait.tenant_id).eq('status', 'waiting').select('id')
  return Boolean(data?.length)
}

/**
 * Resume the waits on one envelope when it is final. `envelope` is the
 * provider's current state (read by the caller). Returns the number resumed.
 */
export async function resolveWaitsForEnvelope(db: SupabaseClient, loaded: LoadedEsign, envelope: EsignEnvelope): Promise<number> {
  const outcome = outcomeFor(envelope)
  const { data: waits } = await (db as any).from('esign_waits').select('*')
    .eq('tenant_id', loaded.ctx.tenantId).eq('integration_id', loaded.ctx.integrationId).eq('envelope_id', envelope.envelope_id).eq('status', 'waiting')
  let resumed = 0
  for (const wait of (waits ?? []) as any[]) {
    if (!outcome) {
      await (db as any).from('esign_waits').update({ last_status: envelope.status, updated_at: new Date().toISOString() }).eq('id', wait.id).eq('tenant_id', wait.tenant_id)
      continue
    }
    const worker = `esign-event-${crypto.randomUUID().slice(0, 8)}`
    if (!(await claim(db, wait, worker))) continue
    await finishWait(db, loaded, wait, envelope, outcome)
    resumed++
  }
  return resumed
}

/* ── Webhook events ────────────────────────────────────────────────── */

export interface EventProcessResult { processed: number; duplicates: number; resumed: number; triggered: number }

async function recordEvent(db: SupabaseClient, loaded: LoadedEsign, key: string, ev: { envelope_id: string; type: string }, source: 'webhook' | 'poll'): Promise<'new' | 'duplicate' | 'unavailable'> {
  const { error } = await (db as any).from('esign_events').insert({
    tenant_id: loaded.ctx.tenantId, integration_id: loaded.ctx.integrationId, provider: loaded.provider,
    dedupe_key: key, envelope_id: ev.envelope_id, event_type: ev.type, source,
  })
  if (!error) return 'new'
  if (error.code === '23505') return 'duplicate'
  if (error.code === '42P01' || /does not exist|schema cache/i.test(String(error.message))) return 'unavailable'
  throw new Error(`Could not record the e-sign event: ${error.message}`)
}

async function forgetEvent(db: SupabaseClient, loaded: LoadedEsign, key: string) {
  await (db as any).from('esign_events').delete().eq('integration_id', loaded.ctx.integrationId).eq('dedupe_key', key).then(() => undefined, () => undefined)
}

const TERMINAL_EVENT: Partial<Record<EsignEventType, true>> = { envelope_completed: true, envelope_declined: true, envelope_voided: true, envelope_expired: true }

/**
 * Process verified webhook events: refuse replays (same delivery key), read
 * the envelope from the provider, resume waits, fire triggers (once per
 * envelope + terminal event, whether a webhook or a poll saw it first).
 */
export async function processEsignEvents(loaded: LoadedEsign, events: EsignWebhookEvent[], opts: { db?: SupabaseClient } = {}): Promise<EventProcessResult> {
  const db = opts.db ?? (await serviceDb())
  const result: EventProcessResult = { processed: 0, duplicates: 0, resumed: 0, triggered: 0 }
  const envelopes = new Map<string, EsignEnvelope | null>()
  for (const ev of events) {
    const seen = await recordEvent(db, loaded, ev.dedupe_key, ev, 'webhook')
    if (seen === 'duplicate') { result.duplicates++; continue }
    try {
      let envelope = envelopes.get(ev.envelope_id)
      if (envelope === undefined) {
        envelope = await loaded.adapter.getEnvelope(loaded.ctx, ev.envelope_id).catch((error) => {
          console.warn(`[esign] could not read ${loaded.provider} envelope after a webhook: ${(error as Error)?.message}`)
          return null
        })
        envelopes.set(ev.envelope_id, envelope)
      }
      if (envelope) result.resumed += await resolveWaitsForEnvelope(db, loaded, envelope)
      result.triggered += await fireTriggerOnce(db, loaded, ev.type, ev.envelope_id, envelope, ev.recipient ?? null, ev.dedupe_key)
      result.processed++
    } catch (error) {
      // Not processed: let the provider's retry try again.
      await forgetEvent(db, loaded, ev.dedupe_key)
      throw error
    }
  }
  return result
}

async function fireTriggerOnce(db: SupabaseClient, loaded: LoadedEsign, type: EsignEventType, envelopeId: string, envelope: EsignEnvelope | null, recipient: EsignWebhookEvent['recipient'], deliveryKey: string): Promise<number> {
  // Terminal events dedupe across webhook + poll; other events per delivery.
  if (TERMINAL_EVENT[type]) {
    const seen = await recordEvent(db, loaded, `trigger:${envelopeId}:${type}`, { envelope_id: envelopeId, type }, 'webhook')
    if (seen === 'duplicate') return 0
  } else if (!deliveryKey) return 0
  const { enqueueEsignTriggers } = await import('./triggers')
  return enqueueEsignTriggers({ db, loaded, type, envelopeId, envelope, recipient })
}

/* ── Polling (esign-poll tick job) ─────────────────────────────────── */

async function runStillWaiting(db: SupabaseClient, wait: any): Promise<boolean> {
  if (!wait.run_id) return true
  const { data: run } = await (db as any).from('workflow_runs').select('status').eq('id', wait.run_id).eq('tenant_id', wait.tenant_id).maybeSingle()
  return Boolean(run && ['waiting_for_event', 'paused', 'running'].includes(String(run.status)))
}

export async function pollDueWaits(options: { db?: SupabaseClient; batchSize?: number; deadline?: number; load?: (db: SupabaseClient, tenantId: string, integrationId: string) => Promise<LoadedEsign> } = {}): Promise<{ claimed: number; resumed: number; errors: number }> {
  const db = options.db ?? (await serviceDb())
  const worker = `esign-poll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data: rows, error } = await (db as any).rpc('claim_due_esign_waits', { p_worker_id: worker, p_limit: Math.min(options.batchSize ?? 10, 50) })
  if (error) {
    if (/does not exist|schema cache|PGRST202/i.test(`${error.code} ${error.message}`)) return { claimed: 0, resumed: 0, errors: 0 }
    throw new Error(error.message)
  }
  let resumed = 0
  let errors = 0
  const contexts = new Map<string, LoadedEsign>()
  for (const wait of (rows ?? []) as any[]) {
    if (options.deadline !== undefined && Date.now() >= options.deadline) {
      await (db as any).from('esign_waits').update({ status: 'waiting', locked_by: null, locked_at: null }).eq('id', wait.id).eq('tenant_id', wait.tenant_id)
      continue
    }
    try {
      if (!(await runStillWaiting(db, wait))) {
        await (db as any).from('esign_waits').update({ status: 'cancelled', error: 'The workflow run is no longer waiting', locked_by: null, locked_at: null, updated_at: new Date().toISOString() }).eq('id', wait.id).eq('tenant_id', wait.tenant_id)
        continue
      }
      const key = `${wait.tenant_id}:${wait.integration_id}`
      let loaded = contexts.get(key)
      if (!loaded) {
        loaded = await (options.load ?? loadEsignIntegration)(db, wait.tenant_id, wait.integration_id)
        contexts.set(key, loaded)
      }
      const envelope = await loaded.adapter.getEnvelope(loaded.ctx, wait.envelope_id)
      const outcome = outcomeFor(envelope)
      if (outcome) {
        await finishWait(db, loaded, wait, envelope, outcome)
        resumed++
        await fireTriggerOnce(db, loaded, `envelope_${outcome}` as EsignEventType, envelope.envelope_id, envelope, null, '').catch(() => 0)
        continue
      }
      if (wait.deadline_at && Date.parse(wait.deadline_at) <= Date.now()) {
        await finishWait(db, loaded, wait, envelope, 'timeout')
        resumed++
        continue
      }
      const minutes = Math.max(1, Number(wait.config?.poll_minutes) || DEFAULT_POLL_MINUTES)
      await (db as any).from('esign_waits').update({
        status: 'waiting', last_status: envelope.status, poll_count: Number(wait.poll_count ?? 0) + 1, error: null,
        next_poll_at: new Date(Date.now() + minutes * 60_000).toISOString(), locked_by: null, locked_at: null, updated_at: new Date().toISOString(),
      }).eq('id', wait.id).eq('tenant_id', wait.tenant_id)
    } catch (err) {
      errors++
      const minutes = Math.max(1, Number(wait.config?.poll_minutes) || DEFAULT_POLL_MINUTES)
      await (db as any).from('esign_waits').update({
        status: 'waiting', error: String((err as Error)?.message ?? err).slice(0, 1000), poll_count: Number(wait.poll_count ?? 0) + 1,
        next_poll_at: new Date(Date.now() + minutes * 60_000).toISOString(), locked_by: null, locked_at: null, updated_at: new Date().toISOString(),
      }).eq('id', wait.id).eq('tenant_id', wait.tenant_id)
    }
  }
  // Delivery keys only need to outlive provider retries.
  if (Math.random() < 0.05) {
    await (db as any).from('esign_events').delete().lt('received_at', new Date(Date.now() - 30 * 86_400_000).toISOString()).then(() => undefined, () => undefined)
  }
  return { claimed: (rows ?? []).length, resumed, errors }
}
