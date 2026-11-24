'use client'

import { useEffect, useState, type RefObject } from 'react'
import { barDock, HOME_PLAN, overlapArea, planLauncher, planRect, samePlan, type LauncherPlan, type Rect } from '@/lib/assistants/launcher-geometry'

/**
 * The page launcher's collision safety net: when the floating Agent button
 * would sit on a button or form control that does not scroll away (a sticky
 * save bar, a wizard footer, a grid pager, a toast's action), it moves:
 * lifted above it, else to the other corner, else down to an icon (see
 * planLauncher). Content with more to scroll is left alone (scrolling moves
 * it clear); at the end of a scroll area its last row counts as an obstacle.
 *
 * Cheap: a few elementsFromPoint hit tests over the launcher's footprint, at
 * most once per animation frame, only after something changed (resize,
 * scroll, DOM mutation outside the launcher), and React state only changes
 * when the plan does. Paused while a modal dialog is open (the launcher is
 * under its overlay then).
 */

export const INTERACTIVE = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="tab"], [role="combobox"], [role="slider"], [contenteditable=""], [contenteditable="true"]'

/** The shared bars that register themselves (the whole bar is an obstacle, not just its buttons). */
export const BAR = '[data-agent-bar]'

function toRect(r: DOMRect | Rect): Rect { return { left: r.left, top: r.top, right: r.right, bottom: r.bottom } }

/**
 * True when the person can't move the element out from under the launcher
 * (`clearTop`: the launcher's top edge): it is fixed / sticky, or no
 * scrollable ancestor has enough scroll left to carry it above the launcher
 * (the last rows of a page). Content that scrolling moves clear is left
 * alone: chasing it would make the button jump as the page scrolls.
 * `strict` (for the spots the launcher moves to) counts only what never
 * scrolls, so the button doesn't climb a long page's last rows.
 */
export function isStationary(el: Element, strict = false, clearTop = 0): boolean {
  const need = el.getBoundingClientRect().bottom - clearTop + 8
  for (let n: Element | null = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
    const cs = getComputedStyle(n)
    if (cs.position === 'fixed' || cs.position === 'sticky') return true
    if (!/(auto|scroll)/.test(cs.overflowY) || n.scrollHeight <= n.clientHeight + 1) continue
    if (strict || n.scrollHeight - n.scrollTop - n.clientHeight >= need) return false
  }
  if (strict) return true
  const page = document.scrollingElement
  return !page || page.scrollHeight - page.scrollTop - page.clientHeight < need
}

/** The rect to keep clear for an element under the launcher: its registered bar, else its fixed/sticky bar, else itself. */
function obstacleRect(el: Element, docked: Element | null): Rect {
  const bar = el.closest(BAR)
  if (bar && bar !== docked) return toRect(bar.getBoundingClientRect())
  if (bar) return toRect(el.getBoundingClientRect())
  for (let n: Element | null = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const pos = getComputedStyle(n).position
    if (pos === 'fixed' || pos === 'sticky') {
      const r = n.getBoundingClientRect()
      return r.height <= 160 ? toRect(r) : toRect(el.getBoundingClientRect())
    }
  }
  return toRect(el.getBoundingClientRect())
}

/** Every element under a rect (3×3 hit-test grid), outside the launcher and the Agent's panel. */
function hitsUnder(rect: Rect, launcher: Element): Element[] {
  const out: Element[] = []
  const vw = window.innerWidth, vh = window.innerHeight
  for (const fx of [0.08, 0.5, 0.92]) {
    for (const fy of [0.1, 0.5, 0.9]) {
      const x = rect.left + (rect.right - rect.left) * fx
      const y = rect.top + (rect.bottom - rect.top) * fy
      if (x < 0 || y < 0 || x >= vw || y >= vh) continue
      for (const hit of document.elementsFromPoint(x, y)) {
        if (!launcher.contains(hit) && !hit.closest('[data-assistant-panel]')) out.push(hit)
      }
    }
  }
  return out
}

const FIELD = 'input, select, textarea, [contenteditable=""], [contenteditable="true"], [role="combobox"]'

/**
 * Would the launcher at `rect` get in the way of this control? Fields always
 * (it would hide their text or chevron); a button or link when it covers a
 * real part of it (not a corner of a whole-row or whole-card click target).
 */
function blocks(target: Element, rect: Rect): boolean {
  if (target.matches(FIELD)) return true
  const r = target.getBoundingClientRect()
  const area = r.width * r.height
  return area > 0 && overlapArea(toRect(r), rect) / area >= 0.3
}

/** Interactive, stationary elements under a rect, as obstacle rects (a docked bar counts only by its controls). */
export function sampleObstacles(rect: Rect, launcher: Element, seen: Set<Element>, strict = false, docked: Element | null = null): Rect[] {
  const out: Rect[] = []
  for (const hit of hitsUnder(rect, launcher)) {
    const target = hit.closest(INTERACTIVE) ?? hit.closest(BAR)
    if (!target || target === docked || seen.has(target) || launcher.contains(target)) continue
    seen.add(target)
    if (target.closest('[aria-hidden="true"], [inert]')) continue
    if (!target.matches(BAR) && !isStationary(target, strict, rect.top)) continue
    if (!target.matches(BAR) && !blocks(target, rect)) continue
    out.push(obstacleRect(target, docked))
  }
  return out
}

