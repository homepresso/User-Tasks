/**
 * The Agent's solution builder (server side): build several connected items
 * from one process — data tables, forms, decision tables, the workflow(s) and
 * optionally a report — with ONE confirmation for the whole plan.
 *
 *  1. The model calls build_plan with every item: its kind, name, a summary
 *     and the arguments of the item's create tool. Later items refer to
 *     earlier ones as "{{ref:<key>.id}}" / "{{ref:<key>.name}}" (e.g. a
 *     workflow's form_submitted.form_id, a user_task's form_id, an
 *     update_data_table's table_id).
 *  2. The confirmation card IS the plan: every item, what links to what, and
 *     the items the person's permissions don't allow (skipped, with their
 *     dependants). Confirming ("Build all") is the person's decision for
 *     those new items only — nothing existing is changed by a plan.
 *  3. On confirmation the items are created in dependency order (tables →
 *     forms → decision tables → workflows → reports, and declared
 *     depends_on), each through its MCP create tool as the person (drafts
 *     only, as always), with the real ids substituted into later items.
 *     Workflows go through the self-check first (warnings reported).
 *  4. Progress shows per item (✓ with a link). A failure stops the build and
 *     reports what was created and what is left; a long build pauses before
 *     the request's time budget. Either way the result carries the plan
 *     state (created ids), so build_plan_continue picks up where it stopped
 *     — with its own confirmation, on a later request.
 *  5. Solutions: the plan card groups items by section (Data model / Forms /
 *     Rules / Workflows / Reports / Package); every item is checked against
 *     its create tool's schema and the platform's own config checks (lookup
 *     columns, form fields, Data table fields, "For each changed row" button
 *     steps, report charts) BEFORE the card — a bad item comes back to the
 *     model to fix, like the theme check. With the `package` option the
 *     created items become one package after the last item
 *     (./solution-package.ts): one-click uninstall, versioning, sharing.
 */
import { formDesignerHref } from '@/lib/forms/designer-links'
import type { AssistantToolDef, ToolEnv } from '../engine'
import { draftFromArgs, workflowWarnings } from '../workflow-check'
import { normalizeTaskFields, fieldDefinitionProblems, isDisplayField, type TaskFieldDef } from '@/lib/task-field-schema'
import { formRuleProblem, layoutFormRules, type RuleKnown } from '@/lib/forms/form-rules'
import { allActions, listSourceField } from '@/lib/forms/field-buttons'
import { topOneNotice } from '@/lib/forms/data-actions'
import { outputProblems } from '@/lib/forms/action-outputs'
import { normalizeFormButtons, buttonProblems } from '@/lib/forms/buttons'
import { reportChartIssues } from '@/lib/report-charts'
import { slugifyColumnName } from '@/lib/data-table-cells'
import { checkPackageOption, normalizePackageOption, packageItems, packagingCardParts, packagingNote, type PackageOption, type PackagingAccess, type PackagingResult } from './solution-package'

/* eslint-disable @typescript-eslint/no-explicit-any -- tool arguments are JSON */

/** A full solution (tables, config tables, forms, admin forms, rules, workflows, reports) fits; long builds pause and continue. */
export const MAX_PLAN_ITEMS = 30
/** Stop starting new items after this long in one request (the turn's budget is longer). */
export const PLAN_TIME_BUDGET_MS = 150_000

export const PLAN_KINDS = ['data_table', 'form', 'decision_table', 'workflow', 'report'] as const
export type PlanKind = (typeof PLAN_KINDS)[number]

export const CREATE_TOOL: Record<PlanKind, string> = {
  data_table: 'data_tables_create', form: 'forms_create', decision_table: 'decision_tables_create', workflow: 'workflows_create', report: 'reports_create',
}
const KIND_ORDER: Record<PlanKind, number> = { data_table: 0, form: 1, decision_table: 2, workflow: 3, report: 4 }
const NOUN: Record<PlanKind, string> = { data_table: 'Data table', form: 'Form', decision_table: 'Decision table', workflow: 'Workflow', report: 'Report' }
/** Plan card sections, in this order. */
export const PLAN_SECTIONS = ['Data model', 'Forms', 'Rules', 'Workflows', 'Reports', 'Package'] as const
export const SECTION: Record<PlanKind, (typeof PLAN_SECTIONS)[number]> = { data_table: 'Data model', form: 'Forms', decision_table: 'Rules', workflow: 'Workflows', report: 'Reports' }
/** What an item is for in the solution (shown next to its kind on the card). */
export const PLAN_ROLES: Record<string, string> = {
  main: 'main table', parent: 'parent table', child: 'child table', config: 'configuration', start: 'application form', task: 'task form',
  admin: 'admin form', record: 'view / edit record', process: 'main process', helper: 'helper', rule: 'business rule', summary: 'summary',
}
const HREF: Record<PlanKind, (id: string) => string> = {
  data_table: (id) => `/data/${id}`,
  form: (id) => formDesignerHref(id),
  decision_table: (id) => `/automations/rules/${id}`,
  workflow: (id) => `/automations/${id}`,
  report: (id) => `/reports/${id}`,
}

