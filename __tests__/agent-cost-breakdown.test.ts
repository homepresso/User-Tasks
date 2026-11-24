import { describe, expect, it, vi } from 'vitest'
import { createMemorySupabase } from './fixtures/supabase-memory'
import { workspaceAgentUsage, workspaceCostBreakdown } from '@/lib/services/agents'
import { getWorkspaceAgentUsageEndpoint } from '@/lib/api-schemas/agents'
import {
  breakdownCsv, cubeFromAgentRuns, cubeFromAssistantUsage, cubeFromRpc, parseGroupBy, PeriodError, periodBounds, resolvePeriod, rollupBreakdown,
  type CubeRow,
} from '@/lib/agents/cost-breakdown'
import type { ModelPrice } from '@/lib/agents/pricing'

vi.mock('@/lib/config/instance-settings', () => ({ getInstanceSetting: async () => null }))

const NOW = new Date('2026-11-22T15:00:00Z')

const price = (provider: string, model: string, input: number, output: number, cached: number | null = null): ModelPrice =>
  ({ provider, model, input_per_1m: input, output_per_1m: output, cached_input_per_1m: cached, currency: 'USD', effective_date: '2026-01-01' })

const LAYERS = { workspace: [price('openai', 'gpt-test', 2, 8, 0.5)], instance: [], defaults: [] }

const row = (over: Partial<CubeRow>): CubeRow => ({
  day: '2026-11-20', source: 'assistant', provider: 'openai', model: 'gpt-test', agent_id: null, profile: null, capability: 'task', user_id: 'u1',
  cost_status: 'priced', cost_currency: 'USD', calls: 1, input_tokens: 1000, output_tokens: 100, cached_tokens: 0, cache_write_tokens: 0, total_tokens: 1100, cost_amount: 0.01,
  ...over,
})