/** The registered bar under the launcher's home spot, if any. */
function barUnder(rect: Rect, launcher: Element): HTMLElement | null {
  for (const hit of hitsUnder(rect, launcher)) {
    const bar = hit.closest<HTMLElement>(BAR)
    if (bar && !bar.closest('[aria-hidden="true"], [inert]')) return bar
  }
  return null
}

/** The launcher's home rect (bottom-right, full size) from its resolved right/bottom offsets: transforms don't move it. */
function homeRect(el: HTMLElement, fullWidth: number): Rect {
  const cs = getComputedStyle(el)
  const right = window.innerWidth - (parseFloat(cs.right) || 0)
  const bottom = window.innerHeight - (parseFloat(cs.bottom) || 0)
  return { left: right - fullWidth, right, top: bottom - el.offsetHeight, bottom }
}

function modalOpen(): boolean {
  return Array.from(document.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="dialog"][aria-modal="true"]'))
    .some((d) => !d.closest('[data-assistant-panel]'))
}

/** Reserve a bar's right end for the launcher (globals.css: [data-agent-reserve] pads by --agent-reserve). */
function reserveBar(bar: HTMLElement, gutter: number) {
  bar.style.setProperty('--agent-reserve', `${gutter}px`)
  bar.setAttribute('data-agent-reserve', '')
}
function releaseBar(bar: HTMLElement | null) {
  if (!bar) return
  bar.style.removeProperty('--agent-reserve')
  bar.removeAttribute('data-agent-reserve')
}

export interface LauncherPlacement { plan: LauncherPlan; transform?: string }
const HOME: LauncherPlacement = { plan: HOME_PLAN }

export function useLauncherAvoidance(ref: RefObject<HTMLElement | null>, enabled: boolean): LauncherPlacement {
  const [placement, setPlacement] = useState<LauncherPlacement>(HOME)
  useEffect(() => {
    if (!enabled) { setPlacement(HOME); return }
    let frame = 0
    let current = HOME_PLAN
    let currentTransform: string | undefined
    let fullWidth = 0
    let docked: HTMLElement | null = null
    const run = () => {
      frame = 0
      const el = ref.current
      if (!el || document.hidden || modalOpen()) return
      if (!current.compact) fullWidth = el.offsetWidth
      if (!fullWidth) return
      const home = homeRect(el, fullWidth)
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      // The left corner holds the sidebar on desktop; phones have none.
      const allowLeft = viewport.width < 768
      let next: LauncherPlan | null = null

      // 1. A shared action bar under it: dock into the bar's right end (the bar keeps that gutter clear).
      const bar = barUnder(home, el)
      const dock = bar ? barDock(home, toRect(bar.getBoundingClientRect())) : null
      if (bar && dock) {
        if (docked !== bar) { releaseBar(docked); docked = bar }
        reserveBar(bar, dock.gutter)
        const plan: LauncherPlan = { side: 'right', lift: dock.lift, compact: false }
        if (!sampleObstacles(planRect(home, plan, viewport.width), el, new Set(), false, bar).length) next = plan
      }
      if (!next) { releaseBar(docked); docked = null }

      // 2. Else: lift above what's under it, other corner, icon (planLauncher), re-planning until the spot is clear.
      if (!next) {
        const seen = new Set<Element>()
        const obstacles = sampleObstacles(home, el, seen)
        next = HOME_PLAN
        for (let i = 0; i < 6 && obstacles.length; i++) {
          next = planLauncher({ home, obstacles, viewport, allowLeft })
          const found = sampleObstacles(planRect(home, next, viewport.width), el, seen, true)
          if (!found.length) break
          obstacles.push(...found)
        }
      }
      const right = parseFloat(getComputedStyle(el).right) || 0
      const transform = planTransform(next, right, next.compact ? el.offsetHeight : fullWidth, viewport.width)
      if (!samePlan(next, current) || transform !== currentTransform) {
        current = next; currentTransform = transform
        setPlacement({ plan: next, transform })
      }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(run) }
    const mutations = new MutationObserver((records) => {
      const el = ref.current
      // Our own changes (the launcher's transform, a docked bar's gutter) don't count.
      if (records.some((r) => !(el && el.contains(r.target)) && !(r.type === 'attributes' && r.target === docked))) schedule()
    })
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'data-state', 'open', 'data-agent-scroll-room'] })
    const resize = new ResizeObserver(schedule)
    resize.observe(document.body)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    schedule()
    return () => {
      mutations.disconnect(); resize.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, { capture: true })
      if (frame) cancelAnimationFrame(frame)
      releaseBar(docked)
    }
  }, [ref, enabled])
  return placement
}

/** The CSS transform that puts a home-anchored (right/bottom) launcher where the plan says. */
export function planTransform(plan: LauncherPlan, rightOffset: number, width: number, viewportWidth: number): string | undefined {
  if (plan.side === 'right' && !Math.round(plan.lift)) return undefined
  const dx = plan.side === 'left' ? -(viewportWidth - 2 * rightOffset - width) : 0
  return `translate(${Math.round(dx)}px, ${Math.round(-plan.lift)}px)`
}
