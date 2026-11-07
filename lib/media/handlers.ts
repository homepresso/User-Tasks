/**
 * Workflow engine handlers for the media steps (server only):
 *
 *   media_transcribe      speech → text, timed segments, speakers, SRT / VTT / TXT / JSON files
 *   media_analyze_image   description, labels, objects, OCR text with boxes, face boxes, safety, a prompt's answer
 *   media_analyze_video   summary, scenes, labels, on-screen text, key frames (native or sampled frames)
 *   media_redact_image    blur / pixelate / box faces, plates, sensitive text, custom boxes
 *   media_redact_video    the same over time (sampled frames, FFmpeg), bleep / mute sensitive speech
 *   media_generate_image  generate / edit (mask) images
 *   media_tts             text → speech audio file
 *   media_tools           FFmpeg: info, extract audio / frames, thumbnail, trim, convert, compress, burn subtitles
 *
 * Inputs are read with lib/files/resolve-input (the run's tenant only; URLs
 * through the egress guard); outputs are stored through the storage
 * provider as file objects (lib/documents/store). Providers are reached with
 * the workspace's own credentials (lib/media/credentials) through an
 * egress-guarded fetch (lib/media/http).
 *
 * A handler returns the compact output the run history shows (counts,
 * durations, file names, a short preview, cost — never media bytes or a
 * full transcript); full results go into variables. Long work returns
 * MediaBackground (the engine queues a media job and pauses the run) or,
 * inside a job, MediaContinue (poll a provider job again later).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { writeFile, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { resolveFileInput, type ResolvedFile } from '@/lib/files/resolve-input'
import { outputFileName, storeDocumentFile, type DocumentFileObject } from '@/lib/documents/store'
import type { RedactOptions } from '@/lib/documents/redact'
import type { Confidence } from '@/lib/documents/pii/catalog'
import {
  isAsyncJob,
  MediaLimitError,
  type AnswerField, type Box, type ImageAnalysis, type ImageFeature, type MediaAsyncJob, type MediaBlob, type MediaCapability, type MediaCost,
  type MediaCredentials, type MediaProvider, type MediaProviderContext, type MediaUsage, type TranscriptResult, type TranscribeOptions,
  type VideoAnalysis, type VideoFeature,
} from './types'
import { MEDIA_PROVIDER_BY_ID, type MediaNodeType, type MediaProviderInfo, MEDIA_BACKGROUND_NODE_TYPES } from './catalog'
import { mediaOutputVar } from './schemas'
import { assertMediaDuration, assertMediaSize, formatDuration, MEDIA_LIMITS } from './limits'
import { providerContext, mapLimit } from './http'
import { clampBox, padBox, parseCustomBoxes, roundBox, toPixels } from './geometry'
import { preview, toSrt, toVtt, toText, speakersOf, planChunks, secondsForBytes, mergeChunkTranscripts, transcriptSegmentsFrom, parseSubtitles, cuesToSrt } from './transcript'

/* eslint-disable @typescript-eslint/no-explicit-any -- node config is free-form JSON */

/* ── Context ───────────────────────────────────────────────────────── */

/** Resumable state of a background media job (JSON; never secrets or media bytes). */
export interface MediaJobState {
  /** A provider job being polled. */
  asyncJob?: MediaAsyncJob
  /** Name / duration of the input, for the final output. */
  input?: { name: string; duration?: number; size?: number }
  [key: string]: unknown
}

export interface MediaNodeContext {
  type: string
  config: Record<string, any>
  /** Resolves an expression / template against the run's variables. */
  resolve: (expr: unknown) => any
  supabase: SupabaseClient
  tenantId: string
  variables: Record<string, any>
  /** Sets `<prefix>_<name>` and `<name>`. */
  setVar: (name: string, value: unknown) => void
  warn: (message: string) => void
  info?: (message: string) => void
  /** A saved, non-test run: long work may move to the background. */
  canBackground?: boolean
  /** Set when running inside a background media job. */
  job?: { state: MediaJobState; deadline: number }
  signal?: AbortSignal
  /** Tests: replace the provider / credentials / transport / file store. */
  deps?: {
    fetchImpl?: typeof fetch
    provider?: MediaProvider
    credentials?: { provider: MediaProviderInfo; credentials: MediaCredentials }
    store?: (bytes: Uint8Array, name: string, mime: string) => Promise<DocumentFileObject>
    resolveFile?: (value: unknown, label: string) => Promise<ResolvedFile>
  }
}

/** Returned by a handler: run this step as a background media job (the engine pauses the run). */
export class MediaBackground {
  constructor(readonly reason: string, readonly state: MediaJobState = {}) {}
}

/** Returned inside a background job: not finished, check again after `pollAfterMs`. */
export class MediaContinue {
  constructor(readonly state: MediaJobState, readonly pollAfterMs: number, readonly progress?: number) {}
}

export type MediaNodeResult = Record<string, unknown> | MediaBackground | MediaContinue

/* ── Config helpers ────────────────────────────────────────────────── */

const bool = (v: unknown, dflt = false) => (v === undefined || v === null || v === '' ? dflt : v === true || v === 'true' || v === 1 || v === '1' || v === 'yes')
const num = (v: unknown, dflt?: number) => { const n = Number(v); return v === undefined || v === null || v === '' || !Number.isFinite(n) ? dflt : n }
const str = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).trim()
const MB = 1024 * 1024

export function listOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean)
  const s = str(v)
  if (!s) return []
  if (s.startsWith('[')) { try { const a = JSON.parse(s); if (Array.isArray(a)) return a.map((x) => str(x)).filter(Boolean) } catch { /* plain list */ } }
  return s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean)
}

const resolved = (ctx: MediaNodeContext, key: string): any => ctx.resolve(ctx.config[key])
const opt = (ctx: MediaNodeContext, key: string): string => str(resolved(ctx, key))
const baseName = (name: string) => name.replace(/\.[^.]+$/, '') || 'media'

function fieldsOf(ctx: MediaNodeContext): AnswerField[] | undefined {
  const raw = ctx.config.fields
  if (!Array.isArray(raw)) return undefined
  const types = ['string', 'number', 'boolean', 'array', 'object']
  const fields = raw
    .map((f: any) => ({ name: str(f?.name).replace(/[^\w]/g, '_').slice(0, 64), type: types.includes(f?.type) ? f.type : 'string', description: str(f?.description).slice(0, 300) || undefined }))
    .filter((f: AnswerField) => f.name)
  return fields.length ? fields.slice(0, 50) as AnswerField[] : undefined
}

/* ── Inputs, providers, files, cost ────────────────────────────────── */

async function inputFile(ctx: MediaNodeContext, key: string, label: string): Promise<ResolvedFile> {
  const value = resolved(ctx, key)
  if (ctx.deps?.resolveFile) return ctx.deps.resolveFile(value, label)
  const file = await resolveFileInput(value, { tenantId: ctx.tenantId, label, maxBytes: MEDIA_LIMITS.maxInputBytes, timeoutMs: 120_000 })
  assertMediaSize(file.size, file.name)
  return file
}

interface ProviderHandle {
  info: MediaProviderInfo
  provider: MediaProvider
  credentials: MediaCredentials
  pctx: MediaProviderContext
}

async function providerFor(ctx: MediaNodeContext, key: string, needs: MediaCapability[], what: string): Promise<ProviderHandle> {
  const integrationId = str(ctx.config[key])
  if (!integrationId) throw new Error(`${what}: choose the AI provider connection (an OpenAI, Gemini, Azure AI, AWS, Deepgram, AssemblyAI, ElevenLabs or Stability AI integration)`)
  const loaded = ctx.deps?.credentials ?? await (await import('./credentials')).loadMediaCredentials(ctx.supabase, ctx.tenantId, integrationId)
  const provider = ctx.deps?.provider ?? (await import('./providers')).getMediaProvider(loaded.credentials.provider)
  if (needs.length && !needs.some((c) => provider.capabilities.includes(c))) {
    throw new Error(`${what}: ${loaded.provider.label} cannot ${capabilityPhrase(needs[0])}. Choose a provider that can (${providersWith(needs)}).`)
  }
  const pctx = providerContext(loaded.credentials, { signal: ctx.signal, log: ctx.info, fetchImpl: ctx.deps?.fetchImpl })
  return { info: loaded.provider, provider, credentials: loaded.credentials, pctx }
}

function capabilityPhrase(c: MediaCapability): string {
  const phrases: Record<MediaCapability, string> = {
    transcribe: 'transcribe speech', analyze_image: 'describe images', detect_faces: 'locate faces', ocr: 'read text with its position',
    moderation: 'check image safety', detect_objects: 'locate objects (license plates)', analyze_video: 'analyze whole videos',
    generate_image: 'generate images', edit_image: 'edit images', tts: 'synthesize speech',
  }
  return phrases[c]
}

function providersWith(needs: MediaCapability[]): string {
  return Object.values(MEDIA_PROVIDER_BY_ID).filter((p) => needs.some((c) => p.capabilities.includes(c))).map((p) => p.label).join(', ')
}

async function save(ctx: MediaNodeContext, bytes: Uint8Array, name: string, mime: string): Promise<DocumentFileObject> {
  if (ctx.deps?.store) return ctx.deps.store(bytes, name, mime)
  return storeDocumentFile(ctx.supabase as never, ctx.tenantId, bytes, name, mime)
}

