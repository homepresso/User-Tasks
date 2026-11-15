'use client'

/**
 * Around the embedded form (/embed/f/<id>): the host's after-submit choice
 * (lib/embed/form-options.ts) — a thank-you message, a fresh form for the
 * next response, or another page in the top window — and hiding the form's
 * title. Listens to the form's own same-page event (StandaloneForm
 * notifyHost); the host page still gets `usertasks:form` as before.
 */

import { useEffect, useState } from 'react'
import { FORM_EVENT_MESSAGE_TYPE } from '@/lib/forms/embed'
import type { EmbedFormOptions } from '@/lib/embed/form-options'
import { Button } from '@/components/ui/button'

export function EmbedFormHost({ options, children }: { options: EmbedFormOptions; children: React.ReactNode }) {
  const [round, setRound] = useState(0)
  const [done, setDone] = useState<'message' | 'reset' | 'redirect' | null>(null)

  useEffect(() => {
    if (options.after === 'form') return
    const onEvent = (e: Event) => {
      if ((e as CustomEvent).detail !== 'submitted') return
      if (options.after === 'redirect' && options.redirectUrl) {
        try { (window.top ?? window).location.href = options.redirectUrl; return } catch { /* blocked: offer the link */ }
        setDone('redirect'); return
      }
      if (options.after === 'reset') { setRound((n) => n + 1); setDone('reset'); return }
      setDone('message')
    }
    window.addEventListener(FORM_EVENT_MESSAGE_TYPE, onEvent)
    return () => window.removeEventListener(FORM_EVENT_MESSAGE_TYPE, onEvent)
  }, [options])

  return (
    <div data-embed-form-host>
      {options.hideTitle && <style>{'[data-form-header]{display:none!important}'}</style>}
      {done === 'message' ? (
        <div className="flex flex-col items-start gap-3 rounded-md border border-border p-4 text-sm" role="status">
          <p className="text-fg">{options.doneText ?? 'Thank you — your response was sent.'}</p>
          <Button size="sm" variant="secondary" onClick={() => { setDone(null); setRound((n) => n + 1) }}>Submit another response</Button>
        </div>
      ) : done === 'redirect' && options.redirectUrl ? (
        <div className="flex flex-col items-start gap-3 rounded-md border border-border p-4 text-sm" role="status">
          <p className="text-fg">{options.doneText ?? 'Thank you — your response was sent.'}</p>
          <Button size="sm" asChild><a href={options.redirectUrl} target="_top">Continue</a></Button>
        </div>
      ) : (
        <>
          {done === 'reset' && <p className="mb-2 text-sm text-success" role="status">{options.doneText ?? 'Sent. You can fill in another one.'}</p>}
          <div key={round}>{children}</div>
        </>
      )}
    </div>
  )
}
