/**
 * Media cost: list prices of the media providers and the arithmetic
 * (client-safe).
 *
 * Usage (MediaUsage) comes from the provider modules: minutes of audio,
 * images, characters, requests or model tokens. Prices are list prices
 * (pay-as-you-go, USD, smallest volume tier) taken from each vendor's
 * pricing page on MEDIA_PRICES_AS_OF; anything not verifiable there is
 * left out and shows "cost unknown" — never a guessed or zero cost.
 * Instances override / extend the table with MEDIA_PRICES_JSON (a list of
 * MediaPrice) and callers may pass workspace overrides; first match wins
 * (overrides → instance → defaults), latest effective_date on or before the
 * day wins within a layer.
 *
 * Token-priced usage (OpenAI vision, Gemini) reuses the agent price table
 * (lib/agents/pricing.ts) plus MEDIA_TOKEN_PRICES below (models agents
 * don't list, Gemini audio input).
 *
 * Composite usage: a usage.model joined with "+" (e.g. Rekognition
 * "DetectFaces+DetectText", Azure "caption+tags+read") is priced per part
 * and summed; any unknown part → cost unknown.
 *
 * Not included: discounts, commitment tiers, add-ons (Deepgram keyterms,
 * AssemblyAI diarisation / keyterms, ElevenLabs keyterms), storage, taxes.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */

import { costOf, formatCost, normalizeModelId, resolvePrice, type ModelPrice } from '@/lib/agents/pricing'
import type { MediaCost, MediaOperation, MediaProviderId, MediaUsage } from './types'

export const MEDIA_PRICES_AS_OF = '2026-10-30'

export type MediaPriceUnit = 'minute' | 'image' | '1m_chars' | '1k_chars' | 'request'

export interface MediaPrice {
  provider: MediaProviderId | '*'
  operation: MediaOperation | '*'
  /** Model id; '*' = any; a trailing '*' = prefix ("aura-2-*"). */
  model: string
  unit: MediaPriceUnit
  price: number
  currency: string
  effective_date: string
  note?: string
}

const p = (provider: MediaPrice['provider'], operation: MediaPrice['operation'], model: string, unit: MediaPriceUnit, price: number, note?: string): MediaPrice => ({
  provider, operation, model, unit, price, currency: 'USD', effective_date: MEDIA_PRICES_AS_OF, ...(note ? { note } : {}),
})

/** gpt-image per-image prices (quality × size) from OpenAI's image generation guide. */
function openaiImagePrices(model: string, square: [number, number, number], wide: [number, number, number]): MediaPrice[] {
  const out: MediaPrice[] = []
  const qualities = ['low', 'medium', 'high'] as const
  qualities.forEach((q, i) => {
    for (const op of ['generate_image', 'edit_image'] as const) {
      out.push(p('openai', op, `${model}/${q}/1024x1024`, 'image', square[i]))
      out.push(p('openai', op, `${model}/${q}/1024x1536`, 'image', wide[i]))
      out.push(p('openai', op, `${model}/${q}/1536x1024`, 'image', wide[i]))
    }
  })
  return out
}

/**
 * Shipped defaults (list prices on MEDIA_PRICES_AS_OF):
 *  OpenAI developers.openai.com/api/docs/pricing (+ image guide; per-minute
 *    figures for gpt-4o-* transcribe are OpenAI's published estimates);
 *  Azure Retail Prices API (eastus, pay-as-you-go);
 *  AWS Price List (us-east-1); deepgram.com/pricing; assemblyai.com/pricing;
 *  elevenlabs.io/pricing/api; docs.stability.ai/pricing (1 credit = $0.01).
 */
