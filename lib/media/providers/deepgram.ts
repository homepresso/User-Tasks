/**
 * Deepgram media provider (server-only): pre-recorded transcription and
 * Aura text to speech.
 *
 * API docs (shapes checked 2026-10-30):
 *   https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded
 *   https://developers.deepgram.com/docs/pre-recorded-audio
 *   https://developers.deepgram.com/reference/text-to-speech/speak-request
 *
 * Notes: `diarize=true` is documented as deprecated in favour of
 * `diarize_model`, but still accepted; we send diarize=true. Keyterms
 * (`keyterm`, repeated) work on Nova-3 only. TTS accepts at most 2,000
 * characters per request (longer text → 413; the caller splits).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */

import { MediaProviderError, type MediaBlob, type MediaProvider, type MediaProviderContext, type SpeechOptions, type SpeechResult, type TranscribeOptions, type TranscriptResult, type TranscriptSegment, type TranscriptWord } from '../types'
import { MEDIA_PROVIDER_BY_ID } from '../catalog'
import { SPEECH_MIME, bytesBody, joinUrl, mediaBytes, mediaJson, minutesOf, modelFor, num, requireKey, speakersOf } from './shared'

const INFO = MEDIA_PROVIDER_BY_ID.deepgram
const LABEL = 'Deepgram'
export const DEEPGRAM_TTS_MAX_CHARS = 2000

function apiBase(ctx: MediaProviderContext): string {
  const base = String(ctx.credentials.baseUrl || 'https://api.deepgram.com').replace(/\/+$/, '')
  return /\/v1$/.test(base) ? base : `${base}/v1`
}

const auth = (ctx: MediaProviderContext) => ({ Authorization: `Token ${requireKey(ctx.credentials, LABEL)}` })

/** Keyterms from a vocabulary hint (comma / newline separated). */
function keyterms(prompt: string | undefined): string[] {
  return String(prompt ?? '').split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean).slice(0, 100)
}

export function deepgramListenUrl(ctx: MediaProviderContext, options: TranscribeOptions, model: string): string {
  const q = new URLSearchParams()
  q.set('model', model)
  q.set('smart_format', 'true')
  q.set('punctuate', 'true')
  q.set('utterances', 'true')
  if (options.diarize) q.set('diarize', 'true')
  if (options.language) q.set('language', options.language)
  else q.set('detect_language', 'true')
  if (model.startsWith('nova-3')) for (const term of keyterms(options.prompt)) q.append('keyterm', term)
  return `${joinUrl(apiBase(ctx), '/listen')}?${q.toString()}`
}

async function transcribe(input: MediaBlob, options: TranscribeOptions, ctx: MediaProviderContext): Promise<TranscriptResult> {
  const model = modelFor(options.model, ctx.credentials, 'transcribe_model', INFO.defaults.transcribe ?? 'nova-3')
  const res = await mediaJson<any>(ctx, LABEL, deepgramListenUrl(ctx, options, model), {
    method: 'POST',
    headers: { ...auth(ctx), 'Content-Type': input.mime_type || 'application/octet-stream' },
    body: bytesBody(input.bytes),
  })
  return parseDeepgramTranscript(res, model, options, input.duration)
}

const speakerLabel = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : `speaker_${v}`)

