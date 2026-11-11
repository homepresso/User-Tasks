/**
 * The Agent's dictation: settings (back-compat: absent = on, browser) and
 * their round-trip, engine choice from feature detection, interim / final
 * transcript handling with a SpeechRecognition double, friendly errors
 * (permission denied, no speech), the recorder engine, the transcribe route
 * (auth, size cap, type, availability gate) and service (provider HTTP
 * mocked, audio never stored), and the microphone Permissions-Policy.
 */
import { randomBytes } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DICTATION, clientDictation, composeDictation, detectDictationSupport, dictationLanguage, isDictationAudioType,
  microphoneErrorMessage, normalizeDictation, pickDictationEngine, providerLanguage, readRecognitionResults, recordingFileName,
  speechErrorMessage, type ClientDictation,
} from '@/lib/assistants/dictation'
import { startBrowserDictation, startRecorderDictation, pickRecorderMime, transcribeWithServer } from '@/lib/assistants/dictation-client'
import { mergeAgentSettings, normalizeAgentSettings, storedAgentSettings } from '@/lib/assistants/config'
import { normalizeRow } from '@/lib/assistants/settings'
import { transcriptionConfigured, transcribeRecording } from '@/lib/assistants/transcribe'
import { encryptSecret, installEncryptionKey } from '@/lib/secret-crypto'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ── Settings ── */

describe('dictation settings', () => {
  it('absent (every row saved before dictation) = on, browser speech recognition, auto language, no auto-send', () => {
    expect(normalizeDictation(undefined)).toEqual(DEFAULT_DICTATION)
    expect(DEFAULT_DICTATION).toEqual({ enabled: true, engine: 'browser', language: '', integration_id: null, auto_send: false })
    expect(normalizeAgentSettings({ version: 3, enabled: true }).dictation).toEqual(DEFAULT_DICTATION)
    expect(normalizeAgentSettings({}).dictation).toEqual(DEFAULT_DICTATION)
    // A first-release (three capability) row too.
    expect(normalizeAgentSettings({ form: { enabled: true } }).dictation).toEqual(DEFAULT_DICTATION)
  })

  it('bad values fall back; only real language tags are kept', () => {
    expect(normalizeDictation({ enabled: 'no', engine: 'cloud', language: 'english!!', integration_id: 42, auto_send: 'yes' }))
      .toEqual({ enabled: true, engine: 'browser', language: '', integration_id: null, auto_send: false })
    expect(normalizeDictation({ language: 'pt-BR' }).language).toBe('pt-BR')
    expect(normalizeDictation({ language: 'de' }).language).toBe('de')
  })

  it('round-trips through save (merge → stored → read back), and a partial patch keeps the rest', () => {
    const current = normalizeAgentSettings({ version: 3, enabled: true })
    const merged = mergeAgentSettings(current, { dictation: { engine: 'auto', integration_id: 'int-1', language: 'en-NZ' } })
    expect(merged.dictation).toEqual({ enabled: true, engine: 'auto', language: 'en-NZ', integration_id: 'int-1', auto_send: false })
    const stored = storedAgentSettings(merged)
    expect(stored.dictation).toEqual(merged.dictation)
    // What the settings row reads back from the capabilities column.
    const row = normalizeRow({ tenant_id: 't', provider: 'openai', model: '', capabilities: JSON.parse(JSON.stringify(stored)), limits: {} })!
    expect(row.agent.dictation).toEqual(merged.dictation)
    const off = mergeAgentSettings(row.agent, { dictation: { enabled: false } })
    expect(off.dictation).toEqual({ ...merged.dictation, enabled: false })
    // Other settings are untouched by a dictation patch.
    expect(off.enabled).toBe(true)
  })

  it('the panel learns engine / language / provider readiness only — never the connection id; off → null', () => {
    const s = normalizeDictation({ engine: 'provider', integration_id: 'secret-int' })
    expect(clientDictation(s, true)).toEqual({ engine: 'provider', language: '', provider: true, auto_send: false })
    expect(JSON.stringify(clientDictation(s, true))).not.toContain('secret-int')
    expect(clientDictation(normalizeDictation({ engine: 'browser' }), true)?.provider).toBe(false)
    expect(clientDictation(normalizeDictation({ enabled: false }), true)).toBeNull()
  })

  it('a transcription provider is configured by a chosen connection, the Agent\'s OpenAI key, or its media-capable connection', () => {
    const row = (over: any) => normalizeRow({ tenant_id: 't', provider: 'openai', model: '', capabilities: {}, limits: {}, ...over })!
    expect(transcriptionConfigured(null)).toBe(false)
    expect(transcriptionConfigured(row({ api_key: 'enc:v1:x' }))).toBe(true)
    expect(transcriptionConfigured(row({ provider: 'anthropic', api_key: 'enc:v1:x' }))).toBe(false)
    expect(transcriptionConfigured(row({ provider: 'anthropic', api_key: 'enc:v1:x', capabilities: { dictation: { integration_id: 'dg' } } }))).toBe(true)
    expect(transcriptionConfigured(row({ key_source: 'integration', integration_id: 'i1' }), 'openai')).toBe(true)
    expect(transcriptionConfigured(row({ key_source: 'integration', integration_id: 'i1' }), 'claude')).toBe(false)
  })
})