export const DEFAULT_MEDIA_PRICES: readonly MediaPrice[] = [
  // OpenAI
  p('openai', 'transcribe', 'whisper-1', 'minute', 0.006),
  p('openai', 'transcribe', 'gpt-4o-transcribe', 'minute', 0.006, 'OpenAI estimate (token-billed)'),
  p('openai', 'transcribe', 'gpt-4o-mini-transcribe', 'minute', 0.003, 'OpenAI estimate (token-billed)'),
  p('openai', 'transcribe', 'gpt-4o-transcribe-diarize', 'minute', 0.006, 'OpenAI estimate (token-billed)'),
  p('openai', 'transcribe', 'gpt-transcribe', 'minute', 0.0045),
  p('openai', 'tts', 'tts-1', '1m_chars', 15),
  p('openai', 'tts', 'tts-1-hd', '1m_chars', 30),
  p('openai', 'moderation', 'omni-moderation-latest', 'request', 0, 'free'),
  ...openaiImagePrices('gpt-image-2', [0.006, 0.053, 0.211], [0.005, 0.041, 0.165]),
  ...openaiImagePrices('gpt-image-1.5', [0.009, 0.034, 0.133], [0.013, 0.05, 0.2]),
  ...openaiImagePrices('gpt-image-1-mini', [0.005, 0.011, 0.036], [0.006, 0.015, 0.052]),
  // Azure AI Speech
  p('azure_speech', 'transcribe', 'fast-transcription', 'minute', 0.006, '$0.36 per audio hour'),
  p('azure_speech', 'tts', 'neural', '1m_chars', 15),
  p('azure_speech', 'tts', 'neural-hd', '1m_chars', 22),
  // Azure AI Vision (per transaction = per feature per image, first 1M / month)
  p('azure_vision', 'analyze_image', 'tags', 'request', 0.001, 'Group 1: $1.00 per 1,000'),
  p('azure_vision', 'analyze_image', 'objects', 'request', 0.001, 'Group 1: $1.00 per 1,000'),
  p('azure_vision', 'analyze_image', 'people', 'request', 0.001, 'Group 1: $1.00 per 1,000'),
  p('azure_vision', 'analyze_image', 'caption', 'request', 0.0015, 'Group 2: $1.50 per 1,000'),
  p('azure_vision', 'analyze_image', 'read', 'request', 0.0015, 'Read billed as Group 2 ($1.50 per 1,000) — the higher of the two listed rates'),
  p('azure_vision', 'analyze_image', 'face-detect', 'request', 0.001, 'Face: $1.00 per 1,000'),
  // AWS
  p('aws', 'transcribe', 'transcribe', 'minute', 0.006, 'standard batch, us-east-1'),
  ...['DetectFaces', 'DetectLabels', 'DetectText', 'DetectModerationLabels'].map((op) => p('aws', 'analyze_image', op, 'request', 0.001, 'Rekognition Image Group 2, first 1M images / month')),
  // Deepgram
  p('deepgram', 'transcribe', 'nova-3', 'minute', 0.0043, 'pre-recorded, monolingual'),
  p('deepgram', 'transcribe', 'nova-3:multi', 'minute', 0.0052, 'pre-recorded, multilingual'),
  p('deepgram', 'tts', 'aura-2-*', '1k_chars', 0.03),
  p('deepgram', 'tts', 'aura-asteria-*', '1k_chars', 0.015, 'Aura-1'),
  // AssemblyAI
  p('assemblyai', 'transcribe', 'universal-3-5-pro', 'minute', 0.0035, '$0.21 per hour; diarisation / keyterms billed extra'),
  p('assemblyai', 'transcribe', 'universal-2', 'minute', 0.0025, '$0.15 per hour; diarisation / keyterms billed extra'),
  // ElevenLabs
  p('elevenlabs', 'transcribe', 'scribe_v2', 'minute', 0.22 / 60, '$0.22 per hour'),
  p('elevenlabs', 'tts', 'eleven_multilingual_v2', '1k_chars', 0.08),
  p('elevenlabs', 'tts', 'eleven_v3', '1k_chars', 0.08),
  p('elevenlabs', 'tts', 'eleven_flash_v2_5', '1k_chars', 0.04),
  p('elevenlabs', 'tts', 'eleven_turbo_v2_5', '1k_chars', 0.04),
  // Stability AI (credits × $0.01)
  p('stability', 'generate_image', 'core', 'image', 0.03),
  p('stability', 'generate_image', 'ultra', 'image', 0.08),
  p('stability', 'generate_image', 'sd3.5-large', 'image', 0.065),
  p('stability', 'generate_image', 'sd3.5-large-turbo', 'image', 0.04),
  p('stability', 'generate_image', 'sd3.5-medium', 'image', 0.035),
  p('stability', 'generate_image', 'sd3.5-flash', 'image', 0.025),
  p('stability', 'edit_image', 'inpaint', 'image', 0.05),
]

const tok = (provider: string, model: string, input: number, output: number, effective = MEDIA_PRICES_AS_OF, note?: string): ModelPrice => ({
  provider, model, input_per_1m: input, output_per_1m: output, cached_input_per_1m: null, currency: 'USD', effective_date: effective, ...(note ? { note } : {}),
})

/**
 * Token prices the agent table lacks. Gemini audio input is priced apart:
 * Gemini transcription looks up "<model>:audio" (audio in, text out).
 */
