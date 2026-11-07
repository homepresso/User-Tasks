/**
 * Runs an agent evaluation suite (server only). Each active case runs the
 * agent in eval mode (side-effecting tools simulated, approvals never wait),
 * is checked against its expectations (lib/agents/evals.ts) — a rubric by the
 * agent's own model as judge — and the per-case results and totals are
 * written to agent_eval_runs as they complete.
 */
import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAgentRun } from '@/lib/agent-run-service'
import { checkExpectations, normalizeExpectations, parseRubricVerdict, rubricPrompt, type EvalCaseResult, type EvalCheck } from './evals'
import { loadAgentForRun } from './prepare'
import { runAgent } from './run'
import { chatBodyParams, resolveAgentEndpoint } from './provider'

export interface EvalRunnerParams {
  db: SupabaseClient
  tenantId: string
  evalRunId: string
  agentId: string
  caseIds: string[]
  actingUserId: string | null
  fetchImpl?: typeof fetch
}

async function gradeRubric(params: EvalRunnerParams, loaded: Awaited<ReturnType<typeof loadAgentForRun>>, rubric: string, input: string, response: string): Promise<EvalCheck> {
  const endpoint = resolveAgentEndpoint(loaded.integration)
  const model = String(loaded.agent.model ?? '').trim()
  try {
    const res = await (params.fetchImpl ?? fetch)(endpoint.url, {
      method: 'POST',
      headers: endpoint.headers,
      body: JSON.stringify({ model, messages: [{ role: 'user', content: rubricPrompt(rubric, input, response) }], ...chatBodyParams(endpoint.kind, model, { maxTokens: 300, temperature: 0 }) }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) return { check: `rubric: ${rubric}`, passed: false, detail: `judge call failed (${res.status})` }
    const json: any = await res.json()
    const verdict = parseRubricVerdict(String(json?.choices?.[0]?.message?.content ?? ''))
    if (!verdict) return { check: `rubric: ${rubric}`, passed: false, detail: 'the judge did not return a verdict' }
    return { check: `rubric: ${rubric}`, passed: verdict.pass, detail: verdict.reason }
  } catch (error) {
    return { check: `rubric: ${rubric}`, passed: false, detail: `judge call failed: ${(error as Error)?.message ?? 'error'}` }
  }
}

export async function runEvalSuite(params: EvalRunnerParams): Promise<void> {
  const { db, tenantId, evalRunId, agentId } = params
  const results: EvalCaseResult[] = []
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  // Cost of the suite's runs per currency, and how many could not be priced.
  const cost: { amounts: Record<string, number>; unpriced_runs: number } = { amounts: {}, unpriced_runs: 0 }
  let costColumn = true
  const save = async (final?: { status: 'completed' | 'failed'; error?: string }) => {
    const passed = results.filter((r) => r.passed).length
    const row = {
      results, passed, failed: results.length - passed, usage, ...(costColumn ? { cost } : {}),
      ...(final ? { status: final.status, error: final.error ?? null, completed_at: new Date().toISOString() } : {}),
    }
    const { error } = await (db as any).from('agent_eval_runs').update(row).eq('id', evalRunId).eq('tenant_id', tenantId)
    if (error && costColumn && /cost/.test(String(error.message ?? ''))) {
      costColumn = false
      const { cost: _omit, ...rest } = row as any
      await (db as any).from('agent_eval_runs').update(rest).eq('id', evalRunId).eq('tenant_id', tenantId)
    }
  }
  try {
    const loaded = await loadAgentForRun(db, tenantId, agentId, { allowInactive: true })
    const { data: cases } = await (db as any).from('agent_eval_cases').select('*').eq('tenant_id', tenantId).eq('agent_id', agentId).in('id', params.caseIds)
    for (const c of cases ?? []) {
      const expected = normalizeExpectations(c.expected)
      const started = Date.now()
      let caseResult: EvalCaseResult
      try {
        const outcome = await runAgent({
          db, tenantId, loaded, message: c.input_message, actingUserId: params.actingUserId,
          callerType: 'eval', callerId: evalRunId, mode: 'eval', skipBudget: false, record: false,
        })
        const result = outcome.result
        const runId = await recordAgentRun({
          supabase: db, tenantId, agentId, result, model: outcome.model, inputMessage: c.input_message,
          actorId: params.actingUserId, callerType: 'eval', callerId: evalRunId, audit: false,
          provider: outcome.provider, agentVersion: Number(loaded.agent.version) || null,
        })
        if (runId) {
          await (db as any).from('agent_runs').update({ eval_run_id: evalRunId, agent_version: loaded.agent.version ?? null }).eq('id', runId)
          const { data: priced } = await (db as any).from('agent_runs').select('cost_amount, cost_currency, cost_status').eq('id', runId).maybeSingle()
          if (priced?.cost_status === 'priced' && priced.cost_currency) cost.amounts[priced.cost_currency] = (cost.amounts[priced.cost_currency] ?? 0) + (Number(priced.cost_amount) || 0)
          else cost.unpriced_runs++
        }
        const checks = checkExpectations(result, expected)
        if (expected.rubric && result.status === 'completed') checks.push(await gradeRubric(params, loaded, expected.rubric, c.input_message, result.response))
        usage.prompt_tokens += result.usage.prompt_tokens
        usage.completion_tokens += result.usage.completion_tokens
        usage.total_tokens += result.usage.total_tokens
        caseResult = {
          case_id: c.id, name: c.name, passed: checks.every((ch) => ch.passed), checks, agent_run_id: runId,
          status: result.status, response: result.response.slice(0, 2_000), outputs: result.outputs ?? null,
          tools: result.toolCalls.map((t) => t.toolName), tokens: result.usage.total_tokens, duration_ms: Date.now() - started,
          error: result.error ?? null,
        }
      } catch (error) {
        caseResult = {
          case_id: c.id, name: c.name, passed: false, checks: [{ check: 'run', passed: false, detail: (error as Error)?.message ?? 'error' }],
          agent_run_id: null, status: 'failed', response: '', tools: [], tokens: 0, duration_ms: Date.now() - started, error: (error as Error)?.message ?? 'error',
        }
      }
      results.push(caseResult)
      await save()
    }
    await save({ status: 'completed' })
  } catch (error) {
    await save({ status: 'failed', error: (error as Error)?.message ?? 'Evaluation failed' })
  }
}

/** Run the suite after the current response (or unawaited outside a request). */
export function startEvalRunner(params: EvalRunnerParams): void {
  const run = () => runEvalSuite(params).catch((error) => console.error('[agent-evals] run failed:', (error as Error)?.message))
  try {
    after(run)
  } catch {
    void run()
  }
}
