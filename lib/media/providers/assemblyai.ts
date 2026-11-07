/**
 * AssemblyAI media provider (server-only): asynchronous transcription.
 *
 * API docs (shapes checked 2026-10-30):
 *   https://www.assemblyai.com/docs/api-reference/files/upload
 *   https://www.assemblyai.com/docs/api-reference/transcripts/submit
 *   https://www.assemblyai.com/docs/pre-recorded-audio/select-the-speech-model
 *
 * Flow: POST /v2/upload (raw bytes) → upload_url; POST /v2/transcript →
 * id; the step polls GET /v2/transcript/{id} until completed / error;
 * cleanup DELETE /v2/transcript/{id} (removes the transcript and the
 * uploaded media from AssemblyAI — privacy). `speech_models` (an array) is
 * current; the singular `speech_model` is deprecated. Times are in ms.
 * EU accounts set the integration base URL to https://api.eu.assemblyai.com.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */

import { MediaProviderError, type MediaAsyncJob, type MediaBlob, type MediaProvider, type MediaProviderContext, type PollResult, type TranscribeOptions, type TranscriptResult, type TranscriptSegment, type TranscriptWord } from '../types'
import { MEDIA_PROVIDER_BY_ID } from '../catalog'
import { bytesBody, joinUrl, mediaJson, mediaRequest, minutesOf, num, requireKey, round, speakersOf } from './shared'

const INFO = MEDIA_PROVIDER_BY_ID.assemblyai
const LABEL = 'AssemblyAI'
const POLL_MS = 3000
/** Default: AssemblyAI's own routing (Universal-3.5 Pro, falling back to Universal-2 for other languages). */
export const ASSEMBLYAI_DEFAULT_MODELS = ['universal-3-5-pro', 'universal-2']

const base = (ctx: MediaProviderContext) => String(ctx.credentials.baseUrl || 'https://api.assemblyai.com').replace(/\/+$/, '')
const auth = (ctx: MediaProviderContext) => ({ Authorization: requireKey(ctx.credentials, LABEL) })

function speechModels(model: string | undefined): string[] {
  const m = String(model ?? '').trim()
  // "universal" (older catalog default) / "best" → AssemblyAI's default routing.
  if (!m || m === 'universal' || m === 'best') return ASSEMBLYAI_DEFAULT_MODELS
  return [m]
}

const ms = (v: unknown) => round((Number(v) || 0) / 1000, 3)

export function assemblyTranscriptBody(audioUrl: string, options: TranscribeOptions, model: string | undefined): Record<string, unknown> {
  const body: Record<string, unknown> = { audio_url: audioUrl, speech_models: speechModels(model) }
  if (options.language) body.language_code = options.language
  else body.language_detection = true
  if (options.diarize) {
    body.speaker_labels = true
    if (options.maxSpeakers && options.maxSpeakers > 0) body.speaker_options = { max_speakers_expected: Math.floor(options.maxSpeakers) }
  }
  const terms = String(options.prompt ?? '').split(/[\n,;]+/).map((t) => t.trim()).filter((t) => t && t.split(/\s+/).length <= 6).slice(0, 200)
  if (terms.length) body.keyterms_prompt = terms
  return body
}

async function transcribe(input: MediaBlob, options: TranscribeOptions, ctx: MediaProviderContext): Promise<MediaAsyncJob> {
  const upload = await mediaJson<any>(ctx, LABEL, joinUrl(base(ctx), '/v2/upload'), {
    method: 'POST', headers: { ...auth(ctx), 'Content-Type': 'application/octet-stream' }, body: bytesBody(input.bytes),
  })
  const audioUrl = String(upload?.upload_url ?? '')
  if (!audioUrl) throw new MediaProviderError(`${LABEL} upload returned no upload_url`)
  const model = options.model || ctx.credentials.extra?.transcribe_model
  const submitted = await mediaJson<any>(ctx, LABEL, joinUrl(base(ctx), '/v2/transcript'), {
    method: 'POST', headers: { ...auth(ctx), 'Content-Type': 'application/json' }, body: JSON.stringify(assemblyTranscriptBody(audioUrl, options, model)),
  }, { noRetry: true })
  const id = String(submitted?.id ?? '')
  if (!id) throw new MediaProviderError(`${LABEL} returned no transcript id`)
  ctx.log?.(`${LABEL}: transcript ${id} submitted`)
  return {
    async: true, provider: 'assemblyai', operation: 'transcribe', pollAfterMs: POLL_MS,
    job: { transcript_id: id, diarize: Boolean(options.diarize), word_timestamps: Boolean(options.wordTimestamps), language: options.language ?? '', duration: input.duration ?? null },
  }
}

