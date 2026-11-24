import type { ActionButton, AppMenuItem, AppMenuLeaf, AppNav, AppWidget, WidgetConfig } from './schema'
import { displayActionLabel, displayLabel, isPlaceholderLabel, type LabelContext } from './labels'
import { autoHeightCap, autoTitle, catalogEntry, fitsContent, needsTitle } from './widgets'

/**
 * Design checks for an app page (pure, client-safe; __tests__/apps-polish.test.ts):
 * what makes a page look unfinished to the people using it. The builder's
 * Checks panel lists them (with one-click fixes where the fix is safe), the
 * publish dialog repeats the warnings, and the app spec compiler
 * (lib/apps/spec.ts designWarnings) hands them to the Agent / MCP so
 * generated apps follow the same conventions:
 *
 *  - placeholder labels ("Link", "Page", "New tile") on menu entries,
 *    buttons, tiles, tabs and links — viewers never see them (the target's
 *    name is shown instead), but the builder asks for a real label;
 *  - the same page twice in a nav bar or menu;
 *  - two navigations for the same pages (the app's tabs and a nav bar that
 *    keeps them, or two nav bars);
 *  - a page header that isn't at the top of the page;
 *  - data widgets without a title;
 *  - list widgets with a fixed height much taller than their rows;
 *  - nav entries whose icon differs from their page's icon.
 */

export type CheckSeverity = 'warning' | 'info'
export type FixKind = 'complete_nav' | 'dedupe_nav' | 'labels_from_targets' | 'move_header_top' | 'auto_title' | 'auto_height' | 'page_icons' | 'hide_app_nav'

export interface DesignCheck {
  /** Stable per page: `<code>:<widget id>[:<n>]`. */
  key: string
  code: 'placeholder_label' | 'duplicate_nav' | 'redundant_nav' | 'header_not_first' | 'missing_title' | 'oversized_list' | 'icon_mismatch' | 'empty_page'
  severity: CheckSeverity
  message: string
  widget?: string
  fix?: { kind: FixKind; label: string }
}

export interface CheckApp {
  nav?: Pick<AppNav, 'style'> | null
  menu?: readonly AppMenuItem[]
  pages: ReadonlyArray<{ slug: string; title: string; icon?: string | null; hidden?: boolean }>
}

type Leaf = Exclude<AppMenuLeaf, { kind: 'divider' } | { kind: 'heading' }>

function leaves(items: readonly AppMenuItem[]): Leaf[] {
  const out: Leaf[] = []
  for (const m of items) {
    if (m.kind === 'group') out.push(...leaves(m.items as AppMenuItem[]))
    else if (m.kind !== 'divider' && m.kind !== 'heading') out.push(m)
  }
  return out
}

/** A menu entry's target as a comparable key (same key twice = a duplicate). */
export function targetKey(item: Leaf): string {
  switch (item.kind) {
    case 'page': return `page:${item.page_slug}:${JSON.stringify(item.filters ?? {})}`
    case 'url': return `url:${item.url}`
    case 'form': return `form:${item.form_id}`
    case 'report': return `report:${item.report_id}`
    case 'record': return `record:${item.table_id}:${item.row_id ?? ''}`
    case 'workflow': return `workflow:${item.workflow_id}`
    case 'tasks': return `tasks:${item.view}`
  }
}

/** The menu with repeated targets removed (the first of each kept). */
export function dedupeMenu<T extends AppMenuItem>(items: readonly T[], seen: Set<string> = new Set()): T[] {
  const out: T[] = []
  for (const m of items) {
    if (m.kind === 'group') { out.push({ ...m, items: dedupeMenu(m.items as AppMenuItem[], seen) } as T); continue }
    if (m.kind === 'divider' || m.kind === 'heading') { out.push(m); continue }
    const key = targetKey(m as Leaf)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m)
  }
  return out
}

const quote = (s: string) => `“${s}”`