/* ── Engine choice ── */

describe('feature detection picks the engine', () => {
  const config = (over: Partial<ClientDictation> = {}): ClientDictation => ({ engine: 'browser', language: '', provider: false, auto_send: false, ...over })
  const chrome = { isSecureContext: true, webkitSpeechRecognition: function () {}, MediaRecorder: function () {}, navigator: { mediaDevices: { getUserMedia: () => {} } } }
  const firefox = { isSecureContext: true, MediaRecorder: function () {}, navigator: { mediaDevices: { getUserMedia: () => {} } } }

  it('detects SpeechRecognition / webkitSpeechRecognition and MediaRecorder; nothing outside a secure context or on the server', () => {
    expect(detectDictationSupport(chrome)).toEqual({ speech: true, recorder: true })
    expect(detectDictationSupport({ ...firefox, SpeechRecognition: function () {} })).toEqual({ speech: true, recorder: true })
    expect(detectDictationSupport(firefox)).toEqual({ speech: false, recorder: true })
    expect(detectDictationSupport({ ...chrome, isSecureContext: false })).toEqual({ speech: false, recorder: false })
    expect(detectDictationSupport(undefined)).toEqual({ speech: false, recorder: false })
  })

  it('browser: speech when the browser has it, else none (no silent fallback to a provider)', () => {
    expect(pickDictationEngine(config(), detectDictationSupport(chrome))).toBe('browser')
    expect(pickDictationEngine(config({ provider: true }), detectDictationSupport(firefox))).toBeNull()
  })
  it('provider: the recorder when a provider is configured and the browser records', () => {
    expect(pickDictationEngine(config({ engine: 'provider', provider: true }), detectDictationSupport(chrome))).toBe('provider')
    expect(pickDictationEngine(config({ engine: 'provider', provider: false }), detectDictationSupport(chrome))).toBeNull()
    expect(pickDictationEngine(config({ engine: 'provider', provider: true }), { speech: true, recorder: false })).toBeNull()
  })
  it('auto: browser first, provider as the fallback (Firefox)', () => {
    expect(pickDictationEngine(config({ engine: 'auto', provider: true }), detectDictationSupport(chrome))).toBe('browser')
    expect(pickDictationEngine(config({ engine: 'auto', provider: true }), detectDictationSupport(firefox))).toBe('provider')
    expect(pickDictationEngine(config({ engine: 'auto', provider: false }), detectDictationSupport(firefox))).toBeNull()
  })
  it('dictation off → no engine', () => {
    expect(pickDictationEngine(null, detectDictationSupport(chrome))).toBeNull()
  })

  it('language: the setting, else the browser language, else en-US; providers get the ISO-639-1 part', () => {
    expect(dictationLanguage('de-DE', 'en-NZ')).toBe('de-DE')
    expect(dictationLanguage('', 'en-NZ')).toBe('en-NZ')
    expect(dictationLanguage('', null)).toBe('en-US')
    expect(providerLanguage('pt-BR')).toBe('pt')
    expect(providerLanguage('')).toBe('')
  })

  it('the recorder type: webm/opus where supported, mp4 on Safari', () => {
    expect(pickRecorderMime({ isTypeSupported: (t: string) => t.startsWith('audio/webm') })).toBe('audio/webm;codecs=opus')
    expect(pickRecorderMime({ isTypeSupported: (t: string) => t === 'audio/mp4' })).toBe('audio/mp4')
    expect(pickRecorderMime({})).toBe('')
    expect(recordingFileName('audio/mp4')).toBe('dictation.m4a')
    expect(recordingFileName('audio/webm;codecs=opus')).toBe('dictation.webm')
  })
})

