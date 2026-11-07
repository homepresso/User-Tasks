/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assemblyaiProvider } from '@/lib/media/providers/assemblyai'
import { retryTiming } from '@/lib/media/providers/shared'
import { isAsyncJob, type MediaAsyncJob, type TranscriptResult } from '@/lib/media/types'
import { AUDIO, ctxFor, expectCatalogCapabilities, expectSafeError, fakeFetch, json } from './helpers/media-fetch'

const KEY = 'aai-test-key-0123456789'
const ctx = (fetch: any, baseUrl = 'https://api.assemblyai.com') => ctxFor('assemblyai', fetch, { baseUrl, apiKey: KEY })

beforeEach(() => { vi.spyOn(retryTiming, 'sleep').mockResolvedValue(undefined) })
afterEach(() => { vi.restoreAllMocks() })

describe('assemblyai', () => {
  it('implements the catalog capabilities', () => {
    expectCatalogCapabilities(assemblyaiProvider)
    expect(typeof assemblyaiProvider.poll).toBe('function')
    expect(typeof assemblyaiProvider.cleanup).toBe('function')
  })

  it('upload → submit → poll pending → completed → cleanup', async () => {
    const fx = fakeFetch([json({ upload_url: 'https://cdn.assemblyai.com/upload/abc' }), json({ id: 't1', status: 'queued' })])
    const job = await assemblyaiProvider.transcribe!(AUDIO, { diarize: true, maxSpeakers: 2, wordTimestamps: true, prompt: 'Contoso' }, ctx(fx.fetch)) as MediaAsyncJob
    const [upload, submit] = fx.calls
    expect(upload).toMatchObject({ method: 'POST', url: 'https://api.assemblyai.com/v2/upload' })
    expect(upload.headers.authorization).toBe(KEY)
    expect(upload.headers['content-type']).toBe('application/octet-stream')
    expect(upload.body).toBe(AUDIO.bytes)
    expect(submit.url).toBe('https://api.assemblyai.com/v2/transcript')
    expect(JSON.parse(String(submit.body))).toEqual({
      audio_url: 'https://cdn.assemblyai.com/upload/abc', speech_models: ['universal-3-5-pro', 'universal-2'], language_detection: true,
      speaker_labels: true, speaker_options: { max_speakers_expected: 2 }, keyterms_prompt: ['Contoso'],
    })
    expect(isAsyncJob(job)).toBe(true)
    expect(job.job.transcript_id).toBe('t1')

    const pending = fakeFetch([json({ id: 't1', status: 'processing' })])
    expect(await assemblyaiProvider.poll!(job, ctx(pending.fetch))).toEqual({ done: false, pollAfterMs: 3000 })
    expect(pending.calls[0]).toMatchObject({ method: 'GET', url: 'https://api.assemblyai.com/v2/transcript/t1' })

    const done = fakeFetch([json({
      id: 't1', status: 'completed', text: 'Hi. Hello.', audio_duration: 30, language_code: 'en_us', speech_model_used: 'universal-3-5-pro',
      words: [{ text: 'Hi.', start: 100, end: 500, confidence: 0.9, speaker: 'A' }, { text: 'Hello.', start: 1000, end: 1500, confidence: 0.8, speaker: 'B' }],
      utterances: [
        { speaker: 'A', start: 100, end: 500, text: 'Hi.', confidence: 0.9, words: [{ text: 'Hi.', start: 100, end: 500, confidence: 0.9, speaker: 'A' }] },
        { speaker: 'B', start: 1000, end: 1500, text: 'Hello.', confidence: 0.8, words: [] },
      ],
    })])
    const result = await assemblyaiProvider.poll!(job, ctx(done.fetch))
    expect(result.done).toBe(true)
    const t = (result as { done: true; result: TranscriptResult }).result
    expect(t.segments[0]).toMatchObject({ start: 0.1, end: 0.5, speaker: 'A', text: 'Hi.' })
    expect(t.segments[0].words?.[0]).toEqual({ text: 'Hi.', start: 0.1, end: 0.5, confidence: 0.9, speaker: 'A' })
    expect(t.speakers).toEqual(['A', 'B'])
    expect(t.duration).toBe(30)
    expect(t.usage).toEqual({ unit: 'minute', quantity: 0.5, model: 'universal-3-5-pro', operation: 'transcribe' })

    const clean = fakeFetch([json({ id: 't1', status: 'completed', text: 'Transcript text deleted' })])
    await assemblyaiProvider.cleanup!(job, ctx(clean.fetch))
    expect(clean.calls[0]).toMatchObject({ method: 'DELETE', url: 'https://api.assemblyai.com/v2/transcript/t1' })
  })

  it('an explicit model and the EU base URL are honoured; errors are safe', async () => {
    const fx = fakeFetch([json({ upload_url: 'u' }), json({ id: 't2' })])
    await assemblyaiProvider.transcribe!(AUDIO, { model: 'universal-2', language: 'de' }, ctx(fx.fetch, 'https://api.eu.assemblyai.com'))
    expect(fx.calls[1].url).toBe('https://api.eu.assemblyai.com/v2/transcript')
    expect(JSON.parse(String(fx.calls[1].body))).toMatchObject({ speech_models: ['universal-2'], language_code: 'de' })
    const job: MediaAsyncJob = { async: true, provider: 'assemblyai', operation: 'transcribe', pollAfterMs: 1, job: { transcript_id: 't3' } }
    await expectSafeError(assemblyaiProvider.poll!(job, ctx(fakeFetch([json({ id: 't3', status: 'error', error: 'Audio file is empty' })]).fetch)), [KEY], /Audio file is empty/)
    await expectSafeError(assemblyaiProvider.transcribe!(AUDIO, {}, ctx(fakeFetch([json({ error: 'Authentication error, API token missing/invalid' }, 401)]).fetch)), [KEY], /401: Authentication error/)
  })
})
