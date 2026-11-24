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
import { instancePrices, loadCostSettings, priceLayers } from './costs'
import { cubeFromAgentRuns, cubeFromAssistantUsage, cubeFromRpc, parseGroupBy, periodBounds, resolvePeriod, rollupBreakdown, type BreakdownNames, type CostBreakdown, type CostFilters, type CostGroupBy, type CubeRow } from './cost-breakdown'

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

/* ── Cost breakdowns (by model, profile, agent, source, person, day) ── */

export interface BreakdownQuery {
  period?: string | null
  from?: string | null
  to?: string | null
  days?: number | null
  group_by?: string | readonly string[] | null
  provider?: string | null
  model?: string | null
  /** Agent profile id (`default` = no profile matched); `profile` is accepted too. */
  agent_profile?: string | null
  profile?: string | null
  agent?: string | null
  source?: string | null
  user?: string | null
}

const RAW_LIMIT = 50_000

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped tables / rpc */

/**
 * assistant_usage rows of a workspace in [fromIso, toIso) (either open),
 * newest first: `columns` plus model_rule, source and cached_tokens — left
 * out on databases without them (source / cached_tokens: 20270126130000,
 * model_rule: 20261231000001). No table yet → no rows.
 */
export async function selectAssistantUsage(db: any, tenantId: string, opts: { fromIso?: string | null; toIso?: string | null; limit: number; columns: string }): Promise<any[]> {
  const sets = [`${opts.columns}, model_rule, source, cached_tokens`, `${opts.columns}, model_rule`, opts.columns]
  for (const cols of sets) {
    let q = db.from('assistant_usage').select(cols).eq('tenant_id', tenantId)
    if (opts.fromIso) q = q.gte('created_at', opts.fromIso)
    if (opts.toIso) q = q.lt('created_at', opts.toIso)
    const { data, error } = await q.order('created_at', { ascending: false }).limit(opts.limit)
    if (!error) return data ?? []
    const message = String(error.message ?? '')
    if (/assistant_usage/.test(message) && /does not exist|schema cache/i.test(message) && !/column/i.test(message)) return []
    if (!/column|schema cache/i.test(message)) throw new Error(message)
  }
  return []
}

/** The cube of [from, to): public.ai_usage_breakdown, else summed here from the rows (capped). */
async function loadCube(db: any, tenantId: string, fromIso: string, toIso: string): Promise<{ cube: CubeRow[]; truncated: boolean; aggregatedIn: 'database' | 'app' }> {
  if (typeof db.rpc === 'function') {
    try {
      const { data, error } = await db.rpc('ai_usage_breakdown', { p_tenant_id: tenantId, p_from: fromIso, p_to: toIso })
      if (!error && Array.isArray(data)) return { cube: cubeFromRpc(data), truncated: false, aggregatedIn: 'database' }
    } catch { /* not deployed: fall back */ }
  }
  const runs = db.from('agent_runs').select('started_at, caller_type, workflow_run_id, price, model, agent_id, cost_status, cost_currency, cost_amount, input_tokens, output_tokens, total_tokens, usage')
    .eq('tenant_id', tenantId).gte('started_at', fromIso).lt('started_at', toIso).limit(RAW_LIMIT)
  const assistantRows = () => selectAssistantUsage(db, tenantId, { fromIso, toIso, limit: RAW_LIMIT, columns: 'created_at, provider, model, capability, user_id, cost_status, cost_currency, cost_amount, prompt_tokens, completion_tokens, total_tokens' })
  const [{ data: runRows, error: runError }, usageRows] = await Promise.all([runs, assistantRows()])
  if (runError) throw new Error(runError.message)
  const r = (runRows ?? []) as any[]
  return {
    cube: [...cubeFromAgentRuns(r), ...cubeFromAssistantUsage(usageRows)],
    truncated: r.length >= RAW_LIMIT || usageRows.length >= RAW_LIMIT,
    aggregatedIn: 'app',
  }
}