/** Sums provider usage into one estimated cost (all-or-nothing: one unknown price → unknown). */
export class CostMeter {
  private usages: MediaUsage[] = []
  constructor(private provider: MediaProviderInfo['id']) {}
  add(usage: MediaUsage | undefined) { if (usage && usage.quantity > 0) this.usages.push(usage) }
  async total(): Promise<MediaCost> {
    if (!this.usages.length) return { status: 'unknown', amount: null, currency: null }
    const { priceMediaUsage, mediaPricesFromEnv } = await import('./pricing')
    const overrides = mediaPricesFromEnv()
    let amount = 0
    let currency: string | null = null
    const details: string[] = []
    for (const u of this.usages) {
      const c = priceMediaUsage(this.provider, u, overrides)
      if (c.status !== 'priced' || c.amount === null || !c.currency) return { status: 'unknown', amount: null, currency: null }
      if (currency && currency !== c.currency) return { status: 'unknown', amount: null, currency: null, detail: 'several currencies' }
      currency = c.currency
      amount += c.amount
      if (c.detail && details.length < 3) details.push(c.detail)
    }
    return { status: 'priced', amount: Math.round(amount * 1e8) / 1e8, currency, ...(details.length ? { detail: details.join('; ') } : {}) }
  }
}

/* ── FFmpeg helpers ────────────────────────────────────────────────── */

const ff = () => import('./ffmpeg')

function extOf(file: { name: string; mime_type: string }): string {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1]?.toLowerCase()
  if (fromName) return fromName
  const m = file.mime_type.split('/')[1] ?? 'bin'
  return m.replace(/^x-/, '').replace('mpeg', 'mp3').replace('quicktime', 'mov').slice(0, 5)
}

/** Write the input to a temp dir and probe it (needs FFmpeg). */
async function withProbedInput<T>(file: ResolvedFile, work: (dir: string, input: string, info: import('./ffmpeg').MediaInfo) => Promise<T>): Promise<T> {
  const { withTempDir, probeMedia } = await ff()
  return withTempDir(async (dir) => {
    const input = path.join(dir, `input.${extOf(file).replace(/[^a-z0-9]/g, '') || 'bin'}`)
    await writeFile(input, file.bytes)
    const info = await probeMedia(input)
    return work(dir, input, info)
  })
}

/** Duration in seconds when FFmpeg can tell (null otherwise). */
async function mediaDuration(file: ResolvedFile): Promise<number | null> {
  const { ffmpegAvailable } = await ff()
  if (!(await ffmpegAvailable())) return null
  try {
    return await withProbedInput(file, async (_d, _i, info) => info.duration)
  } catch {
    return null
  }
}

/** Should this step move to the background? (`auto`: longer than MEDIA_INLINE_MAX_SECONDS.) */
function wantsBackground(ctx: MediaNodeContext, duration: number | null): string | null {
  if (ctx.job || !ctx.canBackground) return null
  if (!(MEDIA_BACKGROUND_NODE_TYPES as readonly string[]).includes(ctx.type)) return null
  const mode = opt(ctx, 'run_mode') || 'auto'
  if (mode === 'inline') return null
  if (mode === 'background') return 'run mode is Background'
  if (duration !== null && duration > MEDIA_LIMITS.inlineMaxSeconds) return `the media is ${formatDuration(duration)} long (over ${formatDuration(MEDIA_LIMITS.inlineMaxSeconds)})`
  return null
}

function deadlineOf(ctx: MediaNodeContext): number {
  return ctx.job ? ctx.job.deadline : Date.now() + MEDIA_LIMITS.inlineTimeoutMs
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Cancelled')) }, { once: true })
})

/** Poll a provider job until done or the deadline. */
export async function pollUntil<T>(p: ProviderHandle, job: MediaAsyncJob, deadline: number, signal?: AbortSignal, options: { immediate?: boolean } = {}): Promise<{ done: true; result: T } | { done: false; job: MediaAsyncJob; pollAfterMs: number }> {
  if (!p.provider.poll) throw new Error(`${p.info.label} returned a job but cannot be polled`)
  let wait = Math.min(Math.max(job.pollAfterMs, 500), 10_000)
  // A job resumed later (background) has already waited: poll at once.
  if (options.immediate) {
    const r = await p.provider.poll(job, p.pctx)
    if (r.done) return { done: true, result: r.result as T }
    wait = Math.min(Math.max(r.pollAfterMs ?? wait, 1000), 15_000)
  }
  for (;;) {
    if (Date.now() + wait > deadline) return { done: false, job, pollAfterMs: Math.max(5_000, wait) }
    await sleep(wait, signal)
    const r = await p.provider.poll(job, p.pctx)
    if (r.done) return { done: true, result: r.result as T }
    wait = Math.min(Math.max(r.pollAfterMs ?? wait * 1.5, 1000), 15_000)
  }
}

/* ── Transcribe ────────────────────────────────────────────────────── */

function transcribeOptions(ctx: MediaNodeContext, prefix = ''): TranscribeOptions {
  return {
    model: opt(ctx, `${prefix}model`) || undefined,
    language: opt(ctx, `${prefix}language`) || undefined,
    diarize: bool(ctx.config[`${prefix}diarize`]),
    maxSpeakers: num(resolved(ctx, `${prefix}max_speakers`)),
    wordTimestamps: bool(ctx.config[`${prefix}word_timestamps`]),
    prompt: opt(ctx, `${prefix}prompt`) || undefined,
  }
}

/**
 * Transcribe one file: in one request when the provider accepts its size,
 * else as small mono speech audio, split into overlapping chunks when that
 * is still too large (FFmpeg). Async provider jobs are returned as they are.
 */
async function transcribeFile(p: ProviderHandle, file: ResolvedFile, options: TranscribeOptions, deadline: number, signal?: AbortSignal): Promise<TranscriptResult | MediaAsyncJob> {
  if (!p.provider.transcribe) throw new Error(`${p.info.label} cannot transcribe`)
  const max = p.provider.maxTranscribeBytes
  const blob: MediaBlob = { name: file.name, mime_type: file.mime_type, bytes: file.bytes }
  if (!max || file.size <= max) return p.provider.transcribe(blob, options, p.pctx)
  const fmod = await ff()
  const reason = fmod.mediaToolsDisabledReason()
  if (reason || !(await fmod.ffmpegAvailable())) {
    throw new MediaLimitError(`"${file.name}" is ${(file.size / MB).toFixed(1)} MB; ${p.info.label} accepts ${Math.round(max / MB)} MB per request. Longer media is split with FFmpeg, which ${reason ? reason.replace(/^this deployment/, 'this deployment') : 'is not installed on this server'} — or use a provider without a size limit (Deepgram, AssemblyAI, AWS).`)
  }
  return withProbedInput(file, async (dir, input, info) => {
    if (!info.has_audio) throw new MediaLimitError(`"${file.name}" has no audio track`)
    const speech = path.join(dir, 'speech.mp3')
    await fmod.runFfmpeg(fmod.buildSpeechAudioArgs(input, speech))
    const bytes = new Uint8Array(await readFile(speech))
    const sendOne = async (b: Uint8Array, name: string): Promise<TranscriptResult> => {
      const r = await p.provider.transcribe!({ name, mime_type: 'audio/mpeg', bytes: b }, options, p.pctx)
      if (!isAsyncJob(r)) return r
      const polled = await pollUntil<TranscriptResult>(p, r, deadline, signal)
      if (!polled.done) throw new MediaLimitError('The provider is still transcribing a chunk; try Background run mode')
      return polled.result
    }
    if (bytes.byteLength <= max) {
      const r = await sendOne(bytes, `${baseName(file.name)}.mp3`)
      return { ...r, duration: r.duration ?? info.duration ?? undefined }
    }
    const duration = info.duration ?? 0
    const chunks = planChunks(duration, Math.max(60, secondsForBytes(max)))
    const parts: Array<{ chunk: (typeof chunks)[number]; result: TranscriptResult }> = []
    for (const chunk of chunks) {
      if (Date.now() > deadline) throw new MediaLimitError('Transcribing the chunks took too long; try Background run mode')
      const out = path.join(dir, `chunk-${chunk.index}.mp3`)
      await fmod.runFfmpeg(fmod.buildSpeechAudioArgs(input, out, { start: chunk.start, duration: chunk.duration }))
      parts.push({ chunk, result: await sendOne(new Uint8Array(await readFile(out)), `${baseName(file.name)}-part${chunk.index + 1}.mp3`) })
    }
    return { ...mergeChunkTranscripts(parts), chunks: chunks.length } as TranscriptResult
  })
}

const TRANSCRIPT_MIME: Record<string, string> = { srt: 'application/x-subrip', vtt: 'text/vtt', txt: 'text/plain', json: 'application/json' }

