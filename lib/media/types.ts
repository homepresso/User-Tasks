/**
 * Media (images, audio, video) — shared types (client-safe: no server imports).
 *
 * The media workflow steps (lib/media/handlers.ts) and the agent media tools
 * talk to AI providers through one interface, MediaProvider
 * (lib/media/providers). A provider is reached with the workspace's own
 * credentials (an integration made from a connector: OpenAI, Google Gemini,
 * Azure AI Speech, Azure AI Vision, AWS Transcribe + Rekognition, Deepgram,
 * AssemblyAI, ElevenLabs, Stability AI), loaded and decrypted per run for the
 * run's tenant only (lib/media/credentials.ts).
 *
 * Geometry: every box is NORMALISED to the image it was found in —
 * x / y / width / height are fractions (0–1) of the image width / height,
 * origin top-left. lib/media/geometry.ts converts to pixels.
 *
 * Times are seconds (floating point) from the start of the media.
 */

/* ── Providers ─────────────────────────────────────────────────────── */

export type MediaProviderId =
  | 'openai'
  | 'gemini'
  | 'azure_speech'
  | 'azure_vision'
  | 'aws'
  | 'deepgram'
  | 'assemblyai'
  | 'elevenlabs'
  | 'stability'

export type MediaCapability =
  /** Speech to text (audio, or the audio of a video). */
  | 'transcribe'
  /** Describe / label / answer a question about an image. */
  | 'analyze_image'
  /** Face boxes in an image (never identification). */
  | 'detect_faces'
  /** Text in an image with boxes. */
  | 'ocr'
  /** Safety / moderation categories for an image. */
  | 'moderation'
  /** Objects with boxes (licence plates, vehicles, …). */
  | 'detect_objects'
  /** Understand a whole video natively (summary, scenes) without frame sampling. */
  | 'analyze_video'
  | 'generate_image'
  | 'edit_image'
  | 'tts'

/** A file in memory, read for the run's tenant (lib/files/resolve-input). */
export interface MediaBlob {
  name: string
  mime_type: string
  bytes: Uint8Array
  /** Duration in seconds when known (ffprobe, or the caller). */
  duration?: number
}

/** Decrypted, secret-resolved credentials of one integration. Never logged. */
export interface MediaCredentials {
  provider: MediaProviderId
  /** The integration id (for logs / cost records; not secret). */
  integrationId: string
  /** API base URL (the provider's public endpoint unless the integration overrides it). */
  baseUrl: string
  apiKey?: string
  /** Azure region / AWS region. */
  region?: string
  /** Azure resource endpoint (https://<name>.cognitiveservices.azure.com). */
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  /** AWS Transcribe: the S3 bucket media is staged in (deleted after the job). */
  bucket?: string
  /** Provider-specific settings (OpenAI organisation, default model, …). Not secret. */
  extra: Record<string, string>
}

/** Usage the provider reports or we measure, for cost (lib/media/pricing.ts). */
export interface MediaUsage {
  /**
   * minute — audio / video minutes processed;
   * image — images analysed or generated;
   * char — characters synthesised (TTS);
   * token — model tokens (vision / Gemini), with input / output split.
   */
  unit: 'minute' | 'image' | 'char' | 'token' | 'request'
  quantity: number
  model?: string
  /** For token-priced models. */
  input_tokens?: number
  output_tokens?: number
  /** Which operation (transcribe, analyze_image, …) — prices differ per operation. */
  operation: MediaOperation
}

export type MediaOperation = 'transcribe' | 'analyze_image' | 'analyze_video' | 'detect_faces' | 'ocr' | 'moderation' | 'detect_objects' | 'generate_image' | 'edit_image' | 'tts'

export interface MediaCost {
  status: 'priced' | 'unknown'
  amount: number | null
  currency: string | null
  /** e.g. "1.5 minute × $0.006 (openai whisper-1)" */
  detail?: string
}

/**
 * What a provider call needs besides its inputs: an egress-guarded fetch
 * (every URL is checked by lib/egress-guard, redirects re-checked; a
 * per-call timeout), the credentials and a clock (tests).
 */
