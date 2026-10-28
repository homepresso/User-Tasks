'use client'

import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { type DeleteNoticeTone } from '@/lib/queued-delete-feedback'

// Theme semantic colours: a soft tint, the solid tone for text, a 35% border.
const tone = (solid: string, tint: string) => ({
  backgroundColor: `var(${tint})`,
  color: `var(${solid})`,
  borderColor: `color-mix(in srgb, var(${solid}) 35%, transparent)`,
})

const NOTICE_STYLES: Record<DeleteNoticeTone, { backgroundColor: string; color: string; borderColor: string }> = {
  success: tone('--theme-success', '--status-success-bg'),
  warning: tone('--theme-warning', '--status-warning-bg'),
  error: tone('--theme-danger', '--status-danger-bg'),
}

function NoticeIcon({ tone }: { tone: DeleteNoticeTone }) {
  if (tone === 'success') return <CheckCircle2 size={14} className="shrink-0" />
  if (tone === 'warning') return <AlertTriangle size={14} className="shrink-0" />
  return <XCircle size={14} className="shrink-0" />
}

export function InlineNotice({
  tone,
  message,
  onDismiss,
  className = '',
}: {
  tone: DeleteNoticeTone
  message: string
  onDismiss?: () => void
  className?: string
}) {
  const style = NOTICE_STYLES[tone]
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${className}`.trim()}
      style={style}
    >
      <NoticeIcon tone={tone} />
      <div className="min-w-0 flex-1">{message}</div>
      {onDismiss && (
        <button onClick={onDismiss} className="font-medium underline underline-offset-2">
          Dismiss
        </button>
      )}
    </div>
  )
}
