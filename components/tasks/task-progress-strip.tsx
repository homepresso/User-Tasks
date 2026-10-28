'use client'

import { ProgressBar } from '@/components/ui/progress-bar'

interface TaskProgressStripProps {
  value: number
  label?: string | null
  className?: string
}

/**
 * Compact "bar + percentage" strip used across task rows and widgets.
 * Container-safe: the bar flexes down to fit whatever width it is given and
 * the percentage keeps a fixed slot, so the label can never spill over
 * neighbouring text in narrow columns.
 */
export function TaskProgressStrip({ value, label = null, className = '' }: TaskProgressStripProps) {
  const progress = Math.max(0, Math.min(100, Math.round(Number(value) || 0)))

  return (
    <div className={`flex items-center gap-1.5 min-w-0 overflow-hidden ${className}`}>
      <ProgressBar value={progress} className="h-1.5 flex-1 min-w-0" />
      <span
        className="shrink-0 w-8 text-right text-[10px] font-semibold tabular-nums"
        style={{ color: 'var(--theme-muted-text)' }}
      >
        {progress}%
      </span>
      {label ? (
        <span
          className="min-w-0 truncate text-[10px]"
          style={{ color: 'var(--theme-muted-text)' }}
        >
          {label}
        </span>
      ) : null}
    </div>
  )
}
