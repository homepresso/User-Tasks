/**
 * Agent cost and budgets (server only).
 *
 *  - priceLayers(): the price table for a workspace (its overrides, the
 *    instance setting instance.ai_model_prices, the shipped defaults —
 *    lib/agents/pricing.ts);
 *  - priceRunResult(): a run's cost and per-LLM-call cost, at the prices in
 *    effect on the run's date ("unknown" when the model has no price);
 *  - checkBudgets(): refuse a run when the agent's or the workspace's token
 *    or cost budget for the day (rolling 24 hours) or month (calendar month,
 *    UTC) is spent. Cost budgets count priced runs in the budget's currency
 *    only — runs with an unknown cost are not counted (the usage view says
 *    how many there are).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentResult, AgentStep } from '@/lib/agent-executor'
import { currencyCode, type NormalizedAgentOutputConfig } from '@/lib/agent-knowledge'
import { DEFAULT_MODEL_PRICES, formatCost, normalizePriceList, priceUsage, resolvePrice, type CostResult, type ModelPrice, type ResolvedPrice } from './pricing'

export const INSTANCE_PRICES_SETTING = 'instance.ai_model_prices'

export interface PriceLayers { workspace: ModelPrice[]; instance: ModelPrice[]; defaults: readonly ModelPrice[] }

export interface WorkspaceBudgets {
  daily_token_budget: number
  monthly_token_budget: number
  daily_cost_budget: number
  monthly_cost_budget: number
  budget_currency: string
}

const nonNeg = (v: unknown, money = false) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 0
  return money ? Math.round(n * 100) / 100 : Math.floor(n)
}

export function normalizeWorkspaceBudgets(value: any): WorkspaceBudgets {
  return {
    daily_token_budget: nonNeg(value?.daily_token_budget),
    monthly_token_budget: nonNeg(value?.monthly_token_budget),
    daily_cost_budget: nonNeg(value?.daily_cost_budget, true),
    monthly_cost_budget: nonNeg(value?.monthly_cost_budget, true),
    budget_currency: currencyCode(value?.budget_currency),
  }
}

export async function instancePrices(): Promise<ModelPrice[]> {
  try {
    const { getInstanceSetting } = await import('@/lib/config/instance-settings')
    return normalizePriceList(await getInstanceSetting(INSTANCE_PRICES_SETTING)).prices
  } catch {
    return []
  }
}

export async function loadCostSettings(db: SupabaseClient, tenantId: string): Promise<{ prices: ModelPrice[]; budgets: WorkspaceBudgets; updated_at: string | null }> {
  const { data } = await (db as any).from('agent_cost_settings').select('model_prices, budgets, updated_at').eq('tenant_id', tenantId).maybeSingle()
  return { prices: normalizePriceList(data?.model_prices ?? []).prices, budgets: normalizeWorkspaceBudgets(data?.budgets ?? {}), updated_at: data?.updated_at ?? null }
}

export async function priceLayers(db: SupabaseClient, tenantId: string): Promise<PriceLayers> {
  const [settings, instance] = await Promise.all([
    loadCostSettings(db, tenantId).catch(() => ({ prices: [] as ModelPrice[] })),
    instancePrices(),
  ])
  return { workspace: settings.prices, instance, defaults: DEFAULT_MODEL_PRICES }
}

/** The price entry stored with a run (what it was charged at). */
function priceSnapshot(price: ResolvedPrice) {
  return {
    provider: price.provider, model: price.model, input_per_1m: price.input_per_1m, output_per_1m: price.output_per_1m,
    cached_input_per_1m: price.cached_input_per_1m, currency: price.currency, effective_date: price.effective_date, source: price.source,
  }
}

export interface RunCost extends CostResult {
  steps: AgentStep[]
  snapshot: ReturnType<typeof priceSnapshot> | null
}

/** Cost of a run (sum of its LLM calls) and its steps with `cost` on each priced LLM call. */
export function priceRunResult(result: Pick<AgentResult, 'usage' | 'steps'>, provider: string, model: string, layers: PriceLayers, onDate?: string): RunCost {
  // A call whose usage the provider did not report makes the total unknowable: never price it as zero.
  const usageMissing = (result.steps ?? []).some((st) => st.type === 'llm' && !st.error && !st.usage)
  const price = usageMissing ? null : resolvePrice(layers, provider, model, onDate)
  const total = priceUsage(result.usage, price)
  const steps = (result.steps ?? []).map((step) => {
    if (step.type !== 'llm' || !price || !step.usage) return step
    const c = priceUsage(step.usage, price)
    return { ...step, cost: { amount: c.amount, currency: c.currency } } as AgentStep
  })
  return { ...total, steps, snapshot: price ? priceSnapshot(price) : null }
}

export async function priceRun(db: SupabaseClient, tenantId: string, result: Pick<AgentResult, 'usage' | 'steps'>, provider: string | null | undefined, model: string): Promise<RunCost> {
  if (!provider) return { status: 'unknown', amount: null, currency: null, steps: result.steps ?? [], snapshot: null }
  try {
    return priceRunResult(result, provider, model, await priceLayers(db, tenantId))
  } catch {
    return { status: 'unknown', amount: null, currency: null, steps: result.steps ?? [], snapshot: null }
  }
}

