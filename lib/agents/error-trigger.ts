/**
 * "Agent error" workflow trigger (agent_error) — the catalog, the trigger
 * node's filters and the run payload (client-safe, pure). The server side
 * (finding the workflows, de-dupe, queueing) is lib/agents/error-trigger-dispatch.ts.
 *
 * Fires when an agent fails FOR GOOD — after its automatic retries
 * (lib/agents/retry.ts) are exhausted, or on a failure no retry can fix.
 * Never for a retry that later succeeds (the run then completes) and never
 * for a run someone stopped (cancelled).
 *
 * Sources
 *   workflow       a Run Agent step whose agent failed (the step then fails)
 *   agent_run      an agent run started anywhere else — the agent designer's
 *                  Playground, the REST API, MCP, the agent queue
 *   system_agent   the in-product Agent (the chat / prompt assistant)
 *
 * Run variables (flat, like every trigger's — `{{agent_error_kind}}` — and
 * the same values as one object, `{{agent_error.kind}}`): see
 * AGENT_ERROR_VARIABLES. They carry the friendly message and a sanitised
 * technical summary (provider · HTTP status · error code / type · request id
 * · attempts) — never the provider's raw response, headers, keys or the
 * prompt / conversation. The person is identified by id only.
 *
 * Loop guard: the payload carries `agent_error_depth` (1). Like every run
 * variable without a leading underscore it reaches sub-workflows too; an
 * agent that fails in a run whose variables carry a depth (or in a workflow
 * that itself starts on agent_error) is not reported again
 * (AGENT_ERROR_MAX_DEPTH).
 */

import type { AgentFailureCode } from './errors'

export const AGENT_ERROR_TRIGGER = 'agent_error'

export const AGENT_ERROR_SOURCES = ['workflow', 'agent_run', 'system_agent'] as const
export type AgentErrorSource = (typeof AGENT_ERROR_SOURCES)[number]

export const AGENT_ERROR_SOURCE_LABELS: Record<AgentErrorSource, { label: string; hint: string }> = {
  workflow: { label: 'Workflow agents', hint: 'A Run Agent step whose agent failed for good' },
  agent_run: { label: 'Agent runs started elsewhere', hint: 'The Playground, the API, MCP or the agent queue' },
  system_agent: { label: 'The Agent (chat assistant)', hint: 'The in-product Agent panel' },
}

export const AGENT_ERROR_SEVERITIES = ['warning', 'error', 'critical'] as const
export type AgentErrorSeverity = (typeof AGENT_ERROR_SEVERITIES)[number]

export const AGENT_ERROR_KINDS = [
  'rate_limited', 'out_of_credit', 'key_rejected', 'model_unavailable', 'provider_down', 'timeout_network',
  'context_too_long', 'content_policy', 'not_configured', 'tools_unsupported', 'other',
] as const
export type AgentErrorTriggerKind = (typeof AGENT_ERROR_KINDS)[number]

/**
 * Each kind's label and severity: warning = transient (the provider was busy
 * or slow; it usually clears by itself), error = this request (rephrase,
 * shorten, check the agent), critical = configuration (every request fails
 * until an admin fixes the key, credit, model or provider).
 */
export const AGENT_ERROR_KIND_INFO: Record<AgentErrorTriggerKind, { label: string; severity: AgentErrorSeverity }> = {
  rate_limited: { label: 'Rate limited', severity: 'warning' },
  out_of_credit: { label: 'Out of credit', severity: 'critical' },
  key_rejected: { label: 'Key rejected', severity: 'critical' },
  model_unavailable: { label: 'Model unavailable', severity: 'critical' },
  provider_down: { label: 'Provider down', severity: 'warning' },
  timeout_network: { label: 'Timeout / network', severity: 'warning' },
  context_too_long: { label: 'Context too long', severity: 'error' },
  content_policy: { label: 'Content policy', severity: 'error' },
  not_configured: { label: 'Not configured', severity: 'critical' },
  tools_unsupported: { label: 'Tools unsupported', severity: 'critical' },
  other: { label: 'Other', severity: 'error' },
}

