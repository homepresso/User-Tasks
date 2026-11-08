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
 * long-context surcharges, storage fees (Anthropic cache writes are priced:
 * cache_write_per_1m), per-request or
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
  /** Cache writes (Anthropic: 5-minute TTL, 1.25× input); absent / null = billed at the input price. */
  cache_write_per_1m?: number | null
  currency: string
  /** YYYY-MM-DD the price applies from. */
  effective_date: string
  note?: string
  /** Where the price comes from (a vendor pricing page, or the price feed it was fetched from). Absent on a workspace / instance row = entered by hand. */
  source_url?: string
}

export type PriceSource = 'workspace' | 'instance' | 'default'

export interface ResolvedPrice extends ModelPrice { source: PriceSource }

export interface CostResult {
  status: 'priced' | 'unknown'
  amount: number | null
  currency: string | null
  price?: ResolvedPrice
}

/**
 * Where each provider's shipped prices come from, and when they were last
 * checked. `verified: 'vendor'` — read from the vendor's own pricing page;
 * `'litellm'` — from the LiteLLM model price list (MIT, the same source as
 * "Fetch latest pricing"), the vendor page not being machine-readable.
 */
export const PRICE_SOURCES: Record<string, { url: string; as_of: string; verified: 'vendor' | 'litellm' }> = {
  openai: { url: 'https://developers.openai.com/api/docs/pricing', as_of: '2026-11-07', verified: 'vendor' },
  azure_openai: { url: 'https://developers.openai.com/api/docs/pricing', as_of: '2026-11-07', verified: 'vendor' },
  anthropic: { url: 'https://platform.claude.com/docs/en/about-claude/pricing', as_of: '2026-11-07', verified: 'vendor' },
  xai: { url: 'https://docs.x.ai/docs/models', as_of: '2026-11-07', verified: 'vendor' },
  gemini: { url: 'https://aistudio.google.com/docs/pricing', as_of: '2026-11-07', verified: 'vendor' },
  mistral: { url: 'https://mistral.ai/pricing', as_of: '2026-11-07', verified: 'litellm' },
  groq: { url: 'https://groq.com/pricing', as_of: '2026-11-07', verified: 'litellm' },
  deepseek: { url: 'https://api-docs.deepseek.com/quick_start/pricing', as_of: '2026-11-07', verified: 'litellm' },
  together: { url: 'https://www.together.ai/pricing', as_of: '2026-11-07', verified: 'litellm' },
  perplexity: { url: 'https://docs.perplexity.ai/getting-started/pricing', as_of: '2026-10-29', verified: 'vendor' },
  bedrock: { url: 'https://aws.amazon.com/bedrock/pricing/', as_of: '2026-11-07', verified: 'litellm' },
}

const list = (provider: string, model: string, input: number, output: number, cached: number | null, note?: string, cacheWrite?: number, effective = PRICES_AS_OF): ModelPrice => ({
  provider, model, input_per_1m: input, output_per_1m: output, cached_input_per_1m: cached, currency: 'USD', effective_date: effective,
  ...(cacheWrite !== undefined ? { cache_write_per_1m: cacheWrite } : {}), ...(note ? { note } : {}),
  ...(PRICE_SOURCES[provider] ? { source_url: PRICE_SOURCES[provider].url } : {}),
})
const round = (n: number) => Math.round(n * 100_000) / 100_000
/** Anthropic list price: cache writes (5-minute TTL) at 1.25× input. */
const claude = (model: string, input: number, output: number, cached: number, note?: string): ModelPrice => list('anthropic', model, input, output, cached, note, round(input * 1.25))

