import type { AppMenuItem, AppMenuLeaf, ButtonAction } from './schema'

/**
 * Labels people see in app navigation, buttons, tiles and link lists (pure,
 * client-safe; __tests__/apps-polish.test.ts).
 *
 * The builder fills new entries with a placeholder ("Link", "Page", "New
 * tile"…) so they validate; a placeholder is never what a viewer should
 * read. `isPlaceholderLabel` spots one (or an empty label) and
 * `fallbackLabel` names the entry after its target instead: the page's
 * title, the form / report / workflow name (when known), the tasks view or
 * the link's host. The builder's checks (lib/apps/lint.ts) ask for a real
 * label; viewers simply never see the placeholder.
 */

/** Default labels the builder and the menu editor give new entries. */
export const PLACEHOLDER_LABELS: ReadonlySet<string> = new Set([
  'link', 'page', 'form', 'report', 'record', 'start', 'section', 'group', 'button', 'new button', 'new tile', 'tile',
  'new submission', 'open', 'menu item', 'new item', 'item', 'untitled', 'label', 'new link',
].map((s) => s.toLowerCase()))

export function isPlaceholderLabel(label: string | null | undefined): boolean {
  const t = (label ?? '').trim().toLowerCase().replace(/[\s↗›»→]+$/u, '').trim()
  return !t || PLACEHOLDER_LABELS.has(t)
}

const humanise = (seg: string) => {
  const t = decodeURIComponent(seg).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_+]+/g, ' ').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''
}

/** A link in words: its last path segment ("…/travel-policy" → "Travel policy"), else its host ("handbook.example.com"). */
export function urlLabel(url: string): string {
  if (/^mailto:/i.test(url)) return url.slice(7).split('?')[0] || 'Email'
  if (url.startsWith('/')) {
    const segs = url.split(/[?#]/)[0].split('/').filter(Boolean)
    return segs.length ? humanise(segs[segs.length - 1]) || 'Home' : 'Home'
  }
  try {
    const u = new URL(url)
    const segs = u.pathname.split('/').filter(Boolean)
    const last = segs.length ? humanise(segs[segs.length - 1]) : ''
    return last || u.host.replace(/^www\./, '') || url
  } catch { return url }
}

const TASK_VIEWS: Record<string, string> = { mine: 'My tasks', queue: 'Queue', team: 'Team tasks', all: 'All tasks' }

export interface LabelContext {
  /** Pages of the app (slug → title). */
  pages?: ReadonlyArray<{ slug: string; title: string }>
  /** Object names by `<kind>:<id>` (form, workflow, report, data_table). */
  name?: (kind: 'form' | 'workflow' | 'report' | 'data_table', id: string) => string | null | undefined
}

type Leaf = Exclude<AppMenuLeaf, { kind: 'divider' } | { kind: 'heading' }>

/** What a menu entry points at, in words (its target's own name). */
export function targetLabel(item: Leaf | Extract<AppMenuItem, { kind: 'group' }>, ctx: LabelContext = {}): string | null {
  switch (item.kind) {
    case 'page': return ctx.pages?.find((p) => p.slug === item.page_slug)?.title ?? null
    case 'url': return item.url && item.url !== 'https://' ? urlLabel(item.url) : null
    case 'form': return (item.form_id && ctx.name?.('form', item.form_id)) || null
    case 'report': return (item.report_id && ctx.name?.('report', item.report_id)) || null
    case 'record': return (item.table_id && ctx.name?.('data_table', item.table_id)) || null
    case 'workflow': { const n = item.workflow_id && ctx.name?.('workflow', item.workflow_id); return n ? `Start ${n}` : null }
    case 'tasks': return TASK_VIEWS[item.view] ?? null
    case 'group': return null
  }
}

/** The label to show: the entry's own, or — when it is a placeholder — its target's name. */
export function displayLabel(item: { kind: string; label?: string }, ctx: LabelContext = {}): string {
  const own = (item.label ?? '').trim()
  if (!isPlaceholderLabel(own) || item.kind === 'divider' || item.kind === 'heading') return own
  const derived = targetLabel(item as Leaf, ctx)
  return derived || own || 'Untitled'
}

/** What a button / tile action opens, in words (for placeholder button and tile labels). */
export function actionTargetLabel(action: ButtonAction, ctx: LabelContext = {}): string | null {
  switch (action.kind) {
    case 'new_submission': { const n = ctx.name?.('form', action.form_id); return n ? `New ${n.charAt(0).toLowerCase()}${n.slice(1)}` : null }
    case 'start_workflow': { const n = ctx.name?.('workflow', action.workflow_id); return n ? `Start ${n}` : null }
    case 'open_page': return ctx.pages?.find((p) => p.slug === action.page_slug)?.title ?? null
    case 'open_url': return action.url && action.url !== 'https://' ? urlLabel(action.url) : null
    case 'open_report': case 'download_report': { const n = ctx.name?.('report', action.report_id); return n ? (action.kind === 'download_report' ? `Download ${n}` : n) : null }
    case 'open_record': return ctx.name?.('data_table', action.table_id) ?? null
    case 'claim_next': return 'Claim next task'
    case 'copy_link': return 'Copy link'
    case 'set_filter': return null
    case 'run_rules': return null
  }
}

/** A button / tile label: its own, or the action's target when it is a placeholder. */
export function displayActionLabel(label: string, action: ButtonAction, ctx: LabelContext = {}): string {
  if (!isPlaceholderLabel(label)) return label.trim()
  return actionTargetLabel(action, ctx) || label.trim() || 'Untitled'
}

/** A menu with every placeholder label replaced by its target's name (server-side, with names the viewer may see). */
export function resolveMenuLabels<T extends AppMenuItem>(items: readonly T[], ctx: LabelContext): T[] {
  return items.map((m) => {
    if (m.kind === 'group') return { ...m, items: resolveMenuLabels(m.items as AppMenuItem[], ctx) } as T
    if (m.kind === 'divider' || m.kind === 'heading') return m
    const label = displayLabel(m, ctx)
    return label === m.label ? m : { ...m, label }
  })
}