/* ── Transcript into the box ── */

describe('interim and final text', () => {
  it('appends to what was typed, with one space', () => {
    expect(composeDictation('', 'hello world')).toBe('hello world')
    expect(composeDictation('Make a form', 'with three fields', 'and a')).toBe('Make a form with three fields and a')
    expect(composeDictation('Line one\n', 'two')).toBe('Line one\ntwo')
    expect(composeDictation('kept', '', '')).toBe('kept')
  })
  it('reads a recognition result list: finals in order, interim last', () => {
    const list = [
      Object.assign([{ transcript: 'build a' }], { isFinal: true }),
      Object.assign([{ transcript: ' leave form ' }], { isFinal: true }),
      Object.assign([{ transcript: 'for managers' }], { isFinal: false }),
    ]
    expect(readRecognitionResults(list)).toEqual({ finals: 'build a leave form', interim: 'for managers' })
  })
})

/* ── The browser engine with a SpeechRecognition double ── */

class FakeRecognition {
  static last: FakeRecognition | null = null
  lang = ''; continuous = false; interimResults = false; maxAlternatives = 0
  started = false; stopped = false; aborted = false
  onstart: any; onresult: any; onerror: any; onend: any
  constructor() { FakeRecognition.last = this }
  start() { this.started = true; queueMicrotask(() => this.onstart?.()) }
  stop() { this.stopped = true; queueMicrotask(() => this.onend?.()) }
  abort() { this.aborted = true; queueMicrotask(() => this.onend?.()) }
  emit(results: Array<[string, boolean]>) {
    this.onresult?.({ results: results.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) })
  }
}

