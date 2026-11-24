import { z } from 'zod'

/**
 * Sorting and personal saved views of app data grids (pure, client-safe;
 * __tests__/apps-grid-views.test.ts).
 *
 *  - Sorting: a viewer sorts a grid by clicking a column header (ascending,
 *    descending, back to the grid's own order). The sort runs on the server
 *    over the grid's rows (lib/services/data-tables.ts queryRows), so it is
 *    right across pages. The designer may give the grid a default `sort`.
 *  - Saved views (grids with `personal_views: true`): each person saves the
 *    grid's current state under a name — sort, search, the columns shown (a
 *    subset of the grid's own columns, in any order) and "equals" filters on
 *    its columns — and picks it again later. Views are the person's own:
 *    they live in their `users.preferences` (no migration), per workspace,
 *    app page and widget. A view only narrows what the grid already shows:
 *    its filters are added to the grid's own row conditions, and its columns
 *    can't reveal a column the grid doesn't show.
 */

export const MAX_GRID_VIEWS = 12
export const MAX_VIEW_FILTERS = 5

const colKey = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,79}$/)

export const gridViewSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(60),
  sort: colKey.nullable().optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  search: z.string().trim().max(200).nullable().optional(),
  columns: z.array(colKey).max(30).optional(),
  filters: z.array(z.object({ column: colKey, value: z.string().trim().min(1).max(200) }).strict()).max(MAX_VIEW_FILTERS).optional(),
}).strict()
export type GridView = z.output<typeof gridViewSchema>

/** The grid state a view captures (and the widget's request params). */
export interface GridState { sort: string | null; dir: 'asc' | 'desc'; search: string; columns: string[] | null; filters: Array<{ column: string; value: string }> }

/** Header click: unsorted → ascending → descending → unsorted (another column starts ascending). */
export function nextSort(current: { sort: string | null; dir: 'asc' | 'desc' }, column: string): { sort: string | null; dir: 'asc' | 'desc' } {
  if (current.sort !== column) return { sort: column, dir: 'asc' }
  if (current.dir === 'asc') return { sort: column, dir: 'desc' }
  return { sort: null, dir: 'asc' }
}

/** A view's columns, kept to the grid's own (in the view's order); none left → the grid's. */
export function viewColumns(gridColumns: readonly string[], view: Pick<GridView, 'columns'> | null | undefined): string[] {
  const own = new Set(gridColumns)
  const picked = (view?.columns ?? []).filter((c, i, a) => own.has(c) && a.indexOf(c) === i)
  return picked.length ? picked : [...gridColumns]
}

/** Where a person's views of one grid live in users.preferences. */
export function viewsKey(tenantId: string, app: string, page: string, widget: string): string {
  return `${tenantId}:${app}:${page}:${widget}`.slice(0, 300)
}

/** The views stored under a key (invalid entries dropped). */
export function readViews(preferences: unknown, key: string): GridView[] {
  const all = preferences && typeof preferences === 'object' ? (preferences as Record<string, unknown>).app_grid_views : null
  const list = all && typeof all === 'object' ? (all as Record<string, unknown>)[key] : null
  if (!Array.isArray(list)) return []
  return list.map((v) => gridViewSchema.safeParse(v)).filter((r) => r.success).map((r) => r.data!).slice(0, MAX_GRID_VIEWS)
}

/** preferences with the views under a key replaced (an empty list removes the key); other preferences kept. */
export function writeViews(preferences: unknown, key: string, views: readonly GridView[]): Record<string, unknown> {
  const prefs = preferences && typeof preferences === 'object' && !Array.isArray(preferences) ? { ...(preferences as Record<string, unknown>) } : {}
  const all = prefs.app_grid_views && typeof prefs.app_grid_views === 'object' && !Array.isArray(prefs.app_grid_views) ? { ...(prefs.app_grid_views as Record<string, unknown>) } : {}
  if (views.length) all[key] = views.slice(0, MAX_GRID_VIEWS)
  else delete all[key]
  prefs.app_grid_views = all
  return prefs
}

/** Add or replace a view (same id, or same name case-insensitively); refuses past MAX_GRID_VIEWS. */
export function upsertView(views: readonly GridView[], view: GridView): GridView[] {
  const at = views.findIndex((v) => v.id === view.id || v.name.toLowerCase() === view.name.toLowerCase())
  if (at >= 0) return views.map((v, i) => (i === at ? { ...view, id: v.id } : v))
  if (views.length >= MAX_GRID_VIEWS) throw new Error(`At most ${MAX_GRID_VIEWS} saved views per grid`)
  return [...views, view]
}

/** Request params for a grid state (only what differs from the grid's own state). */
export function stateParams(state: GridState): { sort?: string; dir?: 'asc' | 'desc'; cols?: string[]; eq?: Array<{ column: string; value: string }> } {
  return {
    ...(state.sort ? { sort: state.sort, dir: state.dir } : {}),
    ...(state.columns?.length ? { cols: state.columns } : {}),
    ...(state.filters.length ? { eq: state.filters } : {}),
  }
}
