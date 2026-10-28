'use client'

import { CheckCircle2, Info, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspaceBrand } from '@/components/providers/theme-provider'
import type { ButtonEffects, ButtonPlacement, FormButton } from '@/lib/forms/buttons'
import { headerImageSrc, resolveHeaderText, type FormHeader } from '@/lib/forms/header'
import { formHeaderColors, type FormThemeOverrides } from '@/lib/forms/form-theme'
import { resolveStorageUrl } from '@/lib/storage/refs'
import { cn } from '@/lib/utils'

/**
 * The parts around a form's fields: the header (image, title, subtitle on
 * the mini theme's banner colour, which the theme keeps legible), the
 * button bar (placement from the mini theme) and what a button shows after
 * a click (messages, the success screen). Shared by the designer preview,
 * the standalone form page and task forms with a button bar.
 */

export function FormHeaderBlock({ header, values, task, overrides }: {
  header: FormHeader | null | undefined
  values: Record<string, unknown>
  task?: Record<string, unknown> | null
  overrides?: FormThemeOverrides | null
}) {
  const { logoUrl } = useWorkspaceBrand(null)
  if (!header?.enabled) return null
  const src = headerImageSrc(header, logoUrl)
  const image = src ? resolveStorageUrl(src) ?? src : null
  const title = resolveHeaderText(header.title, values, task)
  const subtitle = resolveHeaderText(header.subtitle, values, task)
  // The banner colour comes from the mini theme (made legible by onColor).
  const banner = header.banner ? formHeaderColors(overrides ? { ...overrides, header: { ...overrides.header, enabled: true } } : null) : null
  if (!image && !title && !subtitle) return null
  return (
    <div
      className={cn('mb-4 flex items-center gap-3 py-3', banner ? 'rounded-lg px-4' : 'border-b pb-4', header.align === 'center' && 'flex-col text-center')}
      style={banner ? { backgroundColor: banner.background, color: banner.text } : { borderColor: 'var(--theme-surface-border)' }}
      data-form-header
    >
      {image && (
        // eslint-disable-next-line @next/next/no-img-element -- the UserTasks mark, the workspace logo or an uploaded header image (own storage)
        <img src={image} alt="" className="h-10 w-auto max-w-[160px] shrink-0 object-contain" />
      )}
      <div className="min-w-0">
        {title && <h2 className="text-lg font-semibold leading-tight" style={banner ? undefined : { color: 'var(--theme-card-text)' }}>{title}</h2>}
        {subtitle && <p className="mt-0.5 text-sm" style={banner ? { opacity: 0.9 } : { color: 'var(--theme-muted-text)' }}>{subtitle}</p>}
      </div>
    </div>
  )
}

const VARIANT: Record<FormButton['style'], 'default' | 'outline' | 'destructive'> = { primary: 'default', secondary: 'outline', danger: 'destructive' }

export function FormButtonBar({ buttons, placement = 'right', busy, disabled, onClick }: {
  buttons: FormButton[]
  placement?: ButtonPlacement
  /** Id of the button whose action is running. */
  busy?: string | null
  disabled?: boolean
  onClick: (button: FormButton) => void
}) {
  const shown = buttons.filter((b) => !b.hidden)
  if (!shown.length) return null
  return (
    <div
      className={cn('mt-5 flex flex-wrap gap-2', placement === 'left' && 'justify-start', placement === 'right' && 'justify-end', placement === 'full' && 'flex-col sm:flex-row')}
      data-form-buttons={placement}
    >
      {shown.map((button) => (
        <Button
          key={button.id}
          type="button"
          variant={VARIANT[button.style]}
          disabled={disabled || Boolean(busy)}
          aria-busy={busy === button.id || undefined}
          onClick={() => onClick(button)}
          className={cn(placement === 'full' && 'w-full sm:flex-1')}
          data-form-button={button.id}
        >
          {busy === button.id ? `${button.label}…` : button.label}
        </Button>
      ))}
    </div>
  )
}

export function FormMessages({ messages, onDismiss }: { messages: ButtonEffects['messages']; onDismiss?: (index: number) => void }) {
  if (!messages.length) return null
  return (
    <div className="mt-3 space-y-2" aria-live="polite">
      {messages.map((m, i) => (
        <div key={i} role="status" className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: m.tone === 'success' ? 'var(--status-done, var(--theme-primary))' : 'var(--theme-surface-border)', backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-card-text)' }}
          data-form-message>
          {m.tone === 'success' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden style={{ color: 'var(--theme-primary-text)' }} /> : <Info size={16} className="mt-0.5 shrink-0" aria-hidden />}
          <span className="flex-1 whitespace-pre-wrap">{m.text}</span>
          {onDismiss && (
            <button type="button" onClick={() => onDismiss(i)} aria-label="Dismiss" className="rounded p-0.5 hover:opacity-80"><X size={14} aria-hidden /></button>
          )}
        </div>
      ))}
    </div>
  )
}

export function FormSuccessScreen({ screen, onSubmitAnother, onClose }: {
  screen: NonNullable<ButtonEffects['success_screen']>
  onSubmitAnother?: () => void
  onClose?: () => void
}) {
  const label = screen.button_label || (screen.button === 'submit_another' ? 'Submit another' : screen.button === 'close' ? 'Close' : 'Continue')
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center" role="status" aria-live="polite" data-form-success>
      <CheckCircle2 size={40} aria-hidden style={{ color: 'var(--theme-primary-text)' }} />
      <h2 className="text-xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>{screen.title}</h2>
      {screen.text && <p className="max-w-md whitespace-pre-wrap text-sm" style={{ color: 'var(--theme-muted-text)' }}>{screen.text}</p>}
      {screen.button === 'submit_another' && onSubmitAnother && <Button onClick={onSubmitAnother} data-form-success-action>{label}</Button>}
      {screen.button === 'close' && onClose && <Button variant="outline" onClick={onClose} data-form-success-action>{label}</Button>}
      {screen.button === 'link' && screen.url && (
        <Button asChild><a href={screen.url} data-form-success-action>{label}</a></Button>
      )}
    </div>
  )
}