function recorderCallbacks() {
  const states: string[] = []
  const transcripts: Array<{ finals: string; interim: string }> = []
  let ended: { text: string; error: string | null } | null = null
  return {
    states, transcripts, get ended() { return ended },
    callbacks: { onState: (s: string) => states.push(s), onTranscript: (t: any) => transcripts.push(t), onEnd: (r: any) => { ended = r } },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('browser speech recognition session', () => {
  afterEach(() => { vi.useRealTimers() })

  it('streams interim then final text, keeps it on stop; continuous, interim results, the language set', async () => {
    const cb = recorderCallbacks()
    const session = startBrowserDictation({ language: 'en-NZ', callbacks: cb.callbacks as any, win: { webkitSpeechRecognition: FakeRecognition, navigator: { userAgent: 'Mac' } } })
    const rec = FakeRecognition.last!
    expect(rec).toMatchObject({ lang: 'en-NZ', continuous: true, interimResults: true, started: true })
    await tick()
    expect(cb.states).toEqual(['starting', 'listening'])
    rec.emit([['make a', false]])
    rec.emit([['make a form', true], ['with', false]])
    expect(cb.transcripts).toEqual([{ finals: '', interim: 'make a' }, { finals: 'make a form', interim: 'with' }])
    session.stop()
    await tick()
    // Safari may not settle the last words on stop: they are kept.
    expect(cb.ended).toEqual({ text: 'make a form with', error: null })
  })

  it('a pause ends it (no new words for pauseMs)', async () => {
    vi.useFakeTimers()
    const cb = recorderCallbacks()
    startBrowserDictation({ language: 'en-US', callbacks: cb.callbacks as any, win: { SpeechRecognition: FakeRecognition }, pauseMs: 1000 })
    const rec = FakeRecognition.last!
    await vi.advanceTimersByTimeAsync(0)
    rec.emit([['hello', true]])
    await vi.advanceTimersByTimeAsync(999)
    expect(rec.stopped).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(rec.stopped).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(cb.ended).toEqual({ text: 'hello', error: null })
  })

  it('Android: one utterance (continuous mode repeats words there)', () => {
    startBrowserDictation({ language: 'en-US', callbacks: recorderCallbacks().callbacks as any, win: { SpeechRecognition: FakeRecognition, navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14)' } } })
    expect(FakeRecognition.last!.continuous).toBe(false)
  })

  it('permission denied → a friendly message, no text', async () => {
    const cb = recorderCallbacks()
    startBrowserDictation({ language: 'en-US', callbacks: cb.callbacks as any, win: { SpeechRecognition: FakeRecognition } })
    const rec = FakeRecognition.last!
    rec.onerror({ error: 'not-allowed' })
    rec.onend()
    expect(cb.ended).toEqual({ text: '', error: speechErrorMessage('not-allowed') })
    expect(cb.ended!.error).toMatch(/Microphone access is blocked/)
  })

  it('"no speech" with nothing heard is reported; after some words it is just the end', async () => {
    const a = recorderCallbacks()
    startBrowserDictation({ language: 'en-US', callbacks: a.callbacks as any, win: { SpeechRecognition: FakeRecognition } })
    FakeRecognition.last!.onerror({ error: 'no-speech' }); FakeRecognition.last!.onend()
    expect(a.ended!.error).toMatch(/Didn't hear anything/)
    const b = recorderCallbacks()
    startBrowserDictation({ language: 'en-US', callbacks: b.callbacks as any, win: { SpeechRecognition: FakeRecognition } })
    FakeRecognition.last!.emit([['done', true]]); FakeRecognition.last!.onerror({ error: 'no-speech' }); FakeRecognition.last!.onend()
    expect(b.ended).toEqual({ text: 'done', error: null })
  })

  it('network / audio-capture / service-not-allowed have their own messages; aborted says nothing', () => {
    expect(speechErrorMessage('network')).toMatch(/speech service/)
    expect(speechErrorMessage('audio-capture')).toMatch(/No microphone/)
    expect(speechErrorMessage('service-not-allowed')).toMatch(/Siri/)
    expect(speechErrorMessage('aborted')).toBeNull()
    expect(microphoneErrorMessage({ name: 'NotAllowedError' })).toMatch(/blocked/)
    expect(microphoneErrorMessage({ name: 'NotReadableError' })).toMatch(/in use/)
  })

  it('abort (panel closed) drops the text and reports no error', async () => {
    const cb = recorderCallbacks()
    const s = startBrowserDictation({ language: 'en-US', callbacks: cb.callbacks as any, win: { SpeechRecognition: FakeRecognition } })
    FakeRecognition.last!.emit([['half a sentence', false]])
    s.abort()
    expect(FakeRecognition.last!.aborted).toBe(true)
    expect(cb.ended).toEqual({ text: '', error: null })
  })

  it('start() throwing (e.g. already started) ends with a message instead of hanging', async () => {
    class Throws extends FakeRecognition { start() { throw Object.assign(new Error('x'), { name: 'InvalidStateError' }) } }
    const cb = recorderCallbacks()
    startBrowserDictation({ language: 'en-US', callbacks: cb.callbacks as any, win: { SpeechRecognition: Throws } })
    await tick()
    expect(cb.ended?.text).toBe('')
    expect(cb.ended?.error).toBeTruthy()
  })
})

/* ── The recorder engine ── */

class FakeMediaRecorder {
  static isTypeSupported = (t: string) => t === 'audio/webm;codecs=opus'
  state = 'inactive'
  mimeType: string
  ondataavailable: any; onstop: any
  constructor(public stream: any, opts?: { mimeType?: string }) { this.mimeType = opts?.mimeType ?? '' }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)], { type: this.mimeType }) })
    this.onstop?.()
  }
}

