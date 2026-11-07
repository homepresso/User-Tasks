/**
 * AWS media provider (server-only): Amazon Rekognition (faces, labels /
 * objects incl. license plates, text, moderation) and Amazon Transcribe
 * (asynchronous batch job, media staged in the integration's S3 bucket).
 *
 * API docs (shapes checked 2026-10-30):
 *   https://docs.aws.amazon.com/rekognition/latest/APIReference/API_DetectFaces.html
 *   https://docs.aws.amazon.com/rekognition/latest/APIReference/API_DetectLabels.html
 *   https://docs.aws.amazon.com/rekognition/latest/APIReference/API_DetectText.html
 *   https://docs.aws.amazon.com/rekognition/latest/APIReference/API_DetectModerationLabels.html
 *   https://docs.aws.amazon.com/rekognition/latest/dg/limits.html (Image.Bytes ≤ 5 MB, PNG / JPEG)
 *   https://docs.aws.amazon.com/transcribe/latest/APIReference/API_StartTranscriptionJob.html
 *   https://docs.aws.amazon.com/transcribe/latest/APIReference/API_TranscriptionJob.html
 *   https://docs.aws.amazon.com/transcribe/latest/dg/diarization-output-batch.html
 *
 * Requests are signed with SigV4: JSON 1.1 APIs via lib/aws/sigv4
 * signRequest; S3 PUT / DELETE need the hash of a binary payload in
 * x-amz-content-sha256, which signRequest (string bodies only) cannot
 * express, so signS3() below signs those (same algorithm; a test checks it
 * against signRequest for a text body).
 *
 * Transcribe flow: PUT s3://<bucket>/usertasks-media/<uuid>/<name> →
 * StartTranscriptionJob (no OutputBucketName: the transcript stays in the
 * service bucket and TranscriptFileUri is a short-lived URL) → poll
 * GetTranscriptionJob → fetch the transcript JSON → cleanup deletes the S3
 * object and the transcription job.
 *
 * A credentials.endpoint (tests / local mock) replaces every AWS host:
 * JSON APIs POST to <endpoint>/, S3 uses path style <endpoint>/<bucket>/<key>.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */

import { createHash, createHmac, randomUUID } from 'node:crypto'
import {
  MediaProviderError,
  type AnalyzeImageOptions, type FaceBox, type ImageAnalysis, type ImageLabel, type MediaAsyncJob, type MediaBlob, type MediaProvider, type MediaProviderContext,
  type OcrLine, type OcrWord, type PollResult, type SafetyCategory, type TranscribeOptions, type TranscriptResult, type TranscriptSegment, type TranscriptWord,
} from '../types'
import { MEDIA_PROVIDER_BY_ID } from '../catalog'
import { amzDate, rfc3986, signRequest, type AwsCredentials } from '@/lib/aws/sigv4'
import { bytesBody, extensionFor, mediaJson, mediaRequest, minutesOf, normBox, num, round, speakersOf, toBase64 } from './shared'

const INFO = MEDIA_PROVIDER_BY_ID.aws
const LABEL = 'AWS'
export const REKOGNITION_MAX_BYTES = 5 * 1024 * 1024
const POLL_MS = 5000

function creds(ctx: MediaProviderContext): { region: string; credentials: AwsCredentials } {
  const c = ctx.credentials
  if (!c.accessKeyId || !c.secretAccessKey) throw new MediaProviderError(`${LABEL}: the integration needs an access key ID and secret access key`)
  if (!c.region) throw new MediaProviderError(`${LABEL}: the integration needs a region`)
  return { region: c.region, credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, ...(c.sessionToken ? { sessionToken: c.sessionToken } : {}) } }
}

const override = (ctx: MediaProviderContext) => (ctx.credentials.endpoint ? ctx.credentials.endpoint.replace(/\/+$/, '') : '')
const serviceUrl = (ctx: MediaProviderContext, service: 'rekognition' | 'transcribe', region: string) => override(ctx) ? `${override(ctx)}/` : `https://${service}.${region}.amazonaws.com/`

/** A signed AWS JSON 1.1 call. */
async function awsJson<T = any>(ctx: MediaProviderContext, service: 'rekognition' | 'transcribe', target: string, payload: unknown, options: { noRetry?: boolean } = {}): Promise<T> {
  const { region, credentials } = creds(ctx)
  const url = serviceUrl(ctx, service, region)
  const body = JSON.stringify(payload)
  const headers = signRequest({
    method: 'POST', url, body, region, service, credentials, now: ctx.now?.(),
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': target },
  })
  delete headers.host // fetch sets Host itself (signed with the same value)
  return mediaJson<T>(ctx, `${LABEL} ${service === 'rekognition' ? 'Rekognition' : 'Transcribe'}`, url, { method: 'POST', headers, body }, options)
}

