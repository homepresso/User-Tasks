import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Info } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Card } from './card'
import { Tooltip } from './tooltip'

type ValueTone = 'default' | 'success' | 'warning' | 'danger' | 'info'

const VALUE_TONE: Record<ValueTone, string> = {
  default: 'text-fg',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
}

/** Legacy `accent` (a CSS colour variable) → a value tone. */
function toneFromAccent(accent?: string): ValueTone {
  if (!accent) return 'default'
  if (/success|done/.test(accent)) return 'success'
  if (/warning|progress/.test(accent)) return 'warning'
  if (/danger|error|blocked/.test(accent)) return 'danger'
  if (/info/.test(accent)) return 'info'
  return 'default'
}

export interface StatDelta {
  /** Signed change, already formatted ("+12%", "−2 ms"). */
  label: ReactNode
  direction: 'up' | 'down' | 'flat'
  /** Whether up is good (success) or bad (danger); omit when direction has no meaning (neutral). */
  goodWhen?: 'up' | 'down'
  /** "vs prior 30 days". */
  caption?: ReactNode
}

export interface StatCardProps {
  label: ReactNode
  value: ReactNode
  /** Unit suffix on the value's baseline ("h", "%"). */
  unit?: ReactNode
  icon?: ReactNode
  /** Info tooltip after the label. */
  hint?: string
  delta?: StatDelta
  /** Colour of the value (status counts only). */
  tone?: ValueTone
  /** @deprecated pass `tone`. A CSS colour variable; mapped to a tone. */
  accent?: string
  /** Footer link ("View all"). */
  footer?: { label: string; href: string }
  /** Sparkline or other visual under the value (32px tall). */
  children?: ReactNode
  className?: string
}

/** KPI tile (§3.9): 13px muted label, 28px tabular value, optional delta / sparkline / footer. */
export function StatCard({ label, value, unit, icon, hint, delta, tone, accent, footer, children, className }: StatCardProps) {
  const valueTone = tone ?? toneFromAccent(accent)
  const deltaTone = !delta || delta.direction === 'flat' || !delta.goodWhen
    ? 'text-fg-muted'
    : delta.direction === delta.goodWhen ? 'text-success' : 'text-danger'
  return (
    <Card padding="md" className={cn('flex min-h-[112px] min-w-0 flex-col max-sm:min-h-0 max-sm:p-3', className)}>
      <p className="flex items-center gap-1.5 text-ui font-medium text-fg-muted">
        {icon != null && <span className="inline-flex [&>svg]:size-3.5" aria-hidden="true">{icon}</span>}
        <span className="truncate">{label}</span>
        {hint && (
          <Tooltip content={hint}>
            <button type="button" aria-label={hint} className="inline-flex text-fg-subtle hover:text-fg-muted"><Info className="size-3.5" /></button>
          </Tooltip>
        )}
      </p>
      <p className={cn('num mt-1 flex items-baseline gap-1 whitespace-nowrap text-metric', VALUE_TONE[valueTone])}>
        {value}
        {unit != null && <span className="text-sm font-normal text-fg-muted">{unit}</span>}
      </p>
      {delta && (
        <p className="mt-1 flex items-center gap-1.5 text-xs">
          <span className={cn('inline-flex items-center gap-0.5 font-medium', deltaTone)}>
            {delta.direction === 'up' && <ArrowUpRight className="size-3.5" aria-hidden="true" />}
            {delta.direction === 'down' && <ArrowDownRight className="size-3.5" aria-hidden="true" />}
            {delta.label}
          </span>
          {delta.caption != null && <span className="text-fg-muted">{delta.caption}</span>}
        </p>
      )}
      {children != null && <div className="mt-2 h-8">{children}</div>}
      {footer && (
        <Link href={footer.href} className="mt-auto pt-2 text-xs font-medium text-primary-text hover:underline">
          {footer.label} →
        </Link>
      )}
    </Card>
  )
}

/** Grid of StatCards without orphan rows: auto-fit 200px columns, gap 12, at most 4 per row from 1280px. */
export function StatGrid({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // Phones: two to a row (four big cards would fill the first screen).
  return <div className={cn('grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 max-sm:grid-cols-2 max-sm:gap-2 xl:grid-cols-[repeat(auto-fit,minmax(max(200px,calc(25%_-_9px)),1fr))]', className)} {...props} />
}
