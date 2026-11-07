'use client'

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info, X, XCircle, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { motionAttrs, useFormMotion } from './form-motion'
import { inheritedThemeStyle } from '@/components/ui/floating-layer'
import type { MessageDisplay, PromptRequest } from '@/lib/forms/field-buttons'
import {
  AutoHideTimer, DISMISSED_RESPONSE, accessibleName, afterNextAction, bannerRole, visibleBanners,
  type BannerItem, type MessageTone,
} from '@/lib/forms/form-messages'

/**
 * The form's message centre (lib/forms/form-messages.ts): banners at the
 * top of the form and questions ("Ask a question"), shared by form rules
 * and in-form Buttons on every surface (task forms, /f/ pages, start forms,
 * the Run dialog, Save & Test, the designer preview — the renderer wraps
 * its editable views in <FormMessagesScope>).
 *
 *  - Banners stack at the top of the form, sticky inside its scroll
 *    container; at most MAX_VISIBLE_BANNERS show, older ones collapse into
 *    "N more". The stack's height is published as --form-banner-offset so a
 *    focused input scrolls clear of it (scroll-margin-top, app/globals.css).
 *  - Each banner: role=status (info / success) or role=alert (warning /
 *    error), a tone icon, theme colours (light / dark / form themes), and
 *    a duration — until dismissed, auto-hide (paused while hovered or
 *    focused, WCAG 2.2.1), until the person's next action, or sticky.
 *  - Questions: one at a time (queued). A banner question is a non-modal
 *    role=alertdialog in the stack; a dialog question is modal (focus
 *    trapped). Focus moves to the first button, Escape answers the
 *    question's Escape response, and focus returns where it was.
 */

export interface FormMessagesApi {
  /** A banner at the top of the form. */
  show: (text: string, tone: MessageTone, display: MessageDisplay) => void
  /** Ask a question; resolves with the response (DISMISSED_RESPONSE when the form goes away). */
  ask: (request: PromptRequest) => Promise<string>
  /** Bumped on each action of the person (a pointer down or a key outside the banners). */
  actionTick: number
}

const MessagesContext = createContext<FormMessagesApi | null>(null)

export function useFormMessages(): FormMessagesApi | null {
  return useContext(MessagesContext)
}

export const TONE_COLOR: Record<MessageTone, string> = {
  info: 'var(--theme-info, var(--status-info, var(--theme-primary-text)))',
  success: 'var(--theme-success, var(--status-done))',
  warning: 'var(--theme-warning, var(--status-warning))',
  error: 'var(--status-blocked, var(--theme-danger))',
}
const TONE_ICON: Record<MessageTone, LucideIcon> = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle }

export function toneStyle(tone: MessageTone): React.CSSProperties {
  const c = TONE_COLOR[tone]
  return {
    borderColor: c,
    borderLeftWidth: 4,
    backgroundColor: `color-mix(in srgb, ${c} 10%, var(--theme-card-bg, #fff))`,
    color: 'var(--theme-card-text)',
  }
}

/** One banner (or an inline message with display options). */
export function MessageCard({ item, onClose, inline = false }: {
  item: Pick<BannerItem, 'text' | 'title' | 'tone' | 'duration' | 'seconds'>
  onClose: () => void
  inline?: boolean
}) {
  const close = useRef(onClose)
  // Form animations: the banner fades up and out before it goes (app/form-motion.css).
  const motion = useFormMotion()
  const [leaving, setLeaving] = useState(false)
  const leave = useRef(() => {})
  useLayoutEffect(() => {
    close.current = onClose
    leave.current = motion.on
      ? () => { setLeaving(true); window.setTimeout(() => close.current(), motion.level === 'expressive' ? 240 : 180) }
      : () => close.current()
  })
  const timer = useRef<AutoHideTimer | null>(null)
  useEffect(() => {
    if (item.duration !== 'auto') return
    const t = new AutoHideTimer((item.seconds ?? 6) * 1000, () => leave.current())
    timer.current = t
    t.start()
    return () => t.stop()
  }, [item.duration, item.seconds])
  const Icon = TONE_ICON[item.tone]
  const titleId = useId()
  return (
    <div
      role={bannerRole(item.tone)}
      aria-labelledby={item.title ? titleId : undefined}
      className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-sm"
      style={toneStyle(item.tone)}
      onMouseEnter={() => timer.current?.pause('hover')}
      onMouseLeave={() => timer.current?.resume('hover')}
      onFocus={() => timer.current?.pause('focus')}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) timer.current?.resume('focus') }}
      data-form-banner={item.tone}
      data-form-banner-duration={item.duration}
      data-form-message-inline={inline || undefined}
      data-fm-leaving={leaving || undefined}
    >
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden style={{ color: TONE_COLOR[item.tone] }} />
      <div className="min-w-0 flex-1">
        {item.title && <p id={titleId} className="font-semibold">{item.title}</p>}
        <p className="whitespace-pre-wrap">{item.text}</p>
      </div>
      {item.duration !== 'sticky' && (
        <button type="button" aria-label="Dismiss message" className="shrink-0 rounded p-0.5 hover:opacity-80 focus-visible:outline-2" onClick={() => leave.current()} data-form-banner-close>
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  )
}