export interface PlanItem {
  key: string
  kind: PlanKind
  name: string
  summary: string
  depends_on: string[]
  /** What it is for (PLAN_ROLES): parent / child / config table, start / task / admin form, … */
  role?: string
  /** The create tool's arguments ("{{ref:<key>.id}}" for earlier items). */
  args: Record<string, any>
}

export interface CreatedItem { key: string; kind: PlanKind; id: string; name: string; href: string }

/** {{ref:<key>.id}}, {{ref:<key>.name}}, and {{ref:<key>.source}} (a data table as a report source: custom_table_<id>). */
const REF = /\{\{\s*ref:([A-Za-z0-9_-]+)\.(id|name|source)\s*\}\}/g

/** The references an item makes to other items. */
export function planRefs(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') for (const m of value.matchAll(REF)) out.add(m[1])
  else if (Array.isArray(value)) value.forEach((v) => planRefs(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => planRefs(v, out))
  return out
}

/** `value` with "{{ref:key.id|name|source}}" replaced from created items (unknown refs left, to be reported). */
export function substituteRefs<T>(value: T, created: Record<string, { id: string; name: string; kind?: string }>): T {
  if (typeof value === 'string') {
    return value.replace(REF, (whole, key: string, field: 'id' | 'name' | 'source') => {
      const c = created[key]
      if (!c) return whole
      if (field === 'source') return c.kind === 'data_table' || !c.kind ? `custom_table_${c.id}` : c.id
      return c[field]
    }) as T
  }
  if (Array.isArray(value)) return value.map((v) => substituteRefs(v, created)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substituteRefs(v, created)])) as T
  return value
}

/** Plan items from the model, normalised (throws a clear error for a bad plan). */
export function normalizePlan(raw: unknown): PlanItem[] {
  const list = Array.isArray(raw) ? raw : []
  if (!list.length) throw new Error('The plan has no items')
  if (list.length > MAX_PLAN_ITEMS) throw new Error(`A plan can have at most ${MAX_PLAN_ITEMS} items — split it into two builds`)
  const items: PlanItem[] = list.map((r: any, i: number) => {
    const kind = (PLAN_KINDS as readonly string[]).includes(r?.kind) ? r.kind as PlanKind : null
    if (!kind) throw new Error(`Item ${i + 1}: kind must be one of ${PLAN_KINDS.join(', ')}`)
    const key = String(r?.key ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '') || `item${i + 1}`
    const args = r?.args && typeof r.args === 'object' && !Array.isArray(r.args) ? r.args : {}
    const name = String(r?.name ?? args.name ?? '').trim().slice(0, 200)
    if (!name) throw new Error(`Item ${i + 1}: give it a name`)
    const role = typeof r?.role === 'string' && PLAN_ROLES[r.role] ? r.role : undefined
    return { key, kind, name, summary: String(r?.summary ?? '').slice(0, 300), depends_on: Array.isArray(r?.depends_on) ? r.depends_on.map(String) : [], ...(role ? { role } : {}), args: { ...args, name: args.name ?? name } }
  })
  const keys = new Set<string>()
  for (const it of items) { if (keys.has(it.key)) throw new Error(`Two items share the key "${it.key}"`); keys.add(it.key) }
  for (const it of items) for (const ref of [...planRefs(it.args), ...it.depends_on]) if (!keys.has(ref)) throw new Error(`${it.name}: refers to "${ref}", which is not in the plan`)
  return items
}

/** Dependency order: declared depends_on and {{ref:…}} first, then tables → forms → decision tables → workflows → reports. */
export function orderPlan(items: PlanItem[]): PlanItem[] {
  const byKey = new Map(items.map((i) => [i.key, i]))
  const deps = new Map(items.map((i) => [i.key, new Set([...i.depends_on, ...planRefs(i.args)].filter((k) => k !== i.key))]))
  const out: PlanItem[] = []
  const done = new Set<string>()
  while (out.length < items.length) {
    const ready = items.filter((i) => !done.has(i.key) && [...deps.get(i.key)!].every((d) => done.has(d)))
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || items.indexOf(a) - items.indexOf(b))
    if (!ready.length) throw new Error(`The plan has a circular dependency between: ${items.filter((i) => !done.has(i.key)).map((i) => i.name).join(', ')}`)
    out.push(ready[0]); done.add(ready[0].key)
  }
  void byKey
  return out
}