function menuLabelChecks(items: readonly AppMenuItem[], where: string, ctx: LabelContext, keyBase: string, widget?: string): DesignCheck[] {
  const out: DesignCheck[] = []
  const all = leaves(items)
  const placeholders = all.filter((i) => isPlaceholderLabel(i.label))
  if (placeholders.length) {
    const named = placeholders.map((i) => `${quote(i.label || '(empty)')} → ${quote(displayLabel(i, ctx))}`)
    out.push({
      key: `placeholder_label:${keyBase}`, code: 'placeholder_label', severity: 'warning', widget,
      message: `${where}: ${placeholders.length === 1 ? 'an entry has' : `${placeholders.length} entries have`} a placeholder label (${named.slice(0, 3).join(', ')}${named.length > 3 ? '…' : ''}). Viewers see the target’s name instead — give ${placeholders.length === 1 ? 'it' : 'them'} a real label.`,
      fix: { kind: 'labels_from_targets', label: 'Use target names' },
    })
  }
  const keys = all.map(targetKey)
  const dups = all.filter((_, i) => keys.indexOf(keys[i]) !== i)
  if (dups.length) {
    out.push({
      key: `duplicate_nav:${keyBase}`, code: 'duplicate_nav', severity: 'warning', widget,
      message: `${where}: ${dups.map((d) => quote(displayLabel(d, ctx))).join(', ')} ${dups.length === 1 ? 'appears' : 'appear'} twice. Viewers see each target once.`,
      fix: { kind: 'dedupe_nav', label: 'Remove duplicates' },
    })
  }
  return out
}

function pageSlugsIn(items: readonly AppMenuItem[]): Set<string> {
  return new Set(leaves(items).filter((i): i is Extract<Leaf, { kind: 'page' }> => i.kind === 'page').map((i) => i.page_slug))
}

/** Rows of list content a fixed card of h rows holds (≈52px per row, minus padding and the title bar). */
function rowsThatFit(h: number): number {
  const px = h * 40 + (h - 1) * 12 - 26 - 32
  return Math.max(0, Math.floor(px / 52))
}

