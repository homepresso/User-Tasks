"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Check, Copy, FileQuestion, Search, ShieldAlert } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { openCommandPalette } from "./command-palette-event"

/**
 * 404 and error states (docs/design/ui-polish-spec.md §4.5). The dashboard
 * versions render inside the shell; the public ones inside PublicFrame.
 */

export function NotFoundView({ inShell = false }: { inShell?: boolean }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" data-not-found>
      <EmptyState
        size="lg"
        icon={FileQuestion}
        title={<><span className="mb-1 block text-xs font-medium text-fg-muted">404</span>Page not found</>}
        description="The page may have moved, or the link is wrong. Check the address, or find what you need from here."
      >
        <div className="mt-4 flex items-center gap-2">
          <Button asChild size="sm"><Link href={inShell ? "/home" : "/"}>Go home</Link></Button>
          {inShell ? (
            <Button size="sm" variant="secondary" leadingIcon={<Search />} kbd="⌘K" onClick={() => openCommandPalette()}>Search</Button>
          ) : (
            <Button asChild size="sm" variant="secondary"><Link href="/docs">Browse the docs</Link></Button>
          )}
        </div>
      </EmptyState>
    </div>
  )
}

/**
 * A page the person's role doesn't allow (lib/route-permissions). Rendered in
 * the shell in place of the page — the URL stays, nothing of the page loads.
 */
export function NotAuthorizedView() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" data-not-authorized>
      <EmptyState
        size="lg"
        icon={ShieldAlert}
        title={<><span className="mb-1 block text-xs font-medium text-fg-muted">403</span>Not authorized</>}
        description="Your role in this workspace doesn't include this page. Ask a workspace admin if you need access."
      >
        <div className="mt-4 flex items-center gap-2">
          <Button asChild size="sm"><Link href="/home">Go home</Link></Button>
        </div>
      </EmptyState>
    </div>
  )
}

export interface RouteErrorProps {
  error: Error & { digest?: string }
  /** Next 16: re-fetch and re-render the segment. */
  unstable_retry?: () => void
  /** Older API: re-render without re-fetching. */
  reset?: () => void
  /** "Couldn't load the workflow designer" — defaults to a generic title. */
  title?: string
}

/** An error boundary's content: what happened, Try again, and the error ID to quote to support. */
export function RouteErrorView({ error, unstable_retry, reset, title = "Something went wrong" }: RouteErrorProps) {
  const [copied, setCopied] = useState(false)
  useEffect(() => { console.error(error) }, [error])
  const id = error.digest
  const retry = unstable_retry ?? reset
  return (
    <div className="flex min-h-[50vh] items-center justify-center" data-route-error>
      <EmptyState
        variant="error"
        size="lg"
        title={title}
        description="This part of the page couldn't load. Try again; if it keeps happening, send the error ID to your administrator."
      >
        {id && <p className="mt-3 font-mono text-xs text-fg-muted">Error ID: <span className="select-all">{id}</span></p>}
        <div className="mt-4 flex items-center gap-2">
          {retry && <Button size="sm" onClick={() => retry()}>Try again</Button>}
          {id && (
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={copied ? <Check /> : <Copy />}
              onClick={() => { void navigator.clipboard?.writeText(id).then(() => setCopied(true)) }}
            >
              {copied ? "Copied" : "Copy error ID"}
            </Button>
          )}
        </div>
      </EmptyState>
    </div>
  )
}
