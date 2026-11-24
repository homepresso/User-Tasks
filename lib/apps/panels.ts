import type { ButtonAction, OpenMode, OpenModeKind } from './schema'

/**
 * Open targets and the panel stack (pure, client-safe; __tests__/apps-panels.test.ts).
 *
 * A button, tile, card action or menu entry opens a TARGET — an app page
 * (with filter values; hidden "opened from buttons only" pages included), a
 * form (new submission), a report, a data table record / new record, a
 * workflow's start form or a task — in an OPEN MODE: modal, slide-in panel
 * (right / left), bottom sheet, full-screen overlay, inline, navigation or
 * a new tab. Panels stack: opening a target from inside a panel slides a new
 * one over (the previous stay mounted, peeking), up to MAX_PANELS; the top
 * one closes first (Esc), and closing a panel holding unsaved form data asks
 * first. The stack lives in the URL (?panel=…) so refresh / share restores it.
 * On phones panels become full-width sheets; past the cap the target opens
 * by navigation instead.
 */

export const MAX_PANELS = 5

export type PanelTarget =
  | { t: 'page'; slug: string; filters?: Record<string, string>; /** Page parameters passed by the opener (lib/apps/variables.ts). */ params?: Record<string, string> }
  | { t: 'form'; id: string; params?: Record<string, string> }
  | { t: 'report'; id: string }
  | { t: 'record'; table: string; row?: string | null }
  | { t: 'workflow'; id: string }
  | { t: 'task'; id: string }

export interface Panel {
  /** Stable key within the stack. */
  key: string
  target: PanelTarget
  mode: Exclude<OpenModeKind, 'navigate' | 'tab' | 'inline'>
  width: OpenMode['width']
  motion: OpenMode['motion']
  title?: string
  /** The panel holds unsaved input (a form being filled). */
  dirty?: boolean
  /** Designer size (percent of the window) and whether people may resize it. */
  size?: { w: number; h: number }
  resizable?: boolean
  /** The opener named it (a button label): a loaded form's name doesn't replace it. */
  titleFixed?: boolean
}

/** Size presets as percent of the window: [width, height]. */
export const SIZE_PRESETS: Record<'s' | 'm' | 'l' | 'xl' | 'full', [number, number]> = { s: [36, 50], m: [52, 70], l: [68, 82], xl: [84, 90], full: [100, 100] }
const LEGACY: Record<OpenMode['width'], 's' | 'm' | 'l' | 'full'> = { sm: 's', md: 'm', lg: 'l', full: 'full' }
/** Minimum panel size in px, and how close to the window edge it may grow. */
export const PANEL_MIN = { w: 320, h: 240 }

/** The designer's size for an open mode: explicit percentages, else the preset, else the Phase 1 width. */
export function designSize(mode: Pick<OpenMode, 'width'> & { preset?: OpenMode['preset']; width_pct?: number | null; height_pct?: number | null }): { w: number; h: number } {
  const [pw, ph] = SIZE_PRESETS[mode.preset ?? LEGACY[mode.width] ?? 'm']
  return { w: mode.width_pct ?? pw, h: mode.height_pct ?? ph }
}

/** Pixels for a size in percent, clamped to the minimum and the window (keeping a margin unless full). */
export function sizePx(size: { w: number; h: number }, viewport: { w: number; h: number }): { w: number; h: number } {
  const clamp = (pct: number, total: number, min: number) => (pct >= 100 ? total : Math.max(Math.min(min, total), Math.min(total - 16, Math.round((pct / 100) * total))))
  return { w: clamp(size.w, viewport.w, PANEL_MIN.w), h: clamp(size.h, viewport.h, PANEL_MIN.h) }
}

/** The key a person's chosen size is remembered under (per target). */
export function sizeKey(t: PanelTarget): string {
  const id = t.t === 'page' ? t.slug : t.t === 'record' ? t.table : t.id
  return `ut:apps:panel-size:${t.t}:${id}`
}

/** A person's remembered size, if valid. */
export function parseSavedSize(raw: string | null): { w: number; h: number } | null {
  try {
    const v = JSON.parse(raw ?? 'null') as { w?: unknown; h?: unknown } | null
    const ok = (n: unknown) => typeof n === 'number' && n >= 10 && n <= 100
    return v && ok(v.w) && ok(v.h) ? { w: Math.round(v.w as number), h: Math.round(v.h as number) } : null
  } catch { return null }
}

