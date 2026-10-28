'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Bot, X, Sparkles } from 'lucide-react'

export function McpBanner() {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  return (
    <div className="rounded-lg border px-4 py-3 flex items-center gap-3"
      style={{
        backgroundColor: 'var(--theme-accent-light)',
        borderColor: 'var(--theme-surface-border)',
      }}>
      <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--theme-accent-light)' }}>
        <Sparkles size={16} style={{ color: 'var(--theme-accent-text)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>
          Build with AI — connect UserTasks to Claude or ChatGPT via MCP
        </p>
        <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
          Let Claude or ChatGPT create workflows, forms, data tables and more through natural conversation.
        </p>
      </div>
      <Link href="/settings/mcp" className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:opacity-90"
        style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }}>
        <Bot size={12} className="inline mr-1" /> Connect
      </Link>
      <button onClick={() => setDismissed(true)} className="shrink-0 p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
        <X size={14} />
      </button>
    </div>
  )
}