async function finishTranscript(ctx: MediaNodeContext, p: ProviderHandle, result: TranscriptResult, inputName: string, extra: Record<string, unknown> = {}) {
  const v = mediaOutputVar(ctx.type, ctx.config)
  const formats = listOf(ctx.config.formats ?? ['srt']).filter((f) => ['srt', 'vtt', 'txt', 'json'].includes(f))
  const base = opt(ctx, 'output_name') || `${baseName(inputName)}-transcript`
  const segments = result.segments.length ? result.segments : (result.text ? [{ id: 0, start: 0, end: result.duration ?? 0, text: result.text }] : [])
  if (!result.segments.length && result.text && formats.some((f) => f === 'srt' || f === 'vtt')) ctx.warn(`${p.info.label} returned no timestamps for this model — the subtitle file has one cue for the whole recording`)
  const speakers = result.speakers?.length ? result.speakers : speakersOf(segments)
  const files: Record<string, DocumentFileObject> = {}
  for (const fmt of formats) {
    const text = fmt === 'srt' ? toSrt(segments) : fmt === 'vtt' ? toVtt(segments) : fmt === 'txt' ? toText({ text: result.text, segments }) : JSON.stringify({ text: result.text, language: result.language ?? null, duration: result.duration ?? null, speakers, segments, ...(result.words ? { words: result.words } : {}) }, null, 2)
    files[fmt] = await save(ctx, new TextEncoder().encode(text), outputFileName(base, 'transcript', fmt), TRANSCRIPT_MIME[fmt])
  }
  const meter = new CostMeter(p.info.id)
  meter.add(result.usage ?? (result.duration ? { unit: 'minute', quantity: result.duration / 60, model: result.model, operation: 'transcribe' } : undefined))
  const cost = await meter.total()
  const transcript = {
    text: result.text,
    language: result.language ?? null,
    duration: result.duration ?? null,
    segments,
    ...(result.words?.length ? { words: result.words } : {}),
    speakers,
    files,
    provider: p.info.id,
    model: result.model ?? null,
    chunks: (result as any).chunks ?? 1,
    cost,
  }
  ctx.variables[v] = transcript
  ctx.variables[`${v}_text`] = result.text
  ctx.variables[`${v}_segments`] = segments
  ctx.variables[`${v}_files`] = Object.values(files)
  for (const [fmt, file] of Object.entries(files)) ctx.variables[`${v}_${fmt}`] = file
  return {
    variable: v,
    provider: p.info.id,
    model: result.model ?? undefined,
    language: result.language ?? undefined,
    duration_seconds: result.duration !== undefined ? Math.round(result.duration * 10) / 10 : undefined,
    segments: segments.length,
    speakers: speakers.length || undefined,
    characters: result.text.length,
    text_preview: preview(result.text, MEDIA_LIMITS.logPreviewChars),
    files: Object.values(files).map((f) => f.name),
    cost,
    ...extra,
  }
}

async function transcribeNode(ctx: MediaNodeContext): Promise<MediaNodeResult> {
  const p = await providerFor(ctx, 'integration_id', ['transcribe'], 'Transcribe')
  const deadline = deadlineOf(ctx)
  const state = ctx.job?.state ?? {}
  // A provider job started earlier (in this or another invocation).
  if (state.asyncJob) {
    const polled = await pollUntil<TranscriptResult>(p, state.asyncJob, deadline, ctx.signal, { immediate: true })
    if (!polled.done) return ctx.job ? new MediaContinue(state, polled.pollAfterMs) : new MediaBackground('the provider is still transcribing', state)
    await p.provider.cleanup?.(state.asyncJob, p.pctx).catch(() => {})
    return finishTranscript(ctx, p, polled.result, state.input?.name ?? 'media', { mode: ctx.job ? 'background' : 'inline' })
  }
  const file = await inputFile(ctx, 'source', 'Media')
  const duration = await mediaDuration(file)
  if (duration !== null) assertMediaDuration(duration, file.name)
  const bg = wantsBackground(ctx, duration)
  if (bg) return new MediaBackground(bg, { input: { name: file.name, duration: duration ?? undefined, size: file.size } })
  const out = await transcribeFile(p, file, transcribeOptions(ctx), deadline, ctx.signal)
  if (isAsyncJob(out)) {
    const nextState: MediaJobState = { asyncJob: out, input: { name: file.name, duration: duration ?? undefined, size: file.size } }
    const polled = await pollUntil<TranscriptResult>(p, out, deadline, ctx.signal)
    if (!polled.done) {
      if (ctx.job) return new MediaContinue(nextState, polled.pollAfterMs)
      if (ctx.canBackground) return new MediaBackground('the provider is still transcribing', nextState)
      await p.provider.cleanup?.(out, p.pctx).catch(() => {})
      throw new MediaLimitError(`${p.info.label} did not finish within ${Math.round(MEDIA_LIMITS.inlineTimeoutMs / 1000)} s (MEDIA_TIMEOUT_SECONDS). Saved runs continue in the background; Save & Test runs inline only.`)
    }
    await p.provider.cleanup?.(out, p.pctx).catch(() => {})
    return finishTranscript(ctx, p, { ...polled.result, duration: polled.result.duration ?? duration ?? undefined }, file.name, { mode: ctx.job ? 'background' : 'inline' })
  }
  return finishTranscript(ctx, p, { ...out, duration: out.duration ?? duration ?? undefined }, file.name, { mode: ctx.job ? 'background' : 'inline' })
}

/* ── Images: shared ────────────────────────────────────────────────── */

interface PreparedImage {
  file: ResolvedFile
  img: import('./image').RgbaImage
  /** Upright, re-encoded for the provider (boxes refer to it). */
  forProvider: MediaBlob
}

async function prepareImage(ctx: MediaNodeContext, file: ResolvedFile, maxBytes?: number): Promise<PreparedImage> {
  const im = await import('./image')
  let bytes = file.bytes
  let kind = im.sniffImage(bytes)
  if (kind !== 'png' && kind !== 'jpeg') {
    const fmod = await ff()
    if (kind === 'unknown' || fmod.mediaToolsDisabledReason() || !(await fmod.ffmpegAvailable())) {
      throw new MediaLimitError(`"${file.name}" is ${kind === 'unknown' ? 'not a PNG or JPEG image' : `a ${kind.toUpperCase()} image`}; images are read as PNG or JPEG${kind === 'unknown' ? '' : ' (other formats are converted with FFmpeg, which this server does not have)'}`)
    }
    bytes = await fmod.withTempDir(async (dir) => {
      const input = path.join(dir, `input.${kind}`)
      const output = path.join(dir, 'converted.png')
      await writeFile(input, file.bytes)
      await fmod.runFfmpeg(['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', input, '-frames:v', '1', output])
      return new Uint8Array(await readFile(output))
    })
    kind = 'png'
  }
  const img = im.decodeImage(bytes)
  const enc = im.imageForProvider(img, { maxBytes: maxBytes ?? 15 * MB })
  return { file, img, forProvider: { name: `${baseName(file.name)}.jpg`, mime_type: enc.mime_type, bytes: enc.bytes } }
}

const pxOf = (b: Box, img: { width: number; height: number }) => toPixels(b, img.width, img.height)

/** Run the provider over the image for the given features (only those it supports; warns about the rest). */
async function analyze(ctx: MediaNodeContext, p: ProviderHandle, image: MediaBlob, features: ImageFeature[], extra: { prompt?: string; fields?: AnswerField[]; maxResults?: number } = {}, strict = false): Promise<ImageAnalysis> {
  const needs: Record<ImageFeature, MediaCapability> = { description: 'analyze_image', labels: 'analyze_image', objects: 'detect_objects', text: 'ocr', faces: 'detect_faces', safety: 'moderation' }
  const supported = features.filter((f) => p.provider.capabilities.includes(needs[f]))
  const missing = features.filter((f) => !supported.includes(f))
  if (missing.length) {
    const msg = `${p.info.label} cannot ${missing.map((f) => capabilityPhrase(needs[f])).join(', ')} — ${missing.length === 1 ? 'that feature was' : 'those features were'} skipped (providers that can: ${providersWith(missing.map((f) => needs[f]))})`
    if (strict) throw new Error(msg)
    ctx.warn(msg)
  }
  if (!supported.length && !extra.prompt) throw new Error(`${p.info.label} supports none of the chosen features`)
  if (!p.provider.analyzeImage) throw new Error(`${p.info.label} cannot analyze images`)
  return p.provider.analyzeImage(image, { features: supported, prompt: extra.prompt, fields: extra.fields, maxResults: extra.maxResults, model: opt(ctx, 'model') || undefined }, p.pctx)
}

/* ── Analyze image ─────────────────────────────────────────────────── */

