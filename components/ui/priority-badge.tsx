import { cn } from '@/lib/utils'

/**
 * Priority (§3.7): not a pill — a 14px signal-bars icon plus the label in
 * muted text. Critical is danger, high is warning, medium neutral, low subtle.
 */
const PRIORITY: Record<string, { label: string; bars: number; color: string }> = {
  critical: { label: 'Critical', bars: 3, color: 'text-danger' },
  high: { label: 'High', bars: 3, color: 'text-warning' },
  medium: { label: 'Medium', bars: 2, color: 'text-fg-muted' },
  low: { label: 'Low', bars: 1, color: 'text-fg-subtle' },
  none: { label: 'None', bars: 0, color: 'text-fg-subtle' },
}

export function PriorityIcon({ bars, className }: { bars: number; className?: string }) {
  return (
    <svg viewBox="0 0 14 14" className={cn('size-3.5 shrink-0', className)} aria-hidden="true" fill="currentColor">
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1.5 + i * 4} y={9 - i * 3} width={3} height={4 + i * 3} rx={0.75} opacity={i < bars ? 1 : 0.25} />
      ))}
    </svg>
  )
}

export function PriorityBadge({ priority, className }: { priority: string; className?: string }) {
  const p = PRIORITY[priority] ?? PRIORITY.none
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-fg-muted', className)} data-priority={priority}>
      <PriorityIcon bars={p.bars} className={p.color} />
      {p.label}
    </span>
  )
}
