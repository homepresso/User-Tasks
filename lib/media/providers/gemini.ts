/**
 * Google Gemini media provider (server-only): prompted transcription with
 * speakers and timestamps, image understanding with model-located boxes
 * (faces, objects incl. license plates, text lines) and native video
 * understanding.
 *
 * API docs (shapes checked 2026-10-30):
 *   https://ai.google.dev/api/generate-content
 *   https://ai.google.dev/gemini-api/docs/file-input-methods
 *   https://ai.google.dev/gemini-api/docs/files  ·  https://ai.google.dev/api/files
 *   https://ai.google.dev/gemini-api/docs/image-understanding (box_2d = [ymin, xmin, ymax, xmax] normalised 0–1000)
 *   https://ai.google.dev/gemini-api/docs/video-understanding (MM:SS timestamps)
 *   https://ai.google.dev/gemini-api/docs/audio
 *
 * Media up to INLINE_MAX_BYTES (20 MB, the limit the image / audio guides
 * state) is sent inline (inline_data); larger media goes through the Files
 * API (resumable upload). A file that is still PROCESSING after a short
 * wait becomes a MediaAsyncJob: poll() checks the file and runs the request
 * once it is ACTIVE; cleanup() deletes it (files otherwise expire after 48 h).
 * Structured output: generationConfig.responseMimeType application/json +
 * responseJsonSchema.
 *
 * Boxes are located by the model (approximate). Key: x-goog-api-key header.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */

import {
  MediaProviderError,
  type AnalyzeImageOptions, type AnalyzeVideoOptions, type FaceBox, type ImageAnalysis, type ImageLabel, type MaybeAsync, type MediaAsyncJob, type MediaBlob,
  type MediaProvider, type MediaProviderContext, type MediaUsage, type OcrLine, type PollResult, type TranscribeOptions, type TranscriptResult, type TranscriptSegment,
  type VideoAnalysis,
} from '../types'
import { MEDIA_PROVIDER_BY_ID } from '../catalog'
import { answerSchema, parseVideoJson } from './openai'
import { bytesBody, joinUrl, mediaJson, mediaRequest, minutesOf, modelFor, normBox, num, parseModelJson, parseTimestamp, requireKey, retryTiming, speakersOf, toBase64 } from './shared'

const INFO = MEDIA_PROVIDER_BY_ID.gemini
const LABEL = 'Gemini'
export const GEMINI_INLINE_MAX_BYTES = 20 * 1024 * 1024
const FILE_WAIT_MS = 2000
const FILE_WAIT_TRIES = 5
const POLL_MS = 5000

const base = (ctx: MediaProviderContext) => String(ctx.credentials.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '').replace(/\/v1(beta)?$/, '')
const keyHeader = (ctx: MediaProviderContext) => ({ 'x-goog-api-key': requireKey(ctx.credentials, LABEL) })
const modelPath = (model: string) => (model.startsWith('models/') ? model : `models/${model}`)

type Part = Record<string, unknown>

/* ── Files API ─────────────────────────────────────────────────────── */

interface GeminiFile { name: string; uri: string; mimeType: string; state: string }

function fileOf(res: any): GeminiFile {
  const f = res?.file ?? res
  return { name: String(f?.name ?? ''), uri: String(f?.uri ?? ''), mimeType: String(f?.mimeType ?? f?.mime_type ?? ''), state: String(f?.state ?? 'STATE_UNSPECIFIED') }
}

