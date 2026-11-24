/**
 * Where the floating Agent launcher sits so it never covers a button or form
 * control (pure geometry: no DOM, unit-tested). The host samples the page
 * under the launcher (use-launcher-avoidance) and passes the obstacles it
 * found; planLauncher decides the placement:
 *
 *   1. its home corner (bottom-right) when nothing is under it;
 *   2. else lifted just above the obstacles (a sticky save bar, a wizard
 *      footer, a grid's pager), up to maxLift;
 *   3. else the mirrored corner (bottom-left), lifted the same way;
 *   4. else collapsed to an icon-sized square, right then left;
 *   5. else the candidate that covers the least.
 */

export interface Rect { left: number; top: number; right: number; bottom: number }
export type LauncherSide = 'right' | 'left'
export interface LauncherPlan { side: LauncherSide; lift: number; compact: boolean }

export const HOME_PLAN: LauncherPlan = { side: 'right', lift: 0, compact: false }

/** True when the rects overlap, with `gap` px of clearance required between them. */
export function intersects(a: Rect, b: Rect, gap = 0): boolean {
  return a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap
}

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

export function shiftRect(r: Rect, dx: number, dy: number): Rect {
  return { left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy }
}

/** The home rect moved to the mirrored (left) corner of the viewport. */
export function mirrorRect(r: Rect, viewportWidth: number): Rect {
  return { left: viewportWidth - r.right, right: viewportWidth - r.left, top: r.top, bottom: r.bottom }
}

/** The square, icon-only launcher at the same corner as `r`. */
export function compactRect(r: Rect, side: LauncherSide = 'right'): Rect {
  const size = r.bottom - r.top
  return side === 'right' ? { ...r, left: r.right - size } : { ...r, right: r.left + size }
}

/** The rect the launcher occupies for a plan, given its home (bottom-right, full-size) rect. */
export function planRect(home: Rect, plan: LauncherPlan, viewportWidth: number): Rect {
  let r = home
  if (plan.compact) r = compactRect(r, 'right')
  if (plan.side === 'left') r = mirrorRect(r, viewportWidth)
  return shiftRect(r, 0, -plan.lift)
}

/** How far a rect must rise to clear the obstacles, stepping over stacked ones; null past maxLift. */
export function liftToClear(base: Rect, obstacles: Rect[], gap: number, maxLift: number): number | null {
  let lift = 0
  for (let i = 0; i <= obstacles.length; i++) {
    const r = shiftRect(base, 0, -lift)
    const hits = obstacles.filter((o) => intersects(r, o, gap))
    if (!hits.length) return lift
    lift = base.bottom - (Math.min(...hits.map((o) => o.top)) - gap)
    if (lift > maxLift) return null
  }
  return null
}

export function planLauncher(params: {
  home: Rect
  obstacles: Rect[]
  viewport: { width: number; height: number }
  gap?: number
  /** The most it may rise (default: 45% of the viewport). */
  maxLift?: number
  /** Allow the mirrored corner (false when the left edge holds the sidebar). Default true. */
  allowLeft?: boolean
}): LauncherPlan {
  const { home, obstacles, viewport, gap = 8, allowLeft = true } = params
  const maxLift = params.maxLift ?? viewport.height * 0.45
  if (!obstacles.length) return HOME_PLAN
  const tried: LauncherPlan[] = []
  for (const compact of [false, true]) {
    for (const side of (allowLeft ? ['right', 'left'] : ['right']) as LauncherSide[]) {
      const base = planRect(home, { side, lift: 0, compact }, viewport.width)
      const lift = liftToClear(base, obstacles, gap, maxLift)
      if (lift != null) return { side, lift, compact }
      tried.push({ side, lift: 0, compact })
    }
  }
  // Nowhere is clear: the smallest footprint over the fewest pixels.
  const cover = (p: LauncherPlan) => obstacles.reduce((sum, o) => sum + overlapArea(planRect(home, p, viewport.width), o), 0)
  return tried.reduce((best, p) => (cover(p) < cover(best) ? p : best))
}

export function samePlan(a: LauncherPlan, b: LauncherPlan): boolean {
  return a.side === b.side && a.compact === b.compact && Math.abs(a.lift - b.lift) < 1
}

/**
 * How the Agent docks inside a modal dialog: `split` widens the dialog by up
 * to one panel (as far as the viewport allows) and pads its right side so the
 * form shrinks beside the panel; `overlay` covers the dialog with the panel
 * (its own close returns to the form) when splitting would squeeze the form
 * under minContent.
 */
export function dialogDockMode(params: {
  dialogWidth: number
  viewportWidth: number
  panelWidth?: number
  minContent?: number
  margin?: number
}): { mode: 'split'; width: number; panel: number } | { mode: 'overlay' } {
  const { dialogWidth, viewportWidth, panelWidth = 400, minContent = 360, margin = 32 } = params
  const extra = Math.max(0, Math.min(panelWidth, viewportWidth - margin - dialogWidth))
  const width = Math.round(dialogWidth + extra)
  return width - panelWidth >= minContent ? { mode: 'split', width, panel: panelWidth } : { mode: 'overlay' }
}

/**
 * A shared action bar (a save bar, a wizard footer) under the launcher that
 * reaches its column: rather than climbing over the content above it, the
 * launcher docks INTO the bar's right end, centred in it, and the bar keeps a
 * gutter that wide clear of its own buttons (padding-inline-end, set from
 * `gutter`). Null when the bar doesn't reach the launcher's right edge or is
 * too short to hold it (then the launcher lifts above it instead).
 */
export function barDock(home: Rect, bar: Rect, gap = 8): { lift: number; gutter: number } | null {
  const height = home.bottom - home.top
  if (bar.right < home.right - 4 || bar.left > home.left - 48 || bar.bottom - bar.top < height) return null
  const bottom = bar.bottom - (bar.bottom - bar.top - height) / 2
  return { lift: Math.round(home.bottom - bottom), gutter: Math.ceil(bar.right - home.left + gap) }
}
