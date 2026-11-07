/**
 * Steps and tabs: a form's grid organised into pages (lib/forms/layout.ts
 * `mode` + `pages`). Pure page operations for the designer (add, rename,
 * reorder, duplicate-free moves, delete with the fields moved elsewhere,
 * switching mode) and the runtime arithmetic every surface shares: which
 * pages are visible for the current values, the progress of a wizard, a
 * page's own validation and where the errors are.
 *
 * Pages are layout only: values, `{{task_data.<key>}}` and downstream
 * variables are unchanged, and the server still validates every visible
 * field across pages (validateTaskFieldValues with the layout).
 */

import { alwaysRuleEffects } from './form-rules'
import { isRuleMet, validateTaskFieldValues, type TaskFieldDef } from '@/lib/task-field-schema'
import {
  MAX_FORM_PAGES, allRows, isPaged, mapStateTargets, normalizePageSettings, pageOfField, placeField, removeFieldFromLayout, rowTag,
  type FormLayout, type FormPage, type FormPageMode, type FormPageSettings, type FormRow, type StepIndicator,
} from './layout'
import { hiddenPageIds, withFormState } from './form-state'

/** The virtual last step of a wizard with a review (not stored). */
export const REVIEW_STEP_ID = '__review'

export interface ResolvedPageSettings {
  indicator: StepIndicator
  next_label: string
  back_label: string
  allow_skip: boolean
  review: boolean
  review_title: string
  resume: boolean
}

/** Page settings with their defaults. */
export function pageSettings(layout: FormLayout | null | undefined): ResolvedPageSettings {
  const s: FormPageSettings = layout?.page_settings ?? {}
  return {
    indicator: s.indicator ?? 'numbered',
    next_label: s.next_label || 'Next',
    back_label: s.back_label || 'Back',
    allow_skip: s.allow_skip === true,
    review: s.review === true,
    review_title: s.review_title || 'Review your answers',
    resume: s.resume === true,
  }
}

/** The form's mode ('single' without pages). */
export function pageMode(layout: FormLayout | null | undefined): FormPageMode {
  return isPaged(layout) ? layout.mode : 'single'
}

const noun = (mode: FormPageMode) => (mode === 'tabs' ? 'Tab' : 'Step')
const DEFAULT_TITLE = /^(Step|Tab|Page) (\d+)$/

/** Field keys on a page, in reading order. */
export function pageFieldKeys(page: Pick<FormPage, 'rows'>): string[] {
  return page.rows.flatMap((row) => row.cells.map((cell) => cell.field_key))
}

function newPageId(pages: FormPage[]): string {
  const taken = new Set(pages.map((p) => p.id))
  let n = pages.length + 1
  while (taken.has(`page_${n}`)) n += 1
  return `page_${n}`
}

/* ── Designer operations ─────────────────────────────────────────────── */

/**
 * Switch mode. Single → steps / tabs: one page holding the whole grid (add
 * more from the designer). Steps ↔ tabs: the pages stay (default titles
 * follow: "Step 2" ↔ "Tab 2"). → single: every page's rows become the one
 * grid, in page order (undo brings the pages back).
 */
export function setPageMode(layout: FormLayout, mode: FormPageMode): FormLayout {
  const current = pageMode(layout)
  if (mode === current) return layout
  // Form state and Application mode carry over (page targets are dropped without pages).
  const extras: Pick<FormLayout, 'state' | 'application_mode' | 'params' | 'variables' | 'sections' | 'submitted_page' | 'form_actions' | 'animation' | 'task_completed'> = {
    ...(layout.state ? { state: { ...layout.state } } : {}),
    ...(layout.sections?.length ? { sections: layout.sections } : {}),
    ...(layout.application_mode ? { application_mode: true } : {}),
    ...(layout.params?.length ? { params: layout.params } : {}),
    ...(layout.variables?.length ? { variables: layout.variables } : {}),
    ...(layout.submitted_page ? { submitted_page: layout.submitted_page } : {}),
    ...(layout.form_actions ? { form_actions: { ...layout.form_actions } } : {}),
    ...(layout.animation ? { animation: { ...layout.animation } } : {}),
    ...(layout.task_completed ? { task_completed: layout.task_completed } : {}),
  }
  if (mode === 'single') return mapStateTargets({ rows: allRows(layout).map(cloneRow), ...extras }, (t) => (t.startsWith('page:') ? null : t))
  if (current === 'single') {
    const page: FormPage = { id: 'page_1', title: `${noun(mode)} 1`, rows: layout.rows.map(cloneRow) }
    return { rows: [], mode, pages: [page], ...(layout.page_settings ? { page_settings: { ...layout.page_settings } } : {}), ...extras }
  }
  return {
    ...layout,
    mode,
    pages: layout.pages!.map((page) => {
      const m = DEFAULT_TITLE.exec(page.title)
      return m ? { ...page, title: `${noun(mode)} ${m[2]}` } : page
    }),
  }
}

