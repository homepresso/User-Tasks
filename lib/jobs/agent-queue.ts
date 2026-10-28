import type { SupabaseClient } from '@supabase/supabase-js'
import { executeAgent, BUILTIN_TOOL_DEFS } from '@/lib/agent-executor'
import type { AgentConfig, AgentTool } from '@/lib/agent-executor'
import { buildAgentAccessPrompt, getAgentBuiltinToolNames, normalizeAgentOutputConfig } from '@/lib/agent-knowledge'
import { decryptSensitiveFields } from '@/lib/secret-fields'
import { recordAgentRun } from '@/lib/agent-run-service'
import { createServiceClient } from '@/lib/cron-auth'
import { appUrlOrLocalhost } from '@/lib/config/bootstrap'

// Jobs stuck in 'processing' longer than this are presumed dead (worker killed
// mid-run) and reset for retry.
const STALE_PROCESSING_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 3

/**
 * Drains the agent execution queue (agent_queue): recovers jobs abandoned
 * mid-run, then claims and runs up to `batchSize` jobs one at a time. Stops
 * claiming once `deadline` (epoch ms) has passed. Used by
 * /api/agents/process, /api/cron/process-agents and the scheduler tick.
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
  const appBaseUrl = appUrlOrLocalhost()

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
      // Load agent with integration
      const { data: agent } = await (supabase as any).from('agents')
        .select('*, integration:integrations(*)')
        .eq('id', job.agent_id).single()

      if (!agent) {
        await supabase.rpc('fail_agent_job', { p_job_id: job.id, p_error: 'Agent not found' })
        results.push({ job_id: job.id, status: 'failed', error: 'Agent not found' })
        continue
      }

      const a = agent as any
      const integration = a.integration
      if (!integration?.config) {
        await supabase.rpc('fail_agent_job', { p_job_id: job.id, p_error: 'No integration' })
        results.push({ job_id: job.id, status: 'failed', error: 'No integration' })
        continue
      }

      // Credential fields are encrypted at rest — decrypt at the read boundary
      const intConfig = decryptSensitiveFields(integration.config) as any
      const apiKey = intConfig.auth_config?.key_value ?? intConfig.auth_config?.token ?? ''
      const baseUrl = intConfig.base_url ?? 'https://api.openai.com/v1'

      if (!apiKey) {
        await supabase.rpc('fail_agent_job', { p_job_id: job.id, p_error: 'No API key' })
        results.push({ job_id: job.id, status: 'failed', error: 'No API key' })
        continue
      }

      // Build tools
      const normalizedOutputConfig = normalizeAgentOutputConfig(a.output_config)
      const builtinToolNames = getAgentBuiltinToolNames(normalizedOutputConfig, {
        includeSharedContext: Boolean(job.shared_context),
      })
      const agentTools: AgentTool[] = [
        ...(a.tools ?? []),
        ...BUILTIN_TOOL_DEFS.filter(bt => builtinToolNames.includes(bt.name)),
      ]

      // Build system prompt
      const parts: string[] = []
      if (a.role) parts.push(`You are ${a.role}.`)
      if (a.task) parts.push(`\nYour task: ${a.task}`)
      if (a.boundaries) parts.push(`\nBoundaries:\n${a.boundaries}`)
      const ov = normalizedOutputConfig.variables
      if (ov.length > 0) { parts.push(`\nOutputs:`); for (const v of ov) parts.push(`- ${v.name} (${v.type}): ${v.description}`) }
      let allowedTableNames: string[] = []
      if (normalizedOutputConfig.data_access.mode === 'selected' && normalizedOutputConfig.data_access.table_ids.length > 0) {
        const { data: tables } = await (supabase as any)
          .from('custom_tables')
          .select('id, name')
          .eq('tenant_id', job.tenant_id)
          .in('id', normalizedOutputConfig.data_access.table_ids)
        allowedTableNames = (tables ?? []).map((table: any) => String(table.name ?? '')).filter(Boolean)
      }
      const accessPrompt = buildAgentAccessPrompt(normalizedOutputConfig, allowedTableNames)
      if (accessPrompt) parts.push(accessPrompt)
      if (a.system_prompt) parts.push(`\n${a.system_prompt}`)

      const config: AgentConfig = {
        baseUrl, apiKey,
        model: a.model ?? 'gpt-4o',
        systemPrompt: parts.join('\n') || 'You are a helpful assistant.',
        temperature: Number(a.temperature) || 0.7,
        maxTokens: Number(a.max_tokens) || 4096,
        maxIterations: Number(a.max_iterations) || 10,
        tools: agentTools,
      }

      // Execute
      const result = await executeAgent(config, job.input_message, {
        sharedContext: job.shared_context ?? undefined,
        appBaseUrl,
        _tenantId: job.tenant_id,
        _agentId: job.agent_id,
        _actingUserId: job.created_by ?? null,
        _agentOutputConfig: normalizedOutputConfig,
        outputVariables: normalizedOutputConfig.variables,
      })

      // Record the run (status reflects completed/failed) and link it to the job.
      const runId = await recordAgentRun({
        supabase, tenantId: job.tenant_id, agentId: job.agent_id, result,
        model: config.model, inputMessage: job.input_message,
        actorId: job.created_by ?? null, callerType: 'queued', queueJobId: job.id,
      })

      // A failed LLM run must fail the queue job, not silently complete it.
      if (result.status === 'failed') {
        await supabase.rpc('fail_agent_job', { p_job_id: job.id, p_error: result.error ?? 'Agent execution failed' })
        results.push({ job_id: job.id, status: 'failed', run_id: runId, error: result.error })
      } else {
        await supabase.rpc('complete_agent_job', {
          p_job_id: job.id,
          p_result: { response: result.response, outputs: result.outputs ?? null, iterations: result.iterations, tool_calls: result.toolCalls.length, usage: result.usage, duration_ms: result.duration_ms },
          p_run_id: runId,
        })
        results.push({ job_id: job.id, status: 'completed', run_id: runId, duration_ms: result.duration_ms })
      }

    } catch (err: any) {
      await supabase.rpc('fail_agent_job', { p_job_id: job.id, p_error: err.message ?? 'Unknown error' })
      results.push({ job_id: job.id, status: 'failed', error: err.message })
    }
  }

  return { processed: results.length, results }
}
