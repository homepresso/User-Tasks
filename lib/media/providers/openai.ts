/**
 * OpenAI media provider (server-only): transcription, image understanding
 * (Chat Completions vision with a JSON schema), image moderation, image
 * generation / editing and text to speech.
 *
 * API docs (shapes checked 2026-10-30):
 *   https://platform.openai.com/docs/api-reference/audio/createTranscription
 *   https://platform.openai.com/docs/guides/speech-to-text
 *   https://platform.openai.com/docs/api-reference/audio/createSpeech
 *   https://platform.openai.com/docs/api-reference/images
 *   https://platform.openai.com/docs/api-reference/moderations
 *   https://platform.openai.com/docs/guides/structured-outputs
 *
 * Transcription model choice (the step's default output is SRT, which needs
 * timed segments):
 *   - default whisper-1 with response_format verbose_json and
 *     timestamp_granularities[]=segment (+ word when word timings are asked):
 *     the only OpenAI model that returns segment / word timings;
 *   - diarize (speaker labels) without an explicit model →
 *     gpt-4o-transcribe-diarize with response_format diarized_json and
 *     chunking_strategy auto (segments with speaker, start, end; no prompt);
 *   - an explicit gpt-4o-transcribe / gpt-4o-mini-transcribe → plain json:
 *     one untimed segment (0 → duration) — fine for text, poor for subtitles.
 *
 * OpenAI returns no reliable face / text boxes, so this provider does not
 * claim detect_faces / ocr / detect_objects (redaction needs a provider with
 * boxes). Video is analysed from sampled frames (analyzeFrames).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */

import {
  MediaProviderError,
  type AnalyzeImageOptions, type AnalyzeVideoOptions, type AnswerField, type EditImageOptions, type GenerateImageOptions, type GenerateImageResult,
  type ImageAnalysis, type MediaBlob, type MediaProvider, type MediaProviderContext, type MediaUsage, type SafetyCategory, type SpeechOptions,
  type SpeechResult, type TranscribeOptions, type TranscriptResult, type TranscriptSegment, type TranscriptWord, type VideoAnalysis,
} from '../types'
import { MEDIA_PROVIDER_BY_ID } from '../catalog'
import {
  SPEECH_MIME, dataUrl, fromBase64, joinUrl, mediaBytes, mediaJson, minutesOf, modelFor, multipart, num, parseModelJson, requireKey, round, speakersOf,
} from './shared'

const INFO = MEDIA_PROVIDER_BY_ID.openai
const LABEL = 'OpenAI'
export const OPENAI_DIARIZE_MODEL = 'gpt-4o-transcribe-diarize'
export const OPENAI_TIMED_MODEL = 'whisper-1'

/** https://api.openai.com/v1 (a base_url override without /v1 gets it added). */
export function openaiApiBase(baseUrl: string): string {
  const base = String(baseUrl || 'https://api.openai.com').replace(/\/+$/, '')
  return /\/v\d+$/.test(base) ? base : `${base}/v1`
}

