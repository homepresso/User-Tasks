/**
 * The "Agent error" workflow trigger (agent_error): the catalog and filters
 * (lib/agents/error-trigger.ts), the dispatcher with its loop guard and
 * de-dupe (lib/agents/error-trigger-dispatch.ts), the payload's safety, the
 * designer validation and a sample workflow's wiring.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/process-queue', () => ({ kickQueueProcessor: vi.fn() }))

import {
  AGENT_ERROR_KINDS, AGENT_ERROR_VARIABLES, agentErrorKindOf, agentErrorPayload, agentFailureReason, matchesAgentErrorConfig,
  normalizeAgentErrorConfig, validateAgentErrorConfig, type AgentErrorEvent,
} from '@/lib/agents/error-trigger'
import { admitAgentError, invalidateAgentErrorTriggerCache, reportAgentError } from '@/lib/agents/error-trigger-dispatch'
import { createMemoryCacheStore, resetMemoryCacheForTests } from '@/lib/providers/cache/memory'
import { describeFailure, technicalSummary } from '@/lib/agents/errors'
import { validateNode } from '@/lib/workflow-validation'
import { validateWorkflowWiring, formatWiringWarning } from '@/lib/workflow-wiring'
import { AGENT_FAILURE_RECIPE } from '@/lib/mcp/tools/workflows'
import { NODE_CATALOG, isTriggerNodeType } from '@/lib/workflow-schema'
import { getNodeConfigSummary } from '@/lib/workflow-utils'

/* eslint-disable @typescript-eslint/no-explicit-any -- loose fakes */

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222'
const AGENT = 'aaaaaaaa-0000-4000-8000-000000000001'

/** A fake Supabase client: workflows / workflow_versions by tenant, enqueue_workflow captured. */
function fakeDb(workflows: Array<{ id: string; tenant_id: string; trigger_type: string; is_active?: boolean; name?: string; nodes: any[]; published_version_id?: string | null }>) {
  const enqueued: any[] = []
  const queries: Array<{ table: string; filters: Record<string, unknown> }> = []
  const db: any = {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters[k] = v; return q },
        in: (k: string, v: unknown) => { filters[k] = v; return q },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: any) => resolve({ data: rows(), error: null }),
      }
      const rows = () => {
        queries.push({ table, filters: { ...filters } })
        if (table !== 'workflows') return []
        return workflows.filter((w) => Object.entries(filters).every(([k, v]) => (k === 'is_active' ? (w.is_active ?? true) === v : (w as any)[k] === v)))
      }
      return q
    },
    rpc: async (name: string, args: any) => { if (name === 'enqueue_workflow') enqueued.push(args); return { data: 'job', error: null } },
  }
  return { db, enqueued, queries }
}

const trigger = (config: Record<string, unknown> = {}) => [{ id: 't', type: 'agent_error', label: 'Agent Error', position: { x: 0, y: 0 }, config }]
const rateLimitView = describeFailure({ kind: 'rate_limited', status: 429, message: 'Provider 429: {"error":{"message":"Rate limit for sk-live-abcdefghijklmnopqrstuvwx"}}', body: '{"error":{"message":"Rate limit exceeded for key sk-live-abcdefghijklmnopqrstuvwx","type":"rate_limit_error","code":"rate_limit_exceeded"}}', attempts: 4, provider: 'anthropic', requestId: 'req_1' }, { audience: 'agent' })

function event(over: Partial<AgentErrorEvent> = {}): AgentErrorEvent {
  return {
    tenantId: TENANT, source: 'workflow', code: rateLimitView.code, message: rateLimitView.message, summary: technicalSummary(rateLimitView),
    provider: 'Anthropic', model: 'claude-x', agentId: AGENT, agentName: 'Invoice reader', workflowId: 'wf-src', workflowName: 'Invoices',
    runId: 'run-1', stepLabel: 'Read invoice', stepId: 'n1', attempts: 4, requestId: 'req_1', ...over,
  }
}

beforeEach(() => { invalidateAgentErrorTriggerCache(); resetMemoryCacheForTests() })

