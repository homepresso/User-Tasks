'use client'

import { useEffect, useRef } from 'react'
import type { ActionResult } from '@/lib/action-result'
import type { ButtonEffects } from '@/lib/forms/buttons'
import { HONEYPOT_FIELD, type CaptchaProvider } from '@/lib/forms/anonymous'

/**
 * The parts of a public form link (/p/<token>) that only anonymous visitors
 * have: the submit call to the public endpoint, the honeypot input and the
 * optional captcha widget (loaded only when an admin configured one).
 */

export async function submitAnonymous(token: string, input: {
  values: Record<string, unknown>; button_id: string; idempotency_key: string; ticket: string
  captcha: string | null; upload_key: string; honeypot: string
}): Promise<ActionResult<{ effects: ButtonEffects }> & { fields?: Record<string, string> }> {
  try {
    const res = await fetch(`/api/public/forms/${encodeURIComponent(token)}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({
        values: input.values, button_id: input.button_id, idempotency_key: input.idempotency_key, ticket: input.ticket,
        captcha: input.captcha, upload_key: input.upload_key, [HONEYPOT_FIELD]: input.honeypot || null,
      }),
    })
    const json = await res.json().catch(() => null) as { effects?: ButtonEffects; error?: string; fields?: Record<string, string> } | null
    if (!res.ok) {
      const error = res.status === 429 ? (json?.error ?? 'Too many submissions — wait a moment and try again') : res.status === 404 ? 'This form is no longer available.' : json?.error ?? 'Could not submit the form.'
      return { ok: false, error, ...(json?.fields ? { fields: json.fields } : {}) }
    }
    return { ok: true, data: { effects: json?.effects ?? { messages: [] } } }
  } catch {
    return { ok: false, error: 'Could not reach the server — check your connection and try again.' }
  }
}

/** An input people never see or reach (off-screen, not focusable, not announced); bots fill it in. */
export function AnonymousHoneypot({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
      <label>
        Leave this empty
        <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} data-honeypot />
      </label>
    </div>
  )
}

const SCRIPT: Record<CaptchaProvider, { src: string; global: 'turnstile' | 'hcaptcha' }> = {
  turnstile: { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', global: 'turnstile' },
  hcaptcha: { src: 'https://js.hcaptcha.com/1/api.js?render=explicit', global: 'hcaptcha' },
}

interface CaptchaApi { render: (el: HTMLElement, opts: Record<string, unknown>) => unknown; remove?: (id: unknown) => void }

/** Cloudflare Turnstile / hCaptcha (explicit rendering); the server verifies the answer. */
export function AnonymousCaptcha({ provider, siteKey, onToken }: { provider: CaptchaProvider; siteKey: string; onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const callback = useRef(onToken)
  useEffect(() => { callback.current = onToken })
  useEffect(() => {
    const spec = SCRIPT[provider]
    let widget: unknown = null
    let cancelled = false
    const render = () => {
      const api = (window as unknown as Record<string, CaptchaApi | undefined>)[spec.global]
      if (cancelled || !api || !box.current) return
      widget = api.render(box.current, {
        sitekey: siteKey,
        callback: (token: string) => callback.current(token),
        'expired-callback': () => callback.current(null),
        'error-callback': () => callback.current(null),
      })
    }
    if ((window as unknown as Record<string, unknown>)[spec.global]) render()
    else {
      let script = document.querySelector<HTMLScriptElement>(`script[data-captcha="${provider}"]`)
      if (!script) {
        script = document.createElement('script')
        script.src = spec.src
        script.async = true
        script.dataset.captcha = provider
        document.head.appendChild(script)
      }
      script.addEventListener('load', render)
    }
    return () => {
      cancelled = true
      const api = (window as unknown as Record<string, CaptchaApi | undefined>)[spec.global]
      if (widget !== null) try { api?.remove?.(widget) } catch { /* gone */ }
    }
  }, [provider, siteKey])
  return <div ref={box} className="mt-3" data-captcha-widget={provider} />
}
