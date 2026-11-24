/**
 * Ready-made reports over the "Agents & AI usage" source (lib/reports/
 * ai-usage-source.ts), offered in the Reports hub (agents.view): adding one
 * saves an ordinary report for the person — editable in the builder,
 * shareable, exportable, usable in app report widgets — so the usual report
 * sharing rules apply. Also the source's MCP recipes.
 *
 * Every report reads the newest calls (at most 10,000 agent runs and 10,000
 * Agent requests); add a date range in the builder to pin a period.
 */
import type { ReportConfig } from '@/lib/report-sources'

export interface AiUsageReportTemplate {
  key: string
  name: string
  description: string
  config: ReportConfig
}

const base = { data_source: 'ai_usage', filters: [] } as const

export const AI_USAGE_REPORTS: AiUsageReportTemplate[] = [
  {
    key: 'ai_spend_by_model',
    name: 'AI spend by model',
    description: 'Cost, tokens and calls per provider and model, with the share of cost.',
    config: {
      ...base, filters: [],
      columns: ['model', 'provider', 'COUNT_id', 'SUM_input_tokens', 'SUM_output_tokens', 'SUM_cached_tokens', 'SUM_cost_amount'],
      group_by: ['model', 'provider'],
      aggregations: [{ field: 'id', fn: 'COUNT' }, { field: 'input_tokens', fn: 'SUM' }, { field: 'output_tokens', fn: 'SUM' }, { field: 'cached_tokens', fn: 'SUM' }, { field: 'cost_amount', fn: 'SUM' }],
      visualization: 'bar',
      sort: { field: 'SUM_cost_amount', direction: 'desc' },
      charts: [
        { id: 'cost', title: 'Total cost', type: 'number', measure: { fn: 'sum', field: 'cost_amount' } },
        { id: 'share', title: 'Share of cost by model', type: 'donut', dimension: { field: 'model' }, measure: { fn: 'sum', field: 'cost_amount' }, top_n: 8 },
        { id: 'per_day', title: 'Cost per day', type: 'column', dimension: { field: 'occurred_at', bucket: 'day' }, measure: { fn: 'sum', field: 'cost_amount' }, range_days: 30 },
      ],
    },
  },
  {
    key: 'ai_spend_by_profile',
    name: 'AI spend by profile',
    description: 'The in-product Agent\'s cost and tokens per Agent profile ("Default" when no profile matched).',
    config: {
      ...base,
      filters: [{ field: 'profile_name', operator: 'is_not_null', value: null }],
      columns: ['profile_name', 'COUNT_id', 'SUM_total_tokens', 'SUM_cost_amount'],
      group_by: ['profile_name'],
      aggregations: [{ field: 'id', fn: 'COUNT' }, { field: 'total_tokens', fn: 'SUM' }, { field: 'cost_amount', fn: 'SUM' }],
      visualization: 'bar',
      sort: { field: 'SUM_cost_amount', direction: 'desc' },
      charts: [
        { id: 'by_profile', title: 'Cost by profile', type: 'bar', dimension: { field: 'profile_name' }, measure: { fn: 'sum', field: 'cost_amount' }, top_n: 10 },
        { id: 'by_group', title: 'Calls by help group', type: 'donut', dimension: { field: 'capability' }, measure: { fn: 'count' } },
      ],
    },
  },
  {
    key: 'agent_usage_over_time',
    name: 'Agent usage over time',
    description: 'Agent runs, tokens and cost per day.',
    config: {
      ...base,
      filters: [{ field: 'agent_name', operator: 'is_not_null', value: null }],
      columns: ['day', 'COUNT_id', 'SUM_total_tokens', 'SUM_cost_amount'],
      group_by: ['day'],
      aggregations: [{ field: 'id', fn: 'COUNT' }, { field: 'total_tokens', fn: 'SUM' }, { field: 'cost_amount', fn: 'SUM' }],
      visualization: 'line',
      sort: { field: 'day', direction: 'asc' },
      charts: [
        { id: 'runs', title: 'Runs per day', type: 'area', dimension: { field: 'occurred_at', bucket: 'day' }, measure: { fn: 'count' }, range_days: 30 },
        { id: 'tokens', title: 'Tokens per day', type: 'line', dimension: { field: 'occurred_at', bucket: 'day' }, measure: { fn: 'sum', field: 'total_tokens' }, range_days: 30 },
        { id: 'latency', title: 'Average duration (ms)', type: 'number', measure: { fn: 'avg', field: 'duration_ms' } },
      ],
    },
  },
  {
    key: 'top_agents_by_cost',
    name: 'Top agents by cost',
    description: 'The agents that cost the most, with runs, tokens and average duration.',
    config: {
      ...base,
      filters: [{ field: 'agent_name', operator: 'is_not_null', value: null }],
      columns: ['agent_name', 'COUNT_id', 'SUM_total_tokens', 'SUM_cost_amount', 'AVG_duration_ms'],
      group_by: ['agent_name'],
      aggregations: [{ field: 'id', fn: 'COUNT' }, { field: 'total_tokens', fn: 'SUM' }, { field: 'cost_amount', fn: 'SUM' }, { field: 'duration_ms', fn: 'AVG' }],
      visualization: 'horizontal-bar',
      sort: { field: 'SUM_cost_amount', direction: 'desc' },
      row_limit: 25,
      charts: [
        { id: 'top', title: 'Cost by agent', type: 'bar', dimension: { field: 'agent_name' }, measure: { fn: 'sum', field: 'cost_amount' }, top_n: 10 },
      ],
    },
  },
  {
    key: 'token_usage_by_source',
    name: 'Token usage by source',
    description: 'Input, output and cached tokens per source: in-product Agent, workflow agents, other agent runs, PDF import, redaction AI.',
    config: {
      ...base, filters: [],
      columns: ['source_label', 'COUNT_id', 'SUM_input_tokens', 'SUM_output_tokens', 'SUM_cached_tokens', 'SUM_total_tokens', 'SUM_cost_amount'],
      group_by: ['source_label'],
      aggregations: [{ field: 'id', fn: 'COUNT' }, { field: 'input_tokens', fn: 'SUM' }, { field: 'output_tokens', fn: 'SUM' }, { field: 'cached_tokens', fn: 'SUM' }, { field: 'total_tokens', fn: 'SUM' }, { field: 'cost_amount', fn: 'SUM' }],
      visualization: 'pie',
      sort: { field: 'SUM_total_tokens', direction: 'desc' },
      charts: [
        { id: 'share', title: 'Tokens by source', type: 'donut', dimension: { field: 'source_label' }, measure: { fn: 'sum', field: 'total_tokens' } },
        { id: 'per_day', title: 'Tokens per day', type: 'column', dimension: { field: 'occurred_at', bucket: 'day' }, measure: { fn: 'sum', field: 'total_tokens' }, range_days: 30 },
      ],
    },
  },
  {
    key: 'ai_errors',
    name: 'AI errors',
    description: 'Error rate and failed calls per source and model (failed or cancelled agent runs and Agent requests).',
    config: {
      ...base, filters: [],
      columns: ['source_label', 'model', 'COUNT_id', 'AVG_error_percent'],
      group_by: ['source_label', 'model'],
      aggregations: [{ field: 'id', fn: 'COUNT' }, { field: 'error_percent', fn: 'AVG' }],
      visualization: 'table',
      sort: { field: 'AVG_error_percent', direction: 'desc' },
      charts: [
        { id: 'rate', title: 'Error rate (%)', type: 'number', measure: { fn: 'avg', field: 'error_percent' } },
        { id: 'per_day', title: 'Failed calls per day', type: 'column', dimension: { field: 'occurred_at', bucket: 'day' }, measure: { fn: 'count' }, filters: [{ field: 'outcome', operator: 'eq', value: 'error' }], range_days: 30 },
        { id: 'by_source', title: 'Failed calls by source', type: 'bar', dimension: { field: 'source_label' }, measure: { fn: 'count' }, filters: [{ field: 'outcome', operator: 'eq', value: 'error' }] },
      ],
    },
  },
  {
    key: 'ai_cost_per_workflow_run',
    name: 'Cost per workflow run for AI steps',
    description: 'What the agent steps of each workflow run cost, with the workflow.',
    config: {
      ...base,
      filters: [{ field: 'source', operator: 'eq', value: 'workflow_agent' }],
      columns: ['workflow_name', 'workflow_run_id', 'COUNT_id', 'SUM_total_tokens', 'SUM_cost_amount'],
      group_by: ['workflow_name', 'workflow_run_id'],
      aggregations: [{ field: 'id', fn: 'COUNT' }, { field: 'total_tokens', fn: 'SUM' }, { field: 'cost_amount', fn: 'SUM' }],
      visualization: 'table',
      sort: { field: 'SUM_cost_amount', direction: 'desc' },
      charts: [
        { id: 'avg_step', title: 'Average cost per AI step', type: 'number', measure: { fn: 'avg', field: 'cost_amount' } },
        { id: 'by_workflow', title: 'AI cost by workflow', type: 'bar', dimension: { field: 'workflow_name' }, measure: { fn: 'sum', field: 'cost_amount' }, top_n: 10 },
      ],
    },
  },
]

export function aiUsageReportTemplate(key: string): AiUsageReportTemplate | undefined {
  return AI_USAGE_REPORTS.find((r) => r.key === key)
}
