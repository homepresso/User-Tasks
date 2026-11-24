/**
 * Intermediate model → UserTasks forms (pure, client-safe): fields
 * (TaskFieldDef), a layout (pages as steps, Part / Section headings as
 * sections, boxes on one row side by side) and form rules (layout.rules).
 *
 * Rules are "Always" show / hide rules. HIGH confidence → enabled; LOW →
 * created turned off, with the reason and the original sentence / script
 * in the description (nothing is silently dropped). AI-derived rules are
 * named "AI: …" and say so in their description.
 *
 * A form holds at most 200 fields and 20 steps: bigger PDFs become several
 * forms ("part 1 of 2"), split at page boundaries.
 */

import { FORM_RULE_LIMITS, newRuleId, type FormRule } from '@/lib/forms/form-rules'
import type { FieldButtonAction } from '@/lib/forms/field-buttons'
import type { DataTableCondition } from '@/lib/forms/data-table'
import type { FormLayout, FormPage, FormRow, FormSection } from '@/lib/forms/layout'
import { ITEM_SCOPE_NAMES, REPEATING_LIMITS, type RepeatingSectionConfig } from '@/lib/forms/repeating-section'
import { uniqueFieldKey, type TaskFieldDef } from '@/lib/task-field-schema'
import type { PdfCondition, PdfFormModel, PdfItem, PdfRule, PdfTable } from './model'
import type { ImportReportItem } from '@/lib/extensions/sdk'
import type { FormThemeOverrides } from '@/lib/forms/form-theme'
import type { PdfStyling } from './styling'
import { planStyling, type PlannedHeader, type StyleElement, type StyleOptions, type StylePlan } from './style-plan'

export const PDF_FORM_LIMITS = { fields: 200, pages: 20, rules: FORM_RULE_LIMITS.rules } as const

export interface BuildOptions {
  /** steps (default when the PDF has several pages with fields) or one page. */
  pages?: 'steps' | 'single'
  name?: string
  fileName: string
  hash: string
  /** Turn the PDF's tables into repeating lists (default true). */
  tables?: boolean
  /** Table ids (model.tables) kept as separate fields. */
  keepTables?: string[]
  /** A list's most rows: the PDF's row count (default) or unlimited (the repeating section's cap). */
  tableRows?: 'pdf' | 'unlimited'
  /** The PDF's look (analyze with styling) and what to bring in of it; absent → the plain import. */
  styling?: PdfStyling
  style?: StyleOptions
}

/** Text a form carries in static elements at most (the form's stored size is capped at 256 KB). */
export const STYLE_TEXT_BUDGET = 40_000

/** A table built as a repeating section. */
export interface BuiltTable {
  id: string
  key: string
  name: string
  /** Inner field key per table column (and the row-label choice column first when there is one). */
  columns: Array<{ key: string; label: string }>
  maxItems: number
  /** PDF total fields that became a total over the list (item id → the label field's key). */
  totals: Array<{ item: string; key: string }>
}

export interface BuiltForm {
  name: string
  description: string
  tags: string[]
  fields: TaskFieldDef[]
  layout: FormLayout
  /** Item id → field key (for the report). */
  keys: Record<string, string>
  pages: number[]
  counts: { fields: number; rules: number; disabled_rules: number; ai: number }
  /** The tables built as repeating sections on this form. */
  tables: BuiltTable[]
  /** "Bring in styling": the form header (its image a data: URL until stored) and the theme overrides. */
  header?: PlannedHeader
  theme?: FormThemeOverrides
  /** Display elements placed (headings, text, dividers, images). */
  display?: { headings: number; texts: number; dividers: number; images: number }
}

export interface BuildResult {
  forms: BuiltForm[]
  /** Rules that could not be placed (targets in another part, over the limit): reported. */
  dropped: Array<{ rule: PdfRule; why: string }>
  /** Rules whose targets were boxes of a table: now aimed at the list's column (kept on), said in the report. */
  remapped: Array<{ rule: PdfRule; note: string }>
  /** The tables turned into repeating lists (ids); the others were kept as fields. */
  converted: string[]
  /** What styling brought in (report entries), when it was asked for. */
  styling?: { log: ImportReportItem[]; counts: StylePlan['counts']; header: PlannedHeader | null; theme: FormThemeOverrides | null }
}

