/**
 * Form layout: a simple grid of rows. Each row has 1–4 columns and an ordered
 * list of cells; each cell holds one field (by key) spanning 1..columns
 * columns. Cells flow left to right; a row's spans never exceed its column
 * count. On narrow screens every row collapses to one column.
 *
 * Stored beside the field list (node config `form_layout`, task metadata
 * `form_layout`, reusable forms' `layout`). Absent → the task screen renders
 * the fields as it always has. Every operation here is pure and returns a new
 * layout (the designer's undo history keeps the old ones).
 *
 * Pages (optional): `mode: 'steps' | 'tabs'` with `pages: [{ id, title,
 * description?, icon?, visible_when?, rows }]` organises the grid into a
 * wizard or tabs. Each field sits on exactly one page; the top-level `rows`
 * is then empty (older readers place every field one per row, so a paged
 * form degrades to a single page). Pages are layout only: values and
 * downstream variables are unchanged. Page operations: lib/forms/pages.ts.
 *
 * Form state and the button bar (optional, lib/forms/form-state.ts):
 * `state: { flags, hidden }` — the flags in-form buttons set and the
 * elements that start hidden — and `application_mode: true` (the bottom
 * button bar is not shown). Older readers ignore both (the bar shows,
 * nothing starts hidden).
 *
 * Sections (optional, lib/forms/sections.ts): `sections: [{ key, title,
 * description?, optional?, collapsible?, collapsed?, style?, visible_when? }]`
 * declares named groups, and a row joins one with `section: <key>`. A
 * section is the run of consecutive rows carrying its key (on one page);
 * nesting is one level by construction (a row has one section). Older
 * readers ignore both keys and render the rows flat, so nothing is lost.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { normalizeVisibleWhen, type VisibleWhen } from '@/lib/task-field-schema'
import { normalizeFormStateConfig, parseTarget, stateRuleFlag, type FormStateConfig } from './form-state'
import { normalizeFormRules, renameRuleKey, type FormRule } from './form-rules'
import { normalizeFormParams, normalizeFormVariables, type FormParam, type FormVariable } from './form-params'
import { normalizeSubmittedPage, type SubmittedPageConfig } from './submitted-page'
import { normalizeFormActions, type FormActionsConfig } from './form-actions'
import { normalizeFormAnimation, type FormAnimationConfig } from './motion'
import { normalizeTaskCompletedOverride, type TaskCompletedOverride } from '@/lib/tasks/completion-screen'
import { normalizeFormSource, type FormSourceInfo } from './form-source'

export const MAX_FORM_COLUMNS = 4
export const MAX_FORM_ROWS = 200

export interface FormCell {
  field_key: string
  span: number
}

export interface FormRow {
  columns: number
  cells: FormCell[]
  /** The section the row belongs to (a key of layout.sections). */
  section?: string
}

export type FormSectionStyle = 'bordered' | 'plain'
export const MAX_FORM_SECTIONS = 40

/** A named group of rows (lib/forms/sections.ts). */
export interface FormSection {
  /** Stable key: targets `section:<key>`, the submission's `<key>_included`. Never a field key. */
  key: string
  title: string
  description?: string
  /** The person chooses to fill it in ("Add <title>" / "Remove"); left out → its fields are not required, checked or kept. */
  optional?: boolean
  /** A header button collapses / expands it. */
  collapsible?: boolean
  /** Starts collapsed (collapsible sections). */
  collapsed?: boolean
  /** Default bordered (a card around the group); plain = title and fields only. */
  style?: FormSectionStyle
  /** "Add" button text (optional sections; default "Add <title>"). */
  add_label?: string
  /** Same rule as a field's: a hidden section's fields are hidden (not required, skipped by validation). */
  visible_when?: VisibleWhen
  /** When to load (lib/forms/lazy-load.ts); absent = 'eager' (on form open). */
  load?: FormPartLoad
  /** Lazy parts: warm their control frames and bound properties once the form is idle. */
  preload?: boolean
}

/** How a choice group's switch shows (default radio). */
export type ChoiceGroupDisplay = 'radio' | 'tabs' | 'dropdown'
export const CHOICE_GROUP_DISPLAYS: ChoiceGroupDisplay[] = ['radio', 'tabs', 'dropdown']
export const CHOICE_GROUP_DISPLAY_LABELS: Record<ChoiceGroupDisplay, string> = { radio: 'Radio buttons', tabs: 'Tabs', dropdown: 'Dropdown' }
export const CHOICE_GROUP_LIMITS = { groups: 20, min: 2, max: 6 } as const

/**
 * A choice group (InfoPath's choice group / choice section —
 * lib/forms/sections.ts): one of 2–6 alternative sections shows at a time,
 * picked with a switch above it. The chosen section's key is the value
 * `<key>`; the other alternatives' fields are hidden, not required, not
 * checked and not kept.
 */
export interface FormChoiceGroup {
  /** The value key (`{{form.<key>}}`); never a field or section key. */
  key: string
  label: string
  /** Section keys of the alternatives (2–6, on one page), in switch order. */
  sections: string[]
  /** The alternative chosen when nothing is (default: the first). */
  default?: string
  display?: ChoiceGroupDisplay
}

/**
 * When a step / tab or a section loads (lib/forms/lazy-load.ts):
 * eager = on form open (the default), visible = when first shown / opened,
 * rule = when a rule's "Load section / tab" runs.
 */
