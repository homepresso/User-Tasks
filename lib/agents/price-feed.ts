/**
 * "Fetch latest pricing" (client-safe, pure): the LiteLLM model price list
 * (model_prices_and_context_window.json in BerriAI/litellm, MIT) normalised
 * to our price rows, and the preview diff against the prices in effect.
 *
 * Vendors mostly publish no pricing API; LiteLLM's list is maintained, covers
 * every provider kind agents use and gives per-token input / output / cache
 * read / cache write costs. The fetch itself is server side
 * (lib/services/agents.ts fetchPriceUpdates: egress guard, timeout, size
 * cap); the source URL is configurable (instance setting
 * instance.ai_price_feed_url, env AI_PRICE_FEED_URL; "off" disables it, a
 * mirror URL suits air-gapped installs).
 */
import { normalizeModelId, resolvePrice, type ModelPrice } from './pricing'

export interface PriceLayers { workspace?: readonly ModelPrice[]; instance?: readonly ModelPrice[]; defaults?: readonly ModelPrice[] }

/* eslint-disable @typescript-eslint/no-explicit-any -- feed JSON */

export const DEFAULT_PRICE_FEED_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
export const PRICE_FEED_SETTING = 'instance.ai_price_feed_url'
/** The feed is ~3.5 MB today. */
export const PRICE_FEED_MAX_BYTES = 20 * 1024 * 1024
export const PRICE_FEED_TIMEOUT_MS = 20_000

/** LiteLLM provider → our provider kind (lib/agents/provider.ts). */
const PROVIDER_MAP: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  xai: 'xai',
  gemini: 'gemini',
  mistral: 'mistral',
  groq: 'groq',
  deepseek: 'deepseek',
  together_ai: 'together',
  perplexity: 'perplexity',
  azure: 'azure_openai',
  bedrock_converse: 'bedrock',
  bedrock: 'bedrock',
}

/** Key prefixes LiteLLM puts on model ids (removed: our ids are the provider's own). */
const PREFIX: Record<string, RegExp> = {
  xai: /^xai\//, gemini: /^gemini\//, mistral: /^mistral\//, groq: /^groq\//, deepseek: /^deepseek\//,
  together: /^together_ai\//, perplexity: /^perplexity\//, azure_openai: /^azure\//, bedrock: /^bedrock\//, openai: /^openai\//, anthropic: /^anthropic\//,
}

export interface FeedPrice {
  provider: string
  /** The model id as the provider names it (LiteLLM prefix removed). */
  model: string
  /** normalizeModelId(model): dated snapshots and aliases compare equal. */
  id: string
  input_per_1m: number
  output_per_1m: number
  cached_input_per_1m: number | null
  cache_write_per_1m: number | null
  /** Other keys of the feed that map to the same model (dated versions). */
  aliases: string[]
}

const per1m = (v: unknown): number | null => {
  const n = Number(v)
  if (v === null || v === undefined || v === '' || !Number.isFinite(n) || n < 0) return null
  return Math.round(n * 1e6 * 1e6) / 1e6
}

/** Is this feed key a dated / versioned snapshot (prefer the alias without the date)? */
const dated = (model: string) => normalizeModelId(model) !== model.toLowerCase()

/**
 * The feed's chat models for our providers, one row per provider + model id
 * (dated snapshots folded into their alias). Region-path keys
 * (bedrock/us-east-1/…), non-chat models and free / unpriced entries are left
 * out.
 */
export function parsePriceFeed(json: unknown): FeedPrice[] {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('The price list is not a JSON object')
  const byKey = new Map<string, FeedPrice>()
  for (const [key, raw] of Object.entries(json as Record<string, any>)) {
    if (!raw || typeof raw !== 'object' || key === 'sample_spec') continue
    const provider = PROVIDER_MAP[String(raw.litellm_provider ?? '')]
    if (!provider) continue
    if (raw.mode && raw.mode !== 'chat' && raw.mode !== 'responses') continue
    const input = per1m(raw.input_cost_per_token)
    const output = per1m(raw.output_cost_per_token)
    if (input === null || output === null || (input === 0 && output === 0)) continue
    const model = key.replace(PREFIX[provider] ?? /^$/, '')
    if (!model || (model.includes('/') && (provider === 'bedrock' || provider === 'azure_openai'))) continue
    const id = normalizeModelId(model)
    const cached = per1m(raw.cache_read_input_token_cost)
    const write = per1m(raw.cache_creation_input_token_cost)
    const row: FeedPrice = { provider, model, id, input_per_1m: input, output_per_1m: output, cached_input_per_1m: cached, cache_write_per_1m: write && write > 0 ? write : null, aliases: [] }
    const k = `${provider}:${id}`
    const prev = byKey.get(k)
    if (!prev) { byKey.set(k, row); continue }
    // The alias (undated id) wins; otherwise the newest dated key.
    const keep = !dated(prev.model) ? prev : !dated(model) ? row : prev.model > model ? prev : row
    const other = keep === prev ? row : prev
    keep.aliases = [...new Set([...prev.aliases, ...row.aliases, other.model])].filter((a) => a !== keep.model)
    byKey.set(k, keep)
  }
  return [...byKey.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model))
}

export type DiffStatus = 'new' | 'changed' | 'unchanged'

