/**
 * The Agent's dictation (microphone → text): settings and pure helpers
 * (client-safe, no I/O). The browser side is lib/assistants/dictation-client.ts
 * and components/assistants/dictation-button.tsx; the server side
 * lib/assistants/transcribe.ts and /api/assistants/transcribe.
 *
 * Settings live in assistant_settings.capabilities.dictation (no migration):
 *   enabled         on by default (absent = on);
 *   engine          'browser'  the browser's own speech recognition (Web
 *                              Speech API — free; Chrome sends the audio to
 *                              Google's speech service, Safari to Apple's);
 *                   'provider' record in the browser and transcribe with the
 *                              workspace's transcription provider;
 *                   'auto'     the browser's when it has one, else the provider;
 *                   absent = 'browser';
 *   language        '' = the person's browser language; else a BCP-47 tag;
 *   integration_id  the media connection (Integrations) that transcribes;
 *                   null = the Agent's own connection when it is OpenAI;
 *   auto_send       send the message when dictation ends (default off: the
 *                   text stays in the box to edit).
 */

export const DICTATION_ENGINES = ['browser', 'provider', 'auto'] as const
export type DictationEngine = (typeof DICTATION_ENGINES)[number]

export interface DictationSettings {
  enabled: boolean
  engine: DictationEngine
  /** '' = auto (the person's browser language), else a BCP-47 tag (en-US, de, pt-BR, …). */
  language: string
  /** The media connection that transcribes (engine provider / auto); null = the Agent's own connection when it is OpenAI. */
  integration_id: string | null
  /** Send the message as soon as dictation ends (default off). */
  auto_send: boolean
}

export const DEFAULT_DICTATION: DictationSettings = { enabled: true, engine: 'browser', language: '', integration_id: null, auto_send: false }

export const DICTATION_ENGINE_LABELS: Record<DictationEngine, string> = {
  browser: 'Browser speech recognition',
  provider: 'Transcription provider',
  auto: 'Automatic (browser first, provider as fallback)',
}

/** Languages offered in Settings → Agent (any BCP-47 tag is accepted). */
export const DICTATION_LANGUAGES: Array<[string, string]> = [
  ['', 'Automatic (the person\'s browser language)'],
  ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-AU', 'English (Australia)'], ['en-NZ', 'English (New Zealand)'],
  ['de-DE', 'German'], ['fr-FR', 'French'], ['es-ES', 'Spanish'], ['it-IT', 'Italian'], ['pt-BR', 'Portuguese (Brazil)'],
  ['nl-NL', 'Dutch'], ['sv-SE', 'Swedish'], ['da-DK', 'Danish'], ['nb-NO', 'Norwegian'], ['fi-FI', 'Finnish'], ['pl-PL', 'Polish'],
  ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'], ['zh-CN', 'Chinese (Mandarin)'], ['hi-IN', 'Hindi'], ['ar-SA', 'Arabic'], ['mi-NZ', 'Māori'],
]

const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/

export function normalizeLanguage(value: unknown): string {
  const s = String(value ?? '').trim()
  return LANG_RE.test(s) ? s : ''
}

/** The stored value (or absent) as dictation settings. Absent = on, browser. */
export function normalizeDictation(raw: unknown): DictationSettings {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const id = typeof r.integration_id === 'string' ? r.integration_id.trim() : ''
  return {
    enabled: r.enabled !== false,
    engine: DICTATION_ENGINES.includes(r.engine as DictationEngine) ? r.engine as DictationEngine : 'browser',
    language: normalizeLanguage(r.language),
    integration_id: id && id.length <= 100 ? id : null,
    auto_send: r.auto_send === true,
  }
}

/** What the Agent panel learns (Agent availability): no ids, no keys. */
export interface ClientDictation {
  engine: DictationEngine
  language: string
  /** A transcription provider is configured (engine provider / auto can record). */
  provider: boolean
  auto_send: boolean
}

export function clientDictation(settings: DictationSettings, providerReady: boolean): ClientDictation | null {
  if (!settings.enabled) return null
  return { engine: settings.engine, language: settings.language, provider: settings.engine !== 'browser' && providerReady, auto_send: settings.auto_send }
}

/* ── The browser: which engine ── */

export interface DictationSupport {
  /** SpeechRecognition / webkitSpeechRecognition exists (and the page is a secure context). */
  speech: boolean
  /** MediaRecorder + getUserMedia exist (and the page is a secure context). */
  recorder: boolean
}

