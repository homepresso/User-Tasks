'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Mic, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import {
  detectDictationSupport, dictationLanguage, pickDictationEngine, unsupportedReason,
  type ClientDictation, type DictationMode,
} from '@/lib/assistants/dictation'
import {
  startBrowserDictation, startRecorderDictation, transcribeWithServer,
  type DictationSession, type DictationState,
} from '@/lib/assistants/dictation-client'

/**
 * Dictation (microphone → text) for a text box: the hook runs one session at
 * a time with the engine this browser and the workspace's settings allow
 * (lib/assistants/dictation.ts pickDictationEngine); DictationButton is the
 * mic toggle and DictationStatus the "Listening…" strip (aria-live) and the
 * error line. Used by the Agent panel; any textarea can reuse them.
 */

export type DictationPhase = 'idle' | DictationState

export function useDictation({ config, onText, onDone }: {
  config: ClientDictation | null | undefined
  /** The words so far (interim included) — called while listening. */
  onText: (spoken: { finals: string; interim: string }) => void
  /** Once, with the final text ('' when nothing was heard or it was cancelled). */
  onDone: (text: string) => void
}) {
  // Feature detection runs after mount (the server render has no window).
  const [mode, setMode] = useState<DictationMode | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [phase, setPhase] = useState<DictationPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const session = useRef<DictationSession | null>(null)
  const handlers = useRef({ onText, onDone })
  useEffect(() => { handlers.current = { onText, onDone } })

  useEffect(() => {
    const support = detectDictationSupport()
    const picked = pickDictationEngine(config, support)
    setMode(picked)
    setReason(config && !picked ? unsupportedReason(config, support) : null)
  }, [config])

  // The panel closed / the box went away: release the microphone.
  useEffect(() => () => { session.current?.abort(); session.current = null }, [])

  /** Must run in the click / key handler itself (iOS Safari opens the mic only in a user gesture). */
  const start = useCallback(() => {
    if (session.current || !config) return
    if (!mode) { setError(reason); return }
    setError(null)
    const language = dictationLanguage(config.language, typeof navigator !== 'undefined' ? navigator.language : null)
    const callbacks = {
      onState: (s: DictationState) => setPhase(s),
      onTranscript: (t: { finals: string; interim: string }) => handlers.current.onText(t),
      onEnd: ({ text, error: message }: { text: string; error: string | null }) => {
        session.current = null
        setPhase('idle')
        if (message) setError(message)
        handlers.current.onDone(text)
      },
    }
    session.current = mode === 'browser'
      ? startBrowserDictation({ language, callbacks })
      : startRecorderDictation({ callbacks, transcribe: (audio) => transcribeWithServer(audio, language) })
  }, [config, mode, reason])

  const stop = useCallback(() => { session.current?.stop() }, [])
  const toggle = useCallback(() => { if (session.current) session.current.stop(); else start() }, [start])

  return {
    /** Dictation is on for this workspace (the mic shows; it may still be unsupported here). */
    enabled: Boolean(config),
    mode, reason, phase, error, start, stop, toggle,
    clearError: () => setError(null),
    active: phase !== 'idle',
  }
}

export type DictationControl = ReturnType<typeof useDictation>

/** Ctrl / ⌘ + Shift + Space toggles dictation (bind on the container that holds the box). */
export function isDictationShortcut(e: { key: string; code?: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return (e.code === 'Space' || e.key === ' ') && e.shiftKey && (e.ctrlKey || e.metaKey) && !e.altKey
}

export function DictationButton({ control, disabled, className }: { control: DictationControl; disabled?: boolean; className?: string }) {
  if (!control.enabled) return null
  const listening = control.phase === 'listening' || control.phase === 'starting'
  const transcribing = control.phase === 'transcribing'
  const unsupported = !control.mode
  const label = transcribing ? 'Transcribing…' : listening ? 'Stop dictation' : unsupported ? (control.reason ?? 'Dictation isn\'t available in this browser') : 'Dictate'
  return (
    <IconButton
      label={label}
      kbd={unsupported || transcribing ? undefined : 'Ctrl ⇧ Space'}
      icon={transcribing ? <Loader2 className="animate-spin" /> : <Mic />}
      variant={listening ? 'danger' : 'ghost'}
      // Not `disabled` when unsupported: the tooltip and a click still say why.
      aria-disabled={unsupported || undefined}
      aria-pressed={listening}
      disabled={disabled || transcribing}
      type="button"
      onClick={control.toggle}
      className={cn('min-h-10 min-w-10', listening && 'motion-safe:animate-pulse ring-2 ring-danger/40', unsupported && 'opacity-50', className)}
      data-testid="agent-dictate"
      data-dictation-state={control.phase}
      data-dictation-engine={control.mode ?? 'none'}
    />
  )
}

/** The recording strip ("Listening…", announced politely) and the last error. */
export function DictationStatus({ control }: { control: DictationControl }) {
  if (!control.enabled) return null
  const listening = control.phase === 'listening' || control.phase === 'starting'
  return (
    <>
      <p role="status" aria-live="polite" className={cn('flex items-center gap-1.5 text-2xs', control.active ? 'mb-1.5' : 'sr-only')} data-testid="agent-dictation-status">
        {listening && (
          <>
            <span className="relative flex size-2" aria-hidden="true">
              <span className="absolute inline-flex size-full rounded-full bg-danger opacity-75 motion-safe:animate-ping" />
              <span className="relative inline-flex size-2 rounded-full bg-danger" />
            </span>
            <span className="font-medium text-fg">{control.phase === 'starting' ? 'Starting the microphone…' : 'Listening…'}</span>
            <span className="text-fg-muted">{control.mode === 'provider' ? 'pause or tap the mic to finish' : 'pause or tap the mic to stop'}</span>
          </>
        )}
        {control.phase === 'transcribing' && <><Loader2 className="size-3 animate-spin" aria-hidden="true" /><span className="text-fg-muted">Transcribing…</span></>}
      </p>
      {control.error && (
        <p role="alert" className="mb-1.5 flex items-start gap-1.5 rounded-md border border-danger px-2 py-1 text-2xs text-danger" data-testid="agent-dictation-error">
          <span className="min-w-0 flex-1">{control.error}</span>
          <button type="button" onClick={control.clearError} className="shrink-0 rounded-sm text-danger hover:opacity-80" aria-label="Dismiss"><X className="size-3" /></button>
        </p>
      )}
    </>
  )
}