function headers(ctx: MediaProviderContext, json = false): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${requireKey(ctx.credentials, LABEL)}` }
  if (ctx.credentials.extra?.organization) h['OpenAI-Organization'] = ctx.credentials.extra.organization
  if (ctx.credentials.extra?.project) h['OpenAI-Project'] = ctx.credentials.extra.project
  if (json) h['Content-Type'] = 'application/json'
  return h
}

const url = (ctx: MediaProviderContext, path: string) => joinUrl(openaiApiBase(ctx.credentials.baseUrl), path)

/* ── Transcription ─────────────────────────────────────────────────── */

/** The model to use for a transcription request (see the module comment). */
export function openaiTranscribeModel(options: TranscribeOptions, extraDefault?: string): string {
  if (options.model) return options.model
  if (options.diarize) return OPENAI_DIARIZE_MODEL
  return extraDefault || INFO.defaults.transcribe || OPENAI_TIMED_MODEL
}

function responseFormatFor(model: string): 'verbose_json' | 'diarized_json' | 'json' {
  if (model === 'whisper-1') return 'verbose_json'
  if (model.includes('diarize')) return 'diarized_json'
  return 'json'
}

async function transcribe(input: MediaBlob, options: TranscribeOptions, ctx: MediaProviderContext): Promise<TranscriptResult> {
  const model = openaiTranscribeModel(options, ctx.credentials.extra?.transcribe_model)
  const format = responseFormatFor(model)
  const granularities = format === 'verbose_json' ? (options.wordTimestamps ? ['segment', 'word'] : ['segment']) : undefined
  const body = multipart({
    file: input,
    model,
    response_format: format,
    language: options.language || undefined,
    // The diarize model does not accept a prompt.
    prompt: format === 'diarized_json' ? undefined : options.prompt || undefined,
    'timestamp_granularities[]': granularities,
    chunking_strategy: format === 'diarized_json' ? 'auto' : undefined,
  })
  const res = await mediaJson<any>(ctx, LABEL, url(ctx, '/audio/transcriptions'), { method: 'POST', headers: headers(ctx), body })
  return parseOpenAiTranscript(res, model, input.duration)
}

/** verbose_json / diarized_json / json → TranscriptResult. */
export function parseOpenAiTranscript(res: any, model: string, knownDuration?: number): TranscriptResult {
  const text = String(res?.text ?? '').trim()
  const duration = num(res?.duration) ?? num(res?.usage?.seconds) ?? knownDuration
  const words: TranscriptWord[] = Array.isArray(res?.words)
    ? res.words.map((w: any) => ({ text: String(w?.word ?? w?.text ?? ''), start: Number(w?.start) || 0, end: Number(w?.end) || 0 })).filter((w: TranscriptWord) => w.text)
    : []
  let segments: TranscriptSegment[] = Array.isArray(res?.segments)
    ? res.segments.map((s: any, i: number) => {
        const seg: TranscriptSegment = { id: i, start: Number(s?.start) || 0, end: Number(s?.end) || 0, text: String(s?.text ?? '').trim() }
        if (s?.speaker !== undefined && s?.speaker !== null && s?.speaker !== '') seg.speaker = String(s.speaker)
        if (typeof s?.avg_logprob === 'number') seg.confidence = round(Math.exp(s.avg_logprob))
        return seg
      }).filter((s: TranscriptSegment) => s.text)
    : []
  if (words.length && segments.length) {
    for (const seg of segments) {
      const inside = words.filter((w) => w.start >= seg.start - 0.01 && w.end <= seg.end + 0.01)
      if (inside.length) seg.words = inside
    }
  }
  if (!segments.length && text) segments = [{ id: 0, start: 0, end: duration ?? 0, text }]
  const usage: MediaUsage | undefined = minutesOf(duration) !== undefined
    ? { unit: 'minute', quantity: minutesOf(duration)!, model, operation: 'transcribe' }
    : undefined
  return {
    text: text || segments.map((s) => s.text).join(' '),
    ...(res?.language ? { language: normaliseLanguage(String(res.language)) } : {}),
    ...(duration !== undefined ? { duration } : {}),
    segments,
    ...(words.length ? { words } : {}),
    ...(speakersOf(segments) ? { speakers: speakersOf(segments) } : {}),
    provider: 'openai',
    model,
    ...(usage ? { usage } : {}),
  }
}

/** whisper-1 verbose_json reports "english"; keep codes as they are. */
const LANGUAGE_NAMES: Record<string, string> = {
  english: 'en', spanish: 'es', french: 'fr', german: 'de', italian: 'it', portuguese: 'pt', dutch: 'nl', japanese: 'ja', chinese: 'zh', korean: 'ko',
  russian: 'ru', arabic: 'ar', hindi: 'hi', polish: 'pl', swedish: 'sv', turkish: 'tr', danish: 'da', norwegian: 'no', finnish: 'fi', maori: 'mi',
}
function normaliseLanguage(value: string): string {
  const v = value.trim().toLowerCase()
  return LANGUAGE_NAMES[v] ?? value.trim()
}

/* ── Vision ────────────────────────────────────────────────────────── */

function fieldSchema(field: AnswerField): Record<string, unknown> {
  const description = field.description ? { description: field.description } : {}
  switch (field.type) {
    case 'number': return { type: 'number', ...description }
    case 'boolean': return { type: 'boolean', ...description }
    case 'array': return { type: 'array', items: { type: 'string' }, ...description }
    case 'object': return { type: 'string', description: `${field.description ? `${field.description} — ` : ''}a JSON object as text` }
    default: return { type: 'string', ...description }
  }
}

/** The `answer` schema: an object of the fields, or a string. */
export function answerSchema(fields: AnswerField[] | undefined): Record<string, unknown> {
  if (!fields?.length) return { type: 'string', description: 'The answer to the question / instruction' }
  const properties: Record<string, unknown> = {}
  for (const f of fields) properties[f.name] = fieldSchema(f)
  return { type: 'object', properties, required: fields.map((f) => f.name), additionalProperties: false }
}

/** Parse "object" fields that the strict schema carried as JSON text. */
function reviveAnswer(answer: unknown, fields: AnswerField[] | undefined): unknown {
  if (!fields?.length || !answer || typeof answer !== 'object') return answer
  const out: Record<string, unknown> = { ...(answer as Record<string, unknown>) }
  for (const f of fields) {
    if (f.type === 'object' && typeof out[f.name] === 'string') {
      try { out[f.name] = JSON.parse(out[f.name] as string) } catch { /* keep text */ }
    }
  }
  return out
}

const LABEL_ITEM = { type: 'object', properties: { name: { type: 'string' }, confidence: { type: 'number', description: '0–1' } }, required: ['name', 'confidence'], additionalProperties: false }

function imageSchema(options: AnalyzeImageOptions): { schema: Record<string, unknown>; instructions: string[] } {
  const properties: Record<string, unknown> = {}
  const instructions: string[] = []
  const max = Math.max(1, Math.min(100, options.maxResults ?? 20))
  if (options.features.includes('description')) { properties.description = { type: 'string', description: 'One paragraph describing the image' }; instructions.push('Describe the image in one paragraph.') }
  if (options.features.includes('labels')) { properties.labels = { type: 'array', items: LABEL_ITEM, description: `Up to ${max} labels` }; instructions.push(`List up to ${max} short labels (objects, scene, concepts) with a 0–1 confidence.`) }
  if (options.features.includes('text')) { properties.text = { type: 'string', description: 'All visible text in reading order, lines separated by \\n' }; instructions.push('Transcribe all visible text in reading order, one line per line of text ("" when there is none).') }
  if (options.prompt) { properties.answer = answerSchema(options.fields); instructions.push(`Answer this: ${options.prompt}`) }
  if (!Object.keys(properties).length) properties.description = { type: 'string' }
  return { schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }, instructions }
}

function tokenUsage(res: any, model: string, operation: MediaUsage['operation']): MediaUsage | undefined {
  const u = res?.usage
  if (!u) return undefined
  const input = Number(u.prompt_tokens ?? u.input_tokens) || 0
  const output = Number(u.completion_tokens ?? u.output_tokens) || 0
  return { unit: 'token', quantity: input + output, input_tokens: input, output_tokens: output, model, operation }
}

async function chatJson(ctx: MediaProviderContext, model: string, content: unknown[], schemaName: string, schema: Record<string, unknown>, system: string): Promise<{ data: any; res: any }> {
  const body = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content }],
    response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
  }
  const res = await mediaJson<any>(ctx, LABEL, url(ctx, '/chat/completions'), { method: 'POST', headers: headers(ctx, true), body: JSON.stringify(body) })
  const choice = res?.choices?.[0]?.message
  if (choice?.refusal) throw new MediaProviderError(`${LABEL} declined: ${String(choice.refusal).slice(0, 300)}`)
  return { data: parseModelJson(String(choice?.content ?? '')), res }
}

function labelsOf(value: unknown, max: number) {
  if (!Array.isArray(value)) return []
  return value.slice(0, max).map((l: any) => ({ name: String(l?.name ?? l ?? '').trim(), ...(num(l?.confidence) !== undefined ? { confidence: Math.max(0, Math.min(1, Number(l.confidence))) } : {}) })).filter((l) => l.name)
}

async function moderate(input: MediaBlob, ctx: MediaProviderContext): Promise<SafetyCategory[]> {
  const res = await mediaJson<any>(ctx, LABEL, url(ctx, '/moderations'), {
    method: 'POST',
    headers: headers(ctx, true),
    body: JSON.stringify({ model: 'omni-moderation-latest', input: [{ type: 'image_url', image_url: { url: dataUrl(input) } }] }),
  })
  return parseModeration(res)
}

export function parseModeration(res: any): SafetyCategory[] {
  const result = res?.results?.[0]
  if (!result) return []
  const categories = result.categories ?? {}
  const scores = result.category_scores ?? {}
  return Object.keys(categories).map((category) => ({
    category,
    flagged: Boolean(categories[category]),
    ...(num(scores[category]) !== undefined ? { score: round(Number(scores[category]), 6) } : {}),
  }))
}

async function analyzeImage(input: MediaBlob, options: AnalyzeImageOptions, ctx: MediaProviderContext): Promise<ImageAnalysis> {
  const model = modelFor(options.model, ctx.credentials, 'vision_model', INFO.defaults.vision ?? 'gpt-4.1-mini')
  const max = Math.max(1, Math.min(100, options.maxResults ?? 20))
  const out: ImageAnalysis = { labels: [], objects: [], text: '', ocr: [], faces: [], safety: [], provider: 'openai', model }
  const wantsModel = options.features.some((f) => f === 'description' || f === 'labels' || f === 'text') || Boolean(options.prompt)
  if (wantsModel) {
    const { schema, instructions } = imageSchema(options)
    const language = options.language ? ` Write in language "${options.language}".` : ''
    const { data, res } = await chatJson(ctx, model, [
      { type: 'text', text: instructions.join('\n') },
      { type: 'image_url', image_url: { url: dataUrl(input) } },
    ], 'image_analysis', schema, `You analyse images and reply with JSON matching the schema.${language}`)
    if (typeof data.description === 'string') out.description = data.description.trim()
    out.labels = labelsOf(data.labels, max)
    if (typeof data.text === 'string') {
      out.text = data.text.trim()
      // Lines without boxes (OpenAI gives no positions).
      out.ocr = out.text ? out.text.split('\n').map((line: string) => line.trim()).filter(Boolean).map((text: string) => ({ text })) : []
    }
    if (options.prompt) out.answer = reviveAnswer(data.answer, options.fields)
    out.usage = tokenUsage(res, model, 'analyze_image')
  }
  if (options.features.includes('safety')) out.safety = await moderate(input, ctx)
  return out
}

/* ── Frames (video) ────────────────────────────────────────────────── */

function videoSchema(options: AnalyzeVideoOptions): { schema: Record<string, unknown>; instructions: string[] } {
  const properties: Record<string, unknown> = {}
  const instructions: string[] = []
  const f = options.features
  if (f.includes('summary')) { properties.summary = { type: 'string' }; instructions.push('Summarise the video in one paragraph.') }
  if (f.includes('scenes')) {
    properties.scenes = { type: 'array', items: { type: 'object', properties: { start: { type: 'number', description: 'seconds' }, end: { type: 'number', description: 'seconds' }, title: { type: 'string' }, description: { type: 'string' } }, required: ['start', 'end', 'title', 'description'], additionalProperties: false } }
    instructions.push('Split the video into scenes (start / end in seconds, using the frame times), each with a short title and description.')
  }
  if (f.includes('labels')) {
    properties.labels = { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, confidence: { type: 'number' }, times: { type: 'array', items: { type: 'number' } } }, required: ['name', 'confidence', 'times'], additionalProperties: false } }
    instructions.push('List labels (objects, settings, activities) with a 0–1 confidence and the frame times they appear at.')
  }
  if (f.includes('text')) {
    properties.text = { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' } }, required: ['text', 'start', 'end'], additionalProperties: false } }
    instructions.push('List on-screen text with when it is visible (seconds).')
  }
  if (options.prompt) { properties.answer = answerSchema(options.fields); instructions.push(`Answer this: ${options.prompt}`) }
  if (!Object.keys(properties).length) properties.summary = { type: 'string' }
  return { schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }, instructions }
}

/** Model JSON → VideoAnalysis (shared by OpenAI frames and Gemini). */
export function parseVideoJson(data: any, options: AnalyzeVideoOptions, toSeconds: (v: unknown) => number | undefined): Omit<VideoAnalysis, 'provider'> {
  const scenes = Array.isArray(data?.scenes) ? data.scenes.map((s: any) => ({
    start: toSeconds(s?.start) ?? 0, end: toSeconds(s?.end) ?? toSeconds(s?.start) ?? 0,
    ...(s?.title ? { title: String(s.title) } : {}), description: String(s?.description ?? s?.title ?? '').trim(),
  })) : []
  const labels = Array.isArray(data?.labels) ? data.labels.map((l: any) => ({
    name: String(l?.name ?? l ?? '').trim(),
    ...(num(l?.confidence) !== undefined ? { confidence: Math.max(0, Math.min(1, Number(l.confidence))) } : {}),
    ...(Array.isArray(l?.times) ? { times: l.times.map(toSeconds).filter((t: number | undefined): t is number => t !== undefined) } : {}),
  })).filter((l: { name: string }) => l.name) : []
  const text = Array.isArray(data?.text) ? data.text.map((t: any) => ({
    text: String(t?.text ?? t ?? '').trim(),
    ...(toSeconds(t?.start) !== undefined ? { start: toSeconds(t.start) } : {}),
    ...(toSeconds(t?.end) !== undefined ? { end: toSeconds(t.end) } : {}),
  })).filter((t: { text: string }) => t.text) : []
  return {
    ...(typeof data?.summary === 'string' ? { summary: data.summary.trim() } : {}),
    scenes, labels, text,
    ...(options.prompt ? { answer: reviveAnswer(data?.answer, options.fields) } : {}),
  }
}

async function analyzeFrames(frames: Array<MediaBlob & { time: number }>, options: AnalyzeVideoOptions, ctx: MediaProviderContext): Promise<VideoAnalysis> {
  if (!frames.length) throw new MediaProviderError('No frames to analyse')
  const model = modelFor(options.model, ctx.credentials, 'video_model', INFO.defaults.video ?? 'gpt-4.1-mini')
  const { schema, instructions } = videoSchema(options)
  const detail = frames.length > 8 ? 'low' : 'auto'
  const content: unknown[] = [{ type: 'text', text: `These are ${frames.length} frames sampled from one video, in order, each preceded by its time in seconds.\n${instructions.join('\n')}` }]
  for (const frame of frames) {
    content.push({ type: 'text', text: `Frame at ${round(frame.time, 2)} s` })
    content.push({ type: 'image_url', image_url: { url: dataUrl(frame), detail } })
  }
  const language = options.language ? ` Write in language "${options.language}".` : ''
  const { data, res } = await chatJson(ctx, model, content, 'video_analysis', schema, `You analyse videos from sampled frames and reply with JSON matching the schema.${language}`)
  const parsed = parseVideoJson(data, options, (v) => num(v))
  const last = frames[frames.length - 1].time
  return { ...parsed, duration: last, provider: 'openai', model, usage: tokenUsage(res, model, 'analyze_video') }
}

/* ── Images ────────────────────────────────────────────────────────── */

/** usage.model for per-image prices: "gpt-image-1/medium/1024x1024" (quality / size known), else the model. */
export function imagePriceModel(model: string, quality?: string, size?: string): string {
  const q = String(quality ?? '').toLowerCase()
  const s = String(size ?? '').toLowerCase()
  return q && q !== 'auto' && /^\d+x\d+$/.test(s) ? `${model}/${q}/${s}` : model
}

function imagesFrom(res: any, format: string): GenerateImageResult['images'] {
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png'
  const data = Array.isArray(res?.data) ? res.data : []
  const images = data.filter((d: any) => typeof d?.b64_json === 'string').map((d: any) => ({
    bytes: fromBase64(d.b64_json), mime_type: mime, ...(d.revised_prompt ? { revised_prompt: String(d.revised_prompt) } : {}),
  }))
  if (!images.length) throw new MediaProviderError(`${LABEL} returned no image`)
  return images
}

function imageParams(options: GenerateImageOptions, model: string) {
  const count = Math.max(1, Math.min(4, Math.floor(options.count ?? 1)))
  const size = options.size && /^(\d+x\d+|auto)$/.test(options.size) ? options.size : undefined
  const isDalle = model.startsWith('dall-e')
  return { count, size, isDalle, format: options.format ?? 'png' }
}

async function generateImage(options: GenerateImageOptions, ctx: MediaProviderContext): Promise<GenerateImageResult> {
  const model = modelFor(options.model, ctx.credentials, 'image_model', INFO.defaults.image ?? 'gpt-image-1')
  const { count, size, isDalle, format } = imageParams(options, model)
  const body: Record<string, unknown> = { model, prompt: options.prompt, n: count }
  if (size) body.size = size
  if (options.quality) body.quality = options.quality
  if (isDalle) body.response_format = 'b64_json'
  else body.output_format = format
  const res = await mediaJson<any>(ctx, LABEL, url(ctx, '/images/generations'), { method: 'POST', headers: headers(ctx, true), body: JSON.stringify(body) })
  const images = imagesFrom(res, isDalle ? 'png' : format)
  return { images, provider: 'openai', model, usage: { unit: 'image', quantity: images.length, model: imagePriceModel(model, options.quality, size), operation: 'generate_image' } }
}

async function editImage(options: EditImageOptions, ctx: MediaProviderContext): Promise<GenerateImageResult> {
  const model = modelFor(options.model, ctx.credentials, 'image_model', INFO.defaults.image ?? 'gpt-image-1')
  const { count, size, isDalle, format } = imageParams(options, model)
  const body = multipart({
    model,
    prompt: options.prompt,
    image: options.image,
    mask: options.mask,
    n: count,
    size,
    quality: options.quality,
    output_format: isDalle ? undefined : format,
    response_format: isDalle ? 'b64_json' : undefined,
  })
  const res = await mediaJson<any>(ctx, LABEL, url(ctx, '/images/edits'), { method: 'POST', headers: headers(ctx), body })
  const images = imagesFrom(res, isDalle ? 'png' : format)
  return { images, provider: 'openai', model, usage: { unit: 'image', quantity: images.length, model: imagePriceModel(model, options.quality, size), operation: 'edit_image' } }
}

/* ── Speech ────────────────────────────────────────────────────────── */

async function speak(options: SpeechOptions, ctx: MediaProviderContext): Promise<SpeechResult> {
  const model = modelFor(options.model, ctx.credentials, 'tts_model', INFO.defaults.tts ?? 'gpt-4o-mini-tts')
  const voice = options.voice || ctx.credentials.extra?.voice || 'alloy'
  const format = options.format ?? 'mp3'
  const body: Record<string, unknown> = { model, input: options.text, voice, response_format: format }
  if (options.speed !== undefined) body.speed = Math.max(0.25, Math.min(4, options.speed))
  if (options.instructions && !/^tts-1/.test(model)) body.instructions = options.instructions
  const { bytes, contentType } = await mediaBytes(ctx, LABEL, url(ctx, '/audio/speech'), { method: 'POST', headers: headers(ctx, true), body: JSON.stringify(body) })
  return {
    bytes, mime_type: SPEECH_MIME[format] ?? (contentType || 'application/octet-stream'), format, provider: 'openai', model, voice,
    usage: { unit: 'char', quantity: options.text.length, model, operation: 'tts' },
  }
}

export const openaiProvider: MediaProvider = {
  id: 'openai',
  label: INFO.label,
  capabilities: INFO.capabilities,
  maxTranscribeBytes: 25 * 1024 * 1024,
  maxImageBytes: 20 * 1024 * 1024,
  transcribe,
  analyzeImage,
  analyzeFrames,
  generateImage,
  editImage,
  speak,
}