const SEVERITY_RANK: Record<AgentErrorSeverity, number> = { warning: 1, error: 2, critical: 3 }

/** The trigger kind of a failure code (lib/agents/errors.ts), or null for a stopped run (never reported). */
export function agentErrorKindOf(code: AgentFailureCode | string | null | undefined): AgentErrorTriggerKind | null {
  switch (code) {
    case 'cancelled': return null
    case 'rate_limited': return 'rate_limited'
    case 'quota': return 'out_of_credit'
    case 'auth': return 'key_rejected'
    case 'model_not_found': return 'model_unavailable'
    case 'overloaded': return 'provider_down'
    case 'timeout': case 'network': return 'timeout_network'
    case 'context_too_long': return 'context_too_long'
    case 'content_policy': return 'content_policy'
    case 'not_configured': return 'not_configured'
    case 'tools_unsupported': return 'tools_unsupported'
    default: return 'other'
  }
}

/* ── The trigger node's configuration ── */

export const AGENT_ERROR_DEFAULT_MAX = 3
export const AGENT_ERROR_DEFAULT_WINDOW_MINUTES = 5
export const AGENT_ERROR_MAX_DEPTH = 1
/** The profile filter's id for the Agent's Default profile (no profile matched the person). */
export const DEFAULT_PROFILE_ID = 'default'

export interface AgentErrorTriggerConfig {
  /** Empty = every source. */
  sources: AgentErrorSource[]
  /** Agents (workflow / agent_run sources). With profile_ids: an event passes when it matches either list; both empty = any. */
  agent_ids: string[]
  /** The Agent's profiles (system_agent source; `default` = the Default profile). */
  profile_ids: string[]
  /** Empty = every kind. */
  error_kinds: AgentErrorTriggerKind[]
  /** Only this severity or worse (null = any). */
  min_severity: AgentErrorSeverity | null
  /** De-dupe: at most `max_per_window` runs per agent (or profile) and error kind every `window_minutes`. */
  max_per_window: number
  window_minutes: number
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim()).filter(Boolean)
const intIn = (v: unknown, min: number, max: number, fallback: number): number => {
  if (v === undefined || v === null || v === '') return fallback
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

export function normalizeAgentErrorConfig(raw: Record<string, unknown> | null | undefined): AgentErrorTriggerConfig {
  const c = raw ?? {}
  const severity = typeof c.min_severity === 'string' && (AGENT_ERROR_SEVERITIES as readonly string[]).includes(c.min_severity) ? c.min_severity as AgentErrorSeverity : null
  return {
    sources: strings(c.sources).filter((s): s is AgentErrorSource => (AGENT_ERROR_SOURCES as readonly string[]).includes(s)),
    agent_ids: strings(c.agent_ids),
    profile_ids: strings(c.profile_ids),
    error_kinds: strings(c.error_kinds).filter((k): k is AgentErrorTriggerKind => (AGENT_ERROR_KINDS as readonly string[]).includes(k)),
    min_severity: severity,
    max_per_window: intIn(c.max_per_window, 1, 50, AGENT_ERROR_DEFAULT_MAX),
    window_minutes: intIn(c.window_minutes, 1, 1440, AGENT_ERROR_DEFAULT_WINDOW_MINUTES),
  }
}

/** Designer checks (lib/workflow-validation.ts). */
export function validateAgentErrorConfig(raw: Record<string, unknown> | null | undefined): string[] {
  const c = raw ?? {}
  const errors: string[] = []
  const unknown = (values: unknown, allowed: readonly string[]) => strings(values).filter((v) => !allowed.includes(v))
  const badSources = unknown(c.sources, AGENT_ERROR_SOURCES)
  if (badSources.length) errors.push(`Unknown source: ${badSources.join(', ')}`)
  const badKinds = unknown(c.error_kinds, AGENT_ERROR_KINDS)
  if (badKinds.length) errors.push(`Unknown error kind: ${badKinds.join(', ')}`)
  if (c.min_severity !== undefined && c.min_severity !== null && c.min_severity !== '' && !(AGENT_ERROR_SEVERITIES as readonly string[]).includes(String(c.min_severity))) errors.push('Minimum severity must be warning, error or critical')
  const n = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v))
  const max = n(c.max_per_window)
  if (max !== null && !(Number.isInteger(max) && max >= 1 && max <= 50)) errors.push('Runs per window must be a whole number from 1 to 50')
  const win = n(c.window_minutes)
  if (win !== null && !(Number.isInteger(win) && win >= 1 && win <= 1440)) errors.push('Window must be 1–1440 minutes')
  const sources = strings(c.sources)
  if (sources.length && strings(c.agent_ids).length && !strings(c.profile_ids).length && sources.every((s) => s === 'system_agent')) errors.push('Agents only filter workflow agents and agent runs — pick profiles for the Agent, or add a source')
  if (sources.length && strings(c.profile_ids).length && !strings(c.agent_ids).length && !sources.includes('system_agent')) errors.push('Profiles only filter the Agent (chat assistant) — add it as a source, or pick agents')
  return errors
}

