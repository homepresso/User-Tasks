/**
 * Agent cost: the model price table and cost arithmetic (client-safe).
 *
 * Prices are per 1M tokens (input, output, cached input) in a currency, per
 * provider + model, with the date they take effect. Three layers, first
 * match wins:
 *   1. the workspace's overrides (agent_cost_settings.model_prices),
 *   2. the instance's table (instance setting instance.ai_model_prices,
 *      edited by instance admins in Settings → Infrastructure),
 *   3. the defaults below: providers' published list prices as of
 *      PRICES_AS_OF, for the models the connector presets suggest.
 * Within a layer the entry with the latest effective_date on or before the
 * run's date applies. A model with no entry is "cost unknown" — never a
 * guessed or zero cost. Costs are computed when a run is recorded and stored
 * with the price used; later price edits never rewrite past runs.
 *
 * The defaults are list prices only: no discounts, batch / priority tiers,
 * long-context surcharges, cache-write or storage fees, per-request or
 * search fees (Perplexity), or taxes. Edit them for your contract.
 */
import type { AgentUsage } from '@/lib/agent-executor'

export const PRICES_AS_OF = '2026-10-29'

export interface ModelPrice {
  /** Provider kind (lib/agents/provider.ts AgentProviderKind) or '*' for any provider. */
  provider: string
  model: string
  input_per_1m: number
  output_per_1m: number
  /** Cached / cache-read input; null = cached tokens billed at the input price. */
  cached_input_per_1m: number | null
  currency: string
  /** YYYY-MM-DD the price applies from. */
  effective_date: string
  note?: string
}

export type PriceSource = 'workspace' | 'instance' | 'default'

export interface ResolvedPrice extends ModelPrice { source: PriceSource }

export interface CostResult {
  status: 'priced' | 'unknown'
  amount: number | null
  currency: string | null
  price?: ResolvedPrice
}

const list = (provider: string, model: string, input: number, output: number, cached: number | null, note?: string): ModelPrice => ({
  provider, model, input_per_1m: input, output_per_1m: output, cached_input_per_1m: cached, currency: 'USD', effective_date: PRICES_AS_OF, ...(note ? { note } : {}),
})

/**
 * Shipped defaults: list prices as of PRICES_AS_OF from each provider's
 * pricing page, editable. Models the presets suggest that are retired or have
 * no published price (Groq Llama, Together serverless, DeepSeek chat /
 * reasoner, Gemini 2.0 Flash, Mistral Nemo, Perplexity sonar-pro /
 * reasoning) are deliberately absent: their runs show "cost unknown" until
 * an admin adds a price.
 */
export const DEFAULT_MODEL_PRICES: readonly ModelPrice[] = [
  list('openai', 'gpt-4o', 2.5, 10, 1.25),
  list('openai', 'gpt-4o-mini', 0.15, 0.6, 0.075),
  list('openai', 'gpt-4.1', 2, 8, 0.5),
  list('openai', 'gpt-4.1-mini', 0.4, 1.6, 0.1),
  list('openai', 'gpt-4.1-nano', 0.1, 0.4, 0.025),
  list('openai', 'o3-mini', 1.1, 4.4, 0.55),
  list('anthropic', 'claude-opus-5-5', 4, 20, 0.2, 'cache writes are billed extra'),
  list('anthropic', 'claude-opus-4-6', 5, 25, 0.5, 'cache writes are billed extra'),
  list('anthropic', 'claude-sonnet-4-6', 3, 15, 0.3, 'cache writes are billed extra'),
  list('anthropic', 'claude-haiku-4-5', 1, 5, 0.1, 'cache writes are billed extra'),
  list('gemini', 'gemini-2.5-flash', 0.3, 2.5, 0.03, 'text input; cache storage billed extra'),
  list('gemini', 'gemini-2.5-pro', 1.25, 10, 0.125, 'prompts up to 200k tokens; cache storage billed extra'),
  list('mistral', 'mistral-large-latest', 0.5, 1.5, 0.05),
  list('mistral', 'mistral-medium-latest', 1.5, 7.5, 0.15),
  list('mistral', 'mistral-small-latest', 0.15, 0.6, 0.015),
  list('mistral', 'codestral-latest', 0.3, 0.9, 0.03),
  list('perplexity', 'sonar', 0.25, 2.5, 0.0625, 'token prices only; search / tool fees are billed separately'),
]

