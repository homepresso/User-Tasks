/**
 * Azure AI Speech media provider (server-only): fast transcription and
 * neural text to speech.
 *
 * API docs (shapes checked 2026-10-30):
 *   https://learn.microsoft.com/en-us/azure/ai-services/speech-service/fast-transcription-create
 *   https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech
 *   https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-voice
 *
 * Fast transcription: POST {endpoint}/speechtotext/transcriptions:transcribe
 * ?api-version=2025-10-15 (the version the doc uses; phraseList needs it —
 * override with the integration's api_version), multipart `audio` +
 * `definition` (JSON). The endpoint is the resource endpoint
 * (https://<name>.cognitiveservices.azure.com) when set, else the regional
 * https://<region>.api.cognitive.microsoft.com. Audio < 5 h and < 500 MB.
 *
 * TTS: POST https://<region>.tts.speech.microsoft.com/cognitiveservices/v1
 * with SSML, X-Microsoft-OutputFormat and a User-Agent (required). Output
 * is truncated by Azure at 10 minutes.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */

import { MediaProviderError, type MediaBlob, type MediaProvider, type MediaProviderContext, type SpeechOptions, type SpeechResult, type TranscribeOptions, type TranscriptResult, type TranscriptSegment, type TranscriptWord } from '../types'
import { MEDIA_PROVIDER_BY_ID } from '../catalog'
import { joinUrl, mediaBytes, mediaJson, minutesOf, multipart, num, requireKey, round, speakersOf } from './shared'

const INFO = MEDIA_PROVIDER_BY_ID.azure_speech
const LABEL = 'Azure AI Speech'
export const AZURE_STT_API_VERSION = '2025-10-15'

function sttBase(ctx: MediaProviderContext): string {
  const c = ctx.credentials
  const base = c.endpoint || c.baseUrl || (c.region ? `https://${c.region}.api.cognitive.microsoft.com` : '')
  if (!base) throw new MediaProviderError(`${LABEL}: the integration needs a region or endpoint`)
  return base.replace(/\/+$/, '')
}

function ttsUrl(ctx: MediaProviderContext): string {
  const c = ctx.credentials
  if (c.extra?.tts_endpoint) return c.extra.tts_endpoint
  if (c.region) return `https://${c.region}.tts.speech.microsoft.com/cognitiveservices/v1`
  if (c.endpoint || c.baseUrl) return joinUrl(c.endpoint || c.baseUrl, '/tts/cognitiveservices/v1')
  throw new MediaProviderError(`${LABEL}: text to speech needs the resource region`)
}

const keyHeader = (ctx: MediaProviderContext) => ({ 'Ocp-Apim-Subscription-Key': requireKey(ctx.credentials, LABEL) })

/** "en" → [] (multilingual / language ID); "en-US" → ["en-US"]; "en-US,fr-FR" → both. */
function locales(language: string | undefined): string[] {
  return String(language ?? '').split(/[,\s]+/).map((l) => l.trim()).filter((l) => /^[a-z]{2,3}-[A-Za-z0-9]{2,8}$/.test(l))
}

export function azureDefinition(options: TranscribeOptions): Record<string, unknown> {
  const def: Record<string, unknown> = { locales: locales(options.language) }
  if (options.diarize) def.diarization = { enabled: true, maxSpeakers: Math.max(2, Math.min(35, Math.floor(options.maxSpeakers ?? 10))) }
  const phrases = String(options.prompt ?? '').split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean).slice(0, 500)
  if (phrases.length) def.phraseList = { phrases }
  def.profanityFilterMode = 'None'
  return def
}

async function transcribe(input: MediaBlob, options: TranscribeOptions, ctx: MediaProviderContext): Promise<TranscriptResult> {
  const version = ctx.credentials.extra?.api_version || AZURE_STT_API_VERSION
  const url = `${joinUrl(sttBase(ctx), '/speechtotext/transcriptions:transcribe')}?api-version=${encodeURIComponent(version)}`
  const body = multipart({ audio: input, definition: JSON.stringify(azureDefinition(options)) })
  const res = await mediaJson<any>(ctx, LABEL, url, { method: 'POST', headers: keyHeader(ctx), body })
  return parseAzureTranscript(res, options, input.duration)
}

const msToS = (v: unknown) => round((Number(v) || 0) / 1000, 3)

