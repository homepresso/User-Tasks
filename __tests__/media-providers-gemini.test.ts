/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { geminiBox, geminiProvider, GEMINI_INLINE_MAX_BYTES } from '@/lib/media/providers/gemini'
import { retryTiming } from '@/lib/media/providers/shared'
import { isAsyncJob, type MediaAsyncJob, type TranscriptResult, type VideoAnalysis } from '@/lib/media/types'
import { AUDIO, PNG_1PX, ctxFor, expectCatalogCapabilities, expectSafeError, fakeFetch, json } from './helpers/media-fetch'

const KEY = 'AIza-test-gemini-key'
const ctx = (fetch: any) => ctxFor('gemini', fetch, { baseUrl: 'https://generativelanguage.googleapis.com', apiKey: KEY })
const answer = (data: unknown, usage = { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5 }) =>
  json({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: 'STOP' }], usageMetadata: usage })

beforeEach(() => { vi.spyOn(retryTiming, 'sleep').mockResolvedValue(undefined) })
afterEach(() => { vi.restoreAllMocks() })

describe('gemini', () => {
  it('implements the catalog capabilities', () => {
    expectCatalogCapabilities(geminiProvider)
    expect(typeof geminiProvider.poll).toBe('function')
    expect(typeof geminiProvider.cleanup).toBe('function')
  })

  it('converts box_2d [ymin,xmin,ymax,xmax] (0-1000) to a normalised box', () => {
    expect(geminiBox([200, 60, 750, 310])).toEqual({ x: 0.06, y: 0.2, width: 0.25, height: 0.55 })
    expect(geminiBox([10, 10])).toBeUndefined()
  })

  it('analyzeImage: inline_data, JSON schema, faces / text lines / plates with boxes', async () => {
    const fx = fakeFetch([answer({
      description: 'An ID card.',
      labels: [{ name: 'card', confidence: 0.95 }],
      objects: [{ label: 'license plate', box_2d: [500, 400, 560, 600] }],
      text_lines: [{ text: 'ID 078-05-1120', box_2d: [550, 400, 630, 900] }],
      faces: [{ box_2d: [200, 60, 750, 310], confidence: 0.9 }],
    })])
    const res = await geminiProvider.analyzeImage!({ name: 'id.png', mime_type: 'image/png', bytes: PNG_1PX }, { features: ['description', 'labels', 'objects', 'text', 'faces'] }, ctx(fx.fetch))
    const call = fx.calls[0]
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
    expect(call.headers['x-goog-api-key']).toBe(KEY)
    expect(call.url).not.toContain(KEY)
    const body = JSON.parse(String(call.body))
    expect(body.contents[0].parts[0].inline_data).toEqual({ mime_type: 'image/png', data: Buffer.from(PNG_1PX).toString('base64') })
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(Object.keys(body.generationConfig.responseJsonSchema.properties)).toEqual(['description', 'labels', 'objects', 'text_lines', 'faces'])
    expect(res.faces).toEqual([{ box: { x: 0.06, y: 0.2, width: 0.25, height: 0.55 }, confidence: 0.9 }])
    expect(res.ocr[0]).toEqual({ text: 'ID 078-05-1120', box: { x: 0.4, y: 0.55, width: 0.5, height: 0.08 } })
    expect(res.text).toBe('ID 078-05-1120')
    expect(res.objects[0].name).toBe('license plate')
    expect(res.usage).toEqual({ unit: 'token', quantity: 125, input_tokens: 100, output_tokens: 25, model: 'gemini-3.8-flash', operation: 'analyze_image' })
  })

  it('transcribe inline: prompted JSON with MM:SS timestamps and speakers', async () => {
    const fx = fakeFetch([answer({ language: 'en', segments: [
      { start: '00:00.0', end: '00:03.5', speaker: 'Speaker 1', text: 'Thanks for calling.' },
      { start: '00:03.5', end: '01:02', speaker: 'Speaker 2', text: 'Hi, my card number is 4111.' },
    ] })])
    const res = await geminiProvider.transcribe!(AUDIO, { diarize: true }, ctx(fx.fetch)) as TranscriptResult
    const body = JSON.parse(String(fx.calls[0].body))
    expect(body.contents[0].parts[0].text).toMatch(/Speaker 1/)
    expect(body.contents[0].parts[1].inline_data.mime_type).toBe('audio/mpeg')
    expect(res.segments[1]).toMatchObject({ start: 3.5, end: 62, speaker: 'Speaker 2' })
    expect(res.speakers).toEqual(['Speaker 1', 'Speaker 2'])
    expect(res.usage?.unit).toBe('token')
    expect(res.usage?.operation).toBe('transcribe')
  })

  it('large media: resumable Files API upload, waits for ACTIVE, file_data, deletes the file', async () => {
    const big = { name: 'long.mp4', mime_type: 'video/mp4', bytes: new Uint8Array(GEMINI_INLINE_MAX_BYTES + 10), duration: 600 }
    const fx = fakeFetch([
      new Response('{}', { status: 200, headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=abc' } }),
      json({ file: { name: 'files/f1', uri: 'https://generativelanguage.googleapis.com/v1beta/files/f1', mimeType: 'video/mp4', state: 'PROCESSING' } }),
      json({ name: 'files/f1', uri: 'https://generativelanguage.googleapis.com/v1beta/files/f1', mimeType: 'video/mp4', state: 'ACTIVE' }),
      answer({ summary: 'A demo.', scenes: [{ start: '00:00', end: '01:30', title: 'Intro', description: 'Hello' }] }),
      json({}),
    ])
    const res = await geminiProvider.analyzeVideo!(big, { features: ['summary', 'scenes'] }, ctx(fx.fetch)) as VideoAnalysis
    const [start, upload, get, gen, del] = fx.calls
    expect(start.url).toBe('https://generativelanguage.googleapis.com/upload/v1beta/files')
    expect(start.headers['x-goog-upload-protocol']).toBe('resumable')
    expect(start.headers['x-goog-upload-command']).toBe('start')
    expect(start.headers['x-goog-upload-header-content-length']).toBe(String(big.bytes.byteLength))
    expect(start.headers['x-goog-upload-header-content-type']).toBe('video/mp4')
    expect(upload.url).toContain('upload_id=abc')
    expect(upload.headers['x-goog-upload-command']).toBe('upload, finalize')
    expect(upload.headers['x-goog-upload-offset']).toBe('0')
    expect(get).toMatchObject({ method: 'GET', url: 'https://generativelanguage.googleapis.com/v1beta/files/f1' })
    expect(JSON.parse(String(gen.body)).contents[0].parts[0]).toEqual({ file_data: { mime_type: 'video/mp4', file_uri: 'https://generativelanguage.googleapis.com/v1beta/files/f1' } })
    expect(del).toMatchObject({ method: 'DELETE', url: 'https://generativelanguage.googleapis.com/v1beta/files/f1' })
    expect(res.scenes).toEqual([{ start: 0, end: 90, title: 'Intro', description: 'Hello' }])
    expect(res.duration).toBe(600)
  })

  it('a file still processing becomes an async job; poll runs it when ACTIVE; cleanup deletes', async () => {
    const big = { ...AUDIO, bytes: new Uint8Array(GEMINI_INLINE_MAX_BYTES + 1) }
    const processing = () => json({ name: 'files/f2', uri: 'u2', mimeType: 'audio/mpeg', state: 'PROCESSING' })
    const fx = fakeFetch([
      new Response('{}', { headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/x' } }),
      json({ file: { name: 'files/f2', uri: 'u2', mimeType: 'audio/mpeg', state: 'PROCESSING' } }),
      processing(), processing(), processing(), processing(), processing(),
    ])
    const job = await geminiProvider.transcribe!(big, { language: 'en' }, ctx(fx.fetch)) as MediaAsyncJob
    expect(isAsyncJob(job)).toBe(true)
    expect(job.job).toMatchObject({ file_name: 'files/f2', model: 'gemini-3.8-flash' })
    expect(JSON.stringify(job)).not.toContain(KEY)

    const fx2 = fakeFetch([processing()])
    expect(await geminiProvider.poll!(job, ctx(fx2.fetch))).toEqual({ done: false, pollAfterMs: 5000 })
    const fx3 = fakeFetch([json({ name: 'files/f2', uri: 'u2', mimeType: 'audio/mpeg', state: 'ACTIVE' }), answer({ segments: [{ start: '00:01', end: '00:02', text: 'Hi.' }] })])
    const done = await geminiProvider.poll!(job, ctx(fx3.fetch))
    expect(done.done).toBe(true)
    if (done.done) expect((done.result as TranscriptResult).segments[0]).toMatchObject({ start: 1, end: 2, text: 'Hi.' })
    const fx4 = fakeFetch([json({})])
    await geminiProvider.cleanup!(job, ctx(fx4.fetch))
    expect(fx4.calls[0]).toMatchObject({ method: 'DELETE', url: 'https://generativelanguage.googleapis.com/v1beta/files/f2' })
  })

  it('blocked prompts and HTTP errors are safe', async () => {
    const fx = fakeFetch([json({ promptFeedback: { blockReason: 'SAFETY' } })])
    await expectSafeError(geminiProvider.analyzeImage!({ name: 'a.png', mime_type: 'image/png', bytes: PNG_1PX }, { features: ['description'] }, ctx(fx.fetch)), [KEY], /blocked: SAFETY/)
    const fx2 = fakeFetch([json({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, 400)])
    await expectSafeError(geminiProvider.analyzeImage!({ name: 'a.png', mime_type: 'image/png', bytes: PNG_1PX }, { features: ['description'] }, ctx(fx2.fetch)), [KEY], /Gemini error 400: API key not valid/)
  })
})