/** The target an action opens, or null (links, claim, copy, set filter). */
export function targetOf(action: ButtonAction): PanelTarget | null {
  switch (action.kind) {
    case 'new_submission': return { t: 'form', id: action.form_id }
    case 'open_page': return { t: 'page', slug: action.page_slug, ...(action.filters && Object.keys(action.filters).length ? { filters: action.filters } : {}) }
    case 'open_report': return { t: 'report', id: action.report_id }
    case 'open_record': return { t: 'record', table: action.table_id, row: action.row_id ?? null }
    case 'start_workflow': return { t: 'workflow', id: action.workflow_id }
    default: return null
  }
}

/** The open mode for an action: its own, else the Phase 1 default (forms: their `open`; pages: navigate; workflows: modal). */
export function openModeFor(action: ButtonAction, mode: OpenMode | null | undefined): OpenMode {
  if (mode) return mode
  const base: OpenMode = { mode: 'modal', width: 'md', motion: 'auto' }
  switch (action.kind) {
    case 'new_submission': return { ...base, mode: action.open === 'page' ? 'navigate' : action.open === 'tab' ? 'tab' : action.open === 'drawer' ? 'panel_right' : 'modal' }
    case 'open_page': return { ...base, mode: 'navigate' }
    case 'open_report': return { ...base, mode: 'panel_right', width: 'lg' }
    case 'open_record': return { ...base, mode: 'panel_right' }
    default: return base
  }
}

/** The motion actually used: 'auto' picks by mode; reduced motion always 'none'. */
export function motionFor(mode: Panel['mode'], motion: OpenMode['motion'], reducedMotion: boolean): 'slide-right' | 'slide-left' | 'slide-up' | 'fade' | 'scale' | 'none' {
  if (reducedMotion || motion === 'none') return 'none'
  if (motion === 'fade') return 'fade'
  if (motion === 'scale') return 'scale'
  if (mode === 'panel_right') return 'slide-right'
  if (mode === 'panel_left') return 'slide-left'
  if (mode === 'sheet') return 'slide-up'
  if (motion === 'slide') return 'slide-up'
  return mode === 'modal' ? 'scale' : 'fade'
}

const sameTarget = (a: PanelTarget, b: PanelTarget) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Push a panel: an already-open identical target moves to the top instead of
 * opening twice; over the cap returns `overflow` (the caller navigates).
 */
export function pushPanel(stack: readonly Panel[], panel: Omit<Panel, 'key'>, opts: { mobile?: boolean } = {}): { stack: Panel[]; overflow: boolean } {
  const existing = stack.findIndex((p) => sameTarget(p.target, panel.target))
  if (existing >= 0) {
    const [found] = stack.slice(existing, existing + 1)
    return { stack: [...stack.slice(0, existing), ...stack.slice(existing + 1), found], overflow: false }
  }
  if (stack.length >= MAX_PANELS) return { stack: [...stack], overflow: true }
  const mode = opts.mobile ? 'fullscreen' : panel.mode
  const width = opts.mobile ? 'full' : panel.width
  const key = `p${Date.now().toString(36)}${stack.length}`
  return { stack: [...stack, { ...panel, mode, width, key, ...(opts.mobile ? { size: { w: 100, h: 100 }, resizable: false } : {}) }], overflow: false }
}

/** Close the top panel — or report that it holds unsaved data (`confirm`), unless forced. */
export function popPanel(stack: readonly Panel[], opts: { force?: boolean } = {}): { stack: Panel[]; confirm: boolean } {
  if (!stack.length) return { stack: [], confirm: false }
  const top = stack[stack.length - 1]
  if (top.dirty && !opts.force) return { stack: [...stack], confirm: true }
  return { stack: stack.slice(0, -1), confirm: false }
}

/** Close a panel by key and every panel above it; `confirm` when any of those holds unsaved data. */
export function closePanel(stack: readonly Panel[], key: string, opts: { force?: boolean } = {}): { stack: Panel[]; confirm: boolean } {
  const i = stack.findIndex((p) => p.key === key)
  if (i < 0) return { stack: [...stack], confirm: false }
  if (!opts.force && stack.slice(i).some((p) => p.dirty)) return { stack: [...stack], confirm: true }
  return { stack: stack.slice(0, i), confirm: false }
}

export function markDirty(stack: readonly Panel[], key: string, dirty: boolean): Panel[] {
  return stack.map((p) => (p.key === key ? { ...p, dirty } : p))
}

/** Breadcrumb titles, bottom to top ("Settings › Pricing › New item"). */
export function breadcrumb(stack: readonly Panel[]): string[] {
  return stack.map((p) => p.title || defaultTitle(p.target))
}