/** The checks for one page of an app (widgets as edited). */
export function pageChecks(app: CheckApp, page: { title: string; widgets: readonly AppWidget[] }, opts: { name?: LabelContext['name'] } = {}): DesignCheck[] {
  const ctx: LabelContext = { pages: app.pages, name: opts.name }
  const out: DesignCheck[] = []
  const widgets = page.widgets
  if (!widgets.length) {
    out.push({ key: 'empty_page', code: 'empty_page', severity: 'info', message: 'This page has no widgets yet — add some or start from a template.' })
    return out
  }
  const named = (w: AppWidget) => w.title?.trim() ? `${catalogEntry(w.type).title} ${quote(w.title.trim())}` : catalogEntry(w.type).title
  const visiblePages = app.pages.filter((p) => !p.hidden)
  const appNavShown = !!app.nav && app.nav.style !== 'none' && visiblePages.length > 1
  const bars = widgets.filter((w): w is AppWidget<'nav_bar'> => w.type === 'nav_bar')

  for (const bar of bars) {
    const c = bar.config as WidgetConfig<'nav_bar'>
    out.push(...menuLabelChecks(c.items, `Nav bar (${c.edge})`, ctx, bar.id, bar.id))
    const slugs = pageSlugsIn(c.items)
    const listed = visiblePages.filter((p) => slugs.has(p.slug))
    if (appNavShown && listed.length) {
      const missing = visiblePages.filter((p) => !slugs.has(p.slug))
      if (missing.length) {
        out.push({
          key: `redundant_nav:${bar.id}`, code: 'redundant_nav', severity: 'warning', widget: bar.id,
          message: `The ${c.edge} nav bar lists ${listed.map((p) => quote(p.title)).join(', ')} while the app’s ${app.nav!.style} navigation lists every page — two menus for the same pages. Add ${missing.map((p) => quote(p.title)).join(', ')} to the bar and it replaces the app navigation on this page (or keep the bar for links and forms only).`,
          fix: { kind: 'complete_nav', label: 'Add the missing pages' },
        })
      } else if (c.app_nav === 'show') {
        out.push({
          key: `redundant_nav:${bar.id}`, code: 'redundant_nav', severity: 'warning', widget: bar.id,
          message: `The ${c.edge} nav bar lists the app’s pages and the app’s ${app.nav!.style} navigation is shown too — two menus for the same pages. Let the bar replace the app navigation on this page.`,
          fix: { kind: 'hide_app_nav', label: 'Use only the nav bar' },
        })
      }
    }
    // Page entries: the page's own icon (or none) keeps icons consistent.
    const pageItems = leaves(c.items).filter((i): i is Extract<Leaf, { kind: 'page' }> => i.kind === 'page' && !!i.icon)
    const mismatched = pageItems.filter((i) => {
      const page = app.pages.find((p) => p.slug === i.page_slug)
      return page && page.icon ? page.icon !== i.icon : pageItems.some((o) => o !== i && o.page_slug === i.page_slug && o.icon !== i.icon)
    })
    if (mismatched.length) {
      out.push({
        key: `icon_mismatch:${bar.id}`, code: 'icon_mismatch', severity: 'info', widget: bar.id,
        message: `Nav bar (${c.edge}): ${mismatched.map((i) => quote(displayLabel(i, ctx))).join(', ')} ${mismatched.length === 1 ? 'uses' : 'use'} a different icon from ${mismatched.length === 1 ? 'its page' : 'their pages'}. Page entries read best with the page’s own icon.`,
        fix: { kind: 'page_icons', label: 'Use page icons' },
      })
    }
  }
  if (bars.length > 1) {
    const sets = bars.map((b) => pageSlugsIn((b.config as WidgetConfig<'nav_bar'>).items))
    const shared = [...sets[0]].filter((s) => sets.slice(1).some((x) => x.has(s)))
    if (shared.length >= 2) out.push({ key: `redundant_nav:bars`, code: 'redundant_nav', severity: 'warning', message: `${bars.length} nav bars list the same pages (${shared.slice(0, 3).join(', ')}). Keep one menu for the pages; use the other for links or forms.` })
  }

  // Page header: first in reading order (after docked nav bars).
  const flow = widgets.filter((w) => w.type !== 'nav_bar')
  const headerAt = flow.findIndex((w) => w.type === 'page_header')
  if (headerAt > 0) {
    out.push({
      key: `header_not_first:${flow[headerAt].id}`, code: 'header_not_first', severity: 'warning', widget: flow[headerAt].id,
      message: `The page header is widget ${headerAt + 1} of ${flow.length} — it introduces the page, so it belongs at the top.`,
      fix: { kind: 'move_header_top', label: 'Move to the top' },
    })
  }

  for (const w of widgets) {
    const c = w.config as Record<string, unknown>
    if (w.type === 'actions') {
      const buttons = (c.buttons as ActionButton[]).filter((b) => b.icon_position !== 'only' && isPlaceholderLabel(b.label))
      if (buttons.length) out.push({ key: `placeholder_label:${w.id}`, code: 'placeholder_label', severity: 'warning', widget: w.id, message: `${named(w)}: ${buttons.map((b) => `${quote(b.label || '(empty)')} → ${quote(displayActionLabel(b.label, b.action, ctx))}`).join(', ')} — give ${buttons.length === 1 ? 'the button' : 'these buttons'} a short verb label (“New claim”).`, fix: { kind: 'labels_from_targets', label: 'Use target names' } })
    }
    if (w.type === 'tiles') {
      const tiles = (c.tiles as Array<{ label: string; action: ActionButton['action'] }>).filter((t) => isPlaceholderLabel(t.label))
      if (tiles.length) out.push({ key: `placeholder_label:${w.id}`, code: 'placeholder_label', severity: 'warning', widget: w.id, message: `${named(w)}: ${tiles.length} tile${tiles.length === 1 ? '' : 's'} still called ${quote(tiles[0].label || '(empty)')} — name each after what it opens.`, fix: { kind: 'labels_from_targets', label: 'Use target names' } })
    }
    if (w.type === 'links') {
      const links = (c.links as Array<{ label: string; url: string }>).filter((l) => isPlaceholderLabel(l.label))
      if (links.length) out.push({ key: `placeholder_label:${w.id}`, code: 'placeholder_label', severity: 'warning', widget: w.id, message: `${named(w)}: ${links.length} link${links.length === 1 ? ' is' : 's are'} labelled ${quote(links[0].label || '(empty)')} — say where ${links.length === 1 ? 'it goes' : 'they go'}.`, fix: { kind: 'labels_from_targets', label: 'Use target names' } })
    }
    if (w.type === 'tabs') {
      const tabs = (c.tabs as Array<{ label: string }>).filter((t) => /^tab \d+$/i.test(t.label.trim()))
      if (tabs.length) out.push({ key: `placeholder_label:${w.id}`, code: 'placeholder_label', severity: 'warning', widget: w.id, message: `${named(w)}: ${tabs.map((t) => quote(t.label)).join(', ')} — name each tab after what it shows.` })
    }
    if (needsTitle(w.type) && !w.title?.trim()) {
      out.push({ key: `missing_title:${w.id}`, code: 'missing_title', severity: 'warning', widget: w.id, message: `${catalogEntry(w.type).title} without a title — viewers (and screen readers) see ${quote(autoTitle(w))} for now.`, fix: { kind: 'auto_title', label: `Use ${quote(autoTitle(w))}` } })
    }
    if (fitsContent(w.type) && w.height === 'fixed' && typeof c.limit === 'number' && ['task_list', 'overdue_list', 'my_submissions', 'recent', 'recent_failures', 'activity_feed'].includes(w.type)) {
      const fit = rowsThatFit(w.h)
      if (c.limit < fit - 1) out.push({ key: `oversized_list:${w.id}`, code: 'oversized_list', severity: 'info', widget: w.id, message: `${named(w)} shows at most ${c.limit} row${c.limit === 1 ? '' : 's'} in a card with room for ${fit} — let it fit its content.`, fix: { kind: 'auto_height', label: 'Auto height' } })
    }
  }
  return out
}

