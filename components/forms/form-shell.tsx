'use client'

import { useLayoutEffect, useRef } from 'react'
import { CheckCircle2, Info, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspaceBrand } from '@/components/providers/theme-provider'
import type { ButtonEffects, ButtonPlacement, FormButton } from '@/lib/forms/buttons'
import { headerImageSrc, resolveHeaderText, withThemeHeaderText, type FormHeader } from '@/lib/forms/header'
import { formHeaderColors, type FormThemeOverrides } from '@/lib/forms/form-theme'
import { resolveStorageUrl } from '@/lib/storage/refs'
import { cn } from '@/lib/utils'
import { useStepPhase } from './form-pages'
import { useFormRuntime, useRegisterBar } from './form-runtime'
import { SubmittedPageView } from './submitted-page-view'
import { isApplicationMode } from '@/lib/forms/form-state'
import { motionAttrs, useFormMotion } from './form-motion'

/**
 * The parts around a form's fields: the header (image, title, subtitle on
 * the mini theme's banner colour, which the theme keeps legible), the
 * button bar (placement from the mini theme) and what a button shows after
 * a click (messages, the success screen). Shared by the designer preview,
 * the standalone form page and task forms with a button bar.
 */

export function FormHeaderBlock({ header: own, values, task, overrides, actions }: {
  header: FormHeader | null | undefined
  values: Record<string, unknown>
  task?: Record<string, unknown> | null
  /** The mini theme (its header is hidden behind this one; its title / subtitle fill in empty ones). */
  overrides?: FormThemeOverrides | null
  /**
   * Icons for the header's top-right corner (the favourite heart and Save
   * draft, components/forms/form-header-actions.tsx), on the title's row.
   * Without a header to sit in they get a slim right-aligned row of their own.
   */
  actions?: React.ReactNode
}) {
  const { logoUrl } = useWorkspaceBrand(null)
  const header = withThemeHeaderText(own, overrides?.header)
  const alone = actions ? <div className="-mt-1 mb-2 flex justify-end empty:hidden">{actions}</div> : null
  if (!header?.enabled) return alone
  const src = headerImageSrc(header, logoUrl)
  const image = src ? resolveStorageUrl(src) ?? src : null
  const title = resolveHeaderText(header.title, values, task)
  const subtitle = resolveHeaderText(header.subtitle, values, task)
  // The banner colour comes from the mini theme (made legible by onColor).
  const banner = header.banner ? formHeaderColors(overrides ? { ...overrides, header: { ...overrides.header, enabled: true } } : null) : null
  if (!image && !title && !subtitle) return alone
  const center = header.align === 'center'
  return (
    // Flush with the top of the card: no top padding unless the header is a coloured banner.
    <div
      className={cn('mb-5 flex items-center gap-3', banner ? 'rounded-lg px-4 py-3' : 'border-b border-border-subtle pb-4', center ? 'flex-col text-center' : 'max-sm:flex-wrap max-sm:gap-y-1.5')}
      style={banner ? { backgroundColor: banner.background, color: banner.text } : undefined}
      data-form-header
    >
      {/* Centred: the icons keep the top-right corner, the logo and title centre below them. */}
      {actions && center && <div className="-mb-3 -mr-2 -mt-1 self-end empty:hidden">{actions}</div>}
      {image && (
        // eslint-disable-next-line @next/next/no-img-element -- the UserTasks mark, the workspace logo or an uploaded header image (own storage)
        <img src={image} alt={header.image_alt ?? ''} className="h-10 w-auto max-w-[112px] shrink-0 object-contain sm:max-w-[160px]" />
      )}
      {/* Phones (left aligned): logo, title and icons share the first row; the subtitle takes the full width below. */}
      <div className={cn('min-w-0', !center && 'flex-1 max-sm:contents')}>
        {title && <h2 className={cn('break-words text-lg font-semibold leading-tight', !banner && 'text-fg', !center && 'max-sm:min-w-0 max-sm:flex-1')}>{title}</h2>}
        {subtitle && <p className={cn('mt-0.5 text-sm', banner ? 'opacity-90' : 'text-fg-muted', !center && 'max-sm:order-last max-sm:mt-0 max-sm:basis-full')}>{subtitle}</p>}
      </div>
      {actions && !center && <div className="-my-1 -mr-2 shrink-0 self-start empty:hidden max-sm:self-center">{actions}</div>}
    </div>
  )
}

const VARIANT: Record<FormButton['style'], 'primary' | 'secondary' | 'danger'> = { primary: 'primary', secondary: 'secondary', danger: 'danger' }

