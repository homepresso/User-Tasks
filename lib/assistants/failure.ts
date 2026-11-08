/**
 * "Ask Agent to fix" (client-safe, pure): a failed workflow test run (or run)
 * turned into the context the Agent diagnoses — attached to the message as a
 * text attachment, so it only ever reaches the model inside an
 * UNTRUSTED_ATTACHMENT block (never the system role) and stays in the
 * conversation's history for follow-ups.
 *
 * Only what the person already sees in the test runner is included: the
 * failed step (id, type, label, config), the error, the steps leading to it,
 * the run's log lines, the test inputs — secrets masked (redactSecrets plus
 * credential-looking keys), long values and the whole block size-capped —
 * and the wiring self-check's warnings for the workflow
 * (lib/assistants/workflow-check), to support the diagnosis.
 */
import { redactSecrets } from '@/lib/agents/safety'
import { workflowWarnings } from './workflow-check'
import type { ChatAttachment } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- run payloads are JSON */

export const FAILURE_CONTEXT_MAX_CHARS = 16_000
const SECRETISH = /pass(word)?|secret|token|api[_-]?key|authori[sz]ation|bearer|private[_-]?key|client[_-]?secret|cookie|session/i

export interface FailureInput {
  workflow: { id: string; name: string | null }
  nodes: Array<{ id: string; type: string; label?: string; config?: Record<string, any> }>
  edges: Array<{ source: string; target: string; label?: string | null }>
  failedNodeId: string | null
  error: string
  /** Run log lines (what the Logs tab shows). */
  logs?: Array<{ level?: string; message?: string; node_id?: string | null; metadata?: unknown }>
  /** The test case's inputs (start variables / form values). */
  inputs?: Record<string, unknown> | null
  /** Test run or a real run. */
  source: 'test' | 'run'
  triggerType?: string | null
}

/** A value made safe to show the model: secrets masked, strings and depth capped. */
export function redactForAgent(value: unknown, depth = 0): unknown {
  const v = redactSecrets(value)
  const walk = (x: unknown, d: number): unknown => {
    if (typeof x === 'string') return x.length > 500 ? `${x.slice(0, 500)}… [${x.length} characters]` : x
    if (d > 6) return '[…]'
    if (Array.isArray(x)) return x.slice(0, 30).map((y) => walk(y, d + 1)).concat(x.length > 30 ? [`[… ${x.length - 30} more]`] : [])
    if (x && typeof x === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, y] of Object.entries(x as Record<string, unknown>).slice(0, 60)) out[k] = SECRETISH.test(k) && y !== null && y !== '' && typeof y !== 'boolean' ? '••••' : walk(y, d + 1)
      return out
    }
    return x
  }
  return walk(v, depth)
}

/** The steps leading to `nodeId` (nearest first, at most `max`). */
export function upstreamSteps(nodeId: string, edges: FailureInput['edges'], max = 6): string[] {
  const out: string[] = []
  let frontier = [nodeId]
  const seen = new Set([nodeId])
  while (frontier.length && out.length < max) {
    const next: string[] = []
    for (const id of frontier) for (const e of edges) if (e.target === id && !seen.has(e.source)) { seen.add(e.source); out.push(e.source); next.push(e.source) }
    frontier = next
  }
  return out.slice(0, max)
}