export function parseAssemblyTranscript(res: any, job: Record<string, unknown>): TranscriptResult {
  const diarize = Boolean(job.diarize)
  const wantWords = Boolean(job.word_timestamps)
  const speaker = (v: unknown) => (diarize && v !== undefined && v !== null && v !== '' ? String(v) : undefined)
  const word = (w: any): TranscriptWord => ({
    text: String(w?.text ?? ''), start: ms(w?.start), end: ms(w?.end),
    ...(num(w?.confidence) !== undefined ? { confidence: Number(w.confidence) } : {}),
    ...(speaker(w?.speaker) ? { speaker: speaker(w.speaker) } : {}),
  })
  const words: TranscriptWord[] = (Array.isArray(res?.words) ? res.words : []).map(word).filter((w: TranscriptWord) => w.text)
  let segments: TranscriptSegment[] = []
  if (Array.isArray(res?.utterances) && res.utterances.length) {
    segments = res.utterances.map((u: any, i: number) => ({
      id: i, start: ms(u?.start), end: ms(u?.end), text: String(u?.text ?? '').trim(),
      ...(speaker(u?.speaker) ? { speaker: speaker(u.speaker) } : {}),
      ...(num(u?.confidence) !== undefined ? { confidence: Number(u.confidence) } : {}),
      ...(wantWords && Array.isArray(u?.words) ? { words: u.words.map(word) } : {}),
    }))
  } else if (words.length) {
    // No utterances (no diarisation): sentences from the words, split at . ? ! or 12 s.
    let current: TranscriptWord[] = []
    const flush = () => {
      if (!current.length) return
      segments.push({ id: segments.length, start: current[0].start, end: current[current.length - 1].end, text: current.map((w) => w.text).join(' '), ...(wantWords ? { words: current } : {}) })
      current = []
    }
    for (const w of words) {
      current.push(w)
      if (/[.?!]$/.test(w.text) || w.end - current[0].start >= 12) flush()
    }
    flush()
  }
  const text = String(res?.text ?? '').trim()
  if (!segments.length && text) segments = [{ id: 0, start: 0, end: num(res?.audio_duration) ?? 0, text }]
  const duration = num(res?.audio_duration) ?? num(job.duration)
  const model = String(res?.speech_model_used ?? res?.speech_model ?? '') || undefined
  const minutes = minutesOf(duration)
  return {
    text: text || segments.map((s) => s.text).join(' '),
    ...(res?.language_code ? { language: String(res.language_code) } : job.language ? { language: String(job.language) } : {}),
    ...(duration !== undefined ? { duration } : {}),
    segments,
    ...(wantWords && words.length ? { words } : {}),
    ...(speakersOf(segments) ? { speakers: speakersOf(segments) } : {}),
    provider: 'assemblyai',
    ...(model ? { model } : {}),
    ...(minutes !== undefined ? { usage: { unit: 'minute', quantity: minutes, ...(model ? { model } : {}), operation: 'transcribe' } } : {}),
  }
}

async function poll(job: MediaAsyncJob, ctx: MediaProviderContext): Promise<PollResult<TranscriptResult>> {
  const id = String(job.job.transcript_id ?? '')
  if (!id) throw new MediaProviderError(`${LABEL}: the job has no transcript id`)
  const res = await mediaJson<any>(ctx, LABEL, joinUrl(base(ctx), `/v2/transcript/${encodeURIComponent(id)}`), { method: 'GET', headers: auth(ctx) })
  const status = String(res?.status ?? '')
  if (status === 'completed') return { done: true, result: parseAssemblyTranscript(res, job.job) }
  if (status === 'error') throw new MediaProviderError(`${LABEL} transcription failed: ${String(res?.error ?? 'unknown error').slice(0, 300)}`)
  return { done: false, pollAfterMs: POLL_MS }
}

async function cleanup(job: MediaAsyncJob, ctx: MediaProviderContext): Promise<void> {
  const id = String(job.job.transcript_id ?? '')
  if (!id) return
  try {
    await mediaRequest(ctx, LABEL, joinUrl(base(ctx), `/v2/transcript/${encodeURIComponent(id)}`), { method: 'DELETE', headers: auth(ctx) }, { okStatuses: [404], noRetry: true })
  } catch (error: any) {
    ctx.log?.(`${LABEL}: could not delete transcript ${id}: ${String(error?.message ?? error).slice(0, 200)}`)
  }
}

export const assemblyaiProvider: MediaProvider = {
  id: 'assemblyai',
  label: INFO.label,
  capabilities: INFO.capabilities,
  transcribe,
  poll,
  cleanup,
}