export function FormButtonBar({ buttons, placement = 'right', busy, disabled, onClick }: {
  buttons: FormButton[]
  placement?: ButtonPlacement
  /** Id of the button whose action is running. */
  busy?: string | null
  disabled?: boolean
  onClick: (button: FormButton) => void
}) {
  // A step before the last of a steps form: only Save draft (the rest wait for the final step).
  const phase = useStepPhase()
  // In-form buttons press these (Submit / Save draft), shown or not.
  const runtime = useFormRuntime()
  // Form animations: a press state (app/form-motion.css). The running button always shows a spinner (a busy signal, not decoration).
  const motion = useFormMotion()
  // Before-submit rules run first (they may set values, or block with a message); the bar's own pipeline then validates and submits.
  // The surface's latest handler (a rule's values are applied by the time it runs).
  const latest = useRef(onClick)
  useLayoutEffect(() => { latest.current = onClick })
  const press = (button: FormButton) => {
    // When to load (lib/forms/lazy-load.ts): a submit first loads the shown lazy parts holding required fields, so their errors show in mounted controls.
    if (button.kind === 'submit' || button.kind === 'outcome') runtime?.lazy.current?.loadForSubmit()
    const rules = runtime?.rules.current
    if (!rules || (button.kind !== 'submit' && button.kind !== 'outcome')) { onClick(button); return }
    void rules.beforeSubmit(button.id).then((ok) => { if (ok) setTimeout(() => latest.current(button), 0) })
  }
  useRegisterBar({ buttons, onClick: press, disabled: disabled || Boolean(busy) })
  // Application mode: the bar is not shown on any page.
  if (runtime && isApplicationMode(runtime.layout)) return null
  const shown = buttons.filter((b) => !b.hidden && (phase === 'final' || b.kind === 'draft'))
  if (!shown.length) return null
  return (
    <div
      className={cn('mt-5 flex flex-wrap gap-2', placement === 'left' && 'justify-start', placement === 'right' && 'justify-end', placement === 'full' && 'flex-col sm:flex-row')}
      data-form-buttons={placement}
      {...motionAttrs(motion.level)}
    >
      {shown.map((button) => (
        <Button
          key={button.id}
          type="button"
          variant={VARIANT[button.style]}
          disabled={disabled || Boolean(busy)}
          aria-busy={busy === button.id || undefined}
          loading={busy === button.id}
          onClick={() => press(button)}
          className={cn(placement === 'full' && 'w-full sm:flex-1')}
          data-form-button={button.id}
        >
          {button.label}
        </Button>
      ))}
    </div>
  )
}

export function FormMessages({ messages, onDismiss }: { messages: ButtonEffects['messages']; onDismiss?: (index: number) => void }) {
  const motion = useFormMotion()
  if (!messages.length) return null
  return (
    <div className="mt-3 space-y-2" aria-live="polite" {...motionAttrs(motion.level)}>
      {messages.map((m, i) => (
        <div key={i} role="status" className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm bg-primary-wash text-fg', m.tone === 'success' ? 'border-success' : 'border-border')}
          data-form-message>
          {m.tone === 'success' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-primary-text" aria-hidden /> : <Info size={16} className="mt-0.5 shrink-0" aria-hidden />}
          <span className="flex-1 whitespace-pre-wrap">{m.text}</span>
          {onDismiss && (
            <button type="button" onClick={() => onDismiss(i)} aria-label="Dismiss" className="rounded p-0.5 hover:opacity-80"><X size={14} aria-hidden /></button>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * After a submission: the form's Submitted page or a button's success
 * screen (components/forms/submitted-page-view.tsx). `messages` (the button messages / rule banners) show on a Submitted page;
 * a button's own screen keeps its older look without them.
 */
export function FormSuccessScreen({ screen, onSubmitAnother, onClose, messages, autoFocus }: {
  screen: NonNullable<ButtonEffects['success_screen']>
  onSubmitAnother?: () => void
  onClose?: () => void
  messages?: ButtonEffects['messages']
  autoFocus?: boolean
}) {
  return (
    <SubmittedPageView screen={screen} onSubmitAnother={onSubmitAnother} onClose={onClose} autoFocus={autoFocus}
      messages={screen.source === 'form' && messages?.length ? <FormMessages messages={messages} /> : undefined} />
  )
}

/**
 * Registers a surface's own submit buttons for in-form Buttons (Submit)
 * without drawing a bar — the test runner's outcome buttons, which sit
 * outside the form.
 */
export function FormBarRegistration({ buttons, onClick, disabled }: { buttons: FormButton[]; onClick: (button: FormButton) => void; disabled?: boolean }) {
  useRegisterBar({ buttons, onClick, disabled })
  return null
}