describe('recorder session (transcription provider)', () => {
  const trackStops: number[] = []
  const stream = { getTracks: () => [{ stop: () => trackStops.push(1) }] }
  const win = (gum: () => Promise<any>) => ({ navigator: { mediaDevices: { getUserMedia: gum } }, MediaRecorder: FakeMediaRecorder, Blob })

  it('records webm/opus, sends it on stop, puts the text in, releases the microphone', async () => {
    const cb = recorderCallbacks()
    const sent: Blob[] = []
    const s = startRecorderDictation({ callbacks: cb.callbacks as any, win: win(async () => stream), transcribe: async (b) => { sent.push(b); return ' Approve the leave request ' } })
    await tick()
    expect(cb.states).toEqual(['starting', 'listening'])
    s.stop()
    await tick()
    expect(cb.states).toEqual(['starting', 'listening', 'transcribing'])
    expect(sent[0].type).toBe('audio/webm;codecs=opus')
    expect(sent[0].size).toBe(2048)
    expect(cb.ended).toEqual({ text: 'Approve the leave request', error: null })
    expect(cb.transcripts).toEqual([{ finals: 'Approve the leave request', interim: '' }])
    expect(trackStops.length).toBeGreaterThan(0)
  })

  it('microphone permission denied → the friendly message, nothing sent', async () => {
    const cb = recorderCallbacks()
    const transcribe = vi.fn()
    startRecorderDictation({ callbacks: cb.callbacks as any, win: win(async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }) }), transcribe })
    await tick()
    expect(cb.ended?.error).toMatch(/Microphone access is blocked/)
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('a transcription error shows its message; a too-large recording is refused before sending', async () => {
    const a = recorderCallbacks()
    const s = startRecorderDictation({ callbacks: a.callbacks as any, win: win(async () => stream), transcribe: async () => { throw new Error('Too many recordings — wait a moment') } })
    await tick(); s.stop(); await tick()
    expect(a.ended).toEqual({ text: '', error: 'Too many recordings — wait a moment' })
    const b = recorderCallbacks()
    const transcribe = vi.fn()
    const s2 = startRecorderDictation({ callbacks: b.callbacks as any, win: win(async () => stream), transcribe, maxBytes: 1000 })
    await tick(); s2.stop(); await tick()
    expect(transcribe).not.toHaveBeenCalled()
    expect(b.ended?.error).toMatch(/too long/)
  })

  it('transcribeWithServer posts the raw audio with its type and the language, and surfaces the server\'s error', async () => {
    const calls: any[] = []
    const ok = (async (url: string, init: any) => { calls.push({ url, init }); return new Response(JSON.stringify({ text: 'hi' }), { status: 200 }) }) as any
    expect(await transcribeWithServer(new Blob(['x'], { type: 'audio/mp4' }), 'en-NZ', ok)).toBe('hi')
    expect(calls[0].url).toBe('/api/assistants/transcribe?language=en-NZ')
    expect(calls[0].init.headers['Content-Type']).toBe('audio/mp4')
    const bad = (async () => new Response(JSON.stringify({ error: 'Dictation is turned off for the Agent' }), { status: 403 })) as any
    await expect(transcribeWithServer(new Blob(['x'], { type: 'audio/webm' }), '', bad)).rejects.toThrow('Dictation is turned off')
  })
})

