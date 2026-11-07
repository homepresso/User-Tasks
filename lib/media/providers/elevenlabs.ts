/**
 * ElevenLabs media provider (server-only): Scribe speech to text and text
 * to speech.
 *
 * API docs (shapes checked 2026-10-30):
 *   https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 *   https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 *   https://elevenlabs.io/docs/api-reference/voices/search
 *   https://elevenlabs.io/docs/overview/models
 *
 * scribe_v2 is current (scribe_v1 is deprecated). Words come back with
 * type word | spacing | audio_event and speaker_id; we group them into
 * segments at speaker changes, sentence ends and pauses. TTS needs a voice
 * id: the step's voice, else the integration's, else the first of the
 * account's default voices (GET /v2/voices?voice_type=default) — legacy
 * default voices are being retired, so we don't hard-code one.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */

import { MediaProviderError, type MediaBlob, type MediaProvider, type MediaProviderContext, type SpeechOptions, type SpeechResult, type TranscribeOptions, type TranscriptResult, type TranscriptSegment, type TranscriptWord } from '../types'
import { MEDIA_PROVIDER_BY_ID } from '../catalog'
import { joinUrl, mediaBytes, mediaJson, minutesOf, modelFor, multipart, num, requireKey, round, speakersOf } from './shared'

const INFO = MEDIA_PROVIDER_BY_ID.elevenlabs
const LABEL = 'ElevenLabs'
const PAUSE_SPLIT_S = 1.0
const MAX_SEGMENT_S = 15

const base = (ctx: MediaProviderContext) => String(ctx.credentials.baseUrl || 'https://api.elevenlabs.io').replace(/\/+$/, '').replace(/\/v1$/, '')
const keyHeader = (ctx: MediaProviderContext) => ({ 'xi-api-key': requireKey(ctx.credentials, LABEL) })

async function transcribe(input: MediaBlob, options: TranscribeOptions, ctx: MediaProviderContext): Promise<TranscriptResult> {
  const model = modelFor(options.model, ctx.credentials, 'transcribe_model', INFO.defaults.transcribe ?? 'scribe_v2')
  const body = multipart({
    model_id: model,
    file: input,
    language_code: options.language || undefined,
    diarize: options.diarize ? 'true' : 'false',
    num_speakers: options.diarize && options.maxSpeakers ? Math.min(32, Math.max(1, Math.floor(options.maxSpeakers))) : undefined,
    timestamps_granularity: 'word',
    tag_audio_events: 'false',
  })
  const res = await mediaJson<any>(ctx, LABEL, joinUrl(base(ctx), '/v1/speech-to-text'), { method: 'POST', headers: keyHeader(ctx), body })
  return parseElevenTranscript(res, model, options, input.duration)
}

