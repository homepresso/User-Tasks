'use client'

import { useState } from 'react'
import { Check, ClipboardCopy } from 'lucide-react'

/** A command or snippet with a copy button (Settings → Infrastructure, the setup wizard). */
export function CopyBlock({ text, label = 'Copy command' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative">
      <pre className="rounded-lg p-3 pr-10 text-xs whitespace-pre-wrap break-all" style={{ backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)' }}>{text}</pre>
      <button
        type="button"
        className="absolute right-2 top-2"
        aria-label={label}
        onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      >
        {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
      </button>
    </div>
  )
}