/** Checks for the app menu (App settings): placeholder labels and duplicates. */
export function menuChecks(app: CheckApp, opts: { name?: LabelContext['name'] } = {}): DesignCheck[] {
  return menuLabelChecks(app.menu ?? [], 'App menu', { pages: app.pages, name: opts.name }, 'menu')
}

/* ── Fixes ───────────────────────────────────────────────────────────── */

function labelMenu<T extends AppMenuItem>(items: readonly T[], ctx: LabelContext): T[] {
  return items.map((m) => {
    if (m.kind === 'group') return { ...m, items: labelMenu(m.items as AppMenuItem[], ctx) } as T
    if (m.kind === 'divider' || m.kind === 'heading' || !isPlaceholderLabel(m.label)) return m
    const label = displayLabel(m, ctx)
    return label && label !== 'Untitled' ? { ...m, label } : m
  })
}

function pageIconsOff<T extends AppMenuItem>(items: readonly T[]): T[] {
  return items.map((m) => (m.kind === 'group' ? { ...m, items: pageIconsOff(m.items as AppMenuItem[]) } as T : m.kind === 'page' ? { ...m, icon: null } : m))
}

/** Apply one check's fix to the page's widgets (unchanged when it has none). */
export function applyCheckFix(widgets: readonly AppWidget[], check: Pick<DesignCheck, 'fix' | 'widget' | 'code'>, app: CheckApp, opts: { name?: LabelContext['name'] } = {}): AppWidget[] {
  const ctx: LabelContext = { pages: app.pages, name: opts.name }
  const kind = check.fix?.kind
  if (!kind) return [...widgets]
  if (kind === 'move_header_top') {
    const header = widgets.find((w) => w.id === check.widget)
    if (!header) return [...widgets]
    const rest = widgets.filter((w) => w !== header)
    const at = rest.findIndex((w) => w.type !== 'nav_bar')
    rest.splice(at < 0 ? rest.length : at, 0, header)
    return rest
  }
  return widgets.map((w) => {
    if (check.widget && w.id !== check.widget) return w
    const c = w.config as Record<string, unknown>
    switch (kind) {
      case 'dedupe_nav': return w.type === 'nav_bar' ? { ...w, config: { ...c, items: dedupeMenu(c.items as AppMenuItem[]) } as never } : w
      case 'page_icons': return w.type === 'nav_bar' ? { ...w, config: { ...c, items: pageIconsOff(c.items as AppMenuItem[]) } as never } : w
      case 'hide_app_nav': return w.type === 'nav_bar' ? { ...w, config: { ...c, app_nav: 'hide' } as never } : w
      case 'complete_nav': {
        if (w.type !== 'nav_bar') return w
        const items = c.items as AppMenuItem[]
        const have = pageSlugsIn(items)
        const add = app.pages.filter((p) => !p.hidden && !have.has(p.slug)).map((p) => ({ kind: 'page' as const, label: p.title, page_slug: p.slug, icon: null }))
        // Page entries first (in the app's page order), then the bar's links and forms.
        const firstOther = items.findIndex((i) => i.kind !== 'page')
        const at = firstOther < 0 ? items.length : firstOther
        return { ...w, config: { ...c, app_nav: 'hide', items: [...items.slice(0, at), ...add, ...items.slice(at)] } as never }
      }
      case 'auto_title': return needsTitle(w.type) && !w.title?.trim() ? { ...w, title: autoTitle(w) } : w
      case 'auto_height': return fitsContent(w.type) ? { ...w, height: 'auto' as const, h: Math.min(w.h, Math.max(catalogEntry(w.type).minH, 6)) } : w
      case 'labels_from_targets': {
        if (w.type === 'nav_bar') return { ...w, config: { ...c, items: labelMenu(c.items as AppMenuItem[], ctx) } as never }
        if (w.type === 'actions') return { ...w, config: { ...c, buttons: (c.buttons as ActionButton[]).map((b) => (isPlaceholderLabel(b.label) ? { ...b, label: displayActionLabel(b.label, b.action, ctx) } : b)) } as never }
        if (w.type === 'tiles') return { ...w, config: { ...c, tiles: (c.tiles as Array<{ label: string; action: ActionButton['action'] }>).map((t) => (isPlaceholderLabel(t.label) ? { ...t, label: displayActionLabel(t.label, t.action, ctx) } : t)) } as never }
        if (w.type === 'links') return { ...w, config: { ...c, links: (c.links as Array<{ label: string; url: string }>).map((l) => (isPlaceholderLabel(l.label) ? { ...l, label: displayLabel({ kind: 'url', label: l.label, url: l.url } as never, ctx) } : l)) } as never }
        return w
      }
      default: return w
    }
  })
}

