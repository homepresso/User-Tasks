/**
 * The InfoPath generator: the analyzer's model (lib/infopath/model.ts) →
 * UserTasks reusable forms (FormInput for lib/services/forms createForm) and
 * a mapping report.
 *
 *   per_view (default)  one form per InfoPath view, "<Form> — <View>"
 *   combined            one form, each view a step (switch view → go to step)
 *
 * Field keys come from the data source (the same node has the same key in
 * every form made from the file), so workflows and data tables line up.
 *
 * Controls → fields: text / long text (rich text) / number / currency /
 * date / date & time / time (text + HH:MM pattern) / choice (drop-down, radio)
 * / multi-select / yes-no / attachments / person / URL / Label (expression
 * boxes, calculated values) / Button. Repeating tables and repeating sections
 * → a List (editable table) with a column per child control. Sections →
 * sections; optional sections → optional sections; nested sections are
 * flattened into their outer section (UserTasks nests one level).
 *
 * Behaviour → form rules (lib/forms/form-rules.ts):
 *   conditional formatting hide / disable   Always: hide / make read only while …
 *     …on a repeating table's cell           List cell rule (per row), or a whole-column
 *                                            hide (column:<list>.<column>) on a form condition
 *   inline fonts, sizes, colours             field / List column text_style (the view's
 *                                            usual font and size left to the theme)
 *   xsl:if around a section                  Always: hide the section while not …
 *   custom validation                        Always: field error while …
 *   "cannot be blank"                        required
 *   rules on a field / button / form load    value change / button click / form load
 *     set a field's value                    set values ({{= … }} formulas)
 *     show a message                         message
 *     switch view                            go to step (combined) — otherwise a note
 *     query / submit a data connection       table list / API reference when one matches,
 *                                            else a disabled step with a TODO note
 *   calculated values                        Label with an expression (recalculated),
 *                                            or a form-load rule (once, on open)
 * Anything that can't be translated is kept as a DISABLED rule whose notes
 * hold the original XPath, and is listed in the report — never dropped.
 */

import { fieldKeyFromLabel, uniqueFieldKey, RESERVED_FIELD_KEYS, type TaskFieldDef } from '@/lib/task-field-schema'
import { compileUserRegex } from '@/lib/safe-regex'
import { FORM_RULE_LIMITS, newRuleId, type FormRule } from '@/lib/forms/form-rules'
import type { FieldButtonAction } from '@/lib/forms/field-buttons'
import type { FormLayout, FormPage, FormRow, FormSection } from '@/lib/forms/layout'
import type { ListColumn, ListColumnType, ListFieldConfig } from '@/lib/forms/list-field'
import type { DataTableConditionGroup } from '@/lib/forms/data-table'
import type { FormSourceInfo } from '@/lib/forms/form-source'
import { walkControls } from './analyze'
import { schemaNodes } from './schema'
import { humanize } from './view'
import { expressionPaths, localOf, resolveBinding, toCondition, toExpression, type Ref, type TranslateEnv } from './xpath'
import type { CellFormat } from '@/lib/formatting/cell-format'
import { colorFromCss, fontFromCss, normalizeTextStyle, sizeFromCss, textFontGoogleFamily, textFontLabel, type ControlTextStyle, type TextStyle } from '@/lib/forms/text-style'
import type { IpTextStyle } from './model'
import type { InfoPathModel, IpControl, IpDataConnection, IpRule, IpRuleAction, IpSchemaNode, IpView, IpViewItem } from './model'

/* ── Options and output ───────────────────────────────────────────────── */

export type ImportMode = 'per_view' | 'combined'

export interface GenerateOptions {
  mode?: ImportMode
  /** Views to convert (names); default all that are shown in InfoPath's View menu (hidden print views too when listed). */
  views?: string[]
  /** Combined mode: the views as steps (default) or as tabs. */
  pages?: 'steps' | 'tabs'
  /** Base name (default the form's title / file name). */
  name?: string
  /** Extra tag (the form name, lower-cased, is always added, with "infopath"). */
  tag?: string
  /** Data connections that match an existing UserTasks object: connection name → { table_id } | { reference_id, integration_id }. */
  connections?: Record<string, { table_id?: string; table_name?: string; reference_id?: string; integration_id?: string }>
  /** ISO date for the provenance stamp (tests pass a fixed one). */
  now?: string
  /** Currency for currency-formatted fields (InfoPath stores the locale, not the code). */
  currency?: string
}

export type ReportStatus = 'converted' | 'partial' | 'manual' | 'skipped'
export type ReportArea = 'view' | 'field' | 'repeating' | 'rule' | 'formatting' | 'validation' | 'calculation' | 'connection' | 'button' | 'role' | 'code' | 'submit' | 'limit'

export interface ReportItem {
  area: ReportArea
  /** Stable id of the InfoPath item (rule set + index, control id, path…). */
  id: string
  name: string
  status: ReportStatus
  /** What it became / why it did not convert. */
  detail: string
  view?: string
  /** The original expression (XPath) when relevant. */
  original?: string
}

export interface GeneratedForm {
  /** The view (per_view) or null (combined). */
  view: string | null
  name: string
  input: {
    name: string
    description: string
    tags: string[]
    fields: TaskFieldDef[]
    layout: FormLayout
  }
  counts: { fields: number; lists: number; rules: number; disabled_rules: number }
}

export interface ImportSummary {
  views: number
  forms: number
  fields: number
  repeating: number
  rules: { total: number; converted: number; partial: number; manual: number }
  validations: { total: number; converted: number; manual: number }
  calculations: { total: number; converted: number; manual: number }
  formatting: { total: number; converted: number; manual: number }
  connections: number
}

export interface ImportReport {
  form: { name: string; file_name: string; hash: string; format: string; views: Array<{ name: string; caption: string; hidden: boolean; default: boolean; controls: number }>; browser_enabled: boolean }
  summary: ImportSummary
  items: ReportItem[]
  warnings: string[]
}

export interface GenerateResult {
  forms: GeneratedForm[]
  report: ImportReport
}

/* ── Keys ─────────────────────────────────────────────────────────────── */

const GENERIC_LEAF = /^(group|field|section|table|repeating)\d*$/i

/** Path (lower-case) → field key, shared by every form made from one file. */
class KeyMap {
  private keys = new Map<string, string>()
  private taken = new Set<string>(RESERVED_FIELD_KEYS)
  private columns = new Map<string, Map<string, string>>()
  private columnTaken = new Map<string, Set<string>>()
  key(path: string, label?: string, preferLabel = false): string {
    const k = path.toLowerCase()
    const existing = this.keys.get(k)
    if (existing) return existing
    const leaf = localOf(path.split('/').filter(Boolean).pop() ?? 'field').replace(/^@/, '')
    const base = (GENERIC_LEAF.test(leaf) || preferLabel) && label ? label : leaf.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    const key = uniqueFieldKey(fieldKeyFromLabel(base).slice(0, 48) || 'field', this.taken)
    this.taken.add(key)
    this.keys.set(k, key)
    return key
  }
  has(path: string) { return this.keys.has(path.toLowerCase()) }
  /** A key not tied to a path (headings, labels, duplicates). */
  extra(base: string): string {
    const key = uniqueFieldKey(fieldKeyFromLabel(base).slice(0, 48) || 'item', this.taken)
    this.taken.add(key)
    return key
  }
  column(list: string, path: string, label?: string): string {
    const cols = this.columns.get(list) ?? new Map<string, string>()
    this.columns.set(list, cols)
    const taken = this.columnTaken.get(list) ?? new Set<string>()
    this.columnTaken.set(list, taken)
    const k = path.toLowerCase()
    if (cols.has(k)) return cols.get(k)!
    const leaf = localOf(path.split('/').filter(Boolean).pop() ?? 'column').replace(/^@/, '')
    const base = GENERIC_LEAF.test(leaf) && label ? label : leaf.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    let key = fieldKeyFromLabel(base).slice(0, 48) || 'column'
    if (!/^[a-z]/.test(key)) key = `c_${key}`
    for (let i = 2; taken.has(key); i++) key = `${fieldKeyFromLabel(base).slice(0, 44) || 'column'}_${i}`
    taken.add(key)
    cols.set(k, key)
    return key
  }
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const cleanLabel = (s: string | undefined) => clip((s ?? '').replace(/\s+/g, ' ').replace(/[<>]/g, '').replace(/:\s*$/, '').trim(), 200)

const NUMERIC = new Set(['integer', 'decimal', 'double'])
const TIME_PATTERN = '^([01]?\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$'

/** An XSD pattern (implicitly anchored) → a safe JS pattern, or null. */
function xsdPattern(p: string): string | null {
  // XSD character class escapes that JS lacks.
  const js = p.replace(/\\i/g, '[A-Za-z_:]').replace(/\\c/g, '[\\w.:-]').replace(/\\p\{[^}]+\}/g, '\\w')
  const anchored = `^(?:${js})$`
  try { compileUserRegex(anchored); return anchored } catch { return null }
}

/** not(X) → X; else not(X). */
export function negateText(test: string): string {
  const m = /^\s*not\(([\s\S]*)\)\s*$/.exec(test)
  if (m) {
    let depth = 0
    for (const ch of m[1]) { if (ch === '(') depth++; else if (ch === ')') { depth--; if (depth < 0) return `not(${test})` } }
    if (depth === 0) return m[1].trim()
  }
  return `not(${test})`
}