export type FormPartLoad = 'eager' | 'visible' | 'rule'
export const FORM_PART_LOADS: FormPartLoad[] = ['eager', 'visible', 'rule']

export type FormPageMode = 'single' | 'steps' | 'tabs'
export const FORM_PAGE_MODES: FormPageMode[] = ['single', 'steps', 'tabs']
export type StepIndicator = 'numbered' | 'progress' | 'dots'
export const STEP_INDICATORS: StepIndicator[] = ['numbered', 'progress', 'dots']
export const MAX_FORM_PAGES = 20

/** Icons a page can show (lucide names; drawn by components/forms/page-icons.tsx). */
export const FORM_PAGE_ICONS = [
  'user', 'users', 'mail', 'phone', 'map-pin', 'home', 'building', 'briefcase', 'calendar', 'clock',
  'file-text', 'paperclip', 'credit-card', 'dollar-sign', 'shopping-cart', 'package', 'truck', 'heart',
  'shield', 'settings', 'list', 'info', 'star', 'check-circle', 'message-square', 'image',
] as const
export type FormPageIcon = typeof FORM_PAGE_ICONS[number]

export interface FormPage {
  /** Stable id (designer + runtime state); not a field key. */
  id: string
  title: string
  description?: string
  icon?: FormPageIcon
  /** Same rule as a field's: a hidden page's fields are hidden (not required, skipped by validation). */
  visible_when?: VisibleWhen
  /** When to load (lib/forms/lazy-load.ts); absent = 'eager' (on form open). */
  load?: FormPartLoad
  /** Lazy pages: warm their control frames and bound properties once the form is idle. */
  preload?: boolean
  rows: FormRow[]
}

/** Steps / tabs options (all optional; defaults in pageSettings()). */
export interface FormPageSettings {
  /** Steps: the progress indicator (default numbered). */
  indicator?: StepIndicator
  next_label?: string
  back_label?: string
  /** Steps: the stepper lets people jump ahead past steps they have not completed. */
  allow_skip?: boolean
  /** Steps: a read-only summary of the answers before the final buttons. */
  review?: boolean
  review_title?: string
  /** Standalone pages: keep unsent answers (and the step) in this browser to resume later. */
  resume?: boolean
}

export interface FormLayout {
  rows: FormRow[]
  /** Absent / 'single' → one page (the classic grid). */
  mode?: FormPageMode
  /** steps / tabs only; each field is on exactly one page. */
  pages?: FormPage[]
  page_settings?: FormPageSettings
  /** State flags in-form buttons set, and the elements that start hidden. */
  state?: FormStateConfig
  /** Application mode: the bottom button bar (Submit / Cancel / outcomes / Save draft) is not shown. */
  application_mode?: boolean
  /** Form rules: When [event] → If [conditions] → Then [actions] (lib/forms/form-rules.ts). */
  rules?: FormRule[]
  /** Form parameters: inputs from the URL or the embedding context (lib/forms/form-params.ts). */
  params?: FormParam[]
  /** Form variables: named values rules set while the form is open (lib/forms/form-params.ts). */
  variables?: FormVariable[]
  /** Sections rows can belong to (lib/forms/sections.ts). */
  sections?: FormSection[]
  /** Choice groups: one of several sections shows at a time (lib/forms/sections.ts). */
  choice_groups?: FormChoiceGroup[]
  /** The Submitted page shown after a submission (lib/forms/submitted-page.ts); absent = as before. */
  submitted_page?: SubmittedPageConfig
  /** The top-right icons (favourite, save draft) turned off; absent = both on (lib/forms/form-actions.ts). */
  form_actions?: FormActionsConfig
  /** Animation style (lib/forms/motion.ts); absent = Subtle. Only what differs from the default is stored. */
  animation?: FormAnimationConfig
  /** Task forms: the Task completed screen's own wording (lib/tasks/completion-screen.ts); absent = the workspace default. */
  task_completed?: TaskCompletedOverride
  /** AI assistant on this form (lib/assistants): 'on' / 'off' override the workspace's default; absent follows it. */
  assistant?: 'on' | 'off'
  /** Provenance: the InfoPath file / view it was imported from (lib/forms/form-source.ts). */
  source?: FormSourceInfo
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const int = (value: unknown, fallback: number) => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.floor(n) : fallback
}

export function rowUsed(row: FormRow): number {
  return row.cells.reduce((sum, cell) => sum + cell.span, 0)
}

export function rowFree(row: FormRow): number {
  return Math.max(0, row.columns - rowUsed(row))
}

/** Clean one grid of rows (shared by the single-page layout and each page). */
function normalizeRows(rawRows: unknown[], known: Set<string>, placed: Set<string>, budget: { rows: number }): FormRow[] {
  const rows: FormRow[] = []
  for (const rawRow of rawRows) {
    if (budget.rows <= 0) break
    if (!isPlainObject(rawRow)) continue
    const columns = clamp(int(rawRow.columns, 1), 1, MAX_FORM_COLUMNS)
    const section = typeof rawRow.section === 'string' && SECTION_KEY_RE.test(rawRow.section) ? rawRow.section : undefined
    const tag = section ? { section } : {}
    let current: FormRow = { columns, cells: [], ...tag }
    const cells = Array.isArray(rawRow.cells) ? rawRow.cells : []
    for (const rawCell of cells) {
      if (!isPlainObject(rawCell)) continue
      const key = typeof rawCell.field_key === 'string' ? rawCell.field_key : ''
      if (!known.has(key) || placed.has(key)) continue
      placed.add(key)
      const span = clamp(int(rawCell.span, 1), 1, columns)
      if (rowUsed(current) + span > columns) {
        rows.push(current)
        current = { columns, cells: [], ...tag }
      }
      current.cells.push({ field_key: key, span })
    }
    rows.push(current)
    budget.rows -= 1
  }
  return rows
}

