'use client'

/**
 * Trusted-embedding pages (/embed/…, lib/embedding.ts) render without the
 * app shell. This provider stands in for the shell's pieces that extension
 * page controls use: action results show as an inline notice (no Jobs
 * toasts), and redirects stay inside /embed/ when the target page is
 * embeddable — otherwise they open in a new tab, because every other page
 * refuses to be framed.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'

export interface EmbedNotice { tone: 'success' | 'info' | 'error'; title: string; body?: string | null }

interface EmbedContextValue {
  notify(notice: EmbedNotice): void
  /** Follow an app path from inside the frame. */
  navigate(path: string, push: (href: string) => void): void
}

const EmbedContext = createContext<EmbedContextValue | null>(null)

export function useEmbedContext(): EmbedContextValue | null {
  return useContext(EmbedContext)
}

export function EmbedProvider({ embeddablePrefixes, children }: {
  /** /x/<id>/<path> prefixes that are embeddable (served at /embed/x/…). */
  embeddablePrefixes: string[]
  children: React.ReactNode
}) {
  const [notice, setNotice] = useState<EmbedNotice | null>(null)
  const notify = useCallback((n: EmbedNotice) => setNotice(n), [])
  const navigate = useCallback((path: string, push: (href: string) => void) => {
    const embeddable = embeddablePrefixes.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`))
    if (path.startsWith('/embed/')) push(path)
    else if (embeddable) push(`/embed${path}`)
    else window.open(path, '_blank', 'noopener')
  }, [embeddablePrefixes])
  const value = useMemo(() => ({ notify, navigate }), [notify, navigate])
  return (
    <EmbedContext value={value}>
      {notice ? (
        <div
          role="status"
          className={`mx-4 mt-4 rounded-md border px-3 py-2 text-sm ${notice.tone === 'error' ? 'border-destructive/40 bg-destructive/10' : notice.tone === 'success' ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-border bg-muted'}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">{notice.title}</div>
              {notice.body ? <div className="text-muted-foreground">{notice.body}</div> : null}
            </div>
            <button type="button" className="text-muted-foreground" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button>
          </div>
        </div>
      ) : null}
      {children}
    </EmbedContext>
  )
}
