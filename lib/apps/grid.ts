import { DESKTOP_COLS, MAX_ROWS, rowsForHeight, type GridItem } from '@/lib/home/layout'

/**
 * How an app page's widgets are drawn on the 12-column desktop grid (pure,
 * client-safe; __tests__/apps-polish.test.ts). The stored layout is an
 * ordered list of { id, w, h }; at display time:
 *
 *  1. Auto height: a widget that fits its content takes the rows its measured
 *     content needs — at least its minimum, at most its cap (an explicit
 *     max_h, else the size the builder gave it for widgets saved before auto
 *     height existed, else MAX_AUTO_ROWS). A list longer than the cap scrolls
 *     inside the card (with a top / bottom fade).
 *  2. Rows stay rows: widgets that start on the same grid row (with nothing
 *     else reaching into it) form a band; the band takes the height its
 *     contents need and, with equal rows (on unless the page turns it off),
 *     its auto widgets line up at that height. Nothing below changes order —
 *     if shrinking would let a later widget jump ahead, the built sizes stay.
 *  3. Fill: the last widget of a row stretches over empty columns to its
 *     right, so a row never ends short of the grid's right edge — but only
 *     when that leaves every other widget where it was.
 *
 * Placement follows CSS grid's `grid-auto-flow: row dense` (the app grid's
 * flow), simulated cell by cell.
 */

export const MAX_AUTO_ROWS = 14

export interface DisplayDef { minH: number; maxH: number; minW: number; maxW: number }

export interface AutoHeight {
  /** Measured content height in px (card padding and header included). */
  px: number
  /** Most rows it may take. */
  cap: number
}

export interface Placed { id: string; x: number; y: number; w: number; h: number }

/** Where CSS grid (`row dense`, 12 columns) puts each item. */
export function placeDense(items: readonly GridItem[], cols = DESKTOP_COLS): Placed[] {
  const grid: boolean[][] = []
  const free = (x: number, y: number, w: number, h: number) => {
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) if (grid[r]?.[c]) return false
    return true
  }
  const take = (x: number, y: number, w: number, h: number) => {
    for (let r = y; r < y + h; r++) { grid[r] ??= []; for (let c = x; c < x + w; c++) grid[r][c] = true }
  }
  const out: Placed[] = []
  for (const it of items) {
    const w = Math.min(cols, Math.max(1, it.w))
    const h = Math.max(1, it.h)
    let placed: Placed | null = null
    for (let y = 0; !placed && y < 10_000; y++) {
      for (let x = 0; x + w <= cols; x++) {
        if (free(x, y, w, h)) { placed = { id: it.id, x, y, w, h }; break }
      }
    }
    take(placed!.x, placed!.y, w, h)
    out.push(placed!)
  }
  return out
}

const samePlaces = (a: Placed[], b: Placed[], skip: string) => a.every((p, i) => p.id === skip || (p.x === b[i].x && p.y === b[i].y))

/**
 * The layout as drawn on the desktop grid: auto heights, equal rows and
 * filled rows (see the module comment). `auto` holds the widgets that size to
 * their content (measured so far); `defs` their bounds.
 */