function cloneRow(row: FormRow): FormRow {
  return { columns: row.columns, cells: row.cells.map((cell) => ({ ...cell })), ...rowTag(row) }
}

/** Add an empty page (after `after`, default: at the end). */
export function addPage(layout: FormLayout, options: { title?: string; after?: string } = {}): { layout: FormLayout; id: string } {
  if (!isPaged(layout) || layout.pages.length >= MAX_FORM_PAGES) return { layout, id: '' }
  const id = newPageId(layout.pages)
  const page: FormPage = { id, title: options.title?.trim() || `${noun(layout.mode)} ${layout.pages.length + 1}`, rows: [] }
  const pages = [...layout.pages]
  const at = options.after ? pages.findIndex((p) => p.id === options.after) + 1 : pages.length
  pages.splice(at > 0 ? at : pages.length, 0, page)
  return { layout: { ...layout, pages }, id }
}

/** Patch a page's title / description / icon / rule (undefined clears an optional one). */
export function updatePage(layout: FormLayout, id: string, patch: Partial<Omit<FormPage, 'id' | 'rows'>>): FormLayout {
  if (!isPaged(layout)) return layout
  return {
    ...layout,
    pages: layout.pages.map((page) => {
      if (page.id !== id) return page
      const next: FormPage = { ...page, ...patch }
      for (const key of ['description', 'icon', 'visible_when', 'load', 'preload'] as const) if (key in patch && !patch[key]) delete next[key]
      if (!next.load || next.load === 'eager') { delete next.load; delete next.preload }
      return next
    }),
  }
}

/** Move a page to position `index` (drag), clamped. */
export function movePageTo(layout: FormLayout, id: string, index: number): FormLayout {
  if (!isPaged(layout)) return layout
  const from = layout.pages.findIndex((p) => p.id === id)
  if (from < 0) return layout
  const to = Math.max(0, Math.min(layout.pages.length - 1, index))
  if (to === from) return layout
  const pages = [...layout.pages]
  const [page] = pages.splice(from, 1)
  pages.splice(to, 0, page)
  return { ...layout, pages }
}

/** Move a page one place earlier / later (keyboard). */
export function movePage(layout: FormLayout, id: string, delta: number): FormLayout {
  if (!isPaged(layout)) return layout
  const from = layout.pages.findIndex((p) => p.id === id)
  if (from < 0 || from + delta < 0 || from + delta >= layout.pages.length) return layout
  return movePageTo(layout, id, from + delta)
}

/**
 * Delete a page. Its fields move to the end of `moveTo` (keeping their
 * rows), or — `moveTo` null — leave the form (`removedKeys`, which the
 * designer deletes). The last page can't be deleted (switch to a single
 * page instead).
 */
