'use client'

/**
 * Automatic sign-in inside a trusted-embedding frame (lib/providers/auth/sso/
 * auto.ts) — e.g. the classic SharePoint dialog. Identity providers refuse to
 * be framed and their sign-in pages can't show here, so:
 *
 *  1. silent: a hidden frame runs the passive round trip
 *     (/auth/auto-sso?mode=frame → IdP → callback → /embed/auth/sso-done).
 *     It completes without any page when the IdP can sign the person in by
 *     itself (Windows sign-in, an IdP session), sets the session cookie and
 *     reports back; this page reloads, signed in;
 *  2. when it can't (the IdP needs interaction, the browser blocks the
 *     cookies, nothing answers within the time limit): a "Sign in" button
 *     opens a small popup — a top-level window where the IdP can show its
 *     page if it must, and which closes itself — then this page reloads;
 *  3. when the popup is blocked, or after a sign-in the frame still can't
 *     see (cookies in embedded windows blocked), Open UserTasks in a new tab.
 *
 * Browsers that block third-party cookies (verified on the lab: Edge sends
 * no SameSite=None cookie to a frame on SharePoint, block reason
 * "UserPreferences") can't hold a session in the frame at all, and the
 * silent attempt can't finish there either. Then the page first asks for
 * storage access (Storage Access API: one "Continue" click; granted when the
 * person has used UserTasks in a tab of this browser) and reloads; when the
 * browser refuses, the popup signs in top level, then "Continue" again.
 *
 * Messages are accepted from this origin only, from our own hidden frame or
 * popup, and carry no identity — just "signed in now: yes / no".
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export const SSO_MESSAGE_TYPE = 'usertasks:sso'
const SILENT_TIMEOUT_MS = 12_000
/** A reload after a reported success that still shows this page within this time: the frame can't keep the session. */
const RETRY_WINDOW_MS = 60_000
const ATTEMPT_KEY = 'usertasks:sso-attempt'

interface SsoMessage { type: typeof SSO_MESSAGE_TYPE; ok: boolean; error: string | null }

function isSsoMessage(data: unknown): data is SsoMessage {
  return Boolean(data && typeof data === 'object' && (data as SsoMessage).type === SSO_MESSAGE_TYPE && typeof (data as SsoMessage).ok === 'boolean')
}

const MESSAGES: Record<string, string> = {
  no_invite: 'You are not a member of this workspace. Ask an administrator to add you.',
  sso_failed: 'Single sign-on did not complete.',
  sso_unavailable: 'Single sign-on is not available right now.',
}

function readAttempt(): number {
  try { return Number(sessionStorage.getItem(ATTEMPT_KEY) ?? 0) || 0 } catch { return 0 }
}
function writeAttempt(value: number | null) {
  try { if (value === null) sessionStorage.removeItem(ATTEMPT_KEY); else sessionStorage.setItem(ATTEMPT_KEY, String(value)) } catch { /* storage blocked */ }
}

