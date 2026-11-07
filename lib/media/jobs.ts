/**
 * Background media jobs (public.media_jobs, migration 20261126000000).
 *
 *   enqueueMediaJob()      the engine, when a media step returns
 *                          MediaBackground: stores the step's resolved
 *                          settings and starts the job right after the
 *                          response (next/server after()); the run pauses on
 *                          the job's event.
 *   processMediaJobBatch() the scheduler tick (`process-media`) and the kick:
 *                          recovers jobs whose worker died, claims due jobs
 *                          and runs them. A job that is waiting for its
 *                          provider (MediaContinue) goes back to pending with
 *                          run_after = the next poll; a finished job resumes
 *                          the run with the step's variables (and
 *                          `_media_node_output`); a failed one resumes it
 *                          with `_media_node_error` so the step fails (or
 *                          continues, per its On error setting).
 *
 * Every job is scoped to its tenant: inputs and credentials are loaded for
 * job.tenant_id only. Media bytes and secrets are never stored in the row.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { MEDIA_LIMITS } from './limits'
import type { MediaJobState } from './handlers'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows */

export const MEDIA_WAIT_EVENT_PREFIX = 'mediawait_'

/** Events a media job owns: they resume by themselves and are never completed from outside. */
export function isMediaManagedEvent(eventId: unknown): boolean {
  return typeof eventId === 'string' && eventId.startsWith(MEDIA_WAIT_EVENT_PREFIX)
}

export const MEDIA_EVENT_MESSAGE = 'This event belongs to a media step running in the background — it resumes by itself when the job finishes'

const STALE_PROCESSING_MS = 15 * 60 * 1000
/** How long one invocation polls a provider before handing back. */
const INVOCATION_POLL_MS = 40_000

export interface EnqueueMediaJobInput {
  supabase: SupabaseClient
  tenantId: string
  runId: string
  workflowId?: string | null
  nodeId: string
  nodeType: string
  nodeLabel?: string | null
  outputPrefix: string
  config: Record<string, unknown>
  state?: MediaJobState
  traceId?: string | null
  /** Tests: do not start the job in-process. */
  start?: boolean
}

/** Queue a step; returns the event id the run waits on. */
export async function enqueueMediaJob(input: EnqueueMediaJobInput): Promise<string> {
  const eventId = `${MEDIA_WAIT_EVENT_PREFIX}${crypto.randomUUID().replace(/-/g, '')}`
  const { error } = await (input.supabase as any).from('media_jobs').insert({
    tenant_id: input.tenantId,
    run_id: input.runId,
    workflow_id: input.workflowId ?? null,
    event_id: eventId,
    node_id: input.nodeId,
    node_type: input.nodeType,
    node_label: input.nodeLabel ?? null,
    output_prefix: input.outputPrefix,
    config: input.config,
    state: input.state ?? {},
    deadline_at: new Date(Date.now() + MEDIA_LIMITS.jobTimeoutMs).toISOString(),
    trace_id: input.traceId ?? null,
  })
  if (error) throw new Error(`Could not queue the media step: ${error.message}`)
  if (input.start !== false) startMediaJobs()
  return eventId
}

/** Run due jobs right after the current response (or unawaited outside a request). */
export function startMediaJobs(): void {
  const run = () => processMediaJobBatch({ batchSize: 2 }).catch((error) => console.error('[media-jobs] run failed:', (error as Error)?.message))
  import('next/server')
    .then(({ after }) => {
      try { after(run) } catch { void run() }
    })
    .catch(() => { void run() })
}

async function resume(supabase: SupabaseClient, tenantId: string, eventId: string, variables: Record<string, unknown>) {
  const { enqueueResume } = await import('@/lib/workflow-resume-queue')
  await enqueueResume({ tenantId, eventId, variables, supabase })
}

async function finish(supabase: SupabaseClient, job: any, patch: Record<string, unknown>) {
  await (supabase as any).from('media_jobs')
    .update({ ...patch, locked_by: null, locked_at: null, updated_at: new Date().toISOString() })
    .eq('id', job.id).eq('tenant_id', job.tenant_id)
}

async function failJob(supabase: SupabaseClient, job: any, message: string) {
  const text = message.slice(0, 2000)
  await finish(supabase, job, { status: 'failed', error: text, completed_at: new Date().toISOString() })
  await cleanupProviderJob(supabase, job).catch(() => {})
  try {
    await resume(supabase, job.tenant_id, job.event_id, { _media_node_error: text })
  } catch (error) {
    console.warn('[media-jobs] could not fail the waiting workflow step:', (error as Error)?.message)
  }
}