export function parseAzureTranscript(res: any, options: TranscribeOptions, knownDuration?: number): TranscriptResult {
  const phrases = Array.isArray(res?.phrases) ? res.phrases : []
  const words: TranscriptWord[] = []
  const segments: TranscriptSegment[] = phrases.map((p: any, i: number) => {
    const start = msToS(p?.offsetMilliseconds)
    const seg: TranscriptSegment = { id: i, start, end: round(start + msToS(p?.durationMilliseconds), 3), text: String(p?.text ?? '').trim() }
    if (options.diarize && p?.speaker !== undefined && p?.speaker !== null) seg.speaker = `Speaker ${p.speaker}`
    if (num(p?.confidence) !== undefined) seg.confidence = Number(p.confidence)
    if (Array.isArray(p?.words)) {
      const ws = p.words.map((w: any) => {
        const ws0 = msToS(w?.offsetMilliseconds)
        return { text: String(w?.text ?? ''), start: ws0, end: round(ws0 + msToS(w?.durationMilliseconds), 3), ...(seg.speaker ? { speaker: seg.speaker } : {}) }
      }).filter((w: TranscriptWord) => w.text)
      words.push(...ws)
      if (options.wordTimestamps) seg.words = ws
    }
    return seg
  }).filter((s: TranscriptSegment) => s.text)
  const combined = Array.isArray(res?.combinedPhrases) ? res.combinedPhrases.map((c: any) => String(c?.text ?? '').trim()).filter(Boolean).join('\n') : ''
  const duration = res?.durationMilliseconds !== undefined ? msToS(res.durationMilliseconds) : knownDuration
  const language = options.language || phrases.find((p: any) => p?.locale)?.locale
  const minutes = minutesOf(duration)
  return {
    text: combined || segments.map((s) => s.text).join(' '),
    ...(language ? { language: String(language) } : {}),
    ...(duration !== undefined ? { duration } : {}),
    segments,
    ...(options.wordTimestamps && words.length ? { words } : {}),
    ...(speakersOf(segments) ? { speakers: speakersOf(segments) } : {}),
    provider: 'azure_speech',
    model: 'fast-transcription',
    ...(minutes !== undefined ? { usage: { unit: 'minute', quantity: minutes, model: 'fast-transcription', operation: 'transcribe' } } : {}),
  }
}

/* ── TTS ───────────────────────────────────────────────────────────── */

const OUTPUT_FORMATS: Partial<Record<NonNullable<SpeechOptions['format']>, { header: string; mime: string }>> = {
  mp3: { header: 'audio-24khz-96kbitrate-mono-mp3', mime: 'audio/mpeg' },
  wav: { header: 'riff-24khz-16bit-mono-pcm', mime: 'audio/wav' },
  opus: { header: 'ogg-24khz-16bit-mono-opus', mime: 'audio/ogg' },
  pcm: { header: 'raw-24khz-16bit-mono-pcm', mime: 'audio/L16' },
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

export function azureSsml(options: SpeechOptions, voice: string): string {
  const lang = options.language || (voice.match(/^([a-z]{2,3}-[A-Z]{2})/)?.[1] ?? 'en-US')
  let text = xml(options.text)
  if (options.speed !== undefined && options.speed !== 1) {
    const rate = Math.max(0.5, Math.min(2, options.speed))
    text = `<prosody rate="${rate}">${text}</prosody>`
  }
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${xml(lang)}"><voice name="${xml(voice)}">${text}</voice></speak>`
}

/** usage.model for pricing: HD voices ("…:DragonHD…") are priced differently. */
export const azureVoiceTier = (voice: string) => (/dragonhd|hd(latest)?neural/i.test(voice) ? 'neural-hd' : 'neural')

async function speak(options: SpeechOptions, ctx: MediaProviderContext): Promise<SpeechResult> {
  const voice = options.voice || ctx.credentials.extra?.voice || INFO.defaults.tts || 'en-US-AvaMultilingualNeural'
  const format = options.format ?? 'mp3'
  const out = OUTPUT_FORMATS[format]
  if (!out) throw new MediaProviderError(`${LABEL} text to speech does not offer ${format}; use mp3, wav, opus or pcm`)
  const { bytes } = await mediaBytes(ctx, LABEL, ttsUrl(ctx), {
    method: 'POST',
    headers: { ...keyHeader(ctx), 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': out.header, 'User-Agent': 'usertasks-media' },
    body: azureSsml(options, voice),
  })
  return { bytes, mime_type: out.mime, format, provider: 'azure_speech', model: azureVoiceTier(voice), voice, usage: { unit: 'char', quantity: options.text.length, model: azureVoiceTier(voice), operation: 'tts' } }
}

export const azureSpeechProvider: MediaProvider = {
  id: 'azure_speech',
  label: INFO.label,
  capabilities: INFO.capabilities,
  maxTranscribeBytes: 500 * 1000 * 1000 - 1,
  transcribe,
  speak,
}