async function analyzeImageNode(ctx: MediaNodeContext): Promise<MediaNodeResult> {
  const p = await providerFor(ctx, 'integration_id', ['analyze_image', 'ocr', 'detect_faces', 'detect_objects', 'moderation'], 'Analyze Image')
  const file = await inputFile(ctx, 'source', 'Image')
  const prepared = await prepareImage(ctx, file, p.provider.maxImageBytes)
  const features = (listOf(ctx.config.features).length ? listOf(ctx.config.features) : ['description', 'labels', 'text']).filter((f): f is ImageFeature => ['description', 'labels', 'objects', 'text', 'faces', 'safety'].includes(f))
  const prompt = opt(ctx, 'prompt') || undefined
  const a = await analyze(ctx, p, prepared.forProvider, features, { prompt, fields: prompt ? fieldsOf(ctx) : undefined, maxResults: num(resolved(ctx, 'max_results'), 20) })
  const dims = { width: prepared.img.width, height: prepared.img.height }
  const withPx = <T extends { box?: Box }>(x: T) => (x.box ? { ...x, box: roundBox(x.box), box_px: pxOf(x.box, dims) } : x)
  const meter = new CostMeter(p.info.id)
  meter.add(a.usage)
  const cost = await meter.total()
  const flaggedCats = a.safety.filter((c) => c.flagged)
  const result = {
    description: a.description ?? null,
    labels: a.labels,
    objects: a.objects.map(withPx),
    text: a.text,
    ocr: a.ocr.map((l) => ({ text: l.text, confidence: l.confidence, ...(l.box ? { box: roundBox(l.box), box_px: pxOf(l.box, dims) } : {}) })),
    faces: a.faces.map((f) => ({ box: roundBox(f.box), box_px: pxOf(f.box, dims), confidence: f.confidence })),
    face_count: a.faces.length,
    safety: { flagged: flaggedCats.length > 0, categories: a.safety },
    answer: a.answer ?? null,
    width: dims.width,
    height: dims.height,
    provider: p.info.id,
    model: a.model ?? null,
    cost,
  }
  const v = mediaOutputVar(ctx.type, ctx.config)
  ctx.variables[v] = result
  ctx.variables[`${v}_description`] = result.description
  ctx.variables[`${v}_text`] = result.text
  ctx.variables[`${v}_labels`] = a.labels.map((l) => l.name)
  ctx.variables[`${v}_answer`] = result.answer
  return {
    variable: v, provider: p.info.id, model: a.model ?? undefined, file: file.name, width: dims.width, height: dims.height,
    labels: a.labels.length, objects: a.objects.length, text_lines: a.ocr.length, faces: a.faces.length,
    ...(features.includes('safety') ? { safety_flagged: flaggedCats.map((c) => c.category) } : {}),
    ...(result.description ? { description_preview: preview(result.description, 160) } : {}),
    ...(prompt ? { answered: result.answer !== null } : {}),
    cost,
  }
}

/* ── Redaction targets → boxes ─────────────────────────────────────── */

interface RedactSettings {
  targets: string[]
  options: RedactOptions
  style: 'blur' | 'pixelate' | 'box'
  color: [number, number, number]
  padding: number
  detectOnly: boolean
  includeValues: boolean
}

async function redactSettings(ctx: MediaNodeContext, prefix = ''): Promise<RedactSettings> {
  const { resolveInfoTypes } = await import('@/lib/documents/pii/catalog')
  const { parseColor } = await import('./image')
  const targets = (Array.isArray(ctx.config.targets) || listOf(ctx.config.targets).length ? listOf(ctx.config.targets) : ['faces', 'text_pii']).filter((t) => ['faces', 'text_pii', 'plates', 'custom'].includes(t))
  const ids = listOf(ctx.config[`${prefix}info_types`])
  const minConfidence = (['low', 'medium', 'high'].includes(opt(ctx, 'min_confidence')) ? opt(ctx, 'min_confidence') : 'medium') as Confidence
  const style = (['blur', 'pixelate', 'box'].includes(opt(ctx, 'style')) ? opt(ctx, 'style') : 'blur') as RedactSettings['style']
  return {
    targets,
    options: {
      infoTypes: resolveInfoTypes(ids.length ? ids : ['@high', 'date_of_birth'], listOf(ctx.config.regions)),
      minConfidence,
      terms: listOf(resolved(ctx, `${prefix}terms`)),
      patterns: (Array.isArray(ctx.config.patterns) ? ctx.config.patterns : listOf(ctx.config.patterns)).map((p: any) => str(typeof p === 'object' ? p?.pattern : p)).filter(Boolean),
    },
    style,
    color: parseColor(opt(ctx, 'color') || '#000000'),
    padding: Math.max(0, Math.min(100, num(resolved(ctx, 'padding'), 10)!)),
    detectOnly: opt(ctx, 'mode') === 'detect_only',
    includeValues: bool(ctx.config.include_values),
  }
}

interface ImageFinding { type: string; label: string; source: 'provider' | 'ocr' | 'custom'; box: Box; confidence?: number | string; text?: string }

/** One image → what to hide (faces, plates, sensitive text, custom boxes). */
async function findImageRegions(ctx: MediaNodeContext, p: ProviderHandle | null, image: MediaBlob, settings: RedactSettings, dims: { width: number; height: number }, customBoxes: Array<{ box: Box; label?: string }>): Promise<{ findings: ImageFinding[]; usage?: MediaUsage }> {
  const findings: ImageFinding[] = []
  const features: ImageFeature[] = []
  if (settings.targets.includes('faces')) features.push('faces')
  if (settings.targets.includes('text_pii')) features.push('text')
  if (settings.targets.includes('plates')) features.push('objects')
  let usage: MediaUsage | undefined
  if (features.length) {
    if (!p) throw new Error('Choose the AI provider connection that finds faces, text or plates (or use custom boxes only)')
    const a = await analyze(ctx, p, image, features, {}, true)
    usage = a.usage
    if (settings.targets.includes('faces')) for (const f of a.faces) findings.push({ type: 'face', label: 'Face', source: 'provider', box: f.box, confidence: f.confidence })
    if (settings.targets.includes('plates')) {
      const { PLATE_LABEL } = await import('./pii')
      for (const o of a.objects) if (o.box && PLATE_LABEL.test(o.name)) findings.push({ type: 'plate', label: 'License plate', source: 'provider', box: o.box, confidence: o.confidence })
    }
    if (settings.targets.includes('text_pii')) {
      const { findInOcr } = await import('./pii')
      for (const hit of findInOcr(a.ocr, settings.options, settings.includeValues)) findings.push({ type: hit.type, label: hit.label, source: 'ocr', box: hit.box, confidence: hit.confidence, text: hit.text })
    }
  }
  if (settings.targets.includes('custom')) for (const c of customBoxes) findings.push({ type: 'custom', label: c.label ?? 'Custom box', source: 'custom', box: c.box })
  void dims
  return { findings, usage }
}

function countsOf(findings: Array<{ type: string }>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const f of findings) counts[f.type] = (counts[f.type] ?? 0) + 1
  return counts
}

/* ── Redact image ──────────────────────────────────────────────────── */

async function redactImageNode(ctx: MediaNodeContext): Promise<MediaNodeResult> {
  const settings = await redactSettings(ctx)
  const needsProvider = settings.targets.some((t) => t !== 'custom')
  const needs: MediaCapability[] = []
  if (settings.targets.includes('faces')) needs.push('detect_faces')
  if (settings.targets.includes('text_pii')) needs.push('ocr')
  if (settings.targets.includes('plates')) needs.push('detect_objects')
  const p = needsProvider ? await providerFor(ctx, 'integration_id', needs, 'Redact Image') : null
  if (p) {
    const lacking = needs.filter((c) => !p.provider.capabilities.includes(c))
    if (lacking.length) throw new Error(`Redact Image: ${p.info.label} cannot ${lacking.map(capabilityPhrase).join(' or ')}. Choose a provider that can (${providersWith(lacking)}), or remove that target.`)
  }
  const file = await inputFile(ctx, 'source', 'Image')
  const prepared = await prepareImage(ctx, file, p?.provider.maxImageBytes)
  const dims = { width: prepared.img.width, height: prepared.img.height }
  const custom = settings.targets.includes('custom') ? parseCustomBoxes(resolved(ctx, 'boxes'), dims) : []
  if (settings.targets.includes('custom') && !custom.length && !needsProvider) ctx.warn('No valid custom boxes were given')
  const { findings, usage } = await findImageRegions(ctx, p, prepared.forProvider, settings, dims, custom)
  const meter = new CostMeter(p?.info.id ?? 'openai')
  meter.add(usage)
  const cost = p ? await meter.total() : { status: 'unknown', amount: null, currency: null } as MediaCost
  const out = findings.slice(0, MEDIA_LIMITS.maxFindings).map((f) => ({ ...f, box: roundBox(f.box), box_px: pxOf(f.box, dims) }))
  const v = mediaOutputVar(ctx.type, ctx.config)
  let fileObj: DocumentFileObject | null = null
  if (!settings.detectOnly) {
    const im = await import('./image')
    const boxes = findings.map((f) => padBox(f.box, settings.padding)).map((b) => clampBox(b)).filter((b): b is Box => b !== null)
    im.redactRegions(prepared.img, boxes, settings.style, settings.color)
    const outFmt = opt(ctx, 'output_format')
    const format: 'png' | 'jpeg' = outFmt === 'png' || outFmt === 'jpeg' ? outFmt : im.sniffImage(file.bytes) === 'png' ? 'png' : 'jpeg'
    const bytes = im.encodeImage(prepared.img, format, 92)
    fileObj = await save(ctx, bytes, outputFileName(opt(ctx, 'output_name') || `${baseName(file.name)}-redacted`, 'redacted', format === 'png' ? 'png' : 'jpg'), im.IMAGE_MIME[format])
  }
  const counts = countsOf(out)
  const result = { mode: settings.detectOnly ? 'detect_only' : 'redact', file: fileObj, findings: out, counts, total: findings.length, width: dims.width, height: dims.height, provider: p?.info.id ?? null, cost }
  ctx.variables[v] = result
  if (fileObj) ctx.variables[`${v}_file`] = fileObj
  ctx.variables[`${v}_findings`] = out
  ctx.variables[`${v}_count`] = findings.length
  return { variable: v, mode: result.mode, file: fileObj?.name, provider: p?.info.id, counts, total: findings.length, style: settings.detectOnly ? undefined : settings.style, cost }
}

