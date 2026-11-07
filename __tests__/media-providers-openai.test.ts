/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openaiProvider, openaiApiBase, openaiTranscribeModel } from '@/lib/media/providers/openai'
import { getMediaProvider, MEDIA_PROVIDER_IMPLS } from '@/lib/media/providers'
import { retryTiming } from '@/lib/media/providers/shared'
import { MEDIA_PROVIDERS } from '@/lib/media/catalog'
import { isAsyncJob, type TranscriptResult } from '@/lib/media/types'
import { AUDIO, PNG_1PX, bytes, ctxFor, expectCatalogCapabilities, expectSafeError, fakeFetch, json } from './helpers/media-fetch'

const KEY = 'sk-test-secret-key-abcdef'
const ctx = (fetch: any, extra: Record<string, string> = {}) => ctxFor('openai', fetch, { baseUrl: 'https://api.openai.com', apiKey: KEY, extra })

beforeEach(() => { vi.spyOn(retryTiming, 'sleep').mockResolvedValue(undefined) })
afterEach(() => { vi.restoreAllMocks() })

describe('provider registry', () => {
  it('has a module for every catalog provider with exactly its capabilities', () => {
    expect(Object.keys(MEDIA_PROVIDER_IMPLS).sort()).toEqual(MEDIA_PROVIDERS.map((p) => p.id).sort())
    for (const info of MEDIA_PROVIDERS) {
      const impl = getMediaProvider(info.id)
      expect(impl.id).toBe(info.id)
      expectCatalogCapabilities(impl)
      if (impl.poll || info.id === 'assemblyai' || info.id === 'aws') expect(typeof impl.poll).toBe('function')
    }
  })

  it('OpenAI claims no box capabilities', () => {
    expect(openaiProvider.capabilities).not.toContain('detect_faces')
    expect(openaiProvider.capabilities).not.toContain('ocr')
    expect(openaiProvider.maxTranscribeBytes).toBe(25 * 1024 * 1024)
  })
})

describe('openai base url', () => {
  it('adds /v1 unless present (local mock overrides work)', () => {
    expect(openaiApiBase('https://api.openai.com')).toBe('https://api.openai.com/v1')
    expect(openaiApiBase('http://127.0.0.1:4790/')).toBe('http://127.0.0.1:4790/v1')
    expect(openaiApiBase('https://proxy.example.com/v1')).toBe('https://proxy.example.com/v1')
  })
})

