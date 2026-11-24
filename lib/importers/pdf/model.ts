/**
 * The PDF importer's intermediate model (client-safe, pure): what the
 * deterministic readers (AcroForm, XFA, printed routing text) find in a PDF
 * form, and what the optional AI assist must return — the same shape,
 * validated with zod (pdfModelSchema) and never trusted beyond it.
 *
 *   PdfFormModel  title, kind, pages, sections, items (reading order), rules
 *   PdfItem       one question / field: type, label + where the label came
 *                 from, options, required + why, the PDF fields it merges
 *   PdfRule       show / hide while a condition holds, with its confidence
 *                 and the original text / script it came from
 *
 * build.ts turns it into UserTasks form fields, a layout and form rules;
 * report.ts into the mapping report. `origin: 'ai'` marks anything the AI
 * assist added or changed ("AI — review" in the report).
 */

import { z } from 'zod'

export type PdfKind = 'acroform' | 'hybrid' | 'xfa' | 'flat' | 'scanned'

export const PDF_ITEM_TYPES = ['text', 'textarea', 'number', 'currency', 'date', 'email', 'phone', 'boolean', 'choice', 'multi_choice', 'signature'] as const
export type PdfItemType = (typeof PDF_ITEM_TYPES)[number]

export type PdfLabelSource = 'tooltip' | 'xfa_caption' | 'nearby_text' | 'field_name' | 'table_header' | 'ai'
export type PdfRequiredSource = 'flag' | 'xfa' | 'asterisk' | 'text' | 'ai'
export type PdfOrigin = 'deterministic' | 'ai'

export interface PdfOption { value: string; label: string }

export interface PdfItem {
  /** Stable id: the PDF field name (or the first of the merged ones), `ai_<n>` for AI-found questions. */
  id: string
  type: PdfItemType
  label: string
  labelSource: PdfLabelSource
  /** The printed question number ("4", "6a"), when found. */
  question?: string
  page: number
  /** A section id (model.sections). */
  section?: string
  /** PDF user space [x0, y0, x1, y1] (y up) of the first widget. */
  rect?: [number, number, number, number]
  required?: boolean
  requiredSource?: PdfRequiredSource
  readOnly?: boolean
  maxLength?: number
  pattern?: string
  patternMessage?: string
  min?: number
  max?: number
  /** currency: ISO code (from the Acrobat format's symbol; default USD). */
  currency?: string
  options?: PdfOption[]
  display?: 'radio' | 'dropdown' | 'checkboxes' | 'listbox'
  help?: string
  /** Starts hidden (Acrobat display.hidden / XFA presence hidden). */
  hidden?: boolean
  /** The PDF field names this item stands for (merged comb boxes, exclusive checkbox groups). */
  sourceFields: string[]
  origin: PdfOrigin
  /** What the readers did (merged boxes, translated scripts …): shown in the report. */
  notes: string[]
  /** Scripts that were not translated (event + the start of the script): kept for the report, never run. */
  untranslated?: Array<{ event: string; js: string }>
  /** Acrobat calculation (AFSimple_Calculate, or plain arithmetic: EXPR with $0, $1 … for `fields`): becomes a calculated (Label) field. */
  calc?: { op: string; fields: string[]; expr?: string }
}

export interface PdfSection {
  id: string
  title: string
  page?: number
  /** Starts hidden (XFA presence). */
  hidden?: boolean
  /** XFA occur max > 1: a repeating subform (imported once). */
  repeats?: boolean
  origin: PdfOrigin
}

export type PdfRuleSource = 'acrobat_js' | 'xfa_script' | 'printed_text' | 'ai'

export interface PdfCondition {
  /** An item id. */
  item: string
  op: 'equals' | 'not_equals' | 'is_set' | 'is_not_set'
  value?: string
}

export interface PdfRule {
  id: string
  /** While `when` holds: show the targets (hidden otherwise) / hide them. */
  mode: 'show' | 'hide'
  when: PdfCondition | null
  /** More conditions, any of which also makes the rule apply (OR with `when`). */
  any?: PdfCondition[]
  /** Item ids, or `section:<id>`. */
  targets: string[]
  /** high → an enabled rule; low → created turned off with the original in its description. */
  confidence: 'high' | 'low'
  source: PdfRuleSource
  /** The printed sentence or the script it came from. */
  original: string
  /** Why it is low confidence (shown in the rule's description and the report). */
  reason?: string
  origin: PdfOrigin
}

/** Where a table column's label came from. */
export type PdfColumnLabelSource = 'header' | 'spanning_header' | 'tooltip' | 'xfa_caption' | 'field_name'

export interface PdfTableColumn {
  label: string
  labelSource: PdfColumnLabelSource
  type: PdfItemType
  /** The item whose settings (options, format, length …) the column takes. */
  template: string
  /** The cell item per table row (null: no box in that row). */
  cells: Array<string | null>
  /** Every cell is required in the PDF. */
  required?: boolean
  /** The rest of a long header ("For example …"): the control's help text. */
  help?: string
}

/**
 * A table of boxes (rows of the same inputs) found in the PDF (tables.ts):
 * built as ONE repeating section instead of rows × columns fields, unless
 * the person keeps it as separate fields. Its cells stay in `items` (with
 * "Header (row label)" labels) so either choice can be built from one analysis.
 */