/** Delete a provider-side job / staged object (AssemblyAI transcript, S3 object) after a failure. */
async function cleanupProviderJob(supabase: SupabaseClient, job: any) {
  const asyncJob = job.state?.asyncJob
  if (!asyncJob) return
  const integrationId = String(job.config?.integration_id ?? '')
  if (!integrationId) return
  const { loadMediaCredentials } = await import('./credentials')
  const { getMediaProvider } = await import('./providers')
  const { providerContext } = await import('./http')
  const loaded = await loadMediaCredentials(supabase, job.tenant_id, integrationId)
  await getMediaProvider(loaded.credentials.provider).cleanup?.(asyncJob, providerContext(loaded.credentials))
}

/** Run one claimed job. Exported for tests. */
export async function runMediaJob(supabase: SupabaseClient, job: any, options: { deps?: import('./handlers').MediaNodeContext['deps']; now?: () => number; pollBudgetMs?: number } = {}): Promise<{ status: 'completed' | 'pending' | 'failed' | 'cancelled'; error?: string }> {
  const now = options.now ?? Date.now
  if (job.deadline_at && new Date(job.deadline_at).getTime() < now()) {
    await failJob(supabase, job, `The media step did not finish within ${Math.round(MEDIA_LIMITS.jobTimeoutMs / 60_000)} minutes (MEDIA_JOB_TIMEOUT_SECONDS)`)
    return { status: 'failed', error: 'timeout' }
  }
  // The run was cancelled / finished meanwhile: stop (and clean up the provider job).
  if (job.run_id) {
    const { data: run } = await (supabase as any).from('workflow_runs').select('status').eq('id', job.run_id).eq('tenant_id', job.tenant_id).maybeSingle()
    if (!run || !['waiting_for_event', 'paused', 'running'].includes(String(run.status))) {
      await finish(supabase, job, { status: 'cancelled', error: 'The workflow run is no longer waiting', completed_at: new Date().toISOString() })
      await cleanupProviderJob(supabase, job).catch(() => {})
      return { status: 'cancelled' }
    }
  }
  const variables: Record<string, any> = {}
  const prefix = String(job.output_prefix ?? '') || String(job.node_id).slice(0, 8)
  const warnings: string[] = []
  const { runMediaNode, MediaContinue, MediaBackground } = await import('./handlers')
  try {
    const result = await runMediaNode({
      type: job.node_type,
      config: job.config ?? {},
      resolve: (v: unknown) => v,
      supabase,
      tenantId: job.tenant_id,
      variables,
      setVar: (name, value) => { variables[`${prefix}_${name}`] = value; variables[name] = value },
      warn: (m) => { if (warnings.length < 20) warnings.push(m) },
      info: () => {},
      canBackground: false,
      job: { state: (job.state ?? {}) as MediaJobState, deadline: Math.min(now() + (options.pollBudgetMs ?? INVOCATION_POLL_MS), job.deadline_at ? new Date(job.deadline_at).getTime() : Infinity) },
      deps: options.deps,
    })
    if (result instanceof MediaContinue || result instanceof MediaBackground) {
      const state = result.state
      const wait = result instanceof MediaContinue ? result.pollAfterMs : 5_000
      await finish(supabase, job, { status: 'pending', state, attempts: 0, run_after: new Date(now() + Math.max(2_000, wait)).toISOString() })
      return { status: 'pending' }
    }
    const output = { ...result, mode: 'background', ...(warnings.length ? { warnings } : {}) }
    await finish(supabase, job, { status: 'completed', output, completed_at: new Date().toISOString() })
    await resume(supabase, job.tenant_id, job.event_id, { ...variables, _media_node_output: output })
    return { status: 'completed' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await failJob(supabase, job, message)
    return { status: 'failed', error: message }
  }
}

export async function processMediaJobBatch(options: { supabase?: SupabaseClient; batchSize?: number; deadline?: number } = {}): Promise<{ processed: number; results: Array<Record<string, unknown>> }> {
  const supabase = options.supabase ?? (await import('@/lib/cron-auth')).createServiceClient()
  const batchSize = Math.min(options.batchSize ?? 3, 10)
  const workerId = `media-worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const results: Array<Record<string, unknown>> = []

  // Self-heal: a worker died mid-job → retry (max_attempts), then fail the step.
  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MS).toISOString()
  const { data: stale } = await (supabase as any).from('media_jobs')
    .select('id, tenant_id, event_id, attempts, max_attempts, state, config')
    .eq('status', 'processing').lt('locked_at', staleCutoff).limit(20)
  for (const job of (stale ?? []) as any[]) {
    if (job.attempts < job.max_attempts) await finish(supabase, job, { status: 'pending', run_after: new Date().toISOString() })
    else await failJob(supabase, job, 'The media job stopped repeatedly (the worker was restarted or ran out of memory)')
  }

  for (let i = 0; i < batchSize; i++) {
    if (options.deadline !== undefined && Date.now() >= options.deadline) break
    const { data: job, error } = await (supabase as any).rpc('claim_next_media_job', { p_worker_id: workerId })
    if (error || !job?.id) break
    results.push({ job_id: job.id, ...(await runMediaJob(supabase, job)) })
  }
  return { processed: results.length, results }
}