/** Items the person can't create (no permission for the kind) and everything depending on them. */
export function skippedItems(items: PlanItem[], allowedTools: ReadonlySet<string>): Map<string, string> {
  const skipped = new Map<string, string>()
  for (const it of items) if (!allowedTools.has(CREATE_TOOL[it.kind])) skipped.set(it.key, `you can't create ${NOUN[it.kind].toLowerCase()}s — ask an admin`)
  let changed = true
  while (changed) {
    changed = false
    for (const it of items) {
      if (skipped.has(it.key)) continue
      const dep = [...it.depends_on, ...planRefs(it.args)].find((d) => skipped.has(d))
      if (dep) { skipped.set(it.key, `needs “${items.find((x) => x.key === dep)?.name}”, which is skipped`); changed = true }
    }
  }
  return skipped
}

function linksOf(it: PlanItem, items: PlanItem[]): string {
  const refs = [...planRefs(it.args)].map((k) => items.find((x) => x.key === k)).filter(Boolean) as PlanItem[]
  return refs.length ? `uses ${refs.map((r) => `“${r.name}”`).join(', ')}` : ''
}

/* ── Checking items before the card ──────────────────────────────────── */

const json = (v: unknown): any => {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return undefined }
}
/** A stand-in id for a not-yet-created item (validation only). */
const placeholderId = (i: number) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`

/** The item's args with every {{ref:…}} replaced by stand-ins (to validate before anything exists). */
export function withPlaceholders(it: PlanItem, items: PlanItem[]): Record<string, any> {
  const fake: Record<string, { id: string; name: string; kind: string }> = {}
  items.forEach((x, i) => { fake[x.key] = { id: placeholderId(i), name: x.name, kind: x.kind } })
  return prepareArgs(it.kind, substituteRefs(it.args, fake))
}

/** Arguments as the create tool takes them (a report's config, a workflow's nodes / edges are JSON text). */
export function prepareArgs(kind: PlanKind, args: Record<string, any>): Record<string, any> {
  if (kind === 'report' && args.config && typeof args.config === 'object') return { ...args, config: JSON.stringify(args.config) }
  if (kind === 'workflow') {
    const out = { ...args }
    for (const key of ['nodes', 'edges']) if (Array.isArray(out[key])) out[key] = JSON.stringify(out[key])
    return out
  }
  return args
}

/**
 * A workflow's decision_table steps that call a decision table of the plan
 * carry its inputs / outputs as _decision_inputs / _decision_outputs (as the
 * designer caches them; the engine ignores "_" keys), so the wiring check and
 * the editor's data picker know the variables the step sets.
 */
export function withDecisionFields(args: Record<string, any>, items: PlanItem[], done: Record<string, CreatedItem>): Record<string, any> {
  const nodes = json(args.nodes)
  if (!Array.isArray(nodes)) return args
  const byId = new Map(Object.values(done).filter((c) => c.kind === 'decision_table').map((c) => [c.id, items.find((i) => i.key === c.key)]))
  let changed = false
  const out = nodes.map((n: any) => {
    const plan = n?.type === 'decision_table' ? byId.get(String(n?.config?.decision_table_id ?? '')) : undefined
    if (!plan || n.config._decision_outputs) return n
    changed = true
    const fields = (v: unknown) => (Array.isArray(json(v)) ? json(v) : []).map((f: any) => ({ key: String(f?.key ?? ''), label: String(f?.label ?? f?.key ?? ''), type: f?.type ?? 'text' })).filter((f: any) => f.key)
    return { ...n, config: { ...n.config, _decision_inputs: fields(plan.args.inputs), _decision_outputs: fields(plan.args.outputs) } }
  })
  return changed ? { ...args, nodes: typeof args.nodes === 'string' ? JSON.stringify(out) : out } : args
}

/** The column keys of a plan's data table (explicit key, else the slug of the name — as the table service does). */
function planTableKeys(it: PlanItem | undefined): Set<string> | null {
  if (!it || it.kind !== 'data_table') return null
  const cols = Array.isArray(json(it.args.columns)) ? json(it.args.columns) : []
  return new Set(['row_id', 'id', 'date_created', ...cols.map((c: any) => String(c?.key || slugifyColumnName(String(c?.name ?? ''))))])
}

/** The plan item a value refers to ("{{ref:<key>.id}}"), if any. */
function refTarget(value: unknown, items: PlanItem[]): PlanItem | undefined {
  if (typeof value !== 'string') return undefined
  const m = /\{\{\s*ref:([A-Za-z0-9_-]+)\.(?:id|source)\s*\}\}/.exec(value)
  return m ? items.find((x) => x.key === m[1]) : undefined
}

/**
 * The platform's own config checks for one plan item (pure): lookup columns
 * point at a table of the plan with that column; form fields and buttons
 * pass the form designer's checks (Data table fields bound to a plan table
 * use its columns; "For each changed row" steps are complete); report
 * charts are valid. Returns problems in plain words.
 */
export function itemProblems(it: PlanItem, items: PlanItem[]): string[] {
  const out: string[] = []
  const args = it.args
  if (it.kind === 'data_table') {
    const cols = json(args.columns)
    for (const c of Array.isArray(cols) ? cols : []) {
      if (c?.type !== 'lookup') continue
      const label = `lookup column “${c?.name ?? c?.key}”`
      if (!c.lookup?.sourceTableId || !c.lookup?.sourceColumn) { out.push(`${label} needs lookup { sourceTableId, sourceColumn }`); continue }
      const target = refTarget(c.lookup.sourceTableId, items)
      if (target && target.kind !== 'data_table') out.push(`${label}: sourceTableId must be a data table of the plan ("{{ref:<table key>.id}}")`)
      const keys = planTableKeys(target)
      if (keys && !keys.has(String(c.lookup.sourceColumn))) out.push(`${label}: “${target!.name}” has no column "${c.lookup.sourceColumn}" (columns: ${[...keys].filter((k) => !['row_id', 'id', 'date_created'].includes(k)).join(', ')})`)
    }
  }
  if (it.kind === 'form') {
    const raw = json(args.fields)
    const placeholderArgs = withPlaceholders(it, items)
    const fields = normalizeTaskFields(json(placeholderArgs.fields) ?? [])
    for (const [key, problem] of Object.entries(fieldDefinitionProblems(fields))) out.push(`field "${key}": ${problem}`)
    for (const f of Array.isArray(raw) ? raw : []) {
      const target = f?.type === 'data_table' ? refTarget(f?.data_table?.table_id, items) : f?.type === 'lookup' ? refTarget(f?.lookup?.table_id, items) : undefined
      const keys = planTableKeys(target)
      if (!keys) continue
      const used = f.type === 'data_table'
        ? (Array.isArray(f.data_table?.columns) ? f.data_table.columns.map((c: any) => String(c?.key ?? '')) : [])
        : [...(Array.isArray(f.lookup?.display_columns) ? f.lookup.display_columns : []), ...(Array.isArray(f.lookup?.search_columns) ? f.lookup.search_columns : []), ...(f.lookup?.value_column ? [f.lookup.value_column] : [])].map(String)
      const missing = used.filter((k: string) => k && !keys.has(k))
      if (missing.length) out.push(`field "${f.key}": “${target!.name}” has no column ${missing.map((k: string) => `"${k}"`).join(', ')}`)
    }
    // Form rules (layout.rules): each passes the designer's rule checks; List fields have a way to get rows.
    for (const problem of formRulesProblems(fields, json(placeholderArgs.layout))) out.push(problem)
    if (placeholderArgs.buttons !== undefined && placeholderArgs.buttons !== null) {
      const buttons = normalizeFormButtons(json(placeholderArgs.buttons))
      const editable = new Set(fields.filter((f) => f.type === 'data_table' && f.data_table?.mode === 'edit').map((f) => f.key))
      for (const [id, problem] of Object.entries(buttonProblems(buttons, { editableTables: editable }))) out.push(`button "${id}": ${problem}`)
    }
  }
  if (it.kind === 'report') {
    const cfg = json(args.config)
    if (!cfg || typeof cfg !== 'object') out.push('needs config (the report config object)')
    else {
      if (!cfg.data_source && !cfg.source) out.push('config needs data_source (a plan table: "{{ref:<table key>.source}}")')
      for (const issue of reportChartIssues(cfg.charts)) out.push(`chart: ${issue}`)
      // A plan table as the source: its report columns are data_<column key> (+ id, created_at, updated_at).
      const keys = planTableKeys(refTarget(cfg.data_source ?? cfg.source, items))
      if (keys) {
        const valid = new Set(['id', 'created_at', 'updated_at', ...[...keys].filter((k) => k !== 'row_id').map((k) => `data_${k}`)])
        const charts = Array.isArray(cfg.charts) ? cfg.charts : []
        const used = [
          ...(Array.isArray(cfg.columns) ? cfg.columns : []), ...(Array.isArray(cfg.group_by) ? cfg.group_by : []), cfg.sort?.field,
          ...charts.flatMap((c: any) => [c?.dimension?.field, c?.measure?.field, c?.window_field]),
        ].filter((f): f is string => typeof f === 'string' && !!f && !/^[A-Z]+_/.test(f))
        const bad = [...new Set(used.filter((f) => !valid.has(f)))]
        if (bad.length) out.push(`unknown report column${bad.length === 1 ? '' : 's'} ${bad.map((f) => `"${f}"`).join(', ')} — a data table's report columns are ${[...valid].slice(0, 12).join(', ')}`)
      }
    }
  }
  return out
}

