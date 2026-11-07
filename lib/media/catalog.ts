/**
 * Media providers and steps — the catalogue (client-safe).
 *
 * One table drives the designer (which integrations a step can use), the
 * credential loader (integration type → provider), the docs capability
 * matrix and the tests that check every provider module implements exactly
 * what is listed here (__tests__/media-providers-*.test.ts).
 */

import type { MediaCapability, MediaProviderId } from './types'

export interface MediaProviderInfo {
  id: MediaProviderId
  label: string
  /** Integration types (connector keys) that reach this provider. */
  integrationTypes: string[]
  capabilities: MediaCapability[]
  /** Default models per operation (shown as placeholders). */
  defaults: Partial<Record<'transcribe' | 'vision' | 'video' | 'image' | 'tts', string>>
  /** Where the API key comes from (docs). */
  keyFrom: string
  /** Short notes for the capability matrix (limits, approximations). */
  notes?: string
}

export const MEDIA_PROVIDERS: MediaProviderInfo[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    integrationTypes: ['openai'],
    capabilities: ['transcribe', 'analyze_image', 'moderation', 'generate_image', 'edit_image', 'tts'],
    defaults: { transcribe: 'whisper-1', vision: 'gpt-4.1-mini', video: 'gpt-4.1-mini', image: 'gpt-image-2', tts: 'gpt-4o-mini-tts' },
    keyFrom: 'platform.openai.com → API keys',
    notes: 'Transcription uploads up to 25 MB per request (longer media is split into chunks). Timed segments with whisper-1 (the default); speaker labels switch to gpt-4o-transcribe-diarize; gpt-4o-transcribe / gpt-4o-mini-transcribe return text without timings. No face or text boxes (redaction needs a provider with boxes). Video is analysed from sampled frames.',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    integrationTypes: ['google_gemini', 'gemini'],
    capabilities: ['transcribe', 'analyze_image', 'detect_faces', 'detect_objects', 'ocr', 'analyze_video'],
    defaults: { transcribe: 'gemini-3.8-flash', vision: 'gemini-3.8-flash', video: 'gemini-3.8-flash' },
    keyFrom: 'aistudio.google.com → Get API key',
    notes: 'Understands whole videos (summary, scenes with timestamps). Face, object and text boxes are located by the model (approximate) — check redactions before relying on them.',
  },
  {
    id: 'azure_speech',
    label: 'Azure AI Speech',
    integrationTypes: ['azure_speech'],
    capabilities: ['transcribe', 'tts'],
    defaults: { tts: 'en-US-AvaMultilingualNeural' },
    keyFrom: 'Azure portal → your Speech (or AI services) resource → Keys and Endpoint',
    notes: 'Fast transcription API (synchronous; diarisation, word timings). Files under 500 MB / 5 hours.',
  },
  {
    id: 'azure_vision',
    label: 'Azure AI Vision',
    integrationTypes: ['azure_ai_vision'],
    capabilities: ['analyze_image', 'ocr', 'detect_objects', 'detect_faces'],
    defaults: {},
    keyFrom: 'Azure portal → your Computer Vision (or AI services) resource → Keys and Endpoint',
    notes: 'Image Analysis 4.0 (caption, tags, objects, Read OCR with word boxes). Face boxes use the Face API detection on the same resource (detection only — no identification). Caption is available in some regions only.',
  },
  {
    id: 'aws',
    label: 'AWS (Transcribe + Rekognition)',
    integrationTypes: ['aws_media'],
    capabilities: ['transcribe', 'analyze_image', 'detect_faces', 'detect_objects', 'ocr', 'moderation'],
    defaults: {},
    keyFrom: 'AWS IAM → an access key for a user / role allowed transcribe:*TranscriptionJob, rekognition:Detect*, and s3:PutObject / GetObject / DeleteObject on the staging bucket',
    notes: 'Transcribe runs as an asynchronous job: media is staged in your S3 bucket and deleted afterwards. Rekognition images up to 5 MB (larger images are downsized).',
  },
  {
    id: 'deepgram',
    label: 'Deepgram',
    integrationTypes: ['deepgram'],
    capabilities: ['transcribe', 'tts'],
    defaults: { transcribe: 'nova-3', tts: 'aura-2-thalia-en' },
    keyFrom: 'console.deepgram.com → API Keys',
    notes: 'Synchronous pre-recorded transcription with diarisation and word timings.',
  },
  {
    id: 'assemblyai',
    label: 'AssemblyAI',
    integrationTypes: ['assemblyai'],
    capabilities: ['transcribe'],
    defaults: { transcribe: 'universal-3-5-pro' },
    keyFrom: 'assemblyai.com/dashboard → API Keys',
    notes: 'Asynchronous: upload, then the step polls (long recordings run in the background).',
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    integrationTypes: ['elevenlabs'],
    capabilities: ['transcribe', 'tts'],
    defaults: { transcribe: 'scribe_v2', tts: 'eleven_multilingual_v2' },
    keyFrom: 'elevenlabs.io → Profile → API keys',
  },
  {
    id: 'stability',
    label: 'Stability AI',
    integrationTypes: ['stability_ai'],
    capabilities: ['generate_image', 'edit_image'],
    defaults: { image: 'core' },
    keyFrom: 'platform.stability.ai → API keys',
  },
]

export const MEDIA_PROVIDER_BY_ID: Record<MediaProviderId, MediaProviderInfo> = Object.fromEntries(MEDIA_PROVIDERS.map((p) => [p.id, p])) as Record<MediaProviderId, MediaProviderInfo>