export function displayLayout(
  items: readonly GridItem[],
  defs: (id: string) => DisplayDef | undefined,
  opts: { auto?: ReadonlyMap<string, AutoHeight>; equalRows?: boolean; fill?: boolean } = {},
): GridItem[] {
  const auto = opts.auto ?? new Map<string, AutoHeight>()
  const contentRows = (it: GridItem): number => {
    const a = auto.get(it.id)
    if (!a) return it.h
    const lo = defs(it.id)?.minH ?? 1
    return Math.min(Math.max(rowsForHeight(a.px), lo), Math.max(lo, Math.min(a.cap, MAX_ROWS)))
  }
  let out = items.map((it) => ({ ...it }))
  if (auto.size || opts.equalRows !== false) {
    // Rows ("bands") come from the layout as built: widgets that start on the same grid row, with nothing
    // else reaching into that band. A clean band takes the height its contents need — its widgets line up
    // (equal rows) or each takes its own (equal rows off) — so nothing below changes order.
    const built = placeDense(out)
    const starts = [...new Set(built.map((p) => p.y))].sort((a, b) => a - b)
    const sized = new Map<string, number>()
    for (const y of starts) {
      const band = built.filter((p) => p.y === y)
      const H = Math.max(...band.map((p) => p.h))
      const clean = !built.some((q) => q.y !== y && q.y < y + H && q.y + q.h > y)
      if (!clean) continue
      const need = band.map((p) => contentRows(items.find((it) => it.id === p.id)!))
      const bandH = Math.max(...need)
      band.forEach((p, k) => {
        const own = need[k]
        const isAuto = auto.has(p.id)
        // Equal rows: every widget of a clean band takes the band's height (charts and tiles fill it, lists show more);
        // without it, auto widgets keep their own height and the rest their size.
        sized.set(p.id, opts.equalRows === false ? (isAuto ? own : p.h) : Math.max(own, Math.min(bandH, MAX_ROWS)))
      })
    }
    const next = out.map((it) => (sized.has(it.id) ? { ...it, h: sized.get(it.id)! } : it))
    // Safety: if shrinking would let a later widget jump ahead of an earlier one, keep the built sizes.
    const order = (list: GridItem[]) => placeDense(list).map((p) => p.id + ':' + p.x).join('|')
    const builtOrder = [...built].sort((a, b) => a.y - b.y || a.x - b.x).map((p) => p.id).join('|')
    const nextPlaced = placeDense(next)
    const nextOrder = [...nextPlaced].sort((a, b) => a.y - b.y || a.x - b.x).map((p) => p.id).join('|')
    const sameColumns = order(next).split('|').every((cell, i) => cell === `${built[i].id}:${built[i].x}`)
    if (builtOrder === nextOrder && sameColumns) out = next
  }
  // Fill: stretch the last widget of a row over the empty columns to its right.
  if (opts.fill !== false) {
    let placed = placeDense(out)
    for (let i = 0; i < out.length; i++) {
      const p = placed[i]
      const d = defs(p.id)
      const maxW = d?.maxW ?? DESKTOP_COLS
      let extra = 0
      for (let x = p.x + p.w; x < DESKTOP_COLS && p.w + extra < maxW; x++) {
        const blocked = placed.some((q, j) => j !== i && q.x <= x && x < q.x + q.w && q.y < p.y + p.h && p.y < q.y + q.h)
        if (blocked) break
        extra++
      }
      if (!extra) continue
      const trial = out.map((it, j) => (j === i ? { ...it, w: it.w + extra } : it))
      const again = placeDense(trial)
      if (samePlaces(placed, again, p.id)) { out = trial; placed = again }
    }
  }
  return out
}

/* ── Lists that fit whole rows ───────────────────────────────────────── */

/** One list row (two lines) in px — rows are a fixed height so lists fit whole rows. */
export const LIST_ROW_PX = 52
/** The "View all (n)" footer under a list. */
export const LIST_FOOTER_PX = 30

/** Px of list content a card of `rows` grid rows holds: box (52·rows − 12) − padding / border (26) − title bar (32). */
export function contentBudgetForRows(rows: number, titled = true): number {
  return rows * 52 - 12 - 26 - (titled ? 32 : 0)
}

/** How many rows of `total` to show in a budget (leaving room for the "View all" footer when some are left out); never a row cut in half. */
export function rowsToShow(total: number, budget: number, rowPx = LIST_ROW_PX): number {
  if (!Number.isFinite(budget) || total * rowPx <= budget) return total
  return Math.max(1, Math.floor((budget - LIST_FOOTER_PX) / rowPx))
}

/** Rows a card of this content height needs (re-exported for the measuring hook). */
export { rowsForHeight }
