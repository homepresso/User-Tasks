import { cn } from '@/lib/utils'

interface ProgressBarProps {
  value: number
  className?: string
  /** 6px (default) or 4px inline. */
  size?: 'md' | 'sm'
  /** Accessible name. */
  label?: string
}

/** Determinate progress: muted track, primary fill, success at 100%. */
export function ProgressBar({ value, className, size = 'md', label }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      className={cn('w-full overflow-hidden rounded-full bg-muted', size === 'sm' ? 'h-1' : 'h-1.5', className)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-[var(--ds-dur-base)] ease-[var(--ds-ease-standard)]',
          clamped === 100 ? 'bg-success' : 'bg-primary',
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