const PAGE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/
/** A section key: like a field key (lowercase, digits, underscores). */
export const SECTION_KEY_RE = /^[a-z][a-z0-9_]{0,51}$/
const pageText = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/[<>]/g, '').trim().slice(0, max) : '')

/** Stored page settings → clean settings (unknown values dropped). */
export function normalizePageSettings(raw: unknown): FormPageSettings | undefined {
  if (!isPlainObject(raw)) return undefined
  const out: FormPageSettings = {}
  if (STEP_INDICATORS.includes(raw.indicator as StepIndicator)) out.indicator = raw.indicator as StepIndicator
  const next = pageText(raw.next_label, 40)
  if (next) out.next_label = next
  const back = pageText(raw.back_label, 40)
  if (back) out.back_label = back
  if (raw.allow_skip === true) out.allow_skip = true
  if (raw.review === true) out.review = true
  const review = pageText(raw.review_title, 80)
  if (review) out.review_title = review
  if (raw.resume === true) out.resume = true
  return Object.keys(out).length ? out : undefined
}

/**
 * Clean a stored layout against the field keys: columns 1–4, spans
 * 1..columns, unknown / duplicate keys dropped, a row that overflows wraps
 * its extra cells onto a new row with the same column count. Fields not
 * placed anywhere are appended, one per full-width row, so nothing the
 * assignee must fill in is ever lost (on a paged layout: onto the last
 * page). Returns null when there is no layout.
 *
 * Pages: kept when `mode` is steps / tabs and at least one page is valid
 * (ids made unique, titles defaulted, `visible_when` cleaned — a rule on an
 * unknown field is dropped); otherwise the pages' rows become the single
 * grid, so nothing is lost either way.
 */
export function normalizeFormLayout(raw: unknown, fieldKeys: string[]): FormLayout | null {
  if (!isPlainObject(raw)) return null
  const rawPages = Array.isArray(raw.pages) ? raw.pages.filter(isPlainObject).slice(0, MAX_FORM_PAGES) : []
  if (!Array.isArray(raw.rows) && !rawPages.length) return null
  const known = new Set(fieldKeys)
  const placed = new Set<string>()
  const budget = { rows: MAX_FORM_ROWS }
  const mode: FormPageMode = raw.mode === 'steps' || raw.mode === 'tabs' ? raw.mode : 'single'
  const flagKeys = new Set((normalizeFormStateConfig(raw.state)?.flags ?? []).map((f) => f.key))
  // State + button bar, cleaned against the fields / pages that end up in the layout.
  const declared = normalizeFormSections(raw.sections, known)
  const extras = (pageIds: Set<string>, sectionKeys: Set<string>): Pick<FormLayout, 'state' | 'application_mode' | 'rules' | 'params' | 'variables' | 'assistant' | 'submitted_page' | 'form_actions' | 'animation' | 'task_completed' | 'source'> => {
    const out: Pick<FormLayout, 'state' | 'application_mode' | 'rules' | 'params' | 'variables' | 'assistant' | 'submitted_page' | 'form_actions' | 'animation' | 'task_completed' | 'source'> = {}
    const source = normalizeFormSource(raw.source)
    if (source) out.source = source
    const state = normalizeFormStateConfig(raw.state, { fieldKeys: known, pageIds, sectionKeys })
    if (state) out.state = state
    if (raw.application_mode === true) out.application_mode = true
    const rules = normalizeFormRules(raw.rules)
    if (rules.length) out.rules = rules
    Object.assign(out, contextExtras(raw))
    const submitted = normalizeSubmittedPage(raw.submitted_page, known)
    if (submitted) out.submitted_page = submitted
    const actions = normalizeFormActions(raw.form_actions)
    if (actions) out.form_actions = actions
    const animation = normalizeFormAnimation(raw.animation)
    if (animation) out.animation = animation
    const completed = normalizeTaskCompletedOverride(raw.task_completed)
    if (completed) out.task_completed = completed
    return out
  }
  if (mode !== 'single' && rawPages.length) {
    const ids = new Set<string>()
    const pages: FormPage[] = rawPages.map((rawPage, i) => {
      let id = typeof rawPage.id === 'string' && PAGE_ID_RE.test(rawPage.id) ? rawPage.id : `page_${i + 1}`
      while (ids.has(id)) id = `${id}_${i + 1}`
      ids.add(id)
      const page: FormPage = { id, title: pageText(rawPage.title, 80) || `${mode === 'steps' ? 'Step' : 'Tab'} ${i + 1}`, rows: [] }
      const description = pageText(rawPage.description, 300)
      if (description) page.description = description
      if (FORM_PAGE_ICONS.includes(rawPage.icon as FormPageIcon)) page.icon = rawPage.icon as FormPageIcon
      const rule = normalizeVisibleWhen(rawPage.visible_when)
      const flag = rule ? stateRuleFlag(rule.field) : null
      if (rule && (flag ? flagKeys.has(flag) : known.has(rule.field))) page.visible_when = rule
      Object.assign(page, normalizePartLoad(rawPage))
      page.rows = normalizeRows(Array.isArray(rawPage.rows) ? rawPage.rows : [], known, placed, budget)
      return page
    })
    // Fields on no page (and any old top-level rows) land on the last page.
    const last = pages[pages.length - 1]
    last.rows.push(...normalizeRows(Array.isArray(raw.rows) ? raw.rows : [], known, placed, budget))
    for (const key of fieldKeys) {
      if (!placed.has(key)) last.rows.push({ columns: 1, cells: [{ field_key: key, span: 1 }] })
    }
    const out: FormLayout = { rows: [], mode, pages }
    const settings = normalizePageSettings(raw.page_settings)
    if (settings) out.page_settings = settings
    const sections = tidySections(out, declared)
    const groups = normalizeChoiceGroups(raw.choice_groups, out, sections, known)
    return { ...out, ...extras(new Set(pages.map((p) => p.id)), new Set(sections.map((x) => x.key))), ...(sections.length ? { sections } : {}), ...(groups.length ? { choice_groups: groups } : {}) }
  }
  const flat = Array.isArray(raw.rows) ? raw.rows : []
  const sources = [...flat, ...rawPages.flatMap((page) => (Array.isArray(page.rows) ? page.rows : []))]
  const rows = normalizeRows(sources, known, placed, budget)
  for (const key of fieldKeys) {
    if (!placed.has(key)) rows.push({ columns: 1, cells: [{ field_key: key, span: 1 }] })
  }
  const out: FormLayout = { rows }
  const sections = tidySections(out, declared)
  const groups = normalizeChoiceGroups(raw.choice_groups, out, sections, known)
  return { ...out, ...extras(new Set(), new Set(sections.map((x) => x.key))), ...(sections.length ? { sections } : {}), ...(groups.length ? { choice_groups: groups } : {}) }
}