/* eslint-disable @typescript-eslint/no-explicit-any -- feature detection on an unknown global */
export function detectDictationSupport(w: any = typeof window !== 'undefined' ? window : undefined): DictationSupport {
  if (!w || w.isSecureContext === false) return { speech: false, recorder: false }
  return {
    speech: typeof w.SpeechRecognition === 'function' || typeof w.webkitSpeechRecognition === 'function',
    recorder: typeof w.MediaRecorder === 'function' && typeof w.navigator?.mediaDevices?.getUserMedia === 'function',
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type DictationMode = 'browser' | 'provider'

/** The engine this browser uses, or null (the mic shows disabled with a reason). */
export function pickDictationEngine(config: ClientDictation | null | undefined, support: DictationSupport): DictationMode | null {
  if (!config) return null
  const provider = config.provider && support.recorder
  if (config.engine === 'provider') return provider ? 'provider' : null
  if (support.speech) return 'browser'
  return config.engine === 'auto' && provider ? 'provider' : null
}

/** Why the mic can't be used here (tooltip of the disabled button). */
export function unsupportedReason(config: ClientDictation, support: DictationSupport): string {
  if (config.engine === 'provider') {
    if (!config.provider) return 'Dictation needs a transcription provider — an admin can pick one in Settings → Agent'
    return 'This browser can\'t record audio'
  }
  return 'This browser has no speech recognition — try Chrome, Edge or Safari'
}

/** The recognition language: the setting, else the browser's language, else en-US. */
export function dictationLanguage(setting: string, browserLanguage?: string | null): string {
  return normalizeLanguage(setting) || normalizeLanguage(browserLanguage) || 'en-US'
}

/** ISO-639-1 part of a tag for transcription providers ('' = let the provider detect). */
export function providerLanguage(tag: string): string {
  const primary = normalizeLanguage(tag).split('-')[0]?.toLowerCase() ?? ''
  return /^[a-z]{2}$/.test(primary) ? primary : ''
}

/* ── Transcript into the input box ── */

/**
 * The input box while dictating: what was typed before the mic started, then
 * the final text so far, then the interim (still changing) words.
 */
export function composeDictation(base: string, finals: string, interim = ''): string {
  const spoken = [finals.trim(), interim.trim()].filter(Boolean).join(' ')
  if (!spoken) return base
  if (!base.trim()) return spoken
  return /\s$/.test(base) ? `${base}${spoken}` : `${base} ${spoken}`
}

/** A SpeechRecognitionResultList (or a test double) → final and interim text. */
export function readRecognitionResults(results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>): { finals: string; interim: string } {
  const finals: string[] = []
  const interim: string[] = []
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const text = String(r?.[0]?.transcript ?? '').trim()
    if (!text) continue
    ;(r.isFinal ? finals : interim).push(text)
  }
  return { finals: finals.join(' '), interim: interim.join(' ') }
}

/* ── Friendly errors ── */

/** A Web Speech API error code → a message for the person (null: nothing to say, e.g. they stopped it). */
export function speechErrorMessage(code: string): string | null {
  switch (code) {
    case 'aborted': return null
    case 'not-allowed': return 'Microphone access is blocked. Allow the microphone for this site in your browser\'s settings, then try again.'
    case 'service-not-allowed': return 'Speech recognition is turned off in this browser or device (on iPhone and iPad: Settings → Siri → turn on Siri or Dictation).'
    case 'no-speech': return 'Didn\'t hear anything. Tap the microphone and start speaking.'
    case 'audio-capture': return 'No microphone was found. Connect one and try again.'
    case 'network': return 'Speech recognition couldn\'t reach the browser\'s speech service. Check your connection and try again.'
    case 'language-not-supported': return 'Speech recognition doesn\'t support this language in this browser.'
    case 'bad-grammar': return 'Speech recognition failed. Try again.'
    default: return 'Speech recognition stopped unexpectedly. Try again.'
  }
}

/** A getUserMedia / MediaRecorder error → a message for the person. */
export function microphoneErrorMessage(error: unknown): string {
  const name = String((error as { name?: string })?.name ?? '')
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return speechErrorMessage('not-allowed')!
    case 'NotFoundError':
    case 'OverconstrainedError':
      return speechErrorMessage('audio-capture')!
    case 'NotReadableError':
      return 'The microphone is in use by another app. Close it and try again.'
    default:
      return 'The microphone couldn\'t be started. Try again.'
  }
}

/* ── Limits (the route checks them again) ── */

export const DICTATION_LIMITS = {
  /** Largest recording sent for transcription. */
  maxBytes: 10 * 1024 * 1024,
  /** Longest recording (the recorder stops itself). */
  maxSeconds: 120,
  /** Silence that ends a recording once speech was heard. */
  silenceMs: 2500,
  /** Browser recognition: no result for this long after the last one ends it (a pause stops it). */
  pauseMs: 4000,
  /** Recordings per person per minute. */
  perMinute: 12,
} as const

/** Audio types the route accepts (the recorder's own; parameters ignored). */
export const DICTATION_AUDIO_TYPES = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/aac', 'video/webm', 'video/mp4'] as const

export function isDictationAudioType(mime: string): boolean {
  const base = String(mime ?? '').split(';')[0].trim().toLowerCase()
  return (DICTATION_AUDIO_TYPES as readonly string[]).includes(base)
}

/** The file name a provider sees for a recording (extension from the type: some providers sniff by name). */
export function recordingFileName(mime: string): string {
  const base = String(mime ?? '').split(';')[0].trim().toLowerCase()
  const ext = base.endsWith('mp4') || base.endsWith('m4a') || base === 'audio/aac' ? 'm4a' : base.endsWith('ogg') ? 'ogg' : base.endsWith('mpeg') ? 'mp3' : base.endsWith('wav') ? 'wav' : 'webm'
  return `dictation.${ext}`
}
