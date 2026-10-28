'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** Copies `text` to the clipboard; used on docs and marketing code blocks. */
export function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : 'Copy to clipboard'}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[#B9B2A3] transition hover:bg-[#FFFFFF]/10 hover:text-[#FFFFFF] ${className}`}
    >
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