/** A part's stored `load` / `preload` → clean (eager is the default and not stored; preload only on a lazy part). */
export function normalizePartLoad(raw: Record<string, unknown>): { load?: FormPartLoad; preload?: true } {
  if (raw.load !== 'visible' && raw.load !== 'rule') return {}
  return { load: raw.load, ...(raw.preload === true ? { preload: true as const } : {}) }
}

/** Stored `layout.sections` → clean definitions (keys unique, never a field key; titles defaulted). */
export function normalizeFormSections(raw: unknown, fieldKeys?: ReadonlySet<string>): FormSection[] {
  if (!Array.isArray(raw)) return []
  const out: FormSection[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (out.length >= MAX_FORM_SECTIONS) break
    if (!isPlainObject(entry)) continue
    const key = typeof entry.key === 'string' && SECTION_KEY_RE.test(entry.key) ? entry.key : ''
    if (!key || seen.has(key) || fieldKeys?.has(key)) continue
    seen.add(key)
    const section: FormSection = { key, title: pageText(entry.title, 120) || 'Section' }
    const description = pageText(entry.description, 500)
    if (description) section.description = description
    if (entry.optional === true) section.optional = true
    if (entry.collapsible === true) section.collapsible = true
    if (entry.collapsed === true && entry.collapsible === true) section.collapsed = true
    if (entry.style === 'plain') section.style = 'plain'
    const add = pageText(entry.add_label, 60)
    if (add && section.optional) section.add_label = add
    const rule = normalizeVisibleWhen(entry.visible_when)
    if (rule && (stateRuleFlag(rule.field) || !fieldKeys || fieldKeys.has(rule.field))) section.visible_when = rule
    Object.assign(section, normalizePartLoad(entry))
    out.push(section)
  }
  return out
}

/**
 * Sections against the rows: tags on undeclared sections dropped; a section
 * lives on one page (rows of it on a later page are untagged) and its rows
 * are consecutive (later runs move up to join the first); sections no row
 * uses are dropped. Mutates `layout`'s rows; returns the sections kept.
 */
function tidySections(layout: FormLayout, declared: FormSection[]): FormSection[] {
  const keys = new Set(declared.map((s) => s.key))
  const home = new Map<string, string>()
  const grids = isPaged(layout) ? layout.pages.map((p) => ({ id: p.id, rows: p.rows })) : [{ id: '', rows: layout.rows }]
  for (const grid of grids) {
    for (const row of grid.rows) {
      if (!row.section) continue
      if (!keys.has(row.section) || (home.has(row.section) && home.get(row.section) !== grid.id)) { delete row.section; continue }
      home.set(row.section, grid.id)
    }
    const grouped = groupSectionRows(grid.rows)
    grid.rows.splice(0, grid.rows.length, ...grouped)
  }
  return declared.filter((s) => home.has(s.key))
}

/**
 * Stored `layout.choice_groups` → clean groups: a key like a field key that
 * is no field, section or `<section>_included` key; 2–6 declared sections
 * on one page (later pages' alternatives dropped), each in one group only;
 * `default` one of them; display radio (default, not stored) / tabs /
 * dropdown. A group left with fewer than 2 sections is dropped.
 */