export function EmbedAutoSignIn({ idpName, silentUrl, popupUrl, newTabHref, reloadHref }: {
  idpName: string
  /** /auth/auto-sso?mode=frame&redirect=/embed/auth/sso-done… */
  silentUrl: string
  /** /auth/auto-sso?mode=popup&redirect=/embed/auth/sso-done… */
  popupUrl: string
  /** The sign-in page for this target, in a new tab. */
  newTabHref: string
  reloadHref: string
}) {
  const [phase, setPhase] = useState<'checking' | 'access' | 'silent' | 'interactive' | 'blocked'>('checking')
  const [error, setError] = useState<string | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const popupRef = useRef<Window | null>(null)
  /** Set when the popup was offered because storage access was refused: its success leads back to the access click. */
  const phaseRef = useRef<string>('')

  const succeeded = useCallback(() => {
    writeAttempt(Date.now())
    window.location.reload()
  }, [])

  // Browsers that block cookies in embedded windows (Safari, Edge / Chrome with third-party cookies off):
  // no session can live in this frame until the person lets it (Storage Access API, one click). Ask first.
  useEffect(() => {
    let cancelled = false
    const doc = document as Document & { hasStorageAccess?: () => Promise<boolean> }
    const check = doc.hasStorageAccess ? doc.hasStorageAccess().catch(() => true) : Promise.resolve(true)
    void check.then((has) => { if (!cancelled) setPhase((p) => (p === 'checking' ? (has ? 'silent' : 'access') : p)) })
    return () => { cancelled = true }
  }, [])

  const requestAccess = async () => {
    const doc = document as Document & { requestStorageAccess?: () => Promise<void> }
    try {
      await doc.requestStorageAccess?.()
      // Cookies now reach this frame: reload (signed in when the browser has a session; else the silent attempt runs).
      window.location.reload()
    } catch {
      // Refused (e.g. UserTasks never opened in a tab of this browser yet): sign in in a small window first.
      phaseRef.current = 'interactive-after-access'
      setPhase('interactive')
    }
  }

  useEffect(() => {
    if (phase !== 'silent') return
    // Back here right after a reported success: the frame didn't get the session.
    const last = readAttempt()
    if (last && Date.now() - last < RETRY_WINDOW_MS) {
      writeAttempt(null)
      setPhase('blocked')
      return
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !isSsoMessage(event.data)) return
      const fromFrame = frameRef.current && event.source === frameRef.current.contentWindow
      const fromPopup = popupRef.current && event.source === popupRef.current
      if (!fromFrame && !fromPopup) return
      if (event.data.ok) {
        // From the popup with cookies still blocked here: the click that grants storage access comes next.
        if (fromPopup && (document as Document & { requestStorageAccess?: unknown }).requestStorageAccess && phaseRef.current === 'interactive-after-access') { setPhase('access'); return }
        succeeded(); return
      }
      setError(event.data.error && MESSAGES[event.data.error] ? event.data.error : null)
      setPhase((p) => (p === 'silent' ? 'interactive' : p))
    }
    window.addEventListener('message', onMessage)
    const timer = window.setTimeout(() => setPhase((p) => (p === 'silent' ? 'interactive' : p)), SILENT_TIMEOUT_MS)
    return () => { window.removeEventListener('message', onMessage); window.clearTimeout(timer) }
  }, [succeeded, phase])

  const openPopup = () => {
    const w = 520, h = 680
    const left = Math.max(0, Math.round((window.screenX ?? 0) + ((window.outerWidth ?? w) - w) / 2))
    const top = Math.max(0, Math.round((window.screenY ?? 0) + ((window.outerHeight ?? h) - h) / 2))
    const popup = window.open(popupUrl, 'usertasks-sso', `popup=yes,width=${w},height=${h},left=${left},top=${top}`)
    if (!popup) { setPhase('blocked'); return }
    popupRef.current = popup
    // No message (the opener link was cut): when the popup closes, try once.
    const poll = window.setInterval(() => {
      if (!popup.closed) return
      window.clearInterval(poll)
      if (popupRef.current !== popup) return
      if (phaseRef.current === 'interactive-after-access') setPhase('access')
      else window.location.reload()
    }, 500)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center" data-sso-phase={phase}>
      {phase === 'checking' ? (
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" aria-hidden />
      ) : phase === 'access' ? (
        <>
          <h1 className="text-lg font-semibold">Continue to UserTasks</h1>
          <p className="text-sm text-muted-foreground">Your browser asks before UserTasks may use its sign-in inside this window.</p>
          <div className="flex gap-2">
            <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => { void requestAccess() }}>Continue</button>
            <a className="rounded-md border px-4 py-2 text-sm" href={newTabHref} target="_blank" rel="noopener">Open in a new tab</a>
          </div>
        </>
      ) : phase === 'silent' ? (
        <>
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" aria-hidden />
          <p className="text-sm text-muted-foreground" role="status">Signing you in with {idpName}…</p>
          {/* The passive round trip; nothing in it is shown. */}
          <iframe ref={frameRef} src={silentUrl} title="Sign-in" aria-hidden tabIndex={-1} style={{ display: 'none' }} />
        </>
      ) : phase === 'interactive' ? (
        <>
          <h1 className="text-lg font-semibold">Sign in to UserTasks</h1>
          <p className="text-sm text-muted-foreground">
            {error ? `${MESSAGES[error]} ` : ''}{idpName} needs you to confirm who you are. A small window opens and closes by itself when you are signed in.
          </p>
          <div className="flex gap-2">
            <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={openPopup}>Sign in with {idpName}</button>
            <a className="rounded-md border px-4 py-2 text-sm" href={newTabHref} target="_blank" rel="noopener">Open in a new tab</a>
          </div>
        </>
      ) : (
        <>
          <h1 className="text-lg font-semibold">Sign in to UserTasks</h1>
          <p className="text-sm text-muted-foreground">
            Your browser keeps this window from staying signed in (it blocks cookies in embedded windows, or popups). Open UserTasks in a new tab — you are signed in there — or allow cookies for this site and reload.
          </p>
          <div className="flex gap-2">
            <a className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" href={newTabHref} target="_blank" rel="noopener">Open UserTasks</a>
            <a className="rounded-md border px-4 py-2 text-sm" href={reloadHref}>Reload</a>
          </div>
        </>
      )}
    </main>
  )
}

/** /embed/auth/sso-done: report to the page that started the sign-in (same origin only), then close a popup. */
export function SsoDoneReporter({ ok, error }: { ok: boolean; error: string | null }) {
  const [standalone, setStandalone] = useState(false)
  useEffect(() => {
    const message: SsoMessage = { type: SSO_MESSAGE_TYPE, ok, error }
    const origin = window.location.origin
    let told = false
    if (window.opener && window.opener !== window) {
      try { (window.opener as Window).postMessage(message, origin); told = true } catch { /* cut */ }
      window.setTimeout(() => window.close(), ok ? 150 : 2500)
    } else if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, origin)
      told = true
    }
    if (!told) setStandalone(true)
  }, [ok, error])
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground" role="status">
        {ok ? 'You are signed in. This window closes by itself.' : 'Sign-in did not complete.'}
        {standalone ? (ok ? ' You can close it and go back.' : ' Close this window and try again.') : ''}
      </p>
    </main>
  )
}

/**
 * The signed-out state of a trusted-embedding page inside a frame
 * (/embed/…): sign-in pages are never framable, so the person signs in to
 * UserTasks in a new tab and comes back (or reloads). Server component.
 */
export function EmbedSignIn({ loginHref, reloadHref }: { loginHref: string; reloadHref: string }) {
  return (
    <main className="mx-auto flex min-h-[320px] max-w-md flex-col items-center justify-center gap-4 p-6 text-center" data-embed-signed-out>
      <h1 className="text-lg font-semibold">Sign in to UserTasks</h1>
      <p className="text-sm text-muted-foreground">
        Sign-in can&apos;t happen inside this window. Open UserTasks in a new tab, sign in there and carry on — or come back here and reload.
      </p>
      <div className="flex gap-2">
        <a className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" href={loginHref} target="_blank" rel="noopener">Open UserTasks</a>
        <a className="rounded-md border px-4 py-2 text-sm" href={reloadHref}>Reload</a>
      </div>
      <p className="text-xs text-muted-foreground">If you are signed in and still see this, your browser blocks cookies in embedded windows — use Open UserTasks.</p>
    </main>
  )
}
