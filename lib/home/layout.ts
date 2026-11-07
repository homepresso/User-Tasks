import { z } from 'zod'

/**
 * Home layout: the widgets on /home, their order and size, shared by the
 * dashboard (components/home/layout/*) and the server (lib/services/home.ts,
 * stored per person and per workspace in users.preferences.home_layout).
 *
 * Model: an ordered list of visible widgets, each { id, w, h }, plus the ids
 * the person hid. Order is reading order (CSS grid auto-placement, never
 * "dense", so keyboard and screen-reader order match what you see).
 *  - w: columns on the 12-column desktop grid; h: rows of ROW_PX.
 *  - Tablet (6 columns) derives its widths from the desktop ones (halved,
 *    with a per-widget floor); mobile stacks the same order in one column at
 *    natural heights. One stored layout, so every device shows the same order.
 *
 * Everything here is pure (unit-tested in __tests__/home-layout.test.ts).
 */

export const DESKTOP_COLS = 12
export const TABLET_COLS = 6
export const ROW_PX = 40
export const GAP_PX = 12
export const MAX_ROWS = 30
/** Largest accepted PUT body (bytes of JSON). */
export const MAX_LAYOUT_BYTES = 8 * 1024

export const HOME_WIDGET_IDS = [
  'metric.tasks', 'chart.decisions', 'metric.submissions', 'metric.following',
  'tasks',
  'chart.completed', 'chart.duration', 'chart.top_processes',
  'drafts',
] as const
export type HomeWidgetId = (typeof HOME_WIDGET_IDS)[number]

/**
 * Widgets that were retired. Saved layouts that still list one read without
 * it (normalise drops unknown ids), and PUT still accepts the id so older
 * clients keep working; it is dropped on save.
 *  - favorites: Favourite forms became a tab of the task list (Dec 2026).
 *  - chart.on_time, chart.submissions: the compact row merged into the top
 *    cards (Dec 2026): On time is the meter on My tasks, the submissions
 *    status bar and median sit on My submissions.
 */
export const RETIRED_HOME_WIDGET_IDS = ['favorites', 'chart.on_time', 'chart.submissions'] as const

export interface HomeWidgetDef {
  id: HomeWidgetId
  title: string
  group: 'metric' | 'list' | 'chart' | 'forms'
  /** The person needs any one of these (none: everyone). */
  perm?: string[]
  /** Default size (desktop columns × rows). */
  w: number
  h: number
  minW: number
  maxW: number
  minH: number
  maxH: number
  /** Narrowest width on the 6-column tablet grid. */
  tabletMinW: number
  /**
   * Compact widget: its size is the collapsed one (headline and one bar);
   * an expand control reveals the details, and the dashboard then grows it
   * to the measured height of its content (never below `h`).
   */
  compact?: boolean
  /** Default-layout row: widgets with the same row share the 12 columns evenly among the ones the person may see. */
  row?: 'cards' | 'charts'
}

/**
 * Rows a top card takes collapsed (label, value, one graphic, a meta line):
 * 4 × 40 px + 3 gaps = 196 px. The cards are compact widgets: the chevron
 * reveals the legend and the table, and the widget grows to fit.
 */
export const COMPACT_ROWS = 4

const metric = (id: HomeWidgetId, title: string, perm?: string[]): HomeWidgetDef =>
  ({ id, title, group: 'metric', perm, w: 3, h: COMPACT_ROWS, minW: 3, maxW: 6, minH: COMPACT_ROWS, maxH: 14, tabletMinW: 3, compact: true, row: 'cards' })
const chart = (id: HomeWidgetId, title: string, w: number, h: number, perm: string[], row?: HomeWidgetDef['row']): HomeWidgetDef =>
  ({ id, title, group: 'chart', perm, w, h, minW: 3, maxW: 12, minH: Math.min(6, h), maxH: 14, tabletMinW: 3, row })

