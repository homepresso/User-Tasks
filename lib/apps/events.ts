import type { ButtonAction, ClickTarget, DateRangeValue, OpenMode } from './schema'
import { openModeFor, targetOf, type PanelTarget } from './panels'
import type { ParamMap } from './params'
import type { RuleEvent } from './rules'

/**
 * App events and actions — one typed model (pure; __tests__/apps-events.test.ts).
 *
 * Widgets don't act on clicks themselves: they raise an EVENT (a row,
 * card, chart segment or button was clicked, a form was submitted, a tab or
 * a filter changed) and the page runtime turns it into ACTIONS (open a
 * target in a mode, set a filter, navigate to a page, open a URL, copy a
 * link, claim the next task, download a report) and runs them
 * (components/apps/widgets/kit.tsx useAppDispatch).
 *
 * Today the actions come from each widget's own settings (`defaultActions`:
 * click-through, button actions, after-submit). Phase 3 "app rules" (event →
 * condition → actions, page variables) plug in here: a rule engine maps the
 * same events to the same action list before the runtime runs it — no widget
 * changes needed.
 */

export type EventValue = string | DateRangeValue | null

interface EventBase {
  /** The widget that raised it. */
  widget: string
}

export type AppEvent =
  | (EventBase & { type: 'row_click'; value: EventValue; row?: Record<string, string>; click?: ClickTarget })
  | (EventBase & { type: 'card_click'; value: EventValue; card?: Record<string, string>; click?: ClickTarget })
  | (EventBase & { type: 'segment_click'; value: EventValue; click?: ClickTarget })
  | (EventBase & { type: 'button_click'; index: number; label: string; action: ButtonAction; mode?: OpenMode | null })
  | (EventBase & { type: 'form_submitted'; form: string; submission_id?: string | null; values?: Record<string, unknown>; then: { kind: 'none' } | { kind: 'navigate'; page: string } })
  | (EventBase & { type: 'tab_changed'; tab: number })
  | (EventBase & { type: 'filter_changed'; filter: string; value: EventValue })

export const APP_EVENT_TYPES = ['row_click', 'card_click', 'segment_click', 'button_click', 'form_submitted', 'tab_changed', 'filter_changed'] as const

export type AppAction =
  | { kind: 'open_target'; target: PanelTarget; mode: OpenMode; title?: string; /** Forms / pages: their parameters' value sources, resolved when the action runs. */ params?: ParamMap; event?: Record<string, string> }
  | { kind: 'set_filter'; filter: string; value: EventValue; toggle?: boolean }
  | { kind: 'navigate'; page: string; filters?: Record<string, string> }
  | { kind: 'open_url'; url: string; new_tab: boolean }
  | { kind: 'copy_link'; url: string | 'this_page' }
  | { kind: 'claim_next'; widget: string; index: number }
  | { kind: 'download_report'; report: string; label: string }

/** A filter value as it travels in the URL (?f.<id>=…). */
export function encodeEventValue(value: EventValue): string {
  if (value === null) return ''
  if (typeof value === 'string') return value
  if ('preset' in value) return value.preset
  return `${value.from ?? ''}..${value.to ?? ''}`
}

/** Click-through settings → actions: set the filter (toggling), or open the page with it set. */
export function clickActions(click: ClickTarget | undefined | null, value: EventValue): AppAction[] {
  if (!click?.filter && !click?.page) return []
  if (click.page) return [{ kind: 'navigate', page: click.page, ...(click.filter && value !== null ? { filters: { [click.filter]: encodeEventValue(value) } } : {}) }]
  return [{ kind: 'set_filter', filter: click.filter!, value, toggle: true }]
}

/** `{{filter:<id>}}` placeholders in values passed to another page → this page's filter values. */
export function fillFilterTemplates(filters: Record<string, string> | undefined, current: Record<string, unknown>): Record<string, string> | undefined {
  if (!filters) return undefined
  const out = Object.fromEntries(Object.entries(filters)
    .map(([k, v]) => [k, v.replace(/\{\{\s*filter:([a-z][a-z0-9_]*)\s*\}\}/g, (_m, id: string) => { const val = current[id]; return typeof val === 'string' ? val : '' })])
    .filter(([, v]) => v))
  return Object.keys(out).length ? out : undefined
}

/** A button / tile action → actions. */
export function buttonActions(e: Extract<AppEvent, { type: 'button_click' }>, filters: Record<string, unknown> = {}): AppAction[] {
  const a = e.action
  const target = targetOf(a)
  if (target) {
    if (target.t === 'page') {
      const filled = fillFilterTemplates(target.filters, filters)
      return [{ kind: 'open_target', target: { t: 'page', slug: target.slug, ...(filled ? { filters: filled } : {}) }, mode: openModeFor(a, e.mode), title: e.label, ...(a.kind === 'open_page' && a.params && Object.keys(a.params).length ? { params: a.params } : {}) }]
    }
    return [{ kind: 'open_target', target, mode: openModeFor(a, e.mode), title: e.label, ...(a.kind === 'new_submission' && a.params ? { params: a.params } : {}) }]
  }
  switch (a.kind) {
    case 'open_url': return [{ kind: 'open_url', url: a.url, new_tab: a.new_tab }]
    case 'copy_link': return [{ kind: 'copy_link', url: a.target }]
    case 'set_filter': return [{ kind: 'set_filter', filter: a.filter, value: a.value }]
    case 'claim_next': return [{ kind: 'claim_next', widget: e.widget, index: e.index }]
    case 'download_report': return [{ kind: 'download_report', report: a.report_id, label: e.label }]
    default: return []
  }
}

/**
 * The actions an event triggers from the widget's own settings. Phase 3:
 * rules run here too (matching events, checking conditions, appending or
 * replacing actions).
 */
export function defaultActions(e: AppEvent, ctx: { filters?: Record<string, unknown> } = {}): AppAction[] {
  switch (e.type) {
    case 'row_click': case 'card_click': case 'segment_click': return clickActions(e.click, e.value)
    case 'button_click': return buttonActions(e, ctx.filters)
    case 'form_submitted': return e.then.kind === 'navigate' ? [{ kind: 'navigate', page: e.then.page }] : []
    case 'filter_changed': return [{ kind: 'set_filter', filter: e.filter, value: e.value }]
    case 'tab_changed': return []
  }
}

/** Toggle semantics of a click-through filter: clicking the active value again clears it. */
export function nextFilterValue(action: Extract<AppAction, { kind: 'set_filter' }>, current: unknown): EventValue {
  if (action.toggle && typeof action.value === 'string' && current === action.value) return null
  return action.value
}

/**
 * A data grid's bulk row action → one "Grid row action" rule event per
 * selected row (in order), so a rule written for one row (update it, start a
 * workflow for it) runs for each: {{event.row.<column>}}, {{event.label}},
 * {{event.count}} rows in all, this one at {{event.position}}.
 */
export function rowActionEvents(widget: string, index: number, label: string, rows: ReadonlyArray<Record<string, string>>): RuleEvent[] {
  return rows.map((row, i) => ({
    type: 'row_action', widget, button: index,
    payload: { widget, index, label, value: row.id ?? null, row, count: rows.length, position: i + 1 },
  }))
}
