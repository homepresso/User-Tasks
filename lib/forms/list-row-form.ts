/**
 * The List row pop-out: one row of a List shown as a form in a dialog — to
 * edit it (an editable List: "Open row", "Add in form", the rule step
 * open_row_form) or to read it (a read-only List: "View row").
 *
 *  - Layout: one column below ROW_FORM_BREAKPOINT (768px; a full-screen
 *    sheet), two columns from there; wide columns (long text, nested Lists)
 *    span both. The order and section headings come from list.row_form.layout.
 *  - Editing works on the List's own rows, the way inline cells do (cell
 *    changes reach the form at once — rules, calculated columns, lookups
 *    reading {{row.*}}); the dialog remembers the row as it was when it
 *    opened. Save checks the row (required, types, bounds, the column and
 *    row validations) and commits it — its pending marker goes, like Commit
 *    row; Cancel puts the row back (a row the dialog added goes again).
 *  - Reading formats every value for people (formatRowValue): currency in
 *    its currency, dates, choice labels, Yes / No, links, pictures,
 *    signatures, long and rich text, "—" for nothing.
 *
 * Pure and isomorphic (the dialog in components/forms/list-row-dialog.tsx).
 */

import { isPlainObject } from '@/lib/utils/guards'
import { formatDate } from '@/lib/format/date'
import { safeLinkHref } from '@/lib/html-sanitize'
import { attachmentPath, fileExtension } from './attachments'
import { resolveStorageUrl } from '@/lib/storage/refs'
import { isImageUrl, normalizeImageValue, normalizeSignatureValue, formatSignedAt } from './media-fields'
import { sanitizeRichText } from './rich-text'
import { URL_LINK_SCHEMES, isAllowedUrl } from './link-field'
import {
  ROW_DRAFT_KEY, blankListRow, coerceListRow, formatListCell, listColumnWritable, listRowErrors, rawListRows, rowDraftState, shownColumns, stripRowMarkers,
  type ListCheckContext, type ListColumn, type ListFieldConfig, type ListRowEditing,
} from './list-field'

/* ── Layout ──────────────────────────────────────────────────────────── */

/** From this width (px) the row form has two columns and is a centred dialog; below it, one column in a full-screen sheet. */
export const ROW_FORM_BREAKPOINT = 768

export interface RowFormLayout {
  columns: 1 | 2
  /** Full-screen sheet (phones, narrow windows). */
  sheet: boolean
}

/** The row form's layout for a viewport `width` (px). */
export function rowFormLayout(width: number): RowFormLayout {
  const wide = Number.isFinite(width) && width >= ROW_FORM_BREAKPOINT
  return { columns: wide ? 2 : 1, sheet: !wide }
}

/** Column types that take the whole row of the form (both columns). */
const WIDE_TYPES: ReadonlySet<string> = new Set(['textarea', 'list', 'rich_text', 'signature', 'image'])

export function isWideRowFormColumn(column: Pick<ListColumn, 'type'>): boolean {
  return WIDE_TYPES.has(column.type)
}

export type RowFormBlock =
  | { kind: 'section'; title: string }
  | { kind: 'column'; column: ListColumn; wide: boolean }

/**
 * What the form shows, in order: row_form.layout's columns and headings,
 * then any shown column it left out. Hidden columns never show; a heading
 * with no column after it is dropped.
 */
export function rowFormBlocks(config: ListFieldConfig | undefined): RowFormBlock[] {
  const columns = shownColumns(config)
  const byKey = new Map(columns.map((c) => [c.key, c]))
  const out: RowFormBlock[] = []
  const used = new Set<string>()
  for (const item of config?.row_form?.layout ?? []) {
    if ('section' in item) { out.push({ kind: 'section', title: item.section }); continue }
    const column = byKey.get(item.column)
    if (!column || used.has(column.key)) continue
    used.add(column.key)
    out.push({ kind: 'column', column, wide: isWideRowFormColumn(column) })
  }
  for (const column of columns) if (!used.has(column.key)) out.push({ kind: 'column', column, wide: isWideRowFormColumn(column) })
  return out.filter((block, i) => block.kind === 'column' || out[i + 1]?.kind === 'column')
}