/* ── S3 (binary payload signing) ───────────────────────────────────── */

const sha256Hex = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex')
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data, 'utf8').digest()

/**
 * SigV4 header signing with an explicit payload hash (S3 needs
 * x-amz-content-sha256 = hex SHA-256 of the bytes). Returns the headers to
 * send (without host).
 */
export function signS3(input: { method: string; url: string; headers?: Record<string, string>; payloadHash: string; region: string; credentials: AwsCredentials; now?: number; service?: string }): Record<string, string> {
  const url = new URL(input.url)
  const service = input.service ?? 's3'
  const { dateTime, date } = amzDate(input.now ?? Date.now())
  const scope = `${date}/${input.region}/${service}/aws4_request`
  const headers: Record<string, string> = { ...(input.headers ?? {}), host: url.host, 'x-amz-date': dateTime, 'x-amz-content-sha256': input.payloadHash }
  if (input.credentials.sessionToken) headers['x-amz-security-token'] = input.credentials.sessionToken
  const entries = Object.entries(headers).map(([k, v]) => [k.toLowerCase().trim(), String(v).trim().replace(/\s+/g, ' ')] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const canonicalHeaders = entries.map(([k, v]) => `${k}:${v}\n`).join('')
  const signedHeaders = entries.map(([k]) => k).join(';')
  const path = !url.pathname || url.pathname === '/' ? '/' : url.pathname.split('/').map((s) => rfc3986(decodeURIComponent(s))).join('/')
  const query = [...url.searchParams.entries()].map(([k, v]) => [rfc3986(k), rfc3986(v)] as const).sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&')
  const canonical = [input.method.toUpperCase(), path, query, canonicalHeaders, signedHeaders, input.payloadHash].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', dateTime, scope, sha256Hex(canonical)].join('\n')
  const key = hmac(hmac(hmac(hmac(`AWS4${input.credentials.secretAccessKey}`, date), input.region), service), 'aws4_request')
  const signature = createHmac('sha256', key).update(toSign, 'utf8').digest('hex')
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) if (k !== 'host') out[k] = v
  out.authorization = `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return out
}

function s3Url(ctx: MediaProviderContext, bucket: string, key: string, region: string): string {
  const path = key.split('/').map(rfc3986).join('/')
  return override(ctx) ? `${override(ctx)}/${bucket}/${path}` : `https://${bucket}.s3.${region}.amazonaws.com/${path}`
}

async function s3Put(ctx: MediaProviderContext, bucket: string, key: string, media: MediaBlob): Promise<void> {
  const { region, credentials } = creds(ctx)
  const url = s3Url(ctx, bucket, key, region)
  const headers = signS3({ method: 'PUT', url, region, credentials, now: ctx.now?.(), payloadHash: sha256Hex(media.bytes), headers: { 'content-type': media.mime_type || 'application/octet-stream' } })
  await mediaRequest(ctx, `${LABEL} S3`, url, { method: 'PUT', headers, body: bytesBody(media.bytes) })
}

async function s3Delete(ctx: MediaProviderContext, bucket: string, key: string): Promise<void> {
  const { region, credentials } = creds(ctx)
  const url = s3Url(ctx, bucket, key, region)
  const headers = signS3({ method: 'DELETE', url, region, credentials, now: ctx.now?.(), payloadHash: sha256Hex('') })
  await mediaRequest(ctx, `${LABEL} S3`, url, { method: 'DELETE', headers }, { okStatuses: [404], noRetry: true })
}

/* ── Rekognition ───────────────────────────────────────────────────── */

const pct = (v: unknown) => (num(v) !== undefined ? round(Number(v) / 100, 4) : undefined)
const awsBox = (b: any) => (b ? normBox(Number(b.Left), Number(b.Top), Number(b.Width), Number(b.Height)) ?? undefined : undefined)

export function parseRekognitionFaces(res: any): FaceBox[] {
  return (res?.FaceDetails ?? []).map((f: any) => ({ box: awsBox(f?.BoundingBox), ...(pct(f?.Confidence) !== undefined ? { confidence: pct(f.Confidence) } : {}) })).filter((f: any): f is FaceBox => Boolean(f.box))
}

