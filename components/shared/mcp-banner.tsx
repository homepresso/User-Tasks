'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'

/**
 * "Build with AI" prompt for the MCP connection (a marketing prompt, not a
 * notice: a neutral panel with one secondary action).
 *
 * It appears in ONE place only (ui-polish-spec §8 F acceptance): its home is
 * the Workflows list, `/automations`. Every other page that still renders
 * `<McpBanner />` (rules, agents, extensibility) gets nothing; those calls
 * are leftovers for their owners to delete. Dismissal is remembered on this
 * device.
 */
export const MCP_BANNER_HOME = '/automations'
const DISMISS_KEY = 'ut.mcp-banner.dismissed'

export function McpBanner() {
  const pathname = usePathname()
  // Hidden until the stored dismissal is read, so it never flashes.
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    let stored = false
    try { stored = window.localStorage.getItem(DISMISS_KEY) === '1' } catch { /* storage blocked */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser storage once after mount
    setDismissed(stored)
  }, [])

  if (pathname !== MCP_BANNER_HOME || dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try { window.localStorage.setItem(DISMISS_KEY, '1') } catch { /* storage blocked */ }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-panel px-4 py-3" data-testid="mcp-banner">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-subtle text-fg-muted" aria-hidden="true">
        <Sparkles className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-ui font-medium text-fg">Build with AI: connect UserTasks to Claude or ChatGPT</p>
        <p className="text-xs text-fg-muted">Create workflows, forms, data tables and more through conversation, over MCP.</p>
      </div>
      <Button asChild variant="secondary" size="sm">
        <Link href="/settings/mcp">Connect</Link>
      </Button>
      <IconButton label="Dismiss" icon={<X />} size="sm" onClick={dismiss} />
    </div>
  )
}