/** Provider for an integration type (connector key), or null. */
export function mediaProviderForType(type: string | null | undefined): MediaProviderInfo | null {
  const t = String(type ?? '').toLowerCase()
  return MEDIA_PROVIDERS.find((p) => p.integrationTypes.includes(t)) ?? null
}

/* ── Steps ─────────────────────────────────────────────────────────── */

export const MEDIA_NODE_TYPES = [
  'media_transcribe',
  'media_analyze_image',
  'media_analyze_video',
  'media_redact_image',
  'media_redact_video',
  'media_generate_image',
  'media_tts',
  'media_tools',
] as const

export type MediaNodeType = (typeof MEDIA_NODE_TYPES)[number]

export function isMediaNodeType(type: string): type is MediaNodeType {
  return (MEDIA_NODE_TYPES as readonly string[]).includes(type)
}

/** Steps that may run in the background (long media, provider jobs). */
export const MEDIA_BACKGROUND_NODE_TYPES: readonly MediaNodeType[] = ['media_transcribe', 'media_analyze_video', 'media_redact_video', 'media_tools']

/**
 * The capabilities a step needs from its provider (any one of a group).
 * Redact video needs face / object / text boxes from frames; its audio
 * redaction needs transcription (its own `transcribe_integration_id`).
 */
export const NODE_CAPABILITIES: Record<MediaNodeType, MediaCapability[]> = {
  media_transcribe: ['transcribe'],
  media_analyze_image: ['analyze_image', 'ocr', 'detect_faces', 'detect_objects', 'moderation'],
  media_analyze_video: ['analyze_video', 'analyze_image'],
  media_redact_image: ['detect_faces', 'ocr', 'detect_objects'],
  media_redact_video: ['detect_faces', 'ocr', 'detect_objects'],
  media_generate_image: ['generate_image', 'edit_image'],
  media_tts: ['tts'],
  media_tools: [],
}

/** Does this provider support any of the step's capabilities? */
export function providerSupportsNode(provider: MediaProviderInfo, nodeType: MediaNodeType): boolean {
  const needed = NODE_CAPABILITIES[nodeType]
  return needed.length === 0 || needed.some((c) => provider.capabilities.includes(c))
}

/** Capability → column label (docs capability matrix and the /media page). */
export const MEDIA_CAPABILITY_LABELS: Array<[MediaCapability, string]> = [
  ['transcribe', 'Transcribe'],
  ['analyze_image', 'Describe / label images'],
  ['ocr', 'Text with positions'],
  ['detect_faces', 'Face boxes'],
  ['detect_objects', 'Object boxes'],
  ['moderation', 'Safety'],
  ['analyze_video', 'Whole video'],
  ['generate_image', 'Generate images'],
  ['edit_image', 'Edit images'],
  ['tts', 'Text to speech'],
]

/** Step labels as the designer palette shows them. */
export const MEDIA_STEP_LABELS: Record<MediaNodeType, string> = {
  media_transcribe: 'Transcribe Audio / Video',
  media_analyze_image: 'Analyze Image',
  media_analyze_video: 'Analyze Video',
  media_redact_image: 'Redact Image',
  media_redact_video: 'Redact Video',
  media_generate_image: 'Generate / Edit Image',
  media_tts: 'Text to Speech',
  media_tools: 'Media Utilities',
}

/** Image features → the capability that provides them with boxes / scores. */
export const IMAGE_FEATURES = [
  { id: 'description', label: 'Description', capability: 'analyze_image' },
  { id: 'labels', label: 'Labels', capability: 'analyze_image' },
  { id: 'objects', label: 'Objects (boxes)', capability: 'detect_objects' },
  { id: 'text', label: 'Text (OCR)', capability: 'ocr' },
  { id: 'faces', label: 'Faces (boxes only)', capability: 'detect_faces' },
  { id: 'safety', label: 'Safety', capability: 'moderation' },
] as const

export const VIDEO_FEATURES = [
  { id: 'summary', label: 'Summary' },
  { id: 'scenes', label: 'Scenes / chapters' },
  { id: 'labels', label: 'Labels' },
  { id: 'text', label: 'On-screen text' },
] as const

/** What Redact image / video can find. */
export const REDACT_TARGETS = [
  { id: 'faces', label: 'Faces', capability: 'detect_faces' },
  { id: 'text_pii', label: 'Sensitive text (ID numbers, card numbers, …)', capability: 'ocr' },
  { id: 'plates', label: 'License plates', capability: 'detect_objects' },
  { id: 'custom', label: 'Boxes from earlier steps', capability: null },
] as const

export const REDACT_STYLES = ['blur', 'pixelate', 'box'] as const
export type MediaRedactStyle = (typeof REDACT_STYLES)[number]

export const TRANSCRIPT_FORMATS = ['srt', 'vtt', 'txt', 'json'] as const
export type TranscriptFormat = (typeof TRANSCRIPT_FORMATS)[number]

export const MEDIA_TOOL_OPERATIONS = [
  { id: 'info', label: 'Get media info' },
  { id: 'extract_audio', label: 'Extract audio' },
  { id: 'frames', label: 'Extract frames' },
  { id: 'thumbnail', label: 'Thumbnail' },
  { id: 'trim', label: 'Trim' },
  { id: 'convert', label: 'Convert format' },
  { id: 'compress', label: 'Compress' },
  { id: 'burn_subtitles', label: 'Burn in subtitles' },
] as const

export type MediaToolOperation = (typeof MEDIA_TOOL_OPERATIONS)[number]['id']

export const AUDIO_FORMATS = ['mp3', 'wav', 'm4a', 'ogg', 'flac'] as const
export const VIDEO_FORMATS = ['mp4', 'webm', 'mov', 'gif'] as const
export const IMAGE_FORMATS = ['png', 'jpeg', 'webp'] as const