/**
 * A form's rules checked like the designer does (lib/forms/form-rules.ts
 * formRuleProblem), plus the List field checks the designer can't see
 * without the columns: an Add row action maps only columns the list has and
 * reads inputs the form has; a List in the list view (not inline) has a rule
 * that adds rows to it (else nobody can fill it in).
 */
export function formRulesProblems(fields: TaskFieldDef[], layout: unknown): string[] {
  const out: string[] = []
  const rules = layoutFormRules(layout)
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const known: RuleKnown = {
    fieldKeys: new Set(fields.map((f) => f.key)),
    valueKeys: new Set(fields.filter((f) => !isDisplayField(f) && !f.read_only).map((f) => f.key)),
    writableKeys: new Set(fields.filter((f) => !isDisplayField(f)).map((f) => f.key)),
    fieldTypes: new Map(fields.map((f) => [f.key, f.type === 'repeating_section' ? 'list' : f.type])),
    headingKeys: new Set(fields.filter((f) => f.type === 'heading').map((f) => f.key)),
    pageIds: new Set(Array.isArray((layout as any)?.pages) ? (layout as any).pages.map((p: any) => String(p?.id ?? '')) : []),
    flags: new Set(Array.isArray((layout as any)?.state?.flags) ? (layout as any).state.flags.map((f: any) => String(f?.key ?? '')) : []),
    sectionKeys: new Set(Array.isArray((layout as any)?.sections) ? (layout as any).sections.map((s: any) => String(s?.key ?? '')) : []),
  }
  const filled = new Set<string>()
  for (const rule of rules) {
    const problem = formRuleProblem(rule, known)
    if (problem) out.push(`rule "${rule.name ?? rule.id}": ${problem}`)
    for (const a of allActions(rule.then)) {
      // Data / API steps: outputs aimed at what the form has; a list result into one value needs a filter / sort (TOP 1).
      for (const p of outputProblems(a.outputs, { fields, variables: Array.isArray((layout as any)?.variables) ? (layout as any).variables.map((v: any) => String(v?.name ?? '')) : [] })) out.push(`rule "${rule.name ?? rule.id}": ${p}`)
      for (const o of a.outputs ?? []) {
        if (topOneNotice(a, o, byKey.get(o.to)?.type)) out.push(`rule "${rule.name ?? rule.id}": "${o.to}" gets one value from a list of rows (TOP 1: only the first row is used) — add a filter that pins the row (e.g. { column: "row_id", operator: "eq", value: "{{…}}" }), a sort (e.g. created_at desc) with limit 1, or map the rows into a List field / options`)
      }
      // The selection: a list action aimed at "selected" (or a table step run per selected row) needs a List with selection on.
      const selectionList = a.row === 'selected' ? a.list_field : a.each_selected
      if (selectionList && !byKey.get(selectionList)?.list?.selectable) out.push(`rule "${rule.name ?? rule.id}": the List "${selectionList}" has no row selection — set list.selectable to "single" or "multiple"`)
      // Editable table rules (lib/forms/row-rules.ts): columns the field has; read-only columns only reach new rows.
      if ((a.type === 'new_row' || a.type === 'set_row_values') && a.field) {
        const target = byKey.get(a.field)
        if (a.type === 'new_row' && target?.type === 'list') filled.add(a.field)
        const cols = (target?.type === 'list' ? target.list?.columns ?? [] : target?.data_table?.columns ?? []) as Array<{ key: string; read_only?: boolean }>
        const known = new Set(cols.map((c) => c.key))
        const unknown = Object.keys(a.values ?? {}).find((c) => !known.has(c) && !c.endsWith('_label'))
        if (target && unknown) out.push(`rule "${rule.name ?? rule.id}": ${target.label || a.field} has no column "${unknown}" (columns: ${[...known].join(', ')})`)
        const locked = Object.keys(a.values ?? {}).filter((c) => cols.find((x) => x.key === c)?.read_only)
        if (a.type === 'set_row_values' && locked.length) out.push(`rule "${rule.name ?? rule.id}": ${locked.join(', ')} ${locked.length === 1 ? 'is' : 'are'} read-only when editing — Set row values ignores ${locked.length === 1 ? 'it' : 'them'} on existing rows (set ${locked.length === 1 ? 'it' : 'them'} in new_row's values or the column default instead, or drop read_only)`)
      }
      if (a.type === 'update_list_row' && a.list_field) {
        const cols = byKey.get(a.list_field)?.list?.columns ?? []
        const locked = Object.keys(a.values ?? {}).filter((c) => cols.find((x) => x.key === c)?.read_only)
        if (locked.length) out.push(`rule "${rule.name ?? rule.id}": ${locked.join(', ')} ${locked.length === 1 ? 'is' : 'are'} read-only when editing — Update a row leaves ${locked.length === 1 ? 'it' : 'them'} as ${locked.length === 1 ? 'it is' : 'they are'} on existing rows`)
      }
      if (a.type !== 'add_list_row' || !a.list_field) continue
      filled.add(a.list_field)
      const columns = new Set((byKey.get(a.list_field)?.list?.columns ?? []).map((c) => c.key))
      const badColumn = Object.keys(a.values ?? {}).find((c) => !columns.has(c))
      if (badColumn) out.push(`rule "${rule.name ?? rule.id}": the List "${a.list_field}" has no column "${badColumn}" (columns: ${[...columns].join(', ')})`)
      const badInput = Object.values(a.values ?? {}).map(listSourceField).find((k) => k && !byKey.has(k))
      if (badInput) out.push(`rule "${rule.name ?? rule.id}": "{{${badInput}}}" is not a field of this form (add an input field for it)`)
    }
  }
  for (const f of fields) {
    if (f.type === 'list' && f.list?.entry_mode !== 'inline' && !filled.has(f.key)) {
      out.push(`field "${f.key}": nothing adds rows to this List — add input fields, a button and a rule { event: "button_click", target: <button key>, then: [{ type: "add_list_row", list_field: "${f.key}", values: { <column>: "{{<input key>}}" } }] } in layout.rules (or set list.entry_mode "inline")`)
    }
  }
  return out
}