export function parseRekognitionLabels(res: any, max: number): { labels: ImageLabel[]; objects: ImageLabel[] } {
  const labels: ImageLabel[] = []
  const objects: ImageLabel[] = []
  for (const l of res?.Labels ?? []) {
    const name = String(l?.Name ?? '')
    if (!name) continue
    if (labels.length < max) labels.push({ name, ...(pct(l?.Confidence) !== undefined ? { confidence: pct(l.Confidence) } : {}) })
    for (const inst of l?.Instances ?? []) {
      const box = awsBox(inst?.BoundingBox)
      if (box && objects.length < max * 5) objects.push({ name, box, ...(pct(inst?.Confidence ?? l?.Confidence) !== undefined ? { confidence: pct(inst?.Confidence ?? l?.Confidence) } : {}) })
    }
  }
  return { labels, objects }
}

export function parseRekognitionText(res: any): OcrLine[] {
  const detections = Array.isArray(res?.TextDetections) ? res.TextDetections : []
  const wordsByParent = new Map<number, OcrWord[]>()
  for (const d of detections) {
    if (d?.Type !== 'WORD') continue
    const list = wordsByParent.get(Number(d.ParentId)) ?? []
    const box = awsBox(d?.Geometry?.BoundingBox)
    list.push({ text: String(d.DetectedText ?? ''), ...(box ? { box } : {}), ...(pct(d.Confidence) !== undefined ? { confidence: pct(d.Confidence) } : {}) })
    wordsByParent.set(Number(d.ParentId), list)
  }
  return detections.filter((d: any) => d?.Type === 'LINE').map((d: any) => {
    const box = awsBox(d?.Geometry?.BoundingBox)
    const words = wordsByParent.get(Number(d.Id))
    return { text: String(d.DetectedText ?? ''), ...(box ? { box } : {}), ...(pct(d.Confidence) !== undefined ? { confidence: pct(d.Confidence) } : {}), ...(words?.length ? { words } : {}) }
  })
}

export function parseRekognitionModeration(res: any): SafetyCategory[] {
  return (res?.ModerationLabels ?? []).map((m: any) => ({ category: String(m?.ParentName ? `${m.ParentName} / ${m.Name}` : m?.Name ?? ''), flagged: true, ...(pct(m?.Confidence) !== undefined ? { score: pct(m.Confidence) } : {}) })).filter((s: SafetyCategory) => s.category)
}

async function analyzeImage(input: MediaBlob, options: AnalyzeImageOptions, ctx: MediaProviderContext): Promise<ImageAnalysis> {
  if (input.bytes.byteLength > REKOGNITION_MAX_BYTES) throw new MediaProviderError(`${LABEL} Rekognition accepts images up to 5 MB`, 413)
  const max = Math.max(1, Math.min(1000, options.maxResults ?? 20))
  const f = new Set(options.features)
  const image = { Image: { Bytes: toBase64(input.bytes) } }
  const calls: string[] = []
  const wantLabels = f.has('labels') || f.has('objects') || f.has('description')
  if (f.has('faces')) calls.push('DetectFaces')
  if (wantLabels) calls.push('DetectLabels')
  if (f.has('text')) calls.push('DetectText')
  if (f.has('safety')) calls.push('DetectModerationLabels')
  const results = await Promise.all(calls.map((op) => {
    const payload: Record<string, unknown> = { ...image }
    if (op === 'DetectFaces') payload.Attributes = ['DEFAULT']
    if (op === 'DetectLabels') { payload.MaxLabels = Math.max(max, 50); payload.MinConfidence = 50 }
    if (op === 'DetectModerationLabels') payload.MinConfidence = 50
    return awsJson(ctx, 'rekognition', `RekognitionService.${op}`, payload)
  }))
  const by = Object.fromEntries(calls.map((op, i) => [op, results[i]]))
  const { labels, objects } = by.DetectLabels ? parseRekognitionLabels(by.DetectLabels, max) : { labels: [], objects: [] }
  const ocr = by.DetectText ? parseRekognitionText(by.DetectText) : []
  return {
    labels: f.has('labels') || f.has('description') ? labels : [],
    objects: f.has('objects') ? objects : [],
    text: ocr.map((l) => l.text).join('\n'),
    ocr,
    faces: by.DetectFaces ? parseRekognitionFaces(by.DetectFaces) : [],
    safety: by.DetectModerationLabels ? parseRekognitionModeration(by.DetectModerationLabels) : [],
    provider: 'aws',
    model: 'rekognition',
    ...(calls.length ? { usage: { unit: 'request', quantity: 1, model: calls.join('+'), operation: 'analyze_image' } } : {}),
  }
}

