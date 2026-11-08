/**
 * Fetch latest pricing: the LiteLLM price list (a fixture, no network)
 * parsed and normalised to per-1M rows mapped to our providers (aliases and
 * dated snapshots folded), the preview diff, applying selected prices
 * (hand-entered prices kept unless ticked), the service's permission, egress
 * guard, size cap and audit, and costs with cached tokens.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const egress = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('@/lib/egress-guard', async (orig) => {
  const real: any = await orig()
  // The guard itself is covered by its own tests; here: the feed goes through it.
  return { ...real, safeFetch: vi.fn(async (url: string, init: RequestInit, opts: any) => { egress.calls.push(url); return opts.fetchImpl(url, init) }) }
})
const audits = vi.hoisted(() => [] as any[])
vi.mock('@/lib/audit-log', async (orig) => ({ ...(await orig() as any), writeAudit: vi.fn(async (entry: any) => { audits.push(entry) }) }))

import { applyFeedPrices, diffPrices, parsePriceFeed, priceKey, type FeedPrice } from '@/lib/agents/price-feed'
import { costOf, DEFAULT_MODEL_PRICES, normalizeModelId, resolvePrice, type ModelPrice } from '@/lib/agents/pricing'
import { applyPriceUpdates, fetchPriceUpdates, priceFeedUrl } from '@/lib/services/agents'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any */

const FIXTURE = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'litellm-prices.json'), 'utf8'))
const feed = parsePriceFeed(FIXTURE)
const find = (provider: string, model: string) => feed.find((f) => f.provider === provider && f.model === model)