const OPENAI: readonly ModelPrice[] = [
  // developers.openai.com/api/docs/pricing, standard tier; gpt-5.4 / 5.5 / 5.6 up to 272K input tokens — longer prompts cost more.
  list('openai', 'gpt-4o', 2.5, 10, 1.25),
  list('openai', 'gpt-4o-mini', 0.15, 0.6, 0.075),
  list('openai', 'gpt-4.1', 2, 8, 0.5),
  list('openai', 'gpt-4.1-mini', 0.4, 1.6, 0.1),
  list('openai', 'gpt-4.1-nano', 0.1, 0.4, 0.025),
  list('openai', 'o3-mini', 1.1, 4.4, 0.55),
  list('openai', 'gpt-5', 1.25, 10, 0.125),
  list('openai', 'gpt-5-mini', 0.25, 2, 0.025),
  list('openai', 'gpt-5-nano', 0.05, 0.4, 0.005),
  list('openai', 'gpt-5.1', 1.25, 10, 0.125),
  list('openai', 'gpt-5.2', 1.75, 14, 0.175),
  list('openai', 'gpt-5.4', 2.5, 15, 0.25, 'prompts up to 272K tokens'),
  list('openai', 'gpt-5.4-mini', 0.75, 4.5, 0.075),
  list('openai', 'gpt-5.4-nano', 0.2, 1.25, 0.02),
  list('openai', 'gpt-5.5', 5, 30, 0.5, 'prompts up to 272K tokens'),
  list('openai', 'gpt-5.6-sol', 4, 20, 0.4, 'prompts up to 272K tokens'),
  list('openai', 'gpt-5.6-terra', 2, 12, 0.2, 'prompts up to 272K tokens'),
  list('openai', 'gpt-5.6-luna', 0.2, 1.2, 0.02, 'prompts up to 272K tokens'),
]

/** Bedrock Claude: global / in-region at the Anthropic list price; geographic (us. eu. au. jp. apac.) inference profiles at +10%. */
function bedrockClaude(model: string, input: number, output: number, cached: number): ModelPrice[] {
  const base = (id: string, k: number) => list('bedrock', id, round(input * k), round(output * k), round(cached * k), k > 1 ? 'geographic inference profile (+10%)' : undefined, round(input * 1.25 * k))
  return [base(`anthropic.${model}`, 1), base(`global.anthropic.${model}`, 1), ...['us', 'eu', 'au', 'jp'].map((geo) => base(`${geo}.anthropic.${model}`, 1.1))]
}

/**
 * Shipped defaults: list prices from each provider (PRICE_SOURCES), editable.
 * Models the presets suggest that are retired or have no verified price
 * (Groq Llama, Together's retired serverless Llama, DeepSeek chat / reasoner,
 * Gemini 2.0 Flash, Mistral Nemo) are deliberately absent: their runs show
 * "cost unknown" until an admin adds a price (or fetches the latest).
 * A price change a vendor has announced is a second row with its date.
 */
