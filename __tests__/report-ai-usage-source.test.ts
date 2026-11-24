import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemorySupabase } from './fixtures/supabase-memory'

const service = vi.hoisted(() => ({ db: null as any })) // eslint-disable-line @typescript-eslint/no-explicit-any
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: () => service.db }))
vi.mock('@/lib/config/instance-settings', () => ({ getInstanceSetting: async () => null }))

import { aiUsageBounds, buildAiUsageRows } from '@/lib/reports/ai-usage-source'
import { AI_USAGE_REPORTS } from '@/lib/reports/ai-usage-reports'
import { REPORT_SOURCES } from '@/lib/report-sources'
import { reportChartIssues } from '@/lib/report-charts'
import { assertReportSourceAccess, buildSourceSpecificRecipes, configReadsAiUsagePeople, executeReportPreview, inspectReportConfigIssues, reportSourcePermission } from '@/lib/mcp/tools/reports'

const T = 'tenant-1'
const OTHER = 'tenant-2'

function seed() {
  return createMemorySupabase({
    agents: [{ id: 'a1', tenant_id: T, name: 'Triage', integration_id: 'i1' }],
    integrations: [{ id: 'i1', tenant_id: T, type: 'openai', base_url: 'https://api.openai.com/v1' }],
    agent_runs: [
      // priced, in a workflow
      { id: 'r1', tenant_id: T, agent_id: 'a1', started_at: '2026-11-20T10:00:00.000Z', caller_type: 'workflow_node', workflow_run_id: 'w1', model: 'gpt-4.1', price: { provider: 'openai' }, status: 'completed', cost_status: 'priced', cost_currency: 'USD', cost_amount: 0.5, input_tokens: 1000, output_tokens: 100, total_tokens: 1100, usage: { cached_tokens: 200 }, duration_ms: 1200, initiated_by: 'u1' },
      // recorded without a cost, model priced in the shipped list → estimated
      { id: 'r2', tenant_id: T, agent_id: 'a1', started_at: '2026-11-21T10:00:00.000Z', caller_type: 'api', model: 'gpt-4.1', price: null, status: 'failed', error: 'boom', cost_status: 'unknown', input_tokens: 1_000_000, output_tokens: 0, total_tokens: 1_000_000, duration_ms: 800 },
      // another workspace: never read
      { id: 'r3', tenant_id: OTHER, agent_id: 'x', started_at: '2026-11-21T10:00:00.000Z', model: 'gpt-4.1', status: 'completed', cost_status: 'priced', cost_currency: 'USD', cost_amount: 99, input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    ],
    assistant_usage: [
      { id: 'q1', tenant_id: T, created_at: '2026-11-21T12:00:00.000Z', provider: 'ollama', model: 'llama3', capability: 'task', user_id: 'u2', status: 'completed', llm_calls: 1, cost_status: 'unknown', prompt_tokens: 50, completion_tokens: 5, total_tokens: 55, model_rule: 'p1', source: null, cached_tokens: 0 },
      { id: 'q2', tenant_id: T, created_at: '2026-11-22T12:00:00.000Z', provider: 'anthropic', model: 'claude-x', capability: 'designer', user_id: 'u2', status: 'completed', llm_calls: 1, cost_status: 'priced', cost_currency: 'USD', cost_amount: 0.25, prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, source: 'pdf_import' },
    ],
    assistant_settings: [{ tenant_id: T, capabilities: { version: 3, profiles: [{ id: 'p1', name: 'Builders', users: [], teams: [], roles: [], areas: [] }] } }],
    users: [{ id: 'u1', display_name: 'Ana', email: 'ana@example.com' }, { id: 'u2', display_name: 'Ben', email: 'ben@example.com' }],
  })
}

describe('Agents & AI usage source: rows', () => {
  it('one row per agent run and Agent request of the workspace, with source, provider, cost status and outcome', async () => {
    const rows = await buildAiUsageRows(seed(), T, { canSeePeople: false })
    expect(rows.map((r) => r.id)).toEqual(['agent:q2', 'agent:q1', 'run:r2', 'run:r1'])
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(byId['run:r1']).toMatchObject({ source: 'workflow_agent', provider: 'openai', cost_amount: 0.5, cost_status: 'priced', cost_estimated: false, cached_tokens: 200, outcome: 'success', error_percent: 0, day: '2026-11-20', month: '2026-11', week: '2026-11-16', agent_name: 'Triage' })
    // provider from the agent's connection; 1M input tokens of gpt-4.1 at today's list price
    expect(byId['run:r2']).toMatchObject({ source: 'agent', provider: 'openai', cost_status: 'estimated', cost_estimated: true, outcome: 'error', error_percent: 100, error: 'boom' })
    expect(byId['run:r2'].cost_amount).toBeGreaterThan(0)
    expect(byId['agent:q1']).toMatchObject({ source: 'assistant', profile_name: 'Builders', cost_status: 'unknown', cost_amount: null })
    expect(byId['agent:q2']).toMatchObject({ source: 'pdf_import', source_label: 'PDF import AI assist', profile_id: 'default', profile_name: 'Default' })
    expect(rows.some((r) => r.cost_amount === 99)).toBe(false)
    // no person columns without assistants.manage
    expect(Object.keys(byId['agent:q1'])).not.toContain('user_name')
  })

  it('person columns only for people who may see them', async () => {
    const rows = await buildAiUsageRows(seed(), T, { canSeePeople: true })
    expect(rows.find((r) => r.id === 'agent:q1')).toMatchObject({ user_id: 'u2', user_name: 'Ben' })
    expect(rows.find((r) => r.id === 'run:r1')).toMatchObject({ user_id: 'u1', user_name: 'Ana' })
  })

  it('date bounds from filters and the date range are pushed into the queries', async () => {
    const bounds = aiUsageBounds({ filters: [{ field: 'occurred_at', operator: 'gte', value: '2026-11-21T00:00:00.000Z' }], date_range: { field: 'occurred_at', to: '2026-11-21T23:59:59.000Z' } })
    expect(bounds.fromIso).toBe('2026-11-21T00:00:00.000Z')
    const rows = await buildAiUsageRows(seed(), T, { canSeePeople: false, bounds })
    expect(rows.map((r) => r.id).sort()).toEqual(['agent:q1', 'run:r2'])
  })
})

describe('Agents & AI usage source: permissions', () => {
  it('needs agents.view; person columns need assistants.manage', () => {
    expect(reportSourcePermission('ai_usage')).toBe('agents.view')
    expect(() => assertReportSourceAccess({ data_source: 'ai_usage', columns: ['model'] }, ['reports.view'])).toThrow(/agents\.view/)
    expect(() => assertReportSourceAccess({ data_source: 'ai_usage', columns: ['model'] }, ['reports.view', 'agents.view'])).not.toThrow()
    expect(() => assertReportSourceAccess({ data_source: 'ai_usage', columns: ['model'], group_by: ['team_name'] }, ['reports.view', 'agents.view'])).toThrow(/assistants\.manage/)
    expect(() => assertReportSourceAccess({ data_source: 'ai_usage', columns: ['user_name'] }, ['reports.view', 'agents.view', 'assistants.manage'])).not.toThrow()
    expect(configReadsAiUsagePeople({ data_source: 'ai_usage', columns: ['model'], charts: [{ id: 'c', title: 'x', type: 'bar', dimension: { field: 'user_name' }, measure: { fn: 'count' } }] })).toBe(true)
    expect(configReadsAiUsagePeople({ data_source: 'tasks', columns: ['user_name'] })).toBe(false)
  })
})

describe('Agents & AI usage source: report engine', () => {
  beforeEach(() => { service.db = null })

  it('groups and aggregates (sum cost by model), sorted, with the service client when permissions are known', async () => {
    const db = seed()
    service.db = db
    const result = await executeReportPreview({} as never, T, {
      data_source: 'ai_usage', columns: ['model', 'SUM_cost_amount', 'COUNT_id', 'AVG_duration_ms'], filters: [],
      group_by: ['model'], aggregations: [{ field: 'cost_amount', fn: 'SUM' }, { field: 'id', fn: 'COUNT' }, { field: 'duration_ms', fn: 'AVG' }],
      sort: { field: 'COUNT_id', direction: 'desc' }, visualization: 'bar',
    }, null, ['reports.view', 'agents.view'])
    expect(result.data[0]).toMatchObject({ model: 'gpt-4.1', COUNT_id: 2, AVG_duration_ms: 1000 })
    expect(result.data[0].SUM_cost_amount).toBeGreaterThan(0.5)
    expect(result.data.find((r: { model: string }) => r.model === 'llama3')).toMatchObject({ COUNT_id: 1, SUM_cost_amount: 0, AVG_duration_ms: 0 })
    expect(result.total).toBe(3)
  })

  it('filters rows (source) and refuses without agents.view', async () => {
    const db = seed()
    const result = await executeReportPreview(db, T, { data_source: 'ai_usage', columns: ['id'], filters: [{ field: 'source', operator: 'eq', value: 'workflow_agent' }], visualization: 'table' }, null, null)
    expect(result.data.map((r: { id: string }) => r.id)).toEqual(['run:r1'])
    await expect(executeReportPreview(db, T, { data_source: 'ai_usage', columns: ['id'], filters: [], visualization: 'table' }, null, ['reports.view'])).rejects.toThrow(/agents\.view/)
  })
})

describe('Ready-made AI usage reports', () => {
  const source = REPORT_SOURCES.find((s) => s.key === 'ai_usage')!
  const columns = source.columns.map((c) => c.key)

  it('the source is registered as a virtual Agents source with no person column in any template', () => {
    expect(source).toMatchObject({ virtual: true, category: 'Agents' })
    for (const report of AI_USAGE_REPORTS) expect(configReadsAiUsagePeople(report.config)).toBe(false)
  })

  it.each(AI_USAGE_REPORTS.map((r) => [r.name, r] as const))('%s is a valid report with valid charts', (_name, report) => {
    expect(report.config.data_source).toBe('ai_usage')
    expect(inspectReportConfigIssues(report.config).issues).toEqual([])
    expect(reportChartIssues(report.config.charts ?? [], columns)).toEqual([])
  })

  it('covers the asked-for reports and doubles as the source\'s MCP recipes', () => {
    expect(AI_USAGE_REPORTS.map((r) => r.name)).toEqual(['AI spend by model', 'AI spend by profile', 'Agent usage over time', 'Top agents by cost', 'Token usage by source', 'AI errors', 'Cost per workflow run for AI steps'])
    expect(buildSourceSpecificRecipes(source).map((r) => r.name)).toEqual(AI_USAGE_REPORTS.map((r) => r.name))
  })

  it('every template runs through the engine', async () => {
    for (const report of AI_USAGE_REPORTS) {
      const result = await executeReportPreview(seed(), T, report.config, null, null)
      expect(Array.isArray(result.data)).toBe(true)
    }
  })
})