export const MEDIA_TOKEN_PRICES: readonly ModelPrice[] = [
  tok('gemini', 'gemini-2.5-flash:audio', 1, 2.5, MEDIA_PRICES_AS_OF, 'audio input'),
  tok('gemini', 'gemini-2.5-pro:audio', 1.25, 10, MEDIA_PRICES_AS_OF, 'prompts up to 200k tokens'),
  tok('gemini', 'gemini-2.5-flash-lite', 0.1, 0.4),
  tok('gemini', 'gemini-2.5-flash-lite:audio', 0.3, 0.4, MEDIA_PRICES_AS_OF, 'audio input'),
  tok('gemini', 'gemini-3.8-flash', 0.75, 3.75, MEDIA_PRICES_AS_OF, 'introductory price until 2026-12-31'),
  tok('gemini', 'gemini-3.8-flash', 1.5, 7.5, '2027-01-01'),
]

/* ── Validation ───────────────────────────────────────────────────── */

const PROVIDERS: readonly string[] = ['openai', 'gemini', 'azure_speech', 'azure_vision', 'aws', 'deepgram', 'assemblyai', 'elevenlabs', 'stability', '*']
const OPERATIONS: readonly string[] = ['transcribe', 'analyze_image', 'analyze_video', 'detect_faces', 'ocr', 'moderation', 'detect_objects', 'generate_image', 'edit_image', 'tts', '*']
const UNITS: readonly string[] = ['minute', 'image', '1m_chars', '1k_chars', 'request']

/** Validate a media price list (MEDIA_PRICES_JSON / overrides). */
export function normalizeMediaPriceList(value: unknown): { prices: MediaPrice[]; errors: string[] } {
  const prices: MediaPrice[] = []
  const errors: string[] = []
  if (!Array.isArray(value)) return { prices, errors: value === undefined || value === null ? [] : ['prices must be a list'] }
  value.slice(0, 500).forEach((raw: any, i) => {
    const row = `row ${i + 1}`
    const provider = String(raw?.provider ?? '*').trim().toLowerCase() || '*'
    const operation = String(raw?.operation ?? '*').trim().toLowerCase() || '*'
    const model = String(raw?.model ?? '*').trim() || '*'
    const unit = String(raw?.unit ?? '').trim().toLowerCase()
    const price = raw?.price === '' || raw?.price === null || raw?.price === undefined ? NaN : Number(raw.price)
    const currency = String(raw?.currency ?? 'USD').trim().toUpperCase()
    const date = String(raw?.effective_date ?? '').trim() || '1970-01-01'
    if (!PROVIDERS.includes(provider)) { errors.push(`${row}: provider must be one of ${PROVIDERS.join(', ')}`); return }
    if (!OPERATIONS.includes(operation)) { errors.push(`${row}: operation is invalid`); return }
    if (model.length > 200) { errors.push(`${row}: model is too long`); return }
    if (!UNITS.includes(unit)) { errors.push(`${row} (${model}): unit must be one of ${UNITS.join(', ')}`); return }
    if (!Number.isFinite(price) || price < 0 || price >= 1_000_000) { errors.push(`${row} (${model}): price must be a number ≥ 0`); return }
    if (!/^[A-Z]{3}$/.test(currency)) { errors.push(`${row} (${model}): currency must be a 3-letter code`); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) { errors.push(`${row} (${model}): effective_date must be YYYY-MM-DD`); return }
    prices.push({
      provider: provider as MediaPrice['provider'], operation: operation as MediaPrice['operation'], model, unit: unit as MediaPriceUnit, price, currency, effective_date: date,
      ...(typeof raw?.note === 'string' && raw.note.trim() ? { note: raw.note.trim().slice(0, 200) } : {}),
    })
  })
  return { prices, errors }
}

/** Instance overrides from MEDIA_PRICES_JSON (invalid rows dropped). */
export function mediaPricesFromEnv(env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}): MediaPrice[] {
  const raw = env.MEDIA_PRICES_JSON
  if (!raw || !raw.trim()) return []
  try {
    return normalizeMediaPriceList(JSON.parse(raw)).prices
  } catch {
    return []
  }
}

/* ── Pricing ──────────────────────────────────────────────────────── */

/** Which price units fit a usage unit. */
const UNIT_FOR: Record<MediaUsage['unit'], MediaPriceUnit[]> = {
  minute: ['minute'], image: ['image'], char: ['1m_chars', '1k_chars'], request: ['request'], token: [],
}

