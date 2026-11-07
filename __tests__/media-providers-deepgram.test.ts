/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deepgramProvider } from '@/lib/media/providers/deepgram'
import { retryTiming } from '@/lib/media/providers/shared'
import type { TranscriptResult } from '@/lib/media/types'
import { AUDIO, bytes, ctxFor, expectCatalogCapabilities, expectSafeError, fakeFetch, json } from './helpers/media-fetch'

const KEY = 'dg-test-key-0123456789'
const ctx = (fetch: any) => ctxFor('deepgram', fetch, { baseUrl: 'https://api.deepgram.com', apiKey: KEY })

beforeEach(() => { vi.spyOn(retryTiming, 'sleep').mockResolvedValue(undefined) })
afterEach(() => { vi.restoreAllMocks() })

describe('deepgram', () => {
  it('implements the catalog capabilities', () => expectCatalogCapabilities(deepgramProvider))

  it('posts raw bytes to /v1/listen with Token auth and parses utterances', async () => {
    const fx = fakeFetch([json({
      metadata: { duration: 12, request_id: 'r1' },
      results: {
        channels: [{ detected_language: 'en', alternatives: [{ transcript: 'Hello there. My card is 4111.', confidence: 0.98, words: [
          { word: 'hello', punctuated_word: 'Hello', start: 0.1, end: 0.4, confidence: 0.99, speaker: 0 },
          { word: 'my', punctuated_word: 'My', start: 2.0, end: 2.2, confidence: 0.97, speaker: 1 },
        ] }] }],
        utterances: [
          { start: 0.1, end: 1.0, confidence: 0.99, channel: 0, transcript: 'Hello there.', speaker: 0, words: [{ word: 'hello', punctuated_word: 'Hello', start: 0.1, end: 0.4, confidence: 0.99, speaker: 0 }] },
          { start: 2.0, end: 4.0, confidence: 0.97, channel: 0, transcript: 'My card is 4111.', speaker: 1, words: [] },
        ],
      },
    })])
    const res = await deepgramProvider.transcribe!(AUDIO, { diarize: true, wordTimestamps: true, prompt: 'Visa, Mastercard' }, ctx(fx.fetch)) as TranscriptResult
    const call = fx.calls[0]
    const url = new URL(call.url)
    expect(url.origin + url.pathname).toBe('https://api.deepgram.com/v1/listen')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ model: 'nova-3', smart_format: 'true', utterances: 'true', diarize: 'true', detect_language: 'true' })
    expect(url.searchParams.getAll('keyterm')).toEqual(['Visa', 'Mastercard'])
    expect(call.headers.authorization).toBe(`Token ${KEY}`)
    expect(call.headers['content-type']).toBe('audio/mpeg')
    expect(call.body).toBe(AUDIO.bytes)
    expect(res.language).toBe('en')
    expect(res.duration).toBe(12)
    expect(res.segments.map((s) => s.speaker)).toEqual(['speaker_0', 'speaker_1'])
    expect(res.segments[0].words?.[0]).toEqual({ text: 'Hello', start: 0.1, end: 0.4, confidence: 0.99, speaker: 'speaker_0' })
    expect(res.words).toHaveLength(2)
    expect(res.usage).toEqual({ unit: 'minute', quantity: 0.2, model: 'nova-3', operation: 'transcribe' })
  })

  it('speak: /v1/speak with model + encoding, JSON text body', async () => {
    const fx = fakeFetch([bytes(new Uint8Array([1, 2]), 'audio/wav')])
    const res = await deepgramProvider.speak!({ text: 'Hello', format: 'wav' }, ctx(fx.fetch))
    const url = new URL(fx.calls[0].url)
    expect(url.pathname).toBe('/v1/speak')
    expect(Object.fromEntries(url.searchParams)).toEqual({ model: 'aura-2-thalia-en', encoding: 'linear16', container: 'wav' })
    expect(JSON.parse(String(fx.calls[0].body))).toEqual({ text: 'Hello' })
    expect(res).toMatchObject({ mime_type: 'audio/wav', format: 'wav', usage: { unit: 'char', quantity: 5 } })
  })

  it('rejects text over the 2,000 character limit; errors are safe', async () => {
    await expectSafeError(deepgramProvider.speak!({ text: 'x'.repeat(2001) }, ctx(fakeFetch([]).fetch)), [KEY], /2000 characters/)
    const fx = fakeFetch([json({ err_code: 'INVALID_AUTH', err_msg: 'Invalid credentials.' }, 401)])
    await expectSafeError(deepgramProvider.transcribe!(AUDIO, {}, ctx(fx.fetch)), [KEY], /401: Invalid credentials/)
  })
})