export function defaultTitle(t: PanelTarget): string {
  switch (t.t) {
    case 'page': return t.slug.replace(/-/g, ' ')
    case 'form': return 'Form'
    case 'report': return 'Report'
    case 'record': return t.row ? 'Record' : 'New record'
    case 'workflow': return 'Start workflow'
    case 'task': return 'Task'
  }
}

/* ── URL (?panel=…) ──────────────────────────────────────────────────── */

const SAFE = /^[A-Za-z0-9_-]{1,80}$/
const MODE_CODES: Record<Panel['mode'], string> = { modal: 'm', panel_right: 'r', panel_left: 'l', sheet: 's', fullscreen: 'f' }
const CODE_MODES = Object.fromEntries(Object.entries(MODE_CODES).map(([k, v]) => [v, k])) as Record<string, Panel['mode']>
const WIDTHS: Panel['width'][] = ['sm', 'md', 'lg', 'full']

/**
 * One panel ↔ "<mode><width>:<kind>:<id>[:<extra>]", e.g. "r1:page:pricing:region=emea",
 * "m1:form:<uuid>". Panels joined by "~". Unknown / unsafe parts are dropped.
 */
export function encodePanels(stack: readonly Panel[]): string | null {
  if (!stack.length) return null
  return stack.map((p) => {
    const head = `${MODE_CODES[p.mode]}${WIDTHS.indexOf(p.width)}`
    const t = p.target
    switch (t.t) {
      case 'page': {
        const f = t.filters ? Object.entries(t.filters).filter(([k, v]) => SAFE.test(k) && v.length <= 80).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join(',') : ''
        const p = t.params ? Object.entries(t.params).filter(([k, v]) => SAFE.test(k) && v.length <= 200).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join(',') : ''
        return `${head}:page:${t.slug}${f || p ? `:${f}` : ''}${p ? `:${p}` : ''}`
      }
      case 'record': return `${head}:record:${t.table}${t.row ? `:${encodeURIComponent(t.row)}` : ''}`
      case 'form': {
        const f = t.params ? Object.entries(t.params).filter(([k, v]) => SAFE.test(k) && v.length <= 80).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join(',') : ''
        return `${head}:form:${t.id}${f ? `:${f}` : ''}`
      }
      default: return `${head}:${t.t}:${t.id}`
    }
  }).join('~')
}

export function decodePanels(raw: string | null | undefined): Panel[] {
  if (!raw) return []
  const out: Panel[] = []
  for (const [i, part] of raw.split('~').slice(0, MAX_PANELS).entries()) {
    const [head, kind, id, extra, extra2] = part.split(':')
    const mode = CODE_MODES[head?.[0] ?? '']
    const width = WIDTHS[Number(head?.slice(1))] ?? 'md'
    if (!mode || !id || !SAFE.test(id)) continue
    let target: PanelTarget | null = null
    if (kind === 'page') {
      const filters: Record<string, string> = {}
      for (const pair of (extra ?? '').split(',').filter(Boolean)) {
        const [k, v] = pair.split('=')
        if (k && SAFE.test(k) && v !== undefined) { try { filters[k] = decodeURIComponent(v).slice(0, 200) } catch { /* bad escape */ } }
      }
      const params: Record<string, string> = {}
      for (const pair of (extra2 ?? '').split(',').filter(Boolean)) {
        const [k, v] = pair.split('=')
        if (k && SAFE.test(k) && v !== undefined) { try { params[k] = decodeURIComponent(v).slice(0, 2000) } catch { /* bad escape */ } }
      }
      target = { t: 'page', slug: id, ...(Object.keys(filters).length ? { filters } : {}), ...(Object.keys(params).length ? { params } : {}) }
    } else if (kind === 'record') {
      let row: string | null = null
      try { row = extra ? decodeURIComponent(extra).slice(0, 80) : null } catch { row = null }
      target = { t: 'record', table: id, row }
    } else if (kind === 'form') {
      const params: Record<string, string> = {}
      for (const pair of (extra ?? '').split(',').filter(Boolean)) {
        const [k, v] = pair.split('=')
        if (k && SAFE.test(k) && v !== undefined) { try { params[k] = decodeURIComponent(v).slice(0, 200) } catch { /* bad escape */ } }
      }
      target = { t: 'form', id, ...(Object.keys(params).length ? { params } : {}) }
    } else if (kind === 'report' || kind === 'workflow' || kind === 'task') {
      target = { t: kind, id }
    }
    if (target) out.push({ key: `u${i}`, target, mode, width, motion: 'auto' })
  }
  return out
}