const BUTTON_VARIANT = { primary: 'default', secondary: 'outline', danger: 'destructive' } as const

function PromptButtons({ request, onAnswer, firstRef }: { request: PromptRequest; onAnswer: (value: string) => void; firstRef: React.RefObject<HTMLButtonElement | null> }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {request.buttons.map((b, i) => (
        <Button key={b.value} ref={i === 0 ? firstRef : undefined} type="button" size="sm" variant={BUTTON_VARIANT[b.style ?? 'secondary']} onClick={() => onAnswer(b.value)} data-prompt-response={b.value}>
          {b.label}
        </Button>
      ))}
    </div>
  )
}

/** A question as a banner: non-modal alertdialog, focus to the first button, Escape answers, focus returns. */
function PromptBanner({ request, onAnswer }: { request: PromptRequest; onAnswer: (value: string) => void }) {
  const first = useRef<HTMLButtonElement | null>(null)
  const ids = { title: useId(), text: useId() }
  useEffect(() => { first.current?.focus() }, [])
  const Icon = TONE_ICON[request.tone]
  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={request.title ? ids.title : ids.text}
      aria-describedby={request.title ? ids.text : undefined}
      aria-label={accessibleName(request.title, request.text) ? undefined : 'Question'}
      className="space-y-2 rounded-lg border px-3 py-2 text-sm shadow-sm"
      style={toneStyle(request.tone)}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onAnswer(request.escape) } }}
      data-form-prompt="banner"
    >
      <div className="flex items-start gap-2">
        <Icon size={16} className="mt-0.5 shrink-0" aria-hidden style={{ color: TONE_COLOR[request.tone] }} />
        <div className="min-w-0 flex-1">
          {request.title && <p id={ids.title} className="font-semibold">{request.title}</p>}
          <p id={ids.text} className="whitespace-pre-wrap">{request.text}</p>
        </div>
      </div>
      <PromptButtons request={request} onAnswer={onAnswer} firstRef={first} />
    </div>
  )
}