export function normalizeChoiceGroups(raw: unknown, layout: FormLayout, sections: FormSection[], fieldKeys: ReadonlySet<string>): FormChoiceGroup[] {
  if (!Array.isArray(raw) || !sections.length) return []
  const sectionKeys = new Set(sections.map((s) => s.key))
  const home = new Map<string, string>()
  for (const grid of isPaged(layout) ? layout.pages.map((p) => ({ id: p.id, rows: p.rows })) : [{ id: '', rows: layout.rows }]) {
    for (const row of grid.rows) if (row.section && !home.has(row.section)) home.set(row.section, grid.id)
  }
  const used = new Set<string>()
  const keys = new Set<string>()
  const out: FormChoiceGroup[] = []
  for (const entry of raw) {
    if (out.length >= CHOICE_GROUP_LIMITS.groups) break
    if (!isPlainObject(entry)) continue
    const key = typeof entry.key === 'string' && SECTION_KEY_RE.test(entry.key) ? entry.key : ''
    if (!key || keys.has(key) || fieldKeys.has(key) || sectionKeys.has(key) || [...sectionKeys].some((s) => `${s}_included` === key)) continue
    const picked: string[] = []
    for (const s of Array.isArray(entry.sections) ? entry.sections : []) {
      if (typeof s !== 'string' || !sectionKeys.has(s) || used.has(s) || picked.includes(s)) continue
      if (picked.length && home.get(s) !== home.get(picked[0])) continue
      if (picked.length >= CHOICE_GROUP_LIMITS.max) break
      picked.push(s)
    }
    if (picked.length < CHOICE_GROUP_LIMITS.min) continue
    keys.add(key)
    for (const s of picked) used.add(s)
    const group: FormChoiceGroup = { key, label: pageText(entry.label, 120) || 'Choose one', sections: picked }
    if (typeof entry.default === 'string' && picked.includes(entry.default)) group.default = entry.default
    if (entry.display === 'tabs' || entry.display === 'dropdown') group.display = entry.display
    out.push(group)
  }
  return out
}

/** Rows with each section's rows gathered at its first run (stable otherwise). */
export function groupSectionRows(rows: FormRow[]): FormRow[] {
  const out: FormRow[] = []
  const done = new Set<string>()
  for (const row of rows) {
    if (!row.section) { out.push(row); continue }
    if (done.has(row.section)) continue
    done.add(row.section)
    out.push(...rows.filter((r) => r.section === row.section))
  }
  return out
}

/** Whether the layout is organised into steps / tabs. */
export function isPaged(layout: FormLayout | null | undefined): layout is FormLayout & { mode: 'steps' | 'tabs'; pages: FormPage[] } {
  return Boolean(layout && (layout.mode === 'steps' || layout.mode === 'tabs') && layout.pages && layout.pages.length > 0)
}

/** Every row of the layout in reading order (all pages, page by page). */
export function allRows(layout: FormLayout): FormRow[] {
  return isPaged(layout) ? layout.pages.flatMap((page) => page.rows) : layout.rows
}

/** The layout fields have without one: one full-width row per field (the designer's starting grid). */
export function defaultFormLayout(fieldKeys: string[]): FormLayout {
  return { rows: fieldKeys.map((key) => ({ columns: 1, cells: [{ field_key: key, span: 1 }] })) }
}

/** Layout for rendering: rows without cells dropped (a single grid: a page's rows, or a single-page layout); `keepSections`: a section's empty rows stay (an optional section shows its Add button). */
export function renderableRows(layout: FormLayout, keepSections = false): FormRow[] {
  return layout.rows.filter((row) => row.cells.length > 0 || (keepSections && row.section !== undefined))
}

/** Field keys in reading order (row by row, left to right; page by page). */
export function layoutKeyOrder(layout: FormLayout): string[] {
  return allRows(layout).flatMap((row) => row.cells.map((cell) => cell.field_key))
}

/** The page a field sits on (paged layouts), or null. */
export function pageOfField(layout: FormLayout, key: string): FormPage | null {
  if (!isPaged(layout)) return null
  return layout.pages.find((page) => page.rows.some((row) => row.cells.some((cell) => cell.field_key === key))) ?? null
}

/**
 * Where a field sits, or null. On a paged layout the row index is within
 * its page (`page` is the page id).
 */
export function findCell(layout: FormLayout, key: string): { row: number; index: number; page?: string } | null {
  if (isPaged(layout)) {
    for (const page of layout.pages) {
      const at = findCell({ rows: page.rows }, key)
      if (at) return { ...at, page: page.id }
    }
    return null
  }
  for (let r = 0; r < layout.rows.length; r++) {
    const index = layout.rows[r].cells.findIndex((cell) => cell.field_key === key)
    if (index >= 0) return { row: r, index }
  }
  return null
}

/** One page's grid as a single-page layout (the designer edits a page through it). */
export function pageGrid(layout: FormLayout, pageId: string | null | undefined): FormLayout {
  if (!isPaged(layout)) return { rows: layout.rows }
  const page = layout.pages.find((p) => p.id === pageId) ?? layout.pages[0]
  return { rows: page.rows }
}

/** Replace one page's rows with the rows of `grid` (single-page layouts: the rows themselves). */
export function withPageGrid(layout: FormLayout, pageId: string | null | undefined, grid: FormLayout): FormLayout {
  if (!isPaged(layout)) return { ...layout, rows: grid.rows }
  const target = layout.pages.find((p) => p.id === pageId) ?? layout.pages[0]
  return { ...layout, pages: layout.pages.map((page) => (page.id === target.id ? { ...page, rows: grid.rows } : page)) }
}

