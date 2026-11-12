/**
 * The public (anonymous) InfoPath preview on the marketing site: the
 * analyzer and generator run on an uploaded .xsn, and only a DERIVED summary
 * goes back — counts, what the importer made (repeating sections, nested
 * Lists, pictures, signatures, styles, role conditions, translated XPath
 * functions…), views with their field labels and types, the items that need
 * a person, and the first view as a form definition for the preview.
 * No XPath expressions, rule notes, data-connection addresses, file lists,
 * hashes or provenance go back. The visitor's own pictures do (display
 * images and default pictures, raster only, within a byte budget) so the
 * preview looks like the form; nothing is stored.
 *
 * Tighter caps than the signed-in importer: 4 MB in, 40 MB unpacked, 400
 * files, an 8 s budget.
 */
import { analyzeInfoPath } from './analyze'
import { generateForms, type GeneratedForm, type ReportStatus } from './generate'
import { TASK_FIELD_TYPE_LABELS, type TaskFieldDef, type TaskFieldType } from '@/lib/task-field-schema'
import { ALWAYS_ACTIONS, type FormRule } from '@/lib/forms/form-rules'
import { FUNCTION_CATALOG } from '@/lib/expression-functions'
import type { FormLayout, FormRow } from '@/lib/forms/layout'
import { formGoogleFontFamilies } from '@/lib/forms/form-fonts'

const MB = 1024 * 1024
export const PUBLIC_INFOPATH_LIMITS = { maxInputBytes: 4 * MB, maxTotalBytes: 40 * MB, maxFiles: 400, budgetMs: 8000, previewFields: 80, previewImageBytes: 768 * 1024 } as const

/** What the importer made, by kind: shown as "What converts" (only kinds with a count). */
export type PublicInfoPathFeatureKey =
  | 'lists' | 'nested_lists' | 'repeating_sections' | 'calculated_columns' | 'images' | 'display_images' | 'signatures'
  | 'rich_text' | 'text_lists' | 'people' | 'choice_groups' | 'styles' | 'cell_rules' | 'column_rules' | 'text_styles' | 'google_fonts' | 'list_validations' | 'roles' | 'functions'
export interface PublicInfoPathFeature { key: PublicInfoPathFeatureKey; label: string; count: number; items?: string[] }

