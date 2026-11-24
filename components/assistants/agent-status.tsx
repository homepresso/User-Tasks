'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ExternalLink, RotateCcw, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { activityText, type AgentActivity } from '@/lib/assistants/activity'
import { retrySummaryText, type AgentFailureView, type AgentRetrySummary } from '@/lib/agents/errors'

/**
 * The Agent's "working on it" bubble and its friendly error bubble — shared
 * by the Agent panel and the agent designer's test console.
 *
 * WorkingBubble: shown the moment a message is sent, until text streams in;
 * says what is happening (lib/assistants/activity.ts) and offers Stop.
 * Automatic provider retries never show here — the bubble keeps saying it
 * is working; RetryNote tells people who manage the Agent afterwards. Animated dots are decorative (they stop
 * under prefers-reduced-motion); the words are what a screen reader hears —
 * the caller owns the polite live region (`live` adds one here).
 *
 * FailureNotice: the friendly message, Retry, the admin's Settings link and
 * a collapsed "Details" with the sanitised technical summary — never the
 * provider's raw response.
 */

export function WorkingBubble({ activity, stopping = false, onStop, live = false, className }: {
  activity: AgentActivity
  stopping?: boolean
  onStop?: () => void
  /** Make the bubble itself a polite live region (when the caller has none). */
  live?: boolean
  className?: string
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(t)
  }, [])
  const view = activityText(activity, Math.max(now, activity.since))
  if (!view) return null
  const text = stopping ? 'Stopping…' : view.text
  return (
    <div className={cn('mr-4 flex items-start gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-xs', className)} data-assistant-item="working" data-activity-phase={activity.phase}
      {...(live ? { role: 'status', 'aria-live': 'polite' as const } : {})}>
      <span className="mt-1 flex shrink-0 gap-0.5" aria-hidden="true">
        {[0, 1, 2].map((i) => <span key={i} className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse" style={{ animationDelay: `${i * 200}ms` }} />)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-fg" data-testid="agent-working-text">{text}</span>
        {!stopping && view.hint && <span className="block text-2xs text-fg-muted" data-testid="agent-working-hint">{view.hint}</span>}
      </span>
      {onStop && !stopping && (
        <button type="button" onClick={onStop} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-fg-muted hover:bg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" data-testid="agent-working-stop">
          <Square className="size-3" aria-hidden="true" />Stop
        </button>
      )}
    </div>
  )
}

const DETAIL_LABELS: Array<[keyof AgentFailureView['details'], string]> = [
  ['provider', 'Provider'], ['status', 'Status'], ['error_code', 'Error code'], ['error_type', 'Error type'],
  ['request_id', 'Request ID'], ['attempts', 'Attempts'], ['reason', 'Reason'],
]

/** The sanitised rows of a failure's Details (what the bubble shows; also used by tests). */
export function failureDetailRows(failure: AgentFailureView | null | undefined): Array<{ label: string; value: string }> {
  if (!failure) return []
  const rows: Array<{ label: string; value: string }> = []
  for (const [key, label] of DETAIL_LABELS) {
    const v = failure.details?.[key]
    if (v === undefined || v === null || v === '') continue
    rows.push({ label, value: key === 'status' ? `HTTP ${v}` : String(v) })
  }
  if (failure.admin_message) rows.push({ label: 'Provider message', value: failure.admin_message })
  return rows
}

export function FailureNotice({ message, failure, onRetry, retryDisabled = false, tone = 'danger', className }: {
  message: string
  failure?: AgentFailureView | null
  onRetry?: (() => void) | null
  retryDisabled?: boolean
  tone?: 'danger' | 'neutral'
  className?: string
}) {
  const rows = failureDetailRows(failure)
  return (
    <div className={cn('rounded-lg border px-3 py-2 text-xs', tone === 'danger' ? 'border-danger' : 'border-border', className)}
      role={tone === 'danger' ? 'alert' : undefined} data-assistant-item="error" data-failure-code={failure?.code}>
      <div className={cn('flex items-start gap-2', tone === 'danger' ? 'text-danger' : 'text-fg-muted')}>
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-fg" data-testid="agent-error-message">{message}</p>
      </div>
      {(onRetry || failure?.settings_href) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-5">
          {onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry} disabled={retryDisabled} data-testid="assistant-retry">
              <RotateCcw className="size-3.5" aria-hidden="true" />Retry
            </Button>
          )}
          {failure?.settings_href && (
            <Link href={failure.settings_href} className="inline-flex items-center gap-1 font-medium text-primary-text underline-offset-2 hover:underline" data-testid="assistant-error-settings">
              Open Settings → Agent <ExternalLink className="size-3" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
      {rows.length > 0 && (
        <details className="mt-2 pl-5 text-2xs text-fg-muted" data-testid="assistant-error-details">
          <summary className="cursor-pointer select-none hover:text-fg">Details</summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {rows.map((r) => (
              <div key={r.label} className="contents">
                <dt className="text-fg-muted">{r.label}</dt>
                <dd className="min-w-0 break-words font-mono text-fg">{r.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  )
}

/**
 * The automatic retries a turn needed, under its answer — a collapsed
 * Details for people who manage the Agent (the chat route sends the summary
 * to them only). Nothing about retries is shown while the turn runs.
 */
export function RetryNote({ retries, className }: { retries: AgentRetrySummary; className?: string }) {
  return (
    <details className={cn('mt-1 text-2xs text-fg-muted', className)} data-testid="assistant-retry-details">
      <summary className="cursor-pointer select-none hover:text-fg">Details</summary>
      <p className="mt-1">{retrySummaryText(retries)}. Only people who manage the Agent see this.</p>
    </details>
  )
}