/* ── Analyze video ─────────────────────────────────────────────────── */

async function extractFrames(input: string, dir: string, times: { interval: number; count: number }, maxWidth = 1280): Promise<Array<{ path: string; time: number }>> {
  const fmod = await ff()
  const framesDir = path.join(dir, 'frames')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(framesDir)
  await fmod.runFfmpeg(fmod.buildFramesArgs(input, path.join(framesDir, 'f-%05d.jpg'), { interval: times.interval, count: times.count, format: 'jpeg', maxWidth }))
  const names = (await readdir(framesDir)).filter((n) => n.endsWith('.jpg')).sort()
  return names.map((n, i) => ({ path: path.join(framesDir, n), time: Math.round(i * times.interval * 1000) / 1000 }))
}

async function analyzeVideoNode(ctx: MediaNodeContext): Promise<MediaNodeResult> {
  const p = await providerFor(ctx, 'integration_id', ['analyze_video', 'analyze_image'], 'Analyze Video')
  const features = (listOf(ctx.config.features).length ? listOf(ctx.config.features) : ['summary', 'scenes']).filter((f): f is VideoFeature => ['summary', 'scenes', 'labels', 'text'].includes(f))
  const prompt = opt(ctx, 'prompt') || undefined
  const options = { features, prompt, fields: prompt ? fieldsOf(ctx) : undefined, model: opt(ctx, 'model') || undefined, language: opt(ctx, 'language') || undefined }
  const maxFrames = Math.max(1, Math.min(60, num(resolved(ctx, 'max_frames'), 12)!))
  const wantKeyframes = bool(ctx.config.keyframes)
  const state = ctx.job?.state ?? {}
  const meter = new CostMeter(p.info.id)
  const deadline = deadlineOf(ctx)

  const finish = async (a: VideoAnalysis, method: 'native' | 'frames', frames: number, keyframes: DocumentFileObject[], duration: number | null, name: string) => {
    meter.add(a.usage)
    const cost = await meter.total()
    const result = {
      summary: a.summary ?? null, scenes: a.scenes, labels: a.labels, text: a.text,
      keyframes, answer: a.answer ?? null, duration: a.duration ?? duration, frames_analysed: frames, method,
      provider: p.info.id, model: a.model ?? null, cost,
    }
    const v = mediaOutputVar(ctx.type, ctx.config)
    ctx.variables[v] = result
    ctx.variables[`${v}_summary`] = result.summary
    ctx.variables[`${v}_scenes`] = a.scenes
    ctx.variables[`${v}_keyframes`] = keyframes
    ctx.variables[`${v}_answer`] = result.answer
    return {
      variable: v, provider: p.info.id, model: a.model ?? undefined, file: name, method, frames_analysed: frames,
      scenes: a.scenes.length, labels: a.labels.length, keyframes: keyframes.length,
      ...(result.summary ? { summary_preview: preview(result.summary, 160) } : {}),
      duration_seconds: result.duration ?? undefined, cost, mode: ctx.job ? 'background' : 'inline',
    }
  }

  if (state.asyncJob) {
    const polled = await pollUntil<VideoAnalysis>(p, state.asyncJob, deadline, ctx.signal, { immediate: true })
    if (!polled.done) return ctx.job ? new MediaContinue(state, polled.pollAfterMs) : new MediaBackground('the provider is still processing the video', state)
    await p.provider.cleanup?.(state.asyncJob, p.pctx).catch(() => {})
    return finish(polled.result, 'native', 0, [], state.input?.duration ?? null, state.input?.name ?? 'video')
  }

  const file = await inputFile(ctx, 'source', 'Video')
  const fmod = await ff()
  const haveFf = !fmod.mediaToolsDisabledReason() && (await fmod.ffmpegAvailable())
  const native = p.provider.capabilities.includes('analyze_video') && Boolean(p.provider.analyzeVideo)
  if (!native && !haveFf) await fmod.requireFfmpeg(`Analyze Video with ${p.info.label} (it reads sampled frames)`)
  const duration = haveFf ? await mediaDuration(file) : null
  if (duration !== null) assertMediaDuration(duration, file.name)
  const bg = wantsBackground(ctx, duration)
  if (bg) return new MediaBackground(bg, { input: { name: file.name, duration: duration ?? undefined, size: file.size } })

  // Key frames (stored files) need FFmpeg in either mode.
  const keyframesFrom = async (frames: Array<{ path: string; time: number }>) => {
    const out: DocumentFileObject[] = []
    for (const f of frames) out.push({ ...(await save(ctx, new Uint8Array(await readFile(f.path)), `${baseName(file.name)}-${f.time.toFixed(1).replace('.', '_')}s.jpg`, 'image/jpeg')), time: f.time } as DocumentFileObject & { time: number })
    return out
  }

  if (native) {
    const r = await p.provider.analyzeVideo!({ name: file.name, mime_type: file.mime_type, bytes: file.bytes, duration: duration ?? undefined }, options, p.pctx)
    let analysis: VideoAnalysis
    if (isAsyncJob(r)) {
      const polled = await pollUntil<VideoAnalysis>(p, r, deadline, ctx.signal)
      if (!polled.done) {
        const nextState = { asyncJob: r, input: { name: file.name, duration: duration ?? undefined } }
        if (ctx.job) return new MediaContinue(nextState, polled.pollAfterMs)
        if (ctx.canBackground) return new MediaBackground('the provider is still processing the video', nextState)
        throw new MediaLimitError(`${p.info.label} did not finish within ${Math.round(MEDIA_LIMITS.inlineTimeoutMs / 1000)} s`)
      }
      await p.provider.cleanup?.(r, p.pctx).catch(() => {})
      analysis = polled.result
    } else analysis = r
    let keyframes: DocumentFileObject[] = []
    if (wantKeyframes) {
      if (!haveFf) ctx.warn('Key frames need FFmpeg, which this server does not have — none were stored')
      else keyframes = await withProbedInput(file, async (dir, input, info) => {
        const times = (analysis.scenes.length ? analysis.scenes.map((s) => s.start) : [0]).slice(0, maxFrames)
        const { buildThumbnailArgs, runFfmpeg } = fmod
        const frames: Array<{ path: string; time: number }> = []
        for (const [k, t] of times.entries()) {
          const out = path.join(dir, `key-${k}.jpg`)
          await runFfmpeg(buildThumbnailArgs(input, out, Math.min(t + 0.5, Math.max(0, (info.duration ?? t) - 0.1)), { format: 'jpeg', maxWidth: 1280 }))
          frames.push({ path: out, time: t })
        }
        return keyframesFrom(frames)
      })
    }
    return finish(analysis, 'native', 0, keyframes, duration, file.name)
  }

  // Sampled frames.
  return withProbedInput(file, async (dir, input, info) => {
    if (!info.has_video) throw new MediaLimitError(`"${file.name}" has no video track`)
    const d = info.duration ?? 0
    const interval = d > 0 ? Math.max(0.5, d / maxFrames) : 1
    const frames = await extractFrames(input, dir, { interval, count: maxFrames })
    if (!frames.length) throw new MediaLimitError('No frames could be read from the video')
    const blobs = await Promise.all(frames.map(async (f) => ({ name: path.basename(f.path), mime_type: 'image/jpeg', bytes: new Uint8Array(await readFile(f.path)), time: f.time })))
    let analysis: VideoAnalysis
    if (p.provider.analyzeFrames) {
      analysis = await p.provider.analyzeFrames(blobs, options, p.pctx)
    } else {
      // Per-frame image analysis (AWS / Azure): labels and on-screen text over time; no summary.
      const imgFeatures: ImageFeature[] = []
      if (features.includes('labels') || features.includes('summary') || features.includes('scenes')) imgFeatures.push(p.provider.capabilities.includes('analyze_image') ? 'labels' : 'objects')
      if (features.includes('text') && p.provider.capabilities.includes('ocr')) imgFeatures.push('text')
      if (p.provider.capabilities.includes('analyze_image') && (features.includes('summary') || features.includes('scenes'))) imgFeatures.push('description')
      const per = await mapLimit(blobs, 4, (b) => analyze(ctx, p, b, imgFeatures))
      const labels = new Map<string, { name: string; confidence?: number; times: number[] }>()
      const text = new Map<string, { text: string; start: number; end: number }>()
      per.forEach((a, k) => {
        meter.add(a.usage)
        const t = blobs[k].time
        for (const l of [...a.labels, ...a.objects]) {
          const e = labels.get(l.name.toLowerCase()) ?? { name: l.name, confidence: l.confidence, times: [] }
          if (!e.times.includes(t)) e.times.push(t)
          e.confidence = Math.max(e.confidence ?? 0, l.confidence ?? 0) || undefined
          labels.set(l.name.toLowerCase(), e)
        }
        for (const line of a.ocr) {
          const e = text.get(line.text) ?? { text: line.text, start: t, end: t + interval }
          e.end = t + interval
          text.set(line.text, e)
        }
      })
      const scenes = per.map((a, k) => ({ start: blobs[k].time, end: blobs[k + 1]?.time ?? d, description: a.description ?? '' })).filter((s) => s.description)
      if (features.includes('summary') && !scenes.length) ctx.warn(`${p.info.label} describes single images only: the summary needs OpenAI or Gemini`)
      analysis = { summary: scenes.length ? scenes.map((s) => s.description).join(' ') : undefined, scenes, labels: [...labels.values()].sort((a, b) => b.times.length - a.times.length).slice(0, 100), text: [...text.values()], duration: d, provider: p.info.id }
    }
    const keyframes = wantKeyframes ? await keyframesFrom(frames) : []
    return finish({ ...analysis, duration: analysis.duration ?? d }, 'frames', frames.length, keyframes, d, file.name)
  })
}