describe('catalog and filters', () => {
  it('is a trigger in the node catalog', () => {
    expect(NODE_CATALOG.find((n) => n.type === 'agent_error')).toMatchObject({ category: 'trigger', label: 'Agent Error' })
    expect(isTriggerNodeType('agent_error')).toBe(true)
  })

  it('maps failure codes to kinds; a stop is never a kind', () => {
    expect(agentErrorKindOf('cancelled')).toBeNull()
    expect(agentErrorKindOf('quota')).toBe('out_of_credit')
    expect(agentErrorKindOf('auth')).toBe('key_rejected')
    expect(agentErrorKindOf('model_not_found')).toBe('model_unavailable')
    expect(agentErrorKindOf('overloaded')).toBe('provider_down')
    expect(agentErrorKindOf('network')).toBe('timeout_network')
    expect(agentErrorKindOf('timeout')).toBe('timeout_network')
    expect(agentErrorKindOf('bad_request')).toBe('other')
    expect(agentErrorKindOf('not_configured')).toBe('not_configured')
    expect(AGENT_ERROR_KINDS).toHaveLength(11)
  })

  it('sources, kinds and minimum severity', () => {
    const c = (raw: Record<string, unknown>) => normalizeAgentErrorConfig(raw)
    expect(matchesAgentErrorConfig(c({}), event())).toBe(true)
    expect(matchesAgentErrorConfig(c({ sources: ['system_agent'] }), event())).toBe(false)
    expect(matchesAgentErrorConfig(c({ sources: ['workflow'] }), event())).toBe(true)
    expect(matchesAgentErrorConfig(c({ error_kinds: ['out_of_credit'] }), event())).toBe(false)
    expect(matchesAgentErrorConfig(c({ error_kinds: ['rate_limited'] }), event())).toBe(true)
    // rate_limited is a warning: not critical.
    expect(matchesAgentErrorConfig(c({ min_severity: 'critical' }), event())).toBe(false)
    expect(matchesAgentErrorConfig(c({ min_severity: 'critical' }), event({ code: 'quota' }))).toBe(true)
    expect(matchesAgentErrorConfig(c({ min_severity: 'warning' }), event())).toBe(true)
    expect(matchesAgentErrorConfig(c({}), event({ code: 'cancelled' }))).toBe(false)
  })

  it('agents and / or profiles: either list matches', () => {
    const cfg = normalizeAgentErrorConfig({ agent_ids: [AGENT], profile_ids: ['hr'] })
    expect(matchesAgentErrorConfig(cfg, event())).toBe(true)
    expect(matchesAgentErrorConfig(cfg, event({ agentId: 'other' }))).toBe(false)
    expect(matchesAgentErrorConfig(cfg, event({ source: 'system_agent', agentId: null, profileId: 'hr' }))).toBe(true)
    expect(matchesAgentErrorConfig(cfg, event({ source: 'system_agent', agentId: null, profileId: 'builders' }))).toBe(false)
    // No profile matched the person: the Default profile.
    expect(matchesAgentErrorConfig(normalizeAgentErrorConfig({ profile_ids: ['default'] }), event({ source: 'system_agent', agentId: null, profileId: null }))).toBe(true)
  })

  it('normalises the burst limit (defaults 3 per 5 minutes, bounded)', () => {
    expect(normalizeAgentErrorConfig({})).toMatchObject({ max_per_window: 3, window_minutes: 5, min_severity: null, sources: [] })
    expect(normalizeAgentErrorConfig({ max_per_window: 500, window_minutes: 0, sources: ['bogus', 'workflow'] })).toMatchObject({ max_per_window: 50, window_minutes: 1, sources: ['workflow'] })
  })
})

describe('validation', () => {
  it('flags unknown values and contradictory filters', () => {
    expect(validateAgentErrorConfig({})).toEqual([])
    expect(validateAgentErrorConfig({ sources: ['nope'], error_kinds: ['weird'], min_severity: 'loud', max_per_window: 0, window_minutes: 2000 })).toEqual([
      'Unknown source: nope', 'Unknown error kind: weird', 'Minimum severity must be warning, error or critical',
      'Runs per window must be a whole number from 1 to 50', 'Window must be 1–1440 minutes',
    ])
    expect(validateAgentErrorConfig({ sources: ['system_agent'], agent_ids: [AGENT] })[0]).toMatch(/Agents only filter/)
    expect(validateAgentErrorConfig({ sources: ['workflow'], profile_ids: ['hr'] })[0]).toMatch(/Profiles only filter/)
    expect(validateNode({ id: 't', type: 'agent_error', label: 'x', position: { x: 0, y: 0 }, config: { error_kinds: ['weird'] } } as any)).toContain('Unknown error kind: weird')
  })

  it('canvas summary', () => {
    expect(getNodeConfigSummary({ type: 'agent_error', config: {} } as any)).toBe('Any agent')
    expect(getNodeConfigSummary({ type: 'agent_error', config: { sources: ['system_agent'], error_kinds: ['out_of_credit'], min_severity: 'critical' } } as any)).toBe('The Agent (chat assistant) · 1 error kind · critical+')
  })
})