/** Every widget, in the default order. */
export const HOME_WIDGETS: readonly HomeWidgetDef[] = [
  metric('metric.tasks', 'My tasks', ['tasks.view_own']),
  metric('chart.decisions', 'My decisions', ['tasks.view_own']),
  metric('metric.submissions', 'My submissions', ['forms.submit']),
  metric('metric.following', 'Following'),
  { id: 'tasks', title: 'Task list', group: 'list', w: 12, h: 13, minW: 4, maxW: 12, minH: 6, maxH: MAX_ROWS, tabletMinW: 6 },
  chart('chart.completed', 'Tasks completed', 6, 8, ['tasks.view_own'], 'charts'),
  chart('chart.duration', 'Time to complete', 6, 8, ['tasks.view_own'], 'charts'),
  chart('chart.top_processes', 'Processes I work in most', 12, 5, ['tasks.view_own']),
  { id: 'drafts', title: 'Drafts', group: 'forms', perm: ['forms.submit'], w: 12, h: 3, minW: 3, maxW: 12, minH: 2, maxH: 10, tabletMinW: 3 },
]

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

const DEFS = new Map<string, HomeWidgetDef>(HOME_WIDGETS.map((d) => [d.id, d]))
const ORDER = new Map<string, number>(HOME_WIDGETS.map((d, i) => [d.id, i]))

export function widgetDef(id: string): HomeWidgetDef | undefined {
  return DEFS.get(id)
}

export function isHomeWidgetId(id: unknown): id is HomeWidgetId {
  return typeof id === 'string' && DEFS.has(id)
}

export interface HomeLayoutItem { id: HomeWidgetId; w: number; h: number }
export interface HomeLayout {
  /** Visible widgets in reading order. */
  items: HomeLayoutItem[]
  /** Widgets the person hid (add them back from "+ Add widget"). */
  hidden: HomeWidgetId[]
}

/**
 * The default layout: the four top cards (My tasks with its on-time meter
 * and completed sparkline, My decisions, My submissions, Following; a
 * quarter each, compact and expandable); the task list (whose tabs include
 * Favourite forms); the other My activity charts; then drafts. With `can`,
 * the widgets of a row the person may see share it evenly (two cards: 6 + 6).
 */
export function defaultHomeLayout(can?: (perm: string) => boolean): HomeLayout {
  const shown = (d: HomeWidgetDef) => !can || canUseWidget(d.id, can)
  const items = HOME_WIDGETS.map((d) => {
    if (!d.row) return { id: d.id, w: d.w, h: d.h }
    const n = HOME_WIDGETS.filter((x) => x.row === d.row && shown(x)).length
    return { id: d.id, w: n > 0 ? clamp(Math.floor(DESKTOP_COLS / n), d.minW, d.maxW) : d.w, h: d.h }
  })
  return { items, hidden: [] }
}

/** Rows of ROW_PX (with GAP_PX between them) that hold `px` pixels of content. */
export function rowsForHeight(px: number): number {
  if (!Number.isFinite(px) || px <= 0) return 1
  return Math.max(1, Math.ceil((px + GAP_PX) / (ROW_PX + GAP_PX)))
}

/**
 * The layout as drawn outside edit mode: an expanded compact widget grows to
 * the rows its measured content needs (never shorter than its saved size,
 * at most MAX_ROWS). Collapsed ones, and every other widget, keep their size.
 */
export function displayItems(
  items: readonly HomeLayoutItem[],
  expanded: ReadonlySet<string>,
  heights: Readonly<Record<string, number>>,
): HomeLayoutItem[] {
  return items.map((item) => {
    if (!DEFS.get(item.id)?.compact || !expanded.has(item.id)) return item
    const px = heights[item.id]
    if (!px) return item
    const h = Math.min(MAX_ROWS, Math.max(item.h, rowsForHeight(px)))
    return h === item.h ? item : { ...item, h }
  })
}

/** Is this a compact (collapsible) widget? */
export function isCompactWidget(id: string): boolean {
  return !!DEFS.get(id)?.compact
}

/** Stored expanded-widget list (localStorage JSON) → the compact widget ids in it. */
export function parseExpandedWidgets(raw: string | null | undefined): HomeWidgetId[] {
  if (!raw) return []
  let value: unknown
  try { value = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is HomeWidgetId => isHomeWidgetId(id) && isCompactWidget(id)))]
}