/* ── Redact video (and audio) ──────────────────────────────────────── */

async function redactVideoNode(ctx: MediaNodeContext): Promise<MediaNodeResult> {
  const fmod = await ff()
  await fmod.requireFfmpeg('Redact Video')
  const settings = await redactSettings(ctx)
  const audioMode = (['bleep', 'mute'].includes(opt(ctx, 'audio')) ? opt(ctx, 'audio') : 'none') as 'none' | 'bleep' | 'mute'
  const visualTargets = settings.targets.filter((t) => t !== 'custom')
  const needs: MediaCapability[] = []
  if (visualTargets.includes('faces')) needs.push('detect_faces')
  if (visualTargets.includes('text_pii')) needs.push('ocr')
  if (visualTargets.includes('plates')) needs.push('detect_objects')
  const file = await inputFile(ctx, 'source', 'Video')
  const duration = await mediaDuration(file)
  if (duration !== null) assertMediaDuration(duration, file.name, MEDIA_LIMITS.maxRedactVideoSeconds, 'MEDIA_VIDEO_REDACT_MAX_SECONDS')
  const bg = wantsBackground(ctx, duration)
  if (bg) return new MediaBackground(bg, { input: { name: file.name, duration: duration ?? undefined, size: file.size } })

  return withProbedInput(file, async (dir, input, info) => {
    const d = info.duration ?? 0
    const hasVideo = info.has_video && Boolean(info.video?.width && info.video?.height)
    const frame = { width: info.video?.width ?? 0, height: info.video?.height ?? 0 }
    // Rotated phone video: ffmpeg auto-rotates on decode, so boxes are in the displayed orientation.
    if (info.video && (info.video.rotation === 90 || info.video.rotation === 270)) { const w = frame.width; frame.width = frame.height; frame.height = w }
    const findings: Array<Record<string, unknown>> = []
    let framesSampled = 0
    let providerId: string | null = null
    const tracking = await import('./tracking')
    const regions: import('./ffmpeg').TimedRegion[] = []
    let meterProvider: MediaProviderInfo['id'] = 'openai'
    const usages: MediaUsage[] = []

    if (hasVideo && (visualTargets.length || settings.targets.includes('custom'))) {
      const detections: import('./tracking').FrameDetection[] = []
      let interval = Math.max(0.2, num(resolved(ctx, 'sample_interval'), 1)!)
      if (visualTargets.length) {
        const p = await providerFor(ctx, 'integration_id', needs, 'Redact Video')
        const lacking = needs.filter((c) => !p.provider.capabilities.includes(c))
        if (lacking.length) throw new Error(`Redact Video: ${p.info.label} cannot ${lacking.map(capabilityPhrase).join(' or ')}. Choose a provider that can (${providersWith(lacking)}), or remove that target.`)
        providerId = p.info.id
        meterProvider = p.info.id
        const sample = tracking.sampleTimes(d, interval, MEDIA_LIMITS.maxFrames)
        interval = sample.interval
        const frames = await extractFrames(input, dir, { interval, count: Math.min(MEDIA_LIMITS.maxFrames, Math.max(1, Math.ceil(d / interval))) })
        framesSampled = frames.length
        const per = await mapLimit(frames, 4, async (f) => {
          const bytes = new Uint8Array(await readFile(f.path))
          const blob = { name: path.basename(f.path), mime_type: 'image/jpeg', bytes }
          return findImageRegions(ctx, p, blob, { ...settings, targets: visualTargets }, frame, [])
        })
        per.forEach((r, k) => {
          if (r.usage) usages.push(r.usage)
          for (const f of r.findings) {
            detections.push({ time: frames[k].time, box: f.box, type: f.type })
            if (findings.length < MEDIA_LIMITS.maxFindings) findings.push({ type: f.type, label: f.label, source: f.source, ...(f.text ? { text: f.text } : {}), confidence: f.confidence, box: roundBox(f.box), box_px: pxOf(f.box, frame), start: frames[k].time, end: frames[k].time + interval })
          }
        })
      }
      const tracks = tracking.trackDetections(detections, { interval, duration: d, padding: Math.max(settings.padding, 15) })
      regions.push(...tracking.tracksToRegions(tracks, frame))
      if (settings.targets.includes('custom')) {
        for (const c of parseCustomBoxes(resolved(ctx, 'boxes'), frame)) {
          const padded = clampBox(padBox(c.box, settings.padding)) ?? c.box
          const px = pxOf(padded, frame)
          regions.push({ ...px, start: c.start ?? 0, end: c.end ?? (d || 1e6) })
          findings.push({ type: 'custom', label: c.label ?? 'Custom box', source: 'custom', box: roundBox(c.box), box_px: pxOf(c.box, frame), start: c.start ?? 0, end: c.end ?? d })
        }
      }
    }

    // Audio: sensitive speech → spans to bleep / mute.
    const audioSegments: Array<{ start: number; end: number; type: string; text: string }> = []
    if (audioMode !== 'none' && info.has_audio) {
      let segments = transcriptSegmentsFrom(resolved(ctx, 'transcript'))
      if (!segments) {
        const key = str(ctx.config.transcribe_integration_id) ? 'transcribe_integration_id' : 'integration_id'
        const tp = await providerFor(ctx, key, ['transcribe'], 'Redact Video (speech)')
        const r = await transcribeFile(tp, file, { wordTimestamps: true, language: opt(ctx, 'language') || undefined }, deadlineOf(ctx), ctx.signal)
        let tr: TranscriptResult
        if (isAsyncJob(r)) {
          const polled = await pollUntil<TranscriptResult>(tp, r, deadlineOf(ctx), ctx.signal)
          if (!polled.done) throw new MediaLimitError('The provider is still transcribing; run Redact Video in Background mode, or pass a transcript from a Transcribe step')
          await tp.provider.cleanup?.(r, tp.pctx).catch(() => {})
          tr = polled.result
        } else tr = r
        if (tr.usage) usages.push(tr.usage)
        segments = tr.segments
      }
      const { findInTranscript } = await import('./pii')
      const ids = listOf(ctx.config.audio_info_types)
      const { resolveInfoTypes } = await import('@/lib/documents/pii/catalog')
      const audioOptions: RedactOptions = {
        ...settings.options,
        infoTypes: ids.length ? resolveInfoTypes(ids, listOf(ctx.config.regions)) : settings.options.infoTypes,
        terms: [...(settings.options.terms ?? []), ...listOf(resolved(ctx, 'audio_terms'))],
      }
      for (const hit of findInTranscript(segments ?? [], audioOptions, settings.includeValues)) {
        audioSegments.push({ start: hit.start, end: hit.end, type: hit.type, text: hit.text })
        if (findings.length < MEDIA_LIMITS.maxFindings) findings.push({ type: hit.type, label: hit.label, source: 'speech', text: hit.text, confidence: hit.confidence, start: hit.start, end: hit.end })
      }
    } else if (audioMode !== 'none') ctx.warn(`"${file.name}" has no audio track — nothing to bleep`)

    const v = mediaOutputVar(ctx.type, ctx.config)
    let fileObj: DocumentFileObject | null = null
    if (!settings.detectOnly) {
      const spans = fmod.mergeSpans(audioSegments, 0.15)
      const audioFilter = audioMode !== 'none' && spans.length ? fmod.buildAudioRedactFilter(spans, audioMode, d || Math.max(...spans.map((s) => s.end)) + 1) : null
      const fmtOpt = opt(ctx, 'output_format')
      if (hasVideo) {
        const format = (['mp4', 'webm', 'mov'].includes(fmtOpt) ? fmtOpt : 'mp4') as 'mp4' | 'webm' | 'mov'
        const videoFilter = regions.length ? fmod.buildVideoRedactFilter(regions, frame, settings.style, settings.color.map((c) => c.toString(16).padStart(2, '0')).join('')) : null
        const out = path.join(dir, `redacted.${format}`)
        await fmod.runFfmpeg(fmod.buildRedactVideoArgs(input, out, { videoFilter, audioFilter, hasAudio: info.has_audio, format }))
        fileObj = await save(ctx, new Uint8Array(await readFile(out)), outputFileName(opt(ctx, 'output_name') || `${baseName(file.name)}-redacted`, 'redacted', format), fmod.MEDIA_MIME[format])
      } else {
        if (!info.has_audio) throw new MediaLimitError(`"${file.name}" has neither video nor audio`)
        const inExt = extOf(file)
        const format = (fmod.isAudioFormat(inExt) ? inExt : 'mp3') as import('./ffmpeg').AudioFormat
        const out = path.join(dir, `redacted.${format}`)
        await fmod.runFfmpeg(fmod.buildRedactAudioArgs(input, out, audioFilter ?? '[0:a]anull[aout]', format))
        fileObj = await save(ctx, new Uint8Array(await readFile(out)), outputFileName(opt(ctx, 'output_name') || `${baseName(file.name)}-redacted`, 'redacted', format), fmod.MEDIA_MIME[format])
      }
    }
    const meter = new CostMeter(meterProvider)
    for (const u of usages) meter.add(u)
    const cost = usages.length ? await meter.total() : ({ status: 'unknown', amount: null, currency: null } as MediaCost)
    const counts = countsOf(findings as Array<{ type: string }>)
    const result = { mode: settings.detectOnly ? 'detect_only' : 'redact', file: fileObj, findings, counts, total: findings.length, duration: d, frames_sampled: framesSampled, audio_segments: audioSegments, provider: providerId, cost }
    ctx.variables[v] = result
    if (fileObj) ctx.variables[`${v}_file`] = fileObj
    ctx.variables[`${v}_findings`] = findings
    ctx.variables[`${v}_count`] = findings.length
    return { variable: v, mode: result.mode, file: fileObj?.name, provider: providerId ?? undefined, duration_seconds: Math.round(d * 10) / 10, frames_sampled: framesSampled, regions: regions.length, audio_segments: audioSegments.length, counts, cost, run_mode: ctx.job ? 'background' : 'inline' }
  })
}