/* ── The server ── */

describe('transcribeRecording (provider HTTP mocked)', () => {
  it('OpenAI: multipart to /v1/audio/transcriptions with the language; text trimmed; priced when the usage has a price', async () => {
    const seen: any[] = []
    const { mediaProviderForType } = await import('@/lib/media/catalog')
    vi.doMock('@/lib/integrations/http', () => ({ connectorFetch: (url: string, init: any, o: any) => o.fetchImpl(url, init) }))
    const fetchImpl = (async (url: string, init: any) => {
      seen.push({ url, init })
      return new Response(JSON.stringify({ text: '  Build a leave form  ', duration: 6, segments: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as any
    const out = await transcribeRecording(
      { provider: mediaProviderForType('openai')!, credentials: { provider: 'openai', integrationId: 'assistant', baseUrl: 'https://api.openai.com', apiKey: 'sk-test', extra: {} } },
      { name: 'dictation.webm', mime_type: 'audio/webm', bytes: new Uint8Array(100) },
      { language: 'en', fetchImpl },
    )
    vi.doUnmock('@/lib/integrations/http')
    expect(out.text).toBe('Build a leave form')
    expect(seen[0].url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(seen[0].init.headers.Authorization).toBe('Bearer sk-test')
    const form = seen[0].init.body as FormData
    expect(form.get('language')).toBe('en')
    expect(form.get('file')).toBeTruthy()
  })

  it('an async provider job is polled to the result and cleaned up', async () => {
    const { mediaProviderForType } = await import('@/lib/media/catalog')
    const cleanup = vi.fn(async () => {})
    let polls = 0
    const impl: any = {
      transcribe: async () => ({ async: true, provider: 'assemblyai', operation: 'transcribe', job: { id: 'j' }, pollAfterMs: 1 }),
      poll: async () => (++polls < 2 ? { done: false, pollAfterMs: 1 } : { done: true, result: { text: 'done', segments: [], provider: 'assemblyai' } }),
      cleanup,
    }
    const out = await transcribeRecording({ provider: mediaProviderForType('assemblyai')!, credentials: { provider: 'assemblyai', integrationId: 'i', baseUrl: 'https://api.assemblyai.com', apiKey: 'k', extra: {} } },
      { name: 'd.webm', mime_type: 'audio/webm', bytes: new Uint8Array(1) }, { impl })
    expect(out.text).toBe('done')
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})

/* A minimal PostgREST-ish client for the service (select / eq / maybeSingle). */
function fakeDb(seed: Record<string, any[]>) {
  const from = (table: string) => {
    const filters: Array<(r: any) => boolean> = []
    let single = false
    const run = () => {
      const rows = (seed[table] ?? []).filter((r) => filters.every((f) => f(r)))
      return { data: single ? rows[0] ?? null : rows, error: null }
    }
    const api: any = {
      select: () => api, eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return api }, in: (c: string, v: any[]) => { filters.push((r) => v.includes(r[c])); return api },
      order: () => api, limit: () => api, gte: () => api,
      maybeSingle: () => { single = true; return Promise.resolve(run()) },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    }
    return api
  }
  return { from } as any
}

describe('transcribeDictation (service): the availability gate', () => {
  const KEY = randomBytes(32).toString('base64')
  beforeAll(() => installEncryptionKey(KEY))
  // After vi.resetModules the fresh secret-crypto needs the key again.
  const freshServices = async () => {
    vi.resetModules()
    vi.doMock('@/lib/integrations/http', () => ({ connectorFetch: (url: string, init: any, o: any) => o.fetchImpl(url, init) }))
    ;(await import('@/lib/secret-crypto')).installEncryptionKey(KEY)
    return import('@/lib/services/assistants')
  }
  const T = 'tenant-1'
  const ctx = (db: any, perms = ['forms.submit']): ServiceContext => ({ db, supabase: db, tenantId: T, actorId: 'u1', permissions: new Set(perms), authKind: 'api_key', source: 'api' } as any)
  const row = (capabilities: any, over: any = {}) => ({ tenant_id: T, provider: 'openai', key_source: 'key', api_key: encryptSecret('sk-live-test'), key_last4: 'test', model: '', capabilities, limits: {}, ...over })
  const audio = { bytes: new Uint8Array(64), mime_type: 'audio/webm;codecs=opus' }

  it('no Agent for the person → forbidden; dictation off → forbidden; browser engine → the provider is not used', async () => {
    const { transcribeDictation } = await import('@/lib/services/assistants')
    await expect(transcribeDictation(ctx(fakeDb({})), audio, '')).rejects.toMatchObject({ status: 403 })
    await expect(transcribeDictation(ctx(fakeDb({ assistant_settings: [row({ version: 3, enabled: false, dictation: { engine: 'provider' } })] })), audio, '')).rejects.toMatchObject({ status: 403 })
    await expect(transcribeDictation(ctx(fakeDb({ assistant_settings: [row({ version: 3, enabled: true, dictation: { enabled: false, engine: 'provider' } })] })), audio, '')).rejects.toThrow(/turned off/)
    await expect(transcribeDictation(ctx(fakeDb({ assistant_settings: [row({ version: 3, enabled: true })] })), audio, '')).rejects.toThrow(/does not use a transcription provider/)
    // Restricted to a role the person doesn't hold.
    await expect(transcribeDictation(ctx(fakeDb({ assistant_settings: [row({ version: 3, enabled: true, roles: ['r-admin'], dictation: { engine: 'provider' } })] })), audio, '')).rejects.toMatchObject({ status: 403 })
  })

  it('provider engine with the Agent\'s OpenAI key → Whisper on the same key; the admin\'s language wins', async () => {
    const seen: any[] = []
    const { transcribeDictation } = await freshServices()
    const fetchImpl = (async (url: string, init: any) => { seen.push({ url, init }); return new Response(JSON.stringify({ text: 'Kia ora', segments: [] }), { status: 200 }) }) as any
    const db = fakeDb({ assistant_settings: [row({ version: 3, enabled: true, dictation: { engine: 'provider', language: 'mi-NZ' } })] })
    expect(await transcribeDictation(ctx(db), audio, 'en-US', fetchImpl)).toEqual({ text: 'Kia ora' })
    expect(seen[0].url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(seen[0].init.headers.Authorization).toBe('Bearer sk-live-test')
    expect((seen[0].init.body as FormData).get('language')).toBe('mi')
    expect(((seen[0].init.body as FormData).get('file') as File).name).toBe('dictation.webm')
    vi.doUnmock('@/lib/integrations/http')
  })

  it('a provider error is reported as such (502), not as a crash', async () => {
    const { transcribeDictation } = await freshServices()
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: 'Invalid file format' } }), { status: 400 })) as any
    const db = fakeDb({ assistant_settings: [row({ version: 3, enabled: true, dictation: { engine: 'auto' } })] })
    await expect(transcribeDictation(ctx(db), audio, '', fetchImpl)).rejects.toMatchObject({ status: 502 })
    vi.doUnmock('@/lib/integrations/http')
  })
})

describe('POST /api/assistants/transcribe', () => {
  const load = async (opts: { user?: any; result?: any; error?: (ctx: any) => any; limited?: boolean } = {}) => {
    vi.resetModules()
    vi.doMock('@/lib/supabase/server', () => ({ getCachedUser: async () => (opts.user === undefined ? { id: 'u1' } : opts.user) }))
    vi.doMock('@/lib/services/context', async (orig) => ({ ...(await orig() as any), fromSession: async () => ({ tenantId: 't1', actorId: 'u1', permissions: new Set() }) }))
    const calls: any[] = []
    vi.doMock('@/lib/services/assistants', () => ({ transcribeDictation: async (...args: any[]) => { calls.push(args); if (opts.error) throw opts.error(await import('@/lib/services/context')); return opts.result ?? { text: 'hello' } } }))
    vi.doMock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ ok: !opts.limited }) }))
    const { POST } = await import('@/app/api/assistants/transcribe/route')
    return { POST, calls }
  }
  const req = (body: BodyInit | null, headers: Record<string, string> = { 'content-type': 'audio/webm;codecs=opus' }, url = 'http://x/api/assistants/transcribe?language=en-NZ') => {
    const r = new Request(url, { method: 'POST', body, headers, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) } as any) as any
    r.nextUrl = new URL(url)
    return r
  }
  afterEach(() => { for (const m of ['@/lib/supabase/server', '@/lib/services/context', '@/lib/services/assistants', '@/lib/rate-limit']) vi.doUnmock(m) })

  it('signed out → 401 (nothing read)', async () => {
    const { POST, calls } = await load({ user: null })
    expect((await POST(req(new Uint8Array(10)))).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('over 10 MB → 413, by Content-Length or by the bytes actually sent', async () => {
    const { POST, calls } = await load()
    expect((await POST(req(new Uint8Array(10), { 'content-type': 'audio/webm', 'content-length': String(11 * 1024 * 1024) }))).status).toBe(413)
    const big = new ReadableStream({ start(c) { for (let i = 0; i < 11; i++) c.enqueue(new Uint8Array(1024 * 1024)); c.close() } })
    expect((await POST(req(big))).status).toBe(413)
    expect(calls).toHaveLength(0)
  })

  it('not audio → 415; empty → 400; too many → 429', async () => {
    expect((await (await load()).POST(req(new Uint8Array(10), { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await (await load()).POST(req(new Uint8Array(0)))).status).toBe(400)
    expect((await (await load({ limited: true })).POST(req(new Uint8Array(10)))).status).toBe(429)
    expect(isDictationAudioType('audio/mp4')).toBe(true)
    expect(isDictationAudioType('application/octet-stream')).toBe(false)
  })

  it('the availability gate\'s answer passes through (403); success returns only { text }, no-store', async () => {
    const denied = await load({ error: (m) => m.ServiceError.forbidden('The Agent is not available to you') })
    const r403 = await denied.POST(req(new Uint8Array(10)))
    expect(r403.status).toBe(403)
    expect((await r403.json()).error).toMatch(/not available/)
    const { POST, calls } = await load({ result: { text: 'hello there' } })
    const ok = await POST(req(new Uint8Array([1, 2, 3])))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ text: 'hello there' })
    expect(ok.headers.get('cache-control')).toBe('no-store')
    expect(calls[0][1].mime_type).toBe('audio/webm;codecs=opus')
    expect(Array.from(calls[0][1].bytes)).toEqual([1, 2, 3])
    expect(calls[0][2]).toBe('en-NZ')
  })
})

/* ── Permissions-Policy ── */

describe('Permissions-Policy', () => {
  it('the app allows the microphone for its own origin only; embedded form pages and control frames allow none', async () => {
    const config = (await import('@/next.config')).default
    const rules = await config.headers!()
    const policy = (source: string) => rules.find((r) => r.source === source)?.headers.find((h) => h.key === 'Permissions-Policy')?.value
    const general = rules.find((r) => r.source.startsWith('/((?!'))!
    const app = general.headers.find((h) => h.key === 'Permissions-Policy')!.value
    expect(app).toContain('microphone=(self)')
    expect(app).toContain('camera=()')
    expect(app).not.toMatch(/microphone=\*|microphone=\(\s*\*/)
    for (const source of ['/f/:path*', '/form/:path*', '/p/:path*', '/form-login', '/form-controls/frame/:path*']) {
      expect(policy(source), source).toContain('microphone=()')
    }
  })
})