export interface PlanToolDeps {
  /** Calls an MCP tool as the person (read or write); returns its JSON payload or { error }. */
  call: (name: string, args: Record<string, any>) => Promise<any>
  /** The person's allowed tool names (create tools per kind). */
  allowedTools: ReadonlySet<string>
  /** draftOnlyArgs of the designer tools (drafts only). */
  draftOnly: (tool: string, args: Record<string, any>) => Record<string, any>
  /** The create tool's argument check (its input schema): an error message, or null. */
  validate?: (tool: string, args: Record<string, any>) => Promise<string | null>
  /** What packaging the person may do (none: packaging is skipped and the card says why). */
  packaging?: PackagingAccess
  now?: () => number
}

const NO_PACKAGING: PackagingAccess = { manage: false, install: false, share: false }

/** Every item checked before the card: its create tool's schema and the platform checks. Throws one error listing the problems. */
async function checkPlan(items: PlanItem[], deps: PlanToolDeps, created: Record<string, CreatedItem> = {}) {
  const problems: string[] = []
  for (const it of items) {
    if (created[it.key]) continue
    const found = itemProblems(it, items)
    if (deps.validate && deps.allowedTools.has(CREATE_TOOL[it.kind])) {
      const err = await deps.validate(CREATE_TOOL[it.kind], deps.draftOnly(CREATE_TOOL[it.kind], withPlaceholders(it, items)))
      if (err) found.push(err)
    }
    for (const p of found.slice(0, 6)) problems.push(`${it.name} (${it.key}): ${p}`)
  }
  if (problems.length) throw new Error(`Check the plan before showing it to the person — fix these and call again with the whole plan:\n- ${problems.slice(0, 20).join('\n- ')}`)
}