/* ── Generate / edit image ─────────────────────────────────────────── */

async function generateImageNode(ctx: MediaNodeContext): Promise<MediaNodeResult> {
  const edit = opt(ctx, 'operation') === 'edit'
  const p = await providerFor(ctx, 'integration_id', [edit ? 'edit_image' : 'generate_image'], edit ? 'Edit Image' : 'Generate Image')
  const prompt = opt(ctx, 'prompt')
  if (!prompt) throw new Error('Generate Image: a prompt is required')
  const format = (['png', 'jpeg', 'webp'].includes(opt(ctx, 'format')) ? opt(ctx, 'format') : 'png') as 'png' | 'jpeg' | 'webp'
  const base = { prompt, model: opt(ctx, 'model') || undefined, size: opt(ctx, 'size') || undefined, quality: opt(ctx, 'quality') || undefined, count: Math.max(1, Math.min(4, num(resolved(ctx, 'count'), 1)!)), format, negativePrompt: opt(ctx, 'negative_prompt') || undefined }
  let r
  if (edit) {
    if (!p.provider.editImage) throw new Error(`${p.info.label} cannot edit images`)
    const image = await inputFile(ctx, 'source', 'Image')
    const maskValue = resolved(ctx, 'mask')
    const mask = maskValue ? await inputFile(ctx, 'mask', 'Mask') : undefined
    r = await p.provider.editImage({ ...base, image: { name: image.name, mime_type: image.mime_type, bytes: image.bytes }, ...(mask ? { mask: { name: mask.name, mime_type: mask.mime_type, bytes: mask.bytes } } : {}) }, p.pctx)
  } else {
    if (!p.provider.generateImage) throw new Error(`${p.info.label} cannot generate images`)
    r = await p.provider.generateImage(base, p.pctx)
  }
  const files: DocumentFileObject[] = []
  const name = opt(ctx, 'output_name') || (edit ? 'edited-image' : 'generated-image')
  for (const [k, img] of r.images.entries()) {
    const ext = img.mime_type.includes('jpeg') ? 'jpg' : img.mime_type.includes('webp') ? 'webp' : 'png'
    files.push(await save(ctx, img.bytes, outputFileName(r.images.length > 1 ? `${name}-${k + 1}` : name, 'image', ext), img.mime_type))
  }
  const meter = new CostMeter(p.info.id)
  meter.add(r.usage)
  const cost = await meter.total()
  const v = mediaOutputVar(ctx.type, ctx.config)
  const revised = r.images.find((i) => i.revised_prompt)?.revised_prompt ?? null
  ctx.variables[v] = { file: files[0] ?? null, files, revised_prompt: revised, provider: p.info.id, model: r.model ?? null, cost }
  ctx.variables[`${v}_file`] = files[0] ?? null
  ctx.variables[`${v}_files`] = files
  return { variable: v, provider: p.info.id, model: r.model ?? undefined, operation: edit ? 'edit' : 'generate', files: files.map((f) => f.name), cost }
}

/* ── Text to speech ────────────────────────────────────────────────── */

async function ttsNode(ctx: MediaNodeContext): Promise<MediaNodeResult> {
  const p = await providerFor(ctx, 'integration_id', ['tts'], 'Text to Speech')
  if (!p.provider.speak) throw new Error(`${p.info.label} cannot synthesize speech`)
  const text = opt(ctx, 'text')
  if (!text) throw new Error('Text to Speech: the text is empty')
  if (text.length > MEDIA_LIMITS.maxTtsChars) throw new MediaLimitError(`Text to Speech: the text has ${text.length} characters; at most ${MEDIA_LIMITS.maxTtsChars}`)
  const format = (['mp3', 'wav', 'opus', 'aac', 'flac'].includes(opt(ctx, 'format')) ? opt(ctx, 'format') : 'mp3') as 'mp3' | 'wav' | 'opus' | 'aac' | 'flac'
  const r = await p.provider.speak({ text, voice: opt(ctx, 'voice') || undefined, model: opt(ctx, 'model') || undefined, format, speed: num(resolved(ctx, 'speed')), language: opt(ctx, 'language') || undefined, instructions: opt(ctx, 'instructions') || undefined }, p.pctx)
  const ext = r.format === 'opus' ? 'ogg' : r.format === 'aac' ? 'aac' : r.format
  const file = await save(ctx, r.bytes, outputFileName(opt(ctx, 'output_name') || 'speech', 'speech', ext), r.mime_type)
  const meter = new CostMeter(p.info.id)
  meter.add(r.usage ?? { unit: 'char', quantity: text.length, model: r.model, operation: 'tts' })
  const cost = await meter.total()
  const v = mediaOutputVar(ctx.type, ctx.config)
  ctx.variables[v] = { file, characters: text.length, format: r.format, voice: r.voice ?? null, provider: p.info.id, model: r.model ?? null, cost }
  ctx.variables[`${v}_file`] = file
  return { variable: v, provider: p.info.id, model: r.model ?? undefined, voice: r.voice ?? undefined, characters: text.length, file: file.name, cost }
}

/* ── Media utilities ───────────────────────────────────────────────── */