/** How an editable List's rows are edited here: in place, in the pop-out, or both (phones: the pop-out whenever allowed). */
export function rowEditingModes(config: ListFieldConfig | undefined, phone = false): { inline: boolean; popout: boolean } {
  const mode: ListRowEditing = config?.row_editing ?? 'both'
  if (mode === 'inline') return { inline: true, popout: false }
  if (mode === 'popout' || phone) return { inline: false, popout: true }
  return { inline: true, popout: true }
}

/** Whether a read-only List shows "View row" (always, unless row_form.hide_view_icon). */
export function showsViewIcon(config: ListFieldConfig | undefined): boolean {
  return config?.row_form?.hide_view_icon !== true
}

/** "Row 3 of 12". */
export function rowPositionText(index: number, total: number): string {
  return `Row ${index + 1} of ${total}`
}

/**
 * The dialog's title: row_form.title with `{{row.<column>}}` (formatted)
 * and `{{row_number}}` filled in; without one, "<List> · Row 3" (a new row:
 * "<List> · New row").
 */
export function rowFormTitle(config: ListFieldConfig | undefined, row: Record<string, unknown> | null | undefined, index: number, listLabel: string, isNew = false): string {
  const template = config?.row_form?.title
  if (template) {
    const text = template.replace(/\{\{\s*(row\.([A-Za-z0-9_]+)|row_number)\s*\}\}/g, (_m, whole: string, key?: string) => {
      if (whole === 'row_number') return String(index + 1)
      const column = config?.columns.find((c) => c.key === key)
      const value = row?.[key!]
      if (!column) return value === null || value === undefined ? '' : String(value)
      const shown = formatListCell(column, value, row ?? undefined)
      return shown === '—' ? '' : shown
    }).replace(/\s+/g, ' ').replace(/[\s:·–—-]+$/, '').trim()
    if (text) return text
  }
  return isNew ? `${listLabel} · New row` : `${listLabel} · Row ${index + 1}`
}

/* ── Editing: open, change, save, cancel ─────────────────────────────── */

/** An open row form: the row, what it was when the dialog opened, and whether the dialog added it. */
export interface RowFormSession {
  index: number
  /** The row as it was when the form opened (pending markers kept). */
  snapshot: Record<string, unknown>
  isNew: boolean
}

/**
 * Open the form on row `target` (0-based) or on a new row ('new': the
 * columns' defaults, pending "New" until it is saved). Returns the rows
 * (with the new row at the end) and the session; an error when the List is
 * full or the row is not there. `isNew` on a row number: a row a rule just
 * added (open_row_form's "new") — Cancel removes it like the dialog's own.
 */
export function openRowForm(config: ListFieldConfig, value: unknown, target: number | 'new', options: { isNew?: boolean } = {}): { rows: Record<string, unknown>[]; session: RowFormSession } | { error: string } {
  const rows = rawListRows(value)
  if (target === 'new') {
    if (config.max_rows !== undefined && rows.length >= config.max_rows) return { error: `At most ${config.max_rows} ${config.max_rows === 1 ? 'row' : 'rows'}` }
    const row: Record<string, unknown> = { ...blankListRow(config), [ROW_DRAFT_KEY]: 'new' }
    return { rows: [...rows, row], session: { index: rows.length, snapshot: row, isNew: true } }
  }
  if (!Number.isInteger(target) || target < 0 || target >= rows.length) return { error: 'That row is not in the list' }
  if (options.isNew && rowDraftState(rows[target]) === 'new') return { rows, session: { index: target, snapshot: rows[target], isNew: true } }
  return { rows, session: { index: target, snapshot: rows[target], isNew: false } }
}

/** Whether the row changed since the form opened (typed, so "2" and 2 are the same). */
export function rowFormDirty(config: ListFieldConfig, value: unknown, session: RowFormSession): boolean {
  const row = rawListRows(value)[session.index]
  if (!row) return false
  return JSON.stringify(coerceListRow(config, stripRowMarkers(row))) !== JSON.stringify(coerceListRow(config, stripRowMarkers(session.snapshot)))
}

/** The row with one column changed (read-only columns and calculated ones are left as they are). */
export function setRowFormCell(config: ListFieldConfig, value: unknown, session: RowFormSession, column: string, cell: unknown): Record<string, unknown>[] {
  const rows = rawListRows(value)
  const row = rows[session.index]
  if (!row || !listColumnWritable(config, column, row)) return rows
  return rows.map((r, i) => (i === session.index ? { ...r, [column]: cell } : r))
}

