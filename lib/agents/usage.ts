/**
 * Agent usage and cost views (server only): per agent (designer → Settings →
 * Budgets, REST / MCP / CLI `agents usage`) and per workspace (Agents →
 * Costs & budgets, REST GET /agents/usage). Both read agent_runs with an
 * explicit tenant filter, so they work on session (RLS) and service-role
 * clients alike; callers check agents.view.
 */
import { getDb, type ServiceContext } from '@/lib/services/context'
import { normalizeAgentOutputConfig } from '@/lib/agent-knowledge'
import { DEFAULT_MODEL_PRICES, PRICES_AS_OF, summarizeUsage, type UsageSummary } from './pricing'
import { instancePrices, loadCostSettings } from './costs'

/** Earliest of `days` ago and the start of this calendar month (UTC), so month totals are complete. */
export function usageWindowStart(days: number, now: Date = new Date()): string {
  const windowStart = now.getTime() - Math.min(Math.max(days, 1), 90) * 86_400_000
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  return new Date(Math.min(windowStart, monthStart)).toISOString()
}

const COLUMNS = 'agent_id, started_at, total_tokens, status, cost_amount, cost_currency, cost_status'

async function usageRows(ctx: ServiceContext, agentId: string | null, days: number): Promise<any[]> {
  let q = (getDb(ctx) as any).from('agent_runs').select(COLUMNS).eq('tenant_id', ctx.tenantId).gte('started_at', usageWindowStart(days)).limit(50_000)
  if (agentId) q = q.eq('agent_id', agentId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as any[]
}

/** The days shown are the last `days`; month totals may reach further back. */
function trimDays(summary: UsageSummary, days: number): UsageSummary {
  const from = new Date(Date.now() - Math.min(Math.max(days, 1), 90) * 86_400_000).toISOString().slice(0, 10)
  return { ...summary, days: summary.days.filter((d) => d.day >= from) }
}

export async function agentUsageView(ctx: ServiceContext, agent: Record<string, any>, days = 30) {
  const summary = trimDays(summarizeUsage(await usageRows(ctx, String(agent.id), days)), days)
  const config = normalizeAgentOutputConfig(agent.output_config)
  return {
    ...summary,
    daily_token_budget: config.limits.daily_token_budget || null,
    limits: config.limits,
  }
}

export async function workspaceCostView(ctx: ServiceContext, days = 30) {
  const rows = await usageRows(ctx, null, days)
  const summary = trimDays(summarizeUsage(rows), days)
  const byAgent = new Map<string, any[]>()
  for (const r of rows) {
    const key = String(r.agent_id ?? '')
    if (!byAgent.has(key)) byAgent.set(key, [])
    byAgent.get(key)!.push(r)
  }
  const { data: agents } = await (getDb(ctx) as any).from('agents').select('id, name, model').eq('tenant_id', ctx.tenantId)
  const names = new Map(((agents ?? []) as any[]).map((a) => [String(a.id), a]))
  const perAgent = Array.from(byAgent.entries()).map(([agentId, list]) => {
    const s = summarizeUsage(list)
    return { agent_id: agentId, name: names.get(agentId)?.name ?? 'Deleted agent', model: names.get(agentId)?.model ?? null, tokens_this_month: s.tokens_this_month, cost_this_month: s.cost_this_month, unpriced_runs: s.unpriced_runs, runs: list.length }
  }).sort((a, b) => b.tokens_this_month - a.tokens_this_month)
  const [settings, instance] = await Promise.all([loadCostSettings(getDb(ctx) as any, ctx.tenantId), instancePrices()])
  return {
    ...summary,
    agents: perAgent,
    budgets: settings.budgets,
    prices: { workspace: settings.prices, instance, defaults: DEFAULT_MODEL_PRICES, defaults_as_of: PRICES_AS_OF },
    can_edit: !ctx.permissions || ctx.permissions.has('settings.edit'),
  }
}