export function removePage(layout: FormLayout, id: string, moveTo: string | null): { layout: FormLayout; removedKeys: string[] } {
  if (!isPaged(layout) || layout.pages.length <= 1) return { layout, removedKeys: [] }
  const page = layout.pages.find((p) => p.id === id)
  if (!page) return { layout, removedKeys: [] }
  const target = moveTo && moveTo !== id ? layout.pages.find((p) => p.id === moveTo) : null
  const keys = pageFieldKeys(page)
  const moved = page.rows.filter((row) => row.cells.length > 0).map(cloneRow)
  let next: FormLayout = {
    ...layout,
    pages: layout.pages.filter((p) => p.id !== id).map((p) => (target && p.id === target.id ? { ...p, rows: [...p.rows.map(cloneRow), ...moved] } : p)),
  }
  if (target) return { layout: next, removedKeys: [] }
  for (const key of keys) next = removeFieldFromLayout(next, key)
  return { layout: next, removedKeys: keys }
}

/**
 * Move a field onto another page (dropped on the page's tab in the
 * designer): it leaves its row (a row it leaves empty goes too) and takes a
 * new full-width row at the end of the target page.
 */
export function moveFieldToPage(layout: FormLayout, key: string, pageId: string): FormLayout {
  if (!isPaged(layout)) return layout
  const from = pageOfField(layout, key)
  if (!layout.pages.some((p) => p.id === pageId) || from?.id === pageId) return layout
  return {
    ...layout,
    pages: layout.pages.map((page) => {
      if (page.id === from?.id) {
        return { ...page, rows: page.rows.map((row) => ({ columns: row.columns, cells: row.cells.filter((c) => c.field_key !== key).map((c) => ({ ...c })), ...rowTag(row) })).filter((row, i) => row.cells.length > 0 || page.rows[i].cells.length === 0 || row.section !== undefined) }
      }
      if (page.id === pageId) return { ...page, rows: placeField({ rows: page.rows }, key, page.rows.length, 0).rows }
      return page
    }),
  }
}

/** Steps / tabs settings patch (undefined / false / '' clear a value). */
export function updatePageSettings(layout: FormLayout, patch: Partial<FormPageSettings>): FormLayout {
  if (!isPaged(layout)) return layout
  const merged = { ...(layout.page_settings ?? {}), ...patch } as Record<string, unknown>
  const settings = normalizePageSettings(merged)
  const next: FormLayout = { ...layout }
  if (settings) next.page_settings = settings
  else delete next.page_settings
  return next
}

/**
 * Page problems for the designer. `blocking`: a page without a title.
 * `warnings`: a steps rule on a field of the same or a later step (it is
 * judged before that field is answered, so the step would stay hidden or
 * shown until then); a page with no fields.
 */
export function pageProblems(layout: FormLayout): { blocking: Record<string, string>; warnings: Record<string, string> } {
  const blocking: Record<string, string> = {}
  const warnings: Record<string, string> = {}
  if (!isPaged(layout)) return { blocking, warnings }
  layout.pages.forEach((page, i) => {
    if (!page.title.trim()) { blocking[page.id] = `${noun(layout.mode)} ${i + 1} needs a title`; return }
    if (page.visible_when) {
      const source = pageOfField(layout, page.visible_when.field)
      const at = source ? layout.pages.findIndex((p) => p.id === source.id) : -1
      if (layout.mode === 'steps' && at >= i) warnings[page.id] = 'Its rule uses a field on this or a later step: pick a field from an earlier step'
    }
    if (!warnings[page.id] && !page.rows.some((row) => row.cells.length)) warnings[page.id] = 'No fields yet'
  })
  return { blocking, warnings }
}

/* ── Runtime ─────────────────────────────────────────────────────────── */

/**
 * Pages shown for these values: the page's `visible_when` holds (state
 * flags included) and no in-form button hid it (lib/forms/form-state.ts).
 */
export function visiblePages(layout: FormLayout | null | undefined, values: Record<string, unknown>): FormPage[] {
  if (!isPaged(layout)) return []
  const scope = withFormState(layout, values)
  const hidden = hiddenPageIds(layout, scope)
  // "Always" form rules that show / hide a step or tab (lib/forms/form-rules.ts).
  if (layout.rules?.length) for (const target of alwaysRuleEffects(layout, scope).hidden) if (target.startsWith('page:')) hidden.add(target.slice(5))
  return layout.pages.filter((page) => !hidden.has(page.id) && isRuleMet(page.visible_when, scope))
}