/** Expand or collapse one compact widget (other ids are ignored). */
export function toggleExpandedWidget(expanded: readonly HomeWidgetId[], id: HomeWidgetId): HomeWidgetId[] {
  if (!isCompactWidget(id)) return [...expanded]
  return expanded.includes(id) ? expanded.filter((x) => x !== id) : [...expanded, id]
}

const intOr = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback)

/** One item within its widget's bounds. */
export function clampItem(id: HomeWidgetId, w: unknown, h: unknown): HomeLayoutItem {
  const d = DEFS.get(id)!
  return { id, w: clamp(intOr(w, d.w), d.minW, d.maxW), h: clamp(intOr(h, d.h), d.minH, d.maxH) }
}

/**
 * Where a widget goes back in: right after the nearest widget that comes
 * before it in the default order and is on the page (first when none is).
 */
function defaultSpot(items: readonly HomeLayoutItem[], id: HomeWidgetId): number {
  const rank = ORDER.get(id)!
  let best = -1
  let at = 0
  items.forEach((item, i) => {
    const r = ORDER.get(item.id) ?? -1
    if (r < rank && r > best) { best = r; at = i + 1 }
  })
  return at
}

/**
 * Any stored or submitted value → a valid layout. Unknown and retired
 * widget ids (RETIRED_HOME_WIDGET_IDS: the old Favourite forms widget,
 * now a task-list tab) and duplicates are dropped, sizes are clamped to each widget's bounds,
 * and widgets the value doesn't mention (added in a later release) appear in
 * their default spot. Anything unreadable is the default layout.
 */
export function normaliseHomeLayout(raw: unknown): HomeLayout {
  if (!raw || typeof raw !== 'object') return defaultHomeLayout()
  const value = raw as { items?: unknown; hidden?: unknown }
  if (!Array.isArray(value.items)) return defaultHomeLayout()
  const seen = new Set<string>()
  let items: HomeLayoutItem[] = []
  // A layout saved before the compact row merged into the top cards (Dec 2026).
  const legacyCompact = value.items.some((entry) => LEGACY_COMPACT_IDS.has(String((entry as { id?: unknown } | null)?.id)))
  for (const entry of value.items.slice(0, 100)) {
    const id = (entry as { id?: unknown } | null)?.id
    if (!isHomeWidgetId(id) || seen.has(id)) continue
    seen.add(id)
    items.push(clampItem(id, (entry as { w?: unknown }).w, (entry as { h?: unknown }).h))
  }
  if (legacyCompact) items = mergeLegacyCards(items)
  const hidden: HomeWidgetId[] = []
  for (const id of Array.isArray(value.hidden) ? value.hidden.slice(0, 100) : []) {
    if (!isHomeWidgetId(id) || seen.has(id)) continue
    seen.add(id)
    hidden.push(id)
  }
  for (const def of HOME_WIDGETS) {
    if (seen.has(def.id)) continue
    items.splice(defaultSpot(items, def.id), 0, { id: def.id, w: def.w, h: def.h })
  }
  return { items, hidden }
}

const LEGACY_COMPACT_IDS = new Set<string>(['chart.on_time', 'chart.submissions'])
/** The old default width of the cards and the compact widgets (a third each). */
const LEGACY_CARD_W = 4

/**
 * A pre-merge layout: My decisions joins the top cards right after My tasks,
 * and cards still at the old default width (a third) take a quarter, so the
 * four share one row. Widths the person chose themselves are kept.
 */
function mergeLegacyCards(items: HomeLayoutItem[]): HomeLayoutItem[] {
  const cards = new Set(HOME_WIDGETS.filter((d) => d.row === 'cards').map((d) => d.id))
  let out = items.map((i) => (cards.has(i.id) && i.w === LEGACY_CARD_W ? clampItem(i.id, DEFS.get(i.id)!.w, i.h) : i))
  const decisions = out.find((i) => i.id === 'chart.decisions')
  const tasksAt = out.findIndex((i) => i.id === 'metric.tasks')
  if (decisions && tasksAt >= 0) {
    out = out.filter((i) => i !== decisions)
    out.splice(out.findIndex((i) => i.id === 'metric.tasks') + 1, 0, decisions)
  }
  return out
}