describe('payload', () => {
  it('flat variables and the agent_error object, with no secrets, raw bodies or prompts', () => {
    const p = agentErrorPayload(event({ userId: 'u-1' }), 2)
    expect(Object.keys(p).sort()).toEqual([...AGENT_ERROR_VARIABLES].sort())
    expect(p).toMatchObject({
      agent_error_kind: 'rate_limited', agent_error_code: 'rate_limited', agent_error_severity: 'warning', agent_error_source: 'workflow',
      agent_error_agent_id: AGENT, agent_error_agent_name: 'Invoice reader', agent_error_workflow_name: 'Invoices', agent_error_step: 'Read invoice',
      agent_error_run_id: 'run-1', agent_error_attempts: 4, agent_error_request_id: 'req_1', agent_error_tenant_id: TENANT,
      agent_error_suppressed: 2, agent_error_depth: 1, agent_error_user_id: 'u-1',
    })
    expect((p.agent_error as any).kind).toBe('rate_limited')
    expect(p.agent_error_summary).toBe('Anthropic · HTTP 429 · rate_limit_exceeded · rate_limit_error · request req_1 · 4 attempts')
    const text = JSON.stringify(p)
    expect(text).not.toMatch(/sk-live|Rate limit exceeded for key|"error":\{|Bearer|authorization/i)
    // A person is an id only.
    expect(text).not.toMatch(/email|user_name/)
  })

  it('agent failures without a provider view get a fixed, content-free reason', () => {
    expect(agentFailureReason('max_iterations')).toEqual({ code: 'unknown', message: 'The agent stopped: it reached its step limit.', summary: 'max_iterations' })
    expect(agentFailureReason('timeout').code).toBe('timeout')
    expect(agentFailureReason('<script>x').summary).toBe('scriptx')
  })

  it('a nested depth counts up (loop guard)', () => {
    expect(agentErrorPayload(event({ depth: 1 })).agent_error_depth).toBe(2)
  })
})

describe('dispatch', () => {
  const store = () => createMemoryCacheStore()

  it('queues every matching active workflow of the failing run\'s workspace only, with the payload', async () => {
    const { db, enqueued, queries } = fakeDb([
      { id: 'wf-a', tenant_id: TENANT, trigger_type: 'agent_error', nodes: trigger({ sources: ['workflow'] }) },
      { id: 'wf-b', tenant_id: TENANT, trigger_type: 'agent_error', nodes: trigger({ sources: ['system_agent'] }) },
      { id: 'wf-c', tenant_id: OTHER_TENANT, trigger_type: 'agent_error', nodes: trigger() },
      { id: 'wf-d', tenant_id: TENANT, trigger_type: 'agent_error', is_active: false, nodes: trigger() },
      { id: 'wf-src', tenant_id: TENANT, trigger_type: 'webhook_received', name: 'Invoices', nodes: [] },
    ])
    const kick = vi.fn()
    const r = await reportAgentError(db, event(), { store: store(), kick })
    expect(r).toEqual({ started: 1, suppressed: 0 })
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]).toMatchObject({ p_workflow_id: 'wf-a', p_tenant_id: TENANT, p_trigger_type: 'agent_error', p_task_id: null })
    expect(enqueued[0].p_trigger_data).toMatchObject({ _version_id: null, agent_error_kind: 'rate_limited', agent_error_source: 'workflow', agent_error_depth: 1 })
    expect(kick).toHaveBeenCalledOnce()
    // Every workflows query is scoped to the tenant.
    for (const q of queries.filter((q) => q.table === 'workflows')) expect(q.filters.tenant_id).toBe(TENANT)
  })

  it.each([
    ['workflow', {}],
    ['agent_run', { workflowId: null, runId: null, stepLabel: null }],
    ['system_agent', { agentId: null, agentName: null, profileId: 'hr', profileName: 'HR', conversationId: 'c1', userId: 'u-1', workflowId: null }],
  ] as const)('fires on a final failure from source %s', async (source, over) => {
    const { db, enqueued } = fakeDb([{ id: 'wf-a', tenant_id: TENANT, trigger_type: 'agent_error', nodes: trigger({ sources: [source] }) }])
    const r = await reportAgentError(db, event({ source, ...over }), { store: store(), kick: () => {} })
    expect(r.started).toBe(1)
    expect(enqueued[0].p_trigger_data.agent_error_source).toBe(source)
  })

  it('never for a stopped run or a test run', async () => {
    const { db, enqueued } = fakeDb([{ id: 'wf-a', tenant_id: TENANT, trigger_type: 'agent_error', nodes: trigger() }])
    expect(await reportAgentError(db, event({ code: 'cancelled' }), { store: store() })).toMatchObject({ started: 0, skipped: 'cancelled' })
    expect(await reportAgentError(db, { ...event(), test: true }, { store: store() })).toMatchObject({ started: 0, skipped: 'test' })
    expect(enqueued).toHaveLength(0)
  })

  it('loop guard: a run started by the trigger (depth) or a workflow that starts on agent_error never reports', async () => {
    const { db, enqueued } = fakeDb([
      { id: 'wf-handler', tenant_id: TENANT, trigger_type: 'agent_error', name: 'Handler', nodes: trigger() },
    ])
    expect(await reportAgentError(db, event({ depth: 1, workflowId: 'some-sub-workflow' }), { store: store() })).toMatchObject({ started: 0, skipped: 'loop' })
    // The depth variable was cleared, but the agent failed inside the handler workflow itself.
    expect(await reportAgentError(db, event({ depth: 0, workflowId: 'wf-handler' }), { store: store() })).toMatchObject({ started: 0, skipped: 'loop' })
    expect(enqueued).toHaveLength(0)
  })

  it('de-dupe: at most N per agent and kind per window; the next run says how many were skipped', async () => {
    const s = store()
    const { db, enqueued } = fakeDb([{ id: 'wf-a', tenant_id: TENANT, trigger_type: 'agent_error', nodes: trigger({ max_per_window: 2, window_minutes: 5 }) }])
    const results = []
    for (let i = 0; i < 6; i++) results.push(await reportAgentError(db, event(), { store: s, kick: () => {} }))
    expect(results.map((r) => r.started)).toEqual([1, 1, 0, 0, 0, 0])
    expect(results.map((r) => r.suppressed)).toEqual([0, 0, 1, 1, 1, 1])
    // Another kind or another agent has its own window.
    expect((await reportAgentError(db, event({ code: 'quota' }), { store: s, kick: () => {} })).started).toBe(1)
    expect((await reportAgentError(db, event({ agentId: 'aaaaaaaa-0000-4000-8000-000000000002' }), { store: s, kick: () => {} })).started).toBe(1)
    expect(enqueued).toHaveLength(4)
  })

  it('admitAgentError carries the skipped count into the next admitted event', async () => {
    vi.useFakeTimers()
    try {
      const s = store()
      const cfg = { max_per_window: 1, window_minutes: 1 }
      expect(await admitAgentError(s, 'k', cfg)).toEqual({ ok: true, suppressed: 0 })
      expect(await admitAgentError(s, 'k', cfg)).toEqual({ ok: false, suppressed: 0 })
      expect(await admitAgentError(s, 'k', cfg)).toEqual({ ok: false, suppressed: 0 })
      vi.advanceTimersByTime(61_000)
      expect(await admitAgentError(s, 'k', cfg)).toEqual({ ok: true, suppressed: 2 })
      expect(await admitAgentError(s, 'k', cfg)).toEqual({ ok: false, suppressed: 0 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('never throws (a failing database is logged, not raised)', async () => {
    const db: any = { from: () => { throw new Error('db down') } }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(reportAgentError(db, event(), { store: store() })).resolves.toMatchObject({ started: 0, skipped: 'error' })
    warn.mockRestore()
  })
})

describe('sample workflow: when an agent fails, notify the workspace admins and open a task', () => {
  it('validates and is wired', () => {
    for (const node of AGENT_FAILURE_RECIPE.nodes) expect(validateNode(node as any), node.id).toEqual([])
    const warnings = validateWorkflowWiring({
      nodes: AGENT_FAILURE_RECIPE.nodes as any, edges: AGENT_FAILURE_RECIPE.edges as any,
      workflowVariables: [{ name: 'admin_email', type: 'string' }, { name: 'admins_team_id', type: 'string' }] as any,
    })
    expect(warnings.map(formatWiringWarning)).toEqual([])
  })

  it('a misspelt trigger variable is caught by the wiring check', () => {
    const nodes = AGENT_FAILURE_RECIPE.nodes.map((n) => n.id === 'notify_admins' ? { ...n, config: { ...n.config, subject: '{{agent_error_kinds}}' } } : n)
    const warnings = validateWorkflowWiring({ nodes: nodes as any, edges: AGENT_FAILURE_RECIPE.edges as any, workflowVariables: [{ name: 'admin_email' }, { name: 'admins_team_id' }] as any })
    expect(warnings.map(formatWiringWarning).join('\n')).toMatch(/agent_error_kinds/)
  })
})
