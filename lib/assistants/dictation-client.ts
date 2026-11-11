/**
 * The Agent's dictation in the browser: one listening session with either
 * engine (lib/assistants/dictation.ts has the settings and the pure helpers).
 *
 *  - startBrowserDictation  the Web Speech API (SpeechRecognition /
 *    webkitSpeechRecognition): continuous, interim results, stops itself
 *    after a pause (no new words for DICTATION_LIMITS.pauseMs);
 *  - startRecorderDictation MediaRecorder (webm/opus, or mp4 on Safari) →
 *    the caller's transcribe() (POST /api/assistants/transcribe); stops on
 *    silence (an AnalyserNode, when the browser has Web Audio), at the
 *    length cap, or when asked.
 *
 * Both must be started from the click / key handler itself (no await before
 * them): iOS Safari only opens the microphone in a user gesture. No React
 * here, so tests drive them with test doubles of the browser APIs.
 */
import { DICTATION_LIMITS, microphoneErrorMessage, readRecognitionResults, speechErrorMessage } from './dictation'

/* eslint-disable @typescript-eslint/no-explicit-any -- browser APIs not in every lib.dom (webkitSpeechRecognition) */

export type DictationState = 'starting' | 'listening' | 'transcribing'

export interface DictationCallbacks {
  onState(state: DictationState): void
  /** The words so far: final (settled) and interim (may still change). */
  onTranscript(text: { finals: string; interim: string }): void
  /** Once, when the session is over: the text to keep, and a message for the person (null: none). */
  onEnd(result: { text: string; error: string | null }): void
}

export interface DictationSession {
  /** Stop listening and keep what was heard (the recorder then transcribes). */
  stop(): void
  /** Stop and drop everything (the panel closed). */
  abort(): void
}

/** Speech recognition: the first `firstMs` wait for speech, then a pause of `pauseMs` ends it. */
export function startBrowserDictation(options: {
  language: string
  callbacks: DictationCallbacks
  win?: any
  pauseMs?: number
  firstMs?: number
}): DictationSession {
  const win = options.win ?? window
  const { callbacks } = options
  const Ctor = win.SpeechRecognition ?? win.webkitSpeechRecognition
  let finals = ''
  let interim = ''
  let error: string | null = null
  let ended = false
  let aborted = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = () => { if (timer) { clearTimeout(timer); timer = null } }
  const finish = () => {
    if (ended) return
    ended = true
    clear()
    // Safari doesn't always settle the last words on stop: keep them.
    const text = aborted ? '' : [finals, interim].filter(Boolean).join(' ').trim()
    callbacks.onEnd({ text, error: aborted ? null : error })
  }

  let rec: any
  try {
    rec = new Ctor()
  } catch {
    error = speechErrorMessage('unknown')
    queueMicrotask(finish)
    return { stop() {}, abort() {} }
  }
  const arm = (ms: number) => { clear(); timer = setTimeout(() => { try { rec.stop() } catch { finish() } }, ms) }
  rec.lang = options.language
  // Chrome on Android repeats words in continuous mode: one utterance there.
  rec.continuous = !/Android/i.test(String(win.navigator?.userAgent ?? ''))
  rec.interimResults = true
  rec.maxAlternatives = 1
  rec.onstart = () => { callbacks.onState('listening'); arm(options.firstMs ?? 8000) }
  rec.onresult = (event: any) => {
    const r = readRecognitionResults(event.results)
    finals = r.finals
    interim = r.interim
    callbacks.onTranscript({ finals, interim })
    arm(options.pauseMs ?? DICTATION_LIMITS.pauseMs)
  }
  rec.onerror = (event: any) => {
    const message = speechErrorMessage(String(event?.error ?? ''))
    // "No speech" after some words were heard is just the end.
    if (message && !(event?.error === 'no-speech' && (finals || interim))) error = message
  }
  rec.onend = finish
  callbacks.onState('starting')
  try {
    rec.start()
  } catch (e) {
    error = microphoneErrorMessage(e)
    queueMicrotask(finish)
  }
  return {
    stop() { if (!ended) { try { rec.stop() } catch { finish() } } },
    abort() { aborted = true; if (!ended) { try { rec.abort() } catch { /* ended */ } finish() } },
  }
}

/** The recorder's type: webm/opus (Chrome, Edge, Firefox), mp4 (Safari), else the browser's default. */
export function pickRecorderMime(MediaRecorderCtor: any): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  if (typeof MediaRecorderCtor?.isTypeSupported !== 'function') return ''
  return candidates.find((c) => { try { return MediaRecorderCtor.isTypeSupported(c) } catch { return false } }) ?? ''
}