/** Agent names and their connection's provider kind (fills the provider of runs recorded without a priced snapshot). */
export async function agentNames(db: any, tenantId: string): Promise<NonNullable<BreakdownNames['agents']>> {
  const [{ data: agents }, { data: integrations }] = await Promise.all([
    db.from('agents').select('id, name, integration_id').eq('tenant_id', tenantId),
    db.from('integrations').select('id, type, base_url:config->>base_url').eq('tenant_id', tenantId),
  ])
  const { agentProviderKind } = await import('./provider')
  const kinds = new Map(((integrations ?? []) as any[]).map((i) => [String(i.id), agentProviderKind(i.type, i.base_url)]))
  return Object.fromEntries(((agents ?? []) as any[]).map((a) => [String(a.id), { name: String(a.name ?? ''), provider: a.integration_id ? kinds.get(String(a.integration_id)) ?? null : null }]))
}

export async function profileNames(db: any, tenantId: string): Promise<NonNullable<BreakdownNames['profiles']>> {
  const { data, error } = await db.from('assistant_settings').select('capabilities').eq('tenant_id', tenantId).maybeSingle()
  if (error || !data) return {}
  const { normalizeAgentSettings } = await import('@/lib/assistants/config')
  const profiles = normalizeAgentSettings(data.capabilities).profiles ?? []
  return Object.fromEntries(profiles.map((p) => [p.id, { name: p.name, monthly_cost_cap: p.limits?.monthly_cost_cap || null }]))
}

export async function userNames(db: any, ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {}
  const { data } = await db.from('users').select('id, display_name, email').in('id', ids.slice(0, 1000))
  return Object.fromEntries(((data ?? []) as any[]).map((u) => [String(u.id), String(u.display_name || u.email || 'Member')]))
}

/**
 * The workspace's AI cost breakdown for a period. Callers check agents.view;
 * `canSeePeople` (assistants.manage) allows group_by / filter `user`.
 * `db` must read every row of the workspace (service role): assistant_usage
 * RLS shows non-admins only their own rows.
 */
export async function workspaceCostBreakdown(db: any, tenantId: string, query: BreakdownQuery, opts: { canSeePeople: boolean; currency?: string; now?: Date }): Promise<CostBreakdown> {
  const period = resolvePeriod({ preset: query.period, from: query.from, to: query.to, days: query.days }, opts.now)
  const groupBy = query.group_by ? parseGroupBy(query.group_by) : (['day', 'model', 'profile', 'agent', 'source'] as CostGroupBy[])
  if ((groupBy.includes('user') || query.user) && !opts.canSeePeople) {
    const { ServiceError } = await import('@/lib/services/context')
    throw ServiceError.forbidden('Costs per person need the assistants.manage permission')
  }
  const { fromIso, toIso } = periodBounds(period)
  const [{ cube, truncated, aggregatedIn }, layers, agents, profiles, settings] = await Promise.all([
    loadCube(db, tenantId, fromIso, toIso),
    priceLayers(db, tenantId),
    agentNames(db, tenantId),
    profileNames(db, tenantId).catch(() => ({})),
    opts.currency ? Promise.resolve(null) : loadCostSettings(db, tenantId).catch(() => null),
  ])
  const users = groupBy.includes('user') ? await userNames(db, Array.from(new Set(cube.map((r) => r.user_id).filter((v): v is string => Boolean(v))))) : {}
  const { CAPABILITY_LABELS } = await import('@/lib/assistants/types')
  return rollupBreakdown({
    cube, period, layers, truncated, aggregatedIn, groupBy,
    currency: opts.currency ?? settings?.budgets.budget_currency ?? 'USD',
    names: { agents, profiles, users, capabilities: { ...CAPABILITY_LABELS } },
    filters: Object.fromEntries(Object.entries({ provider: query.provider, model: query.model, profile: query.agent_profile ?? query.profile, agent: query.agent, source: query.source, user: query.user }).filter(([, v]) => v)) as CostFilters,
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */
