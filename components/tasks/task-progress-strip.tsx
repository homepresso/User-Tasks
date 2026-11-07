'use client'

import { ProgressBar } from '@/components/ui/progress-bar'
import { cn } from '@/lib/utils'

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
    <div className={cn('flex min-w-0 items-center gap-1.5 overflow-hidden', className)}>
      <ProgressBar value={progress} className="min-w-0 flex-1" label={`${progress}% complete`} />
      <span className="num w-8 shrink-0 text-right text-2xs font-medium text-fg-muted">{progress}%</span>
      {label ? <span className="min-w-0 truncate text-2xs text-fg-muted">{label}</span> : null}
    </div>
  )
}
