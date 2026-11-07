'use client'

/**
 * Generic activity feed renderer used by the global /activity page. Takes
 * ActivityItems (newest first) and renders them grouped by day (§5.17): a
 * 12px muted sticky header per day, then one row per event — avatar,
 * actor + action + object link, and a right-aligned relative time with the
 * absolute time in a tooltip.
 *
 * Purpose-built for the observability layer — keeps the existing
 * components/tasks/timeline.tsx untouched (it has task-specific
 * comment-form internals that would pollute this component).
 */

import Link from 'next/link'
import {
  Activity, Bot, GitBranch, Network, Database,
  Users, Key, Palette, Server, ClipboardList, ChevronRight,
} from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Tag } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDay, toDate } from '@/lib/format/date'
import { cn } from '@/lib/utils'
import { auditActionLabel, auditObjectTypeLabel } from '@/lib/audit-labels'
import { RelativeTime } from './relative-time'

export interface ActivityItem {
  id: string
  /** Entity type — drives the icon and color */
  objectType: string
  objectId?: string
  /** Action verb — create, update, delete, publish, toggle, execute, etc. */
  action: string
  /** Human-readable one-liner */
  summary: string
  /** Actor (user) display name or id */
  actor?: string | null
  /** ISO timestamp */
  timestamp: string
  /** Optional link — when present, the whole row is clickable */
  href?: string | null
  /** Optional severity — used to override the action color */
  severity?: 'info' | 'success' | 'warning' | 'error'
  /** Optional badge text shown between action and timestamp */
  badge?: string
}

const OBJECT_ICONS: Record<string, any> = {
  workflow: GitBranch,
  workflow_run: GitBranch,
  agent: Bot,
  agent_run: Bot,
  integration: Network,
  integration_reference: Network,
  integration_call: Network,
  report: Activity,
  data_table: Database,
  form: ClipboardList,
  form_theme: ClipboardList,
  team: Users,
  role: Users,
  api_key: Key,
  theme: Palette,
  mcp_server: Server,
}

const SEVERITY_TEXT: Record<NonNullable<ActivityItem['severity']>, string> = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-danger',
}

interface ActivityFeedProps {
  items: ActivityItem[]
  /** Optional message to show when the feed is empty */
  emptyMessage?: string
  /** Optional className on the outer container */
  className?: string
  /** If true, renders a compact variant with less padding */
  compact?: boolean
}

/** Local calendar-day key ("2026-11-04") of a timestamp. */
function dayKey(iso: string): string {
  const d = toDate(iso)
  if (!d) return 'unknown'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "Today", "Yesterday", then "27 Oct" / "27 Oct 2025". */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const key = dayKey(iso)
  if (key === dayKey(now.toISOString())) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (key === dayKey(yesterday.toISOString())) return 'Yesterday'
  return formatDay(iso)
}

/** Consecutive items grouped by local day (the feed is newest first). */
export function groupByDay(items: ActivityItem[]): Array<{ key: string; label: string; items: ActivityItem[] }> {
  const groups: Array<{ key: string; label: string; items: ActivityItem[] }> = []
  for (const item of items) {
    const key = dayKey(item.timestamp)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(item)
    else groups.push({ key, label: dayLabel(item.timestamp), items: [item] })
  }
  return groups
}

export function ActivityFeed({ items, emptyMessage = 'No activity yet', className = '', compact = false }: ActivityFeedProps) {
  if (items.length === 0) {
    return (
      <div className={cn('rounded-lg border border-border bg-panel', className)}>
        <EmptyState size="sm" icon={Activity} title={emptyMessage} />
      </div>
    )
  }

  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-panel', className)} data-activity-feed>
      {groupByDay(items).map((group) => (
        <section key={group.key} aria-label={group.label}>
          <h3 className="sticky top-0 z-[1] border-b border-border-subtle bg-subtle px-4 py-1.5 text-xs font-medium text-fg-muted">
            {group.label}
          </h3>
          <ul>
            {group.items.map((item) => (
              <FeedRow key={item.id} item={item} compact={compact} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function FeedRow({ item, compact }: { item: ActivityItem; compact: boolean }) {
  const Icon = OBJECT_ICONS[item.objectType] ?? Activity
  const actor = item.actor || 'System'
  const object = (
    <span className="truncate">{item.summary}</span>
  )
  return (
    <li className={cn('flex items-center gap-3 border-b border-border-subtle px-4 last:border-b-0', compact ? 'py-1.5' : 'py-2', item.href && 'transition-colors duration-[var(--ds-dur-fast)] hover:bg-subtle')}>
      {item.actor ? <Avatar name={item.actor} size="sm" /> : (
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-fg-muted" aria-hidden>
          <Icon className="size-3.5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-1.5 text-ui text-fg">
          <span className="shrink-0 font-medium">{actor}</span>
          <span className={cn('shrink-0 text-fg-muted', item.severity && SEVERITY_TEXT[item.severity])}>{auditActionLabel(item.action).toLowerCase()}</span>
          {item.href ? (
            <Link href={item.href} className="min-w-0 truncate text-primary-text hover:underline">{item.summary}</Link>
          ) : object}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted">
          <Icon className="size-3.5 shrink-0" aria-hidden />
          {auditObjectTypeLabel(item.objectType)}
          {item.badge && <Tag mono>{item.badge}</Tag>}
        </p>
      </div>
      <RelativeTime at={item.timestamp} className="shrink-0 text-xs text-fg-muted" />
      {item.href && <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />}
    </li>
  )
}

/**
 * Maps an object_audit_log row to an ActivityItem for display in the feed.
 * Also computes the detail-page href so the row becomes clickable.
 */
export function auditRowToActivityItem(row: any): ActivityItem {
  const objectType = row.object_type as string
  const objectId = row.object_id as string
  const href = hrefForObject(objectType, objectId, row.metadata ?? undefined)
  return {
    id: row.id,
    objectType,
    objectId,
    action: row.action,
    summary: row.summary ?? `${row.action} ${objectType}`,
    actor: row.actor?.display_name ?? null,
    timestamp: row.created_at,
    href,
  }
}

/** Resolve a click-through URL for a given object type + id. */
export function hrefForObject(objectType: string, objectId: string, metadata?: Record<string, any>): string | null {
  switch (objectType) {
    case 'workflow': return `/automations/${objectId}`
    case 'workflow_run': return `/automations/runs/${objectId}`
    case 'agent': return `/agents/${objectId}`
    case 'integration': return `/integrations/${objectId}`
    case 'report': return `/reports/${objectId}`
    case 'data_table': return `/data/${objectId}`
    // A deleted form's link opens the library (there are no Details to show).
    case 'form': return `/automations/forms?details=${objectId}`
    case 'form_theme': return '/automations/forms'
    default: return null
  }
}
