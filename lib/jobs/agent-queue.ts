import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/cron-auth'
import { AgentRunError, loadAgentForRun } from '@/lib/agents/prepare'
import { resumeLinkedWorkflow, runAgent, type RunAgentOutcome } from '@/lib/agents/run'
import type { AgentPausedContext, AgentWorkflowLink } from '@/lib/agents/approval'

// Jobs stuck in 'processing' longer than this are presumed dead (worker killed
// mid-run) and reset for retry.
const STALE_PROCESSING_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 3

/**
 * Drains the agent execution queue (agent_queue): recovers jobs abandoned
 * mid-run, then claims and runs up to `batchSize` jobs one at a time. Stops
 * claiming once `deadline` (epoch ms) has passed. Used by
 * /api/agents/process, /api/cron/process-agents and the scheduler tick.
 *
 * Job kinds:
 *  - 'run'    a queued run (REST async, MCP agents_execute, a Run Agent
 *             step in queued mode — options.workflow links the step);
 *  - 'resume' continue a run paused for approval (lib/agents/approval.ts).
 *
 * Every job is scoped to its tenant: the agent and its integration are
 * loaded for job.tenant_id only. The acting person is options.acting_user_id
 * (set by the server when it enqueued) or the job's creator.
 */
export async function processAgentQueueBatch(options: {
  supabase?: SupabaseClient
  batchSize?: number
  deadline?: number
} = {}): Promise<{ processed: number; results: Array<Record<string, unknown>> }> {
  const supabase = options.supabase ?? createServiceClient()
  const batchSize = Math.min(options.batchSize ?? 5, 20)
  const workerId = `agent-worker-${Date.now()}`
  const results: Array<Record<string, unknown>> = []

  // Self-heal: recover jobs abandoned mid-run so the queue can't wedge. Retry
  // up to MAX_ATTEMPTS, then fail permanently.
  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MS).toISOString()
  await (supabase as any)
    .from('agent_queue')
    .update({ status: 'pending', locked_by: null, locked_at: null })
    .eq('status', 'processing')
    .lt('locked_at', staleCutoff)
    .lt('attempts', MAX_ATTEMPTS)
  await (supabase as any)
    .from('agent_queue')
    .update({ status: 'failed', error: 'Exceeded max retry attempts (worker repeatedly died mid-run)', completed_at: new Date().toISOString() })
    .eq('status', 'processing')
    .lt('locked_at', staleCutoff)
    .gte('attempts', MAX_ATTEMPTS)

  for (let i = 0; i < batchSize; i++) {
    // Out of time: leave the rest for the next run (claimed jobs always finish).
    if (options.deadline !== undefined && Date.now() >= options.deadline) break

    // Atomically claim next job
    const { data: job, error: claimErr } = await supabase.rpc('claim_next_agent_job', { p_worker_id: workerId })
    if (claimErr || !job?.id) break

    try {
      results.push(await processJob(supabase, job))
    } catch (err: any) {
      const message = err instanceof AgentRunError ? err.message : (err?.message ?? 'Unknown error')
      await failJob(supabase, job.id, message)
      // A linked Run Agent step must not wait forever on a job that cannot run.
      const link = (job.options as any)?.workflow as AgentWorkflowLink | undefined
      if (link?.event_id && job.kind !== 'resume') await failLinkedStep(supabase, job.tenant_id, link, message)
      results.push({ job_id: job.id, status: 'failed', error: message })
    }
  }

  return { processed: results.length, results }
}

/**
 * Fail a job for good. (fail_agent_job re-queues for another attempt; an
 * agent run already retried its provider calls, and re-running it would
 * repeat its tool side effects and record duplicate runs.)
 */
async function failJob(supabase: SupabaseClient, jobId: string, message: string, runId: string | null = null) {
  await (supabase as any).from('agent_queue')
    .update({ status: 'failed', error: message.slice(0, 2000), completed_at: new Date().toISOString(), locked_at: null, locked_by: null, ...(runId ? { run_id: runId } : {}) })
    .eq('id', jobId)
}

async function failLinkedStep(supabase: SupabaseClient, tenantId: string, link: AgentWorkflowLink, message: string) {
  try {
    const { enqueueResume } = await import('@/lib/workflow-resume-queue')
    await enqueueResume({ tenantId, eventId: link.event_id, variables: { _agent_node_error: `Agent execution failed: ${message}` }, supabase })
  } catch (error) {
    console.warn('[agent-queue] could not fail the waiting workflow step:', (error as Error)?.message)
  }
}