/** True when a layout is the default one (the person hasn't customised Home). */
export function isDefaultHomeLayout(layout: HomeLayout): boolean {
  return JSON.stringify(normaliseHomeLayout(layout)) === JSON.stringify(defaultHomeLayout())
}

const INPUT_WIDGET_IDS = [...HOME_WIDGET_IDS, ...RETIRED_HOME_WIDGET_IDS] as const

/**
 * What PUT /home/layout accepts: known ids only, whole numbers within the
 * grid, no duplicates. Retired ids are accepted (older clients) and dropped
 * when the layout is normalised.
 */
export const homeLayoutInputSchema = z.object({
  items: z.array(z.object({
    id: z.enum(INPUT_WIDGET_IDS),
    w: z.number().int().min(1).max(DESKTOP_COLS).describe('Columns on the 12-column desktop grid'),
    h: z.number().int().min(1).max(MAX_ROWS).describe(`Rows of ${ROW_PX}px`),
  }).strict()).max(INPUT_WIDGET_IDS.length).describe('Visible widgets in reading order'),
  hidden: z.array(z.enum(INPUT_WIDGET_IDS)).max(INPUT_WIDGET_IDS.length).optional().describe('Widgets to hide'),
}).strict().superRefine((value, ctx) => {
  const ids = [...value.items.map((i) => i.id), ...(value.hidden ?? [])]
  const dup = ids.find((id, i) => ids.indexOf(id) !== i)
  if (dup) ctx.addIssue({ code: 'custom', message: `Widget ${dup} appears more than once` })
})
export type HomeLayoutInput = z.infer<typeof homeLayoutInputSchema>

/* ── Breakpoints ─────────────────────────────────────────────────────── */

/** Grid columns for a container width: 12 (desktop), 6 (tablet) or 1 (mobile). */
export function colsForWidth(width: number): 1 | 6 | 12 {
  return width >= 900 ? 12 : width >= 560 ? 6 : 1
}

/** A widget's span on a grid of `cols` columns. */
export function spanFor(item: HomeLayoutItem, cols: number): number {
  if (cols >= DESKTOP_COLS) return item.w
  if (cols <= 1) return 1
  const d = DEFS.get(item.id)!
  return clamp(Math.round((item.w * cols) / DESKTOP_COLS), Math.min(d.tabletMinW, cols), cols)
}

/** A width in `cols` columns → desktop columns, within the widget's bounds. */
export function desktopWidth(id: HomeWidgetId, span: number, cols: number): number {
  const d = DEFS.get(id)!
  return clamp(Math.round((span * DESKTOP_COLS) / Math.max(cols, 1)), d.minW, d.maxW)
}

/* ── Edits ───────────────────────────────────────────────────────────── */

export function moveWidget(layout: HomeLayout, from: number, to: number): HomeLayout {
  const items = [...layout.items]
  if (from < 0 || from >= items.length) return layout
  const target = clamp(to, 0, items.length - 1)
  if (target === from) return layout
  const [moved] = items.splice(from, 1)
  items.splice(target, 0, moved)
  return { ...layout, items }
}

export function resizeWidget(layout: HomeLayout, id: HomeWidgetId, w: number, h: number): HomeLayout {
  return { ...layout, items: layout.items.map((item) => (item.id === id ? clampItem(id, w, h) : item)) }
}

export function hideWidget(layout: HomeLayout, id: HomeWidgetId): HomeLayout {
  if (!layout.items.some((i) => i.id === id)) return layout
  return { items: layout.items.filter((i) => i.id !== id), hidden: [...layout.hidden.filter((h) => h !== id), id] }
}