/** Recording for a transcription provider. */
export function startRecorderDictation(options: {
  callbacks: DictationCallbacks
  /** Sends the recording, answers its text (throws with a message for the person). */
  transcribe: (audio: Blob) => Promise<string>
  win?: any
  maxSeconds?: number
  silenceMs?: number
  maxBytes?: number
}): DictationSession {
  const win = options.win ?? window
  const { callbacks } = options
  const maxBytes = options.maxBytes ?? DICTATION_LIMITS.maxBytes
  const silenceMs = options.silenceMs ?? DICTATION_LIMITS.silenceMs
  let ended = false
  let aborted = false
  let stopRequested = false
  let recorder: any = null
  let stream: any = null
  let audioCtx: any = null
  const timers: Array<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>> = []
  const cleanup = () => {
    for (const t of timers) { clearTimeout(t as any); clearInterval(t as any) }
    try { stream?.getTracks?.().forEach((t: any) => t.stop()) } catch { /* gone */ }
    try { audioCtx?.close?.() } catch { /* gone */ }
  }
  const finish = (text: string, error: string | null) => {
    if (ended) return
    ended = true
    cleanup()
    callbacks.onEnd({ text: aborted ? '' : text, error: aborted ? null : error })
  }
  let silentStart: string | null = null
  const stopRecorder = () => {
    stopRequested = true
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop() } catch { finish('', null) } }
  }

  callbacks.onState('starting')
  let gum: Promise<any>
  try {
    gum = win.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
  } catch (e) {
    gum = Promise.reject(e)
  }
  gum.then((s) => {
    stream = s
    // Stopped / closed while the permission prompt was open: release the microphone at once.
    if (aborted || stopRequested || ended) { cleanup(); finish('', null); return }
    const mime = pickRecorderMime(win.MediaRecorder)
    recorder = new win.MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : undefined)
    const chunks: Blob[] = []
    let size = 0
    recorder.ondataavailable = (e: any) => {
      if (!e?.data?.size) return
      chunks.push(e.data)
      size += e.data.size
      if (size > maxBytes) stopRecorder()
    }
    recorder.onstop = () => {
      cleanup()
      if (aborted) { finish('', null); return }
      if (silentStart) { finish('', silentStart); return }
      const type = String(recorder.mimeType || mime || 'audio/webm')
      const blob = new win.Blob(chunks, { type })
      if (!blob.size) { finish('', speechErrorMessage('no-speech')); return }
      if (blob.size > maxBytes) { finish('', `The recording is too long (at most about ${Math.round(DICTATION_LIMITS.maxSeconds / 60)} minutes). Try a shorter one.`); return }
      callbacks.onState('transcribing')
      options.transcribe(blob).then(
        (text) => { const t = String(text ?? '').trim(); if (t) callbacks.onTranscript({ finals: t, interim: '' }); finish(t, t ? null : speechErrorMessage('no-speech')) },
        (e) => finish('', String(e?.message || 'The recording could not be transcribed. Try again.')),
      )
    }
    recorder.start(1000)
    callbacks.onState('listening')
    timers.push(setTimeout(stopRecorder, (options.maxSeconds ?? DICTATION_LIMITS.maxSeconds) * 1000))
    watchSilence()
  }, (e) => finish('', microphoneErrorMessage(e)))

  /** Stop after `silenceMs` of quiet once speech was heard; nothing heard in 10 s ends it too. */
  function watchSilence() {
    const AC = win.AudioContext ?? win.webkitAudioContext
    if (typeof AC !== 'function') return
    try {
      audioCtx = new AC()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      const buf = new Uint8Array(analyser.fftSize)
      const started = Date.now()
      let heard = false
      let lastLoud = started
      timers.push(setInterval(() => {
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
        const rms = Math.sqrt(sum / buf.length)
        const now = Date.now()
        if (rms > 0.03) { heard = true; lastLoud = now }
        if (heard && now - lastLoud > silenceMs) stopRecorder()
        else if (!heard && now - started > 10_000) { silentStart = speechErrorMessage('no-speech'); stopRecorder() }
      }, 200))
    } catch { /* no Web Audio: the person stops it, or the length cap does */ }
  }

  return {
    stop: stopRecorder,
    abort() { aborted = true; if (recorder && recorder.state !== 'inactive') { try { recorder.stop() } catch { /* gone */ } } finish('', null) },
  }
}

/** POST a recording to /api/assistants/transcribe → its text. */
export async function transcribeWithServer(audio: Blob, language: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`/api/assistants/transcribe${language ? `?language=${encodeURIComponent(language)}` : ''}`, {
    method: 'POST', body: audio, headers: { 'Content-Type': audio.type || 'audio/webm' }, credentials: 'same-origin',
  })
  const json = await res.json().catch(() => null) as { text?: string; error?: string } | null
  if (!res.ok) throw new Error(json?.error || 'The recording could not be transcribed. Try again.')
  return String(json?.text ?? '')
}