/** Apply a grid operation to every page (or the single grid). */
function mapGrids(layout: FormLayout, fn: (grid: FormLayout) => FormLayout): FormLayout {
  if (!isPaged(layout)) return { ...layout, rows: fn({ rows: layout.rows }).rows }
  return { ...layout, pages: layout.pages.map((page) => ({ ...page, rows: fn({ rows: page.rows }).rows })) }
}

/** A row's section tag, as props to spread into a new row. */
export function rowTag(row: FormRow | undefined): { section?: string } {
  return row?.section ? { section: row.section } : {}
}

function cloneRows(layout: FormLayout): FormRow[] {
  return layout.rows.map((row) => ({ columns: row.columns, cells: row.cells.map((cell) => ({ ...cell })), ...rowTag(row) }))
}

/** Insert an empty row at `at` (default: the end). */
export function addRow(layout: FormLayout, columns = 1, at?: number, section?: string): FormLayout {
  if (layout.rows.length >= MAX_FORM_ROWS) return layout
  const rows = cloneRows(layout)
  const index = at === undefined ? rows.length : clamp(at, 0, rows.length)
  rows.splice(index, 0, { columns: clamp(columns, 1, MAX_FORM_COLUMNS), cells: [], ...(section ? { section } : {}) })
  return { rows }
}

/**
 * Remove a row. Its fields are returned (they leave the grid; the designer
 * either deletes them or puts them back in the palette's "unplaced" list).
 */
export function removeRow(layout: FormLayout, rowIndex: number): { layout: FormLayout; removedKeys: string[] } {
  const row = layout.rows[rowIndex]
  if (!row) return { layout, removedKeys: [] }
  const rows = cloneRows(layout)
  rows.splice(rowIndex, 1)
  return { layout: { rows }, removedKeys: row.cells.map((cell) => cell.field_key) }
}

/**
 * Move a row one place up / down. At a section's edge the row crosses the
 * edge instead of swapping: it leaves the section (or joins the neighbouring
 * one) and keeps its place. A section's only row leaving it leaves an empty
 * row behind, so the section stays on the grid.
 */
export function moveRow(layout: FormLayout, rowIndex: number, delta: number): FormLayout {
  const target = rowIndex + delta
  const row = layout.rows[rowIndex]
  if (!row) return layout
  const neighbour = layout.rows[target]
  const rows = cloneRows(layout)
  if ((neighbour?.section ?? null) !== (row.section ?? null)) {
    const moved = rows[rowIndex]
    const from = moved.section
    if (neighbour?.section) moved.section = neighbour.section
    else delete moved.section
    if (from && !rows.some((r) => r.section === from)) rows.splice(delta < 0 ? rowIndex + 1 : rowIndex, 0, { columns: 1, cells: [], section: from })
    return { rows }
  }
  if (target < 0 || target >= layout.rows.length) return layout
  const [taken] = rows.splice(rowIndex, 1)
  rows.splice(target, 0, taken)
  return { rows }
}

/** Put a row into a section (null: out of any), keeping each section's rows together. */
export function setRowSection(layout: FormLayout, rowIndex: number, section: string | null): FormLayout {
  if (!layout.rows[rowIndex]) return layout
  const rows = cloneRows(layout)
  const row = rows[rowIndex]
  const from = row.section
  if (from === (section ?? undefined)) return layout
  if (section) row.section = section
  else delete row.section
  if (from) {
    // Leaving a section: the row goes just after it (so the section stays one run); its only row leaves an empty one.
    rows.splice(rowIndex, 1)
    let end = -1
    rows.forEach((r, i) => { if (r.section === from) end = i })
    if (end < 0) { rows.splice(rowIndex, 0, { columns: 1, cells: [], section: from }); end = rowIndex }
    rows.splice(end + 1, 0, row)
  }
  return { rows: groupSectionRows(rows) }
}

/**
 * Change a row's column count. Spans shrink to fit; cells that no longer
 * fit wrap onto a new row inserted right after it (same column count).
 */
export function setRowColumns(layout: FormLayout, rowIndex: number, columns: number): FormLayout {
  const row = layout.rows[rowIndex]
  if (!row) return layout
  const cols = clamp(Math.floor(columns), 1, MAX_FORM_COLUMNS)
  const rows = cloneRows(layout)
  const wrapped: FormRow[] = []
  let current: FormRow = { columns: cols, cells: [], ...rowTag(row) }
  for (const cell of row.cells) {
    const span = Math.min(cell.span, cols)
    if (rowUsed(current) + span > cols) {
      wrapped.push(current)
      current = { columns: cols, cells: [], ...rowTag(row) }
    }
    current.cells.push({ field_key: cell.field_key, span })
  }
  wrapped.push(current)
  rows.splice(rowIndex, 1, ...wrapped)
  return { rows }
}

/** Set a cell's span (clamped to the row's free space plus its own span). */
export function setCellSpan(layout: FormLayout, key: string, span: number): FormLayout {
  if (isPaged(layout)) {
    const page = pageOfField(layout, key)
    return page ? withPageGrid(layout, page.id, setCellSpan({ rows: page.rows }, key, span)) : layout
  }
  const at = findCell(layout, key)
  if (!at) return layout
  const rows = cloneRows(layout)
  const row = rows[at.row]
  const cell = row.cells[at.index]
  const max = row.columns - (rowUsed(row) - cell.span)
  cell.span = clamp(Math.floor(span), 1, Math.max(1, max))
  return { rows }
}

