'use client'

import { useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ExternalLink, Eye, EyeOff, Info, List, Minus, Pencil, Plus,
  Loader2, Printer, RotateCcw, Save, Send, X, type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { runFieldButton, toggleTargets, toggledFlag, type FieldButtonConfig, type FieldButtonIcon, type MessageDisplay } from '@/lib/forms/field-buttons'
import type { MessageTone } from '@/lib/forms/form-messages'
import { MessageCard, useFormMessages } from './form-messages'
import { buildActionHost } from './action-host'
import { useFormRules } from './form-rules-runtime'
import { isTargetShown, readFormState, sectionBoundaryKeys, targetFieldKeys } from '@/lib/forms/form-state'
import { isPaged, type FormLayout } from '@/lib/forms/layout'
import { isRuleMet, type TaskFieldDef } from '@/lib/task-field-schema'
import { cn } from '@/lib/utils'
import { useFormPager } from './form-pages'
import { useFormRuntime } from './form-runtime'
import { useFormLookupSource } from './lookup-field'

/**
 * The "Button" element on the grid: a real <button> that runs its actions
 * (lib/forms/field-buttons.ts) through this surface — the values and form
 * state (via onChange), the pager (steps / tabs), the surface's button bar
 * (Submit / Save draft press the bar's button, so validation and effects
 * are the surface's own). Toggles announce aria-expanded and point
 * aria-controls at what they show / hide; a confirm prompt asks inline
 * (role=alertdialog) before anything runs; messages are a polite status
 * under the button, or banners / questions through the form's message
 * centre (components/forms/form-messages.tsx).
 */

const ICONS: Record<FieldButtonIcon, LucideIcon> = {
  'chevron-right': ChevronRight, 'chevron-left': ChevronLeft, 'arrow-right': ArrowRight, 'arrow-left': ArrowLeft,
  'chevron-down': ChevronDown, 'chevron-up': ChevronUp, eye: Eye, 'eye-off': EyeOff, check: Check, send: Send, save: Save,
  printer: Printer, 'external-link': ExternalLink, plus: Plus, minus: Minus, 'rotate-ccw': RotateCcw, info: Info, x: X, pencil: Pencil, list: List,
}

export function FieldButtonIconView({ icon, size = 14 }: { icon?: FieldButtonIcon; size?: number }) {
  const Icon = icon ? ICONS[icon] : null
  return Icon ? <Icon size={size} aria-hidden /> : null
}

const STYLE: Record<FieldButtonConfig['style'], { variant: 'primary' | 'secondary' | 'ghost' | 'danger'; className?: string }> = {
  primary: { variant: 'primary' },
  secondary: { variant: 'secondary', className: 'border-transparent bg-primary-wash text-primary-text hover:border-transparent hover:bg-primary-wash hover:brightness-95' },
  outline: { variant: 'secondary' },
  link: { variant: 'ghost', className: 'px-1 text-primary-text underline underline-offset-2' },
  danger: { variant: 'danger' },
}

/** Element ids a target covers (aria-controls). */
function controlledIds(layout: FormLayout | null | undefined, fields: TaskFieldDef[], targets: string[], idPrefix: string): string {
  const headings = sectionBoundaryKeys(fields)
  const ids = new Set<string>()
  for (const target of targets) {
    if (target.startsWith('page:')) { if (isPaged(layout)) ids.add(`${idPrefix}${layout?.mode === 'tabs' ? 'tab' : 'step'}-${target.slice(5)}`); continue }
    for (const key of targetFieldKeys(layout, target, headings)) ids.add(`${idPrefix}cell-${key}`)
  }
  return [...ids].join(' ')
}

export function FieldButtonCell({ field, fields, layout, values, onChange, idPrefix, disabled }: {
  field: TaskFieldDef
  fields: TaskFieldDef[]
  /** The whole form's layout (targets, pages). */
  layout: FormLayout | null | undefined
  /** Values with the form state (withFormState). */
  values: Record<string, unknown>
  onChange?: (key: string, value: unknown) => void
  idPrefix: string
  disabled?: boolean
}) {
  const config = field.button
  const pager = useFormPager()
  const runtime = useFormRuntime()
  const guard = useSubmitGuard()
  const source = useFormLookupSource()
  const rules = useFormRules()
  const [confirming, setConfirming] = useState(false)
  const center = useFormMessages()
  const [messages, setMessages] = useState<Array<{ text: string; tone: MessageTone; display?: MessageDisplay; tick?: number }>>([])
  // Latest render's view (an action that waited for React reads fresh values / pager).
  const live = useRef({ values, pager, runtime, onChange })
  // eslint-disable-next-line react-hooks/refs -- the latest render's view for actions that await (read later, never during render)
  live.current = { values, pager, runtime, onChange }
  const id = `${idPrefix}${field.key}`
  if (!config) return null

  const state = readFormState(layout, values)
  const toggles = toggleTargets(config)
  const flag = toggledFlag(config)
  const expanded = toggles ? toggles.every((t) => isTargetShown(state, t)) : flag ? state.flags[flag] === true : undefined
  // "Enabled only when a row in <list> is selected" (list.selectable): the count rules read.
  const noSelection = Boolean(config.requires_selection) && !(Number(values[`${config.requires_selection}_selected_count`]) > 0)
  const isDisabled = Boolean(disabled || !onChange || guard.pending || noSelection || isRuleMet(config.disabled_when ?? null, values) && Boolean(config.disabled_when))
  const look = STYLE[config.style]
  const size = config.size === 'sm' ? 'sm' : config.size === 'lg' ? 'lg' : 'default'

  // eslint-disable-next-line react-hooks/refs -- the host keeps the ref and reads it when an action runs, not now
  const host = buildActionHost({
    live, fields, layout, idPrefix, source,
    message: (text, tone, display) => {
      if (display?.style === 'banner' && center) center.show(text, tone, display)
      else setMessages((prev) => [...prev.slice(-2), { text, tone, ...(display ? { display, tick: center?.actionTick ?? 0 } : {}) }])
    },
    owner: { kind: 'button', key: field.key },
    ...(center ? { ask: center.ask } : {}),
    answered: ({ id, response, label }) => rules?.dispatch({ type: 'message_answered', ...(id ? { target: id } : {}), context: { message: id ?? null, response, label } }),
  })

  async function run() {
    setConfirming(false)
    await guard.run(async () => {
      const result = await runFieldButton(config!, host)
      // Form rules on "Button clicked" run after the button's own steps.
      // Awaited: the button shows it is busy while its rules run (a table / API step waiting for the server).
      if (!result.stopped && rules) await rules.run({ type: 'button_click', target: field.key, context: { button: field.key } })
      if (result.stopped === 'submit_unavailable') setMessages((prev) => [...prev, { text: 'Submitting is not available here.', tone: 'info' }])
      if (result.stopped === 'draft_unavailable') setMessages((prev) => [...prev, { text: 'Saving a draft is not available on this form.', tone: 'info' }])
      if (result.stopped === 'link_not_allowed') setMessages((prev) => [...prev, { text: 'That link is not allowed.', tone: 'info' }])
    })
  }

  const align = config.full_width ? '' : config.align === 'center' ? 'justify-center' : config.align === 'right' ? 'justify-end' : 'justify-start'
  // A disclosure's chevron turns when what it toggles is shown.
  const shownIcon = expanded && config.icon === 'chevron-down' ? 'chevron-up' : config.icon
  const icon = <FieldButtonIconView icon={shownIcon} size={size === 'sm' ? 12 : 14} />
  return (
    <div className="flex flex-col gap-1" data-field-button={field.key}>
      <div className={cn('flex', align)}>
        <Button
          id={id}
          type="button"
          variant={look.variant}
          size={size}
          className={cn(config.full_width && 'w-full', look.className)}
          disabled={isDisabled}
          aria-busy={guard.pending || undefined}
          aria-expanded={expanded}
          aria-controls={toggles ? controlledIds(layout, fields, toggles, idPrefix) || undefined : undefined}
          aria-describedby={config.tooltip ? `${id}-tip` : undefined}
          title={config.tooltip}
          onClick={() => { if (config.confirm) setConfirming(true); else void run() }}
          data-field-button-style={config.style}
        >
          {guard.pending ? <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin" aria-hidden data-field-button-busy /> : !config.icon_after && icon}
          {field.label}
          {config.icon_after && icon}
        </Button>
      </div>
      {config.tooltip && <span id={`${id}-tip`} className="sr-only">{config.tooltip}</span>}
      {confirming && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm border-border text-fg" role="alertdialog" aria-label={config.confirm} data-field-button-confirm>
          <span className="flex-1">{config.confirm}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(false)} autoFocus>Cancel</Button>
          <Button type="button" size="sm" onClick={() => void run()}>Continue</Button>
        </div>
      )}
      {messages.length > 0 && (
        <div aria-live="polite" className="space-y-1">
          {messages.map((m, i) => m.display ? (
            m.display.duration === 'next_action' && (m.tick ?? 0) < (center?.actionTick ?? 0) ? null : (
              <MessageCard key={i} inline item={{ text: m.text, tone: m.tone, duration: m.display.duration, ...(m.display.title ? { title: m.display.title } : {}), ...(m.display.seconds ? { seconds: m.display.seconds } : {}) }}
                onClose={() => setMessages((prev) => prev.filter((_, j) => j !== i))} />
            )
          ) : (
            <p key={i} role="status" className="flex items-start gap-1.5 text-xs text-fg" data-field-button-message>
              {m.tone === 'success' ? <Check size={12} className="mt-0.5 text-primary-text" aria-hidden /> : <Info size={12} className="mt-0.5" aria-hidden />}
              <span className="flex-1 whitespace-pre-wrap">{m.text}</span>
              <button type="button" aria-label="Dismiss" className="rounded p-0.5 hover:opacity-80" onClick={() => setMessages((prev) => prev.filter((_, j) => j !== i))}><X size={11} aria-hidden /></button>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