/** A question as a modal dialog (Radix: focus trapped, background inert); Escape answers, outside clicks do nothing. */
function PromptDialog({ request, onAnswer, anchor }: { request: PromptRequest; onAnswer: (value: string) => void; anchor: React.RefObject<HTMLElement | null> }) {
  const first = useRef<HTMLButtonElement | null>(null)
  const [themeStyle] = useState<React.CSSProperties>(() => (anchor.current ? inheritedThemeStyle(anchor.current) : {}))
  const Icon = TONE_ICON[request.tone]
  const name = accessibleName(request.title, request.text)
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onAnswer(request.escape) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="ds-overlay fixed inset-0 z-[60] bg-[color:var(--theme-overlay)] backdrop-blur-[2px]" />
        <Dialog.Content
          role="alertdialog"
          aria-modal="true"
          className="fixed left-1/2 top-1/2 z-[60] w-[min(26rem,92vw)] -translate-x-1/2 -translate-y-1/2 space-y-3 rounded-xl border p-5 shadow-xl dialog-content bg-panel text-fg border-border"
          style={{ ...themeStyle }}
          onOpenAutoFocus={(e) => { e.preventDefault(); first.current?.focus() }}
          onEscapeKeyDown={(e) => { e.preventDefault(); onAnswer(request.escape) }}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          data-form-prompt="dialog"
        >
          <div className="flex items-start gap-2">
            <Icon size={18} className="mt-0.5 shrink-0" aria-hidden style={{ color: TONE_COLOR[request.tone] }} />
            <div className="min-w-0 flex-1 space-y-1">
              <Dialog.Title className={request.title ? 'text-base font-semibold' : 'sr-only'}>{request.title || name || 'Question'}</Dialog.Title>
              <Dialog.Description className="whitespace-pre-wrap text-sm">{request.text}</Dialog.Description>
            </div>
          </div>
          <PromptButtons request={request} onAnswer={onAnswer} firstRef={first} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

interface QueuedPrompt { key: number; request: PromptRequest; resolve: (value: string) => void; returnFocus: Element | null }

/**
 * Provides the message centre to a form. `enabled` false renders the
 * children as they are (forms without rules or buttons stay unchanged).
 */
export function FormMessagesScope({ enabled = true, children }: { enabled?: boolean; children: React.ReactNode }) {
  const [banners, setBanners] = useState<Array<BannerItem & { tick: number }>>([])
  const [prompts, setPrompts] = useState<QueuedPrompt[]>([])
  const [expanded, setExpanded] = useState(false)
  const [tick, setTick] = useState(0)
  const [offset, setOffset] = useState(0)
  const motion = useFormMotion()
  const tickRef = useRef(0)
  const stack = useRef<HTMLDivElement | null>(null)
  const anchor = useRef<HTMLDivElement | null>(null)
  const seq = useRef(0)
  const pending = useRef<QueuedPrompt[]>([])

  const show = useCallback((text: string, tone: MessageTone, display: MessageDisplay) => {
    if (!text && !display.title) return
    seq.current += 1
    const item = { id: seq.current, text, tone, duration: display.duration, ...(display.title ? { title: display.title } : {}), ...(display.seconds ? { seconds: display.seconds } : {}), tick: tickRef.current }
    setBanners((prev) => [...prev.slice(-19), item])
  }, [])

  const ask = useCallback((request: PromptRequest) => new Promise<string>((resolve) => {
    seq.current += 1
    const entry: QueuedPrompt = { key: seq.current, request, resolve, returnFocus: typeof document !== 'undefined' ? document.activeElement : null }
    pending.current = [...pending.current, entry]
    setPrompts(pending.current)
  }), [])

  const answer = useCallback((key: number, value: string) => {
    const entry = pending.current.find((p) => p.key === key)
    if (!entry) return
    pending.current = pending.current.filter((p) => p.key !== key)
    setPrompts(pending.current)
    entry.resolve(value)
    // Focus goes back where it was (a dialog's own return is turned off so this one wins).
    const back = entry.returnFocus
    if (back instanceof HTMLElement && back.isConnected) requestAnimationFrame(() => { if (!pending.current.length) back.focus() })
  }, [])

  // Questions still open when the form goes away answer "dismissed" (the run stops).
  useEffect(() => () => { for (const p of pending.current) p.resolve(DISMISSED_RESPONSE); pending.current = [] }, [])

  // "Until the next action": a pointer down or a key outside the banners.
  const onAction = useCallback((e: React.SyntheticEvent) => {
    if (stack.current?.contains(e.target as Node)) return
    if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes((e as React.KeyboardEvent).key)) return
    tickRef.current += 1
    setTick(tickRef.current)
    setBanners((prev) => afterNextAction(prev))
  }, [])

  // The stack's height → --form-banner-offset (focused inputs scroll clear of it).
  useLayoutEffect(() => {
    const el = stack.current
    // eslint-disable-next-line react-hooks/set-state-in-effect -- no stack to measure: the offset resets once
    if (!el || typeof ResizeObserver === 'undefined') { setOffset(0); return }
    const ro = new ResizeObserver(() => setOffset(Math.ceil(el.getBoundingClientRect().height)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [banners.length, prompts.length])

  const api = useMemo<FormMessagesApi>(() => ({ show, ask, actionTick: tick }), [show, ask, tick])
  if (!enabled) return <>{children}</>

  const current = prompts[0] ?? null
  const { shown, collapsed } = visibleBanners(banners, expanded)
  const hasStack = shown.length > 0 || current?.request.display === 'banner'
  return (
    <MessagesContext.Provider value={api}>
      <div
        ref={anchor}
        className="contents"
        style={{ ['--form-banner-offset' as string]: `${hasStack ? offset : 0}px` }}
        onPointerDownCapture={onAction}
        onKeyDownCapture={onAction}
        data-form-messages
      >
        {hasStack && (
          <div ref={stack} className="sticky top-0 z-20 mb-3 space-y-2 py-1" style={{ backgroundColor: 'transparent' }} data-form-banners {...motionAttrs(motion.level)}>
            {collapsed > 0 && (
              <button type="button" className="flex items-center gap-1 text-2xs font-medium text-fg-muted" aria-expanded={false} onClick={() => setExpanded(true)} data-form-banners-more>
                <ChevronDown size={12} aria-hidden /> {collapsed} earlier message{collapsed === 1 ? '' : 's'}
              </button>
            )}
            {expanded && banners.length > 3 && (
              <button type="button" className="flex items-center gap-1 text-2xs font-medium text-fg-muted" aria-expanded onClick={() => setExpanded(false)}>
                <ChevronUp size={12} aria-hidden /> Show fewer
              </button>
            )}
            {shown.map((b) => (
              <MessageCard key={b.id} item={b} onClose={() => setBanners((prev) => prev.filter((x) => x.id !== b.id))} />
            ))}
            {current?.request.display === 'banner' && <PromptBanner key={current.key} request={current.request} onAnswer={(v) => answer(current.key, v)} />}
          </div>
        )}
        {children}
        {current?.request.display === 'dialog' && <PromptDialog key={current.key} request={current.request} anchor={anchor} onAnswer={(v) => answer(current.key, v)} />}
      </div>
    </MessagesContext.Provider>
  )
}