async function planCard(items: PlanItem[], deps: PlanToolDeps, title: string, created: Record<string, CreatedItem> = {}, pkg: PackageOption | null = null) {
  const allowed = deps.allowedTools
  const ordered = orderPlan(items)
  const skipped = skippedItems(items, allowed)
  const todo = ordered.filter((i) => !skipped.has(i.key) && !created[i.key])
  if (!todo.length && !(pkg && Object.keys(created).length)) throw new Error(skipped.size ? `Nothing in this plan can be built with your permissions (${[...skipped.values()][0]})` : 'Everything in this plan is already built')
  await checkPlan(items, deps, created)
  const access = deps.packaging ?? NO_PACKAGING
  const existing = pkg && access.manage ? await checkPackageOption(pkg, deps.call) : null
  const packaging = pkg ? packagingCardParts(pkg, access, existing) : null
  // Rows grouped by section; # is the build order.
  const position = new Map(ordered.map((it, i) => [it.key, i + 1]))
  const bySection = [...ordered].sort((a, b) => PLAN_SECTIONS.indexOf(SECTION[a.kind]) - PLAN_SECTIONS.indexOf(SECTION[b.kind]) || position.get(a.key)! - position.get(b.key)!)
  const rows = bySection.map((it) => [
    String(position.get(it.key)), SECTION[it.kind], it.role ? `${NOUN[it.kind]} · ${PLAN_ROLES[it.role]}` : NOUN[it.kind], it.name,
    created[it.key] ? '✓ already built' : skipped.has(it.key) ? `Skipped: ${skipped.get(it.key)}` : [it.summary, linksOf(it, items)].filter(Boolean).join(' · '),
  ])
  if (pkg && access.manage) rows.push([String(ordered.length + 1), 'Package', 'Package', existing ? existing.name : pkg.name, existing ? `adds every item above (new version)` : `every item above · version ${pkg.version ?? '1.0.0'}${pkg.share ? ' · then share to the gallery' : ''}`])
  const counts = PLAN_SECTIONS.map((s) => [s, bySection.filter((it) => SECTION[it.kind] === s && !skipped.has(it.key)).length] as const).filter(([, n]) => n > 0)
  return {
    title,
    lines: [
      `${todo.length} item${todo.length === 1 ? '' : 's'} will be created, in this order${skipped.size ? ` (${skipped.size} skipped)` : ''}${counts.length > 1 ? ` — ${counts.map(([s, n]) => `${s} ${n}`).join(', ')}` : ''}`,
      'Workflows are saved as inactive drafts; forms, tables and rules as new items — nothing existing is changed',
      ...(packaging?.lines ?? []),
    ],
    warnings: [...[...skipped.entries()].map(([k, why]) => `“${items.find((i) => i.key === k)?.name}” is skipped: ${why}`), ...(packaging?.warnings ?? [])],
    preview: { columns: ['#', 'Section', 'Kind', 'Name', 'Details'], rows, total: rows.length, caption: 'Build plan' },
    confirm_label: todo.length === 1 && !pkg ? 'Build it' : 'Build all',
  }
}

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    key: { type: 'string', description: 'A short unique key for this item (e.g. "requests_table", "line_items", "categories", "start_form", "approval_form", "admin_categories", "workflow")' },
    kind: { type: 'string', enum: [...PLAN_KINDS] },
    name: { type: 'string' },
    role: { type: 'string', enum: Object.keys(PLAN_ROLES), description: 'What it is for in the solution (shown on the card): main / parent / child / config table, start / task / admin / record form, process / helper workflow, rule, summary report' },
    summary: { type: 'string', description: 'One line shown on the plan card: columns, fields or steps' },
    depends_on: { type: 'array', items: { type: 'string' }, description: 'Keys of items that must be created first' },
    args: { type: 'object', description: 'The full arguments of the kind\'s create tool (data_tables_create, forms_create, decision_tables_create, workflows_create, reports_create). Refer to an earlier item as "{{ref:<key>.id}}" or "{{ref:<key>.name}}"; a plan table as a report data_source as "{{ref:<key>.source}}". A report\'s config may be an object.' },
  },
  required: ['key', 'kind', 'name', 'args'],
}