export async function uploadGeminiFile(input: MediaBlob, ctx: MediaProviderContext): Promise<GeminiFile> {
  const start = await mediaRequest(ctx, LABEL, joinUrl(base(ctx), '/upload/v1beta/files'), {
    method: 'POST',
    headers: {
      ...keyHeader(ctx),
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(input.bytes.byteLength),
      'X-Goog-Upload-Header-Content-Type': input.mime_type || 'application/octet-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: String(input.name || 'media').slice(0, 120) } }),
  })
  const uploadUrl = start.headers.get('x-goog-upload-url')
  try { await start.body?.cancel() } catch { /* ignore */ }
  if (!uploadUrl) throw new MediaProviderError(`${LABEL} file upload did not return an upload URL`)
  const res = await mediaJson<any>(ctx, LABEL, uploadUrl, {
    method: 'POST',
    headers: { 'Content-Length': String(input.bytes.byteLength), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: bytesBody(input.bytes),
  }, { noRetry: true })
  const file = fileOf(res)
  if (!file.name || !file.uri) throw new MediaProviderError(`${LABEL} file upload returned no file`)
  return file
}

async function getFile(name: string, ctx: MediaProviderContext): Promise<GeminiFile> {
  return fileOf(await mediaJson<any>(ctx, LABEL, joinUrl(base(ctx), `/v1beta/${name}`), { method: 'GET', headers: keyHeader(ctx) }))
}

async function deleteFile(name: string, ctx: MediaProviderContext): Promise<void> {
  if (!name) return
  try {
    await mediaRequest(ctx, LABEL, joinUrl(base(ctx), `/v1beta/${name}`), { method: 'DELETE', headers: keyHeader(ctx) }, { okStatuses: [404], noRetry: true })
  } catch (error: any) {
    ctx.log?.(`${LABEL}: could not delete uploaded file: ${String(error?.message ?? error).slice(0, 200)}`)
  }
}

/* ── generateContent ───────────────────────────────────────────────── */

const inlinePart = (media: Pick<MediaBlob, 'bytes' | 'mime_type'>): Part => ({ inline_data: { mime_type: media.mime_type || 'application/octet-stream', data: toBase64(media.bytes) } })
const filePart = (file: GeminiFile, mime: string): Part => ({ file_data: { mime_type: file.mimeType || mime, file_uri: file.uri } })

function usageOf(res: any, model: string, operation: MediaUsage['operation']): MediaUsage | undefined {
  const u = res?.usageMetadata
  if (!u) return undefined
  const input = Number(u.promptTokenCount) || 0
  const output = (Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0)
  return { unit: 'token', quantity: input + output, input_tokens: input, output_tokens: output, model, operation }
}

export async function generateJson(ctx: MediaProviderContext, model: string, parts: Part[], schema: Record<string, unknown>, system?: string): Promise<{ data: any; res: any }> {
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0 },
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] }
  const res = await mediaJson<any>(ctx, LABEL, joinUrl(base(ctx), `/v1beta/${modelPath(model)}:generateContent`), {
    method: 'POST', headers: { ...keyHeader(ctx), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const candidate = res?.candidates?.[0]
  if (!candidate) {
    const reason = res?.promptFeedback?.blockReason
    throw new MediaProviderError(`${LABEL} returned no answer${reason ? ` (blocked: ${reason})` : ''}`)
  }
  const text = (candidate.content?.parts ?? []).map((p: any) => (typeof p?.text === 'string' && !p.thought ? p.text : '')).join('')
  if (!text && candidate.finishReason && candidate.finishReason !== 'STOP') throw new MediaProviderError(`${LABEL} stopped without an answer (${candidate.finishReason})`)
  return { data: parseModelJson(text), res }
}

/** box_2d [ymin, xmin, ymax, xmax] in 0–1000 → normalised Box. */
export function geminiBox(value: unknown) {
  if (!Array.isArray(value) || value.length < 4) return undefined
  const [ymin, xmin, ymax, xmax] = value.map(Number)
  if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) return undefined
  return normBox(Math.min(xmin, xmax) / 1000, Math.min(ymin, ymax) / 1000, Math.abs(xmax - xmin) / 1000, Math.abs(ymax - ymin) / 1000) ?? undefined
}

const BOX_2D = { type: 'array', items: { type: 'integer' }, description: '[ymin, xmin, ymax, xmax] normalised to 0-1000' }

/* ── Media parts (inline or file) ──────────────────────────────────── */

type MediaRef = { part: Part; file?: GeminiFile; pending?: boolean }

async function mediaPart(input: MediaBlob, ctx: MediaProviderContext): Promise<MediaRef> {
  if (input.bytes.byteLength <= GEMINI_INLINE_MAX_BYTES) return { part: inlinePart(input) }
  ctx.log?.(`${LABEL}: uploading ${Math.round(input.bytes.byteLength / 1024 / 1024)} MB with the Files API`)
  let file = await uploadGeminiFile(input, ctx)
  for (let i = 0; file.state === 'PROCESSING' && i < FILE_WAIT_TRIES; i++) {
    await retryTiming.sleep(FILE_WAIT_MS, ctx.signal)
    file = await getFile(file.name, ctx)
  }
  if (file.state === 'FAILED') { await deleteFile(file.name, ctx); throw new MediaProviderError(`${LABEL} could not process the uploaded media`) }
  return { part: filePart(file, input.mime_type), file, pending: file.state === 'PROCESSING' }
}

/* ── Transcription ─────────────────────────────────────────────────── */

const TRANSCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    language: { type: 'string', description: 'ISO 639-1 code of the main language' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'string', description: 'MM:SS.s from the start' },
          end: { type: 'string', description: 'MM:SS.s from the start' },
          speaker: { type: 'string', description: 'Speaker 1, Speaker 2, …' },
          text: { type: 'string' },
        },
        required: ['start', 'end', 'text'],
      },
    },
  },
  required: ['segments'],
}

