'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** The language of a code well (`shell`, `json`, `ts` …) as a small mono tag. */
export function LanguageTag({ lang }: { lang?: string }) {
  if (!lang) return null
  return <span className="rounded bg-(color:--mkt-white)/[0.08] px-1.5 py-0.5 font-mono text-2xs text-(color:--mkt-faint)">{lang}</span>
}

/** Copies `text` to the clipboard; used on docs and marketing code blocks. */
export function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : 'Copy to clipboard'}
      data-copy-button=""
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1800)
        }).catch(() => { /* clipboard blocked: nothing to confirm */ })
      }}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-(color:--mkt-faint) transition hover:bg-(color:--mkt-white)/10 hover:text-(color:--mkt-white) ${className}`}
    >
      {copied ? <Check size={13} aria-hidden="true" className="text-[#9BD0A9]" /> : <Copy size={13} aria-hidden="true" />}
      <span aria-hidden="true">{copied ? 'Copied' : 'Copy'}</span>
      <span className="sr-only" aria-live="polite">{copied ? 'Copied to clipboard' : ''}</span>
    </button>
  )
}