async function processJob(supabase: SupabaseClient, job: any): Promise<Record<string, unknown>> {
  const opts = (job.options ?? {}) as Record<string, any>
  let outcome: RunAgentOutcome
  let link: AgentWorkflowLink | null = null

  if (job.kind === 'resume') {
    const { data: run } = await (supabase as any).from('agent_runs')
      .select('id, agent_id, tenant_id, status, input_message, paused_context, agent_version')
      .eq('id', job.resume_run_id).eq('tenant_id', job.tenant_id).maybeSingle()
    if (!run || run.status !== 'running' || !run.paused_context?.state) {
      await failJob(supabase, job.id, 'The agent run is no longer waiting to resume')
      return { job_id: job.id, status: 'failed', error: 'run not resumable' }
    }
    const paused = run.paused_context as AgentPausedContext
    link = paused.workflow ?? null
    // The version that started the run finishes it (a published workflow's pin stays pinned across the pause).
    const loaded = await loadAgentForRun(supabase, job.tenant_id, run.agent_id, { allowInactive: false, version: run.agent_version ?? null }).catch(async (error) => {
      await (supabase as any).from('agent_runs').update({ status: 'failed', error: error.message, paused_context: null, completed_at: new Date().toISOString() }).eq('id', run.id)
      if (link) await failLinkedStep(supabase, job.tenant_id, link, error.message)
      throw error
    })
    outcome = await runAgent({
      db: supabase, tenantId: job.tenant_id, loaded, message: run.input_message ?? '',
      actingUserId: paused.acting_user_id, callerType: paused.caller_type, traceId: paused.trace_id,
      queueJobId: job.id, resume: { runId: run.id, paused, decision: opts.decision ?? { approved: false, notes: 'No decision recorded' } },
    })
  } else {
    link = (opts.workflow as AgentWorkflowLink | undefined) ?? null
    const loaded = await loadAgentForRun(supabase, job.tenant_id, job.agent_id, { version: opts.agent_version ?? null })
    let attachments
    if (opts.files) {
      const { loadRunAgentFiles } = await import('@/lib/agents/files')
      attachments = await loadRunAgentFiles(opts.files, job.tenant_id, loaded)
    }
    outcome = await runAgent({
      db: supabase, tenantId: job.tenant_id, loaded, message: job.input_message,
      actingUserId: opts.acting_user_id !== undefined ? (opts.acting_user_id ?? null) : (job.created_by ?? null),
      callerType: link ? 'workflow_node' : 'queued', callerId: link?.run_id ?? null, traceId: opts.trace_id ?? null,
      workflow: link, includeSharedContext: Boolean(job.shared_context) || Boolean(link?.share_context),
      sharedContext: job.shared_context ?? (link?.share_context ? link.agent_context ?? { messages: [], facts: {} } : undefined),
      overrides: { maxIterations: opts.max_iterations, maxDurationMs: opts.timeout_ms },
      attachments, queueJobId: job.id,
      initiatedBy: opts.initiated_by ?? job.created_by ?? null,
    })
  }

  const { result, runId } = outcome
  if (result.status === 'awaiting_approval') {
    // The job is done; the run continues when the reviewer decides (a new 'resume' job).
    await supabase.rpc('complete_agent_job', { p_job_id: job.id, p_result: { status: 'awaiting_approval', approval_task_id: outcome.approval?.taskId ?? null }, p_run_id: runId })
    return { job_id: job.id, status: 'awaiting_approval', run_id: runId }
  }

  if (link) {
    // Never let the job fail (and re-run the agent) because the workflow could not be resumed.
    await resumeLinkedWorkflow({ db: supabase, tenantId: job.tenant_id, link, outcome, agentName: String((await agentName(supabase, job)) ?? 'agent') })
      .catch((error) => console.warn('[agent-queue] workflow resume failed:', (error as Error)?.message))
  }

  // A failed LLM run must fail the queue job, not silently complete it.
  if (result.status === 'failed') {
    await failJob(supabase, job.id, result.error ?? 'Agent execution failed', runId)
    return { job_id: job.id, status: 'failed', run_id: runId, error: result.error }
  }
  await supabase.rpc('complete_agent_job', {
    p_job_id: job.id,
    p_result: { response: result.response, outputs: result.outputs ?? null, iterations: result.iterations, tool_calls: result.toolCalls.length, usage: result.usage, duration_ms: result.duration_ms },
    p_run_id: runId,
  })
  return { job_id: job.id, status: 'completed', run_id: runId, duration_ms: result.duration_ms }
}

async function agentName(supabase: SupabaseClient, job: any): Promise<string | null> {
  const { data } = await (supabase as any).from('agents').select('name').eq('id', job.agent_id).eq('tenant_id', job.tenant_id).maybeSingle()
  return data?.name ?? null
}