const PACKAGE_SCHEMA = {
  type: 'object',
  description: 'Package every created item as ONE package after the build (only when the person chose it): one-click uninstall, versioning, sharing',
  properties: {
    name: { type: 'string', description: 'Package name (usually the solution title)' },
    description: { type: 'string' },
    version: { type: 'string', description: 'Default 1.0.0' },
    add_to: { type: 'string', description: 'An existing package id: add the new items to it instead ("Add to package <name>")' },
    share: { type: 'boolean', description: 'They also chose to share it to the gallery (you call package_share_to_gallery afterwards; they confirm the listing)' },
  },
}

async function execute(items: PlanItem[], created: Record<string, CreatedItem>, deps: PlanToolDeps, env: ToolEnv, pkg: PackageOption | null = null) {
  const now = deps.now ?? Date.now
  const started = now()
  const ordered = orderPlan(items)
  const skipped = skippedItems(items, deps.allowedTools)
  const done: Record<string, CreatedItem> = { ...created }
  const warnings: string[] = []
  for (const it of ordered) {
    if (done[it.key] || skipped.has(it.key)) continue
    const remaining = () => ordered.filter((x) => !done[x.key] && !skipped.has(x.key)).map((x) => x.key)
    if (now() - started > PLAN_TIME_BUDGET_MS) {
      return { status: 'paused', note: `Paused to stay within this request's time. Call build_plan_continue with the same items${pkg ? ', the same package option' : ''} and \`created\` to finish (the person confirms once more).`, created: Object.values(done), remaining: remaining(), warnings }
    }
    const tool = CREATE_TOOL[it.kind]
    const args = deps.draftOnly(tool, prepareArgs(it.kind, withDecisionFields(substituteRefs(it.args, done), items, done)))
    const label = `Creating ${NOUN[it.kind].toLowerCase()} “${it.name}”`
    const id = `${env.toolCallId}-${it.key}`
    env.emit({ type: 'tool_start', id, name: tool, label })
    const unresolved = [...planRefs(args)]
    let payload: any
    if (unresolved.length) payload = { error: `refers to items that were not created: ${unresolved.join(', ')}` }
    else {
      if (it.kind === 'workflow') {
        const draft = draftFromArgs(args)
        if (draft) for (const w of workflowWarnings(draft)) warnings.push(`${it.name}: ${w}`)
      }
      payload = await deps.call(tool, args)
    }
    const obj = payload?.form ?? payload?.workflow ?? payload?.table ?? payload?.decision_table ?? payload?.report ?? payload
    const newId = obj?.id ?? payload?.id ?? null
    if (payload?.error || !newId) {
      env.emit({ type: 'tool_end', id, name: tool, ok: false, label })
      return {
        status: 'failed',
        failed: { key: it.key, name: it.name, error: payload?.error ?? 'The create tool returned no id' },
        created: Object.values(done),
        remaining: remaining(),
        warnings,
        note: `The build stopped. Tell the person what was created and what failed, and offer to fix the failed item and continue (build_plan_continue with the same items${pkg ? ', the same package option' : ''} and \`created\`) or to stop.`,
      }
    }
    const item: CreatedItem = { key: it.key, kind: it.kind, id: String(newId), name: String(obj?.name ?? it.name), href: HREF[it.kind](String(newId)) }
    done[it.key] = item
    env.emit({ type: 'tool_end', id, name: tool, ok: true, label })
    env.emit({ type: 'changed', kind: it.kind, id: item.id, title: item.name, href: item.href, action: 'created' })
  }
  const all = Object.values(done)
  let packaging: (PackagingResult & { note: string }) | null = null
  if (pkg) {
    const access = deps.packaging ?? NO_PACKAGING
    const r = await packageItems(all.map((c) => ({ kind: c.kind, id: c.id, name: c.name })), pkg, { call: deps.call, access, env })
    packaging = { ...r, note: packagingNote(r, access, pkg.share === true) }
  }
  return {
    status: 'completed',
    created: all,
    skipped: [...skipped.entries()].map(([key, why]) => ({ key, why })),
    warnings,
    ...(packaging ? { package: packaging } : {}),
    note: `Summarise what was built with links, grouped by section, and list any warnings.${packaging ? ` Packaging: ${packaging.note}` : ''} Ask ONCE whether to open the workflow. Everything is a draft: the person reviews and publishes the workflow in the editor.`,
  }
}