export function parseDeepgramTranscript(res: any, model: string, options: TranscribeOptions, knownDuration?: number): TranscriptResult {
  const channel = res?.results?.channels?.[0] ?? {}
  const alt = channel?.alternatives?.[0] ?? {}
  const duration = num(res?.metadata?.duration) ?? knownDuration
  const words: TranscriptWord[] = (Array.isArray(alt.words) ? alt.words : []).map((w: any) => {
    const word: TranscriptWord = { text: String(w?.punctuated_word ?? w?.word ?? ''), start: Number(w?.start) || 0, end: Number(w?.end) || 0 }
    if (num(w?.confidence) !== undefined) word.confidence = Number(w.confidence)
    const speaker = options.diarize ? speakerLabel(w?.speaker) : undefined
    if (speaker) word.speaker = speaker
    return word
  }).filter((w: TranscriptWord) => w.text)
  let segments: TranscriptSegment[] = (Array.isArray(res?.results?.utterances) ? res.results.utterances : []).map((u: any, i: number) => {
    const seg: TranscriptSegment = { id: i, start: Number(u?.start) || 0, end: Number(u?.end) || 0, text: String(u?.transcript ?? '').trim() }
    const speaker = options.diarize ? speakerLabel(u?.speaker) : undefined
    if (speaker) seg.speaker = speaker
    if (num(u?.confidence) !== undefined) seg.confidence = Number(u.confidence)
    if (options.wordTimestamps && Array.isArray(u?.words)) {
      seg.words = u.words.map((w: any) => ({ text: String(w?.punctuated_word ?? w?.word ?? ''), start: Number(w?.start) || 0, end: Number(w?.end) || 0, ...(num(w?.confidence) !== undefined ? { confidence: Number(w.confidence) } : {}), ...(seg.speaker ? { speaker: seg.speaker } : {}) }))
    }
    return seg
  }).filter((s: TranscriptSegment) => s.text)
  const text = String(alt.transcript ?? '').trim()
  if (!segments.length && text) segments = [{ id: 0, start: words[0]?.start ?? 0, end: words[words.length - 1]?.end ?? duration ?? 0, text }]
  const minutes = minutesOf(duration)
  return {
    text: text || segments.map((s) => s.text).join(' '),
    ...((options.language || channel.detected_language) ? { language: String(options.language || channel.detected_language) } : {}),
    ...(duration !== undefined ? { duration } : {}),
    segments,
    ...(options.wordTimestamps && words.length ? { words } : {}),
    ...(speakersOf(segments) ? { speakers: speakersOf(segments) } : {}),
    provider: 'deepgram',
    model,
    ...(minutes !== undefined ? { usage: { unit: 'minute', quantity: minutes, model: options.language === 'multi' ? `${model}:multi` : model, operation: 'transcribe' } } : {}),
  }
}

/** Our format → Deepgram encoding / container. */
export function deepgramEncoding(format: SpeechOptions['format']): { encoding: string; container?: string; mime: string } {
  switch (format) {
    case 'wav': return { encoding: 'linear16', container: 'wav', mime: 'audio/wav' }
    case 'opus': return { encoding: 'opus', container: 'ogg', mime: 'audio/ogg' }
    case 'aac': return { encoding: 'aac', mime: 'audio/aac' }
    case 'flac': return { encoding: 'flac', mime: 'audio/flac' }
    case 'pcm': return { encoding: 'linear16', container: 'none', mime: SPEECH_MIME.pcm }
    default: return { encoding: 'mp3', mime: 'audio/mpeg' }
  }
}

async function speak(options: SpeechOptions, ctx: MediaProviderContext): Promise<SpeechResult> {
  if (options.text.length > DEEPGRAM_TTS_MAX_CHARS) throw new MediaProviderError(`Deepgram speaks at most ${DEEPGRAM_TTS_MAX_CHARS} characters per request (got ${options.text.length})`, 413)
  // Aura voices are models ("aura-2-thalia-en"); a voice overrides the model.
  const model = options.voice || modelFor(options.model, ctx.credentials, 'tts_model', INFO.defaults.tts ?? 'aura-2-thalia-en')
  const format = options.format ?? 'mp3'
  const enc = deepgramEncoding(format)
  const q = new URLSearchParams({ model, encoding: enc.encoding })
  if (enc.container) q.set('container', enc.container)
  if (options.speed !== undefined) q.set('speed', String(options.speed))
  const { bytes } = await mediaBytes(ctx, LABEL, `${joinUrl(apiBase(ctx), '/speak')}?${q.toString()}`, {
    method: 'POST',
    headers: { ...auth(ctx), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: options.text }),
  })
  return { bytes, mime_type: enc.mime, format, provider: 'deepgram', model, voice: model, usage: { unit: 'char', quantity: options.text.length, model, operation: 'tts' } }
}

export const deepgramProvider: MediaProvider = {
  id: 'deepgram',
  label: INFO.label,
  capabilities: INFO.capabilities,
  maxTranscribeBytes: 2 * 1024 * 1024 * 1024,
  transcribe,
  speak,
}