/* ── Usage totals / budgets ── */

export interface UsageTotals { runs: number; tokens: number; unpriced_runs: number; cost: Record<string, number> }

export function monthStartIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

export async function usageTotals(db: SupabaseClient, tenantId: string, agentId: string | null, sinceIso: string): Promise<UsageTotals> {
  let data: unknown = null
  let error: unknown = 'no rpc'
  if (typeof (db as any).rpc === 'function') {
    try {
      ({ data, error } = await (db as any).rpc('agent_usage_totals', { p_tenant_id: tenantId, p_agent_id: agentId, p_since: sinceIso }))
    } catch (e) { error = e }
  }
  if (!error && data && typeof data === 'object') {
    const cost: Record<string, number> = {}
    for (const [k, v] of Object.entries((data as any).cost ?? {})) cost[k] = Number(v) || 0
    return { runs: Number((data as any).runs) || 0, tokens: Number((data as any).tokens) || 0, unpriced_runs: Number((data as any).unpriced_runs) || 0, cost }
  }
  // Fallback (function not deployed yet): sum the rows.
  let q = (db as any).from('agent_runs').select('total_tokens, cost_amount, cost_currency, cost_status').eq('tenant_id', tenantId).gte('started_at', sinceIso).limit(50_000)
  if (agentId) q = q.eq('agent_id', agentId)
  const { data: rows } = await q
  const out: UsageTotals = { runs: 0, tokens: 0, unpriced_runs: 0, cost: {} }
  for (const r of (rows ?? []) as any[]) {
    out.runs++
    out.tokens += Number(r.total_tokens) || 0
    if (r.cost_status === 'priced' && r.cost_currency) out.cost[r.cost_currency] = (out.cost[r.cost_currency] ?? 0) + (Number(r.cost_amount) || 0)
    else out.unpriced_runs++
  }
  return out
}

export class BudgetExceededError extends Error {
  constructor(message: string) { super(message); this.name = 'BudgetExceededError' }
}

interface BudgetSet { daily_token_budget: number; monthly_token_budget: number; daily_cost_budget: number; monthly_cost_budget: number; budget_currency: string }

function exceeded(scope: string, budgets: BudgetSet, day: UsageTotals, month: UsageTotals): string | null {
  const n = (v: number) => v.toLocaleString('en-US')
  if (budgets.daily_token_budget && day.tokens >= budgets.daily_token_budget) return `${scope} used ${n(day.tokens)} tokens in the last 24 hours — its daily budget is ${n(budgets.daily_token_budget)}`
  if (budgets.monthly_token_budget && month.tokens >= budgets.monthly_token_budget) return `${scope} used ${n(month.tokens)} tokens this month — its monthly budget is ${n(budgets.monthly_token_budget)}`
  const cur = budgets.budget_currency
  const dayCost = day.cost[cur] ?? 0
  const monthCost = month.cost[cur] ?? 0
  if (budgets.daily_cost_budget && dayCost >= budgets.daily_cost_budget) return `${scope} spent ${formatCost(dayCost, cur)} in the last 24 hours — its daily budget is ${formatCost(budgets.daily_cost_budget, cur)}`
  if (budgets.monthly_cost_budget && monthCost >= budgets.monthly_cost_budget) return `${scope} spent ${formatCost(monthCost, cur)} this month — its monthly budget is ${formatCost(budgets.monthly_cost_budget, cur)}`
  return null
}

const anyBudget = (b: BudgetSet) => Boolean(b.daily_token_budget || b.monthly_token_budget || b.daily_cost_budget || b.monthly_cost_budget)

/** Throws BudgetExceededError when the agent's or the workspace's budget is spent. */
export async function checkBudgets(db: SupabaseClient, tenantId: string, agentId: string, outputConfig: NormalizedAgentOutputConfig): Promise<void> {
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString()
  const month = monthStartIso()
  const agentBudgets = outputConfig.limits
  if (anyBudget(agentBudgets)) {
    const [d, m] = await Promise.all([
      usageTotals(db, tenantId, agentId, dayAgo),
      agentBudgets.monthly_token_budget || agentBudgets.monthly_cost_budget ? usageTotals(db, tenantId, agentId, month) : Promise.resolve({ runs: 0, tokens: 0, unpriced_runs: 0, cost: {} }),
    ])
    const why = exceeded('This agent', agentBudgets, d, m)
    if (why) throw new BudgetExceededError(why)
  }
  const workspace = (await loadCostSettings(db, tenantId).catch(() => null))?.budgets
  if (workspace && anyBudget(workspace)) {
    const [d, m] = await Promise.all([usageTotals(db, tenantId, null, dayAgo), usageTotals(db, tenantId, null, month)])
    const why = exceeded('This workspace\'s agents', workspace, d, m)
    if (why) throw new BudgetExceededError(why)
  }
}
