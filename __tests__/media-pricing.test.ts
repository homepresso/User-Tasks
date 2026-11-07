import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MEDIA_PRICES, MEDIA_PRICES_AS_OF, formatMediaCost, mediaPricesFromEnv, normalizeMediaPriceList, priceMediaUsage } from '@/lib/media/pricing'
import { MEDIA_PROVIDERS } from '@/lib/media/catalog'

afterEach(() => { vi.unstubAllEnvs() })

describe('media pricing', () => {
  it('ships dated, valid defaults', () => {
    expect(MEDIA_PRICES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const { prices, errors } = normalizeMediaPriceList(DEFAULT_MEDIA_PRICES)
    expect(errors).toEqual([])
    expect(prices).toHaveLength(DEFAULT_MEDIA_PRICES.length)
  })

  it('prices per-minute transcription', () => {
    const cost = priceMediaUsage('openai', { unit: 'minute', quantity: 1.5, model: 'whisper-1', operation: 'transcribe' })
    expect(cost).toMatchObject({ status: 'priced', amount: 0.009, currency: 'USD' })
    expect(cost.detail).toBe('1.5 minute × $0.006/minute (openai whisper-1)')
    expect(priceMediaUsage('aws', { unit: 'minute', quantity: 10, model: 'transcribe', operation: 'transcribe' }).amount).toBe(0.06)
    expect(priceMediaUsage('deepgram', { unit: 'minute', quantity: 10, model: 'nova-3:multi', operation: 'transcribe' }).amount).toBe(0.052)
  })

  it('prices characters (per 1M / per 1k) and prefix models', () => {
    expect(priceMediaUsage('openai', { unit: 'char', quantity: 2000, model: 'tts-1', operation: 'tts' }).amount).toBe(0.03)
    expect(priceMediaUsage('deepgram', { unit: 'char', quantity: 500, model: 'aura-2-thalia-en', operation: 'tts' }).amount).toBe(0.015)
  })

  it('prices images by model / quality / size; unknown quality → unknown', () => {
    expect(priceMediaUsage('openai', { unit: 'image', quantity: 2, model: 'gpt-image-2/medium/1024x1024', operation: 'generate_image' }).amount).toBe(0.106)
    expect(priceMediaUsage('openai', { unit: 'image', quantity: 1, model: 'gpt-image-2', operation: 'generate_image' })).toEqual({ status: 'unknown', amount: null, currency: null })
    expect(priceMediaUsage('stability', { unit: 'image', quantity: 1, model: 'inpaint', operation: 'edit_image' }).amount).toBe(0.05)
  })

  it('sums composite request usage; any unknown part → unknown', () => {
    expect(priceMediaUsage('aws', { unit: 'request', quantity: 1, model: 'DetectFaces+DetectText', operation: 'analyze_image' }).amount).toBe(0.002)
    expect(priceMediaUsage('azure_vision', { unit: 'request', quantity: 1, model: 'caption+tags+read+face-detect', operation: 'analyze_image' }).amount).toBe(0.005)
    expect(priceMediaUsage('azure_vision', { unit: 'request', quantity: 1, model: 'caption+mystery', operation: 'analyze_image' }).status).toBe('unknown')
  })

  it('token usage reuses the agent price table (and Gemini audio input prices)', () => {
    const vision = priceMediaUsage('openai', { unit: 'token', quantity: 1500, input_tokens: 1000, output_tokens: 500, model: 'gpt-4.1-mini', operation: 'analyze_image' })
    expect(vision).toMatchObject({ status: 'priced', amount: 0.0012, currency: 'USD' })
    const audio = priceMediaUsage('gemini', { unit: 'token', quantity: 2000, input_tokens: 1_000_000, output_tokens: 0, model: 'gemini-2.5-flash', operation: 'transcribe' })
    expect(audio.amount).toBe(1)
    const video = priceMediaUsage('gemini', { unit: 'token', quantity: 2000, input_tokens: 1_000_000, output_tokens: 0, model: 'gemini-2.5-flash', operation: 'analyze_video' })
    expect(video.amount).toBe(0.3)
    expect(priceMediaUsage('gemini', { unit: 'token', quantity: 1, input_tokens: 1_000_000, output_tokens: 0, model: 'gemini-3.8-flash', operation: 'analyze_image' }, undefined, '2026-11-01').amount).toBe(0.75)
    expect(priceMediaUsage('gemini', { unit: 'token', quantity: 1, input_tokens: 1_000_000, output_tokens: 0, model: 'gemini-3.8-flash', operation: 'analyze_image' }, undefined, '2027-02-01').amount).toBe(1.5)
  })

  it('unknown provider usage / model / no usage → cost unknown (never guessed)', () => {
    expect(priceMediaUsage('elevenlabs', undefined)).toEqual({ status: 'unknown', amount: null, currency: null })
    expect(priceMediaUsage('elevenlabs', { unit: 'minute', quantity: 1, model: 'scribe_v1', operation: 'transcribe' }).status).toBe('unknown')
    expect(priceMediaUsage('azure_speech', { unit: 'token', quantity: 1, operation: 'transcribe' }).status).toBe('unknown')
    expect(formatMediaCost({ status: 'unknown', amount: null, currency: null })).toBe('cost unknown')
    expect(formatMediaCost({ status: 'priced', amount: 0.009, currency: 'USD' })).toBe('$0.0090')
  })

  it('overrides and MEDIA_PRICES_JSON win over defaults', () => {
    const usage = { unit: 'minute' as const, quantity: 2, model: 'whisper-1', operation: 'transcribe' as const }
    expect(priceMediaUsage('openai', usage, [{ provider: 'openai', operation: 'transcribe', model: '*', unit: 'minute', price: 0.01, currency: 'EUR', effective_date: '2026-01-01' }])).toMatchObject({ amount: 0.02, currency: 'EUR' })
    vi.stubEnv('MEDIA_PRICES_JSON', JSON.stringify([{ provider: 'openai', operation: 'transcribe', model: 'whisper-1', unit: 'minute', price: 0.004, effective_date: '2026-01-01' }, { provider: 'nope' }]))
    expect(mediaPricesFromEnv()).toHaveLength(1)
    expect(priceMediaUsage('openai', usage).amount).toBe(0.008)
    vi.stubEnv('MEDIA_PRICES_JSON', 'not json')
    expect(mediaPricesFromEnv()).toEqual([])
  })

  it('validates price rows', () => {
    const { prices, errors } = normalizeMediaPriceList([
      { provider: 'openai', operation: 'tts', model: 'tts-1', unit: '1m_chars', price: 15 },
      { provider: 'openai', unit: 'gallon', price: 1 },
      { provider: 'openai', unit: 'minute', price: -1 },
      { provider: 'openai', unit: 'minute', price: 1, currency: 'dollars' },
      { provider: 'openai', unit: 'minute', price: 1, effective_date: '2026/01/01' },
    ])
    expect(prices).toHaveLength(1)
    expect(prices[0]).toMatchObject({ currency: 'USD', effective_date: '1970-01-01' })
    expect(errors).toHaveLength(4)
    expect(normalizeMediaPriceList('x').errors).toEqual(['prices must be a list'])
  })

  it('every catalog default transcription model of a minute-priced provider has a price', () => {
    for (const p of MEDIA_PROVIDERS) {
      const model = p.defaults.transcribe
      if (!model || p.id === 'gemini') continue
      const priced = DEFAULT_MEDIA_PRICES.some((x) => x.provider === p.id && x.operation === 'transcribe')
      expect(priced, p.id).toBe(true)
    }
  })
})