/* ── The event and the payload ── */

/** One final agent failure, as the dispatcher gets it (already sanitised: no raw bodies, headers, keys or prompts). */
export interface AgentErrorEvent {
  tenantId: string
  source: AgentErrorSource
  /** An AgentFailureCode (lib/agents/errors.ts); 'cancelled' is never reported. */
  code: AgentFailureCode | string
  /** The friendly message. */
  message: string
  /** technicalSummary() of the failure view, or our own short reason. */
  summary: string
  provider?: string | null
  model?: string | null
  agentId?: string | null
  agentName?: string | null
  profileId?: string | null
  profileName?: string | null
  workflowId?: string | null
  workflowName?: string | null
  runId?: string | null
  stepLabel?: string | null
  stepId?: string | null
  agentRunId?: string | null
  conversationId?: string | null
  userId?: string | null
  attempts?: number | null
  requestId?: string | null
  /** When it failed (default now). */
  at?: string
  /** agent_error_depth of the run the agent ran in (loop guard; 0 / absent = not started by this trigger). */
  depth?: number | null
}

/** Is this event within the trigger's filters (de-dupe aside)? */
export function matchesAgentErrorConfig(config: AgentErrorTriggerConfig, event: Pick<AgentErrorEvent, 'source' | 'code' | 'agentId' | 'profileId'>): boolean {
  const kind = agentErrorKindOf(event.code)
  if (!kind) return false
  if (config.sources.length && !config.sources.includes(event.source)) return false
  if (config.error_kinds.length && !config.error_kinds.includes(kind)) return false
  if (config.min_severity && SEVERITY_RANK[AGENT_ERROR_KIND_INFO[kind].severity] < SEVERITY_RANK[config.min_severity]) return false
  if (config.agent_ids.length || config.profile_ids.length) {
    const agentHit = Boolean(event.agentId && config.agent_ids.includes(event.agentId))
    const profileHit = event.source === 'system_agent' && config.profile_ids.includes(event.profileId || DEFAULT_PROFILE_ID)
    if (!agentHit && !profileHit) return false
  }
  return true
}

/** The de-dupe key's subject: the agent, or the Agent's profile. */
export function agentErrorSubject(event: Pick<AgentErrorEvent, 'source' | 'agentId' | 'profileId'>): string {
  return event.source === 'system_agent' ? `agent:system:${event.profileId || DEFAULT_PROFILE_ID}` : `agent:${event.agentId || 'unknown'}`
}

