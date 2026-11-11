import { cn } from '@/lib/utils'

/** A small circular progress meter (the guide header and the launcher). */
export function ProgressRing({ percent, size = 40, stroke, label, className, showText = true }: {
  percent: number
  size?: number
  stroke?: number
  /** Accessible name ("2 of 6 done"). */
  label: string
  className?: string
  showText?: boolean
}) {
  const width = stroke ?? Math.max(3, Math.round(size / 10))
  const r = (size - width) / 2
  const c = 2 * Math.PI * r
  const value = Math.min(100, Math.max(0, percent))
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }}
      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={width} className="stroke-[color:var(--color-muted)]" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={width} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)}
          className={cn('transition-[stroke-dashoffset] duration-[var(--ds-dur-slow,400ms)] ease-[var(--ds-ease-standard)] motion-reduce:transition-none', value >= 100 ? 'stroke-[color:var(--color-success)]' : 'stroke-[color:var(--color-primary)]')} />
      </svg>
      {showText && size >= 36 && <span className="num absolute text-2xs font-semibold text-fg" aria-hidden>{Math.round(value)}%</span>}
    </span>
  )
}
