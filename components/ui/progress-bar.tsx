import { cn } from '@/lib/utils'

interface ProgressBarProps {
  value: number
  className?: string
}

export function ProgressBar({ value, className }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div className={cn('h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700', className)}>
      <div
        className={cn(
          'h-full rounded-full transition-all',
          clamped === 100 ? 'bg-[color:var(--theme-primary)]' : 'bg-[color:var(--theme-accent)]',
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