/** Every run variable the trigger sets (the wiring check and the data picker list these). */
export const AGENT_ERROR_VARIABLES = [
  'agent_error', 'agent_error_kind', 'agent_error_code', 'agent_error_severity', 'agent_error_message', 'agent_error_summary',
  'agent_error_source', 'agent_error_provider', 'agent_error_model', 'agent_error_agent_id', 'agent_error_agent_name',
  'agent_error_profile_id', 'agent_error_profile_name', 'agent_error_workflow_id', 'agent_error_workflow_name', 'agent_error_run_id',
  'agent_error_step', 'agent_error_step_id', 'agent_error_agent_run_id', 'agent_error_conversation_id', 'agent_error_user_id',
  'agent_error_timestamp', 'agent_error_attempts', 'agent_error_request_id', 'agent_error_tenant_id', 'agent_error_suppressed',
  'agent_error_depth',
] as const

/** The `agent_error` object's fields: name, type, description (data picker, docs). */
export const AGENT_ERROR_FIELDS: ReadonlyArray<{ name: string; type: 'string' | 'integer'; description: string }> = [
  { name: 'kind', type: 'string', description: 'rate_limited, out_of_credit, key_rejected, model_unavailable, provider_down, timeout_network, context_too_long, content_policy, not_configured, tools_unsupported or other' },
  { name: 'code', type: 'string', description: 'The precise failure code (e.g. quota, network, overloaded, bad_request)' },
  { name: 'severity', type: 'string', description: 'warning (transient), error (this request) or critical (configuration)' },
  { name: 'message', type: 'string', description: 'The friendly message people saw' },
  { name: 'summary', type: 'string', description: 'Technical summary: provider · HTTP status · error code / type · request id · attempts (never the raw response)' },
  { name: 'source', type: 'string', description: 'workflow, agent_run or system_agent' },
  { name: 'provider', type: 'string', description: 'The AI provider (e.g. OpenAI, Anthropic)' },
  { name: 'model', type: 'string', description: 'The model id' },
  { name: 'agent_id', type: 'string', description: 'The agent (workflow agents and agent runs)' },
  { name: 'agent_name', type: 'string', description: 'The agent\'s name' },
  { name: 'profile_id', type: 'string', description: 'The Agent profile (the Agent; "default" for the Default profile)' },
  { name: 'profile_name', type: 'string', description: 'The Agent profile\'s name' },
  { name: 'workflow_id', type: 'string', description: 'The workflow whose Run Agent step failed' },
  { name: 'workflow_name', type: 'string', description: 'Its name' },
  { name: 'run_id', type: 'string', description: 'The workflow run' },
  { name: 'step', type: 'string', description: 'The Run Agent step\'s label' },
  { name: 'step_id', type: 'string', description: 'The Run Agent step\'s id' },
  { name: 'agent_run_id', type: 'string', description: 'The agent run record (its trace: /agents/<agent_id>/runs/<agent_run_id>)' },
  { name: 'conversation_id', type: 'string', description: 'The Agent conversation (the Agent)' },
  { name: 'user_id', type: 'string', description: 'The person whose request failed (the Agent), or who started the agent run' },
  { name: 'timestamp', type: 'string', description: 'When it failed (ISO 8601)' },
  { name: 'attempts', type: 'integer', description: 'Attempts made, retries included' },
  { name: 'request_id', type: 'string', description: 'The provider\'s request id (for its support)' },
  { name: 'tenant_id', type: 'string', description: 'The workspace' },
  { name: 'suppressed', type: 'integer', description: 'Similar failures skipped by the de-dupe since the last run it started' },
]

const clip = (v: unknown, max = 300): string | null => {
  if (v === undefined || v === null) return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s ? (s.length > max ? `${s.slice(0, max - 1)}…` : s) : null
}