describe('resolvePeriod', () => {
  it('presets cover inclusive UTC days', () => {
    expect(resolvePeriod({ preset: '7d' }, NOW)).toMatchObject({ from: '2026-11-16', to: '2026-11-22', preset: '7d' })
    expect(resolvePeriod({ preset: '7d' }, NOW).days).toHaveLength(7)
    expect(resolvePeriod({ preset: 'this_month' }, NOW)).toMatchObject({ from: '2026-11-01', to: '2026-11-22' })
    expect(resolvePeriod({ preset: 'last_month' }, NOW)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' })
    expect(resolvePeriod({ preset: 'last_month' }, new Date('2026-01-05T00:00:00Z'))).toMatchObject({ from: '2025-12-01', to: '2025-12-31' })
    expect(resolvePeriod({}, NOW)).toMatchObject({ from: '2026-10-24', to: '2026-11-22', preset: '30d' })
  })
  it('custom ranges are validated and bounded', () => {
    expect(resolvePeriod({ from: '2026-02-27', to: '2026-03-02' }, NOW).days).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'])
    expect(() => resolvePeriod({ from: '2026-03-02', to: '2026-03-01' }, NOW)).toThrow(PeriodError)
    expect(() => resolvePeriod({ from: '2026-02-30' }, NOW)).toThrow(PeriodError)
    expect(() => resolvePeriod({ from: '2024-01-01', to: '2026-01-01' }, NOW)).toThrow(/at most 366/)
    expect(() => resolvePeriod({ preset: 'forever' }, NOW)).toThrow(PeriodError)
  })
  it('bounds are [from 00:00, day after to 00:00)', () => {
    expect(periodBounds({ from: '2026-10-01', to: '2026-10-31' })).toEqual({ fromIso: '2026-10-01T00:00:00.000Z', toIso: '2026-11-01T00:00:00.000Z' })
  })
})

describe('cube builders', () => {
  it('agent runs: source by caller, provider from the price snapshot (not *), cached tokens from usage, unpriced keeps no cost', () => {
    const cube = cubeFromAgentRuns([
      { started_at: '2026-11-20T10:00:00Z', caller_type: 'workflow_node', agent_id: 'a1', model: 'gpt-test', price: { provider: 'openai' }, cost_status: 'priced', cost_currency: 'USD', cost_amount: '0.5', input_tokens: 100, output_tokens: 10, total_tokens: 110, usage: { cached_tokens: 40 } },
      { started_at: '2026-11-20T11:00:00Z', caller_type: 'workflow_node', agent_id: 'a1', model: 'gpt-test', price: { provider: 'openai' }, cost_status: 'priced', cost_currency: 'USD', cost_amount: 0.25, input_tokens: 100, output_tokens: 10, total_tokens: 110, usage: {} },
      { started_at: '2026-11-21T10:00:00Z', caller_type: 'api', agent_id: 'a2', model: 'local', price: { provider: '*' }, cost_status: 'unknown', input_tokens: 5, output_tokens: 5, total_tokens: null },
      { started_at: 'bad', agent_id: 'a3' },
    ])
    expect(cube).toHaveLength(2)
    expect(cube[0]).toMatchObject({ source: 'workflow_agent', provider: 'openai', calls: 2, cached_tokens: 40, cost_amount: 0.75, total_tokens: 220 })
    expect(cube[1]).toMatchObject({ source: 'agent', provider: null, cost_status: 'unknown', cost_amount: null, total_tokens: 10 })
  })
  it('assistant usage: source column (absent = assistant), profile from model_rule, user kept', () => {
    const cube = cubeFromAssistantUsage([
      { created_at: '2026-11-20T10:00:00Z', provider: 'anthropic', model: 'claude-x', model_rule: 'p1', capability: 'designer', user_id: 'u1', cost_status: 'priced', cost_currency: 'USD', cost_amount: 1, prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cached_tokens: 3 },
      { created_at: '2026-11-20T12:00:00Z', provider: 'anthropic', model: 'claude-x', capability: 'designer', user_id: 'u1', cost_status: 'priced', cost_currency: 'USD', cost_amount: 1, prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, source: 'pdf_import' },
    ])
    expect(cube.map((r) => [r.source, r.profile, r.cached_tokens])).toEqual([['assistant', 'p1', 3], ['pdf_import', null, 0]])
  })
  it('rpc rows: numeric strings become numbers', () => {
    const [r] = cubeFromRpc([{ day: '2026-11-20', source: 'agent', calls: '3', input_tokens: '10', output_tokens: '5', cached_tokens: '0', cache_write_tokens: '0', total_tokens: '15', cost_status: 'priced', cost_currency: 'USD', cost_amount: '0.0300000000' }])
    expect(r).toMatchObject({ calls: 3, total_tokens: 15, cost_amount: 0.03 })
  })
})

describe('rollupBreakdown', () => {
  const period = resolvePeriod({ preset: '7d' }, NOW)
  const cube: CubeRow[] = [
    row({ cost_amount: 0.03, calls: 3, profile: 'p1', capability: 'designer' }),
    row({ day: '2026-11-21', provider: 'anthropic', model: 'claude-x', cost_amount: 0.01, profile: null }),
    // recorded without a cost, model priced today → estimated (1000 in, 400 cached, 100 out at 2 / 0.5 / 8)
    row({ day: '2026-11-21', source: 'workflow_agent', agent_id: 'a1', user_id: null, capability: null, cost_status: 'unknown', cost_currency: null, cost_amount: null, cached_tokens: 400, provider: null }),
    // no price at all → unknown
    row({ source: 'agent', agent_id: 'a2', user_id: null, provider: 'ollama', model: 'llama', cost_status: 'unknown', cost_currency: null, cost_amount: null }),
    // outside the period
    row({ day: '2026-11-01', cost_amount: 100 }),
    // other currency
    row({ source: 'agent', agent_id: 'a2', user_id: null, cost_currency: 'EUR', cost_amount: 5 }),
  ]
  const names = { agents: { a1: { name: 'Triage', provider: 'openai' }, a2: { name: 'Local' } }, profiles: { p1: { name: 'Builders', monthly_cost_cap: 50 } }, capabilities: { designer: 'Building help', task: 'Task help' } }
  const b = rollupBreakdown({ cube, period, currency: 'USD', layers: LAYERS, names, groupBy: ['day', 'model', 'profile', 'agent', 'source', 'user'] })
  const estimate = (600 * 2 + 400 * 0.5 + 100 * 8) / 1_000_000

  it('totals: period boundary, stored vs estimated, unknown calls, cached tokens, other currencies', () => {
    expect(b.totals.calls).toBe(7)
    expect(b.totals.cost).toEqual({ USD: 0.04, EUR: 5 })
    expect(b.totals.estimated_cost.USD).toBeCloseTo(estimate, 10)
    expect(b.totals.unpriced_calls).toBe(2)
    expect(b.totals.unknown_calls).toBe(1)
    expect(b.totals.cached_tokens).toBe(400)
    expect(b.totals.main_cost).toBeCloseTo(0.04 + estimate, 10)
    expect(b.estimated).toBe(true)
  })

  it('by model: provider filled from the agent, unknown price flagged, share and per-1k in the main currency', () => {
    const m = b.groups.model!
    const gpt = m.find((r) => r.key === 'openai:gpt-test')!
    expect(gpt.calls).toBe(5) // 3 + estimated 1 + EUR 1
    expect(gpt.cost).toEqual({ USD: 0.03, EUR: 5 })
    expect(gpt.price_missing).toBe(false)
    const llama = m.find((r) => r.key === 'ollama:llama')!
    expect(llama).toMatchObject({ price_missing: true, unknown_calls: 1, share: 0, cost_per_1k: null })
    expect(m.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 10)
    expect(m[0].key).toBe('openai:gpt-test')
    expect(gpt.trend).toHaveLength(7)
    expect(gpt.trend[4]).toBeCloseTo(0.03, 10) // 2026-11-20
  })

  it('by profile: assistant sources only, Default for none, capabilities and the cap', () => {
    const p = b.groups.profile!
    expect(p.map((r) => r.label).sort()).toEqual(['Builders', 'Default'])
    const builders = p.find((r) => r.key === 'p1')!
    expect(builders).toMatchObject({ calls: 3, monthly_cost_cap: 50, models: ['openai:gpt-test'] })
    expect(builders.capabilities).toEqual([{ capability: 'designer', label: 'Building help', calls: 3, cost: 0.03 }])
  })

  it('by source, agent and person', () => {
    expect(b.groups.source!.map((r) => r.key).sort()).toEqual(['agent', 'assistant', 'workflow_agent'])
    expect(b.groups.agent!.map((r) => r.label).sort()).toEqual(['Local', 'Triage'])
    expect(b.groups.user!.map((r) => r.key)).toEqual(['u1'])
    expect(b.groups.day!.map((r) => r.key)).toEqual(['2026-11-20', '2026-11-21'])
  })

  it('filters (cross-filter) narrow every group; profile filter drops agent runs', () => {
    const f = rollupBreakdown({ cube, period, currency: 'USD', layers: LAYERS, names, filters: { provider: 'openai', model: 'gpt-test' }, groupBy: ['source'] })
    expect(f.totals.calls).toBe(5)
    const p = rollupBreakdown({ cube, period, currency: 'USD', layers: LAYERS, names, filters: { profile: 'default' }, groupBy: ['source'] })
    expect(p.groups.source!.map((r) => r.key)).toEqual(['assistant'])
    expect(p.totals.calls).toBe(1)
    const a = rollupBreakdown({ cube, period, currency: 'USD', layers: LAYERS, names, filters: { agent: 'a1' } })
    expect(a.totals.calls).toBe(1)
  })

  it('series: per day, top keys by cost', () => {
    expect(b.series.model.keys[0]).toBe('openai:gpt-test')
    expect(b.series.model.points).toHaveLength(7)
    expect(b.series.profile.keys).toContain('p1')
  })

  it('CSV: header, values, formula-safe labels', () => {
    const csv = breakdownCsv([{ ...b.groups.model![0], label: '=HYPERLINK("x")' }], 'model', 'USD')
    const [head, line] = csv.trim().split('\n')
    expect(head).toBe('provider,model,calls,input_tokens,output_tokens,cached_tokens,total_tokens,cost_usd,estimated_usd,other_currencies,cost_unknown_calls,share,cost_per_1k_tokens_usd')
    expect(line.startsWith('openai,"\'=HYPERLINK(""x"")",5,')).toBe(true)
  })
})

describe('parseGroupBy', () => {
  it('accepts known names, rejects others', () => {
    expect(parseGroupBy('model, profile,model')).toEqual(['model', 'profile'])
    expect(() => parseGroupBy('model,cost')).toThrow(/group_by/)
  })
})

/* ── Service / API: permissions, group_by, filters ── */


describe('workspace cost breakdown service', () => {
  const today = new Date().toISOString()
  const db = createMemorySupabase({
    agents: [{ id: 'a1', tenant_id: 'ta', name: 'Triage', integration_id: null }],
    agent_runs: [
      { id: 'r1', tenant_id: 'ta', agent_id: 'a1', started_at: today, caller_type: 'api', model: 'gpt-test', price: { provider: 'openai' }, status: 'completed', cost_status: 'priced', cost_currency: 'USD', cost_amount: 1, input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      { id: 'r2', tenant_id: 'tb', agent_id: 'b1', started_at: today, model: 'gpt-test', status: 'completed', cost_status: 'priced', cost_currency: 'USD', cost_amount: 50, input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    ],
    assistant_usage: [
      { id: 'q1', tenant_id: 'ta', created_at: today, provider: 'openai', model: 'gpt-test', capability: 'task', user_id: 'u1', status: 'completed', cost_status: 'priced', cost_currency: 'USD', cost_amount: 0.5, prompt_tokens: 4, completion_tokens: 1, total_tokens: 5, model_rule: null },
    ],
    users: [{ id: 'u1', display_name: 'Ana' }],
  })
  const ctx = (perms: string[]) => ({ db, supabase: db, tenantId: 'ta', actorId: 'alice', permissions: new Set(perms), authKind: 'api_key' as const, source: 'api' as const }) as never

  it('needs agents.view; scoped to the workspace; sources together', async () => {
    await expect(workspaceCostBreakdown(ctx(['reports.view']), {})).rejects.toThrow(/agents\.view/)
    const b = await workspaceCostBreakdown(ctx(['agents.view']), { period: '7d' })
    expect(b.totals.calls).toBe(2)
    expect(b.totals.cost).toEqual({ USD: 1.5 })
    expect(b.groups.source!.map((r) => r.key).sort()).toEqual(['agent', 'assistant'])
    expect(b.aggregated_in).toBe('app')
  })

  it('group_by user needs assistants.manage (admins of the Agent)', async () => {
    await expect(workspaceCostBreakdown(ctx(['agents.view']), { group_by: 'user' })).rejects.toThrow(/assistants\.manage/)
    await expect(workspaceCostBreakdown(ctx(['agents.view']), { user: 'u1' })).rejects.toThrow(/assistants\.manage/)
    const b = await workspaceCostBreakdown(ctx(['agents.view', 'assistants.manage']), { group_by: 'user' })
    expect(b.groups.user).toEqual([expect.objectContaining({ key: 'u1', label: 'Ana', calls: 1 })])
    expect(Object.keys(b.groups)).toEqual(['user'])
  })

  it('filters and validation', async () => {
    const f = await workspaceCostBreakdown(ctx(['agents.view']), { source: 'assistant', group_by: 'model' })
    expect(f.totals.calls).toBe(1)
    const p = await workspaceCostBreakdown(ctx(['agents.view']), { agent_profile: 'default', group_by: 'profile' })
    expect(p.groups.profile!.map((r) => r.label)).toEqual(['Default'])
    await expect(workspaceCostBreakdown(ctx(['agents.view']), { group_by: 'cost' })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(workspaceCostBreakdown(ctx(['agents.view']), { from: '2026-05-02', to: '2026-05-01' })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('GET /agents/usage: breakdown only when asked for', async () => {
    const plain = await workspaceAgentUsage(ctx(['agents.view']), 30, {}) as Record<string, unknown>
    expect(plain.breakdown).toBeUndefined()
    const withBreakdown = await workspaceAgentUsage(ctx(['agents.view']), 30, { group_by: 'model,source' }) as { breakdown: { groups: Record<string, unknown> }; agents: unknown }
    expect(Object.keys(withBreakdown.breakdown.groups)).toEqual(['model', 'source'])
    expect(withBreakdown.agents).toBeDefined()
  })

  it('the endpoint query accepts the breakdown parameters and rejects bad ones', () => {
    const q = getWorkspaceAgentUsageEndpoint.query!
    expect(q.parse({ group_by: 'model', period: 'last_month', source: 'workflow_agent', agent_profile: 'p1' })).toMatchObject({ period: 'last_month' })
    expect(() => q.parse({ period: 'forever' })).toThrow()
    expect(() => q.parse({ source: 'bogus' })).toThrow()
    expect(() => q.parse({ from: '05/01/2026' })).toThrow()
  })
})