/** Comparable model id: lower case, no `models/` prefix, no trailing date (-20251001 / @20251001). */
export function normalizeModelId(model: string): string {
  return String(model ?? '').trim().toLowerCase().replace(/^models\//, '').replace(/[-@]\d{8}$/, '')
}

function finiteNonNeg(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? n : null
}

/** Validate a price list (instance setting / workspace overrides). Returns the valid entries and the problems. */
export function normalizePriceList(value: unknown): { prices: ModelPrice[]; errors: string[] } {
  const prices: ModelPrice[] = []
  const errors: string[] = []
  if (!Array.isArray(value)) return { prices, errors: value === undefined || value === null ? [] : ['prices must be a list'] }
  value.slice(0, 500).forEach((raw: any, i) => {
    const model = String(raw?.model ?? '').trim()
    const provider = String(raw?.provider ?? '*').trim().toLowerCase() || '*'
    const input = finiteNonNeg(raw?.input_per_1m)
    const output = finiteNonNeg(raw?.output_per_1m)
    const cached = finiteNonNeg(raw?.cached_input_per_1m)
    const currency = String(raw?.currency ?? 'USD').trim().toUpperCase()
    const date = String(raw?.effective_date ?? '').trim() || '1970-01-01'
    if (!model || model.length > 200) { errors.push(`row ${i + 1}: model is required`); return }
    if (!/^[a-z0-9_*-]{1,40}$/.test(provider)) { errors.push(`row ${i + 1}: provider is invalid`); return }
    if (input === null || output === null) { errors.push(`row ${i + 1} (${model}): input and output prices are required (per 1M tokens, ≥ 0)`); return }
    if (!/^[A-Z]{3}$/.test(currency)) { errors.push(`row ${i + 1} (${model}): currency must be a 3-letter code`); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) { errors.push(`row ${i + 1} (${model}): effective_date must be YYYY-MM-DD`); return }
    prices.push({
      provider, model, input_per_1m: input, output_per_1m: output, cached_input_per_1m: cached, currency, effective_date: date,
      ...(typeof raw?.note === 'string' && raw.note.trim() ? { note: raw.note.trim().slice(0, 200) } : {}),
    })
  })
  return { prices, errors }
}

function pick(prices: readonly ModelPrice[], provider: string, model: string, onDate: string): ModelPrice | null {
  const id = normalizeModelId(model)
  if (!id) return null
  const candidates = prices.filter((p) => (p.provider === '*' || p.provider === provider) && normalizeModelId(p.model) === id && p.effective_date <= onDate)
  if (!candidates.length) return null
  // Latest effective date; a provider-specific entry beats '*' on the same date.
  return candidates.sort((a, b) => b.effective_date.localeCompare(a.effective_date) || (a.provider === '*' ? 1 : 0) - (b.provider === '*' ? 1 : 0))[0]
}

/** The price for provider + model on a date (YYYY-MM-DD), workspace → instance → defaults. */
export function resolvePrice(
  layers: { workspace?: readonly ModelPrice[]; instance?: readonly ModelPrice[]; defaults?: readonly ModelPrice[] },
  provider: string,
  model: string,
  onDate: string = new Date().toISOString().slice(0, 10),
): ResolvedPrice | null {
  const order: [PriceSource, readonly ModelPrice[] | undefined][] = [
    ['workspace', layers.workspace], ['instance', layers.instance], ['default', layers.defaults ?? DEFAULT_MODEL_PRICES],
  ]
  for (const [source, prices] of order) {
    const hit = prices ? pick(prices, provider, model, onDate) : null
    if (hit) return { ...hit, source }
  }
  return null
}

/** Cost of token usage at a price (cached input at its own price, the rest at the input price). */
export function costOf(usage: Pick<AgentUsage, 'prompt_tokens' | 'completion_tokens' | 'cached_tokens'> | null | undefined, price: ModelPrice): number {
  const prompt = Math.max(0, Number(usage?.prompt_tokens) || 0)
  const completion = Math.max(0, Number(usage?.completion_tokens) || 0)
  const cached = Math.min(prompt, Math.max(0, Number(usage?.cached_tokens) || 0))
  const cachedPrice = price.cached_input_per_1m ?? price.input_per_1m
  const amount = ((prompt - cached) * price.input_per_1m + cached * cachedPrice + completion * price.output_per_1m) / 1_000_000
  return Math.round(amount * 1e10) / 1e10
}

export function priceUsage(usage: Parameters<typeof costOf>[0], price: ResolvedPrice | null): CostResult {
  if (!price) return { status: 'unknown', amount: null, currency: null }
  return { status: 'priced', amount: costOf(usage, price), currency: price.currency, price }
}

/** "$0.0123" / "€1.20" / "12.50 CHF"; tiny amounts keep 4 significant decimals. */
export function formatCost(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || !currency) return 'cost unknown'
  const digits = amount !== 0 && Math.abs(amount) < 1 ? 4 : 2
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount)
  } catch {
    return `${amount.toFixed(digits)} ${currency}`
  }
}