export function parseElevenTranscript(res: any, model: string, options: TranscribeOptions, knownDuration?: number): TranscriptResult {
  const raw = Array.isArray(res?.words) ? res.words : []
  const words: TranscriptWord[] = raw.filter((w: any) => (w?.type ?? 'word') === 'word').map((w: any) => {
    const word: TranscriptWord = { text: String(w?.text ?? '').trim(), start: Number(w?.start) || 0, end: Number(w?.end) || 0 }
    if (num(w?.logprob) !== undefined) word.confidence = round(Math.exp(Number(w.logprob)))
    if (options.diarize && w?.speaker_id) word.speaker = String(w.speaker_id)
    return word
  }).filter((w: TranscriptWord) => w.text)
  const segments: TranscriptSegment[] = []
  let current: TranscriptWord[] = []
  const flush = () => {
    if (!current.length) return
    segments.push({ id: segments.length, start: current[0].start, end: current[current.length - 1].end, text: current.map((w) => w.text).join(' ').replace(/\s+([,.;:!?])/g, '$1'), ...(current[0].speaker ? { speaker: current[0].speaker } : {}), ...(options.wordTimestamps ? { words: current } : {}) })
    current = []
  }
  for (const w of words) {
    const prev = current[current.length - 1]
    if (prev && (w.speaker !== prev.speaker || w.start - prev.end > PAUSE_SPLIT_S || w.end - current[0].start > MAX_SEGMENT_S)) flush()
    current.push(w)
    if (/[.?!]$/.test(w.text)) flush()
  }
  flush()
  const text = String(res?.text ?? '').trim() || segments.map((s) => s.text).join(' ')
  if (!segments.length && text) segments.push({ id: 0, start: 0, end: knownDuration ?? 0, text })
  const duration = knownDuration ?? (words.length ? words[words.length - 1].end : undefined)
  const minutes = minutesOf(duration)
  return {
    text,
    ...(res?.language_code || options.language ? { language: String(options.language || res.language_code) } : {}),
    ...(duration !== undefined ? { duration } : {}),
    segments,
    ...(options.wordTimestamps && words.length ? { words } : {}),
    ...(speakersOf(segments) ? { speakers: speakersOf(segments) } : {}),
    provider: 'elevenlabs',
    model,
    ...(minutes !== undefined ? { usage: { unit: 'minute', quantity: minutes, model, operation: 'transcribe' } } : {}),
  }
}

/** Our format → ElevenLabs output_format. */
export function elevenOutputFormat(format: SpeechOptions['format']): { value: string; mime: string } {
  switch (format) {
    case 'wav': return { value: 'wav_24000', mime: 'audio/wav' }
    case 'pcm': return { value: 'pcm_24000', mime: 'audio/L16' }
    case 'opus': return { value: 'opus_48000_64', mime: 'audio/ogg' }
    case 'aac':
    case 'flac':
      throw new MediaProviderError(`${LABEL} does not offer ${format}; use mp3, wav, opus or pcm`)
    default: return { value: 'mp3_44100_128', mime: 'audio/mpeg' }
  }
}

async function defaultVoice(ctx: MediaProviderContext): Promise<string> {
  const res = await mediaJson<any>(ctx, LABEL, `${joinUrl(base(ctx), '/v2/voices')}?voice_type=default&page_size=1`, { method: 'GET', headers: keyHeader(ctx) })
  const id = res?.voices?.[0]?.voice_id
  if (!id) throw new MediaProviderError(`${LABEL}: no voice given and the account has no default voice — set a voice id`)
  return String(id)
}

async function speak(options: SpeechOptions, ctx: MediaProviderContext): Promise<SpeechResult> {
  const model = modelFor(options.model, ctx.credentials, 'tts_model', INFO.defaults.tts ?? 'eleven_multilingual_v2')
  const format = options.format ?? 'mp3'
  const out = elevenOutputFormat(format)
  const voice = options.voice || ctx.credentials.extra?.voice || await defaultVoice(ctx)
  const body: Record<string, unknown> = { text: options.text, model_id: model }
  if (options.speed !== undefined) body.voice_settings = { speed: Math.max(0.7, Math.min(1.2, options.speed)) }
  if (options.language && !/multilingual_v2/.test(model)) body.language_code = options.language
  const url = `${joinUrl(base(ctx), `/v1/text-to-speech/${encodeURIComponent(voice)}`)}?output_format=${encodeURIComponent(out.value)}`
  const { bytes } = await mediaBytes(ctx, LABEL, url, { method: 'POST', headers: { ...keyHeader(ctx), 'Content-Type': 'application/json', Accept: out.mime }, body: JSON.stringify(body) })
  return { bytes, mime_type: out.mime, format, provider: 'elevenlabs', model, voice, usage: { unit: 'char', quantity: options.text.length, model, operation: 'tts' } }
}

export const elevenlabsProvider: MediaProvider = {
  id: 'elevenlabs',
  label: INFO.label,
  capabilities: INFO.capabilities,
  maxTranscribeBytes: 1024 * 1024 * 1024,
  transcribe,
  speak,
}