/** The run variables for one event (`suppressed`: similar failures the de-dupe skipped since the last run). */
export function agentErrorPayload(event: AgentErrorEvent, suppressed = 0): Record<string, unknown> {
  const kind = agentErrorKindOf(event.code) ?? 'other'
  const fields: Record<string, unknown> = {
    kind,
    code: clip(event.code, 40) ?? 'unknown',
    severity: AGENT_ERROR_KIND_INFO[kind].severity,
    message: clip(event.message, 500) ?? AGENT_ERROR_KIND_INFO[kind].label,
    summary: clip(event.summary, 300) ?? kind,
    source: event.source,
    provider: clip(event.provider, 60),
    model: clip(event.model, 120),
    agent_id: event.agentId ?? null,
    agent_name: clip(event.agentName, 200),
    profile_id: event.source === 'system_agent' ? (event.profileId || DEFAULT_PROFILE_ID) : null,
    profile_name: event.source === 'system_agent' ? (clip(event.profileName, 200) ?? (event.profileId ? null : 'Default')) : null,
    workflow_id: event.workflowId ?? null,
    workflow_name: clip(event.workflowName, 200),
    run_id: event.runId ?? null,
    step: clip(event.stepLabel, 200),
    step_id: event.stepId ?? null,
    agent_run_id: event.agentRunId ?? null,
    conversation_id: clip(event.conversationId, 100),
    user_id: event.userId ?? null,
    timestamp: event.at ?? new Date().toISOString(),
    attempts: Number.isFinite(Number(event.attempts)) && Number(event.attempts) > 0 ? Math.floor(Number(event.attempts)) : null,
    request_id: clip(event.requestId, 120),
    tenant_id: event.tenantId,
    suppressed: Math.max(0, Math.floor(suppressed) || 0),
  }
  const flat: Record<string, unknown> = { agent_error: fields }
  for (const [k, v] of Object.entries(fields)) flat[`agent_error_${k}`] = v
  // Loop guard: a run started by this trigger (and its sub-workflows) carries it; agents failing there are not reported again.
  flat.agent_error_depth = Math.max(0, Math.floor(Number(event.depth) || 0)) + 1
  return flat
}

/** A short, safe reason for an agent run that failed without a provider failure view (no model output, no prompt). */
export function agentFailureReason(errorKind: string | null | undefined): { code: AgentFailureCode; message: string; summary: string } {
  switch (errorKind) {
    case 'budget': return { code: 'unknown', message: 'The agent stopped: it reached its token budget.', summary: 'budget' }
    case 'max_iterations': return { code: 'unknown', message: 'The agent stopped: it reached its step limit.', summary: 'max_iterations' }
    case 'timeout': return { code: 'timeout', message: 'The agent ran out of time.', summary: 'timeout' }
    case 'outputs': return { code: 'unknown', message: 'The agent\'s declared outputs were missing or invalid.', summary: 'outputs' }
    case 'not_configured': return { code: 'not_configured', message: 'The agent has no usable AI provider connection (missing integration or API key).', summary: 'not_configured' }
    default: return { code: 'unknown', message: 'The agent failed.', summary: String(errorKind || 'unknown').replace(/[^a-z0-9_]/gi, '').slice(0, 40) || 'unknown' }
  }
}

/** The canvas summary of a trigger node (lib/workflow-utils getNodeConfigSummary). */
export function agentErrorConfigSummary(raw: Record<string, unknown> | null | undefined): string {
  const c = normalizeAgentErrorConfig(raw)
  const src = c.sources.length && c.sources.length < AGENT_ERROR_SOURCES.length ? c.sources.map((s) => AGENT_ERROR_SOURCE_LABELS[s].label).join(', ') : 'Any agent'
  const kinds = c.error_kinds.length ? `${c.error_kinds.length} error kind${c.error_kinds.length === 1 ? '' : 's'}` : null
  const sev = c.min_severity ? `${c.min_severity}+` : null
  return [src, kinds, sev].filter(Boolean).join(' · ')
}
