/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { elevenlabsProvider } from '@/lib/media/providers/elevenlabs'
import { retryTiming } from '@/lib/media/providers/shared'
import type { TranscriptResult } from '@/lib/media/types'
import { AUDIO, bytes, ctxFor, expectCatalogCapabilities, expectSafeError, fakeFetch, json } from './helpers/media-fetch'

const KEY = 'xi-test-key-0123456789'
const ctx = (fetch: any, extra: Record<string, string> = {}) => ctxFor('elevenlabs', fetch, { baseUrl: 'https://api.elevenlabs.io', apiKey: KEY, extra })

beforeEach(() => { vi.spyOn(retryTiming, 'sleep').mockResolvedValue(undefined) })
afterEach(() => { vi.restoreAllMocks() })

describe('elevenlabs', () => {
  it('implements the catalog capabilities', () => expectCatalogCapabilities(elevenlabsProvider))

  it('speech to text: multipart scribe_v2 with diarisation; words grouped into segments', async () => {
    const fx = fakeFetch([json({ language_code: 'eng', language_probability: 0.99, text: 'Hello there. Hi.', words: [
      { text: 'Hello', start: 0, end: 0.4, type: 'word', speaker_id: 'speaker_0', logprob: -0.01 },
      { text: ' ', start: 0.4, end: 0.5, type: 'spacing', speaker_id: 'speaker_0' },
      { text: 'there.', start: 0.5, end: 0.9, type: 'word', speaker_id: 'speaker_0' },
      { text: '(laughs)', start: 1, end: 1.5, type: 'audio_event' },
      { text: 'Hi.', start: 2, end: 2.3, type: 'word', speaker_id: 'speaker_1' },
    ] })])
    const res = await elevenlabsProvider.transcribe!(AUDIO, { diarize: true, maxSpeakers: 2 }, ctx(fx.fetch)) as TranscriptResult
    const call = fx.calls[0]
    expect(call.url).toBe('https://api.elevenlabs.io/v1/speech-to-text')
    expect(call.headers['xi-api-key']).toBe(KEY)
    const form = call.body as FormData
    expect(form.get('model_id')).toBe('scribe_v2')
    expect(form.get('diarize')).toBe('true')
    expect(form.get('num_speakers')).toBe('2')
    expect(form.get('timestamps_granularity')).toBe('word')
    expect((form.get('file') as File).name).toBe('call.mp3')
    expect(res.segments).toEqual([
      { id: 0, start: 0, end: 0.9, text: 'Hello there.', speaker: 'speaker_0' },
      { id: 1, start: 2, end: 2.3, text: 'Hi.', speaker: 'speaker_1' },
    ])
    expect(res.language).toBe('eng')
    expect(res.usage).toEqual({ unit: 'minute', quantity: 1.5, model: 'scribe_v2', operation: 'transcribe' })
  })

  it('TTS without a voice looks up a default voice, then posts with output_format', async () => {
    const fx = fakeFetch([json({ voices: [{ voice_id: 'v123', name: 'Default' }] }), bytes(new Uint8Array([7]), 'audio/mpeg')])
    const res = await elevenlabsProvider.speak!({ text: 'Hello', speed: 1.1 }, ctx(fx.fetch))
    expect(fx.calls[0].url).toBe('https://api.elevenlabs.io/v2/voices?voice_type=default&page_size=1')
    expect(fx.calls[1].url).toBe('https://api.elevenlabs.io/v1/text-to-speech/v123?output_format=mp3_44100_128')
    expect(JSON.parse(String(fx.calls[1].body))).toEqual({ text: 'Hello', model_id: 'eleven_multilingual_v2', voice_settings: { speed: 1.1 } })
    expect(res).toMatchObject({ voice: 'v123', mime_type: 'audio/mpeg', usage: { unit: 'char', quantity: 5, model: 'eleven_multilingual_v2' } })
  })

  it('uses the integration voice and refuses unsupported formats', async () => {
    const fx = fakeFetch([bytes(new Uint8Array([7]), 'audio/wav')])
    await elevenlabsProvider.speak!({ text: 'Hi', format: 'wav' }, ctx(fx.fetch, { voice: 'abc' }))
    expect(fx.calls[0].url).toBe('https://api.elevenlabs.io/v1/text-to-speech/abc?output_format=wav_24000')
    await expectSafeError(elevenlabsProvider.speak!({ text: 'Hi', voice: 'abc', format: 'aac' }, ctx(fakeFetch([]).fetch)), [KEY], /does not offer aac/)
    await expectSafeError(elevenlabsProvider.transcribe!(AUDIO, {}, ctx(fakeFetch([json({ detail: { status: 'invalid_api_key', message: 'Invalid API key' } }, 401)]).fetch)), [KEY], /401: Invalid API key/)
  })
})
