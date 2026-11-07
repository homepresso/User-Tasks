'use client'

import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { type DeleteNoticeTone } from '@/lib/queued-delete-feedback'

/**
 * InlineNotice (§3.15): a message inside the page. Text stays in `fg` for
 * contrast; the icon carries the tone. Background = tone wash, border = tone
 * at 30% into the border colour. `banner` = full-width page-level message.
 *
 * Legacy: `tone="error"` = danger, `message` = children.
 */
export type NoticeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | DeleteNoticeTone

const TONES = {
  neutral: { icon: <Info />, iconColor: 'text-fg-muted', box: 'bg-subtle border-border' },
  info: { icon: <Info />, iconColor: 'text-info', box: 'bg-info-wash border-[color-mix(in_srgb,var(--status-info)_30%,var(--ds-border))]' },
  success: { icon: <CheckCircle2 />, iconColor: 'text-success', box: 'bg-success-wash border-[color-mix(in_srgb,var(--theme-success)_30%,var(--ds-border))]' },
  warning: { icon: <TriangleAlert />, iconColor: 'text-warning', box: 'bg-warning-wash border-[color-mix(in_srgb,var(--theme-warning)_30%,var(--ds-border))]' },
  danger: { icon: <AlertCircle />, iconColor: 'text-danger', box: 'bg-danger-wash border-[color-mix(in_srgb,var(--theme-danger)_30%,var(--ds-border))]' },
} as const

export function InlineNotice({
  tone,
  message,
  title,
  children,
  actions,
  onDismiss,
  banner = false,
  className = '',
}: {
  tone: NoticeTone
  /** Body text (legacy prop; or pass children). */
  message?: ReactNode
  title?: ReactNode
  children?: ReactNode
  /** Buttons at the right (Button sm ghost). */
  actions?: ReactNode
  onDismiss?: () => void
  banner?: boolean
  className?: string
}) {
  const t = TONES[(tone === 'error' ? 'danger' : tone) as keyof typeof TONES]
  return (
    <div
      role={tone === 'error' || tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-ui text-fg', t.box, banner && 'w-full', className)}
    >
      <span className={cn('mt-0.5 inline-flex shrink-0 [&>svg]:size-4', t.iconColor)} aria-hidden="true">{t.icon}</span>
      <div className="min-w-0 flex-1">
        {title != null && <p className="font-semibold">{title}</p>}
        {message != null && <div>{message}</div>}
        {children}
      </div>
      {actions != null && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-my-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-muted hover:text-fg">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
