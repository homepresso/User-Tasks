'use client'

/**
 * Generic activity feed renderer used by the global /activity page and
 * the trace viewer. Takes an array of ActivityItems and renders them
 * as a vertical timeline with colored dots, actor attribution, and
 * optional click-through links.
 *
 * Purpose-built for the observability layer — keeps the existing
 * components/tasks/timeline.tsx untouched (it has task-specific
 * comment-form internals that would pollute this component).
 */

import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  Activity, Bot, GitBranch, Network, Database,
  Users, Key, Palette, Server, CheckCircle2, XCircle, AlertCircle,
  Plus, Pencil, Trash2, Play, Pause, Eye, ArrowRight, Clock,
} from 'lucide-react'
import { formatRelativeDate } from '@/lib/utils'

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
  team: Users,
  role: Users,
  api_key: Key,
  theme: Palette,
  mcp_server: Server,
}

const ACTION_COLORS: Record<string, string> = {
  create: 'var(--theme-success)',
  update: 'var(--theme-primary)',
  delete: 'var(--theme-danger)',
  publish: 'var(--theme-success)',
  unpublish: 'var(--theme-warning)',
  toggle: 'var(--theme-primary)',
  rename: 'var(--theme-primary)',
  execute: 'var(--status-info)',
  grant: 'var(--theme-success)',
  revoke: 'var(--theme-danger)',
  restore: 'var(--theme-success)',
  duplicate: 'var(--status-info)',
  share: 'var(--status-info)',
  unshare: 'var(--theme-muted-text)',
}

const ACTION_ICONS: Record<string, any> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  publish: Play,
  unpublish: Pause,
  toggle: Play,
  execute: Play,
}

function colorFor(item: ActivityItem): string {
  if (item.severity === 'error') return 'var(--theme-danger)'
  if (item.severity === 'warning') return 'var(--theme-warning)'
  if (item.severity === 'success') return 'var(--theme-success)'
  return ACTION_COLORS[item.action] ?? 'var(--theme-muted-text)'
}

function iconFor(item: ActivityItem): any {
  return ACTION_ICONS[item.action] ?? OBJECT_ICONS[item.objectType] ?? Activity
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

export function ActivityFeed({ items, emptyMessage = 'No activity yet', className = '', compact = false }: ActivityFeedProps) {
  if (items.length === 0) {
    return (
      <div className={`rounded-xl border p-8 text-center ${className}`}
        style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
        <Activity size={28} className="mx-auto mb-2" style={{ color: 'var(--theme-muted-text)', opacity: 0.5 }} />
        <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>{emptyMessage}</p>
      </div>
    )
  }

  const padX = compact ? 'px-3' : 'px-4'
  const padY = compact ? 'py-2' : 'py-3'

  return (
    <div className={`rounded-xl border overflow-hidden ${className}`}
      style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
      {items.map((item, i) => {
        const Icon = iconFor(item)
        const color = colorFor(item)
        const row = (
          <div className={`flex items-start gap-3 ${padX} ${padY} transition-colors ${item.href ? 'hover:bg-[var(--theme-row-highlight)]' : ''}`}
            style={{ borderTop: i > 0 ? '1px solid var(--theme-surface-border)' : undefined }}>
            {/* Icon bubble */}
            <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5"
              style={{ backgroundColor: 'var(--theme-surface)' }}>
              <Icon size={12} style={{ color }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>
                  {item.summary}
                </span>
                {item.badge && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-mono uppercase"
                    style={{ backgroundColor: 'var(--theme-row-highlight)', color: 'var(--theme-muted-text)' }}>
                    {item.badge}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                <span className="capitalize font-mono">{item.objectType.replace(/_/g, ' ')}</span>
                <span>·</span>
                <span className="capitalize">{item.action.replace(/_/g, ' ')}</span>
                {item.actor && <><span>·</span><span>{item.actor}</span></>}
                <span>·</span>
                <span>{formatRelativeDate(item.timestamp)}</span>
              </div>
            </div>
            {item.href && <ArrowRight size={12} className="shrink-0 mt-2" style={{ color: 'var(--theme-muted-text)' }} />}
          </div>
        )
        if (item.href) {
          return <Link key={item.id} href={item.href} className="block">{row}</Link>
        }
        return <div key={item.id}>{row}</div>
      })}
    </div>
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
    default: return null
  }
}