describe('openai transcribe', () => {
  it('chooses whisper-1 for timings, the diarize model for speakers, and honours an explicit model', () => {
    expect(openaiTranscribeModel({})).toBe('whisper-1')
    expect(openaiTranscribeModel({ diarize: true })).toBe('gpt-4o-transcribe-diarize')
    expect(openaiTranscribeModel({ model: 'gpt-4o-mini-transcribe', diarize: true })).toBe('gpt-4o-mini-transcribe')
  })

  it('posts multipart verbose_json with segment + word granularities and parses segments', async () => {
    const fx = fakeFetch([json({
      language: 'english', duration: 7.5, text: 'Hello there. My card is 4111.',
      segments: [{ id: 0, start: 0, end: 2.1, text: ' Hello there.', avg_logprob: -0.1 }, { id: 1, start: 2.1, end: 7.5, text: ' My card is 4111.' }],
      words: [{ word: 'Hello', start: 0, end: 0.5 }, { word: 'there', start: 0.6, end: 1 }, { word: 'My', start: 2.2, end: 2.4 }],
    })])
    const res = await openaiProvider.transcribe!(AUDIO, { wordTimestamps: true, language: 'en', prompt: 'Visa' }, ctx(fx.fetch, { organization: 'org-1' })) as TranscriptResult
    const call = fx.calls[0]
    expect(call.url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(call.method).toBe('POST')
    expect(call.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(call.headers['openai-organization']).toBe('org-1')
    const form = call.body as FormData
    expect(form.get('model')).toBe('whisper-1')
    expect(form.get('response_format')).toBe('verbose_json')
    expect(form.getAll('timestamp_granularities[]')).toEqual(['segment', 'word'])
    expect(form.get('language')).toBe('en')
    expect(form.get('prompt')).toBe('Visa')
    expect((form.get('file') as File).name).toBe('call.mp3')
    expect(res.language).toBe('en')
    expect(res.segments).toHaveLength(2)
    expect(res.segments[0]).toMatchObject({ id: 0, start: 0, end: 2.1, text: 'Hello there.' })
    expect(res.segments[0].words?.map((w) => w.text)).toEqual(['Hello', 'there'])
    expect(res.words).toHaveLength(3)
    expect(res.usage).toEqual({ unit: 'minute', quantity: 0.125, model: 'whisper-1', operation: 'transcribe' })
  })

  it('uses diarized_json with chunking for speakers (no prompt)', async () => {
    const fx = fakeFetch([json({ task: 'transcribe', duration: 4, text: 'Hi. Hello.', segments: [
      { type: 'transcript.text.segment', id: 'seg_0', start: 0, end: 1.5, text: 'Hi.', speaker: 'A' },
      { type: 'transcript.text.segment', id: 'seg_1', start: 1.6, end: 4, text: 'Hello.', speaker: 'B' },
    ] })])
    const res = await openaiProvider.transcribe!(AUDIO, { diarize: true, prompt: 'ignored' }, ctx(fx.fetch)) as TranscriptResult
    const form = fx.calls[0].body as FormData
    expect(form.get('model')).toBe('gpt-4o-transcribe-diarize')
    expect(form.get('response_format')).toBe('diarized_json')
    expect(form.get('chunking_strategy')).toBe('auto')
    expect(form.get('prompt')).toBeNull()
    expect(res.speakers).toEqual(['A', 'B'])
    expect(res.segments[1]).toMatchObject({ start: 1.6, end: 4, speaker: 'B' })
  })

  it('plain json models give one untimed segment over the known duration', async () => {
    const fx = fakeFetch([json({ text: 'Just text.', usage: { type: 'tokens', input_tokens: 10, output_tokens: 3 } })])
    const res = await openaiProvider.transcribe!(AUDIO, { model: 'gpt-4o-transcribe' }, ctx(fx.fetch)) as TranscriptResult
    expect((fx.calls[0].body as FormData).get('response_format')).toBe('json')
    expect(res.segments).toEqual([{ id: 0, start: 0, end: 90, text: 'Just text.' }])
    expect(isAsyncJob(res)).toBe(false)
  })

  it('errors are safe; 5xx is marked retryable; the provider itself sends once (the transport retries)', async () => {
    const fx = fakeFetch([json({ error: { message: `upstream broke for key ${KEY}` } }, 503, { 'retry-after': '1' })])
    const err = await expectSafeError(openaiProvider.transcribe!(AUDIO, {}, ctx(fx.fetch)), [KEY], /OpenAI error 503/)
    expect(err.retryable).toBe(true)
    expect(fx.calls).toHaveLength(1)
    const fx2 = fakeFetch([json({ error: { message: 'Invalid file format.' } }, 400)])
    const err2 = await expectSafeError(openaiProvider.transcribe!(AUDIO, {}, ctx(fx2.fetch)), [KEY], /400: Invalid file format/)
    expect(err2.retryable).toBe(false)
  })

  it('through providerContext (lib/integrations/http): 429 is retried, a private URL is refused', async () => {
    const { providerContext } = await import('@/lib/media/http')
    const calls: string[] = []
    const responses = [json({ error: { message: 'slow down' } }, 429, { 'retry-after': '0' }), json({ text: 'ok', duration: 1 })]
    const fetchImpl = (async (url: string) => { calls.push(String(url)); return responses.shift()! }) as unknown as typeof fetch
    const pctx = providerContext({ provider: 'openai', integrationId: 'i', baseUrl: 'https://api.openai.com', apiKey: KEY, extra: {} }, { fetchImpl })
    const res = await openaiProvider.transcribe!(AUDIO, { model: 'gpt-4o-mini-transcribe' }, pctx) as TranscriptResult
    expect(res.text).toBe('ok')
    expect(calls).toHaveLength(2)
    const local = providerContext({ provider: 'openai', integrationId: 'i', baseUrl: 'http://169.254.169.254', apiKey: KEY, extra: {} }, { fetchImpl })
    await expect(openaiProvider.transcribe!(AUDIO, {}, local)).rejects.toThrow()
    expect(calls).toHaveLength(2)
  })
})

describe('openai images', () => {
  const image = { name: 'id.png', mime_type: 'image/png', bytes: PNG_1PX }

  it('analyzeImage: chat completions with a data URL and a strict json_schema; safety via moderations', async () => {
    const fx = fakeFetch([
      json({ choices: [{ message: { content: JSON.stringify({ description: 'An ID card.', labels: [{ name: 'card', confidence: 0.9 }], text: 'DRIVER LICENSE\nID 123', answer: { name: 'Sam', age: 40 } }) } }], usage: { prompt_tokens: 900, completion_tokens: 60 } }),
      json({ results: [{ flagged: false, categories: { sexual: false, violence: true }, category_scores: { sexual: 0.0001, violence: 0.71 } }] }),
    ])
    const res = await openaiProvider.analyzeImage!(image, { features: ['description', 'labels', 'text', 'safety'], prompt: 'Who?', fields: [{ name: 'name', type: 'string' }, { name: 'age', type: 'number' }] }, ctx(fx.fetch))
    const chat = fx.calls[0]
    expect(chat.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(chat.headers['content-type']).toBe('application/json')
    const body = JSON.parse(String(chat.body))
    expect(body.model).toBe('gpt-4.1-mini')
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.response_format.json_schema.schema.required).toEqual(['description', 'labels', 'text', 'answer'])
    expect(body.response_format.json_schema.schema.properties.answer.required).toEqual(['name', 'age'])
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/png;base64,/)
    const mod = fx.calls[1]
    expect(mod.url).toBe('https://api.openai.com/v1/moderations')
    expect(JSON.parse(String(mod.body))).toMatchObject({ model: 'omni-moderation-latest', input: [{ type: 'image_url' }] })
    expect(res.description).toBe('An ID card.')
    expect(res.labels).toEqual([{ name: 'card', confidence: 0.9 }])
    expect(res.ocr.map((l) => l.text)).toEqual(['DRIVER LICENSE', 'ID 123'])
    expect(res.ocr[0].box).toBeUndefined()
    expect(res.faces).toEqual([])
    expect(res.answer).toEqual({ name: 'Sam', age: 40 })
    expect(res.safety).toContainEqual({ category: 'violence', flagged: true, score: 0.71 })
    expect(res.usage).toEqual({ unit: 'token', quantity: 960, input_tokens: 900, output_tokens: 60, model: 'gpt-4.1-mini', operation: 'analyze_image' })
  })

  it('analyzeFrames sends every frame with its time and parses scenes', async () => {
    const fx = fakeFetch([json({ choices: [{ message: { content: JSON.stringify({ summary: 'A walk.', scenes: [{ start: 0, end: 5, title: 'Start', description: 'Street' }] }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })])
    const frames = [0, 5].map((time) => ({ ...image, time }))
    const res = await openaiProvider.analyzeFrames!(frames, { features: ['summary', 'scenes'] }, ctx(fx.fetch))
    const content = JSON.parse(String(fx.calls[0].body)).messages[1].content
    expect(content.filter((c: any) => c.type === 'image_url')).toHaveLength(2)
    expect(content.some((c: any) => c.text === 'Frame at 5 s')).toBe(true)
    expect(res.summary).toBe('A walk.')
    expect(res.scenes).toEqual([{ start: 0, end: 5, title: 'Start', description: 'Street' }])
  })

  it('generateImage returns decoded b64_json and per-image usage', async () => {
    const fx = fakeFetch([json({ data: [{ b64_json: Buffer.from(PNG_1PX).toString('base64') }], usage: { input_tokens: 10, output_tokens: 100 } })])
    const res = await openaiProvider.generateImage!({ prompt: 'a cat', size: '1024x1024', quality: 'medium' }, ctx(fx.fetch))
    expect(fx.calls[0].url).toBe('https://api.openai.com/v1/images/generations')
    expect(JSON.parse(String(fx.calls[0].body))).toEqual({ model: 'gpt-image-2', prompt: 'a cat', n: 1, size: '1024x1024', quality: 'medium', output_format: 'png' })
    expect(res.images[0].bytes).toEqual(PNG_1PX)
    expect(res.usage).toEqual({ unit: 'image', quantity: 1, model: 'gpt-image-2/medium/1024x1024', operation: 'generate_image' })
  })

  it('editImage posts multipart image + mask', async () => {
    const fx = fakeFetch([json({ data: [{ b64_json: Buffer.from(PNG_1PX).toString('base64') }] })])
    await openaiProvider.editImage!({ prompt: 'remove', image, mask: { ...image, name: 'mask.png' }, format: 'webp' }, ctx(fx.fetch))
    const form = fx.calls[0].body as FormData
    expect(fx.calls[0].url).toBe('https://api.openai.com/v1/images/edits')
    expect((form.get('image') as File).name).toBe('id.png')
    expect((form.get('mask') as File).name).toBe('mask.png')
    expect(form.get('output_format')).toBe('webp')
  })

  it('speak posts JSON and returns bytes with char usage', async () => {
    const audio = new Uint8Array([1, 2, 3])
    const fx = fakeFetch([bytes(audio, 'audio/mpeg')])
    const res = await openaiProvider.speak!({ text: 'Hello', voice: 'coral', speed: 9, instructions: 'calm' }, ctx(fx.fetch))
    expect(fx.calls[0].url).toBe('https://api.openai.com/v1/audio/speech')
    expect(JSON.parse(String(fx.calls[0].body))).toEqual({ model: 'gpt-4o-mini-tts', input: 'Hello', voice: 'coral', response_format: 'mp3', speed: 4, instructions: 'calm' })
    expect(res.bytes).toEqual(audio)
    expect(res.mime_type).toBe('audio/mpeg')
    expect(res.usage).toEqual({ unit: 'char', quantity: 5, model: 'gpt-4o-mini-tts', operation: 'tts' })
  })
})