export interface StepInfo {
  id: string
  title: string
  kind: 'page' | 'review'
}

export interface StepProgress {
  steps: StepInfo[]
  /** 0-based position of the current step among the shown steps. */
  index: number
  total: number
  /** Share of the steps reached, current one included (Step 2 of 4 → 50). */
  percent: number
  label: string
}

/** Steps (or tabs) shown — hidden ones don't count — plus the review step when on (steps only). */
export function wizardSteps(layout: FormLayout | null | undefined, values: Record<string, unknown>): StepInfo[] {
  const steps: StepInfo[] = visiblePages(layout, values).map((page) => ({ id: page.id, title: page.title, kind: 'page' }))
  if (steps.length && layout?.mode === 'steps' && pageSettings(layout).review) steps.push({ id: REVIEW_STEP_ID, title: pageSettings(layout).review_title, kind: 'review' })
  return steps
}

/** Where the wizard is: "Step 2 of 4", 50 %. An unknown / hidden current step counts as the first. */
export function stepProgress(layout: FormLayout | null | undefined, values: Record<string, unknown>, currentId: string | null | undefined): StepProgress {
  const steps = wizardSteps(layout, values)
  const total = steps.length
  const index = Math.max(0, steps.findIndex((s) => s.id === currentId))
  const percent = total ? Math.round(((index + 1) / total) * 100) : 0
  return { steps, index, total, percent, label: total ? `Step ${index + 1} of ${total}` : '' }
}

/**
 * The step to show when `currentId` is no longer shown (its rule stopped
 * holding): the nearest shown step before it in the page order, else the
 * first shown step.
 */
export function resolveCurrentStep(layout: FormLayout | null | undefined, values: Record<string, unknown>, currentId: string | null | undefined): string | null {
  const steps = wizardSteps(layout, values)
  if (!steps.length) return null
  if (currentId && steps.some((s) => s.id === currentId)) return currentId
  if (isPaged(layout) && currentId) {
    const order = layout.pages.map((p) => p.id)
    const at = order.indexOf(currentId)
    for (let i = at - 1; i >= 0; i--) if (steps.some((s) => s.id === order[i])) return order[i]
  }
  return steps[0].id
}

/** The fields on one page. */
export function pageFields(fields: TaskFieldDef[], page: Pick<FormPage, 'rows'>): TaskFieldDef[] {
  const keys = new Set(pageFieldKeys(page))
  return fields.filter((f) => keys.has(f.key))
}

/**
 * Validate one page (Next): its fields only, with the same rules as the
 * final submit — except Before-submit rules, which run at submit unless the
 * author asked for them on the step too (`step_check`), and errors on other
 * steps' fields, which never block Next (they show at submit, on their step).
 */
export function validatePage(fields: TaskFieldDef[], layout: FormLayout, pageId: string, values: Record<string, unknown>): Record<string, string> {
  const page = isPaged(layout) ? layout.pages.find((p) => p.id === pageId) : null
  if (!page) return {}
  return validateTaskFieldValues(fields, values, { layout, step: { keys: new Set(pageFieldKeys(page)) } })
}

/** Errors per page (tab badges / stepper marks): page id → count of fields with an error. */
export function pageErrorCounts(layout: FormLayout | null | undefined, errors: Record<string, string> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  if (!isPaged(layout) || !errors) return out
  for (const page of layout.pages) {
    const count = pageFieldKeys(page).filter((key) => errors[key]).length
    if (count) out[page.id] = count
  }
  return out
}

/** The first shown page holding an error (jump there after a failed submit), or null. */
export function firstPageWithError(layout: FormLayout | null | undefined, errors: Record<string, string> | null | undefined, values: Record<string, unknown>): string | null {
  const counts = pageErrorCounts(layout, errors)
  return visiblePages(layout, values).find((page) => counts[page.id])?.id ?? null
}

/** A page's field keys for a field-key → page-id lookup. */
export function pageIdByField(layout: FormLayout | null | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (!isPaged(layout)) return out
  for (const page of layout.pages) for (const key of pageFieldKeys(page)) out.set(key, page.id)
  return out
}