export type RowFormSave =
  | { ok: true; rows: Record<string, unknown>[]; row: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> }

/**
 * Save: the row's checks (required, types, bounds, nested Lists, and with
 * `ctx` the column / row validations); when they pass the row is committed
 * — typed, calculated columns worked out, its pending markers gone (Commit
 * row's result).
 */
export function saveRowForm(config: ListFieldConfig, value: unknown, session: RowFormSession, ctx?: ListCheckContext | null): RowFormSave {
  const rows = rawListRows(value)
  const row = rows[session.index]
  if (!row) return { ok: false, errors: { _row: 'The row is no longer in the list' } }
  const errors = listRowErrors(config, stripRowMarkers(row), ctx ?? null)
  if (Object.keys(errors).length) return { ok: false, errors }
  const committed = stripRowMarkers({ ...row, ...coerceListRow(config, stripRowMarkers(row)) })
  return { ok: true, rows: rows.map((r, i) => (i === session.index ? committed : r)), row: committed }
}

/** Cancel: the row goes back to what it was (a row the dialog added goes). */
export function cancelRowForm(value: unknown, session: RowFormSession): Record<string, unknown>[] {
  const rows = rawListRows(value)
  if (session.isNew) return rows.filter((_, i) => i !== session.index || rowDraftState(rows[i]) !== 'new')
  if (!rows[session.index]) return rows
  return rows.map((r, i) => (i === session.index ? session.snapshot : r))
}

/* ── Reading: a value as people read it ──────────────────────────────── */

export type RowValueView =
  | { kind: 'empty'; text: '—' }
  | { kind: 'text'; text: string; numeric?: boolean }
  | { kind: 'multiline'; text: string }
  | { kind: 'link'; href: string; text: string; external: boolean }
  | { kind: 'image'; src: string; full: string; alt: string; name?: string }
  | { kind: 'signature'; src: string | null; signer: string; at: string; text: string }
  | { kind: 'rich'; html: string }
  | { kind: 'rows'; count: number; text: string }

export interface RowValueOptions {
  locale?: string
  timeZone?: string
}

const EMPTY: RowValueView = { kind: 'empty', text: '—' }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const IMAGE_PATH_RE = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i
const HTML_RE = /<(p|br|b|strong|i|em|u|ul|ol|li|a|h[1-6]|blockquote|span|div)\b[^>]*>/i

