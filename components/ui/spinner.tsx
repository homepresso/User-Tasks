import { cn } from '@/lib/utils'

/**
 * A loading spinner: a faint ring with a turning arc in the current text
 * colour (so it takes the theme or the button it sits in). Server-safe —
 * no hooks, pure CSS.
 *
 * Accessible: `role="status"` with the label as screen-reader text. Pass
 * `decorative` inside something that already announces it (a button with
 * aria-busy, a region with its own status text): then it's aria-hidden.
 * Under prefers-reduced-motion it turns slowly instead of spinning.
 */

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg'

const SIZES: Record<SpinnerSize, { box: string; stroke: number }> = {
  xs: { box: 'size-3', stroke: 3 },
  sm: { box: 'size-4', stroke: 2.75 },
  md: { box: 'size-6', stroke: 2.5 },
  lg: { box: 'size-9', stroke: 2.25 },
}

export function Spinner({ size = 'md', label = 'Loading', decorative = false, className }: {
  size?: SpinnerSize
  /** Screen-reader text (default "Loading"). */
  label?: string
  /** Inside something that already announces the busy state: no role, aria-hidden. */
  decorative?: boolean
  className?: string
}) {
  const s = SIZES[size]
  const svg = (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" data-spinner-svg
      className={cn(s.box, 'shrink-0 animate-spin motion-reduce:animate-[spin_2.4s_linear_infinite]')}>
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth={s.stroke} opacity="0.18" />
      <path d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5" stroke="currentColor" strokeWidth={s.stroke} strokeLinecap="round" />
    </svg>
  )
  if (decorative) return <span aria-hidden="true" className={cn('inline-flex', className)} data-spinner>{svg}</span>
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex items-center', className)} data-spinner>
      {svg}
      <span className="sr-only">{label}</span>
    </span>
  )
}