export function buildFailureContext(input: FailureInput): Record<string, unknown> {
  const byId = new Map(input.nodes.map((n) => [n.id, n]))
  const failed = input.failedNodeId ? byId.get(input.failedNodeId) : undefined
  const step = (n: FailureInput['nodes'][number] | undefined) => (n ? { id: n.id, type: n.type, label: n.label ?? null, config: redactForAgent(n.config ?? {}) } : null)
  let warnings: string[] = []
  try { warnings = workflowWarnings({ nodes: input.nodes as any, triggerType: input.triggerType ?? null, userVariables: [] }) } catch { warnings = [] }
  const logs = (input.logs ?? []).filter((l) => l?.message).slice(-20).map((l) => ({ level: l.level ?? 'info', step: l.node_id ?? null, message: String(redactForAgent(String(l.message))) }))
  return {
    kind: input.source === 'test' ? 'workflow test run failure' : 'workflow run failure',
    workflow: { id: input.workflow.id, name: input.workflow.name },
    failed_step: step(failed),
    error: String(redactForAgent(input.error)),
    upstream_steps: input.failedNodeId ? upstreamSteps(input.failedNodeId, input.edges).map((id) => step(byId.get(id))).filter(Boolean) : [],
    inputs: input.inputs ? redactForAgent(input.inputs) : null,
    recent_logs: logs,
    wiring_warnings: warnings,
    rules: input.source === 'run'
      ? 'A real run: never change data or retry it; only propose a draft workflow fix (with confirmation) or explain next steps.'
      : 'A test run: propose a draft workflow fix (with confirmation) when there is a safe one; otherwise explain what to do.',
  }
}

/** The failure as an attachment for the Agent message (size-capped JSON). */
export function failureAttachment(input: FailureInput): ChatAttachment {
  let text = JSON.stringify(buildFailureContext(input), null, 1)
  if (text.length > FAILURE_CONTEXT_MAX_CHARS) text = `${text.slice(0, FAILURE_CONTEXT_MAX_CHARS)}\n[… truncated]`
  return { name: `${input.source === 'test' ? 'Test run' : 'Run'} failure — ${input.workflow.name ?? 'workflow'}.json`, mime_type: 'application/json', size: text.length, kind: 'text', text, note: `Failure context from the ${input.source === 'test' ? 'test runner' : 'run history'} (secrets masked)` }
}

/** The "Ask Agent to fix" button shows only when the Agent is available and the person can edit the workflow. */
export function canAskAgentToFix(availability: { agent?: boolean; designer?: boolean } | null | undefined, canEditWorkflow: boolean): boolean {
  return Boolean(availability?.agent && availability.designer && canEditWorkflow)
}

/**
 * A failed real run (run history / the process view) as failure input: the
 * definition the run executed, the first failed step in node_results (else
 * the step named by an error log), the run's error and its start variables.
 * Null when the run did not fail.
 */
export function runFailureInput(
  run: { status?: string | null; error?: string | null; node_results?: unknown; variables?: unknown } | null | undefined,
  workflow: { id: string; name?: string | null; nodes?: unknown; edges?: unknown; trigger_type?: string | null } | null | undefined,
  logs: FailureInput['logs'] = [],
): FailureInput | null {
  if (!run || !workflow || run.status !== 'failed') return null
  const results = (run.node_results && typeof run.node_results === 'object' ? run.node_results : {}) as Record<string, any>
  const failedLog = [...(logs ?? [])].reverse().find((l) => l?.level === 'error')
  const failedNodeId = Object.entries(results).find(([, r]) => r?.status === 'error' || r?.status === 'failed')?.[0] ?? failedLog?.node_id ?? null
  const error = (failedNodeId ? results[failedNodeId]?.error : null) ?? run.error ?? failedLog?.message ?? 'The run failed'
  const vars = run.variables && typeof run.variables === 'object' ? run.variables as Record<string, unknown> : null
  return {
    workflow: { id: workflow.id, name: workflow.name ?? null },
    nodes: Array.isArray(workflow.nodes) ? workflow.nodes as FailureInput['nodes'] : [],
    edges: Array.isArray(workflow.edges) ? workflow.edges as FailureInput['edges'] : [],
    failedNodeId, error: typeof error === 'string' ? error : JSON.stringify(error), logs: logs ?? [],
    inputs: vars, source: 'run', triggerType: workflow.trigger_type ?? null,
  }
}

export const RUN_FIX_PROMPT = 'This workflow run failed. Find the cause and explain it in plain words. If there is a safe fix, propose it as a draft workflow change; do not change any data and do not retry the run. If there is no safe fix, say what to do instead.'

export const FIX_PROMPT = 'This workflow failed. Find the cause, explain it in plain words, and propose a fix as a draft change if there is a safe one. If there is no safe fix, say what to do instead.'