function modelMatches(priceModel: string, model: string): boolean {
  if (priceModel === '*') return true
  const pm = priceModel.toLowerCase()
  const m = model.toLowerCase()
  if (pm.endsWith('*')) return m.startsWith(pm.slice(0, -1))
  return pm === m || normalizeModelId(pm) === normalizeModelId(m)
}

function pickPrice(prices: readonly MediaPrice[], provider: MediaProviderId, operation: MediaOperation, model: string, unit: MediaUsage['unit'], onDate: string): MediaPrice | null {
  const units = UNIT_FOR[unit]
  const hits = prices.filter((x) => (x.provider === '*' || x.provider === provider) && (x.operation === '*' || x.operation === operation) && units.includes(x.unit) && modelMatches(x.model, model) && x.effective_date <= onDate)
  if (!hits.length) return null
  const specificity = (x: MediaPrice) => (x.provider !== '*' ? 4 : 0) + (x.model !== '*' && !x.model.endsWith('*') ? 2 : x.model.endsWith('*') ? 1 : 0) + (x.operation !== '*' ? 1 : 0)
  return [...hits].sort((a, b) => b.effective_date.localeCompare(a.effective_date) || specificity(b) - specificity(a))[0]
}

const unitSize = (unit: MediaPriceUnit) => (unit === '1m_chars' ? 1_000_000 : unit === '1k_chars' ? 1000 : 1)
const roundCost = (v: number) => Math.round(v * 1e10) / 1e10
const unknown = (): MediaCost => ({ status: 'unknown', amount: null, currency: null })

function fmtPrice(price: number, currency: string): string {
  return currency === 'USD' ? `$${price}` : `${price} ${currency}`
}

function tokenCost(provider: MediaProviderId, usage: MediaUsage, onDate: string): MediaCost {
  const kind = provider === 'openai' ? 'openai' : provider === 'gemini' ? 'gemini' : null
  if (!kind || !usage.model) return unknown()
  const model = kind === 'gemini' && usage.operation === 'transcribe' ? `${usage.model}:audio` : usage.model
  const price = resolvePrice({ instance: MEDIA_TOKEN_PRICES }, kind, model, onDate)
  if (!price) return unknown()
  const amount = costOf({ prompt_tokens: usage.input_tokens ?? 0, completion_tokens: usage.output_tokens ?? 0, cached_tokens: 0 }, price)
  return { status: 'priced', amount, currency: price.currency, detail: `${usage.input_tokens ?? 0} in + ${usage.output_tokens ?? 0} out tokens (${kind} ${usage.model})` }
}

/**
 * The cost of one provider call's usage. Unknown provider / model / unit →
 * { status: 'unknown', amount: null, currency: null }.
 */
export function priceMediaUsage(provider: MediaProviderId, usage: MediaUsage | undefined, overrides?: readonly MediaPrice[], onDate: string = new Date().toISOString().slice(0, 10)): MediaCost {
  if (!usage || !Number.isFinite(usage.quantity) || usage.quantity < 0) return unknown()
  if (usage.unit === 'token') return tokenCost(provider, usage, onDate)
  const layers: (readonly MediaPrice[])[] = [overrides ?? [], mediaPricesFromEnv(), DEFAULT_MEDIA_PRICES]
  const model = String(usage.model ?? '').trim()
  const parts = model.includes('+') ? model.split('+').map((m) => m.trim()).filter(Boolean) : [model || '*']
  let total = 0
  let currency: string | null = null
  const details: string[] = []
  for (const part of parts) {
    let price: MediaPrice | null = null
    for (const layer of layers) { price = pickPrice(layer, provider, usage.operation, part, usage.unit, onDate); if (price) break }
    if (!price) return unknown()
    if (currency && currency !== price.currency) return unknown()
    currency = price.currency
    const units = usage.quantity / unitSize(price.unit)
    total += units * price.price
    const unitLabel = price.unit === '1m_chars' ? '1M chars' : price.unit === '1k_chars' ? '1k chars' : price.unit
    details.push(`${usage.quantity} ${usage.unit} × ${fmtPrice(price.price, price.currency)}/${unitLabel} (${provider} ${part})`)
  }
  return { status: 'priced', amount: roundCost(total), currency, detail: details.join(' + ') }
}

/** "$0.0123" / "cost unknown". */
export function formatMediaCost(cost: MediaCost | null | undefined): string {
  return formatCost(cost?.amount ?? null, cost?.currency ?? null)
}