export interface MediaProviderContext {
  credentials: MediaCredentials
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  signal?: AbortSignal
  /** Non-secret progress lines for the run log. */
  log?: (message: string) => void
  now?: () => number
}

/** A long provider job (AssemblyAI, AWS Transcribe, Azure batch, Gemini file processing) to poll. */
export interface MediaAsyncJob {
  async: true
  provider: MediaProviderId
  operation: MediaOperation
  /** Provider job state (ids, URLs to poll, staged objects to delete). JSON only, never secrets. */
  job: Record<string, unknown>
  /** Suggested wait before the next poll. */
  pollAfterMs: number
}

export type MaybeAsync<T> = T | MediaAsyncJob

export function isAsyncJob(value: unknown): value is MediaAsyncJob {
  return Boolean(value) && typeof value === 'object' && (value as MediaAsyncJob).async === true
}

export type PollResult<T> = { done: false; pollAfterMs?: number; progress?: number } | { done: true; result: T }

/* ── Transcription ─────────────────────────────────────────────────── */

export interface TranscribeOptions {
  /** Provider model (default per provider: gpt-4o-transcribe, nova-3, universal, scribe_v1, …). */
  model?: string
  /** BCP-47 / ISO-639-1 code; empty = detect. */
  language?: string
  /** Speaker labels (diarisation) where supported. */
  diarize?: boolean
  maxSpeakers?: number
  /** Word-level timestamps where supported. */
  wordTimestamps?: boolean
  /** Vocabulary / context hint (names, jargon). */
  prompt?: string
}

export interface TranscriptWord {
  text: string
  start: number
  end: number
  confidence?: number
  speaker?: string
}

export interface TranscriptSegment {
  id: number
  start: number
  end: number
  text: string
  speaker?: string
  confidence?: number
  words?: TranscriptWord[]
}

export interface TranscriptResult {
  text: string
  /** Detected or requested language code. */
  language?: string
  /** Media duration in seconds (when known). */
  duration?: number
  segments: TranscriptSegment[]
  /** All words (when word timing was requested / returned). */
  words?: TranscriptWord[]
  /** Distinct speaker labels ("A", "B" / "speaker_0", …) in order of first appearance. */
  speakers?: string[]
  provider: MediaProviderId
  model?: string
  usage?: MediaUsage
}

/* ── Images ────────────────────────────────────────────────────────── */

/** Normalised box (fractions of the image size, origin top-left). */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface ImageLabel {
  name: string
  /** 0–1. */
  confidence?: number
  box?: Box
}

export interface OcrWord {
  text: string
  box?: Box
  confidence?: number
}

export interface OcrLine {
  text: string
  box?: Box
  confidence?: number
  /** Word boxes (needed to redact part of a line precisely). */
  words?: OcrWord[]
}

export interface FaceBox {
  box: Box
  confidence?: number
}

export interface SafetyCategory {
  category: string
  flagged: boolean
  /** 0–1 where the provider gives one. */
  score?: number
}

/** A field of a custom structured answer (same shape as agent output variables). */
export interface AnswerField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description?: string
}

export type ImageFeature = 'description' | 'labels' | 'objects' | 'text' | 'faces' | 'safety'

export interface AnalyzeImageOptions {
  features: ImageFeature[]
  /** A question / instruction (answered in `answer`). */
  prompt?: string
  /** With a prompt: answer as an object with these fields. */
  fields?: AnswerField[]
  model?: string
  /** Max labels / objects returned. */
  maxResults?: number
  language?: string
}

export interface ImageAnalysis {
  description?: string
  labels: ImageLabel[]
  objects: ImageLabel[]
  /** All text found, in reading order, lines joined by \n. */
  text: string
  ocr: OcrLine[]
  faces: FaceBox[]
  safety: SafetyCategory[]
  /** The answer to `prompt` (object when `fields` were given). */
  answer?: unknown
  width?: number
  height?: number
  provider: MediaProviderId
  model?: string
  usage?: MediaUsage
}

/* ── Video ─────────────────────────────────────────────────────────── */

export type VideoFeature = 'summary' | 'scenes' | 'labels' | 'text'

export interface AnalyzeVideoOptions {
  features: VideoFeature[]
  prompt?: string
  fields?: AnswerField[]
  model?: string
  language?: string
}