/** Every safe fix at once (the Checks panel's "Fix all"). */
export function applyAllFixes(widgets: readonly AppWidget[], app: CheckApp, opts: { name?: LabelContext['name'] } = {}): AppWidget[] {
  let out = [...widgets]
  for (let pass = 0; pass < 3; pass++) {
    const checks = pageChecks(app, { title: '', widgets: out }, opts).filter((c) => c.fix && c.fix.kind !== 'auto_height')
    if (!checks.length) break
    for (const c of checks) out = applyCheckFix(out, c, app, opts)
  }
  return out
}

/** Widgets that size to their content on this page (for the checks' wording and the builder's size badge). */
export function autoSized(widgets: readonly AppWidget[]): string[] {
  return widgets.filter((w) => autoHeightCap(w) !== null).map((w) => w.id)
}

/** Design warnings for a whole app (publish dialog): each page's warnings and the app menu's, as plain lines. */
export function appDesignWarnings(app: CheckApp & { pageLayouts: ReadonlyArray<{ title: string; widgets: readonly AppWidget[] }> }): string[] {
  const out: string[] = []
  for (const p of app.pageLayouts) for (const c of pageChecks(app, p)) if (c.severity === 'warning') out.push(`${p.title}: ${c.message}`)
  for (const c of menuChecks(app)) out.push(c.message)
  return [...new Set(out)].slice(0, 20)
}