async function toolsNode(ctx: MediaNodeContext): Promise<MediaNodeResult> {
  const op = opt(ctx, 'operation') || 'info'
  const labels: Record<string, string> = { info: 'Get media info', extract_audio: 'Extract audio', frames: 'Extract frames', thumbnail: 'Thumbnail', trim: 'Trim', convert: 'Convert', compress: 'Compress', burn_subtitles: 'Burn in subtitles' }
  if (!labels[op]) throw new Error(`Media Utilities: unknown operation "${op}"`)
  const fmod = await ff()
  await fmod.requireFfmpeg(`Media Utilities → ${labels[op]}`)
  const file = await inputFile(ctx, 'source', 'Media')
  const v = mediaOutputVar(ctx.type, ctx.config)
  const duration = op === 'info' ? null : await mediaDuration(file)
  if (duration !== null) assertMediaDuration(duration, file.name)
  const bg = op === 'info' ? null : wantsBackground(ctx, duration)
  if (bg) return new MediaBackground(bg, { input: { name: file.name, duration: duration ?? undefined, size: file.size } })
  const base = opt(ctx, 'output_name') || baseName(file.name)
  const storeOut = async (out: string, name: string, ext: string) => save(ctx, new Uint8Array(await readFile(out)), outputFileName(name, 'media', ext), fmod.MEDIA_MIME[ext] ?? 'application/octet-stream')

  return withProbedInput(file, async (dir, input, info) => {
    if (op === 'info') {
      const result = { ...info, size: info.size ?? file.size }
      ctx.variables[v] = result
      return { variable: v, file: file.name, duration_seconds: info.duration, format: info.format, video: info.video ? `${info.video.codec} ${info.video.width}×${info.video.height}` : null, audio: info.audio ? `${info.audio.codec} ${info.audio.sample_rate} Hz` : null }
    }
    const d = info.duration ?? 0
    let fileObj: DocumentFileObject
    switch (op) {
      case 'extract_audio': {
        if (!info.has_audio) throw new MediaLimitError(`"${file.name}" has no audio track`)
        const fmt = (fmod.isAudioFormat(opt(ctx, 'format')) ? opt(ctx, 'format') : 'mp3') as import('./ffmpeg').AudioFormat
        const out = path.join(dir, `audio.${fmt}`)
        await fmod.runFfmpeg(fmod.buildExtractAudioArgs(input, out, fmt))
        fileObj = await storeOut(out, `${base}-audio`, fmt)
        break
      }
      case 'frames': {
        if (!info.has_video) throw new MediaLimitError(`"${file.name}" has no video track`)
        const fmt = opt(ctx, 'format') === 'png' ? 'png' : 'jpeg'
        const count = Math.max(1, Math.min(MEDIA_LIMITS.maxExtractFrames, num(resolved(ctx, 'count'), 10)!))
        const interval = Math.max(0.04, num(resolved(ctx, 'interval'), 1)!)
        const framesDir = path.join(dir, 'frames')
        const { mkdir } = await import('node:fs/promises')
        await mkdir(framesDir)
        const ext = fmt === 'png' ? 'png' : 'jpg'
        await fmod.runFfmpeg(fmod.buildFramesArgs(input, path.join(framesDir, `f-%05d.${ext}`), { interval, count, format: fmt, start: opt(ctx, 'start') ? fmod.parseTime(opt(ctx, 'start'), 'Start') : undefined }))
        const names = (await readdir(framesDir)).sort()
        const files: Array<DocumentFileObject & { time: number }> = []
        const start = opt(ctx, 'start') ? fmod.parseTime(opt(ctx, 'start'), 'Start') : 0
        for (const [k, n] of names.entries()) {
          const time = Math.round((start + k * interval) * 1000) / 1000
          files.push({ ...(await save(ctx, new Uint8Array(await readFile(path.join(framesDir, n))), outputFileName(`${base}-frame-${String(k + 1).padStart(3, '0')}`, 'frame', ext), fmod.MEDIA_MIME[fmt])), time })
        }
        ctx.variables[v] = files
        ctx.variables[`${v}_count`] = files.length
        return { variable: v, operation: op, frames: files.length, interval_seconds: interval, duration_seconds: d }
      }
      case 'thumbnail': {
        if (!info.has_video) throw new MediaLimitError(`"${file.name}" has no video track`)
        const fmt = opt(ctx, 'format') === 'png' ? 'png' : 'jpeg'
        const atRaw = opt(ctx, 'at')
        const at = atRaw ? fmod.parseTime(atRaw, 'Time') : Math.min(1, d * 0.1)
        const ext = fmt === 'png' ? 'png' : 'jpg'
        const out = path.join(dir, `thumb.${ext}`)
        await fmod.runFfmpeg(fmod.buildThumbnailArgs(input, out, Math.min(at, Math.max(0, d - 0.05)), { format: fmt, maxWidth: num(resolved(ctx, 'max_width')) }))
        fileObj = await storeOut(out, `${base}-thumbnail`, fmt === 'png' ? 'png' : 'jpeg')
        fileObj = { ...fileObj, name: fileObj.name.replace(/\.jpeg$/, '.jpg') }
        break
      }
      case 'trim': {
        const start = opt(ctx, 'start') ? fmod.parseTime(opt(ctx, 'start'), 'Start') : 0
        const end = opt(ctx, 'end') ? fmod.parseTime(opt(ctx, 'end'), 'End') : null
        if (end === null && !opt(ctx, 'start')) throw new Error('Trim: give a start and / or an end time')
        const inExt = extOf(file)
        const fmt = (fmod.isVideoFormat(inExt) || fmod.isAudioFormat(inExt) ? inExt : info.has_video ? 'mp4' : 'mp3') as import('./ffmpeg').VideoFormat | import('./ffmpeg').AudioFormat
        const out = path.join(dir, `trimmed.${fmt}`)
        await fmod.runFfmpeg(fmod.buildTrimArgs(input, out, { start, end }, fmt, info.has_video))
        fileObj = await storeOut(out, `${base}-trimmed`, fmt)
        break
      }
      case 'convert': {
        const fmt = opt(ctx, 'format')
        if (!fmod.isVideoFormat(fmt) && !fmod.isAudioFormat(fmt)) throw new Error(`Convert: choose a format (mp4, webm, mov, gif, mp3, wav, m4a, ogg, flac)`)
        const out = path.join(dir, `converted.${fmt}`)
        await fmod.runFfmpeg(fmod.buildConvertArgs(input, out, fmt, { maxWidth: num(resolved(ctx, 'max_width')), maxHeight: num(resolved(ctx, 'max_height')), hasVideo: info.has_video }))
        fileObj = await storeOut(out, base, fmt)
        break
      }
      case 'compress': {
        const q = (['low', 'medium', 'high'].includes(opt(ctx, 'quality')) ? opt(ctx, 'quality') : 'medium') as 'low' | 'medium' | 'high'
        const inExt = extOf(file)
        const fmt = (info.has_video ? (fmod.isVideoFormat(inExt) && inExt !== 'gif' ? inExt : 'mp4') : fmod.isAudioFormat(inExt) && inExt !== 'wav' && inExt !== 'flac' ? inExt : 'mp3') as import('./ffmpeg').VideoFormat | import('./ffmpeg').AudioFormat
        const out = path.join(dir, `compressed.${fmt}`)
        await fmod.runFfmpeg(fmod.buildCompressArgs(input, out, q, { maxWidth: num(resolved(ctx, 'max_width')), maxHeight: num(resolved(ctx, 'max_height')), hasVideo: info.has_video, format: fmt }))
        fileObj = await storeOut(out, `${base}-compressed`, fmt)
        break
      }
      case 'burn_subtitles': {
        if (!info.has_video) throw new MediaLimitError(`"${file.name}" has no video track`)
        const subsValue = resolved(ctx, 'subtitles')
        let srt: string | null = null
        const segments = transcriptSegmentsFrom(subsValue)
        if (segments) srt = toSrt(segments)
        else {
          const subsFile = await inputFile(ctx, 'subtitles', 'Subtitles')
          const cues = parseSubtitles(new TextDecoder().decode(subsFile.bytes))
          if (!cues.length) throw new Error('Burn in subtitles: the subtitles are not SRT or WebVTT')
          srt = cuesToSrt(cues)
        }
        await writeFile(path.join(dir, 'subs.srt'), srt)
        const inExt = extOf(file)
        const fmt = (fmod.isVideoFormat(inExt) && inExt !== 'gif' ? inExt : 'mp4') as 'mp4' | 'webm' | 'mov'
        const out = path.join(dir, `subtitled.${fmt}`)
        // Run in the temp dir so the subtitles file is a plain relative name in the filter graph.
        await fmod.runFfmpeg(fmod.buildBurnSubtitlesArgs(path.basename(input), 'subs.srt', path.basename(out), fmt), { cwd: dir })
        fileObj = await storeOut(out, `${base}-subtitled`, fmt)
        break
      }
      default:
        throw new Error(`Media Utilities: unknown operation "${op}"`)
    }
    ctx.variables[v] = fileObj
    return { variable: v, operation: op, file: fileObj.name, size: fileObj.size, duration_seconds: d || undefined, run_mode: ctx.job ? 'background' : 'inline' }
  })
}

/* ── Dispatch ──────────────────────────────────────────────────────── */

export async function runMediaNode(ctx: MediaNodeContext): Promise<MediaNodeResult> {
  switch (ctx.type as MediaNodeType) {
    case 'media_transcribe': return transcribeNode(ctx)
    case 'media_analyze_image': return analyzeImageNode(ctx)
    case 'media_analyze_video': return analyzeVideoNode(ctx)
    case 'media_redact_image': return redactImageNode(ctx)
    case 'media_redact_video': return redactVideoNode(ctx)
    case 'media_generate_image': return generateImageNode(ctx)
    case 'media_tts': return ttsNode(ctx)
    case 'media_tools': return toolsNode(ctx)
  }
  throw new Error(`Unknown media step ${ctx.type}`)
}

/* ── Background: config snapshot ───────────────────────────────────── */

/**
 * The step's config with every {{expression}} resolved now (a background
 * job has no run variables). Inline base64 / data-URL inputs are stored
 * first so the job row holds a file reference, never the media.
 */
export async function snapshotMediaConfig(ctx: Pick<MediaNodeContext, 'config' | 'resolve' | 'supabase' | 'tenantId' | 'deps'>): Promise<Record<string, unknown>> {
  const walk = (value: unknown, depth: number): unknown => {
    if (depth > 6) return value
    if (typeof value === 'string') return value.includes('{{') ? ctx.resolve(value) : value
    if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, depth + 1)]))
    return value
  }
  const out = walk(ctx.config, 0) as Record<string, unknown>
  for (const key of ['source', 'mask', 'subtitles', 'transcript']) {
    const v = out[key]
    const inline = (x: unknown) => (typeof x === 'string' && x.startsWith('data:')) || (x && typeof x === 'object' && !Array.isArray(x) && (typeof (x as any).base64 === 'string' || typeof (x as any).content_base64 === 'string'))
    const entry = Array.isArray(v) ? v[0] : v
    if (key !== 'transcript' && inline(entry)) {
      const file = await resolveFileInput(entry, { tenantId: ctx.tenantId, label: key, maxBytes: MEDIA_LIMITS.maxInputBytes })
      out[key] = ctx.deps?.store ? await ctx.deps.store(file.bytes, file.name, file.mime_type) : await storeDocumentFile(ctx.supabase as never, ctx.tenantId, file.bytes, file.name, file.mime_type)
    }
  }
  return out
}