export const DEFAULT_MODEL_PRICES: readonly ModelPrice[] = [
  ...OPENAI,
  // Azure OpenAI: the OpenAI list prices, by model name (a deployment named after its model matches).
  ...OPENAI.map((p) => ({ ...p, provider: 'azure_openai', source_url: PRICE_SOURCES.azure_openai.url, note: [p.note, 'Azure global standard; regional / data-zone deployments cost more'].filter(Boolean).join('; ') })),
  // Anthropic: cache reads 0.1× input (0.05× Opus / Sonnet 5.5, 0.025× Fable 5.1), 5-minute cache writes 1.25×.
  claude('claude-fable-5-1', 10, 50, 0.25),
  claude('claude-fable-5', 10, 50, 1),
  claude('claude-opus-5-5', 4, 20, 0.2),
  claude('claude-opus-5', 5, 25, 0.5),
  claude('claude-opus-4-8', 5, 25, 0.5),
  claude('claude-opus-4-7', 5, 25, 0.5),
  claude('claude-opus-4-6', 5, 25, 0.5),
  claude('claude-opus-4-5', 5, 25, 0.5),
  claude('claude-sonnet-5-5', 2, 10, 0.1),
  claude('claude-sonnet-5', 2, 10, 0.2),
  claude('claude-sonnet-4-6', 3, 15, 0.3),
  claude('claude-sonnet-4-5', 3, 15, 0.3),
  claude('claude-haiku-5-5', 0.1, 0.5, 0.01, 'prompts up to 100K tokens (longer prompts: $0.50 / $2.50)'),
  claude('claude-haiku-4-5', 1, 5, 0.1),
  // xAI, prompts under 200K tokens (a longer prompt is billed at twice the rate for all its tokens).
  list('xai', 'grok-4.7', 2, 6, 0.5, 'prompts under 200K tokens'),
  list('xai', 'grok-4.6', 2, 6, 0.5, 'prompts under 200K tokens'),
  list('xai', 'grok-4.5', 2, 6, 0.3, 'prompts under 200K tokens'),
  list('xai', 'grok-4.3', 1.25, 2.5, 0.2, 'prompts under 200K tokens'),
  // Gemini API, paid tier, text; context caching storage is billed extra. Announced increases are dated rows.
  list('gemini', 'gemini-2.5-flash', 0.3, 2.5, 0.03, 'deprecated: routes to gemini-3.5-flash-lite from 2026-12-01'),
  list('gemini', 'gemini-2.5-pro', 1.25, 10, 0.125, 'prompts up to 200K tokens; deprecated: routes to gemini-3.8-flash from 2026-12-01'),
  list('gemini', 'gemini-2.5-flash-lite', 0.1, 0.4, 0.01),
  list('gemini', 'gemini-3-flash-preview', 0.5, 3, 0.05),
  list('gemini', 'gemini-3.1-flash-lite', 0.25, 1.5, 0.025),
  list('gemini', 'gemini-3.1-pro-preview', 2, 12, 0.2, 'prompts up to 200K tokens'),
  list('gemini', 'gemini-3.5-flash-lite', 0.3, 2.5, 0.03),
  list('gemini', 'gemini-3.6-flash', 0.75, 3.75, 0.075),
  list('gemini', 'gemini-3.6-flash', 1.5, 7.5, 0.15, undefined, undefined, '2027-01-01'),
  list('gemini', 'gemini-3.8-flash', 0.75, 3.75, 0.075),
  list('gemini', 'gemini-3.8-flash', 1.5, 7.5, 0.15, undefined, undefined, '2027-01-01'),
  list('gemini', 'gemini-4-argon', 2, 10, 0.1),
  list('gemini', 'gemini-4-argon', 4, 20, 0.2, undefined, undefined, '2026-12-01'),
  // Mistral (LiteLLM price list).
  list('mistral', 'mistral-large-latest', 0.5, 1.5, 0.05),
  list('mistral', 'mistral-large-4', 0.7, 2.1, 0.07),
  list('mistral', 'mistral-medium-latest', 1.5, 7.5, 0.15),
  list('mistral', 'mistral-small-latest', 0.15, 0.6, 0.015),
  list('mistral', 'magistral-medium-latest', 1.5, 7.5, 0.15),
  list('mistral', 'magistral-small-latest', 0.15, 0.6, 0.015),
  list('mistral', 'devstral-latest', 0.4, 2, 0.04),
  list('mistral', 'ministral-8b-latest', 0.15, 0.15, 0.015),
  list('mistral', 'pixtral-large-latest', 2, 6, 0.2),
  list('mistral', 'codestral-latest', 0.3, 0.9, 0.03),
  // Groq (LiteLLM price list).
  list('groq', 'openai/gpt-oss-120b', 0.15, 0.6, 0.075),
  list('groq', 'openai/gpt-oss-20b', 0.075, 0.3, 0.0375),
  list('groq', 'qwen/qwen3.8-27b', 0.8, 4, null),
  // DeepSeek (LiteLLM price list; cache hits as cached input).
  list('deepseek', 'deepseek-flash', 0.3, 1.2, 0.006),
  list('deepseek', 'deepseek-v4-pro', 1.32, 3.96, 0.044),
  // Together AI serverless (LiteLLM price list).
  list('together', 'openai/gpt-oss-120b', 0.15, 0.6, null),
  list('together', 'deepseek-ai/DeepSeek-V4.1-Flash', 0.3, 1.2, 0.006),
  list('together', 'moonshotai/Kimi-K3', 3, 15, 0.3),
  list('together', 'zai-org/GLM-5.3', 1.4, 4.4, 0.26),
  list('together', 'Qwen/Qwen3.7-Max', 2.5, 7.5, 0.5),
  // Perplexity.
  list('perplexity', 'sonar', 0.25, 2.5, 0.0625, 'token prices only; search / tool fees are billed separately'),
  // Amazon Bedrock, Claude (LiteLLM price list; Bedrock's own prices).
  ...bedrockClaude('claude-opus-5-5', 4, 20, 0.2),
  ...bedrockClaude('claude-sonnet-5', 2, 10, 0.2),
  ...bedrockClaude('claude-opus-5', 5, 25, 0.5),
  ...bedrockClaude('claude-opus-4-8', 5, 25, 0.5),
  ...bedrockClaude('claude-sonnet-4-6', 3, 15, 0.3),
  ...bedrockClaude('claude-fable-5-1', 10, 50, 0.25),
]

