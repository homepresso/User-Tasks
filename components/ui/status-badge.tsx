import { cn } from '@/lib/utils'

// Colors come from the --status-* palette in globals.css, which carries a
// per-theme override for dark canvases (Noir), so badges stay legible in
// every theme without dark: branches.
const statusConfig: Record<string, { label: string; style?: React.CSSProperties; className?: string }> = {
  draft: { label: 'Draft', style: { backgroundColor: 'var(--status-todo-bg)', color: 'var(--status-todo)' } },
  todo: { label: 'To Do', style: { backgroundColor: 'var(--status-todo-bg)', color: 'var(--status-todo)' } },
  in_progress: { label: 'In Progress', style: { backgroundColor: 'var(--status-progress-bg)', color: 'var(--status-progress)' } },
  blocked: { label: 'Blocked', style: { backgroundColor: 'var(--status-blocked-bg)', color: 'var(--status-blocked)' } },
  completed: { label: 'Completed', style: { backgroundColor: 'var(--status-done-bg)', color: 'var(--status-done)' } },
  cancelled: { label: 'Cancelled', style: { backgroundColor: 'var(--status-todo-bg)', color: 'var(--theme-muted-text)' } },
}

interface StatusBadgeProps {
  status: string
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.draft
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', config.className)}
      style={config.style}
    >
      {config.label}
    </span>
  )
}

// Workflow and agent run statuses.
const runStatusColors: Record<string, { bg: string; fg: string }> = {
  completed: { bg: 'var(--status-success-bg)', fg: 'var(--theme-success)' },
  failed: { bg: 'var(--status-danger-bg)', fg: 'var(--theme-danger)' },
  running: { bg: 'var(--status-todo-bg)', fg: 'var(--status-todo)' },
  processing: { bg: 'var(--status-todo-bg)', fg: 'var(--status-todo)' },
  waiting_for_event: { bg: 'var(--status-warning-bg)', fg: 'var(--theme-warning)' },
  paused: { bg: 'var(--status-info-bg)', fg: 'var(--status-info)' },
  // Closed out by a live instance migration (continues as another run).
  migrated: { bg: 'var(--status-info-bg)', fg: 'var(--status-info)' },
}

/** Pill for a workflow or agent run status (unknown statuses render neutral). */
export function RunStatusBadge({ status }: { status: string }) {
  const { bg, fg } = runStatusColors[status] ?? { bg: 'var(--theme-surface)', fg: 'var(--theme-muted-text)' }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium capitalize w-fit"
      style={{ backgroundColor: bg, color: fg }}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}