/**
 * Put a field into row `rowIndex` at cell position `index` (removing it from
 * where it was). When the row has no room the field takes a new row inserted
 * right after the target row instead — a drop never silently overflows.
 * `rowIndex === rows.length` appends a new one-column row.
 */
export function placeField(layout: FormLayout, key: string, rowIndex: number, index: number, span = 1): FormLayout {
  const from = findCell(layout, key)
  const rows = cloneRows(layout)
  let keepSpan = span
  if (from) {
    keepSpan = rows[from.row].cells[from.index].span
    rows[from.row].cells.splice(from.index, 1)
  }
  if (rowIndex >= rows.length) {
    rows.push({ columns: 1, cells: [{ field_key: key, span: 1 }] })
    return { rows }
  }
  const target = rows[Math.max(0, rowIndex)]
  const fitSpan = Math.min(Math.max(1, keepSpan), target.columns)
  if (rowUsed(target) + fitSpan <= target.columns) {
    target.cells.splice(clamp(index, 0, target.cells.length), 0, { field_key: key, span: fitSpan })
  } else if (rowUsed(target) + 1 <= target.columns) {
    target.cells.splice(clamp(index, 0, target.cells.length), 0, { field_key: key, span: 1 })
  } else {
    rows.splice(Math.max(0, rowIndex) + 1, 0, { columns: target.columns, cells: [{ field_key: key, span: fitSpan }], ...rowTag(target) })
  }
  return { rows }
}

/** Put a field at the end of a section (an empty row of it, else a new full-width row), removing it from where it was. */
export function placeFieldInSection(layout: FormLayout, key: string, section: string): FormLayout {
  const rows = cloneRows(layout)
  const from = findCell(layout, key)
  if (from) rows[from.row].cells.splice(from.index, 1)
  const empty = rows.findIndex((r) => r.section === section && r.cells.length === 0)
  if (empty >= 0) { rows[empty].cells.push({ field_key: key, span: 1 }); return { rows } }
  let end = -1
  rows.forEach((r, i) => { if (r.section === section) end = i })
  rows.splice(end < 0 ? rows.length : end + 1, 0, { columns: 1, cells: [{ field_key: key, span: 1 }], section })
  return { rows }
}

/** Keyboard move: one cell left/right within the row, or to the previous/next row. */
export function nudgeField(layout: FormLayout, key: string, direction: 'left' | 'right' | 'up' | 'down'): FormLayout {
  const at = findCell(layout, key)
  if (!at) return layout
  const row = layout.rows[at.row]
  if (direction === 'left' || direction === 'right') {
    const target = at.index + (direction === 'left' ? -1 : 1)
    if (target < 0 || target >= row.cells.length) return layout
    const rows = cloneRows(layout)
    const cells = rows[at.row].cells
    ;[cells[at.index], cells[target]] = [cells[target], cells[at.index]]
    return { rows }
  }
  const targetRow = at.row + (direction === 'up' ? -1 : 1)
  if (targetRow < 0) return layout
  if (targetRow >= layout.rows.length) {
    if (row.cells.length === 1) return layout
    return placeField(layout, key, layout.rows.length, 0)
  }
  const index = direction === 'up' ? layout.rows[targetRow].cells.length : 0
  return placeField(layout, key, targetRow, index)
}

/** Remove a field from the grid (its row stays, possibly empty). A page rule on it and start-hidden targets on it are dropped. */
export function removeFieldFromLayout(layout: FormLayout, key: string): FormLayout {
  const out = mapGrids(layout, (grid) => ({ rows: grid.rows.map((row) => ({ columns: row.columns, cells: row.cells.filter((cell) => cell.field_key !== key).map((cell) => ({ ...cell })), ...rowTag(row) })) }))
  if (out.sections) out.sections = out.sections.map((section) => (section.visible_when?.field === key ? withoutRule(section) : section))
  if (out.pages) out.pages = out.pages.map((page) => (page.visible_when?.field === key ? withoutRule(page) : page))
  return mapStateTargets(out, (target) => (fieldTargetKey(target) === key ? null : target))
}

function fieldTargetKey(target: string): string | null {
  const t = parseTarget(target)
  return t && t.kind !== 'page' ? t.id : null
}

/** Rewrite (null: drop) the start-hidden targets. */
export function mapStateTargets(layout: FormLayout, fn: (target: string) => string | null): FormLayout {
  if (!layout.state?.hidden?.length) return layout
  const hidden = layout.state.hidden.map(fn).filter((t): t is string => Boolean(t))
  const state: FormStateConfig = { ...layout.state }
  if (hidden.length) state.hidden = [...new Set(hidden)]
  else delete state.hidden
  const out: FormLayout = { ...layout }
  if (Object.keys(state).length) out.state = state
  else delete out.state
  return out
}

function withoutRule<T extends { visible_when?: VisibleWhen }>(page: T): T {
  const rest = { ...page }
  delete rest.visible_when
  return rest
}