/** Comparable model id: lower case, no `models/` prefix, no trailing date (-20251001 / @20251001). */
export function normalizeModelId(model: string): string {
  return String(model ?? '').trim().toLowerCase().replace(/^models\//, '')
    .replace(/-v\d+(:\d+)?$/, '') // Bedrock version suffix (-v1:0)
    .replace(/[-@]\d{8}$/, '') // -20251001 / @20251001
    .replace(/-\d{4}-\d{2}-\d{2}$/, '') // OpenAI dated snapshots (-2025-04-14)
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
    const cacheWrite = finiteNonNeg(raw?.cache_write_per_1m)
    const currency = String(raw?.currency ?? 'USD').trim().toUpperCase()
    const date = String(raw?.effective_date ?? '').trim() || '1970-01-01'
    if (!model || model.length > 200) { errors.push(`row ${i + 1}: model is required`); return }
    if (!/^[a-z0-9_*-]{1,40}$/.test(provider)) { errors.push(`row ${i + 1}: provider is invalid`); return }
    if (input === null || output === null) { errors.push(`row ${i + 1} (${model}): input and output prices are required (per 1M tokens, ≥ 0)`); return }
    if (!/^[A-Z]{3}$/.test(currency)) { errors.push(`row ${i + 1} (${model}): currency must be a 3-letter code`); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) { errors.push(`row ${i + 1} (${model}): effective_date must be YYYY-MM-DD`); return }
    prices.push({
      provider, model, input_per_1m: input, output_per_1m: output, cached_input_per_1m: cached, currency, effective_date: date,
      ...(cacheWrite !== null ? { cache_write_per_1m: cacheWrite } : {}),
      ...(typeof raw?.source_url === 'string' && raw.source_url.trim() ? { source_url: raw.source_url.trim().slice(0, 300) } : {}),
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

/**
 * Cost of token usage at a price: cache reads at the cached price, cache
 * writes at the cache-write price (when the price has one), the rest of the
 * prompt at the input price. prompt_tokens includes cached and written tokens.
 */
export function costOf(usage: Pick<AgentUsage, 'prompt_tokens' | 'completion_tokens' | 'cached_tokens' | 'cache_write_tokens'> | null | undefined, price: ModelPrice): number {
  const prompt = Math.max(0, Number(usage?.prompt_tokens) || 0)
  const completion = Math.max(0, Number(usage?.completion_tokens) || 0)
  const cached = Math.min(prompt, Math.max(0, Number(usage?.cached_tokens) || 0))
  const written = Math.min(prompt - cached, Math.max(0, Number(usage?.cache_write_tokens) || 0))
  const cachedPrice = price.cached_input_per_1m ?? price.input_per_1m
  const writePrice = price.cache_write_per_1m ?? price.input_per_1m
  const amount = ((prompt - cached - written) * price.input_per_1m + cached * cachedPrice + written * writePrice + completion * price.output_per_1m) / 1_000_000
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