export interface PdfTable {
  /** Stable within one analysis: `table_<n>`. */
  id: string
  /** The list's name ("Rooms"). */
  name: string
  page: number
  /** Every page it spans (a table continued on the next page is one table). */
  pages: number[]
  /** Rows in the PDF (the default maximum). */
  rows: number
  /** XFA: the subform's occur max (null = unlimited); AcroForm tables: rows. */
  maxRows: number | null
  columns: PdfTableColumn[]
  /**
   * The text printed left of each row. generic ("Room #1", "1.", "Item 3") →
   * dropped (the list is named after them); category (fixed rows such as
   * "Rent", "Food") → a choice column; none → no row labels.
   */
  rowLabelMode: 'none' | 'generic' | 'category'
  rowLabels?: string[]
  /** category: the header printed above the row labels ("Expense"). */
  rowLabelHeader?: string
  /** generic: the noun of the row labels ("Room"). */
  noun?: string
  /** Every cell item it absorbs (in row order). */
  itemIds: string[]
  /** Calculated PDF fields that add up a column (AFSimple_Calculate SUM): a total over the list. */
  totals: Array<{ item: string; column: number }>
  /** Why it was taken as a table (geometry, header, name pattern …): shown in the report. */
  evidence: string[]
  source: 'layout' | 'xfa'
}

export interface PdfFormModel {
  title: string
  kind: PdfKind
  pages: number
  sections: PdfSection[]
  items: PdfItem[]
  rules: PdfRule[]
  /** Tables of boxes found (tables.ts): repeating lists unless kept as fields. */
  tables?: PdfTable[]
  /** Facts for the report (what was read, what was left out). */
  notes: string[]
}

/* ── zod: the AI assist's answer ─────────────────────────────────────── */

const text = (max: number) => z.string().trim().max(max)
const id = z.string().trim().min(1).max(200)

export const pdfOptionSchema = z.object({ value: text(200).min(1), label: text(300) })

export const pdfItemSchema = z.object({
  id,
  type: z.enum(PDF_ITEM_TYPES),
  label: text(500).min(1),
  question: text(20).optional(),
  page: z.number().int().min(1).max(10_000),
  section: id.optional(),
  required: z.boolean().optional(),
  maxLength: z.number().int().min(1).max(100_000).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  options: z.array(pdfOptionSchema).max(200).optional(),
  display: z.enum(['radio', 'dropdown', 'checkboxes', 'listbox']).optional(),
  help: text(1000).optional(),
  /** The PDF field names the item stands for (empty for flat / scanned PDFs). */
  sourceFields: z.array(id).max(50).optional(),
})

export const pdfRuleSchema = z.object({
  id: id.optional(),
  mode: z.enum(['show', 'hide']),
  when: z.object({ item: id, op: z.enum(['equals', 'not_equals', 'is_set', 'is_not_set']), value: text(300).optional() }),
  targets: z.array(id).min(1).max(100),
  confidence: z.enum(['high', 'low']).optional(),
  original: text(1000).optional(),
})

export const pdfSectionSchema = z.object({ id, title: text(300).min(1), page: z.number().int().min(1).max(10_000).optional() })

/** What the AI assist must answer with (the intermediate model's shape, without the deterministic bookkeeping). */
export const pdfModelSchema = z.object({
  title: text(200).optional(),
  sections: z.array(pdfSectionSchema).max(200).optional(),
  items: z.array(pdfItemSchema).max(2000),
  rules: z.array(pdfRuleSchema).max(300).optional(),
})

export type PdfModelAnswer = z.infer<typeof pdfModelSchema>

export const ITEM_TYPE_LABEL: Record<PdfItemType, string> = {
  text: 'Text', textarea: 'Long text', number: 'Number', currency: 'Currency', date: 'Date', email: 'Email', phone: 'Phone',
  boolean: 'Checkbox', choice: 'Single choice', multi_choice: 'Multiple choice', signature: 'Signature',
}

export const LABEL_SOURCE_TEXT: Record<PdfLabelSource, string> = {
  tooltip: 'the field\'s tooltip', xfa_caption: 'the form\'s XFA caption', nearby_text: 'text printed next to the field', field_name: 'the field\'s internal name', table_header: 'the table\'s column header and row label', ai: 'the AI assist',
}

/** A readable label from a PDF field name ("topmostSubform[0].Page1[0].f1_01[0]" → "f1 01"). */
export function humanizeFieldName(name: string): string {
  // "Name 1.1.2" / "Bed Type.3": a bare number is not a label — keep the segments from the last one with letters.
  const parts = String(name).replace(/\[\d+\]/g, '').split('.')
  let from = parts.length - 1
  while (from > 0 && !/[A-Za-z]/.test(parts[from])) from--
  const last = parts.slice(from).join(' ')
  return last.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim() || String(name).slice(0, 60)
}

/** Clean a label: whitespace, trailing colons / dots leaders, the required marker (reported separately). */
export function cleanLabel(raw: string): string {
  return String(raw ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s*(?:\.\s?){3,}\s*$/, '')
    .replace(/\s+/g, ' ')
    .replace(/^\*\s*/, '')
    .replace(/\s*\*$/, '')
    .replace(/\s*(?:[:：]\s*)+$/, '')
    .trim()
    .slice(0, 500)
}