function transcriptPrompt(options: TranscribeOptions): string {
  const lines = [
    'Generate a verbatim transcript of the speech in this recording.',
    'Split it into segments of one sentence or speaker turn (at most about 15 seconds each), in order, with start and end timestamps as MM:SS.s from the start of the recording.',
  ]
  if (options.diarize) lines.push(`Identify distinct speakers and label them "Speaker 1", "Speaker 2", …${options.maxSpeakers ? ` (at most ${options.maxSpeakers} speakers)` : ''}.`)
  if (options.language) lines.push(`The speech is in language "${options.language}"; transcribe it in that language.`)
  if (options.prompt) lines.push(`Vocabulary / context: ${options.prompt}`)
  lines.push('Return only the JSON.')
  return lines.join('\n')
}

export function parseGeminiTranscript(data: any, model: string, options: TranscribeOptions, duration: number | undefined, usage?: MediaUsage): TranscriptResult {
  const segments: TranscriptSegment[] = (Array.isArray(data?.segments) ? data.segments : []).map((s: any, i: number) => {
    const start = parseTimestamp(s?.start) ?? 0
    const end = parseTimestamp(s?.end) ?? start
    const seg: TranscriptSegment = { id: i, start, end: Math.max(start, end), text: String(s?.text ?? '').trim() }
    if (options.diarize && s?.speaker) seg.speaker = String(s.speaker)
    return seg
  }).filter((s: TranscriptSegment) => s.text)
  const dur = duration ?? (segments.length ? segments[segments.length - 1].end : undefined)
  const minutes = minutesOf(dur)
  return {
    text: segments.map((s) => s.text).join(' '),
    ...(data?.language || options.language ? { language: String(options.language || data.language) } : {}),
    ...(dur !== undefined ? { duration: dur } : {}),
    segments,
    ...(speakersOf(segments) ? { speakers: speakersOf(segments) } : {}),
    provider: 'gemini',
    model,
    ...(usage ? { usage } : minutes !== undefined ? { usage: { unit: 'minute', quantity: minutes, model, operation: 'transcribe' } } : {}),
  }
}

async function runTranscribe(part: Part, options: TranscribeOptions, model: string, duration: number | undefined, ctx: MediaProviderContext): Promise<TranscriptResult> {
  const { data, res } = await generateJson(ctx, model, [{ text: transcriptPrompt(options) }, part], TRANSCRIPT_SCHEMA)
  return parseGeminiTranscript(data, model, options, duration, usageOf(res, model, 'transcribe'))
}

async function transcribe(input: MediaBlob, options: TranscribeOptions, ctx: MediaProviderContext): Promise<MaybeAsync<TranscriptResult>> {
  const model = modelFor(options.model, ctx.credentials, 'transcribe_model', INFO.defaults.transcribe ?? 'gemini-2.5-flash')
  const ref = await mediaPart(input, ctx)
  if (ref.pending && ref.file) return asyncJob('transcribe', ref.file, input, model, options)
  try {
    return await runTranscribe(ref.part, options, model, input.duration, ctx)
  } finally {
    if (ref.file) await deleteFile(ref.file.name, ctx)
  }
}

/* ── Images ────────────────────────────────────────────────────────── */

