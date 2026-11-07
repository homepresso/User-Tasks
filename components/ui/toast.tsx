'use client'

import { AlertCircle, CheckCircle2, Info, Loader2, TriangleAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'

/**
 * Presentational toast (§3.14) for the jobs provider (components/jobs, B) and
 * any other notifier. Position, stacking (max 3, bottom-right, 8px gaps) and
 * timers (5s, 8s with an action, pause on hover/focus) belong to the host;
 * ToastViewport gives the position.
 */
export type ToastTone = 'info' | 'success' | 'warning' | 'danger' | 'running'

const ICON: Record<ToastTone, { icon: ReactNode; color: string; bar: string }> = {
  info: { icon: <Info />, color: 'text-info', bar: 'bg-info' },
  success: { icon: <CheckCircle2 />, color: 'text-success', bar: 'bg-success' },
  warning: { icon: <TriangleAlert />, color: 'text-warning', bar: 'bg-warning' },
  danger: { icon: <AlertCircle />, color: 'text-danger', bar: 'bg-danger' },
  running: { icon: <Loader2 className="animate-spin" />, color: 'text-fg-muted', bar: 'bg-primary' },
}

export interface ToastCardProps {
  tone?: ToastTone
  title: ReactNode
  description?: ReactNode
  /** One link-style action ("View run"). */
  action?: { label: string; onClick: () => void }
  onDismiss?: () => void
  /** 2px left tone bar. */
  toneBar?: boolean
  className?: string
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  onFocus?: () => void
  onBlur?: () => void
}

export function ToastCard({ tone = 'info', title, description, action, onDismiss, toneBar = false, className, ...hover }: ToastCardProps) {
  const t = ICON[tone]
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
      className={cn('ds-toast relative flex w-[360px] max-w-[calc(100vw-32px)] items-start gap-3 overflow-hidden rounded-lg bg-elevated p-3 pr-2 text-fg shadow-elev-2', className)}
      {...hover}
    >
      {toneBar && <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-0.5', t.bar)} />}
      <span className={cn('mt-0.5 inline-flex shrink-0 [&>svg]:size-4', t.color)} aria-hidden="true">{t.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-ui font-semibold text-fg">{title}</p>
        {description != null && <p className="mt-0.5 line-clamp-2 text-ui text-fg-muted">{description}</p>}
        {action && <Button variant="link" size="sm" className="mt-1 h-auto" onClick={action.onClick}>{action.label}</Button>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-subtle hover:text-fg">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/** Bottom-right stack, 16px from the edges, newest at the bottom. */
export function ToastViewport({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('pointer-events-none fixed bottom-4 right-4 z-[1200] flex flex-col items-end gap-2 [&>*]:pointer-events-auto', className)} {...props} />
}
