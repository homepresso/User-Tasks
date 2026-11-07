'use client'

import { useEffect, useId, useRef } from 'react'
import {
  BadgeCheck, CalendarCheck, CircleCheck, ClipboardCheck, Heart, MailCheck, PartyPopper, Rocket, Send, Star, ThumbsUp, Trophy, type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ButtonEffects } from '@/lib/forms/buttons'
import { screenButtons, type SubmittedPageIconName } from '@/lib/forms/submitted-page'
import { resolveStorageUrl } from '@/lib/storage/refs'
import { cn } from '@/lib/utils'
import { showConfetti } from '@/lib/forms/motion'
import { ConfettiBurst, motionAttrs, useFormMotion } from './form-motion'

/** The curated success icons (lib/forms/submitted-page.ts names → Lucide). */
export const SUBMITTED_ICON_COMPONENTS: Record<SubmittedPageIconName, LucideIcon> = {
  check_circle: CircleCheck, party: PartyPopper, mail_sent: MailCheck, calendar_check: CalendarCheck, thumbs_up: ThumbsUp,
  clipboard_check: ClipboardCheck, badge_check: BadgeCheck, send: Send, heart: Heart, star: Star, trophy: Trophy, rocket: Rocket,
}

/** The icon colour: the form theme's success / primary colour, or a #hex. */
export function submittedIconColor(color: string | undefined): string {
  if (color === 'primary') return 'var(--theme-primary-text, var(--theme-primary))'
  if (color && color.startsWith('#')) return color
  return 'var(--theme-success, var(--status-done, var(--theme-primary)))'
}

type Screen = NonNullable<ButtonEffects['success_screen']>

function ScreenIcon({ icon }: { icon: Screen['icon'] }) {
  if (!icon) return null
  if (icon.kind === 'image') {
    const src = resolveStorageUrl(icon.url) ?? icon.url
    // eslint-disable-next-line @next/next/no-img-element -- an uploaded success image (own storage)
    return <img src={src} alt={icon.alt ?? ''} className="submitted-page-icon h-16 w-auto max-w-[180px] object-contain" data-submitted-icon="image" />
  }
  const Icon = SUBMITTED_ICON_COMPONENTS[icon.name as SubmittedPageIconName] ?? CircleCheck
  const color = submittedIconColor(icon.color)
  return (
    <span className="submitted-page-icon flex h-16 w-16 items-center justify-center rounded-full" aria-hidden
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)` }} data-submitted-icon={icon.name}>
      <Icon size={34} strokeWidth={2} />
    </span>
  )
}

/**
 * What replaces a form once it is submitted: the form's Submitted page
 * (icon, heading, subheading, a summary of answers, a note, "Submit another
 * response" / "Close form") or a button's own success screen. A centred
 * card in the form theme; the heading takes focus and the texts are
 * announced (role="status"); the entrance animation only runs when motion
 * is welcome (app/globals.css).
 */
export function SubmittedPageView({ screen, messages, onSubmitAnother, onClose, autoFocus = true }: {
  screen: Screen
  /** Button messages / rule banners kept beside the page. */
  messages?: React.ReactNode
  onSubmitAnother?: () => void
  /** "Close form": the surface decides (a page goes to the dashboard, a dialog / pane closes). */
  onClose?: () => void
  /** Move focus to the heading when shown (off in the designer's preview list). */
  autoFocus?: boolean
}) {
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (autoFocus) headingRef.current?.focus() }, [autoFocus])
  const buttons = screenButtons(screen).filter((b) => (b.kind === 'submit_another' ? Boolean(onSubmitAnother) : b.kind === 'close' ? Boolean(onClose) : Boolean(b.url)))
  const page = screen.source === 'form'
  // Form animations (app/form-motion.css): the icon pops (Expressive: its strokes draw in), then the heading;
  // Expressive with confetti adds a light burst on a success-tone page.
  const motion = useFormMotion()
  const confetti = showConfetti(motion, motion.level, screen)
  return (
    <section aria-labelledby={headingId} className={cn('submitted-page-enter relative mx-auto flex w-full max-w-lg flex-col items-center gap-3 text-center', page ? 'py-8 sm:py-12' : 'py-10')}
      data-form-success={page ? 'page' : 'screen'} {...motionAttrs(motion.level)}>
      {confetti && <ConfettiBurst />}
      {page ? <ScreenIcon icon={screen.icon} /> : <ScreenIcon icon={{ kind: 'icon', name: 'check_circle', color: 'primary' }} />}
      <div role="status" aria-live="polite" className="space-y-1.5">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="font-display text-2xl font-semibold leading-tight tracking-tight text-fg outline-none sm:text-3xl [[data-form-font]_&]:font-[inherit]" data-submitted-heading>
          {screen.title}
        </h2>
        {screen.text && <p className="whitespace-pre-wrap text-sm sm:text-base text-fg-muted" data-submitted-subheading>{screen.text}</p>}
      </div>
      {screen.summary && screen.summary.length > 0 && (
        <dl className="mt-2 w-full divide-y divide-border-subtle rounded-lg border border-border text-left text-sm" data-submitted-summary>
          {screen.summary.map((row, i) => (
            <div key={i} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-3">
              <dt className="shrink-0 font-medium sm:w-2/5 text-fg-muted">{row.label}</dt>
              <dd className="min-w-0 break-words text-fg">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {screen.note && <p className="whitespace-pre-wrap text-xs sm:text-sm text-fg-muted" data-submitted-note>{screen.note}</p>}
      {messages && <div className="w-full text-left">{messages}</div>}
      {buttons.length > 0 && (
        <div className="mt-2 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-center" data-submitted-buttons>
          {buttons.map((b, i) => {
            const primary = b.kind !== 'close' && i === buttons.findIndex((x) => x.kind !== 'close')
            if (b.kind === 'link') {
              return <Button key={i} asChild variant={primary ? 'primary' : 'secondary'} className="w-full sm:w-auto"><a href={b.url} data-form-success-action="link">{b.label}</a></Button>
            }
            return (
              <Button key={i} type="button" variant={primary ? 'primary' : 'secondary'} className="w-full sm:w-auto"
                onClick={b.kind === 'submit_another' ? onSubmitAnother : onClose} data-form-success-action={b.kind}>
                {b.label}
              </Button>
            )
          })}
        </div>
      )}
    </section>
  )
}
