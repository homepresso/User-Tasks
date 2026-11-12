/**
 * Form state: what in-form buttons (lib/forms/field-buttons.ts) change
 * besides values, and the button bar setting. Stored on the layout
 * (lib/forms/layout.ts — it travels wherever the grid goes: node config,
 * task metadata `form_layout`, reusable forms, versions, exports, packages):
 *
 *   layout.state       = { flags: [{ key, label?, default? }], hidden: [target] }
 *   layout.application_mode = true   (the bottom button bar is not shown)
 *
 * State flags are named yes/no switches (`show_details`). A `visible_when`
 * rule on a field or a page can read one as `state.<flag>` (equals true /
 * false), so "Show more details" toggles and wizard branches are declared,
 * not scripted. A button's "Show / hide" action hides or shows elements
 * directly — a field, a section (a declared section, layout.sections — or,
 * for older forms, a heading and the rows under it up to the next heading or
 * divider), the row a field sits on, or a whole step / tab —
 * written as targets `field:<key>`, `section:<heading key>`, `row:<key>`,
 * `page:<id>`. `layout.state.hidden` lists the targets that start hidden.
 *
 * Precedence: an element shows only when (1) no button has hidden it
 * (target hidden wins over every rule), (2) its own `visible_when` holds
 * (state flags included) and (3) its page shows (the page's rule holds and
 * no button hid the page). "Show" only undoes a button hide: it never shows
 * an element whose rule says hide. Hidden elements are not required and are
 * skipped by validation — on the client and on the server alike.
 *
 * Transport: the state rides with the values under the reserved key
 * `__form_state` = { flags: { [flag]: boolean }, hidden: [target] } (never
 * stored as a value). The server never trusts it as sent: sanitizeFormState
 * keeps only declared flags and declared targets, and only the values a
 * button on the form can produce (a flag no button sets stays at its
 * default; a target no button hides stays shown; a start-hidden target no
 * button shows stays hidden). Missing state = the declared defaults. So a
 * client can only hide what a person could hide by clicking the form's own
 * buttons — never a required field the form always shows. Read-only
 * targets (`read_only`, set by the "Make read only / editable" rule action;
 * FORM_WHOLE_TARGET = `form:*` is the whole form) are bounded the same way:
 * a claim counts only when an event rule could make that target read only.
 *
 * Application mode: the form's bottom button bar (Submit / Cancel /
 * outcomes / Save draft) is not shown on any page — an application form
 * that is read, printed or embedded, or one driven by in-form buttons (a
 * Button with a Submit action presses the bar's button, so its behaviours
 * still run). With no submitting in-form button the form is an information
 * page: nothing validates or submits it (isInformationPage). A TASK form
 * like that is still completed from the task's own outcome buttons; the
 * designer and the accessibility checker say so (submitPathProblem).
 *
 * Pure and isomorphic; reads stored layouts as they are (no circular import
 * of the field schema — fields are read structurally).
 */

import { isPlainObject } from '@/lib/utils/guards'

export const FORM_STATE_KEY = '__form_state'
export const STATE_RULE_PREFIX = 'state.'
export const FORM_STATE_LIMITS = { flags: 30, hidden: 100, label: 80, pages: 20 } as const

export interface FormStateFlag {
  key: string
  label?: string
  /** Starts on (default off). */
  default?: boolean
}

export interface FormStateConfig {
  flags?: FormStateFlag[]
  /** Targets hidden until a button shows them. */
  hidden?: string[]
}

/** Runtime state (values[FORM_STATE_KEY]). */
export interface FormUiState {
  flags: Record<string, boolean>
  hidden: string[]
  /** Targets a form rule disabled (presentation only: the server never trusts or needs it). */
  disabled?: string[]
  /**
   * Targets a form rule made read only (`field:` / `section:` / `row:` /
   * `page:` targets, or FORM_WHOLE_TARGET). The control shows its value and
   * keeps submitting it, but the person cannot change it; a read-only field
   * is not required. The server bounds a submitted claim like `hidden`
   * (sanitizeFormState: only targets an event rule could make read only).
   */
  read_only?: string[]
  /** Sections collapsed (`section:<key>`; presentation only — a collapsed section's fields are still required). */
  collapsed?: string[]
  /**
   * Lazy parts that have loaded (`section:<key>` / `page:<id>`; lib/forms/lazy-load.ts).
   * Presentation only, like `collapsed`: values never depend on it and the server ignores it.
   */
  loaded?: string[]
}