export function buildPlanTools(deps: PlanToolDeps): AssistantToolDef[] {
  const createdArg = (raw: unknown): Record<string, CreatedItem> => {
    const out: Record<string, CreatedItem> = {}
    for (const c of Array.isArray(raw) ? raw : []) if (c?.key && c?.id && (PLAN_KINDS as readonly string[]).includes(c.kind)) out[String(c.key)] = { key: String(c.key), kind: c.kind, id: String(c.id), name: String(c.name ?? ''), href: HREF[c.kind as PlanKind](String(c.id)) }
    return out
  }
  return [
    {
      name: 'build_plan',
      description: `Build several connected items from one process or a whole solution (data tables incl. parent / child and configuration tables, forms incl. admin forms, decision tables, workflows, reports with charts) with ONE confirmation: the person sees the whole plan grouped by section and chooses Build all. At most ${MAX_PLAN_ITEMS} items (a long build pauses and continues). Items are created in dependency order with real ids substituted for "{{ref:<key>.id}}". Optional \`package\`: package every created item afterwards (only when the person chose it). Use this for "build it" from a process; use the single create tools for one item.`,
      parameters: { type: 'object', properties: { title: { type: 'string', description: 'e.g. "Purchase requests"' }, items: { type: 'array', items: ITEM_SCHEMA }, package: PACKAGE_SCHEMA }, required: ['items'] },
      mode: 'write',
      label: (args) => `Building ${String(args.title ?? 'the plan').slice(0, 60)}`,
      confirm: async (args) => planCard(normalizePlan(args.items), deps, `Build plan: ${String(args.title ?? 'new solution').slice(0, 80)}`, {}, normalizePackageOption(args.package)),
      run: async (args, env) => ({ result: await execute(normalizePlan(args.items), {}, deps, env, normalizePackageOption(args.package)) }),
    },
    {
      name: 'build_plan_continue',
      description: 'Continue a build that stopped (failed or paused): the same items (fixed if needed), the same `package` option and `created` from the last result. The person confirms the remaining items.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          items: { type: 'array', items: ITEM_SCHEMA },
          created: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, kind: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' } }, required: ['key', 'kind', 'id'] }, description: 'Items already built (from the previous result)' },
          package: PACKAGE_SCHEMA,
        },
        required: ['items', 'created'],
      },
      mode: 'write',
      label: () => 'Continuing the build',
      confirm: async (args) => planCard(normalizePlan(args.items), deps, `Continue building: ${String(args.title ?? 'the plan').slice(0, 80)}`, createdArg(args.created), normalizePackageOption(args.package)),
      run: async (args, env) => ({ result: await execute(normalizePlan(args.items), createdArg(args.created), deps, env, normalizePackageOption(args.package)) }),
    },
  ]
}