/** Show a hidden widget again, in its default spot at its default size. */
export function showWidget(layout: HomeLayout, id: HomeWidgetId): HomeLayout {
  if (layout.items.some((i) => i.id === id)) return layout
  const def = DEFS.get(id)!
  const items = [...layout.items]
  items.splice(defaultSpot(items, id), 0, { id, w: def.w, h: def.h })
  return { items, hidden: layout.hidden.filter((h) => h !== id) }
}

/**
 * Keyboard editing on a widget's handle (pure; the dashboard announces
 * `message` in a live region):
 *  - Arrow Left / Up: one place earlier; Arrow Right / Down: one place later;
 *    Home / End: first / last.
 *  - Shift + Left / Right: one column narrower / wider (in the current grid's
 *    columns); Shift + Up / Down: one row shorter / taller. Not on mobile.
 * Returns null for keys it doesn't handle.
 */
export function applyLayoutKey(
  layout: HomeLayout,
  id: HomeWidgetId,
  key: { key: string; shiftKey?: boolean },
  cols: number,
): { layout: HomeLayout; message: string } | null {
  const index = layout.items.findIndex((i) => i.id === id)
  if (index < 0) return null
  const item = layout.items[index]
  const title = DEFS.get(id)!.title
  const n = layout.items.length
  if (key.shiftKey && key.key.startsWith('Arrow')) {
    if (cols <= 1) return { layout, message: 'Resizing isn’t available on a narrow screen; use the arrow keys to reorder.' }
    const span = spanFor(item, cols)
    let w = item.w
    let h = item.h
    if (key.key === 'ArrowLeft') w = desktopWidth(id, span - 1, cols)
    else if (key.key === 'ArrowRight') w = desktopWidth(id, span + 1, cols)
    else if (key.key === 'ArrowUp') h = item.h - 1
    else if (key.key === 'ArrowDown') h = item.h + 1
    else return null
    const next = resizeWidget(layout, id, w, h)
    const after = next.items[index]
    const limit = after.w === item.w && after.h === item.h ? ' It can’t go any further that way.' : ''
    return { layout: next, message: `${title}: ${spanFor(after, cols)} of ${cols} columns wide, ${after.h} rows tall.${limit}` }
  }
  let to: number
  switch (key.key) {
    case 'ArrowLeft': case 'ArrowUp': to = index - 1; break
    case 'ArrowRight': case 'ArrowDown': to = index + 1; break
    case 'Home': to = 0; break
    case 'End': to = n - 1; break
    default: return null
  }
  if (to < 0 || to >= n || to === index) {
    return { layout, message: `${title} is already ${index === 0 ? 'first' : 'last'}.` }
  }
  return { layout: moveWidget(layout, index, to), message: `${title} moved to position ${to + 1} of ${n}.` }
}

/**
 * Put an edited list of the visible widgets back into the whole layout:
 * widgets that weren't shown (no permission) keep their places, the visible
 * slots take `next` in order.
 */
export function replaceVisible(layout: HomeLayout, visible: ReadonlySet<string>, next: readonly HomeLayoutItem[]): HomeLayout {
  const queue = [...next]
  const items: HomeLayoutItem[] = []
  for (const item of layout.items) {
    if (!visible.has(item.id)) items.push(item)
    else if (queue.length) items.push(queue.shift()!)
  }
  items.push(...queue)
  return { ...layout, items }
}

/** Same widgets, order and sizes (and hidden set)? */
export function sameHomeLayout(a: HomeLayout, b: HomeLayout): boolean {
  return JSON.stringify(normaliseHomeLayout(a)) === JSON.stringify(normaliseHomeLayout(b))
}

/** Widgets the person may see (by permission), in layout order. */
export function availableItems(layout: HomeLayout, can: (perm: string) => boolean): HomeLayoutItem[] {
  return layout.items.filter((item) => {
    const perm = DEFS.get(item.id)?.perm
    return !perm || perm.some((p) => can(p))
  })
}

export function canUseWidget(id: HomeWidgetId, can: (perm: string) => boolean): boolean {
  const perm = DEFS.get(id)?.perm
  return !perm || perm.some((p) => can(p))
}