export interface PublicInfoPathSummary {
  name: string
  views: Array<{ name: string; default: boolean; fields: Array<{ label: string; type: string; type_label: string; required?: boolean; columns?: string[] }> }>
  counts: { views: number; fields: number; repeating: number; rules: { total: number; converted: number; partial: number }; validations: { total: number; converted: number }; calculations: { total: number; converted: number }; formatting: { total: number; converted: number }; connections: number }
  /** What converted, by kind (repeating sections, nested Lists, pictures, signatures, styles, roles, XPath functions…). */
  features: PublicInfoPathFeature[]
  /** Items that need a person after the import (area + a short, derived description). */
  attention: Array<{ area: string; name: string; detail: string }>
  /** The first view as a UserTasks form: its "Always" rules (styles, hide, lock, errors) kept so the preview reacts; nothing that calls out. */
  preview: { name: string; fields: TaskFieldDef[]; layout: FormLayout } | null
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** How the preview names a field's type: the designer's labels, with the InfoPath-facing wording where it reads better. */
const TYPE_LABEL_OVERRIDES: Partial<Record<TaskFieldType, string>> = { label: 'Calculated value', boolean: 'Yes / no', choice: 'Choice', user: 'Person picker', display_image: 'Display image', list: 'List (repeating table)' }
export function publicTypeLabel(type: string): string {
  return TYPE_LABEL_OVERRIDES[type as TaskFieldType] ?? TASK_FIELD_TYPE_LABELS[type as TaskFieldType] ?? type
}

type AnyField = TaskFieldDef & Record<string, any>
const subFields = (f: AnyField): AnyField[] => (f.type === 'repeating_section' ? f.repeating_section?.fields ?? [] : [])

export function publicInfoPathSummary(bytes: Uint8Array, fileName = 'form.xsn'): PublicInfoPathSummary {
  const model = analyzeInfoPath(bytes, { fileName, budgetMs: PUBLIC_INFOPATH_LIMITS.budgetMs, limits: PUBLIC_INFOPATH_LIMITS })
  const { forms, report } = generateForms(model, { mode: 'per_view' })
  const s = report.summary
  const first = forms[0]
  const display = new Set(['heading', 'divider', 'label', 'button', 'display_image'])
  return {
    name: clip(report.form.name, 120),
    views: forms.map((f) => ({
      name: clip(f.view ?? f.name, 120),
      default: model.views.find((v) => v.name === f.view)?.default ?? false,
      fields: (f.input.fields as AnyField[]).filter((x) => !display.has(x.type)).slice(0, 200).map((x) => ({
        label: clip(x.label, 120), type: x.type, type_label: publicTypeLabel(x.type), ...(x.required ? { required: true } : {}),
        ...(x.list ? { columns: x.list.columns.map((c: { label: string }) => clip(c.label, 60)) } : {}),
        ...(x.type === 'repeating_section' ? { columns: subFields(x).filter((c) => !display.has(c.type)).map((c) => clip(c.label, 60)) } : {}),
      })),
    })),
    counts: {
      views: s.views, fields: s.fields, repeating: s.repeating,
      rules: { total: s.rules.total, converted: s.rules.converted, partial: s.rules.partial },
      validations: { total: s.validations.total, converted: s.validations.converted },
      calculations: { total: s.calculations.total, converted: s.calculations.converted },
      formatting: { total: s.formatting.total, converted: s.formatting.converted },
      connections: s.connections,
    },
    features: featuresOf(forms),
    attention: report.items.filter((i) => i.status === ('manual' satisfies ReportStatus)).slice(0, 30).map((i) => ({ area: i.area, name: clip(i.name, 120), detail: clip(i.detail.replace(/https?:\/\/\S+|\.\.\/\S+/g, '…'), 240) })),
    preview: first ? previewOf(first.name, first.input.fields, first.input.layout) : null,
  }
}

/* ── What converted ──────────────────────────────────────────────────── */

const FEATURE_LABELS: Record<PublicInfoPathFeatureKey, string> = {
  lists: 'Repeating tables → Lists',
  nested_lists: 'Nested repeating tables → nested Lists',
  repeating_sections: 'Repeating sections',
  calculated_columns: 'Row formulas → calculated columns',
  images: 'Picture controls → Image fields',
  display_images: 'Pictures in the view → Display images',
  signatures: 'Signatures and ink → Signature fields (per row and per item in repeating tables and sections too)',
  rich_text: 'Rich text boxes',
  text_lists: 'Bulleted and numbered lists',
  people: 'People pickers',
  choice_groups: 'Choice sections → choice groups',
  styles: 'Conditional formatting → styles',
  cell_rules: 'Cells hidden or locked per row',
  column_rules: 'Columns hidden by form conditions',
  text_styles: 'Fonts, sizes and colours',
  google_fonts: 'Fonts → Google Fonts',
  list_validations: 'Validation on repeating fields',
  roles: 'User roles → role conditions',
  functions: 'XPath functions translated',
}
const KNOWN_FUNCTIONS = new Set(FUNCTION_CATALOG.map((f) => f.name))
const usesRoles = (rule: FormRule) => JSON.stringify(rule.if ?? {}).includes('"user.roles"')

function featuresOf(forms: GeneratedForm[]): PublicInfoPathFeature[] {
  const seen = new Map<PublicInfoPathFeatureKey, Set<string>>()
  const add = (k: PublicInfoPathFeatureKey, id: string) => { if (!seen.has(k)) seen.set(k, new Set()); seen.get(k)!.add(id) }
  const functions = new Set<string>()
  const scanFunctions = (value: unknown) => { for (const m of JSON.stringify(value ?? '').matchAll(/\b([A-Z][A-Z0-9_]{1,30})\(/g)) if (KNOWN_FUNCTIONS.has(m[1]) && m[1] !== "PLUCK") functions.add(m[1]) }
  const rulesOf = (rules: FormRule[] | undefined, at: string) => {
    for (const r of rules ?? []) {
      if (r.disabled) continue
      scanFunctions(r.then)
      if (r.then.some((a) => a.type === 'set_style')) add('styles', `${at}:${r.id}`)
      if (r.then.some((a) => a.type === 'show_hide' && (a.targets ?? []).some((t) => t.startsWith('column:')))) add('column_rules', `${at}:${r.id}`)
      if (usesRoles(r)) add('roles', `${at}:${r.id}`)
      if (at !== 'form' && r.then.some((a) => a.type === 'field_error')) add('list_validations', `${at}:${r.id}`)
    }
  }
  const columns = (cols: Array<Record<string, any>>, at: string, depth: number) => {
    for (const c of cols) {
      if (c.type === 'calculated') { add('calculated_columns', `${at}.${c.key}`); scanFunctions(c.formula) }
      if (c.text_style) add('text_styles', `${at}.${c.key}`)
      if (c.type === 'signature') add('signatures', `${at}.${c.key}`)
      for (const [i] of (c.validations ?? []).entries()) add('list_validations', `${at}.${c.key}:${i}`)
      if (c.type === 'list' && c.list) list(c.list, `${at}.${c.key}`, depth + 1)
    }
  }
  const list = (cfg: Record<string, any>, at: string, depth: number) => {
    add(depth ? 'nested_lists' : 'lists', at)
    for (const [i] of (cfg.row_styles ?? []).entries()) add('styles', `${at}:row_style:${i}`)
    for (const [i] of (cfg.cell_rules ?? []).entries()) add('cell_rules', `${at}:cell_rule:${i}`)
    for (const [i] of (cfg.row_validations ?? []).entries()) add('list_validations', `${at}:row:${i}`)
    columns(cfg.columns ?? [], at, depth)
  }
  const fields = (fs: AnyField[], at: string, depth: number) => {
    for (const f of fs) {
      const id = `${at}.${f.key}`
      if (f.text_style) add('text_styles', id)
      if (f.type === 'list' && f.list) list(f.list, id, depth)
      else if (f.type === 'repeating_section') {
        add('repeating_sections', id)
        fields(subFields(f), id, depth + 1)
        rulesOf(f.repeating_section?.layout?.rules, id)
      } else if (f.type === 'image') add('images', id)
      else if (f.type === 'display_image') add('display_images', id)
      else if (f.type === 'signature') add('signatures', id)
      else if (f.type === 'rich_text') add('rich_text', id)
      else if (f.type === 'text_list') add('text_lists', id)
      else if (f.type === 'user') add('people', id)
      if (f.type === 'label') scanFunctions(f.label_config?.expression)
    }
  }
  // Fonts the view used that map to a Google Fonts family (text styles and set_style rules).
  const googleFamilies = new Set<string>()
  for (const form of forms) for (const f of formGoogleFontFamilies(form.input.fields, form.input.layout)) googleFamilies.add(f)
  for (const form of forms) {
    // Keyed by field key, so a field on several views counts once.
    fields(form.input.fields as AnyField[], '', 0)
    rulesOf(form.input.layout.rules, 'form')
    for (const g of form.input.layout.choice_groups ?? []) add('choice_groups', g.key)
  }
  const out: PublicInfoPathFeature[] = []
  for (const key of Object.keys(FEATURE_LABELS) as PublicInfoPathFeatureKey[]) {
    if (key === 'functions') { if (functions.size) out.push({ key, label: FEATURE_LABELS[key], count: functions.size, items: [...functions].sort().slice(0, 20) }); continue }
    if (key === 'google_fonts') { if (googleFamilies.size) out.push({ key, label: FEATURE_LABELS[key], count: googleFamilies.size, items: [...googleFamilies].sort().slice(0, 20) }); continue }
    const n = seen.get(key)?.size ?? 0
    if (n) out.push({ key, label: FEATURE_LABELS[key], count: n })
  }
  return out
}

/* ── The preview ─────────────────────────────────────────────────────── */

/** Actions the preview keeps: "Always" rules that only change how the form looks or checks (nothing runs a query, a workflow or a message). */
const PREVIEW_ACTIONS: ReadonlySet<string> = new Set([...ALWAYS_ACTIONS].filter((a) => a !== 'block_submit'))
function previewRules(rules: FormRule[] | undefined): FormRule[] {
  return (rules ?? [])
    .filter((r) => !r.disabled && r.event === 'always' && r.then.length && r.then.every((a) => PREVIEW_ACTIONS.has(a.type)))
    .map(({ description: _d, ...rest }) => rest)
}

const SAFE_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/

/** A static, bounded preview: no notes, no help text, no provenance; pictures only within the byte budget. */
function previewOf(name: string, fields: TaskFieldDef[], layout: FormLayout): PublicInfoPathSummary['preview'] {
  let imageBytes = 0
  const fits = (src: unknown) => {
    if (typeof src !== 'string' || !SAFE_IMAGE.test(src)) return false
    if (imageBytes + src.length > PUBLIC_INFOPATH_LIMITS.previewImageBytes) return false
    imageBytes += src.length
    return true
  }
  const clean = (f: AnyField): AnyField | null => {
    if (f.type === 'button') return null
    const { help_text: _h, ...rest } = f as AnyField
    const out = rest as AnyField
    if (f.type === 'display_image' && !fits(f.display_image?.src)) return null
    if (f.type === 'image' && f.image?.default_file && !fits(f.image.default_file.url)) out.image = { ...f.image, default_file: undefined }
    if (f.type === 'repeating_section' && f.repeating_section) {
      const inner = f.repeating_section.fields.map(clean).filter(Boolean) as AnyField[]
      const lay = f.repeating_section.layout
      const keys = new Set(inner.map((x) => x.key))
      out.repeating_section = {
        ...f.repeating_section,
        fields: inner,
        ...(lay ? { layout: { ...lay, rows: lay.rows.map((r: FormRow) => ({ ...r, cells: r.cells.filter((c) => keys.has(c.field_key)) })).filter((r: FormRow) => r.cells.length), rules: previewRules(lay.rules) } } : {}),
      }
    }
    return out
  }
  const kept = fields.slice(0, PUBLIC_INFOPATH_LIMITS.previewFields).map((f) => clean(f as AnyField)).filter(Boolean) as TaskFieldDef[]
  const keys = new Set(kept.map((f) => f.key))
  const rows = (layout.rows ?? []).map((r) => ({ ...r, cells: r.cells.filter((c) => keys.has(c.field_key)) })).filter((r) => r.cells.length).map((r) => ({ ...r, columns: Math.max(1, Math.min(r.columns, r.cells.length)) }))
  const out: FormLayout = { rows }
  if (layout.sections?.length) out.sections = layout.sections
  if (layout.choice_groups?.length) out.choice_groups = layout.choice_groups
  const rules = previewRules(layout.rules).filter((r) => r.then.every((a) => !('targets' in a) || !a.targets?.length || a.targets.every((t: string) => (!t.startsWith('field:') || keys.has(t.slice(6))) && (!t.startsWith('column:') || keys.has(t.slice(7).split('.')[0])))))
  if (rules.length) out.rules = rules
  return { name: clip(name, 120), fields: kept, layout: out }
}