/** Rename a key everywhere in the layout (cells and page rules). */
export function renameLayoutKey(layout: FormLayout, from: string, to: string): FormLayout {
  const out = mapGrids(layout, (grid) => ({ rows: grid.rows.map((row) => ({ columns: row.columns, cells: row.cells.map((cell) => (cell.field_key === from ? { ...cell, field_key: to } : { ...cell })), ...rowTag(row) })) }))
  if (out.pages) out.pages = out.pages.map((page) => (page.visible_when?.field === from ? { ...page, visible_when: { ...page.visible_when, field: to } } : page))
  if (out.sections) out.sections = out.sections.map((section) => (section.visible_when?.field === from ? { ...section, visible_when: { ...section.visible_when, field: to } } : section))
  const renamed = mapStateTargets(out, (target) => (fieldTargetKey(target) === from ? target.replace(/:.*$/, `:${to}`) : target))
  // The Submitted page's summary follows the field.
  if (renamed.submitted_page?.summary_fields?.includes(from)) {
    renamed.submitted_page = { ...renamed.submitted_page, summary_fields: renamed.submitted_page.summary_fields.map((k) => (k === from ? to : k)) }
  }
  return renamed.rules?.length ? { ...renamed, rules: renamed.rules.map((r) => renameRuleKey(r, from, to)) } : renamed
}

/** Rows without cells dropped — except a section's first row when the section has no fields (an empty section stays on the grid). */
const compactRows = (rows: FormRow[]) => rows
  .filter((row, i) => row.cells.length > 0 || (row.section !== undefined && !rows.some((r, j) => r.section === row.section && (r.cells.length > 0 || j < i))))
  .map((row) => ({ columns: row.columns, cells: row.cells.map((cell) => ({ field_key: cell.field_key, span: cell.span })), ...rowTag(row) }))

/**
 * Compact stored form: rows without cells dropped; null when it is just one
 * full-width row per field in field order. A paged layout is always kept
 * (pages with their rows, empty pages included).
 */
export function compactLayoutForSave(layout: FormLayout, fieldKeys: string[]): FormLayout | null {
  if (isPaged(layout)) {
    const out: FormLayout = {
      rows: [],
      mode: layout.mode,
      pages: layout.pages.map((page) => {
        const stored: FormPage = { id: page.id, title: page.title, rows: compactRows(page.rows) }
        if (page.description) stored.description = page.description
        if (page.icon) stored.icon = page.icon
        if (page.visible_when) stored.visible_when = { ...page.visible_when }
        Object.assign(stored, normalizePartLoad(page as unknown as Record<string, unknown>))
        return stored
      }),
    }
    const settings = normalizePageSettings(layout.page_settings)
    if (settings) out.page_settings = settings
    return withExtras(out, layout)
  }
  const rows = compactRows(layout.rows)
  const trivial = rows.length === fieldKeys.length && rows.every((row, i) => row.columns === 1 && row.cells.length === 1 && row.cells[0].field_key === fieldKeys[i])
  return trivial && !layout.source && !layout.state && !layout.application_mode && !layout.rules?.length && !layout.params?.length && !layout.variables?.length && !layout.sections?.length && !layout.submitted_page && !normalizeFormActions(layout.form_actions) && !normalizeFormAnimation(layout.animation) && !normalizeTaskCompletedOverride(layout.task_completed) && !(layout.assistant === 'on' || layout.assistant === 'off') ? null : withExtras({ rows }, layout)
}

function withExtras(out: FormLayout, layout: FormLayout): FormLayout {
  const state = normalizeFormStateConfig(layout.state)
  if (state) out.state = state
  if (layout.application_mode === true) out.application_mode = true
  const rules = normalizeFormRules(layout.rules)
  if (rules.length) out.rules = rules
  Object.assign(out, contextExtras(layout))
  const submitted = normalizeSubmittedPage(layout.submitted_page)
  if (submitted) out.submitted_page = submitted
  const actions = normalizeFormActions(layout.form_actions)
  if (actions) out.form_actions = actions
  const animation = normalizeFormAnimation(layout.animation)
  if (animation) out.animation = animation
  const completed = normalizeTaskCompletedOverride(layout.task_completed)
  if (completed) out.task_completed = completed
  const source = normalizeFormSource(layout.source)
  if (source) out.source = source
  const used = new Set(allRows(out).map((r) => r.section).filter(Boolean))
  const sections = normalizeFormSections(layout.sections).filter((s) => used.has(s.key))
  if (sections.length) out.sections = sections
  // Choice groups ride along with their sections (they were dropped on save before).
  const groups = sections.length ? normalizeChoiceGroups(layout.choice_groups, out, sections, new Set(allRows(out).flatMap((r) => r.cells.map((c) => c.field_key)))) : []
  if (groups.length) out.choice_groups = groups
  return out
}

/** Parameters and variables (kept beside the grid; lib/forms/form-params.ts). */
export function contextExtras(layout: { params?: unknown; variables?: unknown; assistant?: unknown }): Pick<FormLayout, 'params' | 'variables' | 'assistant'> {
  const out: Pick<FormLayout, 'params' | 'variables' | 'assistant'> = {}
  // The form's AI assistant setting (kept here so both normalisers carry it).
  if (layout.assistant === 'on' || layout.assistant === 'off') out.assistant = layout.assistant
  const params = normalizeFormParams(layout.params)
  if (params.length) out.params = params
  const variables = normalizeFormVariables(layout.variables, params.map((p) => p.name))
  if (variables.length) out.variables = variables
  return out
}