export interface VideoScene {
  start: number
  end: number
  title?: string
  description: string
}

export interface VideoAnalysis {
  summary?: string
  scenes: VideoScene[]
  labels: Array<ImageLabel & { times?: number[] }>
  /** On-screen text with when it is visible. */
  text: Array<{ text: string; start?: number; end?: number }>
  answer?: unknown
  duration?: number
  provider: MediaProviderId
  model?: string
  usage?: MediaUsage
}

/* ── Generation / speech ───────────────────────────────────────────── */

export interface GenerateImageOptions {
  prompt: string
  model?: string
  /** "1024x1024", "1536x1024", "auto", or an aspect ratio "16:9" (Stability). */
  size?: string
  quality?: string
  count?: number
  format?: 'png' | 'jpeg' | 'webp'
  negativePrompt?: string
}

export interface EditImageOptions extends GenerateImageOptions {
  image: MediaBlob
  /** Transparent pixels = the area to change (PNG). */
  mask?: MediaBlob
}

export interface GeneratedImage {
  bytes: Uint8Array
  mime_type: string
  revised_prompt?: string
}

export interface GenerateImageResult {
  images: GeneratedImage[]
  provider: MediaProviderId
  model?: string
  usage?: MediaUsage
}

export type SpeechFormat = 'mp3' | 'wav' | 'opus' | 'aac' | 'flac' | 'pcm'

export interface SpeechOptions {
  text: string
  voice?: string
  model?: string
  format?: SpeechFormat
  /** 0.25–4 (OpenAI), 0.7–1.2 (ElevenLabs). */
  speed?: number
  language?: string
  /** Style instructions (gpt-4o-mini-tts). */
  instructions?: string
}

export interface SpeechResult {
  bytes: Uint8Array
  mime_type: string
  format: SpeechFormat
  provider: MediaProviderId
  model?: string
  voice?: string
  usage?: MediaUsage
}

/* ── The provider interface ────────────────────────────────────────── */

export interface MediaProvider {
  id: MediaProviderId
  label: string
  capabilities: readonly MediaCapability[]
  /** Largest upload the provider accepts for transcription in one request (bytes); above it the caller chunks. */
  maxTranscribeBytes?: number
  /** Largest image the provider accepts (bytes); the caller downsizes / re-encodes above it. */
  maxImageBytes?: number
  transcribe?(input: MediaBlob, options: TranscribeOptions, ctx: MediaProviderContext): Promise<MaybeAsync<TranscriptResult>>
  analyzeImage?(input: MediaBlob, options: AnalyzeImageOptions, ctx: MediaProviderContext): Promise<ImageAnalysis>
  /** Several frames of one video at once (frame-sampled video analysis; times in seconds). */
  analyzeFrames?(frames: Array<MediaBlob & { time: number }>, options: AnalyzeVideoOptions, ctx: MediaProviderContext): Promise<VideoAnalysis>
  analyzeVideo?(input: MediaBlob, options: AnalyzeVideoOptions, ctx: MediaProviderContext): Promise<MaybeAsync<VideoAnalysis>>
  generateImage?(options: GenerateImageOptions, ctx: MediaProviderContext): Promise<GenerateImageResult>
  editImage?(options: EditImageOptions, ctx: MediaProviderContext): Promise<GenerateImageResult>
  speak?(options: SpeechOptions, ctx: MediaProviderContext): Promise<SpeechResult>
  /** Poll an async job returned by transcribe / analyzeVideo. */
  poll?(job: MediaAsyncJob, ctx: MediaProviderContext): Promise<PollResult<TranscriptResult | VideoAnalysis>>
  /** Clean up after an async job (staged S3 objects, uploaded files). Best effort. */
  cleanup?(job: MediaAsyncJob, ctx: MediaProviderContext): Promise<void>
}

/** A provider error with a message safe to show (never a key, signature or the media). */
export class MediaProviderError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message)
    this.name = 'MediaProviderError'
  }
}

/** A local tool (ffmpeg) is not available on this deployment. */
export class MediaToolUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaToolUnavailableError'
  }
}

/** Instance or node limit exceeded (size, duration, pixels, time). */
export class MediaLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaLimitError'
  }
}