/* ── Transcribe ────────────────────────────────────────────────────── */

const MEDIA_FORMATS = ['mp3', 'mp4', 'wav', 'flac', 'ogg', 'amr', 'webm', 'm4a']

export function transcribeMediaFormat(media: MediaBlob): string {
  const fromName = String(media.name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  const ext = fromName === 'mov' ? 'mp4' : fromName === 'opus' ? 'ogg' : fromName
  if (ext && MEDIA_FORMATS.includes(ext)) return ext
  const fromMime = extensionFor(media.mime_type)
  const mapped = fromMime === 'mov' ? 'mp4' : fromMime === 'opus' ? 'ogg' : fromMime
  if (MEDIA_FORMATS.includes(mapped)) return mapped
  throw new MediaProviderError(`${LABEL} Transcribe accepts ${MEDIA_FORMATS.join(', ')} (got ${media.mime_type || 'unknown type'}) — convert the media first`)
}

export function startTranscriptionPayload(jobName: string, bucket: string, key: string, format: string, options: TranscribeOptions): Record<string, unknown> {
  const payload: Record<string, unknown> = { TranscriptionJobName: jobName, Media: { MediaFileUri: `s3://${bucket}/${key}` }, MediaFormat: format }
  const lang = String(options.language ?? '').trim()
  // Transcribe wants a full code (en-US); a bare "en" → language identification.
  if (/^[a-z]{2,3}-[A-Z]{2}$/.test(lang)) payload.LanguageCode = lang
  else payload.IdentifyLanguage = true
  if (options.diarize) payload.Settings = { ShowSpeakerLabels: true, MaxSpeakerLabels: Math.max(2, Math.min(30, Math.floor(options.maxSpeakers ?? 10))) }
  return payload
}

async function transcribe(input: MediaBlob, options: TranscribeOptions, ctx: MediaProviderContext): Promise<MediaAsyncJob> {
  const bucket = ctx.credentials.bucket
  if (!bucket) throw new MediaProviderError(`${LABEL} Transcribe needs a staging S3 bucket in the integration`)
  const format = transcribeMediaFormat(input)
  const id = randomUUID()
  const safeName = (String(input.name || 'media').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'media').replace(/\.[^.]*$/, '') + `.${format}`
  const key = `usertasks-media/${id}/${safeName}`
  const jobName = `usertasks-${id}`
  await s3Put(ctx, bucket, key, input)
  try {
    await awsJson(ctx, 'transcribe', 'Transcribe.StartTranscriptionJob', startTranscriptionPayload(jobName, bucket, key, format, options), { noRetry: true })
  } catch (error) {
    try { await s3Delete(ctx, bucket, key) } catch { /* best effort */ }
    throw error
  }
  ctx.log?.(`${LABEL} Transcribe: job ${jobName} started`)
  return {
    async: true, provider: 'aws', operation: 'transcribe', pollAfterMs: POLL_MS,
    job: { job_name: jobName, bucket, key, diarize: Boolean(options.diarize), word_timestamps: Boolean(options.wordTimestamps), language: options.language ?? '', duration: input.duration ?? null },
  }
}

export function parseAwsTranscript(doc: any, job: Record<string, unknown>, languageCode?: string): TranscriptResult {
  const results = doc?.results ?? {}
  const diarize = Boolean(job.diarize)
  const items: any[] = Array.isArray(results.items) ? results.items : []
  const byId = new Map<string, TranscriptWord>()
  const words: TranscriptWord[] = []
  for (const item of items) {
    const alt = item?.alternatives?.[0] ?? {}
    const content = String(alt.content ?? '')
    if (item?.type === 'punctuation') {
      const last = words[words.length - 1]
      if (last) last.text += content
      continue
    }
    const w: TranscriptWord = { text: content, start: Number(item?.start_time) || 0, end: Number(item?.end_time) || 0 }
    if (num(alt.confidence) !== undefined) w.confidence = Number(alt.confidence)
    if (diarize && item?.speaker_label) w.speaker = String(item.speaker_label)
    words.push(w)
    if (item?.id !== undefined) byId.set(String(item.id), w)
  }
  let segments: TranscriptSegment[] = []
  const audioSegments = Array.isArray(results.audio_segments) ? results.audio_segments : []
  if (audioSegments.length) {
    segments = audioSegments.map((s: any, i: number) => {
      const seg: TranscriptSegment = { id: i, start: Number(s?.start_time) || 0, end: Number(s?.end_time) || 0, text: String(s?.transcript ?? '').trim() }
      if (diarize && s?.speaker_label) seg.speaker = String(s.speaker_label)
      if (job.word_timestamps && Array.isArray(s?.items)) seg.words = s.items.map((id: unknown) => byId.get(String(id))).filter(Boolean) as TranscriptWord[]
      return seg
    })
  } else if (words.length) {
    let current: TranscriptWord[] = []
    const flush = () => {
      if (!current.length) return
      segments.push({ id: segments.length, start: current[0].start, end: current[current.length - 1].end, text: current.map((w) => w.text).join(' '), ...(current[0].speaker ? { speaker: current[0].speaker } : {}), ...(job.word_timestamps ? { words: current } : {}) })
      current = []
    }
    for (const w of words) {
      if (current.length && w.speaker !== current[0].speaker) flush()
      current.push(w)
      if (/[.?!]$/.test(w.text) || w.end - current[0].start >= 12) flush()
    }
    flush()
  }
  segments = segments.filter((s) => s.text)
  const text = String(results.transcripts?.[0]?.transcript ?? '').trim() || segments.map((s) => s.text).join(' ')
  const lastEnd = words.length ? words[words.length - 1].end : segments.length ? segments[segments.length - 1].end : undefined
  const duration = num(job.duration) ?? lastEnd
  const minutes = minutesOf(duration)
  const language = languageCode || results.language_code || (job.language ? String(job.language) : undefined)
  return {
    text,
    ...(language ? { language: String(language) } : {}),
    ...(duration !== undefined ? { duration } : {}),
    segments,
    ...(job.word_timestamps && words.length ? { words } : {}),
    ...(speakersOf(segments) ? { speakers: speakersOf(segments) } : {}),
    provider: 'aws',
    model: 'transcribe',
    ...(minutes !== undefined ? { usage: { unit: 'minute', quantity: minutes, model: 'transcribe', operation: 'transcribe' } } : {}),
  }
}

async function poll(job: MediaAsyncJob, ctx: MediaProviderContext): Promise<PollResult<TranscriptResult>> {
  const name = String(job.job.job_name ?? '')
  if (!name) throw new MediaProviderError(`${LABEL} Transcribe: the job has no name`)
  const res = await awsJson<any>(ctx, 'transcribe', 'Transcribe.GetTranscriptionJob', { TranscriptionJobName: name })
  const tj = res?.TranscriptionJob ?? {}
  const status = String(tj.TranscriptionJobStatus ?? '')
  if (status === 'FAILED') throw new MediaProviderError(`${LABEL} Transcribe failed: ${String(tj.FailureReason ?? 'unknown reason').slice(0, 300)}`)
  if (status !== 'COMPLETED') return { done: false, pollAfterMs: POLL_MS }
  const uri = String(tj.Transcript?.TranscriptFileUri ?? '')
  if (!uri) throw new MediaProviderError(`${LABEL} Transcribe completed without a transcript`)
  // A short-lived presigned URL into the service bucket: no signing.
  const doc = await mediaJson<any>(ctx, `${LABEL} Transcribe`, uri, { method: 'GET' })
  return { done: true, result: parseAwsTranscript(doc, job.job, tj.LanguageCode) }
}

async function cleanup(job: MediaAsyncJob, ctx: MediaProviderContext): Promise<void> {
  const bucket = String(job.job.bucket ?? '')
  const key = String(job.job.key ?? '')
  const name = String(job.job.job_name ?? '')
  if (bucket && key) {
    try { await s3Delete(ctx, bucket, key) } catch (error: any) { ctx.log?.(`${LABEL}: could not delete the staged media: ${String(error?.message ?? error).slice(0, 200)}`) }
  }
  if (name) {
    try { await awsJson(ctx, 'transcribe', 'Transcribe.DeleteTranscriptionJob', { TranscriptionJobName: name }, { noRetry: true }) } catch (error: any) { ctx.log?.(`${LABEL}: could not delete the transcription job: ${String(error?.message ?? error).slice(0, 200)}`) }
  }
}

export const awsProvider: MediaProvider = {
  id: 'aws',
  label: INFO.label,
  capabilities: INFO.capabilities,
  maxTranscribeBytes: 2 * 1024 * 1024 * 1024,
  maxImageBytes: REKOGNITION_MAX_BYTES,
  transcribe,
  analyzeImage,
  poll,
  cleanup,
}