function imageRequest(options: AnalyzeImageOptions): { schema: Record<string, unknown>; prompt: string } {
  const f = new Set(options.features)
  const max = Math.max(1, Math.min(100, options.maxResults ?? 20))
  const properties: Record<string, unknown> = {}
  const lines: string[] = ['Analyse this image.']
  if (f.has('description')) { properties.description = { type: 'string' }; lines.push('description: one paragraph describing the image.') }
  if (f.has('labels')) { properties.labels = { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, confidence: { type: 'number' } }, required: ['name'] } }; lines.push(`labels: up to ${max} short labels with a 0-1 confidence.`) }
  if (f.has('objects')) {
    properties.objects = { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, box_2d: BOX_2D, confidence: { type: 'number' } }, required: ['label', 'box_2d'] } }
    lines.push(`objects: up to ${max} prominent objects, each with a label and box_2d. Always include every vehicle license plate as label "license plate".`)
  }
  if (f.has('text')) {
    properties.text_lines = { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, box_2d: BOX_2D }, required: ['text', 'box_2d'] } }
    lines.push('text_lines: every line of visible text, in reading order, exactly as written, each with a tight box_2d around that line.')
  }
  if (f.has('faces')) {
    properties.faces = { type: 'array', items: { type: 'object', properties: { box_2d: BOX_2D, confidence: { type: 'number' } }, required: ['box_2d'] } }
    lines.push('faces: every human face (including partial, small and photographed faces such as on ID cards), each with a box_2d covering the whole face. Do not identify anyone.')
  }
  if (options.prompt) { properties.answer = answerSchema(options.fields); lines.push(`answer: ${options.prompt}`) }
  if (options.language) lines.push(`Write descriptions and labels in language "${options.language}".`)
  lines.push('box_2d is [ymin, xmin, ymax, xmax] normalised to 0-1000.')
  if (!Object.keys(properties).length) properties.description = { type: 'string' }
  return { schema: { type: 'object', properties }, prompt: lines.join('\n') }
}

const conf = (v: unknown) => (num(v) !== undefined ? { confidence: Math.max(0, Math.min(1, Number(v))) } : {})

export function parseGeminiImage(data: any, options: AnalyzeImageOptions, model: string): ImageAnalysis {
  const max = Math.max(1, Math.min(100, options.maxResults ?? 20))
  const labels: ImageLabel[] = (Array.isArray(data?.labels) ? data.labels : []).slice(0, max)
    .map((l: any) => ({ name: String(l?.name ?? l ?? '').trim(), ...conf(l?.confidence) })).filter((l: ImageLabel) => l.name)
  const objects: ImageLabel[] = (Array.isArray(data?.objects) ? data.objects : []).slice(0, max)
    .map((o: any) => ({ name: String(o?.label ?? o?.name ?? '').trim(), ...conf(o?.confidence), ...(geminiBox(o?.box_2d) ? { box: geminiBox(o.box_2d) } : {}) })).filter((o: ImageLabel) => o.name)
  const ocr: OcrLine[] = (Array.isArray(data?.text_lines) ? data.text_lines : [])
    .map((l: any) => ({ text: String(l?.text ?? '').trim(), ...(geminiBox(l?.box_2d) ? { box: geminiBox(l.box_2d) } : {}) })).filter((l: OcrLine) => l.text)
  const faces: FaceBox[] = (Array.isArray(data?.faces) ? data.faces : [])
    .map((f: any) => ({ box: geminiBox(f?.box_2d ?? f), ...conf(f?.confidence) })).filter((f: any): f is FaceBox => Boolean(f.box))
  return {
    ...(typeof data?.description === 'string' ? { description: data.description.trim() } : {}),
    labels, objects, text: ocr.map((l) => l.text).join('\n'), ocr, faces, safety: [],
    ...(options.prompt ? { answer: data?.answer } : {}),
    provider: 'gemini', model,
  }
}

async function analyzeImage(input: MediaBlob, options: AnalyzeImageOptions, ctx: MediaProviderContext): Promise<ImageAnalysis> {
  const model = modelFor(options.model, ctx.credentials, 'vision_model', INFO.defaults.vision ?? 'gemini-2.5-flash')
  const { schema, prompt } = imageRequest(options)
  const { data, res } = await generateJson(ctx, model, [inlinePart(input), { text: prompt }], schema)
  return { ...parseGeminiImage(data, options, model), usage: usageOf(res, model, 'analyze_image') }
}

/* ── Video ─────────────────────────────────────────────────────────── */