function parseObject(text: string): Record<string, unknown> | null {
  if (!/^\s*\{/.test(text)) return null
  try {
    const v = JSON.parse(text)
    return isPlainObject(v) ? v : null
  } catch {
    return null
  }
}

/**
 * One cell of a row, for reading: what kind of value it is and its text.
 * Typed columns format as in the list (currency in its currency, choice
 * labels, Yes / No, lookup labels); dates in the reader's locale; an email
 * is a mailto link. Text values are recognised by their shape: a web
 * address (a link), a picture (an Image value, or a stored image URL), a
 * Signature value, rich text (sanitised), several lines.
 */
export function formatRowValue(column: ListColumn, value: unknown, row?: Record<string, unknown> | null, options: RowValueOptions = {}): RowValueView {
  if (column.type === 'list') {
    const count = rawListRows(value).length
    return { kind: 'rows', count, text: formatListCell(column, value) }
  }
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return EMPTY
  switch (column.type) {
    case 'signature':
      // A signature column holds the Signature value object (or its JSON text).
      return signatureView(value, options) ?? EMPTY
    case 'boolean':
    case 'choice':
    case 'lookup':
      return { kind: 'text', text: formatListCell(column, value, row ?? undefined) }
    case 'number':
    case 'currency':
    case 'calculated':
      return { kind: 'text', text: formatListCell(column, value, row ?? undefined), numeric: true }
    case 'date': {
      const s = String(value).trim().slice(0, 10)
      if (!DATE_RE.test(s)) return { kind: 'text', text: String(value) }
      const shown = formatDate(`${s}T00:00:00Z`, { timeZone: 'UTC', ...(options.locale ? { locale: options.locale } : {}) })
      return { kind: 'text', text: shown === '—' ? String(value) : shown }
    }
    case 'email': {
      const s = String(value).trim()
      return EMAIL_RE.test(s) ? { kind: 'link', href: `mailto:${s}`, text: s, external: false } : { kind: 'text', text: s }
    }
    default:
      return textValue(column, String(value), options)
  }
}

/** A Signature value (an object or JSON text of one) for reading, or null when it isn't one. */
function signatureView(value: unknown, options: RowValueOptions): RowValueView | null {
  const sig = normalizeSignatureValue(value)
  if (!sig) return null
  const signer = sig.user_name || sig.typed_name || ''
  const at = sig.signed_at ? formatSignedAt(sig.signed_at, options.timeZone) : ''
  return { kind: 'signature', src: sig.file.id ? `${attachmentPath(sig.file.id)}?inline=1` : null, signer, at, text: `Signed${signer ? ` by ${signer}` : ''}${at ? ` on ${at}` : ''}` }
}

function textValue(column: ListColumn, text: string, options: RowValueOptions): RowValueView {
  const s = text.trim()
  // A value copied from another field (JSON text): a signature, a picture, a link with its text.
  const obj = parseObject(s)
  if (obj) {
    const sig = signatureView(obj, options)
    if (sig) return sig
    const file = normalizeImageValue(obj)
    if (file && (String(file.mime_type ?? '').startsWith('image/') || IMAGE_PATH_RE.test(`.${fileExtension(file.name)}`))) {
      const full = attachmentPath(file.id)
      return { kind: 'image', src: `${full}?inline=1`, full, alt: `${column.label}: ${file.name}`, name: file.name }
    }
    if (typeof obj.url === 'string' && isAllowedUrl(obj.url)) {
      const href = safeLinkHref(obj.url, URL_LINK_SCHEMES)
      const label = typeof obj.text === 'string' && obj.text.trim() ? obj.text.trim() : obj.url
      if (href) return { kind: 'link', href, text: label.slice(0, 500), external: !href.startsWith('mailto:') }
    }
  }
  if (HTML_RE.test(s)) {
    const html = sanitizeRichText(s)
    if (html) return { kind: 'rich', html }
  }
  if (!/\s/.test(s) && isImageUrl(s) && (IMAGE_PATH_RE.test(s.split('#')[0]) || s.startsWith('storage://'))) {
    const src = resolveStorageUrl(s) ?? s
    return { kind: 'image', src, full: src, alt: column.label }
  }
  if (!/\s/.test(s) && /^(https?|mailto):/i.test(s) && isAllowedUrl(s)) {
    const href = safeLinkHref(s, URL_LINK_SCHEMES)
    if (href) return { kind: 'link', href, text: s, external: !href.startsWith('mailto:') }
  }
  if (column.type === 'textarea' || /\n/.test(text)) return { kind: 'multiline', text: text.replace(/\r\n?/g, '\n').trim() }
  return { kind: 'text', text: s }
}

/* ── Rules: open_row_form ────────────────────────────────────────────── */

/** What a rule asks the List to open: its key, the row path (0-based, one per level) and the nested column path. */
export interface RowFormRequest {
  /** The field's List. */
  field: string
  /** Row indexes, one per level: [order] or [order, line]. */
  path: number[]
  /** Nested List columns down to the row's List ([] for the field's List; ['lines']). */
  steps: string[]
  /** The row was just added (by the step): Cancel removes it. */
  isNew?: boolean
}

/**
 * A row step's List key (the field, or a nested List's `orders.1.lines`)
 * and a row index → the request. Null when the key is not one.
 */
export function rowFormRequest(listKey: string, index: number, isNew = false): RowFormRequest | null {
  const parts = String(listKey ?? '').split('.')
  if (!parts[0] || parts.length % 2 === 0 || !Number.isInteger(index) || index < 0) return null
  const path: number[] = []
  const steps: string[] = []
  for (let i = 1; i < parts.length; i += 2) {
    const at = Number(parts[i])
    if (!Number.isInteger(at) || at < 0 || !parts[i + 1]) return null
    path.push(at)
    steps.push(parts[i + 1])
  }
  return { field: parts[0], path: [...path, index], steps, ...(isNew ? { isNew: true } : {}) }
}