/** The tone a CSS colour is closest to (theme tones, never raw colours). */
function toneOf(css: string): { tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent'; hex: string } | null {
  const named: Record<string, string> = { red: '#ff0000', green: '#008000', blue: '#0000ff', orange: '#ffa500', yellow: '#ffff00', purple: '#800080', gray: '#808080', grey: '#808080', black: '#000000', white: '#ffffff', maroon: '#800000', navy: '#000080', teal: '#008080', olive: '#808000', lime: '#00ff00', fuchsia: '#ff00ff', silver: '#c0c0c0' }
  let hex = css.trim().toLowerCase()
  if (named[hex]) hex = named[hex]
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(hex)
  if (rgb) hex = `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
  if (/^#[0-9a-f]{3}$/.test(hex)) hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  if (!/^#[0-9a-f]{6}$/.test(hex)) return null
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, bl = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, bl), min = Math.min(r, g, bl), d = max - min
  if (d < 0.12) return { tone: 'neutral', hex }
  let h = max === r ? ((g - bl) / d) % 6 : max === g ? (bl - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 360) % 360
  const tone = h < 20 || h >= 330 ? 'danger' : h < 65 ? 'warning' : h < 170 ? 'success' : h < 255 ? 'info' : 'accent'
  return { tone, hex }
}

/** InfoPath conditional formatting CSS → set_style tokens (null when nothing maps); a note when a colour was snapped to a tone. */
export function styleFromCss(css: string): { style: Record<string, unknown>; note?: string } | null {
  const decl = new Map<string, string>()
  for (const part of css.split(';')) {
    const i = part.indexOf(':')
    if (i > 0) decl.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim().toLowerCase())
  }
  const style: Record<string, unknown> = {}
  const notes: string[] = []
  const color = decl.get('color')
  const bg = decl.get('background-color') ?? decl.get('background')
  const ct = color ? toneOf(color) : null
  const bt = bg ? toneOf(bg) : null
  if (ct && ct.hex === '#ffffff' && !bt) {
    // White text on the white form: InfoPath's way of hiding a value. Shown muted instead.
    style.tone = 'neutral'
    style.text = true
    notes.push('white text (a hidden value in InfoPath) shown muted — make it a hide rule if it should disappear')
  } else {
    if (ct) { style.tone = ct.tone; style.text = true; if (ct.tone !== 'neutral') notes.push(`text colour ${ct.hex} → ${ct.tone} tone`) }
    if (bt && bt.hex !== '#ffffff') { style.tone = style.tone ?? bt.tone; style.background = true; notes.push(`shading ${bt.hex} → ${bt.tone} tint`) }
  }
  const weight = decl.get('font-weight')
  if (weight && (weight === 'bold' || Number(weight) >= 600)) style.bold = true
  if (decl.get('font-style') === 'italic') style.italic = true
  const deco = `${decl.get('text-decoration') ?? ''}`
  if (deco.includes('underline')) style.underline = true
  if (deco.includes('line-through')) style.strike = true
  if (decl.get('border') || decl.get('border-color')) { style.border = true; style.tone = style.tone ?? (toneOf(decl.get('border-color') ?? '')?.tone ?? 'neutral') }
  if (style.tone && style.tone !== 'neutral') style.icon = true
  const size = decl.get('font-size') ? sizeFromCss(decl.get('font-size')!) : undefined
  if (size) style.size = size
  const font = decl.get('font-family') ? fontFromCss(decl.get('font-family')!) : undefined
  if (font) style.font = font
  if (!Object.keys(style).length) return null
  return { style, ...(notes.length ? { note: `${notes.join('; ')} (theme tones, not exact colours)` } : {}) }
}

/** A base64 image (template.xml picture defaults) → its type, or null. */
function imageFromBase64(text: string): { mime: string; ext: string; base64: string; size: number } | null {
  const clean = text.replace(/\s+/g, '')
  if (clean.length < 40 || clean.length > 700_000 || !/^[A-Za-z0-9+/]+=*$/.test(clean)) return null
  const head = Buffer.from(clean.slice(0, 24), 'base64')
  const mime = head[0] === 0x89 && head[1] === 0x50 ? 'image/png' : head[0] === 0xff && head[1] === 0xd8 ? 'image/jpeg' : head.subarray(0, 3).toString('latin1') === 'GIF' ? 'image/gif' : ''
  if (!mime) return null
  return { mime, ext: mime === 'image/jpeg' ? 'jpg' : mime.slice(6), base64: clean, size: Math.floor(clean.length * 3 / 4) }
}

function isSimpleLiteral(expr: string): string | null {
  const m = /^\s*(?:"([^"]*)"|'([^']*)'|(-?\d+(?:\.\d+)?))\s*$/.exec(expr)
  return m ? (m[1] ?? m[2] ?? m[3]) : null
}

/* ── Generator ────────────────────────────────────────────────────────── */

interface FormBuild {
  view: string | null
  fields: TaskFieldDef[]
  byKey: Map<string, TaskFieldDef>
  /** Path (lower-case) → key, for fields placed on this form. */
  placed: Map<string, string>
  /** Lists on this form: list path → key; the List config. */
  lists: Map<string, { key: string; config: ListFieldConfig; path: string; cols?: Map<string, string> }>
  rules: FormRule[]
  sections: FormSection[]
  hidden: string[]
  /** Fields a rule / formula reads that are not on the form: added hidden at the end. */
  support: Set<string>
  buttonKeys: Map<string, string>
  pages?: FormPage[]
  rows: FormRow[]
  /** Expression boxes, translated after the view is read. */
  pendingExpr: Array<() => void>
  /** Choice groups (InfoPath choice sections): one of several alternative sections shows. */
  choiceGroups: Array<{ key: string; label: string; sections: string[]; display?: 'radio' | 'tabs' | 'dropdown' }>
  /** A repeating section's item: its node (absolute path), nesting level and the form around it. */
  itemPath?: string
  depth?: number
  parent?: FormBuild
}

export function generateForms(model: InfoPathModel, options: GenerateOptions = {}): GenerateResult {
  const mode: ImportMode = options.mode ?? 'per_view'
  const now = options.now ?? new Date().toISOString()
  const currency = options.currency ?? 'USD'
  const baseName = cleanLabel(options.name || model.manifest.title || model.file_name.replace(/\.(xsn|zip)$/i, '')) || 'InfoPath form'
  const tags = [...new Set([fieldKeyFromLabel(baseName).replace(/_/g, '-').slice(0, 40), 'infopath', ...(options.tag ? [options.tag.trim().toLowerCase().slice(0, 40)] : [])].filter(Boolean))]
  const nodes = new Map(schemaNodes(model.schema).map((n) => [n.path.toLowerCase(), n]))
  const nodeOf = (path: string | undefined) => (path ? nodes.get(path.toLowerCase()) : undefined)
  const repeatingPaths = new Set([...model.manifest.repeating.map((p) => p.toLowerCase()), ...[...nodes.values()].filter((n) => n.repeating).map((n) => n.path.toLowerCase())])
  const keys = new KeyMap()
  const items: ReportItem[] = []
  const report = (item: ReportItem) => { items.push(item) }

  const selected = model.views.filter((v) => (options.views?.length ? options.views.includes(v.name) : true))
  const views = selected.length ? selected : model.views.slice(0, 1)

  // Pre-pass: keys in document order of the first view that shows each node (labels for generic names).
  for (const v of views) for (const c of walkControls(v.items)) if (c.path && !repeatingPaths.has(c.path.toLowerCase()) && !isInsideRepeating(c.path)) keys.key(c.path, c.label)
  // Then every other data node, so display-only items never take a data field's key.
  for (const n of nodes.values()) if (n.type !== 'group' && !n.repeating && !isInsideRepeating(n.path) && n.path.split('/').length > 2) keys.key(n.path)
  function isInsideRepeating(path: string): string | null {
    const parts = path.split('/')
    for (let i = parts.length - 1; i > 1; i--) {
      const p = parts.slice(0, i).join('/').toLowerCase()
      if (repeatingPaths.has(p)) return parts.slice(0, i).join('/')
    }
    return null
  }

  /* ── text styles (fonts, sizes, colours from the view) ── */

  // The view's usual font and size (InfoPath writes "Calibri 10pt" on nearly everything): not copied onto each field.
  const viewBase = new Map<string, { font?: string; size?: string }>()
  const styledCount = new Map<string, number>()
  // Per view: fonts mapped to a Google Fonts family, and fonts we have no match for (fall back to the theme font).
  const googleFontsOf = new Map<string, Set<string>>()
  const missingFontsOf = new Map<string, Set<string>>()
  const noteFont = (view: IpView, family: string, mapped: string | undefined) => {
    const g = mapped ? textFontGoogleFamily(mapped) : null
    const bucket = g ? googleFontsOf : !mapped ? missingFontsOf : null
    if (!bucket) return
    const name = g ?? family.split(',')[0].trim().replace(/^['"]|['"]$/g, '').slice(0, 60)
    if (!name) return
    if (!bucket.has(view.name)) bucket.set(view.name, new Set())
    bucket.get(view.name)!.add(name)
  }
  const baseOf = (view: IpView) => {
    let base = viewBase.get(view.name)
    if (base) return base
    const fonts = new Map<string, number>()
    const sizes = new Map<string, number>()
    const count = (raw?: IpTextStyle) => {
      const f = raw?.family ? fontFromCss(raw.family) : undefined
      const z = raw?.size ? sizeFromCss(raw.size) : undefined
      if (f) fonts.set(f, (fonts.get(f) ?? 0) + 1)
      if (z) sizes.set(z, (sizes.get(z) ?? 0) + 1)
    }
    const walk = (list: IpViewItem[]) => {
      for (const i of list) {
        if (i.kind === 'static') { count(i.style); continue }
        count(i.text_style); count(i.label_style)
        for (const h of i.header_styles ?? []) count(h)
        if (i.children) walk(i.children)
      }
    }
    walk(view.items)
    const mode = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    base = { font: mode(fonts), size: mode(sizes) }
    viewBase.set(view.name, base)
    return base
  }
  /** A view's raw styling → a TextStyle (the view's usual font / size and black text left out), or undefined. */
  const textStyleOf = (view: IpView, raw: IpTextStyle | undefined, opts: { heading?: boolean } = {}): TextStyle | undefined => {
    if (!raw) return undefined
    const base = baseOf(view)
    const out: Record<string, unknown> = {}
    const size = raw.size ? sizeFromCss(raw.size) : undefined
    if (size && size !== base.size && !opts.heading) out.size = size
    const font = raw.family ? fontFromCss(raw.family) : undefined
    if (raw.family) noteFont(view, raw.family, font)
    if (font && font !== base.font) out.font = font
    const color = raw.color ? colorFromCss(raw.color) : undefined
    if (color && color !== '#ffffff') out.color = color
    if (raw.bold && !opts.heading) out.bold = true
    if (raw.italic) out.italic = true
    if (raw.underline) out.underline = true
    return normalizeTextStyle(out)
  }
  const controlTextStyle = (view: IpView, value: IpTextStyle | undefined, label: IpTextStyle | undefined, opts: { heading?: boolean } = {}): ControlTextStyle | undefined => {
    const v = textStyleOf(view, value, opts)
    const l = textStyleOf(view, label)
    if (!v && !l) return undefined
    styledCount.set(view.name, (styledCount.get(view.name) ?? 0) + 1)
    return { ...(l ? { label: l } : {}), ...(v ? { value: v } : {}) }
  }
  const styleField = (view: IpView, f: { text_style?: ControlTextStyle; type: string }, value: IpTextStyle | undefined, label: IpTextStyle | undefined) => {
    const ts = controlTextStyle(view, value, label, { heading: f.type === 'heading' })
    if (ts) f.text_style = ts
  }

  /* ── fields ── */

  const fieldFor = (c: IpControl, key: string, build: FormBuild, view: IpView): TaskFieldDef | null => {
    const node = nodeOf(c.path)
    const label = cleanLabel(c.label || c.title || humanize(c.path)) || humanize(c.path) || 'Field'
    const base: TaskFieldDef = { key, label, type: 'text' }
    if (c.title && c.title !== label) base.help_text = clip(c.title, 300)
    if (c.placeholder && !/^select\.*$/i.test(c.placeholder)) base.placeholder = clip(c.placeholder, 100)
    const t = node?.type
    switch (c.kind) {
      case 'text': {
        const fmt = c.format ?? ''
        if ((t && NUMERIC.has(t)) || /number|currency|percentage/.test(fmt)) {
          base.type = /currency/.test(fmt) ? 'currency' : 'number'
          if (base.type === 'currency') base.currency = currency
        } else if (t === 'date' || /^date$/.test(fmt)) base.type = 'date'
        else if (t === 'dateTime') base.type = 'datetime'
        else if (t === 'time' || fmt === 'time') { base.type = 'text'; base.pattern = TIME_PATTERN; base.pattern_message = 'Enter a time as HH:MM'; base.placeholder ??= 'HH:MM' }
        else if (t === 'boolean') base.type = 'boolean'
        else if (t === 'anyURI') base.type = 'url'
        else if (t === 'xhtml') { base.type = 'rich_text'; (base as unknown as Record<string, unknown>).rich_text = { toolbar: 'basic' } }
        else if (/e-?mail/i.test(`${label} ${c.path ?? ''}`) && !node?.pattern) base.type = 'email'
        else if (/textarea/i.test(c.xctname)) base.type = 'textarea'
        break
      }
      case 'richtext': base.type = 'rich_text'; (base as unknown as Record<string, unknown>).rich_text = { toolbar: 'full' }; break
      case 'date': base.type = t === 'dateTime' ? 'datetime' : 'date'; break
      case 'datetime': base.type = 'datetime'; break
      case 'time': base.type = 'text'; base.pattern = TIME_PATTERN; base.pattern_message = 'Enter a time as HH:MM'; base.placeholder ??= 'HH:MM'; break
      case 'dropdown': case 'combobox': case 'listbox': case 'option': case 'multiselect': {
        const options = (c.options ?? []).filter((o) => o.value !== '')
        const fromSchema = node?.enumeration ?? []
        const opts = options.length ? options : fromSchema.map((v) => ({ value: v, label: v }))
        if (!opts.length) {
          const source = c.options_source ? connectionFromXPath(c.options_source) : null
          const match = source ? options_connections()[source] : undefined
          if (match?.table_id) {
            base.type = c.kind === 'multiselect' ? 'multi_choice' : 'choice'
            base.options_source = { table_id: match.table_id, column: 'title' }
            report({ area: 'field', id: c.id, view: view.name, name: label, status: 'partial', detail: `Options come from the "${source}" data table (check the column).` })
          } else {
            base.type = c.kind === 'multiselect' ? 'textarea' : 'text'
            report({ area: 'field', id: c.id, view: view.name, name: label, status: 'manual', detail: c.options_source ? `The options came from a data connection (${source ?? 'secondary data source'}): became a text field. Make it a Single select with options from a data table or an API reference.` : 'A list with no options: became a text field.', ...(c.options_source ? { original: c.options_source } : {}) })
          }
          break
        }
        base.type = c.kind === 'multiselect' ? 'multi_choice' : 'choice'
        if (c.kind === 'multiselect' || (c.kind === 'listbox' && base.type === 'multi_choice')) base.display = 'listbox' as TaskFieldDef['display']
        base.options = opts.map((o) => o.value).slice(0, 200)
        const labels = Object.fromEntries(opts.filter((o) => o.label && o.label !== o.value).map((o) => [o.value, clip(o.label, 200)]))
        if (Object.keys(labels).length) base.option_labels = labels
        if (c.kind === 'option') base.display = 'radio'
        if (c.kind === 'combobox') report({ area: 'field', id: c.id, view: view.name, name: label, status: 'partial', detail: 'A combo box (typed values allowed) became a Single select: only the listed options can be chosen.' })
        break
      }
      case 'checkbox': {
        base.type = 'boolean'
        const on = c.on_value ?? 'true'
        if (!['true', '1'].includes(on.toLowerCase())) report({ area: 'field', id: c.id, view: view.name, name: label, status: 'partial', detail: `The check box stored "${on}" when ticked: UserTasks stores true / false.` })
        break
      }
      case 'attachment': base.type = 'attachments'; base.attachments = { max_files: 1 } as TaskFieldDef['attachments']; break
      case 'people':
        // The SharePoint people picker takes several people by default.
        base.type = 'user'
        ;(base as unknown as Record<string, unknown>).user_config = { multiple: true }
        break
      case 'hyperlink': base.type = 'url'; (base as unknown as Record<string, unknown>).url_config = { new_tab: true }; break
      case 'bulleted_list':
        base.type = 'text_list'
        ;(base as unknown as Record<string, unknown>).text_list = { style: c.list_style ?? 'bulleted' }
        break
      case 'picture': {
        // A picture control: the person adds a picture. A picture stored in template.xml (base64) becomes its default.
        base.type = 'image'
        const img: Record<string, unknown> = { camera: true }
        const raw = c.path ? model.defaults[c.path] : undefined
        const data = raw ? imageFromBase64(raw) : null
        if (data) img.default_file = { name: `${key}.${data.ext}`, url: `data:${data.mime};base64,${data.base64}`, mime_type: data.mime, size: data.size }
        ;(base as unknown as Record<string, unknown>).image = img
        break
      }
      case 'signature': case 'ink':
        // A signature line or an ink picture: an electronic signature (drawn, or typed).
        base.type = 'signature'
        ;(base as unknown as Record<string, unknown>).signature = { mode: c.kind === 'ink' ? 'draw' : 'both' }
        report({ area: 'field', id: c.id, view: view.name, name: label, status: 'converted', detail: `${c.kind === 'ink' ? 'Ink picture' : 'Signature line'} → Signature field (an electronic signature: drawn or typed, with the signer and time).` })
        break
      default:
        return null
    }
    // Schema facets.
    if (node) {
      if (node.required) base.required = true
      if (node.pattern && ['text', 'textarea', 'email', 'phone', 'url'].includes(base.type) && !base.pattern) {
        const p = xsdPattern(node.pattern)
        if (p) { base.pattern = p; base.pattern_message = 'Enter a value in the expected format' }
        else report({ area: 'field', id: c.id, view: view.name, name: label, status: 'partial', detail: 'The schema pattern could not be used as a safe regular expression.', original: node.pattern })
      }
      if (node.minLength !== undefined && ['text', 'textarea'].includes(base.type) && node.minLength > 0) base.min_length = node.minLength
      if (node.maxLength !== undefined && ['text', 'textarea'].includes(base.type)) base.max_length = node.maxLength
      if (node.min !== undefined && ['number', 'currency'].includes(base.type)) base.min = node.min
      if (node.max !== undefined && ['number', 'currency'].includes(base.type)) base.max = node.max
    }
    // Default value (template.xml / schema default).
    const dflt = (c.path ? model.defaults[c.path] : undefined) ?? node?.default
    if (dflt !== undefined && dflt !== '') {
      if (base.type === 'boolean') base.default = /^(true|1)$/i.test(dflt) || dflt === c.on_value ? 'true' : 'false'
      else if (base.type === 'choice' || base.type === 'multi_choice') { if (base.options?.includes(dflt)) base.default = dflt }
      else if (['date', 'datetime'].includes(base.type)) { if (/^\d{4}-\d{2}-\d{2}/.test(dflt)) base.default = dflt }
      else if (!['attachments', 'user'].includes(base.type)) base.default = clip(dflt, 500)
    }
    if (c.read_only) base.read_only = true
    return base
  }

  function connectionFromXPath(xp: string): string | null {
    return /GetDOM\(\s*["']([^"']+)["']\s*\)/.exec(xp)?.[1] ?? null
  }
  function options_connections() { return options.connections ?? {} }

  const columnType = (c: IpControl, node?: IpSchemaNode): { type: ListColumnType; note?: string } | null => {
    const fmt = c.format ?? ''
    switch (c.kind) {
      case 'text': case 'expression':
        if ((node && NUMERIC.has(node.type)) || /number|currency|percentage/.test(fmt)) return { type: /currency/.test(fmt) ? 'currency' : 'number' }
        if (node?.type === 'date') return { type: 'date' }
        if (node?.type === 'boolean') return { type: 'boolean' }
        if (node?.type === 'dateTime') return { type: 'text', note: 'date & time column became text' }
        if (/e-?mail/i.test(`${c.label ?? ''} ${c.path ?? ''}`)) return { type: 'email' }
        return { type: 'text' }
      case 'richtext': return { type: 'textarea' }
      case 'date': return { type: 'date' }
      case 'datetime': return { type: 'text', note: 'date & time column became text' }
      case 'time': return { type: 'text', note: 'time column became text' }
      case 'checkbox': return { type: 'boolean' }
      case 'dropdown': case 'combobox': case 'listbox': case 'option': return (c.options ?? []).filter((o) => o.value).length || node?.enumeration?.length ? { type: 'choice' } : { type: 'text', note: 'options from a data connection became text' }
      case 'multiselect': return { type: 'text', note: 'multi-select column became text' }
      // A signature line or an ink picture in a repeating table: a signature column (each row signs its own cell).
      case 'signature': case 'ink': return { type: 'signature' }
      default: return null
    }
  }

  /* ── one form ── */

  const sourceOf = (view: string | null): FormSourceInfo => ({ kind: 'infopath', file_name: model.file_name, hash: model.hash, mode, imported_at: now, ...(view ? { view } : {}) })

  const newBuild = (view: string | null): FormBuild => ({ view, fields: [], byKey: new Map(), placed: new Map(), lists: new Map(), rules: [], sections: [], hidden: [], support: new Set(), buttonKeys: new Map(), rows: [], choiceGroups: [], pendingExpr: [] })

  const addField = (b: FormBuild, f: TaskFieldDef) => { b.fields.push(f); b.byKey.set(f.key, f) }

  /** Convert a view's items into rows (appending to `rows`), fields into `b`. */
  const convertItems = (b: FormBuild, view: IpView, list: IpViewItem[], rows: FormRow[], section: string | null, sectionDepth: number) => {
    let current: { row: number; cells: string[] } | null = null
    const flush = () => {
      if (!current || !current.cells.length) { current = null; return }
      for (let i = 0; i < current.cells.length; i += 4) {
        const chunk = current.cells.slice(i, i + 4)
        rows.push({ columns: chunk.length, cells: chunk.map((k) => ({ field_key: k, span: 1 })), ...(section ? { section } : {}) })
      }
      current = null
    }
    const place = (row: number, key: string, own = false) => {
      if (own || !current || current.row !== row) { flush(); current = { row, cells: [] } }
      current!.cells.push(key)
    }
    for (const item of list) {
      if (item.kind === 'static') {
        if (item.text === '—') { flush(); const key = keys.extra('divider'); addField(b, { key, label: 'Divider', type: 'divider' }); place(item.row, key, true); flush(); continue }
        const text = item.text.replace(/\s+/g, ' ').trim()
        if (!text || text.length < 2) continue
        if (item.heading && text.length <= 120) {
          const key = keys.extra(`heading_${text}`.slice(0, 40))
          const heading: TaskFieldDef = { key, label: clip(text, 200), type: 'heading' }
          styleField(view, heading, item.style, undefined)
          addField(b, heading)
          place(item.row, key, true)
          flush()
        } else {
          const key = keys.extra(`note_${text}`.slice(0, 30))
          const note = { key, label: clip(text, 80), type: 'label', default: clip(text, 5000), label_config: { hide_caption: true } } as TaskFieldDef
          styleField(view, note, item.style, undefined)
          addField(b, note)
          place(item.row, key)
        }
        continue
      }
      const c = item
      if (c.kind === 'section' || c.kind === 'optional_section') {
        flush()
        convertSection(b, view, c, rows, section, sectionDepth)
        continue
      }
      if (c.kind === 'repeating_table' || c.kind === 'repeating_section') {
        flush()
        const key = convertList(b, view, c)
        if (key) { rows.push({ columns: 1, cells: [{ field_key: key, span: 1 }], ...(section ? { section } : {}) }) }
        continue
      }
      const key = convertControl(b, view, c)
      if (key) place(c.row, key)
    }
    flush()
  }

  const convertSection = (b: FormBuild, view: IpView, c: IpControl, rows: FormRow[], outer: string | null, depth: number) => {
    const firstHeading = (c.children ?? []).find((i) => i.kind === 'static' && i.heading)
    const title = cleanLabel(c.caption || c.title || (firstHeading && firstHeading.kind === 'static' ? firstHeading.text : '') || (GENERIC_LEAF.test(localOf(c.path?.split('/').pop() ?? '')) ? '' : humanize(c.path))) || `Section ${b.sections.length + 1}`
    let sectionKey = outer
    const nested = Boolean(outer)
    if (!nested && b.sections.length < 40) {
      sectionKey = uniqueSectionKey(b, title)
      const s: FormSection = { key: sectionKey, title: clip(title, 120), ...(c.kind === 'optional_section' && !c.choice_group ? { optional: true } : {}) }
      b.sections.push(s)
      if (c.choice_group) {
        // An alternative of an InfoPath choice group: one of the group's sections shows at a time.
        let group = b.choiceGroups.find((g) => (g as { id?: string }).id === c.choice_group)
        if (!group) {
          let gkey = uniqueSectionKey(b, `choice_${title}`).slice(0, 40)
          while (b.byKey.has(gkey)) gkey = `${gkey}_g`
          group = { key: gkey, label: 'Choose one', sections: [], display: 'radio' }
          ;(group as { id?: string }).id = c.choice_group
          b.choiceGroups.push(group)
          report({ area: 'view', id: `cg:${c.choice_group}`, view: view.name, name: 'Choice group', status: 'converted', detail: 'An InfoPath choice group → a choice group: one of its sections shows at a time, picked with a switch.' })
        }
        if (group.sections.length < 6) group.sections.push(sectionKey)
      }
    } else if (nested) {
      report({ area: 'view', id: c.id, view: view.name, name: title, status: 'partial', detail: 'A section inside a section: its fields were placed in the outer section (UserTasks nests sections one level).' })
    }
    const before = new Set(b.fields.map((f) => f.key))
    convertItems(b, view, c.children ?? [], rows, sectionKey, depth + 1)
    const inner = b.fields.filter((f) => !before.has(f.key)).map((f) => f.key)
    // Show conditions and hide formatting.
    const target = !nested && sectionKey ? [`section:${sectionKey}`] : inner.map((k) => `field:${k}`)
    if (!target.length) return
    if (c.show_if) visibilityRule(b, view, c.id, title, negateText(c.show_if), c.context ?? c.path ?? '', target, 'hide', 'show condition (xsl:if)')
    for (const f of c.formatting) applyFormatting(b, view, c, title, f, target)
  }

  const uniqueSectionKey = (b: FormBuild, title: string) => {
    let base = fieldKeyFromLabel(title).replace(/^[^a-z]+/, '').slice(0, 40) || 'section'
    if (!/^[a-z]/.test(base)) base = `s_${base}`
    let key = base
    for (let i = 2; b.sections.some((s) => s.key === key) || b.byKey.has(key); i++) key = `${base}_${i}`
    return key
  }

  const convertControl = (b: FormBuild, view: IpView, c: IpControl): string | null => {
    const label = cleanLabel(c.label || c.title || c.caption || humanize(c.path))
    if (c.kind === 'button') {
      const key = keys.extra(`btn_${c.caption ?? c.id}`.slice(0, 40))
      addField(b, { key, label: clip(cleanLabel(c.caption) || 'Button', 200), type: 'button', button: { style: 'secondary', actions: [] } } as TaskFieldDef)
      b.buttonKeys.set(c.id, key)
      return key
    }
    if (c.kind === 'expression') {
      const key = keys.extra(label || 'value')
      const field: TaskFieldDef = { key, label: label || 'Value', type: 'label', label_config: {} }
      const expr = c.expression ?? ''
      const literal = isSimpleLiteral(expr) ?? /^string\(\s*"([^"]*)"\s*\)$/.exec(expr)?.[1]
      if (literal !== undefined && literal !== null) {
        field.default = literal
      } else {
        // Translated once the whole view is read (it may sum a repeating table further down).
        b.pendingExpr.push(() => {
          const r = toExpression(stripFormatting(expr), env(b, c.context ?? ''))
          if (r.ok) {
            const format = labelFormatFromInfoPath(expr, c.format, c.format_options, currency)
            field.label_config = { expression: r.value, ...(format ? { format } : {}) }
            report({ area: 'calculation', id: c.id, view: view.name, name: label || 'Expression box', status: 'converted', detail: `Label with the expression ${clip(r.value, 160)}${r.notes.length ? ` (${r.notes.join('; ')})` : ''}`, original: expr })
          } else {
            field.help_text = clip(`InfoPath expression (not converted): ${expr}`, 300)
            report({ area: 'calculation', id: c.id, view: view.name, name: label || 'Expression box', status: 'manual', detail: `Expression box not converted: it ${r.reason}. Kept as an empty Label.`, original: expr })
          }
        })
      }
      styleField(view, field, c.text_style, c.label_style)
      addField(b, field)
      for (const f of c.formatting) applyFormatting(b, view, c, label, f, [`field:${key}`])
      return key
    }
    if (c.kind === 'static_image') return convertStaticImage(b, view, c)
    if (!c.path) {
      report({ area: 'field', id: c.id, view: view.name, name: label || c.kind, status: 'skipped', detail: `A ${c.kind} control without a binding was skipped.` })
      return null
    }
    if (['activex', 'unknown'].includes(c.kind)) {
      report({ area: 'field', id: c.id, view: view.name, name: label || c.kind, status: 'skipped', detail: `Control "${c.xctname}" has no UserTasks equivalent.` })
      return null
    }
    const pathKey = c.path.toLowerCase()
    const already = b.placed.get(pathKey)
    if (already) {
      // The same node shown twice (InfoPath allows it; a UserTasks field sits once): a read-only Label mirrors it.
      const key = keys.extra(`${already}_copy`)
      addField(b, { key, label: label || 'Value', type: 'label', label_config: { expression: `{{form.${already}}}` } })
      report({ area: 'field', id: c.id, view: view.name, name: label, status: 'partial', detail: `Shown twice in the view: the second one became a read-only Label of "${already}".` })
      return key
    }
    const key = keys.key(c.path, c.label)
    const field = fieldFor(c, key, b, view)
    if (!field) return null
    styleField(view, field, c.text_style, c.label_style)
    addField(b, field)
    b.placed.set(pathKey, key)
    for (const f of c.formatting) applyFormatting(b, view, c, field.label, f, [`field:${key}`])
    return key
  }

  /** A picture placed in the view → a display image (embedded as a data URL; the importer stores it as a form image). */
  const convertStaticImage = (b: FormBuild, view: IpView, c: IpControl): string | null => {
    const file = (c.src ?? '').toLowerCase()
    const img = model.images[file]
    if (!img) return null
    if (img.size < 400) return null // spacers and rules (1-pixel GIFs)
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(img.mime) || img.size > 512 * 1024) {
      report({ area: 'field', id: c.id, view: view.name, name: c.src ?? 'Picture', status: 'manual', detail: `A ${img.mime.replace('image/', '').toUpperCase()} picture of ${Math.round(img.size / 1024)} KB was not added: add it again as a Display image (PNG, JPEG, GIF or WebP, up to 2 MB).` })
      return null
    }
    const alt = cleanLabel(c.alt) || humanize(`/${(c.src ?? 'picture').replace(/\.[^.]+$/, '')}`) || 'Picture'
    const key = keys.extra(`picture_${(c.src ?? 'image').replace(/\.[^.]+$/, '')}`.slice(0, 40))
    addField(b, { key, label: alt, type: 'display_image', display_image: { src: `data:${img.mime};base64,${img.base64}`, alt, width: 'md', align: 'left' } } as unknown as TaskFieldDef)
    report({ area: 'field', id: c.id, view: view.name, name: alt, status: 'converted', detail: `Picture in the view → Display image (stored with the form). Check its alt text: "${alt}".` })
    return key
  }

  const stripFormatting = (expr: string) => {
    // xdFormatting:formatString(x, "date", "…") → x
    const m = /^\s*xdFormatting:formatString\(\s*([^,]+),[\s\S]*\)\s*$/.exec(expr)
    return m ? m[1] : expr
  }

  /** A repeating section (cards of any controls) → a Repeating section field; nested ones inside it, up to 3 levels. */
  const convertRepeating = (b: FormBuild, view: IpView, c: IpControl, depth: number): string | null => {
    const path = c.path!
    const title = cleanLabel(c.label || c.title || c.caption || humanize(path)) || 'Items'
    if (depth > 3) {
      report({ area: 'repeating', id: c.id, view: view.name, name: title, status: 'manual', detail: 'A repeating section nested deeper than 3 levels: move it up a level, or use a child data table.' })
      return null
    }
    const key = keys.key(path, c.label || c.title || c.caption, true)
    const inner: FormBuild = { ...newBuild(b.view), itemPath: path, depth, parent: b }
    convertItems(inner, view, c.children ?? [], inner.rows, null, 0)
    for (const run of inner.pendingExpr.splice(0)) run()
    // Signatures inside items sign per item (each item's signature is stamped by the server like a field's) — reported as converted by convertField.
    const keep = new Set(inner.fields.map((f) => f.key))
    inner.rows = inner.rows.map((r) => ({ ...r, cells: r.cells.filter((x) => keep.has(x.field_key)) })).filter((r) => r.cells.length)
    if (!inner.fields.length) {
      report({ area: 'repeating', id: c.id, view: view.name, name: title, status: 'manual', detail: 'A repeating section with no controls UserTasks could make.' })
      return null
    }
    // Item-level validation and calculations (paths inside the item).
    convertItemLogic(inner, view, path)
    const singular = title.replace(/ies$/i, 'y').replace(/s$/i, '') || 'item'
    const firstText = inner.fields.find((f) => ['text', 'choice', 'email'].includes(f.type))
    const config: Record<string, unknown> = {
      fields: inner.fields,
      layout: { rows: inner.rows, ...(inner.sections.length ? { sections: inner.sections } : {}), ...(inner.rules.length ? { rules: inner.rules.slice(0, FORM_RULE_LIMITS.rules) } : {}) },
      add_label: clip(`Add ${singular.toLowerCase()}`, 60),
      item_title: clip(`${singular} {{index}}${firstText ? `: {{item.${firstText.key}}}` : ''}`, 120),
      start_items: 1,
    }
    const totals = inner.fields.filter((f) => f.type === 'currency').map((f) => ({ field: f.key, fn: 'sum' }))
    if (totals.length) config.totals = totals.slice(0, 5)
    const field = { key, label: clip(title, 200), type: 'repeating_section', repeating_section: config } as unknown as TaskFieldDef
    addField(b, field)
    const cols = new Map([...inner.placed.entries()])
    b.lists.set(path.toLowerCase(), { key, config: { columns: inner.fields.map((f) => ({ key: f.key, label: f.label, type: 'text' })) } as unknown as ListFieldConfig, path, cols })
    for (const [k, v] of inner.placed) if (!b.placed.has(k)) b.placed.set(k, v) // keys are unique form-wide
    report({ area: 'repeating', id: c.id, view: view.name, name: title, status: 'converted', detail: `Repeating section (a card per item) with ${inner.fields.length} control${inner.fields.length === 1 ? '' : 's'}${inner.rules.length ? ` and ${inner.rules.length} rule${inner.rules.length === 1 ? '' : 's'} per item` : ''}; its layout kept.` })
    if (c.show_if) visibilityRule(b, view, c.id, title, negateText(c.show_if), c.context ?? '', [`field:${key}`], 'hide', 'show condition (xsl:if)')
    for (const f of c.formatting) applyFormatting(b, view, c, title, f, [`field:${key}`])
    return key
  }

  /** Validation and calculations on an item's own controls → the item's rules (and Labels). */
  const convertItemLogic = (inner: FormBuild, view: IpView, itemPath: string) => {
    const prefix = `${itemPath.toLowerCase()}/`
    for (const v of model.manifest.validations) {
      if (!v.path.toLowerCase().startsWith(prefix)) continue
      const own = inner.placed.get(v.path.toLowerCase())
      if (!own) continue
      if (v.kind === 'blank') { const f = inner.byKey.get(own); if (f) f.required = true; itemStatus.set(v.id, 'converted'); continue }
      const bound = /^\s*\.\s*(<=?|>=?)\s*(-?\d+(?:\.\d+)?)\s*$/.exec(v.expression)
      const f = inner.byKey.get(own)
      if (bound && f && ['number', 'currency'].includes(f.type) && (bound[1] === '<' || bound[1] === '>')) { if (bound[1] === '<') f.min = Number(bound[2]); else f.max = Number(bound[2]); itemStatus.set(v.id, 'converted'); continue }
      const cond = toCondition(v.expression, env(inner, v.context))
      const action = { type: 'field_error', field: own, text: clip(v.short_message, 300) } as FieldButtonAction
      if (cond.ok) {
        pushRule(inner, { name: clip(`Validate: ${v.short_message}`, FORM_RULE_LIMITS.name), description: clip(`From InfoPath data validation (each item).\nOriginal: ${v.expression}`, FORM_RULE_LIMITS.description), event: 'always', if: cond.value, then: [action] })
        itemStatus.set(v.id, 'converted')
      } else {
        pushRule(inner, { name: clip(`Validate: ${v.short_message}`, FORM_RULE_LIMITS.name), disabled: true, description: clip(`Not converted: the condition ${cond.reason}.\nOriginal: ${v.expression}`, FORM_RULE_LIMITS.description), event: 'always', then: [action] })
        itemStatus.set(v.id, 'manual')
      }
    }
    for (const calc of model.manifest.calculations) {
      if (!calc.path.toLowerCase().startsWith(prefix)) continue
      const own = inner.placed.get(calc.path.toLowerCase())
      const f = own ? inner.byKey.get(own) : undefined
      if (!f) continue
      const r = toExpression(calc.expression, env(inner, calc.path))
      if (r.ok && calc.refresh !== 'onInit') {
        Object.keys(f).forEach((k) => { if (!['key', 'label', 'help_text'].includes(k)) delete (f as unknown as Record<string, unknown>)[k] })
        Object.assign(f, { type: 'label', label_config: { expression: r.value, include: true } })
        itemStatus.set(calc.id, 'converted')
      } else if (r.ok && /^TODAY\(\)$|^NOW\(\)$/.test(r.value)) {
        f.default = r.value === 'TODAY()' ? '{{today}}' : '{{now}}'
        itemStatus.set(calc.id, 'converted')
      } else itemStatus.set(calc.id, 'manual')
    }
  }
  const itemStatus = new Map<string, ReportStatus>()

  const convertList = (b: FormBuild, view: IpView, c: IpControl): string | null => {
    const path = c.path
    const title = cleanLabel(c.label || c.title || humanize(path)) || 'Rows'
    if (!path) {
      report({ area: 'repeating', id: c.id, view: view.name, name: title, status: 'skipped', detail: 'A repeating part whose rows could not be followed.' })
      return null
    }
    const listPath = path
    if (b.lists.has(listPath.toLowerCase())) return null
    // Repeating sections (cards of any controls) become a Repeating section; repeating tables a List.
    if (c.kind === 'repeating_section' && !b.itemPath) return convertRepeating(b, view, c, 1)
    if (c.kind === 'repeating_section' && b.itemPath) return convertRepeating(b, view, c, (b.depth ?? 1) + 1)
    const key = keys.key(listPath, c.label || c.title, true)
    const notes: string[] = []
    const columns = listColumns(view, key, listPath, c.children ?? [], 1, notes, c.header_styles)
    if (!columns.length) {
      report({ area: 'repeating', id: c.id, view: view.name, name: title, status: 'manual', detail: `No columns could be made from this repeating part${notes.length ? ` (${notes.join('; ')})` : ''}.` })
      return null
    }
    const config: ListFieldConfig = { columns: columns.slice(0, 30), entry_mode: 'inline', display: 'auto' } as ListFieldConfig
    const field: TaskFieldDef = { key, label: clip(title, 200), type: 'list', list: config }
    addField(b, field)
    b.lists.set(listPath.toLowerCase(), { key, config, path: listPath })
    const nested = config.columns.filter((x) => x.type === 'list').length
    report({ area: 'repeating', id: c.id, view: view.name, name: title, status: notes.length ? 'partial' : 'converted', detail: `List (editable table) with ${config.columns.length} column${config.columns.length === 1 ? '' : 's'}: ${config.columns.map((x) => x.label).join(', ')}${nested ? ` (${nested} nested List${nested === 1 ? '' : 's'})` : ''}${notes.length ? `. Not converted: ${notes.join('; ')}` : ''}.` })
    if (c.show_if) visibilityRule(b, view, c.id, title, negateText(c.show_if), c.context ?? '', [`field:${key}`], 'hide', 'show condition (xsl:if)')
    for (const f of c.formatting) applyFormatting(b, view, c, title, f, [`field:${key}`])
    // Conditional formatting on the row's cells: per-cell styles (the condition read per row).
    const rowStyles: unknown[] = []
    const cellRules: unknown[] = []
    collectCellFormatting(b, view, key, listPath, c.children ?? [], config, rowStyles, cellRules, c)
    if (rowStyles.length) (config as unknown as Record<string, unknown>).row_styles = rowStyles.slice(0, 20)
    if (cellRules.length) (config as unknown as Record<string, unknown>).cell_rules = cellRules.slice(0, 20)
    return key
  }

  /** The columns of a repeating table's row (nested repeating parts → nested List columns, up to 3 levels). */
  const listColumns = (view: IpView, listKey: string, listPath: string, children: IpViewItem[], depth: number, notes: string[], headerStyles?: Array<IpTextStyle | undefined>): ListColumn[] => {
    const columns: ListColumn[] = []
    const leafControls: IpControl[] = []
    const collect = (list: IpViewItem[]) => {
      for (const i of list) {
        if (i.kind === 'static') continue
        if (i.kind === 'repeating_table' || i.kind === 'repeating_section') { leafControls.push(i); continue }
        if (i.children) { collect(i.children); continue }
        leafControls.push(i)
      }
    }
    collect(children)
    const seen = new Set<string>()
    for (let li = 0; li < leafControls.length; li++) {
      const ch = leafControls[li]
      if (ch.kind === 'button') { notes.push(`button "${ch.caption ?? ch.id}" skipped`); continue }
      if (ch.kind === 'repeating_table' || ch.kind === 'repeating_section') {
        const label = cleanLabel(ch.label || ch.title || humanize(ch.path)) || 'Rows'
        if (!ch.path || depth >= 3) { notes.push(`repeating part "${label}" nested deeper than 3 levels`); continue }
        const ckey = keys.column(listKey, ch.path, label)
        const inner = listColumns(view, `${listKey}.${ckey}`, ch.path, ch.children ?? [], depth + 1, notes, ch.header_styles)
        if (!inner.length) { notes.push(`nested repeating part "${label}" has no columns`); continue }
        columns.push({ key: ckey, label, type: 'list', list: { columns: inner.slice(0, 30) } } as unknown as ListColumn)
        continue
      }
      if (ch.kind === 'expression') {
        // Showing a column's own value (a read-only review table): that column, read only.
        const shown = /^\s*(?:xdFormatting:formatString\(\s*)?((?:\.\.\/)*(?:[\w-]+:)?[\w.-]+(?:\/(?:[\w-]+:)?[\w.-]+)*)\s*(?:,[^)]*\))?\s*$/.exec(ch.expression ?? '')
        const shownPath = shown ? resolveBinding(ch.context ?? listPath, shown[1]) : null
        if (shownPath && shownPath.toLowerCase().startsWith(`${listPath.toLowerCase()}/`) && nodeOf(shownPath) && !seen.has(shownPath.toLowerCase())) {
          leafControls.push({ ...ch, kind: 'text', path: shownPath, read_only: true, format: ch.format ?? (/"date"/.test(ch.expression ?? '') ? 'date' : undefined) })
          continue
        }
        // A calculated column (row arithmetic), else skipped with a note.
        const formula = rowFormula(ch.expression ?? '', listPath, ch.context ?? listPath, columns, listKey)
        const label = cleanLabel(ch.label) || 'Calculated'
        if (formula) {
          const ckey = keys.column(listKey, `${listPath}/#calc${columns.length}`, label)
          columns.push({ key: ckey, label, type: 'calculated', formula, ...(/currency/.test(ch.format ?? '') ? { currency } : {}) } as ListColumn)
        } else notes.push(`expression column "${label}" not converted (${ch.expression})`)
        continue
      }
      if (!ch.path || seen.has(ch.path.toLowerCase())) continue
      seen.add(ch.path.toLowerCase())
      const node = nodeOf(ch.path)
      const t = columnType(ch, node)
      if (!t) { notes.push(`${ch.kind} "${cleanLabel(ch.label)}" has no column type (use a Repeating section for pictures and rich text)`); continue }
      if (t.note) notes.push(`"${cleanLabel(ch.label)}": ${t.note}`)
      const label = cleanLabel(ch.label || humanize(ch.path)) || 'Column'
      const ckey = keys.column(listKey, ch.path, label)
      const col: ListColumn = { key: ckey, label, type: t.type }
      if (t.type === 'choice') {
        const opts = (ch.options ?? []).filter((o) => o.value)
        col.options = opts.length ? opts.map((o) => o.value) : node?.enumeration ?? []
        const labels = Object.fromEntries(opts.filter((o) => o.label !== o.value).map((o) => [o.value, o.label]))
        if (Object.keys(labels).length) col.option_labels = labels
      }
      if (t.type === 'currency') col.currency = currency
      if (t.type === 'signature') {
        // Ink pictures are drawn; a signature line may be drawn or typed.
        if (ch.kind === 'ink') col.signature = { mode: 'draw' }
        report({ area: 'field', id: ch.id, view: view.name, name: label, status: 'converted', detail: `${ch.kind === 'ink' ? 'Ink picture' : 'Signature line'} in a repeating table → a signature column: each row is signed in its own cell (drawn${ch.kind === 'ink' ? '' : ' or typed'}, with the signer and time).` })
      }
      if (ch.read_only) col.read_only = true
      if (node?.required) col.required = true
      // Fonts from the view: the header cell (label) and the cell's control (value).
      const ts = controlTextStyle(view, ch.text_style, headerStyles?.[ch.col] ?? ch.label_style)
      if (ts) col.text_style = ts
      const dflt = model.defaults[ch.path]
      if (dflt) col.default = clip(dflt, 500)
      columns.push(col)
    }
    // Calculations whose target is a column of this list.
    for (const calc of model.manifest.calculations) {
      if (!calc.path.toLowerCase().startsWith(`${listPath.toLowerCase()}/`)) continue
      const col = columns.find((x) => keys.column(listKey, calc.path) === x.key)
      if (!col || col.type === 'calculated') continue
      const formula = rowFormula(calc.expression, listPath, calc.path, columns, listKey)
      if (formula && ['number', 'currency'].includes(col.type)) {
        Object.assign(col, { type: 'calculated', formula })
        report({ area: 'calculation', id: calc.id, view: view.name, name: col.label, status: 'converted', detail: `Calculated column: ${formula}`, original: calc.expression })
      }
    }
    return columns
  }

  /**
   * Formatting inside a repeating table, judged per row:
   *  - style → List row_styles (the style on that cell while the row's condition holds);
   *  - hide / disable reading the row → List cell_rules (that row's cell hidden / read only);
   *  - hide reading only the form (no row field) → a whole-column hide (an Always rule on
   *    `column:<list>.<column>`), also when the column's header cell is hidden that way;
   *  - disable reading only the form → a cell rule (every row's cell read only while it holds).
   */
  const collectCellFormatting = (b: FormBuild, view: IpView, listKey: string, listPath: string, children: IpViewItem[], config: ListFieldConfig, out: unknown[], cellRules: unknown[], table?: IpControl) => {
    const rowEnv = (ch: IpControl): TranslateEnv => ({
      context: ch.context ?? listPath,
      row: listKey,
      resolve: (p) => {
        const col = config.columns.find((x) => x.key === keys.column(listKey, p))
        if (col) return { kind: 'column', list: listKey, column: col.key }
        // Outer form fields (a condition on the form, not the row).
        if (p.toLowerCase().startsWith(`${listPath.toLowerCase()}/`)) return null
        const outer = env(b, ch.context ?? listPath).resolve(p)
        return outer && outer.kind === 'field' ? { kind: 'outer', key: outer.key, type: outer.type } : null
      },
    })
    const readsRow = (group: DataTableConditionGroup) => JSON.stringify(group).includes('"row.')
    const hiddenColumns = new Set<string>()
    const hideColumn = (column: ListColumn, condition: string, group: DataTableConditionGroup, id: string, label: string, what: string) => {
      if (hiddenColumns.has(column.key)) return
      hiddenColumns.add(column.key)
      pushRule(b, { name: clip(`Hide column: ${column.label}`, FORM_RULE_LIMITS.name), description: clip(`From InfoPath conditional formatting (${what}): the whole column hides while the condition holds.\nOriginal: ${condition}`, FORM_RULE_LIMITS.description), event: 'always', if: group, then: [{ type: 'show_hide', mode: 'hide', targets: [`column:${listKey}.${column.key}`] } as FieldButtonAction] })
      report({ area: 'formatting', id, view: view.name, name: label, status: 'converted', detail: `Always rule: the "${column.label}" column (header and cells) hides while the form condition holds.`, original: condition })
    }
    const walk = (list: IpViewItem[]) => {
      for (const ch of list) {
        if (ch.kind === 'static') continue
        if (ch.children && ch.kind !== 'repeating_table' && ch.kind !== 'repeating_section') { walk(ch.children); continue }
        if (!ch.path) continue
        const column = config.columns.find((x) => x.key === keys.column(listKey, ch.path!))
        // The header cell over this control hidden by a form condition: the whole column hides.
        const header = table?.header_formatting?.[ch.col] ?? []
        for (const f of header) {
          if (f.effect !== 'hide' || !column) continue
          const cond = toCondition(f.condition, rowEnv({ ...ch, context: table?.context ?? ch.context }))
          if (cond.ok && !readsRow(cond.value)) hideColumn(column, f.condition, cond.value, `${view.name}:${table?.id}:h${ch.col}:${f.condition}`, `${cleanLabel(ch.label) || 'Column'} (header)`, 'a header cell')
        }
        for (const f of ch.formatting) {
          const label = `${cleanLabel(ch.label) || 'Cell'}${f.caption ? ` (${f.caption})` : ''}`
          const id = `${view.name}:${ch.id}:${f.condition}`
          const cond = toCondition(f.condition, rowEnv(ch))
          if (f.effect !== 'style') {
            const what = f.effect === 'hide' ? 'hidden' : 'read only'
            if (!cond.ok || !column) {
              report({ area: 'formatting', id, view: view.name, name: label, status: 'manual', detail: !cond.ok ? `A cell ${what} by a condition was not converted: the condition ${cond.reason}.` : `A cell ${what} by a condition: its column was not made.`, original: f.condition })
              continue
            }
            if (f.effect === 'hide' && !readsRow(cond.value)) { hideColumn(column, f.condition, cond.value, id, label, 'a cell control'); continue }
            if (cellRules.length >= 20) {
              report({ area: 'formatting', id, view: view.name, name: label, status: 'manual', detail: 'More than 20 cell rules on one List: this one was not added.', original: f.condition })
              continue
            }
            cellRules.push({ if: cond.value, column: column.key, ...(f.effect === 'hide' ? { hide: true } : { read_only: true }) })
            report({ area: 'formatting', id, view: view.name, name: label, status: 'converted', detail: `Cell rule: the "${column.label}" cell is ${what} in ${readsRow(cond.value) ? 'rows where the condition holds' : 'every row while the condition holds'}${f.effect === 'disable' ? ' (kept as stored on the server)' : ''}.`, original: f.condition })
            continue
          }
          const style = styleFromCss(f.style ?? '')
          if (!style || !cond.ok || !column) {
            report({ area: 'formatting', id, view: view.name, name: label, status: 'manual', detail: !style ? 'Conditional formatting with nothing UserTasks styles.' : !cond.ok ? `Cell styling not converted: the condition ${cond.reason}.` : 'Cell styling not converted.', original: f.condition })
            continue
          }
          out.push({ if: cond.value, style: style.style, column: column.key })
          report({ area: 'formatting', id, view: view.name, name: label, status: style.note ? 'partial' : 'converted', detail: `Row style on the "${column.label}" cell${style.note ? `: ${style.note}` : ''}.`, original: f.condition })
        }
      }
    }
    walk(children)
  }

  /** Row arithmetic (a + b, qty * price) as a List calculated formula, or null. */
  const rowFormula = (expr: string, listPath: string, context: string, columns: ListColumn[], listKeyIn?: string): string | null => {
    const listKey = listKeyIn ?? keys.key(listPath)
    const r = toExpression(stripFormatting(expr), {
      context,
      row: listKey,
      resolve: (p) => {
        if (!p.toLowerCase().startsWith(`${listPath.toLowerCase()}/`)) return null
        const col = columns.find((c) => c.key === keys.column(listKey, p))
        return col ? { kind: 'column', list: listKey, column: col.key } : null
      },
    })
    if (!r.ok) return null
    const formula = r.value.replace(/\{\{row\.(\w+)\}\}/g, '$1').replace(/\s+/g, ' ').trim()
    return /^[\w\s+\-*/().]+$/.test(formula) && /[a-z_]/i.test(formula) && formula.length <= 300 ? formula : null
  }

  /* ── translation env ── */

  const env = (b: FormBuild, context: string, row?: string | null): TranslateEnv => ({
    context,
    row: row ?? null,
    resolve: (p): Ref | null => {
      const lower = p.toLowerCase()
      if (b.itemPath) {
        // Inside a repeating section item: its own controls are {{item.*}}, the form's fields {{form.*}}.
        const own = b.placed.get(lower)
        if (own) return { kind: 'item', key: own, type: b.byKey.get(own)?.type }
        if (lower.startsWith(`${b.itemPath.toLowerCase()}/`)) return null
        const outer = b.parent ? env(b.parent, context).resolve(p) : null
        return outer && (outer.kind === 'field' || outer.kind === 'outer') ? { kind: 'outer', key: outer.key, type: outer.type } : outer?.kind === 'list' ? outer : null
      }
      const list = b.lists.get(lower)
      if (list) return { kind: 'list', key: list.key }
      for (const [lp, l] of b.lists) {
        if (lower.startsWith(`${lp}/`)) {
          if (l.cols) { const k = l.cols.get(lower); return k ? { kind: 'column', list: l.key, column: k } : null }
          const col = l.config.columns.find((x) => x.key === keys.column(l.key, p))
          return col ? { kind: 'column', list: l.key, column: col.key, type: col.type } : null
        }
      }
      const placed = b.placed.get(lower)
      if (placed) return { kind: 'field', key: placed, type: b.byKey.get(placed)?.type }
      // A data-source node not shown on this view: added as a hidden field when a rule needs it.
      const node = nodes.get(lower)
      if (!node || node.type === 'group' || isInsideRepeating(p)) return null
      const key = keys.key(node.path)
      b.support.add(node.path)
      return { kind: 'field', key }
    },
  })

  /* ── rules ── */

  const pushRule = (b: FormBuild, rule: Omit<FormRule, 'id'>) => {
    b.rules.push({ id: newRuleId(b.rules.map((r) => r.id)), ...rule })
  }

  /** A disabled placeholder rule that keeps the original for a person to finish. */
  const todoRule = (b: FormBuild, name: string, why: string, original: string | undefined, event: FormRule['event'] = 'form_load', target?: string) => {
    pushRule(b, {
      name: clip(`InfoPath: ${name}`, FORM_RULE_LIMITS.name),
      description: clip(`Not converted: ${why}.${original ? `\nOriginal: ${original}` : ''}`, FORM_RULE_LIMITS.description),
      disabled: true,
      event,
      ...(target ? { target } : {}),
      then: [{ type: 'message', text: clip(`TODO (from InfoPath): ${name}`, 500), tone: 'warning' } as FieldButtonAction],
    })
  }

  const visibilityRule = (b: FormBuild, view: IpView, id: string, name: string, condition: string, context: string, targets: string[], effect: 'hide' | 'disable', what: string) => {
    const cond = toCondition(condition, env(b, context))
    const ruleName = clip(`${effect === 'hide' ? 'Hide' : 'Read only'}: ${name}`, FORM_RULE_LIMITS.name)
    const isButton = targets.every((t) => b.byKey.get(t.replace(/^field:/, ''))?.type === 'button')
    const action: FieldButtonAction = effect === 'hide'
      ? { type: 'show_hide', mode: 'hide', targets }
      : isButton ? { type: 'enable_disable', mode: 'disable', targets } : { type: 'read_only', mode: 'read_only', targets }
    if (cond.ok) {
      pushRule(b, { name: ruleName, description: clip(`From InfoPath ${what}: ${condition}`, FORM_RULE_LIMITS.description), event: 'always', if: cond.value, then: [action] })
      report({ area: 'formatting', id: `${view.name}:${id}:${condition}`, view: view.name, name, status: 'converted', detail: `Always rule: ${effect === 'hide' ? 'hide' : 'read only'} while the condition holds`, original: condition })
    } else {
      pushRule(b, { name: ruleName, description: clip(`Not converted: the condition ${cond.reason}.\nOriginal: ${condition}`, FORM_RULE_LIMITS.description), disabled: true, event: 'always', then: [action] })
      report({ area: 'formatting', id: `${view.name}:${id}:${condition}`, view: view.name, name, status: 'manual', detail: `Kept as a disabled rule: the condition ${cond.reason}.`, original: condition })
    }
  }

  const applyFormatting = (b: FormBuild, view: IpView, c: IpControl, name: string, f: IpControl['formatting'][number], targets: string[]) => {
    const context = c.context ?? c.path ?? ''
    if (f.effect === 'style') {
      const label = `${name}${f.caption ? ` (${f.caption})` : ''}`
      const id = `${view.name}:${c.id}:${f.condition}`
      const style = styleFromCss(f.style ?? '')
      if (!style) {
        report({ area: 'formatting', id, view: view.name, name: label, status: 'skipped', detail: `Conditional formatting with nothing UserTasks styles (${clip(f.style ?? '', 80)}).`, original: f.condition })
        return
      }
      const cond = toCondition(f.condition, env(b, context))
      const styleTargets = targets.filter((t) => t.startsWith('field:') || t.startsWith('section:'))
      const action = { type: 'set_style', targets: styleTargets, style: style.style } as unknown as FieldButtonAction
      const ruleName = clip(`Style: ${label}`, FORM_RULE_LIMITS.name)
      if (cond.ok) {
        pushRule(b, { name: ruleName, description: clip(`From InfoPath conditional formatting (${f.style}).${style.note ? ` ${style.note}` : ''}\nOriginal: ${f.condition}`, FORM_RULE_LIMITS.description), event: 'always', if: cond.value, then: [action] })
        report({ area: 'formatting', id, view: view.name, name: label, status: style.note ? 'partial' : 'converted', detail: `Always rule: style while the condition holds${style.note ? ` — ${style.note}` : ''}.`, original: f.condition })
      } else {
        pushRule(b, { name: ruleName, disabled: true, description: clip(`Not converted: the condition ${cond.reason}.\nOriginal: ${f.condition} (${f.style})`, FORM_RULE_LIMITS.description), event: 'always', then: [action] })
        report({ area: 'formatting', id, view: view.name, name: label, status: 'manual', detail: `Kept as a disabled style rule: the condition ${cond.reason}.`, original: f.condition })
      }
      return
    }
    visibilityRule(b, view, c.id, `${name}${f.caption ? ` (${f.caption})` : ''}`, f.condition, context, targets, f.effect, 'conditional formatting')
  }

  const templateOf = (expr: string, e: TranslateEnv): { ok: true; value: string } | { ok: false; reason: string } => {
    const literal = isSimpleLiteral(expr)
    if (literal !== null) return { ok: true, value: literal }
    // The current person (rules run in the browser with the signed-in user).
    const user = /^\s*(?:xdUser:)?(get-DisplayName|get-UserName|userName)\(\)\s*$/i.exec(expr)
    if (user) return { ok: true, value: /displayname/i.test(user[1]) ? '{{user.name}}' : '{{user.email}}' }
    const r = toExpression(expr, e)
    if (!r.ok) return r
    const single = /^\{\{(form\.\w+|row\.\w+)\}\}$/.exec(r.value)
    if (single) return { ok: true, value: r.value }
    if (r.value === 'true' || r.value === 'false') return { ok: true, value: r.value }
    return { ok: true, value: `{{=${r.value}}}` }
  }

  const convertRule = (b: FormBuild, view: IpView | null, rule: IpRule, pages: Map<string, string> | null): 'converted' | 'partial' | 'manual' | 'na' => {
    // Trigger.
    let event: FormRule['event']
    let target: string | undefined
    let row: string | null = null
    const t = rule.trigger
    if (t.kind === 'load') event = 'form_load'
    else if (t.kind === 'submit') event = 'before_submit'
    else if (t.kind === 'button') {
      if (view && t.view !== view.name) return 'na'
      const key = b.buttonKeys.get(t.control)
      if (!key) return 'na'
      event = 'button_click'
      target = key
    } else {
      const ref = env(b, t.path).resolve(t.path)
      if (!ref) return 'na'
      if (ref.kind === 'column') { event = 'cell_change'; target = ref.list; row = ref.list }
      else if (ref.kind === 'field' && b.byKey.has(ref.key)) { event = 'value_change'; target = ref.key }
      else return 'na'
    }
    const e = env(b, rule.context, row)
    const original = [rule.condition ? `Condition: ${rule.condition}` : '', ...rule.actions.map(describeAction)].filter(Boolean).join('\n')
    const failures: string[] = []
    let cond: DataTableConditionGroup | undefined
    if (rule.condition) {
      const r = toCondition(rule.condition, e)
      if (r.ok) cond = row ? eventRow(r.value) : r.value
      else failures.push(`the condition ${r.reason}`)
    }
    const then: FieldButtonAction[] = []
    for (const a of rule.actions) {
      switch (a.type) {
        case 'dialog': then.push({ type: 'message', text: clip(a.text || 'Message', 2000) } as FieldButtonAction); break
        case 'dialog_expression': {
          const r = templateOf(a.expression ?? '', e)
          if (r.ok) then.push({ type: 'message', text: r.value } as FieldButtonAction)
          else failures.push(`a message ${r.reason}`)
          break
        }
        case 'assign': {
          const targetRef = a.target ? e.resolve(resolveTarget(a.target, rule.context)) : null
          if (!targetRef) { failures.push(`it sets ${a.target}, which is not on the form`); break }
          const r = templateOf(a.expression ?? '', e)
          if (!r.ok) { failures.push(`setting ${a.target}: the value ${r.reason}`); break }
          if (targetRef.kind === 'field') {
            const prev = then.find((x) => x.type === 'set_values')
            if (prev) prev.assign = { ...prev.assign, [targetRef.key]: r.value }
            else then.push({ type: 'set_values', assign: { [targetRef.key]: r.value } } as FieldButtonAction)
          } else if (targetRef.kind === 'column' && row === targetRef.list) {
            then.push({ type: 'set_row_values', field: targetRef.list, row: '{{event.row_number}}', values: { [targetRef.column]: r.value.replace(/\{\{row\./g, '{{event.row.') } } as FieldButtonAction)
          } else failures.push(`it sets a repeating-table column (${a.target}) outside its row`)
          break
        }
        case 'switch_view': {
          const page = pages?.get(a.view ?? '')
          if (page) then.push({ type: 'go_to_page', page } as FieldButtonAction)
          else failures.push(`it switches to the view "${a.view}" (with one form per view, open that form instead — or import with "Views as steps" / "Views as tabs")`)
          break
        }
        case 'submit': {
          const conn = model.manifest.connections.find((c) => c.name === a.adapter)
          const mapped = a.adapter ? options.connections?.[a.adapter] : undefined
          if (!conn || model.manifest.submit?.adapters.includes(a.adapter ?? '')) then.push({ type: 'submit' } as FieldButtonAction)
          else if (mapped?.reference_id) then.push({ type: 'call_reference', reference_id: mapped.reference_id, ...(mapped.integration_id ? { integration_id: mapped.integration_id } : {}), inputs: {} } as FieldButtonAction)
          else failures.push(`it submits to the data connection "${a.adapter}" (set up an integration reference, or save submissions to a data table)`)
          break
        }
        case 'query': {
          const mapped = a.adapter ? options.connections?.[a.adapter] : undefined
          if (mapped?.table_id) then.push({ type: 'table_list', table_id: mapped.table_id, ...(mapped.table_name ? { table_name: mapped.table_name } : {}), limit: 100 } as FieldButtonAction)
          else if (mapped?.reference_id) then.push({ type: 'call_reference', reference_id: mapped.reference_id, ...(mapped.integration_id ? { integration_id: mapped.integration_id } : {}), inputs: {} } as FieldButtonAction)
          else failures.push(`it queries the data connection "${a.adapter}" (no matching data table or API reference: create one, then add a Table list / Call API reference step)`)
          break
        }
        case 'close':
          // After a submit, UserTasks closes / shows the Submitted page itself.
          if (!rule.actions.some((x) => x.type === 'submit')) failures.push('it closes the form (UserTasks shows the Submitted page / closes after submit: set that on the form\'s buttons)')
          break
        case 'rule_set': break
        case 'open_new': failures.push('it opens a new form'); break
        case 'sign': failures.push('it signs the form (digital signatures are not supported)'); break
        default: failures.push(`the action ${a.element} has no equivalent`)
      }
    }
    const name = clip(rule.name, FORM_RULE_LIMITS.name)
    const condFailed = rule.condition && !cond
    if (!then.length || condFailed) {
      pushRule(b, {
        name, disabled: true, event, ...(target ? { target } : {}), ...(cond ? { if: cond } : {}),
        description: clip(`Not converted: ${failures.join('; ') || 'nothing to do'}.\nOriginal (InfoPath ${rule.rule_set}):\n${original}`, FORM_RULE_LIMITS.description),
        then: then.length ? then : [{ type: 'message', text: clip(`TODO (from InfoPath): ${rule.name}`, 500), tone: 'warning' } as FieldButtonAction],
      })
      return 'manual'
    }
    pushRule(b, {
      name, event, ...(target ? { target } : {}), ...(cond ? { if: cond } : {}),
      ...(rule.enabled ? {} : { disabled: true }),
      ...(failures.length ? { description: clip(`Partly converted — not converted: ${failures.join('; ')}.\nOriginal (InfoPath ${rule.rule_set}):\n${original}`, FORM_RULE_LIMITS.description) } : { description: clip(`From InfoPath ${rule.rule_set}${rule.enabled ? '' : ' (turned off in InfoPath)'}.`, FORM_RULE_LIMITS.description) }),
      then: then.slice(0, FORM_RULE_LIMITS.actions),
    })
    return failures.length ? 'partial' : 'converted'
  }

  /** Row conditions in an editable-table rule read the event's row. */
  const eventRow = (g: DataTableConditionGroup): DataTableConditionGroup => JSON.parse(JSON.stringify(g).replace(/"column":"row\./g, '"column":"event.row.').replace(/\{\{row\./g, '{{event.row.'))

  const resolveTarget = (target: string, context: string): string => {
    const paths = expressionPaths(target, context)
    return paths[0] ?? target
  }

  /* ── validations, calculations ── */

  const convertValidations = (b: FormBuild, view: IpView | null) => {
    const out = new Map<string, ReportStatus | 'na'>()
    for (const v of model.manifest.validations) {
      if (itemStatus.has(v.id)) continue // handled inside a repeating section's items
      const ref = env(b, v.path).resolve(v.path)
      if (!ref || (ref.kind === 'field' && !b.byKey.has(ref.key) )) { out.set(v.id, 'na'); continue }
      if (v.kind === 'blank' && ref.kind === 'field') {
        const f = b.byKey.get(ref.key)!
        f.required = true
        out.set(v.id, 'converted')
        continue
      }
      // ". < 0" style bounds on a number: min / max on the field or column.
      const bound = /^\s*\.\s*(<=?|>=?)\s*(-?\d+(?:\.\d+)?)\s*$/.exec(v.expression)
      if (bound) {
        const n = Number(bound[2])
        const patch = bound[1] === '<' ? { min: n } : bound[1] === '>' ? { max: n } : null
        const target = ref.kind === 'field' ? b.byKey.get(ref.key) : ref.kind === 'column' ? b.lists.get(([...b.lists.entries()].find(([, l]) => l.key === ref.list)?.[0]) ?? '')?.config.columns.find((x) => x.key === ref.column) : undefined
        if (patch && target && ['number', 'currency', 'calculated'].includes(target.type)) { Object.assign(target, patch); out.set(v.id, 'converted'); continue }
      }
      if (ref.kind === 'field' && b.byKey.get(ref.key)?.type === 'email' && /@/.test(v.expression)) { out.set(v.id, 'converted'); continue }
      if (ref.kind === 'column') {
        // A validation on a repeating-table column: the column's own check, judged per row.
        const entry = [...b.lists.values()].find((l) => l.key === ref.list)
        const col = entry?.config.columns.find((x) => x.key === ref.column)
        const cond = toCondition(v.expression, env(b, v.context, ref.list))
        if (col && cond.ok && !entry?.cols) {
          const list = col as unknown as { validations?: unknown[] }
          list.validations = [...(list.validations ?? []), { if: cond.value, message: clip(v.short_message, 300) }].slice(0, 10)
          out.set(v.id, 'converted')
          continue
        }
        todoRule(b, `${v.short_message} (${humanize(v.path)})`, cond.ok ? 'a validation on a repeating part the importer could not attach' : `the condition ${cond.reason}`, v.expression, 'before_submit')
        out.set(v.id, 'manual')
        continue
      }
      if (ref.kind !== 'field') {
        todoRule(b, `${v.short_message} (${humanize(v.path)})`, 'a validation on a repeating part', v.expression, 'before_submit')
        out.set(v.id, 'manual')
        continue
      }
      const cond = toCondition(v.expression, env(b, v.context))
      const action = { type: 'field_error', field: ref.key, text: clip(v.short_message, 300) } as FieldButtonAction
      if (cond.ok) {
        pushRule(b, { name: clip(`Validate: ${v.short_message}`, FORM_RULE_LIMITS.name), description: clip(`From InfoPath data validation${v.message ? ` (${v.message})` : ''}.\nOriginal: ${v.expression}`, FORM_RULE_LIMITS.description), event: 'always', if: cond.value, then: [action] })
        out.set(v.id, 'converted')
      } else {
        pushRule(b, { name: clip(`Validate: ${v.short_message}`, FORM_RULE_LIMITS.name), disabled: true, description: clip(`Not converted: the condition ${cond.reason}.\nOriginal: ${v.expression}`, FORM_RULE_LIMITS.description), event: 'always', then: [action] })
        out.set(v.id, 'manual')
      }
    }
    return out
  }

  const convertCalculations = (b: FormBuild) => {
    const out = new Map<string, { status: ReportStatus | 'na'; detail: string }>()
    for (const calc of model.manifest.calculations) {
      const lower = calc.path.toLowerCase()
      if (isInsideRepeating(calc.path)) { out.set(calc.id, { status: 'na', detail: '' }); continue } // handled per List
      const key = b.placed.get(lower)
      if (!key) { out.set(calc.id, { status: 'na', detail: '' }); continue }
      const field = b.byKey.get(key)!
      const e = env(b, calc.path)
      if (calc.refresh === 'onInit') {
        const r = templateOf(calc.expression, e)
        if (r.ok) {
          pushRule(b, { name: clip(`Default: ${field.label}`, FORM_RULE_LIMITS.name), description: clip(`From an InfoPath default value (calculated once).\nOriginal: ${calc.expression}`, FORM_RULE_LIMITS.description), event: 'form_load', if: { match: 'all', conditions: [{ column: key, operator: 'is_not_set' }] }, then: [{ type: 'set_values', assign: { [key]: r.value } } as FieldButtonAction] })
          out.set(calc.id, { status: 'converted', detail: `Form-load rule sets ${key} = ${clip(r.value, 120)}` })
        } else {
          todoRule(b, `Default for ${field.label}`, `the default value ${r.reason}`, calc.expression)
          out.set(calc.id, { status: 'manual', detail: `Default value not converted: it ${r.reason}.` })
        }
        continue
      }
      const r = toExpression(calc.expression, e)
      if (r.ok && !/\bNOW\(\)/.test(r.value)) {
        // Recalculated: a Label with the expression, stored with the submission.
        const fmt = field.type === 'currency' ? { kind: 'currency', currency: field.currency ?? currency } : field.type === 'number' ? { kind: 'number' } : field.type === 'date' ? { kind: 'date' } : undefined
        const replaced: TaskFieldDef = { key, label: field.label, type: 'label', label_config: { expression: r.value, include: true, ...(fmt ? { format: fmt } : {}) } as TaskFieldDef['label_config'] }
        if (field.help_text) replaced.help_text = field.help_text
        Object.keys(field).forEach((k) => delete (field as unknown as Record<string, unknown>)[k])
        Object.assign(field, replaced)
        out.set(calc.id, { status: 'converted', detail: `Calculated value: a Label with ${clip(r.value, 140)} (kept with the submission)${r.notes.length ? `; ${r.notes.join('; ')}` : ''}` })
      } else {
        const t = templateOf(calc.expression, e)
        if (t.ok) {
          pushRule(b, { name: clip(`Calculate: ${field.label}`, FORM_RULE_LIMITS.name), description: clip(`From an InfoPath calculated default value.\nOriginal: ${calc.expression}`, FORM_RULE_LIMITS.description), event: 'form_load', then: [{ type: 'set_values', assign: { [key]: t.value } } as FieldButtonAction] })
          out.set(calc.id, { status: 'partial', detail: 'Calculated when the form opens (not recalculated as values change).' })
        } else {
          todoRule(b, `Calculate ${field.label}`, `the formula ${r.ok ? 'reads the clock' : r.reason}`, calc.expression)
          out.set(calc.id, { status: 'manual', detail: `Formula not converted: it ${r.ok ? 'reads the current time' : r.reason}.` })
        }
      }
    }
    return out
  }

  /** Hidden supporting fields (read by rules, not on this view). */
  const addSupport = (b: FormBuild, rows: FormRow[]) => {
    const added: string[] = []
    for (const path of b.support) {
      if (b.placed.has(path.toLowerCase())) continue
      const node = nodes.get(path.toLowerCase())
      if (!node) continue
      const key = keys.key(path)
      if (b.byKey.has(key)) continue
      const type: TaskFieldDef['type'] = NUMERIC.has(node.type) ? 'number' : node.type === 'date' ? 'date' : node.type === 'dateTime' ? 'datetime' : node.type === 'boolean' ? 'boolean' : 'text'
      const f: TaskFieldDef = { key, label: humanize(path) || key, type, help_text: 'Hidden: a value InfoPath rules use (not shown on this view).' }
      const dflt = model.defaults[path] ?? node.default
      if (dflt) f.default = type === 'boolean' ? (/^(true|1)$/i.test(dflt) ? 'true' : 'false') : clip(dflt, 500)
      addField(b, f)
      b.placed.set(path.toLowerCase(), key)
      b.hidden.push(`field:${key}`)
      rows.push({ columns: 1, cells: [{ field_key: key, span: 1 }] })
      added.push(key)
    }
    return added
  }

  /* ── build forms ── */

  const ruleStatus = new Map<string, ReportStatus[]>()
  const valStatus = new Map<string, ReportStatus[]>()
  const calcStatus = new Map<string, Array<{ status: ReportStatus; detail: string }>>()
  const note = <T>(map: Map<string, T[]>, id: string, v: T) => map.set(id, [...(map.get(id) ?? []), v])

  const finish = (b: FormBuild, name: string, viewForRules: IpView | null, pageIds: Map<string, string> | null, rowsTarget: () => FormRow[]): GeneratedForm => {
    for (const run of b.pendingExpr.splice(0)) run()
    for (const r of model.manifest.rules) {
      const s = convertRule(b, viewForRules, r, pageIds)
      if (s !== 'na') note(ruleStatus, r.id, s)
    }
    for (const [id, s] of convertValidations(b, viewForRules)) if (s !== 'na') note(valStatus, id, s as ReportStatus)
    for (const [id, s] of convertCalculations(b)) if (s.status !== 'na') note(calcStatus, id, s as { status: ReportStatus; detail: string })
    addSupport(b, rowsTarget())
    // InfoPath digital signatures (certificate-based) → an electronic signature at the end of the form that holds the default view.
    if (model.manifest.signatures.length && (!viewForRules || viewForRules.default) && !b.fields.some((f) => f.type === 'signature')) {
      const key = keys.extra('signature')
      addField(b, { key, label: clip(model.manifest.signatures[0] || 'Signature', 120), type: 'signature', signature: { mode: 'both', statement: 'I confirm the information in this form is correct.' }, help_text: 'This is an electronic signature, not a cryptographic digital signature.' } as unknown as TaskFieldDef)
      rowsTarget().push({ columns: 1, cells: [{ field_key: key, span: 1 }] })
    }
    // Rule budget: the enabled ones first.
    if (b.rules.length > FORM_RULE_LIMITS.rules) {
      const sorted = [...b.rules.filter((r) => !r.disabled), ...b.rules.filter((r) => r.disabled)]
      const dropped = sorted.slice(FORM_RULE_LIMITS.rules)
      b.rules = sorted.slice(0, FORM_RULE_LIMITS.rules)
      report({ area: 'limit', id: `rules:${name}`, name, status: 'manual', detail: `"${name}" needs ${sorted.length} rules; a form holds ${FORM_RULE_LIMITS.rules}. Left out: ${dropped.map((r) => r.name).join(', ')}.` })
    }
    const layout: FormLayout = b.pages
      ? { rows: [], mode: 'steps', pages: b.pages }
      : { rows: b.rows }
    if (b.sections.length) layout.sections = b.sections
    const groups = b.choiceGroups.filter((g) => g.sections.length >= 2).map(({ key, label, sections, display }) => ({ key, label, sections, display }))
    if (groups.length) (layout as unknown as Record<string, unknown>).choice_groups = groups
    if (b.pages && options.pages === 'tabs') layout.mode = 'tabs'
    if (b.rules.length) layout.rules = b.rules
    if (b.hidden.length) layout.state = { hidden: b.hidden }
    layout.source = sourceOf(b.view)
    const fields = b.fields
    return {
      view: b.view,
      name: clip(name, 120),
      input: {
        name: clip(name, 120),
        description: clip(`Imported from the InfoPath form "${model.file_name}"${b.view ? `, view "${b.view}"` : ` (${views.length} views as steps)`}.`, 2000),
        tags,
        fields,
        layout,
      },
      counts: { fields: fields.length, lists: b.lists.size, rules: b.rules.length, disabled_rules: b.rules.filter((r) => r.disabled).length },
    }
  }

  const forms: GeneratedForm[] = []
  if (mode === 'combined') {
    const b = newBuild(null)
    b.pages = []
    const pageIds = new Map<string, string>()
    views.forEach((v, i) => pageIds.set(v.name, `step_${i + 1}`))
    for (const v of views) {
      const rows: FormRow[] = []
      convertItems(b, v, v.items, rows, null, 0)
      b.pages.push({ id: pageIds.get(v.name)!, title: clip(v.caption || v.name, 80), rows })
    }
    forms.push(finish(b, baseName, null, pageIds, () => b.pages![b.pages!.length - 1].rows))
  } else {
    for (const v of views) {
      const b = newBuild(v.name)
      convertItems(b, v, v.items, b.rows, null, 0)
      forms.push(finish(b, views.length > 1 ? `${baseName} — ${v.caption || v.name}` : baseName, v, null, () => b.rows))
    }
  }

  /* ── report ── */

  // One line per view for the fonts, sizes and colours carried over.
  for (const v of views) {
    const n = styledCount.get(v.name) ?? 0
    if (!n) continue
    const base = viewBase.get(v.name)
    const google = [...(googleFontsOf.get(v.name) ?? [])]
    const missing = [...(missingFontsOf.get(v.name) ?? [])]
    const extra = [
      google.length ? `Google Fonts used (served from this site): ${google.join(', ')}` : '',
      missing.length ? `not available, so the theme font is used instead: ${missing.join(', ')}` : '',
    ].filter(Boolean).join('; ')
    report({ area: 'view', id: `fonts:${v.name}`, view: v.name, name: 'Fonts, sizes and colours', status: 'converted', detail: `Font styles: ${n} control${n === 1 ? '' : 's'} keep their font, size, colour or emphasis (text style on the field or List column)${base?.font || base?.size ? `; the view's usual ${[base.font ? textFontLabel(base.font) : '', base.size].filter(Boolean).join(' ')} is left to the form theme` : ''}${extra ? `. ${extra[0].toUpperCase()}${extra.slice(1)}` : ''}.` })
  }

  for (const r of model.manifest.rules) {
    const statuses = ruleStatus.get(r.id) ?? []
    const best: ReportStatus = statuses.includes('converted') ? 'converted' : statuses.includes('partial') ? 'partial' : statuses.length ? 'manual' : 'skipped'
    const btnCaption = r.trigger.kind === 'button' ? (() => { const t = r.trigger as { view: string; control: string; caption?: string }; return t.caption ?? walkControls(model.views.find((v) => v.name === t.view)?.items ?? []).find((c) => c.id === t.control)?.caption ?? t.control })() : ''
    const trig = r.trigger.kind === 'field' ? `when ${humanize(r.trigger.path)} changes` : r.trigger.kind === 'button' ? `button "${btnCaption}", ${r.trigger.view}` : r.trigger.kind === 'load' ? 'form load' : 'submit'
    report({
      area: 'rule', id: r.id, name: `${r.name} (${trig})`, status: best,
      detail: best === 'converted' ? 'Converted to a form rule.' : best === 'partial' ? 'Converted in part: see the rule\'s notes for what is left.' : best === 'manual' ? 'Kept as a disabled rule with the original in its notes.' : `Not on any imported view (${r.trigger.kind === 'button' ? 'its button is on a view that was not imported' : 'the field is not on an imported view'}).`,
      original: [r.condition ? `if ${r.condition}` : '', ...r.actions.map(describeAction)].filter(Boolean).join(' · ').slice(0, 1000),
    })
  }
  for (const v of model.manifest.validations) {
    const statuses = [...(valStatus.get(v.id) ?? []), ...(itemStatus.has(v.id) ? [itemStatus.get(v.id)!] : [])]
    const best: ReportStatus = statuses.includes('converted') ? 'converted' : statuses.length ? 'manual' : 'skipped'
    report({ area: 'validation', id: v.id, name: `${v.short_message} (${humanize(v.path)})`, status: best, detail: v.kind === 'blank' ? (best === 'converted' ? 'Required field.' : 'Field not on an imported view.') : best === 'converted' ? (isInsideRepeating(v.path) ? 'Checked on each row / item (List column validation or an item rule).' : 'Always rule with a field error.') : best === 'manual' ? 'Kept as a disabled rule (see its notes).' : 'Field not on an imported view.', original: v.expression })
  }
  for (const c of model.manifest.calculations) {
    if (items.some((i) => i.area === 'calculation' && i.id === c.id)) continue
    const s = [...(calcStatus.get(c.id) ?? []), ...(itemStatus.has(c.id) ? [{ status: itemStatus.get(c.id)!, detail: itemStatus.get(c.id) === 'converted' ? 'Calculated inside each repeating section item.' : 'A calculation inside a repeating section item that could not be translated.' }] : [])]
    const best = s.find((x) => x.status === 'converted') ?? s.find((x) => x.status === 'partial') ?? s[0]
    report({ area: 'calculation', id: c.id, name: humanize(c.path), status: best?.status ?? 'skipped', detail: best?.detail ?? (isInsideRepeating(c.path) ? 'A calculation on a repeating-table column that is not simple row arithmetic.' : 'The field is not on an imported view.'), original: c.expression })
  }
  for (const conn of model.manifest.connections) report({ area: 'connection', id: `conn:${conn.name}`, name: `${conn.name} (${connectionLabel(conn)})`, status: options.connections?.[conn.name] ? 'partial' : conn.direction === 'submit' && model.manifest.submit?.adapters.includes(conn.name) ? 'converted' : 'manual', detail: connectionAdvice(conn, Boolean(options.connections?.[conn.name]), model.manifest.submit?.adapters.includes(conn.name) ?? false) })
  for (const b of model.manifest.buttons.filter((x) => !x.rule_sets.length && !x.action)) {
    const inView = views.some((v) => v.name === b.view && walkControls(v.items).some((c) => c.id === b.control))
    if (inView) report({ area: 'button', id: `btn:${b.view}:${b.control}`, view: b.view, name: b.caption ?? b.control, status: 'converted', detail: 'Button field (no rules in InfoPath).' })
  }
  for (const role of model.manifest.roles) report({ area: 'role', id: `role:${role.name}`, name: role.name, status: 'partial', detail: `Role checks became conditions on the person's workspace roles (user.roles contains "${role.name}"). Create a workspace role named "${role.name}" (or rename the conditions) and give it to the right people.` })
  for (const sig of model.manifest.signatures) report({ area: 'field', id: `sig:${sig}`, name: sig, status: 'partial', detail: 'InfoPath digital (certificate) signatures become electronic signature fields (drawn or typed, with the signer and time). Certificates aren\'t carried over.' })
  for (const code of model.manifest.code) report({ area: 'code', id: `code:${code}`, name: code, status: 'manual', detail: 'Form code is never imported or run. Rebuild its behaviour with form rules or a workflow.' })
  if (model.manifest.submit) report({ area: 'submit', id: 'submit', name: model.manifest.submit.caption ?? 'Submit', status: 'converted', detail: `Submitting saves the submission in UserTasks${model.manifest.submit.adapters.length ? ` (InfoPath submitted to: ${model.manifest.submit.adapters.join(', ')})` : ''}. To keep rows in a data table, choose "Create a data table" when importing.` })
  for (const v of model.views) {
    if (!views.includes(v)) report({ area: 'view', id: `view:${v.name}`, view: v.name, name: v.caption || v.name, status: 'skipped', detail: 'View not selected for import.' })
  }

  const summary = summarize(model, forms, items)
  const viewsInfo = model.views.map((v) => ({ name: v.name, caption: v.caption, hidden: v.hidden, default: v.default, controls: walkControls(v.items).length }))
  return {
    forms,
    report: {
      form: { name: baseName, file_name: model.file_name, hash: model.hash, format: model.format, views: viewsInfo, browser_enabled: model.manifest.browser_enabled },
      summary,
      items: dedupe(items),
      warnings: [...model.warnings, ...model.manifest.warnings].slice(0, 100),
    },
  }
}

function dedupe(items: ReportItem[]): ReportItem[] {
  const rank: Record<ReportStatus, number> = { converted: 3, partial: 2, manual: 1, skipped: 0 }
  const map = new Map<string, ReportItem>()
  for (const i of items) {
    const k = `${i.area}|${i.id}`
    const prev = map.get(k)
    if (!prev || rank[i.status] > rank[prev.status]) map.set(k, i)
  }
  return [...map.values()]
}

function summarize(model: InfoPathModel, forms: GeneratedForm[], items: ReportItem[]): ImportSummary {
  const dd = dedupe(items)
  const of = (area: ReportArea) => dd.filter((i) => i.area === area && i.status !== 'skipped')
  const rules = of('rule')
  const vals = of('validation')
  const calcs = of('calculation')
  const fmts = of('formatting')
  return {
    views: model.views.length,
    forms: forms.length,
    fields: new Set(forms.flatMap((f) => f.input.fields.filter((x) => !['heading', 'divider', 'label', 'button'].includes(x.type)).map((x) => x.key))).size,
    repeating: new Set(forms.flatMap((f) => f.input.fields.filter((x) => x.type === 'list' || (x.type as string) === 'repeating_section').map((x) => x.key))).size,
    rules: { total: rules.length, converted: rules.filter((i) => i.status === 'converted').length, partial: rules.filter((i) => i.status === 'partial').length, manual: rules.filter((i) => i.status === 'manual').length },
    validations: { total: vals.length, converted: vals.filter((i) => i.status === 'converted').length, manual: vals.filter((i) => i.status !== 'converted').length },
    calculations: { total: calcs.length, converted: calcs.filter((i) => i.status === 'converted').length, manual: calcs.filter((i) => i.status !== 'converted').length },
    // Colours snapped to theme tones are "partly converted" in the report but count as converted here.
    formatting: { total: fmts.length, converted: fmts.filter((i) => i.status === 'converted' || i.status === 'partial').length, manual: fmts.filter((i) => i.status === 'manual').length },
    connections: model.manifest.connections.length,
  }
}

export function describeAction(a: IpRuleAction): string {
  switch (a.type) {
    case 'assign': return `set ${a.target} = ${a.expression}`
    case 'dialog': return `show "${a.text}"`
    case 'dialog_expression': return `show ${a.expression}`
    case 'switch_view': return `switch to view "${a.view}"`
    case 'query': return `query ${a.adapter}`
    case 'submit': return `submit to ${a.adapter}`
    case 'close': return 'close the form'
    case 'rule_set': return `run ${a.rule_set}`
    default: return a.element
  }
}

function connectionLabel(c: IpDataConnection): string {
  const t: Record<string, string> = { sharepoint_list: 'SharePoint list', web_service: 'web service', xml_file: 'XML file', database: 'database', sharepoint_library: 'SharePoint library', email: 'email', connection_file: 'connection file', hosting: 'hosting environment' }
  return `${t[c.type] ?? c.type}, ${c.direction}`
}

function connectionAdvice(c: IpDataConnection, mapped: boolean, mainSubmit: boolean): string {
  if (mainSubmit) return 'The form\'s submit: UserTasks keeps each submission; turn on "Create a data table" to store rows, or start a workflow on submit.'
  if (mapped) return 'Matched a UserTasks data table / API reference by name: query rules use it (check the outputs).'
  if (c.type === 'sharepoint_list' || c.type === 'xml_file') return `Create a data table${c.fields?.length ? ` with ${c.fields.slice(0, 8).join(', ')}${c.fields.length > 8 ? '…' : ''}` : ''} and import the data, then use it for options (dynamic options) or a Table list rule.${c.source ? ` Source: ${c.source}` : ''}`
  if (c.type === 'web_service') return `Set up an integration (API reference) for this service and use a Call API reference rule.${c.source ? ` Service: ${c.source}` : ''}`
  if (c.type === 'database') return 'Connect the database as an integration, or copy the data into a data table.'
  return 'Not converted: recreate it as a data table or an integration if the form needs it.'
}

/* ── Markdown ─────────────────────────────────────────────────────────── */

const STATUS_TEXT: Record<ReportStatus, string> = { converted: 'Converted', partial: 'Partly converted', manual: 'Needs attention', skipped: 'Not converted' }

export function reportMarkdown(report: ImportReport): string {
  const s = report.summary
  const lines = [
    `# InfoPath import: ${report.form.name}`,
    '',
    `File: ${report.form.file_name} (${report.form.format.toUpperCase()}, sha256 ${report.form.hash.slice(0, 12)}…)`,
    '',
    '## Summary',
    '',
    `- Views: ${s.views} → forms: ${s.forms}`,
    `- Fields: ${s.fields} (repeating tables / sections as Lists: ${s.repeating})`,
    `- Rules: ${s.rules.converted} of ${s.rules.total} converted${s.rules.partial ? `, ${s.rules.partial} in part` : ''}${s.rules.manual ? `, ${s.rules.manual} need attention` : ''}`,
    `- Validation: ${s.validations.converted} of ${s.validations.total} converted`,
    `- Calculations: ${s.calculations.converted} of ${s.calculations.total} converted`,
    `- Conditional formatting: ${s.formatting.converted} of ${s.formatting.total} converted`,
    `- Data connections: ${s.connections}`,
    '',
    '## Views',
    '',
    ...report.form.views.map((v) => `- ${v.caption || v.name}${v.default ? ' (default)' : ''}${v.hidden ? ' (hidden in InfoPath)' : ''}: ${v.controls} controls`),
  ]
  const areas: Array<[ReportArea, string]> = [['repeating', 'Repeating tables and sections'], ['field', 'Fields'], ['rule', 'Rules'], ['validation', 'Validation'], ['calculation', 'Calculations'], ['formatting', 'Conditional formatting'], ['connection', 'Data connections'], ['button', 'Buttons'], ['submit', 'Submit'], ['role', 'Roles'], ['code', 'Code'], ['view', 'Views'], ['limit', 'Limits']]
  for (const [area, title] of areas) {
    const list = report.items.filter((i) => i.area === area)
    if (!list.length) continue
    lines.push('', `## ${title}`, '')
    for (const i of list) {
      lines.push(`- **${STATUS_TEXT[i.status]}** — ${i.name}${i.view ? ` _(${i.view})_` : ''}: ${i.detail}`)
      if (i.original) lines.push(`  - Original: \`${i.original.replace(/`/g, "'").slice(0, 400)}\``)
    }
  }
  if (report.warnings.length) lines.push('', '## Warnings', '', ...report.warnings.map((w) => `- ${w}`))
  return `${lines.join('\n')}\n`
}

/**
 * An InfoPath expression box's display format (xd:datafmt, or the
 * xdFormatting:formatString(x, "currency", "numDigits:2;…") it wraps) as a
 * Label cell format: currency (in the import's currency), number (its
 * decimals), percentage (InfoPath stores 0–1 fractions), date / date-time.
 * Null when it has none (plain text / numbers).
 */
export function labelFormatFromInfoPath(expr: string, datafmt: string | undefined, options: string | undefined, currency = 'USD'): CellFormat | null {
  const wrapped = /^\s*xdFormatting:formatString\(\s*[^,]+,\s*"([^"]*)"\s*(?:,\s*"([^"]*)")?\s*\)\s*$/.exec(expr ?? '')
  const kind = (wrapped?.[1] ?? datafmt ?? '').toLowerCase()
  const opts = (wrapped?.[2] ?? options ?? '').toLowerCase()
  const digits = /numdigits:(\d+)/.exec(opts)
  const decimals = digits ? Math.min(10, Number(digits[1])) : undefined
  const withDecimals = <T extends CellFormat>(f: T): T => (decimals !== undefined ? { ...f, decimals } : f)
  if (kind === 'currency') return withDecimals({ kind: 'currency', currency })
  if (kind === 'number') return withDecimals({ kind: 'number' })
  if (kind === 'percentage' || kind === 'percent') return withDecimals({ kind: 'percent', percent_source: 'fraction' })
  if (kind === 'datetime') return { kind: 'datetime' }
  if (kind === 'date') return { kind: 'date' }
  return null
}
