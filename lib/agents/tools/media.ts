/**
 * Agent media tools (server only): transcribe_media and analyze_image,
 * granted by output_config.media_access ({ enabled, integration_id }).
 *
 * The file is one given to the agent step (Run Agent → Files) or a URL the
 * model chose — fetched through safeFetch (egress guard on every hop, the
 * agent's allowed hosts) with the media size cap. The provider is the
 * integration the agent was granted, loaded for the agent's tenant only.
 * Results are compact (the transcript is truncated) so they fit the model's
 * context; nothing is stored.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */

import { AgentToolError, type AgentToolRuntime, type ToolResult } from './runtime'
import type { RunAttachment } from './index'
import { MEDIA_LIMITS } from '@/lib/media/limits'
import type { ImageFeature, MediaBlob } from '@/lib/media/types'

const TRANSCRIPT_MAX_CHARS = 50_000
const SEGMENTS_MAX = 300
const AGENT_MEDIA_TIMEOUT_MS = 110_000

async function mediaFile(runtime: AgentToolRuntime, args: Record<string, any>, attachments: RunAttachment[]): Promise<MediaBlob> {
  const key = String(args.file_id ?? args.name ?? '').trim()
  if (key) {
    const file = attachments.find((f) => (f.id && f.id === key.toLowerCase()) || f.name === key)
    if (!file) throw new AgentToolError(`No file "${key}" was given to this agent step`)
    if (file.bytes.byteLength > MEDIA_LIMITS.maxInputBytes) throw new AgentToolError(`"${file.name}" is larger than ${Math.round(MEDIA_LIMITS.maxInputBytes / 1048576)} MB`)
    return { name: file.name, mime_type: file.mime_type, bytes: file.bytes }
  }
  const url = String(args.url ?? '').trim()
  if (!/^https?:\/\//i.test(url)) throw new AgentToolError('Pass file_id (a file given to this step) or a full http(s) url')
  const { safeFetch, EgressBlockedError } = await import('@/lib/egress-guard')
  let res: Response
  try {
    res = await safeFetch(url, { signal: runtime.signal ? AbortSignal.any([runtime.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) }, { allowedHosts: runtime.allowedHosts })
  } catch (error) {
    if (error instanceof EgressBlockedError) throw new AgentToolError(`URL blocked: ${error.message}`, 403)
    throw error
  }
  if (!res.ok) throw new AgentToolError(`The URL returned HTTP ${res.status}`)
  const declared = Number(res.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > MEDIA_LIMITS.maxInputBytes) throw new AgentToolError('The file is too large')
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength > MEDIA_LIMITS.maxInputBytes) throw new AgentToolError('The file is too large')
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'media')
  return { name, mime_type: res.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream', bytes }
}

export async function runMediaTool(runtime: AgentToolRuntime, name: string, args: Record<string, any>, attachments: RunAttachment[]): Promise<ToolResult> {
  const access = runtime.outputConfig.media_access
  if (!access?.enabled || !access.integration_id) throw new AgentToolError('Media access is disabled for this agent', 403)
  const { loadMediaCredentials } = await import('@/lib/media/credentials')
  const { getMediaProvider } = await import('@/lib/media/providers')
  const { providerContext } = await import('@/lib/media/http')
  const { isAsyncJob } = await import('@/lib/media/types')
  const loaded = await loadMediaCredentials(runtime.db(), runtime.tenantId, access.integration_id)
  const provider = getMediaProvider(loaded.credentials.provider)
  const pctx = providerContext(loaded.credentials, { signal: runtime.signal })
  const deadline = Date.now() + AGENT_MEDIA_TIMEOUT_MS

  if (name === 'transcribe_media') {
    if (!provider.transcribe) throw new AgentToolError(`${loaded.provider.label} cannot transcribe`)
    const file = await mediaFile(runtime, args, attachments)
    if (provider.maxTranscribeBytes && file.bytes.byteLength > provider.maxTranscribeBytes) {
      throw new AgentToolError(`"${file.name}" is larger than ${Math.round(provider.maxTranscribeBytes / 1048576)} MB, the most ${loaded.provider.label} takes in one request — use the workflow Transcribe step (it splits long media)`)
    }
    let out = await provider.transcribe(file, { language: String(args.language ?? '').trim() || undefined, diarize: args.diarize === true }, pctx)
    if (isAsyncJob(out)) {
      const { pollUntil } = await import('@/lib/media/handlers')
      const job = out
      const polled = await pollUntil<import('@/lib/media/types').TranscriptResult>({ info: loaded.provider, provider, credentials: loaded.credentials, pctx }, job, deadline, runtime.signal)
      await provider.cleanup?.(job, pctx).catch(() => {})
      if (!polled.done) throw new AgentToolError('The provider is still transcribing — use the workflow Transcribe step for long recordings')
      out = polled.result
    }
    const text = out.text.slice(0, TRANSCRIPT_MAX_CHARS)
    return {
      name: file.name,
      provider: loaded.provider.id,
      language: out.language ?? null,
      duration_seconds: out.duration ?? null,
      speakers: out.speakers ?? [],
      text,
      truncated: out.text.length > TRANSCRIPT_MAX_CHARS,
      segments: out.segments.slice(0, SEGMENTS_MAX).map((s) => ({ start: Math.round(s.start * 10) / 10, end: Math.round(s.end * 10) / 10, ...(s.speaker ? { speaker: s.speaker } : {}), text: s.text })),
    }
  }

  if (name === 'analyze_image') {
    if (!provider.analyzeImage) throw new AgentToolError(`${loaded.provider.label} cannot analyze images`)
    const file = await mediaFile(runtime, args, attachments)
    const im = await import('@/lib/media/image')
    const img = im.decodeImage(file.bytes)
    const enc = im.imageForProvider(img, { maxBytes: provider.maxImageBytes ?? 15 * 1048576 })
    const requested = (Array.isArray(args.features) ? args.features : []).map((f: unknown) => String(f)) as ImageFeature[]
    const needs: Record<ImageFeature, string> = { description: 'analyze_image', labels: 'analyze_image', objects: 'detect_objects', text: 'ocr', faces: 'detect_faces', safety: 'moderation' }
    const features = (requested.length ? requested : ['description', 'labels', 'text'] as ImageFeature[]).filter((f) => needs[f] && provider.capabilities.includes(needs[f] as never))
    const prompt = String(args.prompt ?? '').trim() || undefined
    const a = await provider.analyzeImage({ name: file.name, mime_type: enc.mime_type, bytes: enc.bytes }, { features, prompt }, pctx)
    return {
      name: file.name,
      provider: loaded.provider.id,
      width: img.width,
      height: img.height,
      description: a.description ?? null,
      labels: a.labels.slice(0, 30).map((l) => l.name),
      objects: a.objects.slice(0, 30).map((o) => o.name),
      text: a.text.slice(0, 20_000),
      face_count: a.faces.length,
      safety_flagged: a.safety.filter((c) => c.flagged).map((c) => c.category),
      ...(prompt ? { answer: a.answer ?? null } : {}),
      ...(features.length < (requested.length || 3) ? { note: `${loaded.provider.label} does not support every requested feature` } : {}),
    }
  }
  throw new AgentToolError(`Unknown tool: ${name}`, 400)
}