function videoRequest(options: AnalyzeVideoOptions): { schema: Record<string, unknown>; prompt: string } {
  const f = new Set(options.features)
  const properties: Record<string, unknown> = {}
  const lines = ['Analyse this video. Give every time as MM:SS from the start of the video.']
  if (f.has('summary')) { properties.summary = { type: 'string' }; lines.push('summary: one paragraph.') }
  if (f.has('scenes')) {
    properties.scenes = { type: 'array', items: { type: 'object', properties: { start: { type: 'string' }, end: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } }, required: ['start', 'end', 'description'] } }
    lines.push('scenes: the scenes / chapters in order with start, end (MM:SS), a short title and a description.')
  }
  if (f.has('labels')) {
    properties.labels = { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, confidence: { type: 'number' }, times: { type: 'array', items: { type: 'string' } } }, required: ['name'] } }
    lines.push('labels: objects, settings and activities with a 0-1 confidence and the times (MM:SS) they appear.')
  }
  if (f.has('text')) {
    properties.text = { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' } }, required: ['text'] } }
    lines.push('text: on-screen text with when it is visible (start, end MM:SS).')
  }
  if (options.prompt) { properties.answer = answerSchema(options.fields); lines.push(`answer: ${options.prompt}`) }
  if (options.language) lines.push(`Write in language "${options.language}".`)
  if (!Object.keys(properties).length) properties.summary = { type: 'string' }
  return { schema: { type: 'object', properties }, prompt: lines.join('\n') }
}

async function runVideo(part: Part, options: AnalyzeVideoOptions, model: string, duration: number | undefined, ctx: MediaProviderContext): Promise<VideoAnalysis> {
  const { schema, prompt } = videoRequest(options)
  const { data, res } = await generateJson(ctx, model, [part, { text: prompt }], schema)
  const parsed = parseVideoJson(data, options, parseTimestamp)
  return { ...parsed, ...(duration !== undefined ? { duration } : {}), provider: 'gemini', model, usage: usageOf(res, model, 'analyze_video') }
}

async function analyzeVideo(input: MediaBlob, options: AnalyzeVideoOptions, ctx: MediaProviderContext): Promise<MaybeAsync<VideoAnalysis>> {
  const model = modelFor(options.model, ctx.credentials, 'video_model', INFO.defaults.video ?? 'gemini-2.5-flash')
  const ref = await mediaPart(input, ctx)
  if (ref.pending && ref.file) return asyncJob('analyze_video', ref.file, input, model, options)
  try {
    return await runVideo(ref.part, options, model, input.duration, ctx)
  } finally {
    if (ref.file) await deleteFile(ref.file.name, ctx)
  }
}

/* ── Async (file still processing) ─────────────────────────────────── */

function asyncJob(operation: 'transcribe' | 'analyze_video', file: GeminiFile, input: MediaBlob, model: string, options: TranscribeOptions | AnalyzeVideoOptions): MediaAsyncJob {
  return {
    async: true, provider: 'gemini', operation, pollAfterMs: POLL_MS,
    job: { file_name: file.name, file_uri: file.uri, mime_type: file.mimeType || input.mime_type, model, duration: input.duration ?? null, options: JSON.parse(JSON.stringify(options)) },
  }
}

async function poll(job: MediaAsyncJob, ctx: MediaProviderContext): Promise<PollResult<TranscriptResult | VideoAnalysis>> {
  const name = String(job.job.file_name ?? '')
  if (!name) throw new MediaProviderError(`${LABEL}: the job has no file`)
  const file = await getFile(name, ctx)
  if (file.state === 'FAILED') throw new MediaProviderError(`${LABEL} could not process the uploaded media`)
  if (file.state !== 'ACTIVE') return { done: false, pollAfterMs: POLL_MS }
  const part = filePart(file, String(job.job.mime_type ?? ''))
  const model = String(job.job.model ?? INFO.defaults.transcribe)
  const duration = num(job.job.duration)
  const options = (job.job.options ?? {}) as any
  if (job.operation === 'analyze_video') return { done: true, result: await runVideo(part, { features: options.features ?? ['summary', 'scenes'], ...options }, model, duration, ctx) }
  return { done: true, result: await runTranscribe(part, options, model, duration, ctx) }
}

async function cleanup(job: MediaAsyncJob, ctx: MediaProviderContext): Promise<void> {
  await deleteFile(String(job.job.file_name ?? ''), ctx)
}

export const geminiProvider: MediaProvider = {
  id: 'gemini',
  label: INFO.label,
  capabilities: INFO.capabilities,
  // The Files API takes up to 2 GB per file; keep chunking for very long audio.
  maxTranscribeBytes: 2 * 1024 * 1024 * 1024,
  maxImageBytes: GEMINI_INLINE_MAX_BYTES - 1024 * 1024,
  transcribe,
  analyzeImage,
  analyzeVideo,
  poll,
  cleanup,
}