describe('parsing the LiteLLM price list', () => {
  it('per-token costs become per-1M prices on our provider kinds; prefixes removed', () => {
    expect(find('anthropic', 'claude-sonnet-5-5')).toMatchObject({ input_per_1m: 2, output_per_1m: 10, cached_input_per_1m: 0.1, cache_write_per_1m: 2.5 })
    expect(find('openai', 'gpt-5.5')).toMatchObject({ input_per_1m: 5, output_per_1m: 30, cached_input_per_1m: 0.5, cache_write_per_1m: null })
    expect(find('xai', 'grok-4.7')).toMatchObject({ input_per_1m: 2, output_per_1m: 6 })
    expect(find('gemini', 'gemini-2.5-pro')).toMatchObject({ input_per_1m: 1.25, output_per_1m: 10 })
    expect(find('mistral', 'mistral-large-latest')).toBeTruthy()
    expect(find('groq', 'openai/gpt-oss-120b')).toMatchObject({ input_per_1m: 0.15 })
    expect(find('deepseek', 'deepseek-v4-pro')).toBeTruthy()
    expect(find('together', 'moonshotai/Kimi-K3')).toBeTruthy()
    expect(find('perplexity', 'sonar')).toMatchObject({ input_per_1m: 1, output_per_1m: 1 })
    expect(find('azure_openai', 'gpt-5.5')).toBeTruthy()
    expect(find('bedrock', 'us.anthropic.claude-opus-5-5')).toMatchObject({ input_per_1m: 4.4, output_per_1m: 22 })
  })

  it('leaves out embeddings, realtime-only, free entries, region-path keys and the sample spec', () => {
    expect(feed.some((f) => f.model.includes('embedding'))).toBe(false)
    expect(feed.some((f) => f.model.startsWith('gemma'))).toBe(false)
    expect(feed.some((f) => f.model.includes('us-east-1'))).toBe(false)
    expect(feed.some((f) => f.model === 'sample_spec')).toBe(false)
    expect(() => parsePriceFeed([])).toThrow(/not a JSON object/)
  })

  it('folds dated snapshots into their alias (and maps Bedrock version suffixes)', () => {
    const sonnet = feed.filter((f) => f.provider === 'anthropic' && f.id === 'claude-sonnet-4-5')
    expect(sonnet).toHaveLength(1)
    expect(sonnet[0]).toMatchObject({ model: 'claude-sonnet-4-5', aliases: ['claude-sonnet-4-5-20250929'] })
    expect(feed.filter((f) => f.provider === 'openai' && f.id === 'gpt-4.1')).toHaveLength(1)
    expect(find('bedrock', 'anthropic.claude-haiku-4-5-20251001-v1:0')?.id).toBe('anthropic.claude-haiku-4-5')
    expect(normalizeModelId('gpt-4.1-2025-04-14')).toBe('gpt-4.1')
    expect(normalizeModelId('anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('anthropic.claude-haiku-4-5')
    // A dated id the run reports finds the alias's price.
    expect(resolvePrice({}, 'bedrock', 'anthropic.claude-sonnet-4-6-v1:0')).toMatchObject({ input_per_1m: 3 })
  })
})

describe('the preview diff', () => {
  it('new, changed and unchanged per provider against the prices in effect', () => {
    const diff = diffPrices(feed, { workspace: [], instance: [], defaults: DEFAULT_MODEL_PRICES })
    const anthropic = diff.providers.find((p) => p.provider === 'anthropic')!
    expect(anthropic.unchanged).toBeGreaterThan(0)
    const sonar = diff.rows.find((r) => r.key === 'perplexity:sonar')!
    expect(sonar).toMatchObject({ status: 'changed', current: { input_per_1m: 0.25, source: 'default' }, next: { input_per_1m: 1 } })
    expect(diff.rows.some((r) => r.key === 'anthropic:claude-sonnet-5-5')).toBe(false) // unchanged rows are only counted
    expect(diff.rows.find((r) => r.key === priceKey('bedrock', 'anthropic.claude-haiku-4-5-20251001-v1:0'))?.status).toBe('new')
  })

  it('a hand-entered workspace price is flagged manual; a fetched one is not; other currencies count as changed', () => {
    const manual: ModelPrice = { provider: 'openai', model: 'gpt-5.5', input_per_1m: 4, output_per_1m: 25, cached_input_per_1m: null, currency: 'USD', effective_date: '2026-01-01' }
    const fetched: ModelPrice = { provider: 'xai', model: 'grok-4.7', input_per_1m: 1, output_per_1m: 1, cached_input_per_1m: null, currency: 'USD', effective_date: '2026-01-01', source_url: 'https://feed' }
    const euro: ModelPrice = { provider: 'anthropic', model: 'claude-sonnet-5-5', input_per_1m: 2, output_per_1m: 10, cached_input_per_1m: 0.1, cache_write_per_1m: 2.5, currency: 'EUR', effective_date: '2026-01-01' }
    const diff = diffPrices(feed, { workspace: [manual, fetched, euro], defaults: DEFAULT_MODEL_PRICES })
    expect(diff.rows.find((r) => r.key === 'openai:gpt-5.5')).toMatchObject({ status: 'changed', manual: true })
    expect(diff.rows.find((r) => r.key === 'xai:grok-4.7')).toMatchObject({ status: 'changed', manual: false })
    expect(diff.rows.find((r) => r.key === 'anthropic:claude-sonnet-5-5')?.status).toBe('changed')
  })

  it('caps the new models listed (changed always listed)', () => {
    const many: FeedPrice[] = Array.from({ length: 30 }, (_, i) => ({ provider: 'together', model: `m-${i}`, id: `m-${i}`, input_per_1m: 1, output_per_1m: 1, cached_input_per_1m: null, cache_write_per_1m: null, aliases: [] }))
    const diff = diffPrices(many, { defaults: [] }, { maxNew: 10 })
    expect(diff.rows).toHaveLength(10)
    expect(diff.more_new).toBe(20)
  })
})

describe('applying selected prices', () => {
  const manual: ModelPrice = { provider: 'openai', model: 'gpt-5.5', input_per_1m: 4, output_per_1m: 25, cached_input_per_1m: null, currency: 'USD', effective_date: '2026-01-01' }
  const oldFetched: ModelPrice = { provider: 'xai', model: 'grok-4.7', input_per_1m: 1, output_per_1m: 1, cached_input_per_1m: null, currency: 'USD', effective_date: '2026-01-01', source_url: 'https://feed' }

  it('replaces fetched rows, keeps hand-entered ones unless ticked, records the source and date', () => {
    const r = applyFeedPrices([manual, oldFetched], feed, ['openai:gpt-5.5', 'xai:grok-4.7', 'anthropic:claude-sonnet-5-5', 'nope:x'], { source: 'https://feed', asOf: '2026-11-07' })
    expect(r.applied).toEqual(['xai:grok-4.7', 'anthropic:claude-sonnet-5-5'])
    expect(r.kept_manual).toEqual(['openai:gpt-5.5'])
    expect(r.unknown).toEqual(['nope:x'])
    expect(r.prices.find((p) => p.model === 'gpt-5.5')).toEqual(manual)
    expect(r.prices.find((p) => p.model === 'grok-4.7')).toMatchObject({ input_per_1m: 2, output_per_1m: 6, source_url: 'https://feed', effective_date: '2026-11-07' })
    expect(r.prices.find((p) => p.model === 'claude-sonnet-5-5')).toMatchObject({ cache_write_per_1m: 2.5, cached_input_per_1m: 0.1 })
    const ticked = applyFeedPrices([manual], feed, ['openai:gpt-5.5'], { overwriteManual: ['openai:gpt-5.5'], source: 'https://feed', asOf: '2026-11-07' })
    expect(ticked.applied).toEqual(['openai:gpt-5.5'])
    expect(ticked.prices).toHaveLength(1)
    expect(ticked.prices[0]).toMatchObject({ input_per_1m: 5, source_url: 'https://feed' })
  })
})

/* ── The service: permission, egress guard, size cap, saving, audit ── */

function fakeDb(costRow: any = null) {
  const writes: any[] = []
  const from = (table: string) => {
    const api: any = {
      select: () => api, eq: () => api, order: () => api, limit: () => api,
      maybeSingle: async () => ({ data: table === 'agent_cost_settings' ? costRow : null, error: null }),
      upsert: async (row: any) => { writes.push({ table, row }); return { error: null } },
      insert: async (row: any) => { writes.push({ table, row }); return { error: null } },
    }
    return api
  }
  return { client: { from } as any, writes }
}
const ctxFor = (db: any, perms: string[]): ServiceContext => ({ tenantId: 't1', actorId: 'u1', permissions: new Set(perms), supabase: db, authKind: 'api_key', source: 'api' } as any)
const feedFetch = (body = JSON.stringify(FIXTURE), headers: Record<string, string> = {}) => vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json', ...headers } })) as unknown as typeof fetch

describe('the price-update service', () => {
  beforeEach(() => { egress.calls.length = 0; audits.length = 0 })

  it('needs settings.edit', async () => {
    const db = fakeDb()
    await expect(fetchPriceUpdates(ctxFor(db.client, ['agents.view']), { url: 'https://feed.test/p.json', fetchImpl: feedFetch() })).rejects.toThrow(/settings\.edit/)
    await expect(applyPriceUpdates(ctxFor(db.client, ['agents.view']), { keys: ['xai:grok-4.7'] }, { url: 'https://feed.test/p.json', fetchImpl: feedFetch() })).rejects.toThrow(/settings\.edit/)
  })

  it('fetches through the egress guard and returns the preview', async () => {
    const db = fakeDb()
    const out = await fetchPriceUpdates(ctxFor(db.client, ['settings.edit']), { url: 'https://feed.test/p.json', fetchImpl: feedFetch() })
    expect(egress.calls).toEqual(['https://feed.test/p.json'])
    expect(out.source).toBe('https://feed.test/p.json')
    expect(out.rows.some((r) => r.key === 'perplexity:sonar' && r.status === 'changed')).toBe(true)
    expect(db.writes).toEqual([])
  })

  it('refuses an oversized list, a non-JSON body and a turned-off feed', async () => {
    const db = fakeDb()
    await expect(fetchPriceUpdates(ctxFor(db.client, ['settings.edit']), { url: 'https://feed.test/p.json', fetchImpl: feedFetch('{}', { 'content-length': String(50 * 1024 * 1024) }) })).rejects.toThrow(/too large/)
    await expect(fetchPriceUpdates(ctxFor(db.client, ['settings.edit']), { url: 'https://feed.test/p.json', fetchImpl: feedFetch('<html>') })).rejects.toThrow(/not valid JSON/)
    await expect(fetchPriceUpdates(ctxFor(db.client, ['settings.edit']), { url: null })).rejects.toThrow(/turned off/)
    const prev = process.env.AI_PRICE_FEED_URL
    process.env.AI_PRICE_FEED_URL = 'off'
    expect(await priceFeedUrl()).toBeNull()
    process.env.AI_PRICE_FEED_URL = 'https://mirror.internal/prices.json'
    expect(await priceFeedUrl()).toBe('https://mirror.internal/prices.json')
    if (prev === undefined) delete process.env.AI_PRICE_FEED_URL; else process.env.AI_PRICE_FEED_URL = prev
  })

  it('saves the selected prices as workspace prices, keeps hand-entered ones, and audits', async () => {
    const manual = { provider: 'openai', model: 'gpt-5.5', input_per_1m: 4, output_per_1m: 25, cached_input_per_1m: null, currency: 'USD', effective_date: '2026-01-01' }
    const db = fakeDb({ model_prices: [manual], budgets: { monthly_cost_budget: 50 } })
    const out = await applyPriceUpdates(ctxFor(db.client, ['settings.edit']), { keys: ['openai:gpt-5.5', 'xai:grok-4.7'] }, { url: 'https://feed.test/p.json', fetchImpl: feedFetch() })
    expect(out.applied).toEqual(['xai:grok-4.7'])
    expect(out.kept_manual).toEqual(['openai:gpt-5.5'])
    const saved = db.writes.find((w) => w.table === 'agent_cost_settings')!.row
    expect(saved.model_prices).toEqual(expect.arrayContaining([expect.objectContaining(manual), expect.objectContaining({ model: 'grok-4.7', source_url: 'https://feed.test/p.json' })]))
    expect(saved.budgets.monthly_cost_budget).toBe(50)
    expect(audits[0]).toMatchObject({ summary: expect.stringMatching(/Updated 1 AI model price/), metadata: expect.objectContaining({ source: 'https://feed.test/p.json', kept_manual: ['openai:gpt-5.5'] }) })
  })
})

describe('costs with cached tokens', () => {
  it('a fetched Claude price bills cache reads and writes at their own rates', () => {
    const [p] = applyFeedPrices([], feed, ['anthropic:claude-sonnet-5-5'], { source: 's', asOf: '2026-11-07' }).prices
    // 100k prompt: 80k cache read, 10k cache write, 10k plain; 1k output.
    expect(costOf({ prompt_tokens: 100_000, completion_tokens: 1_000, cached_tokens: 80_000, cache_write_tokens: 10_000 }, p)).toBeCloseTo((10_000 * 2 + 80_000 * 0.1 + 10_000 * 2.5 + 1_000 * 10) / 1e6, 10)
    // Without cache fields everything is input.
    expect(costOf({ prompt_tokens: 100_000, completion_tokens: 0 }, p)).toBeCloseTo(0.2, 10)
  })
})