export interface PriceDiffRow {
  key: string
  provider: string
  model: string
  status: DiffStatus
  next: Pick<FeedPrice, 'input_per_1m' | 'output_per_1m' | 'cached_input_per_1m' | 'cache_write_per_1m'>
  current: Pick<ModelPrice, 'input_per_1m' | 'output_per_1m' | 'cached_input_per_1m' | 'cache_write_per_1m' | 'currency'> & { source: string } | null
  /** The current price is this workspace's hand-entered row: only replaced when the admin ticks it. */
  manual: boolean
  aliases: string[]
}

export interface PriceDiff {
  providers: Array<{ provider: string; new: number; changed: number; unchanged: number }>
  rows: PriceDiffRow[]
  /** New models left out of `rows` (capped; changed rows are always listed). */
  more_new: number
}

export const priceKey = (provider: string, model: string) => `${provider}:${normalizeModelId(model)}`

const same = (a: number | null | undefined, b: number | null | undefined) => Math.abs((a ?? -1) - (b ?? -1)) < 1e-9

/**
 * The preview: each feed model against the price in effect for this
 * workspace on `onDate` (workspace → instance → shipped). A price in another
 * currency than USD counts as changed. New models are capped at `maxNew`
 * (aliases first) so the preview stays readable.
 */
export function diffPrices(feed: FeedPrice[], layers: PriceLayers, opts: { onDate?: string; maxNew?: number } = {}): PriceDiff {
  const onDate = opts.onDate ?? new Date().toISOString().slice(0, 10)
  const manualKeys = new Set((layers.workspace ?? []).filter((p) => !p.source_url).map((p) => priceKey(p.provider, p.model)))
  const rows: PriceDiffRow[] = []
  const counts = new Map<string, { new: number; changed: number; unchanged: number }>()
  for (const f of feed) {
    const cur = resolvePrice(layers, f.provider, f.model, onDate)
    const status: DiffStatus = !cur ? 'new'
      : cur.currency === 'USD' && same(cur.input_per_1m, f.input_per_1m) && same(cur.output_per_1m, f.output_per_1m)
        && (f.cached_input_per_1m === null || same(cur.cached_input_per_1m ?? cur.input_per_1m, f.cached_input_per_1m))
        && (f.cache_write_per_1m === null || same(cur.cache_write_per_1m ?? cur.input_per_1m, f.cache_write_per_1m))
        ? 'unchanged' : 'changed'
    const c = counts.get(f.provider) ?? { new: 0, changed: 0, unchanged: 0 }
    c[status]++
    counts.set(f.provider, c)
    if (status === 'unchanged') continue
    const key = priceKey(f.provider, f.model)
    rows.push({
      key, provider: f.provider, model: f.model, status,
      next: { input_per_1m: f.input_per_1m, output_per_1m: f.output_per_1m, cached_input_per_1m: f.cached_input_per_1m, cache_write_per_1m: f.cache_write_per_1m },
      current: cur ? { input_per_1m: cur.input_per_1m, output_per_1m: cur.output_per_1m, cached_input_per_1m: cur.cached_input_per_1m, cache_write_per_1m: cur.cache_write_per_1m ?? null, currency: cur.currency, source: cur.source } : null,
      manual: cur?.source === 'workspace' && manualKeys.has(key),
      aliases: f.aliases,
    })
  }
  const changed = rows.filter((r) => r.status === 'changed')
  const fresh = rows.filter((r) => r.status === 'new').sort((a, b) => Number(dated(a.model)) - Number(dated(b.model)) || a.key.localeCompare(b.key))
  const maxNew = opts.maxNew ?? 400
  return {
    providers: [...counts.entries()].map(([provider, c]) => ({ provider, ...c })).sort((a, b) => a.provider.localeCompare(b.provider)),
    rows: [...changed, ...fresh.slice(0, maxNew)],
    more_new: Math.max(0, fresh.length - maxNew),
  }
}

/**
 * The workspace's price rows after applying the selected feed prices:
 * a selected model replaces this workspace's row for it when that row came
 * from a feed (has a source_url) — a hand-entered row only when its key is in
 * `overwriteManual`. Returns the rows and what was applied / kept.
 */
export function applyFeedPrices(workspace: readonly ModelPrice[], feed: FeedPrice[], selected: readonly string[], opts: { overwriteManual?: readonly string[]; source: string; asOf: string }): { prices: ModelPrice[]; applied: string[]; kept_manual: string[]; unknown: string[] } {
  const byKey = new Map(feed.map((f) => [priceKey(f.provider, f.model), f]))
  const overwrite = new Set(opts.overwriteManual ?? [])
  const applied: string[] = []
  const keptManual: string[] = []
  const unknown: string[] = []
  let prices = [...workspace]
  for (const key of [...new Set(selected)]) {
    const f = byKey.get(key)
    if (!f) { unknown.push(key); continue }
    const existing = prices.filter((p) => priceKey(p.provider, p.model) === key)
    if (existing.some((p) => !p.source_url) && !overwrite.has(key)) { keptManual.push(key); continue }
    prices = prices.filter((p) => priceKey(p.provider, p.model) !== key)
    prices.push({
      provider: f.provider, model: f.model, input_per_1m: f.input_per_1m, output_per_1m: f.output_per_1m, cached_input_per_1m: f.cached_input_per_1m,
      ...(f.cache_write_per_1m !== null ? { cache_write_per_1m: f.cache_write_per_1m } : {}),
      currency: 'USD', effective_date: opts.asOf, source_url: opts.source, note: `Fetched ${opts.asOf}`,
    })
    applied.push(key)
  }
  return { prices, applied, kept_manual: keptManual, unknown }
}