/**
 * `column:<list>.<column>`: a whole List column (its header and every cell)
 * or, for a repeating section, one inner control in every item
 * (`column:<section>.<inner key>`). Only show / hide takes it; it names no
 * form field, so targetFieldKeys gives nothing for it (ruleHiddenColumns
 * in lib/forms/form-rules.ts reads it).
 */
export type FormTargetKind = 'field' | 'section' | 'row' | 'page' | 'column'
export const FORM_TARGET_KINDS: FormTargetKind[] = ['field', 'section', 'row', 'page', 'column']
export const FORM_TARGET_LABELS: Record<FormTargetKind, string> = { field: 'Field', section: 'Section', row: 'Row', page: 'Step / tab', column: 'List column' }

const TARGET_RE = /^(field|section|row|page):([A-Za-z0-9_-]{1,64})$|^(column):([A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{1,64})$/

/** A column target's List (or repeating section) and column (or inner control), or null. */
export function parseColumnTarget(raw: unknown): { field: string; column: string } | null {
  const t = parseTarget(raw)
  if (!t || t.kind !== 'column') return null
  const [field, column] = t.id.split('.')
  return { field, column }
}

export function columnTarget(field: string, column: string): string {
  return `column:${field}.${column}`
}

/**
 * The whole form as a target (`form:*`) — only the "Make read only /
 * editable" rule action takes it. Deliberately not a FormTargetKind:
 * parseTarget does not read it, so show / hide, enable / disable, start
 * hidden and the rename helper never see it (it names no key).
 */
export const FORM_WHOLE_TARGET = 'form:*'

/** A target the read-only action takes: any parseTarget target or the whole form. */
export function isReadOnlyTarget(raw: unknown): raw is string {
  return raw === FORM_WHOLE_TARGET || Boolean(parseTarget(raw))
}
const FLAG_RE = /^[a-z][a-z0-9_]{0,39}$/

/** A flag name from any text ("Show details" → show_details), or ''. */
export function flagKey(raw: unknown): string {
  const s = String(raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[_0-9]+|_+$/g, '').slice(0, 40)
  return FLAG_RE.test(s) ? s : ''
}

/** `state.<flag>` → the flag, else null. */
export function stateRuleFlag(field: string | null | undefined): string | null {
  if (!field || !field.startsWith(STATE_RULE_PREFIX)) return null
  return flagKey(field.slice(STATE_RULE_PREFIX.length)) || null
}

/** Clean a rule's subject when it names a state flag (`state.Show Details` → `state.show_details`), else null. */
export function normalizeStateRuleField(raw: string): string | null {
  if (!/^state\./i.test(raw.trim())) return null
  const flag = flagKey(raw.trim().slice(STATE_RULE_PREFIX.length))
  return flag ? `${STATE_RULE_PREFIX}${flag}` : null
}

export function parseTarget(raw: unknown): { kind: FormTargetKind; id: string } | null {
  const m = typeof raw === 'string' ? TARGET_RE.exec(raw) : null
  if (!m) return null
  return m[1] ? { kind: m[1] as FormTargetKind, id: m[2] } : { kind: 'column', id: m[4] }
}

export function formTarget(kind: FormTargetKind, id: string): string {
  return `${kind}:${id}`
}

/* ── Stored config ──────────────────────────────────────────────────── */

/** Stored `layout.state` → clean config, or undefined when empty. `known` drops targets to fields / pages the form lacks. */
export function normalizeFormStateConfig(raw: unknown, known?: { fieldKeys?: ReadonlySet<string>; pageIds?: ReadonlySet<string>; sectionKeys?: ReadonlySet<string> }): FormStateConfig | undefined {
  if (!isPlainObject(raw)) return undefined
  const out: FormStateConfig = {}
  if (Array.isArray(raw.flags)) {
    const seen = new Set<string>()
    const flags: FormStateFlag[] = []
    for (const entry of raw.flags) {
      if (flags.length >= FORM_STATE_LIMITS.flags) break
      const key = isPlainObject(entry) ? flagKey(entry.key) : flagKey(entry)
      if (!key || seen.has(key)) continue
      seen.add(key)
      const flag: FormStateFlag = { key }
      if (isPlainObject(entry)) {
        const label = typeof entry.label === 'string' ? entry.label.replace(/[<>]/g, '').trim().slice(0, FORM_STATE_LIMITS.label) : ''
        if (label) flag.label = label
        if (entry.default === true) flag.default = true
      }
      flags.push(flag)
    }
    if (flags.length) out.flags = flags
  }
  if (Array.isArray(raw.hidden)) {
    const hidden = [...new Set(raw.hidden.filter((t): t is string => Boolean(parseTarget(t))))]
      .filter((t) => targetKnown(t, known))
      .slice(0, FORM_STATE_LIMITS.hidden)
    if (hidden.length) out.hidden = hidden
  }
  return Object.keys(out).length ? out : undefined
}

function targetKnown(target: string, known?: { fieldKeys?: ReadonlySet<string>; pageIds?: ReadonlySet<string>; sectionKeys?: ReadonlySet<string> }): boolean {
  const t = parseTarget(target)
  if (!t) return false
  if (!known) return true
  if (t.kind === 'page') return !known.pageIds || known.pageIds.has(t.id)
  if (t.kind === 'section' && known.sectionKeys?.has(t.id)) return true
  if (t.kind === 'column') return !known.fieldKeys || known.fieldKeys.has(t.id.split('.')[0])
  return !known.fieldKeys || known.fieldKeys.has(t.id)
}

/* ── Reading a layout structurally ─────────────────────────────────── */

interface RowLike { cells: Array<{ field_key: string }>; section?: string }
interface PageLike { id: string; rows: RowLike[] }

function layoutObj(layout: unknown): Record<string, unknown> | null {
  return isPlainObject(layout) ? layout : null
}

/** Pages of a paged layout (each with its rows); a single grid → one pseudo page with id ''. */
function gridsOf(layout: unknown): PageLike[] {
  const l = layoutObj(layout)
  if (!l) return []
  const readRows = (raw: unknown): RowLike[] => (Array.isArray(raw) ? raw : []).filter(isPlainObject).map((row) => ({
    cells: (Array.isArray(row.cells) ? row.cells : []).filter(isPlainObject).filter((c) => typeof c.field_key === 'string').map((c) => ({ field_key: String(c.field_key) })),
    ...(typeof row.section === 'string' ? { section: row.section } : {}),
  }))
  if ((l.mode === 'steps' || l.mode === 'tabs') && Array.isArray(l.pages) && l.pages.length) {
    return l.pages.filter(isPlainObject).map((p) => ({ id: typeof p.id === 'string' ? p.id : '', rows: readRows(p.rows) }))
  }
  return [{ id: '', rows: readRows(l.rows) }]
}

function isPagedLayout(layout: unknown): boolean {
  const l = layoutObj(layout)
  return Boolean(l && (l.mode === 'steps' || l.mode === 'tabs') && Array.isArray(l.pages) && l.pages.length)
}

/** The state config of a (stored or normalized) layout. */
export function formStateConfig(layout: unknown): FormStateConfig {
  const l = layoutObj(layout)
  return normalizeFormStateConfig(l?.state) ?? {}
}

/** Application mode: the bottom button bar is not shown (stored `layout.application_mode: true`). */
export function isApplicationMode(layout: unknown): boolean {
  return layoutObj(layout)?.application_mode === true
}

/** Declared section keys (layout.sections; lib/forms/sections.ts). */
export function declaredSectionKeys(layout: unknown): Set<string> {
  const l = layoutObj(layout)
  const raw = l && Array.isArray(l.sections) ? l.sections : []
  return new Set(raw.filter(isPlainObject).map((s) => s.key).filter((k): k is string => typeof k === 'string'))
}

/** Field keys in a declared section's rows (every page). */
export function sectionRowFieldKeys(layout: unknown, key: string): string[] {
  return gridsOf(layout).flatMap((page) => page.rows.filter((r) => r.section === key).flatMap((r) => r.cells.map((c) => c.field_key)))
}

/** Keys that end a (legacy, heading-made) section: headings and dividers. */
export function sectionBoundaryKeys(fields: Array<{ key: string; type: string }>): Set<string> {
  return new Set(fields.filter((f) => f.type === 'heading' || f.type === 'divider').map((f) => f.key))
}

/** Field keys a target covers. `headingKeys`: section boundaries (a section runs to the next heading or divider on its page). */
export function targetFieldKeys(layout: unknown, target: string, headingKeys?: ReadonlySet<string>): string[] {
  const t = parseTarget(target)
  if (!t) return []
  const grids = gridsOf(layout)
  if (t.kind === 'field') return [t.id]
  // A List column / a repeating section's inner control in every item: no form field of its own.
  if (t.kind === 'column') return []
  // A declared section (layout.sections) wins; otherwise `section:<heading>` is the legacy heading-made section.
  if (t.kind === 'section' && declaredSectionKeys(layout).has(t.id)) return sectionRowFieldKeys(layout, t.id)
  if (t.kind === 'page') {
    if (!isPagedLayout(layout)) return []
    const page = grids.find((p) => p.id === t.id)
    return page ? page.rows.flatMap((r) => r.cells.map((c) => c.field_key)) : []
  }
  for (const page of grids) {
    const at = page.rows.findIndex((r) => r.cells.some((c) => c.field_key === t.id))
    if (at < 0) continue
    if (t.kind === 'row') return page.rows[at].cells.map((c) => c.field_key)
    // section: the heading's row and the rows under it, up to the next row with a heading or divider.
    const keys: string[] = page.rows[at].cells.map((c) => c.field_key)
    for (let i = at + 1; i < page.rows.length; i++) {
      if (page.rows[i].cells.some((c) => headingKeys?.has(c.field_key))) break
      keys.push(...page.rows[i].cells.map((c) => c.field_key))
    }
    return keys
  }
  return []
}

/* ── Runtime state ──────────────────────────────────────────────────── */

/** The state a form opens with: each flag at its default, the start-hidden targets hidden. */
export function initialFormState(layout: unknown): FormUiState {
  const config = formStateConfig(layout)
  const l = layoutObj(layout)
  const collapsed = (l && Array.isArray(l.sections) ? l.sections : []).filter(isPlainObject)
    .filter((s) => s.collapsible === true && s.collapsed === true && typeof s.key === 'string').map((s) => `section:${String(s.key)}`)
  return {
    flags: Object.fromEntries((config.flags ?? []).map((f) => [f.key, f.default === true])),
    hidden: [...(config.hidden ?? [])],
    ...(collapsed.length ? { collapsed } : {}),
  }
}

/** The raw state sent with the values, if any. */
function rawState(values: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const raw = values?.[FORM_STATE_KEY]
  return isPlainObject(raw) ? raw : null
}

/**
 * The state the browser works with (lenient: whatever the form's own
 * buttons set; missing → defaults). Declared flags only.
 */
export function readFormState(layout: unknown, values: Record<string, unknown> | null | undefined): FormUiState {
  const initial = initialFormState(layout)
  const raw = rawState(values)
  if (!raw) return initial
  const flags = { ...initial.flags }
  if (isPlainObject(raw.flags)) for (const key of Object.keys(flags)) if (typeof raw.flags[key] === 'boolean') flags[key] = raw.flags[key] as boolean
  const hidden = Array.isArray(raw.hidden) ? raw.hidden.filter((t): t is string => Boolean(parseTarget(t))).slice(0, FORM_STATE_LIMITS.hidden * 2) : initial.hidden
  const disabled = Array.isArray(raw.disabled) ? raw.disabled.filter((t): t is string => Boolean(parseTarget(t))).slice(0, FORM_STATE_LIMITS.hidden * 2) : []
  const readOnly = Array.isArray(raw.read_only) ? [...new Set(raw.read_only.filter(isReadOnlyTarget))].slice(0, FORM_STATE_LIMITS.hidden * 2) : []
  const collapsed = Array.isArray(raw.collapsed) ? raw.collapsed.filter((t): t is string => parseTarget(t)?.kind === 'section').slice(0, FORM_STATE_LIMITS.hidden) : (initial.collapsed ?? [])
  const loaded = Array.isArray(raw.loaded) ? raw.loaded.filter((t): t is string => { const k = parseTarget(t)?.kind; return k === 'section' || k === 'page' }).slice(0, FORM_STATE_LIMITS.hidden) : []
  return { flags, hidden, ...(disabled.length ? { disabled } : {}), ...(readOnly.length ? { read_only: readOnly } : {}), ...(collapsed.length ? { collapsed } : {}), ...(loaded.length ? { loaded } : {}) }
}

/** Values with a complete state under FORM_STATE_KEY (the evaluation scope of rules). */
export function withFormState(layout: unknown, values: Record<string, unknown> | null | undefined, state?: FormUiState): Record<string, unknown> {
  return { ...(values ?? {}), [FORM_STATE_KEY]: state ?? readFormState(layout, values) }
}

/** Values without the state (what is stored / handed to a workflow). */
export function stripFormState<T extends Record<string, unknown>>(values: T): T {
  if (!values || !Object.prototype.hasOwnProperty.call(values, FORM_STATE_KEY)) return values
  const out = { ...values }
  delete out[FORM_STATE_KEY]
  return out
}

interface ActionLike { type: string; flag?: string; state_value?: unknown; mode?: string; targets?: unknown; prompt?: { buttons?: Array<{ then?: ActionLike[] }> } }

/** The actions plus a question's responses' actions (one level: what an answer can do counts too). */
function withBranches(actions: ActionLike[]): ActionLike[] {
  const out: ActionLike[] = []
  for (const a of actions) {
    out.push(a)
    if (a.type === 'prompt' && Array.isArray(a.prompt?.buttons)) for (const b of a.prompt.buttons) if (Array.isArray(b?.then)) out.push(...b.then.filter((x): x is ActionLike => isPlainObject(x)))
  }
  return out
}
interface FieldLike { key: string; type: string; button?: { actions?: ActionLike[] } | null }

export interface StateReach {
  /** flag → the values buttons (and event rules) can set it to. */
  flags: Map<string, Set<boolean>>
  /** Targets a button (or an event rule) can hide / show. */
  hideable: Set<string>
  showable: Set<string>
  /** Targets an event rule can make read only. */
  readOnlyable: Set<string>
}

/**
 * Event-driven form rules (layout.rules, lib/forms/form-rules.ts) read
 * structurally: their show / hide and flag actions widen what a submitted
 * state may claim, exactly like a Button's — and `ruleGate` (when given)
 * narrows each claim to rules whose condition can hold for the submitted
 * values (see sanitizeFormState).
 */
interface RuleLike { id?: string; disabled?: boolean; event?: string; then?: ActionLike[] }

function layoutRules(layout: unknown): RuleLike[] {
  const l = layoutObj(layout)
  const raw = l && Array.isArray(l.rules) ? l.rules : []
  return raw.filter(isPlainObject).map((r) => r as RuleLike).filter((r) => r.disabled !== true && r.event !== 'always' && Array.isArray(r.then))
}

/** What the form's buttons (and event rules) can change (the bound for a submitted state). */
export function stateReach(fields: FieldLike[], layout?: unknown, ruleGate?: (rule: RuleLike) => boolean): StateReach {
  const reach: StateReach = { flags: new Map(), hideable: new Set(), showable: new Set(), readOnlyable: new Set() }
  const sources: ActionLike[][] = fields.filter((f) => f.type === 'button').map((f) => f.button?.actions ?? [])
  for (const rule of layoutRules(layout)) if (!ruleGate || ruleGate(rule)) sources.push(rule.then ?? [])
  for (const actions of sources) {
    for (const action of withBranches(actions)) {
      if (action.type === 'set_state' && typeof action.flag === 'string') {
        const set = reach.flags.get(action.flag) ?? new Set<boolean>()
        if (action.state_value === 'toggle') { set.add(true); set.add(false) } else set.add(action.state_value === 'true' || action.state_value === true)
        reach.flags.set(action.flag, set)
      }
      if (action.type === 'show_hide' && Array.isArray(action.targets)) {
        for (const target of action.targets) {
          if (typeof target !== 'string') continue
          if (action.mode !== 'show') reach.hideable.add(target)
          if (action.mode !== 'hide') reach.showable.add(target)
        }
      }
      if (action.type === 'read_only' && action.mode !== 'editable' && Array.isArray(action.targets)) {
        for (const target of action.targets) if (isReadOnlyTarget(target)) reach.readOnlyable.add(target)
      }
    }
  }
  return reach
}

/**
 * The state the SERVER (and the client's own pre-check) judges with: only
 * declared flags and targets, only values the form's buttons can produce,
 * the defaults for anything missing. See the module comment.
 */
export function sanitizeFormState(fields: FieldLike[], layout: unknown, values: Record<string, unknown> | null | undefined, ruleGate?: (rule: RuleLike) => boolean): FormUiState {
  const config = formStateConfig(layout)
  const raw = rawState(values)
  const reach = stateReach(fields, layout, ruleGate)
  const flags: Record<string, boolean> = {}
  for (const flag of config.flags ?? []) {
    const initial = flag.default === true
    const sent = raw && isPlainObject(raw.flags) ? raw.flags[flag.key] : undefined
    const possible = reach.flags.get(flag.key)
    flags[flag.key] = typeof sent === 'boolean' && (sent === initial || possible?.has(sent)) ? sent : initial
  }
  const startHidden = new Set(config.hidden ?? [])
  const claimed = new Set(raw && Array.isArray(raw.hidden) ? raw.hidden.filter((t): t is string => typeof t === 'string') : [...startHidden])
  const hidden: string[] = []
  for (const target of new Set([...startHidden, ...reach.hideable])) {
    if (!parseTarget(target)) continue
    const isHidden = startHidden.has(target)
      ? (reach.showable.has(target) ? claimed.has(target) : true)
      : (reach.hideable.has(target) ? claimed.has(target) : false)
    if (isHidden) hidden.push(target)
  }
  // Read only (a rule-only action; nothing starts read only in the state): a claim counts only when an event rule could make it.
  const readOnly = raw && Array.isArray(raw.read_only) ? [...new Set(raw.read_only.filter((t): t is string => typeof t === 'string' && reach.readOnlyable.has(t)))] : []
  return { flags, hidden, ...(readOnly.length ? { read_only: readOnly } : {}) }
}

/** Page ids a button hid (paged layouts). */
export function hiddenPageIds(layout: unknown, values: Record<string, unknown> | null | undefined): Set<string> {
  const out = new Set<string>()
  if (!isPagedLayout(layout)) return out
  for (const target of readFormState(layout, values).hidden) {
    const t = parseTarget(target)
    if (t?.kind === 'page') out.add(t.id)
  }
  return out
}

/**
 * Field keys hidden by the state's targets (fields, sections, rows and the
 * fields of hidden pages). `fields` gives the section headings.
 */
export function stateHiddenFieldKeys(layout: unknown, fields: Array<{ key: string; type: string }>, values: Record<string, unknown> | null | undefined): Set<string> {
  const out = new Set<string>()
  const state = readFormState(layout, values)
  if (!state.hidden.length) return out
  const boundaries = sectionBoundaryKeys(fields)
  for (const target of state.hidden) for (const key of targetFieldKeys(layout, target, boundaries)) out.add(key)
  return out
}

/** Is a target currently shown (aria-expanded of a toggle)? */
export function isTargetShown(state: FormUiState, target: string): boolean {
  return !state.hidden.includes(target)
}

/** Apply an enable / disable / toggle to targets (form rules). */
export function applyEnabled(state: FormUiState, mode: 'enable' | 'disable' | 'toggle', targets: string[]): FormUiState {
  const disabled = new Set(state.disabled ?? [])
  for (const target of targets) {
    if (!parseTarget(target)) continue
    const off = mode === 'disable' || (mode === 'toggle' && !disabled.has(target))
    if (off) disabled.add(target)
    else disabled.delete(target)
  }
  return { ...state, disabled: [...disabled] }
}

/** Make targets read only / editable / toggle (form rules). */
export function applyReadOnly(state: FormUiState, mode: 'read_only' | 'editable' | 'toggle', targets: string[]): FormUiState {
  const readOnly = new Set(state.read_only ?? [])
  for (const target of targets) {
    if (!isReadOnlyTarget(target)) continue
    const on = mode === 'read_only' || (mode === 'toggle' && !readOnly.has(target))
    if (on) readOnly.add(target)
    else readOnly.delete(target)
  }
  return { ...state, read_only: [...readOnly] }
}

/** Apply a show / hide / toggle to targets. */
export function applyVisibility(state: FormUiState, mode: 'show' | 'hide' | 'toggle', targets: string[]): FormUiState {
  const hidden = new Set(state.hidden)
  for (const target of targets) {
    if (!parseTarget(target)) continue
    const hide = mode === 'hide' || (mode === 'toggle' && !hidden.has(target))
    if (hide) hidden.add(target)
    else hidden.delete(target)
  }
  return { ...state, hidden: [...hidden] }
}

/** Collapse / expand / toggle sections (presentation only). */
export function applyCollapsed(state: FormUiState, mode: 'collapse' | 'expand' | 'toggle', targets: string[]): FormUiState {
  const collapsed = new Set(state.collapsed ?? [])
  for (const target of targets) {
    if (parseTarget(target)?.kind !== 'section') continue
    const off = mode === 'collapse' || (mode === 'toggle' && !collapsed.has(target))
    if (off) collapsed.add(target)
    else collapsed.delete(target)
  }
  return { ...state, collapsed: [...collapsed] }
}

/** Mark lazy parts loaded (`section:<key>` / `page:<id>`; loading is one-way — a loaded part stays loaded). */
export function applyLoaded(state: FormUiState, targets: string[]): FormUiState {
  const loaded = new Set(state.loaded ?? [])
  const before = loaded.size
  for (const target of targets) {
    const kind = parseTarget(target)?.kind
    if (kind === 'section' || kind === 'page') loaded.add(target)
  }
  return loaded.size === before ? state : { ...state, loaded: [...loaded] }
}

/** Set / toggle a flag. */
export function applyFlag(state: FormUiState, flag: string, value: boolean | 'toggle'): FormUiState {
  return { ...state, flags: { ...state.flags, [flag]: value === 'toggle' ? !state.flags[flag] : value } }
}

/* ── Is there a way to submit? ──────────────────────────────────────── */

export type FormSurfaceKind = 'task' | 'page' | 'any'

/** In-form buttons that submit (field keys). */
export function submittingButtonKeys(fields: FieldLike[]): string[] {
  return fields.filter((f) => f.type === 'button' && withBranches(f.button?.actions ?? []).some((a) => a.type === 'submit')).map((f) => f.key)
}

/**
 * Application mode with nothing that submits: the form is an information
 * page (read, printed, embedded) — legitimate for a form page, never
 * validated or submitted.
 */
export function isInformationPage(fields: FieldLike[], layout: unknown): boolean {
  return isApplicationMode(layout) && submittingButtonKeys(fields).length === 0
}

/**
 * A task form that cannot be completed from the form itself, or null:
 * application mode and no in-form Submit. (Form pages may be information
 * pages; a task still has to be completed — from the task's own outcome
 * buttons in its header.)
 */
export function submitPathProblem(fields: FieldLike[], layout: unknown, surface: FormSurfaceKind = 'any'): string | null {
  if (surface !== 'task' || !isInformationPage(fields, layout)) return null
  return 'This task form is in Application mode and no button on the form submits: the assignee completes the task with the task\u2019s own outcome buttons (in its header). Add a Button with a Submit action to complete it from the form.'
}

/** In-form buttons that navigate steps (Application mode then leaves Back / Next to them). */
export function hasInFormNavigation(fields: FieldLike[]): boolean {
  return fields.some((f) => f.type === 'button' && (f.button?.actions ?? []).some((a) => a.type === 'next_page' || a.type === 'previous_page' || a.type === 'go_to_page'))
}
