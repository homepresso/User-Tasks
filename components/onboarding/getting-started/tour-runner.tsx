'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import {
  onStepPath, placeCard, resolveStepTarget, stepAnnouncement, tourById, tourKeyAction, tourSteps, trapFocusIndex,
  type Rect,
} from '@/lib/onboarding/tours'

/**
 * A WalkMe-style spotlight tour (desktop): the page is dimmed except the
 * step's element, with a tooltip card beside it. Steps can go to another
 * page first, wait for their element (up to WAIT_MS), and fall back to a
 * centred card when it never shows. The card is a modal dialog: focus stays
 * in it (Tab wraps), Esc exits, ← / → step, and each step is announced in a
 * polite live region. Motion follows prefers-reduced-motion.
 *
 * A `hint` step (after "Open the gallery") is light: a pulsing ring and a
 * bubble over an element inside another dialog, no dimming, no focus, and
 * it ends when the element is clicked or goes away.
 */

const WAIT_MS = 3500
const PAD = 6
const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

export type TourExit = 'finished' | 'handoff' | 'skipped'

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** The overlay path: the viewport, minus a rounded hole over the element. */
function shadePath(vw: number, vh: number, hole: Rect | null): string {
  const outer = `M0 0H${vw}V${vh}H0Z`
  if (!hole) return outer
  const r = Math.min(8, hole.width / 2, hole.height / 2)
  const { left: x, top: y, width: w, height: h } = hole
  return `${outer}M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
}

function rectOf(el: Element | null): Rect | null {
  if (!el || !el.isConnected) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
}

export function TourRunner({ tourId, agentAvailable, onExit }: { tourId: string; agentAvailable: boolean; onExit: (how: TourExit) => void }) {
  const tour = tourById(tourId)
  const steps = useMemo(() => (tour ? tourSteps(tour, { agentAvailable }) : []), [tour, agentAvailable])
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const search = useSearchParams()?.toString() ?? ''
  const [index, setIndex] = useState(0)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [searching, setSearching] = useState(true)
  const [rect, setRect] = useState<Rect | null>(null)
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<Element | null>(null)
  const titleId = useId()
  const step = steps[index]
  const total = steps.filter((s) => !s.hint).length
  const exitRef = useRef(onExit)
  useLayoutEffect(() => { exitRef.current = onExit })

  useEffect(() => {
    returnFocus.current = document.activeElement
    return () => { (returnFocus.current as HTMLElement | null)?.focus?.() }
  }, [])

  // Go to the step's page, then wait for its element (or give up: centred card).
  useEffect(() => {
    if (!step) return
    /* eslint-disable react-hooks/set-state-in-effect -- a new step starts its search from scratch */
    setTarget(null)
    setRect(null)
    setSearching(Boolean(step.target))
    /* eslint-enable react-hooks/set-state-in-effect */
    if (!onStepPath(step, pathname, search)) {
      router.push(step.path!)
      return
    }
    if (!step.target) return
    let done = false
    const started = Date.now()
    const look = () => {
      if (done) return
      const el = resolveStepTarget<HTMLElement>(step, document)
      if (el) {
        done = true
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
        setTarget(el)
        setSearching(false)
      } else if (Date.now() - started > WAIT_MS) {
        done = true
        setSearching(false)
        // A hint whose element never appeared: nothing to point at, the tour hands over.
        if (step.hint) exitRef.current('handoff')
      }
    }
    look()
    const observer = new MutationObserver(look)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-tour', 'class', 'style', 'hidden'] })
    const timer = window.setInterval(look, 150)
    return () => { done = true; observer.disconnect(); window.clearInterval(timer) }
  }, [step, pathname, search, router])

  // Follow the element as the page scrolls, resizes or re-renders.
  useEffect(() => {
    if (!target) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const next = rectOf(target)
        setRect((prev) => (prev && next && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.height === next.height ? prev : next))
        if (!target.isConnected && step?.hint) exitRef.current('handoff')
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const ro = new ResizeObserver(update)
    ro.observe(target)
    const poll = window.setInterval(update, 400)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); ro.disconnect(); window.clearInterval(poll) }
  }, [target, step])

  // A hint ends when its element is clicked.
  useEffect(() => {
    if (!step?.hint || !target) return
    const click = () => exitRef.current('handoff')
    target.addEventListener('click', click)
    return () => target.removeEventListener('click', click)
  }, [step, target])

  // Place the card beside the element (or centred), inside the viewport.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card || !step) return
    const size = { width: card.offsetWidth, height: card.offsetHeight }
    const pos = placeCard(rect, size, { width: window.innerWidth, height: window.innerHeight }, step.placement)
    setCardPos({ top: pos.top, left: pos.left })
  }, [rect, step, index, searching])

  // Focus the card's primary button on each (non-hint) step.
  useEffect(() => {
    if (!step || step.hint || searching) return
    const t = window.setTimeout(() => cardRef.current?.querySelector<HTMLElement>('[data-tour-primary]')?.focus({ preventScroll: true }), 30)
    return () => window.clearTimeout(t)
  }, [step, index, searching])

  const next = useCallback(() => {
    if (!step || searching) return
    if (step.clickLabel && target) {
      const following = steps[index + 1]
      target.click()
      if (following?.hint) setIndex(index + 1)
      else exitRef.current('handoff')
      return
    }
    if (index + 1 >= steps.length || steps[index + 1]?.hint) exitRef.current('finished')
    else setIndex(index + 1)
  }, [step, target, steps, index, searching])
  const back = useCallback(() => { if (index > 0) setIndex(index - 1) }, [index])

  // Keyboard: Esc exits, arrows step, Tab stays in the card.
  useEffect(() => {
    if (!step || step.hint) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const card = cardRef.current
        if (!card) return
        const list = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE))
        const at = list.indexOf(document.activeElement as HTMLElement)
        const to = trapFocusIndex(at, list.length, e.shiftKey)
        if (to >= 0) { e.preventDefault(); list[to].focus() }
        return
      }
      const action = tourKeyAction(e.key)
      if (!action) return
      e.preventDefault()
      e.stopPropagation()
      if (action === 'exit') exitRef.current('skipped')
      else if (action === 'next') next()
      else back()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [step, next, back])

  if (!tour || !step) return null
  const announcement = searching ? '' : stepAnnouncement(tour, Math.min(index, total - 1), total, step, Boolean(rect))
  const live = <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>

  if (step.hint) {
    if (!rect) return createPortal(live, document.body)
    return createPortal(
      <div className="pointer-events-none fixed inset-0 z-[80]" data-tour-hint={step.target}>
        <div className="guide-spotlight-ring guide-hint-ring fixed rounded-lg" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />
        <div ref={cardRef} className="fixed max-w-[240px] rounded-lg bg-fg px-3 py-2 text-ui font-medium text-bg shadow-elev-3" style={cardPos ?? { top: rect.top, left: rect.left }}>
          {step.body}
        </div>
        {live}
      </div>,
      document.body,
    )
  }

  const hole = rect
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0
  const primaryLabel = step.clickLabel && rect ? step.clickLabel : index + 1 >= total ? 'Finish' : 'Next'

  return createPortal(
    <div className="fixed inset-0 z-[80]" data-tour-runner={tour.id} data-tour-step={index} data-tour-found={rect ? 'yes' : searching ? 'searching' : 'no'}>
      {/* The dimmed page, with a hole over the element (which stays clickable: only the painted area takes pointer events). */}
      <svg className="fixed inset-0 h-full w-full" width={vw} height={vh} aria-hidden data-tour-shade>
        <path fillRule="evenodd" d={shadePath(vw, vh, hole)} className="pointer-events-auto fill-[color:var(--theme-overlay)]" />
      </svg>
      {hole && <div className="guide-spotlight-ring pointer-events-none fixed rounded-lg" style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }} />}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed w-[min(340px,calc(100vw-24px))] rounded-xl border border-border bg-elevated p-4 text-fg shadow-elev-3 motion-safe:transition-[top,left] motion-safe:duration-[var(--ds-dur-base)]"
        style={cardPos ?? { top: '40%', left: '50%', transform: 'translate(-50%, -50%)' }}
        data-tour-card
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-2xs font-medium text-fg-muted">{tour.title} · {Math.min(index + 1, total)} of {total}</p>
            <h2 id={titleId} className="mt-1 text-sm font-semibold">{searching ? 'Finding it…' : step.title}</h2>
          </div>
          <IconButton label="Exit the tour" icon={<X />} size="sm" className="-mr-1.5 -mt-1" noTooltip onClick={() => exitRef.current('skipped')} data-tour-exit />
        </div>
        {!searching && (
          <p className="mt-1.5 text-ui text-fg-muted">
            {step.body}
            {step.target && !rect && <span className="mt-1.5 block text-xs text-fg-subtle" data-tour-missing>This part of the page isn&apos;t showing right now.</span>}
          </p>
        )}
        <div className="mt-3.5 flex items-center gap-2">
          <div className="flex gap-1" aria-hidden>
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-4 bg-primary' : 'w-1.5 bg-border-strong'}`} />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {index > 0 && <Button size="sm" variant="ghost" leadingIcon={<ArrowLeft />} onClick={back} data-tour-back>Back</Button>}
            {index === 0 && <Button size="sm" variant="ghost" onClick={() => exitRef.current('skipped')} data-tour-skip>Skip</Button>}
            <Button size="sm" onClick={next} disabled={searching} trailingIcon={primaryLabel === 'Next' ? <ArrowRight /> : undefined} data-tour-primary>
              {primaryLabel}
            </Button>
          </div>
        </div>
      </div>
      {live}
    </div>,
    document.body,
  )
}