/** The tables of a model that become repeating lists with these options. */
export function tablesToConvert(model: PdfFormModel, options: Pick<BuildOptions, 'tables' | 'keepTables'>): PdfTable[] {
  if (options.tables === false) return []
  const keep = new Set(options.keepTables ?? [])
  return (model.tables ?? []).filter((t) => !keep.has(t.id) && t.columns.length <= REPEATING_LIMITS.fields - 1 && t.columns.length > 0)
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Option values shown to people: the labels, when they are unique (cleaner submissions); else the PDF values. */
function optionPlan(item: PdfItem): { values: string[]; labels?: Record<string, string>; map: Map<string, string> } {
  const opts = item.options ?? []
  const labels = opts.map((o) => (o.label || o.value).trim().slice(0, 200))
  const unique = new Set(labels.map((l) => l.toLowerCase())).size === labels.length && labels.every(Boolean)
  const map = new Map<string, string>()
  if (unique) {
    opts.forEach((o, i) => map.set(o.value, labels[i]))
    return { values: labels, map }
  }
  const optionLabels: Record<string, string> = {}
  opts.forEach((o, i) => { map.set(o.value, o.value); if (labels[i] && labels[i] !== o.value) optionLabels[o.value] = labels[i] })
  return { values: opts.map((o) => o.value), ...(Object.keys(optionLabels).length ? { labels: optionLabels } : {}), map }
}

function fieldOf(item: PdfItem, key: string): { field: TaskFieldDef; values: Map<string, string> } {
  const f: TaskFieldDef = { key, label: clip(item.label || key, 200), type: item.type }
  let values = new Map<string, string>()
  if (item.required) f.required = true
  if (item.readOnly) f.read_only = true
  const help = item.help && item.help !== item.label ? item.help : ''
  if (help) f.help_text = clip(help, 1000)
  if (item.type === 'choice' || item.type === 'multi_choice') {
    const plan = optionPlan(item)
    f.options = plan.values
    if (plan.labels) f.option_labels = plan.labels
    values = plan.map
    f.display = item.type === 'choice' ? (item.display === 'dropdown' || (plan.values.length > 6 && item.display !== 'radio') ? 'dropdown' : 'radio') : (item.display === 'listbox' ? 'listbox' : 'checkboxes')
  }
  if (item.maxLength && (item.type === 'text' || item.type === 'textarea' || item.type === 'phone' || item.type === 'email')) f.max_length = Math.min(item.maxLength, 100_000)
  if (item.pattern && (item.type === 'text' || item.type === 'phone')) { f.pattern = item.pattern; if (item.patternMessage) f.pattern_message = item.patternMessage }
  if (item.type === 'number' || item.type === 'currency') {
    if (item.min !== undefined) f.min = item.min
    if (item.max !== undefined) f.max = item.max
  }
  if (item.type === 'currency') f.currency = item.currency ?? 'USD'
  if (item.type === 'signature') f.signature = { mode: 'both', statement: 'I confirm the information in this form is correct.' }
  return { field: f, values }
}

/**
 * The expression (the label formula language) for a PDF calculation, given
 * the field key of each PDF field name; null when an operand isn't on this
 * form (another part, or not a field) — the field then stays an input with a note.
 */
export function calcExpression(calc: NonNullable<PdfItem['calc']>, keyOf: (pdfName: string) => string | undefined): string | null {
  const refs = calc.fields.map((name) => keyOf(name))
  if (!refs.length || refs.some((k) => !k)) return null
  const ref = (k: string) => `{{form.${k}}}`
  const args = (refs as string[]).map(ref)
  switch (calc.op) {
    case 'SUM': return `SUM(${args.join(', ')})`
    case 'AVG': return `AVG(${args.join(', ')})`
    case 'MIN': return `MIN(${args.join(', ')})`
    case 'MAX': return `MAX(${args.join(', ')})`
    // Arithmetic is wrapped in ( ): the engine reads a formula that starts with a function call as that call only.
    case 'PRD': return `(${args.map((a) => `COALESCE(${a}, 0)`).join(' * ')})`
    case 'EXPR': {
      if (!calc.expr) return null
      const out = calc.expr.replace(/\$(\d+)/g, (_m, i: string) => (args[Number(i)] ? `COALESCE(${args[Number(i)]}, 0)` : '$'))
      return out.includes('$') ? null : `(${out})`
    }
    default: return null
  }
}

/**
 * Calculated PDF fields become calculated (Label) fields: the formula is
 * recomputed in the browser and again by the server, and stored with the
 * submission. Text operands become number fields (a calculation adds numbers).
 */
function applyCalculations(items: PdfItem[], keys: Record<string, string>, fields: TaskFieldDef[], skip: ReadonlySet<string> = new Set()) {
  const byName = new Map<string, string>()
  for (const item of items) {
    // Boxes of a table (now one repeating list) are not form fields of their own.
    if (skip.has(item.id)) continue
    const key = keys[item.id]
    for (const name of [item.id, ...item.sourceFields]) {
      if (!byName.has(name)) byName.set(name, key)
      const short = name.split('.').pop()
      if (short && !byName.has(short)) byName.set(short, key)
    }
  }
  const field = (key: string) => fields.find((f) => f.key === key)
  for (const item of items) {
    if (!item.calc || skip.has(item.id)) continue
    const target = field(keys[item.id])
    if (!target) continue
    const expression = calcExpression(item.calc, (name) => byName.get(name) ?? byName.get(name.split('.').pop() ?? name))
    if (!expression || expression.length > 1000 || expression.includes(`{{form.${target.key}}}`)) {
      target.help_text = [target.help_text, `Calculated in the PDF (${item.calc.op === 'EXPR' ? item.calc.expr : `${item.calc.op} of ${item.calc.fields.join(', ')}`}): some of its fields aren't on this form, so rebuild it as a Label expression.`].filter(Boolean).join(' ').slice(0, 1000)
      continue
    }
    const currency = target.type === 'currency' ? target.currency ?? 'USD' : undefined
    for (const name of item.calc.fields) {
      const operand = field(byName.get(name) ?? byName.get(name.split('.').pop() ?? name) ?? '')
      if (operand && operand.type === 'text' && !operand.pattern) { operand.type = 'number'; delete operand.max_length }
    }
    target.type = 'label'
    target.label_config = { expression, include: true, format: currency ? { kind: 'currency', currency } : { kind: 'number' } }
    delete target.read_only
    delete target.required
    delete target.currency
    delete target.max_length
    delete target.pattern
    delete target.pattern_message
  }
}

/** Split pages into parts of ≤ 200 fields and ≤ 20 pages (display elements count as fields). */
function partsOf(model: PdfFormModel, absorbed: ReadonlySet<string> = new Set(), extra: ReadonlyMap<number, number> = new Map()): number[][] {
  const perPage = new Map<number, number>()
  for (const i of model.items) if (!absorbed.has(i.id)) perPage.set(i.page, (perPage.get(i.page) ?? 0) + 1)
  for (const [p, n] of extra) if (perPage.has(p)) perPage.set(p, perPage.get(p)! + n)
  const pages = [...perPage.keys()].sort((a, b) => a - b)
  const parts: number[][] = []
  let cur: number[] = []
  let count = 0
  for (const p of pages) {
    const n = perPage.get(p)!
    if (cur.length && (count + n > PDF_FORM_LIMITS.fields || cur.length >= PDF_FORM_LIMITS.pages)) { parts.push(cur); cur = []; count = 0 }
    cur.push(p)
    count += n
  }
  if (cur.length) parts.push(cur)
  return parts.length ? parts : [[1]]
}

/** A table's controls in rows of at most 4 (6 columns → 3 + 3). */
function innerRows(keys: string[]): FormRow[] {
  const perRow = keys.length <= 4 ? keys.length : Math.ceil(keys.length / Math.ceil(keys.length / 4))
  const rows: FormRow[] = []
  for (let i = 0; i < keys.length; i += perRow) {
    const chunk = keys.slice(i, i + perRow)
    rows.push({ columns: chunk.length, cells: chunk.map((k) => ({ field_key: k, span: 1 })) })
  }
  return rows
}

export function buildForms(input: PdfFormModel, options: BuildOptions): BuildResult {
  const style = options.styling && options.style && (options.style.images || options.style.theme || options.style.text) ? options.style : null
  const plan = style && options.styling ? planStyling(input, options.styling, style) : null
  const model = plan ? plan.model : input
  const convert = tablesToConvert(model, options)
  // Every box of a converted table, and the item each table is placed at (its first box in reading order).
  const tableOf = new Map<string, PdfTable>()
  for (const t of convert) for (const id of t.itemIds) tableOf.set(id, t)
  const anchorOf = new Map<string, PdfTable>()
  for (const t of convert) { const first = model.items.find((i) => tableOf.get(i.id) === t); if (first) anchorOf.set(first.id, t) }
  const absorbed = new Set([...tableOf.keys()].filter((id) => !anchorOf.has(id)))
  const totalOf = new Map<string, { table: PdfTable; column: number }>()
  for (const t of convert) for (const x of t.totals) totalOf.set(x.item, { table: t, column: x.column })
  // Display elements: each on a page that has fields (else the nearest page before it), counted towards that page.
  const itemPages = [...new Set(model.items.filter((i) => !absorbed.has(i.id)).map((i) => i.page))].sort((a, b) => a - b)
  const placedEls: StyleElement[] = (plan?.elements ?? []).map((el) => {
    if (!itemPages.length || itemPages.includes(el.page)) return el
    const before = itemPages.filter((p) => p < el.page).pop()
    return before !== undefined ? { ...el, page: before, top: -Infinity } : { ...el, page: itemPages[0], top: Infinity }
  })
  const elsPerPage = new Map<number, number>()
  for (const el of placedEls) elsPerPage.set(el.page, (elsPerPage.get(el.page) ?? 0) + 1)
  const parts = partsOf(model, absorbed, elsPerPage)
  const dropped: BuildResult['dropped'] = []
  const remapped: BuildResult['remapped'] = []
  const baseName = clip((options.name || model.title || 'Imported PDF form').trim(), 100)
  const forms: BuiltForm[] = []
  const placed = new Set<string>()
  parts.forEach((pages, partIndex) => {
    const items = model.items.filter((i) => pages.includes(i.page) && !absorbed.has(i.id)).slice(0, PDF_FORM_LIMITS.fields)
    const keys: Record<string, string> = {}
    const valueMaps = new Map<string, Map<string, string>>()
    const fields: TaskFieldDef[] = []
    const taken = new Set<string>()
    const builtTables: BuiltTable[] = []
    /** Box item id → [section key, inner key] (rules aimed at a box). */
    const innerOf = new Map<string, [string, string]>()
    const byId = new Map(model.items.map((i) => [i.id, i]))
    for (const item of items) {
      const table = anchorOf.get(item.id)
      if (table) {
        const key = uniqueFieldKey(table.name || 'rows', taken)
        taken.add(key)
        const innerKey = (label: string) => {
          let k = uniqueFieldKey(label, taken)
          if (ITEM_SCOPE_NAMES.has(k)) k = uniqueFieldKey(`${k}_value`, taken)
          taken.add(k)
          return k
        }
        const inner: TaskFieldDef[] = []
        const columns: BuiltTable['columns'] = []
        if (table.rowLabelMode === 'category' && table.rowLabels?.length) {
          const label = table.rowLabelHeader || (table.noun ?? 'Item')
          const k = innerKey(label)
          const options = [...new Set(table.rowLabels.map((l) => l.trim()).filter(Boolean))].slice(0, 200)
          inner.push({ key: k, label: clip(label, 200), type: 'choice', options, display: 'dropdown', required: true })
          columns.push({ key: k, label })
        }
        table.columns.forEach((col) => {
          const template = byId.get(col.template)
          if (!template) return
          const k = innerKey(col.label)
          const { field } = fieldOf({ ...template, type: col.type, label: col.label, help: col.help, required: col.required, readOnly: template.readOnly && !template.calc }, k)
          if (col.type === 'number' && field.max_length) delete field.max_length
          inner.push(field)
          columns.push({ key: k, label: col.label })
          for (const id of col.cells) if (id) innerOf.set(id, [key, k])
        })
        const unlimited = options.tableRows === 'unlimited'
        const maxItems = unlimited ? REPEATING_LIMITS.items : table.maxRows === null ? REPEATING_LIMITS.defaultMaxItems : Math.min(REPEATING_LIMITS.items, Math.max(1, table.maxRows))
        const noun = table.noun?.trim()
        const config: RepeatingSectionConfig = {
          fields: inner,
          layout: { rows: innerRows(inner.map((f) => f.key)) },
          max_items: maxItems,
          start_items: 1,
          ...(noun ? { item_title: `${noun} {{index}}`, add_label: `Add ${noun.toLowerCase()}` } : {}),
        }
        const field: TaskFieldDef = {
          key, label: clip(table.name || 'Rows', 200), type: 'repeating_section', repeating_section: config,
          help_text: clip(`A table of ${table.rows} row${table.rows === 1 ? '' : 's'} in the PDF${table.pages.length > 1 ? ` (pages ${table.pages.join(', ')})` : ''}: add a row for each one you need.`, 1000),
        }
        fields.push(field)
        for (const id of table.itemIds) keys[id] = key
        builtTables.push({ id: table.id, key, name: table.name, columns, maxItems, totals: [] })
        continue
      }
      const key = uniqueFieldKey(item.label || item.id, taken)
      taken.add(key)
      keys[item.id] = key
      const { field, values } = fieldOf(item, key)
      const labelStyle = plan?.labelStyles[item.id]
      if (labelStyle) field.text_style = labelStyle
      valueMaps.set(item.id, values)
      fields.push(field)
    }
    // Display elements of this part's pages: keys, and a size / count budget.
    const partEls = placedEls.filter((el) => pages.includes(el.page)).sort((a, b) => a.page - b.page || b.top - a.top)
    const elKey = new Map<string, string>()
    let chars = 0
    const display = { headings: 0, texts: 0, dividers: 0, images: 0 }
    for (const el of partEls) {
      if (fields.length >= PDF_FORM_LIMITS.fields) break
      if (el.chars && chars + el.chars > STYLE_TEXT_BUDGET) continue
      chars += el.chars
      const key = uniqueFieldKey(el.keyHint, taken)
      taken.add(key)
      elKey.set(el.id, key)
      fields.push({ ...el.field, key } as TaskFieldDef)
      display[el.kind === 'heading' ? 'headings' : el.kind === 'text' ? 'texts' : el.kind === 'divider' ? 'dividers' : 'images']++
    }
    const lastPage = pages[pages.length - 1]
    // A footer kept once goes at the end of the last part.
    if (partIndex === parts.length - 1) {
      for (const el of plan?.elements ?? []) {
        if (el.page !== Number.MAX_SAFE_INTEGER || elKey.has(el.id) || fields.length >= PDF_FORM_LIMITS.fields) continue
        const key = uniqueFieldKey(el.keyHint, taken)
        taken.add(key)
        elKey.set(el.id, key)
        fields.push({ ...el.field, key } as TaskFieldDef)
        partEls.push({ ...el, page: lastPage, top: -Infinity })
        display.texts++
      }
    }
    const els = partEls.filter((el) => elKey.has(el.id))
    // A PDF total over a table's column: a calculated field adding up the list's column.
    const totalIds = new Set<string>()
    for (const item of items) {
      const total = totalOf.get(item.id)
      const built = total && builtTables.find((b) => b.id === total.table.id)
      const target = fields.find((f) => f.key === keys[item.id])
      if (!total || !built || !target) continue
      const inner = innerOf.get(total.table.columns[total.column].cells.find(Boolean) ?? '')
      if (!inner) continue
      const section = fields.find((f) => f.key === built.key)
      const innerField = section?.repeating_section?.fields.find((f) => f.key === inner[1])
      if (innerField && innerField.type === 'text') { innerField.type = 'number'; delete innerField.max_length }
      const currency = innerField?.type === 'currency' ? innerField.currency ?? 'USD' : target.type === 'currency' ? target.currency ?? 'USD' : undefined
      target.type = 'label'
      target.label_config = { expression: `SUM({{form.${built.key}}}, "${inner[1]}")`, include: true, format: currency ? { kind: 'currency', currency } : { kind: 'number' } }
      for (const k of ['read_only', 'required', 'currency', 'max_length', 'pattern', 'pattern_message'] as const) delete target[k]
      built.totals.push({ item: item.id, key: target.key })
      totalIds.add(item.id)
    }
    applyCalculations(items, keys, fields, new Set([...tableOf.keys(), ...totalIds]))
    // Sections used in this part.
    const sectionKeys = new Map<string, string>()
    const sections: FormSection[] = []
    for (const s of model.sections) {
      if (!items.some((i) => i.section === s.id)) continue
      const key = uniqueFieldKey(`section_${s.title || s.id}`, [...taken, ...sectionKeys.values()])
      sectionKeys.set(s.id, key)
      sections.push({ key, title: clip(s.title, 120), ...(s.repeats ? { description: 'Repeats in the PDF: imported once.' } : {}), ...(plan?.sectionStyles[s.id] === 'plain' ? { style: 'plain' as const } : {}) })
    }
    // Rows: boxes on one printed row side by side (up to 3), otherwise one per row.
    const rowsOf = (list: PdfItem[]): FormRow[] => {
      const rows: FormRow[] = []
      let i = 0
      while (i < list.length) {
        const head = list[i]
        const group = [head]
        while (group.length < 3 && i + group.length < list.length) {
          const next = list[i + group.length]
          const a = head.rect
          const b = next.rect
          if (!a || !b || next.page !== head.page || next.section !== head.section || Math.abs((a[1] + a[3]) / 2 - (b[1] + b[3]) / 2) > 4) break
          if (anchorOf.has(head.id) || anchorOf.has(next.id)) break
          if (['textarea', 'multi_choice', 'signature'].includes(next.type) || ['textarea', 'multi_choice', 'signature'].includes(head.type)) break
          if ((next.options?.length ?? 0) > 3 || (head.options?.length ?? 0) > 3) break
          group.push(next)
        }
        rows.push({ columns: group.length, cells: group.map((g) => ({ field_key: keys[g.id], span: 1 })), ...(head.section && sectionKeys.has(head.section) ? { section: sectionKeys.get(head.section) } : {}) })
        i += group.length
      }
      return rows
    }
    /** Fields and display elements in the PDF's order (elements slot in above the first field below them). */
    const withElements = (list: PdfItem[]): FormRow[] => {
      const onPages = new Set(list.map((i) => i.page))
      const pending = els.filter((el) => onPages.has(el.page))
      if (!pending.length) return rowsOf(list)
      const seq: Array<PdfItem | StyleElement> = []
      let e = 0
      for (const item of list) {
        while (e < pending.length && (pending[e].page < item.page || (pending[e].page === item.page && (item.rect ? pending[e].top >= item.rect[3] : pending[e].top > -Infinity)))) seq.push(pending[e++])
        seq.push(item)
      }
      while (e < pending.length) seq.push(pending[e++])
      const rows: FormRow[] = []
      let run: PdfItem[] = []
      const isEl = (x: PdfItem | StyleElement): x is StyleElement => 'keyHint' in x
      seq.forEach((x, idx) => {
        if (!isEl(x)) { run.push(x); return }
        if (run.length) { rows.push(...rowsOf(run)); run = [] }
        // Its section: the one around it (the fields before and after), else the one it heads, else the one it follows.
        const prev = seq.slice(0, idx).reverse().find((y): y is PdfItem => !isEl(y) && y.page === x.page)
        const next = seq.slice(idx + 1).find((y): y is PdfItem => !isEl(y) && y.page === x.page)
        const heads = next?.section !== undefined && plan?.sectionTops[next.section] !== undefined && plan.sectionTops[next.section] >= x.top
        const sec = prev?.section && prev.section === next?.section ? prev.section : heads || (next?.section && !prev) ? next!.section : prev?.section
        const sk = sec ? sectionKeys.get(sec) : undefined
        rows.push({ columns: 1, cells: [{ field_key: elKey.get(x.id)!, span: 1 }], ...(sk ? { section: sk } : {}) })
      })
      if (run.length) rows.push(...rowsOf(run))
      return rows
    }
    const steps = (options.pages ?? 'steps') === 'steps' && pages.length > 1
    const layout: FormLayout = { rows: [] }
    if (steps) {
      const formPages: FormPage[] = pages.map((p, n) => {
        const onPage = items.filter((i) => i.page === p)
        const firstSection = model.sections.find((s) => s.id === onPage[0]?.section)
        return { id: `page_${n + 1}`, title: clip(firstSection && model.sections.filter((s) => onPage.some((i) => i.section === s.id)).length === 1 ? firstSection.title : `Page ${p}`, 80), rows: withElements(onPage) }
      }).filter((pg) => pg.rows.length)
      layout.mode = 'steps'
      layout.pages = formPages
    } else {
      layout.rows = withElements(items)
    }
    if (sections.length) layout.sections = sections
    // Rules.
    const target = (t: string): string | null => {
      if (t.startsWith('section:')) { const k = sectionKeys.get(t.slice(8)); return k ? `section:${k}` : null }
      // A box of a table: the list's column in every row.
      const inner = innerOf.get(t)
      if (inner) return `column:${inner[0]}.${inner[1]}`
      return keys[t] ? `field:${keys[t]}` : null
    }
    const cond = (c: PdfCondition): DataTableCondition | null => {
      if (tableOf.has(c.item)) return null
      const key = keys[c.item]
      if (!key) return null
      const value = c.value === undefined ? undefined : (valueMaps.get(c.item)?.get(c.value) ?? c.value)
      const operator = c.op === 'equals' ? 'eq' : c.op === 'not_equals' ? 'neq' : c.op
      return { column: key, operator, ...(value !== undefined && (operator === 'eq' || operator === 'neq') ? { value } : {}) } as DataTableCondition
    }
    const rules: FormRule[] = []
    const ordered = [...model.rules].sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1))
    for (const r of ordered) {
      const relevant = r.targets.some((t) => target(t)) || (r.when && keys[r.when.item]) || (!r.targets.length && !r.when && parts.length === 1)
      if (!relevant) continue
      const mapped = r.targets.map(target)
      const targets = [...new Set(mapped.filter((t): t is string => Boolean(t)))]
      const conds = [r.when, ...(r.any ?? [])].filter((c): c is PdfCondition => Boolean(c)).map(cond)
      const complete = conds.length > 0 && conds.every(Boolean) && mapped.every(Boolean) && targets.length > 0
      // Rules touching a table's boxes: a condition on a box can't be read any more; targets become the list's columns.
      const tableName = (id: string) => model.tables?.find((t) => tableOf.get(id) === t)?.name ?? 'a table'
      const condBox = [r.when, ...(r.any ?? [])].find((c) => c && tableOf.has(c.item))
      const boxTargets = r.targets.filter((t) => innerOf.has(t))
      // Every box of a column must be a target, or showing / hiding the whole column changes what the rule does.
      const partialColumn = boxTargets.length > 0 && convert.some((t) => t.columns.some((col) => {
        const cells = col.cells.filter((c): c is string => Boolean(c))
        const hit = cells.filter((c) => boxTargets.includes(c)).length
        return hit > 0 && hit < cells.length
      }))
      let tableWhy: string | null = null
      if (condBox) tableWhy = `its condition reads a box that is now part of the repeating list "${tableName(condBox.item)}": rebuild it as a rule inside the list`
      else if (partialColumn) tableWhy = `it shows / hides single boxes of the table "${tableName(boxTargets[0])}", now a repeating list: rebuild it inside the list`
      if (r.confidence === 'high' && tableWhy) dropped.push({ rule: r, why: tableWhy })
      else if (r.confidence === 'high' && !complete) {
        dropped.push({ rule: r, why: 'its question and targets are in different parts of the form: kept turned off' })
      } else if (boxTargets.length) remapped.push({ rule: r, note: `its targets were boxes of the table "${tableName(boxTargets[0])}": it now shows / hides the list's column${targets.filter((t) => t.startsWith('column:')).length === 1 ? '' : 's'} in every row` })
      const enabled = r.confidence === 'high' && complete && !tableWhy
      if (rules.length >= PDF_FORM_LIMITS.rules) { dropped.push({ rule: r, why: `over the ${PDF_FORM_LIMITS.rules} rules a form holds` }); continue }
      const ai = r.origin === 'ai'
      const what = r.source === 'printed_text' ? 'printed instruction' : r.source === 'acrobat_js' ? 'Acrobat script' : r.source === 'xfa_script' ? 'XFA script' : 'AI assist'
      const name = clip(`${ai ? 'AI: ' : ''}${r.mode === 'show' ? 'Show' : 'Hide'}${targets.length ? ` ${targets.length} field${targets.length === 1 ? '' : 's'}` : ''} — ${r.original.replace(/\s+/g, ' ')}`, FORM_RULE_LIMITS.name)
      const description = clip([
        enabled ? `From the PDF's ${what}.` : `Turned off: ${tableWhy ?? r.reason ?? 'check the condition and targets'}.`,
        ai ? 'Suggested by the AI assist — review it.' : '',
        `Original: ${r.original}`,
      ].filter(Boolean).join('\n'), FORM_RULE_LIMITS.description)
      const validConds = conds.filter((c): c is DataTableCondition => Boolean(c))
      const then: FieldButtonAction[] = targets.length
        ? [{ type: 'show_hide', mode: r.mode, targets } as FieldButtonAction]
        : [{ type: 'message', text: clip(`TODO (from the PDF): ${r.original}`, 500), tone: 'warning' } as unknown as FieldButtonAction]
      rules.push({
        id: newRuleId(rules.map((x) => x.id)), name, description, event: 'always',
        ...(validConds.length ? { if: { match: validConds.length > 1 ? 'any' : 'all', conditions: validConds } } : {}),
        then, ...(enabled ? {} : { disabled: true }),
      })
      placed.add(r.id)
    }
    if (rules.length) layout.rules = rules
    // Items that start hidden without a rule showing them.
    const shown = new Set(rules.filter((r) => !r.disabled).flatMap((r) => r.then.flatMap((a) => ((a as { targets?: string[] }).targets ?? []))))
    const hidden = items.filter((i) => i.hidden && !tableOf.has(i.id) && !shown.has(`field:${keys[i.id]}`)).map((i) => `field:${keys[i.id]}`)
    const hiddenSections = model.sections.filter((s) => s.hidden && sectionKeys.has(s.id) && !shown.has(`section:${sectionKeys.get(s.id)}`)).map((s) => `section:${sectionKeys.get(s.id)}`)
    if (hidden.length || hiddenSections.length) layout.state = { hidden: [...hidden, ...hiddenSections] }
    layout.source = { kind: 'pdf', file_name: options.fileName, hash: options.hash, imported_at: new Date().toISOString(), ...(parts.length > 1 ? { part: partIndex + 1 } : {}) } as unknown as FormLayout['source']
    const name = parts.length > 1 ? `${baseName} (part ${partIndex + 1} of ${parts.length})` : baseName
    forms.push({
      name, tags: ['pdf'],
      description: clip(`Imported from the PDF form "${options.fileName}"${parts.length > 1 ? `, pages ${pages[0]}–${pages[pages.length - 1]}` : ''}.`, 2000),
      fields, layout, keys, pages, tables: builtTables,
      ...(plan?.header ? { header: plan.header } : {}),
      ...(plan?.theme ? { theme: plan.theme } : {}),
      ...(plan ? { display } : {}),
      counts: { fields: fields.length - elKey.size, rules: rules.length, disabled_rules: rules.filter((r) => r.disabled).length, ai: items.filter((i) => i.origin === 'ai').length + model.rules.filter((r) => r.origin === 'ai' && placed.has(r.id)).length },
    })
  })
  return { forms, dropped, remapped, converted: convert.map((t) => t.id), ...(plan ? { styling: { log: plan.log, counts: plan.counts, header: plan.header, theme: plan.theme } } : {}) }
}