/* ── Usage summaries (usage chart, REST / MCP / CLI usage) ── */

export interface UsageRow { started_at: string | null; total_tokens: number | null; status?: string | null; cost_amount?: number | string | null; cost_currency?: string | null; cost_status?: string | null }

export interface UsageDay { day: string; runs: number; failed: number; tokens: number; cost: Record<string, number>; unpriced_runs: number }

export interface UsageSummary {
  days: UsageDay[]
  tokens_last_24h: number
  cost_last_24h: Record<string, number>
  tokens_this_month: number
  cost_this_month: Record<string, number>
  /** Runs in the window whose cost is unknown (no price for the model, or before cost tracking). */
  unpriced_runs: number
}

const addCost = (bucket: Record<string, number>, currency: string, amount: number) => {
  bucket[currency] = Math.round(((bucket[currency] ?? 0) + amount) * 1e8) / 1e8
}

/** Per-day tokens / runs / cost (per currency), the last 24 hours and this calendar month (UTC). */
export function summarizeUsage(rows: readonly UsageRow[], now: number = Date.now()): UsageSummary {
  const byDay = new Map<string, UsageDay>()
  const dayAgo = now - 86_400_000
  const d = new Date(now)
  const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
  const out: UsageSummary = { days: [], tokens_last_24h: 0, cost_last_24h: {}, tokens_this_month: 0, cost_this_month: {}, unpriced_runs: 0 }
  for (const r of rows) {
    const at = new Date(String(r.started_at ?? '')).getTime()
    if (!Number.isFinite(at)) continue
    const day = new Date(at).toISOString().slice(0, 10)
    const entry = byDay.get(day) ?? { day, runs: 0, failed: 0, tokens: 0, cost: {}, unpriced_runs: 0 }
    const tokens = Number(r.total_tokens) || 0
    const priced = r.cost_status === 'priced' && r.cost_currency && r.cost_amount !== null && r.cost_amount !== undefined
    const amount = priced ? Number(r.cost_amount) || 0 : 0
    entry.runs++
    if (r.status === 'failed') entry.failed++
    entry.tokens += tokens
    if (priced) addCost(entry.cost, r.cost_currency!, amount)
    else { entry.unpriced_runs++; out.unpriced_runs++ }
    byDay.set(day, entry)
    if (at >= dayAgo) { out.tokens_last_24h += tokens; if (priced) addCost(out.cost_last_24h, r.cost_currency!, amount) }
    if (at >= monthStart) { out.tokens_this_month += tokens; if (priced) addCost(out.cost_this_month, r.cost_currency!, amount) }
  }
  out.days = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day))
  return out
}
