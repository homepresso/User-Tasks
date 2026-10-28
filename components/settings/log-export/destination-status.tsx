'use client'

import { Activity, Cloud, Dog, Radio, ScrollText, Server, Terminal, Webhook, type LucideIcon } from 'lucide-react'
import type { DestinationType } from './form-state'

export const TYPE_ICONS: Record<DestinationType, LucideIcon> = {
  splunk_hec: Server,
  datadog: Dog,
  otlp_http: Activity,
  webhook: Webhook,
  syslog: Terminal,
  azure_monitor: Cloud,
  azure_event_hubs: Radio,
  gcp_logging: ScrollText,
  gcp_pubsub: Radio,
  aws_cloudwatch_logs: ScrollText,
}

const STATUS_STYLES: Record<string, { label: string; style: React.CSSProperties; hint: string }> = {
  healthy: {
    label: 'Healthy',
    style: { backgroundColor: 'var(--status-done-bg)', color: 'var(--status-done)' },
    hint: 'Delivering normally',
  },
  retrying: {
    label: 'Retrying',
    style: { backgroundColor: 'var(--status-progress-bg)', color: 'var(--status-progress)' },
    hint: 'The last delivery failed; retrying with backoff',
  },
  failing: {
    label: 'Failing',
    style: { backgroundColor: 'var(--status-blocked-bg)', color: 'var(--status-blocked)' },
    hint: 'Repeated failures — check the URL and credentials, then send a test event',
  },
  disabled: {
    label: 'Paused',
    style: { backgroundColor: 'var(--status-todo-bg)', color: 'var(--theme-muted-text)' },
    hint: 'Paused: nothing is sent; events stay queued until retention expires',
  },
  lagging_data_lost: {
    label: 'Data lost',
    style: { backgroundColor: 'var(--status-blocked-bg)', color: 'var(--status-blocked)' },
    hint: 'The destination fell further behind than event retention; some events were never sent',
  },
}

export function DestinationStatusBadge({ status }: { status: string }) {
  const config = STATUS_STYLES[status] ?? { label: status, style: STATUS_STYLES.disabled.style, hint: '' }
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={config.style}
      title={config.hint}
    >
      {config.label}
    </span>
  )
}

/** 75 → "1m 15s", 7300 → "2h 1m". */
export function formatLagSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'caught up'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const hours = Math.floor(seconds / 3600)
  if (hours < 48) return `${hours}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}
