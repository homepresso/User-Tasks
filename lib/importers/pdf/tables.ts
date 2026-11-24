/**
 * Tables of boxes in a PDF form → ONE repeating list each (pure, no I/O).
 *
 * A rooming list, an expenses grid or a list of dependants is printed as
 * rows × columns of identical boxes. Imported box by box it becomes
 * hundreds of fields with labels guessed from the row labels and the field
 * names ("Room #2", "2", "Special Requests/Notes_1"). This module finds such
 * grids deterministically and describes them (PdfTable); build.ts turns each
 * into one repeating section whose controls are the columns.
 *
 *   layout (AcroForm / hybrid)
 *     columns   boxes with the same left and right edges (± a few points),
 *               similar heights, one type, in a regular vertical run
 *     rows      the columns' boxes matched by their vertical centre
 *     accepted  ≥ 2 columns × ≥ 3 rows (or 1 column × ≥ 4 rows with a
 *               numbered name pattern / numbered row labels / a header),
 *               no printed text between the boxes (a normal form has a
 *               label at every box), cells of one column not individually
 *               named (distinct tooltips / name stems = separate questions)
 *     header    the text printed right above each column (a line over
 *               several columns is a spanning header: "Names" → "Names 1" …)
 *     row text  the text left of each row: "Room #1", "1.", "Item 3" →
 *               generic (the list is named after it: "Rooms"); anything
 *               else (fixed categories, dates) → a choice column
 *     totals    a calculated field adding up one column's boxes
 *               (AFSimple_Calculate SUM) → a total over the list
 *     pages     the same columns at the top of the next page continue the table
 *
 *   XFA        a repeating subform (occur max > 1 / unlimited) of value
 *              fields: its fields are the columns, occur max the rows
 *
 * The cells stay in model.items, relabelled "Header (row label)", so a
 * table the person keeps as separate fields still gets readable labels.
 */

import type { PageText, Rect } from './acroform'
import { cleanLabel, humanizeFieldName, type PdfColumnLabelSource, type PdfFormModel, type PdfItem, type PdfItemType, type PdfTable, type PdfTableColumn } from './model'
import type { XfaTemplate } from './xfa'

type Line = PageText['lines'][number]

const CELL_TYPES: ReadonlySet<PdfItemType> = new Set<PdfItemType>(['text', 'textarea', 'number', 'currency', 'date', 'email', 'phone', 'boolean', 'choice'])

const cyOf = (r: Rect) => (r[1] + r[3]) / 2
const hOf = (r: Rect) => r[3] - r[1]
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }

/** A name without its numbers, brackets and punctuation: the cells of one column share it ("Name 1.3.2" → "name"). */
export function nameStem(name: string): string {
  return String(name).replace(/\[\d+\]/g, '').split('.').filter((p) => /[A-Za-z]/.test(p)).join('').toLowerCase().replace(/[^a-z]+/g, '')
}

const NOT_A_ROW_NOUN = /^(?:q|question|line|part|section|step|page|box|field|schedule|form|article|clause|note|answer)$/i

/** "Room #1" / "1." / "Item 3" / "a)" → { noun, n }; null for anything else ("Question 3", "Line 12" are the form's own numbering). */
export function genericRowLabel(text: string): { noun: string; n: number } | null {
  const s = cleanLabel(text).replace(/\s+/g, ' ').trim()
  const m = /^([A-Za-z][A-Za-z .'/-]{0,30}?)?\s*(?:#|no\.?|number|nº|№)?\s*(\d{1,3})\s*[.):]?$/i.exec(s)
  if (m) {
    const noun = cleanLabel((m[1] ?? '').replace(/\s*(?:#|no\.?|number)$/i, '')).trim()
    // "Question 3", "Line 12", "Part 2": numbered questions / line items of the form itself, not rows of a list.
    if (NOT_A_ROW_NOUN.test(noun)) return null
    return { noun, n: Number(m[2]) }
  }
  const letter = /^\(?([a-z])[.)]$/i.exec(s)
  if (letter) return { noun: '', n: letter[1].toLowerCase().charCodeAt(0) - 96 }
  return null
}

export function pluralize(noun: string): string {
  const w = noun.trim()
  if (!w) return w
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/i.test(w)) return `${w}es`
  return `${w}s`
}

interface Cell { item: PdfItem; rect: Rect }
interface Column { cells: Cell[]; x0: number; x1: number; h: number; type: PdfItemType }

/** Boxes with the same left / right edges and height, one type, in a regular vertical run. */
function columnsOf(cells: Cell[]): Column[] {
  const groups: Cell[][] = []
  for (const c of [...cells].sort((a, b) => a.rect[0] - b.rect[0])) {
    const g = groups.find((x) => Math.abs(x[0].rect[0] - c.rect[0]) <= 5 && Math.abs(x[0].rect[2] - c.rect[2]) <= 8 && x[0].item.type === c.item.type)
    if (g) g.push(c)
    else groups.push([c])
  }
  const out: Column[] = []
  for (const g of groups) {
    if (g.length < 2) continue
    const h = median(g.map((c) => hOf(c.rect)))
    const same = g.filter((c) => Math.abs(hOf(c.rect) - h) <= Math.max(4, h * 0.35)).sort((a, b) => cyOf(b.rect) - cyOf(a.rect))
    // Split into regular runs: a gap much wider than the usual pitch ends a run.
    const pitches = same.slice(1).map((c, i) => cyOf(same[i].rect) - cyOf(c.rect))
    const pitch = median(pitches)
    let run: Cell[] = []
    const flush = () => { if (run.length >= 2) out.push({ cells: run, x0: Math.min(...run.map((c) => c.rect[0])), x1: Math.max(...run.map((c) => c.rect[2])), h, type: run[0].item.type }); run = [] }
    same.forEach((c, i) => {
      if (i > 0) {
        const d = cyOf(same[i - 1].rect) - cyOf(c.rect)
        if (d < h * 0.5 || d > Math.max(pitch * 1.6, h + 6) || d > h * 3.2 + 10) flush()
      }
      run.push(c)
    })
    flush()
  }
  return out
}

/** Two columns side by side whose boxes sit on the same rows. */
function aligned(a: Column, b: Column): boolean {
  if (!(a.x1 <= b.x0 + 2 || b.x1 <= a.x0 + 2)) return false
  const tol = Math.min(a.h, b.h) * 0.6
  const [small, big] = a.cells.length <= b.cells.length ? [a, b] : [b, a]
  const hits = small.cells.filter((c) => big.cells.some((d) => Math.abs(cyOf(c.rect) - cyOf(d.rect)) <= tol)).length
  return hits >= 2 && hits >= small.cells.length * 0.6
}

interface Grid { columns: Column[]; rows: Array<Array<Cell | null>>; rowCy: number[]; h: number }

function gridOf(columns: Column[]): Grid | null {
  const cols = [...columns].sort((a, b) => a.x0 - b.x0)
  const h = median(cols.map((c) => c.h))
  const all = cols.flatMap((col, ci) => col.cells.map((cell) => ({ ci, cell })))
  all.sort((a, b) => cyOf(b.cell.rect) - cyOf(a.cell.rect))
  const rows: Array<{ cy: number; cells: Array<Cell | null> }> = []
  for (const { ci, cell } of all) {
    const cy = cyOf(cell.rect)
    const row = rows.find((r) => Math.abs(r.cy - cy) <= h * 0.6 && !r.cells[ci])
    if (row) row.cells[ci] = cell
    else rows.push({ cy, cells: Object.assign(new Array(cols.length).fill(null), { [ci]: cell }) })
  }
  rows.sort((a, b) => b.cy - a.cy)
  // Columns must fill at least half the rows.
  const keep = cols.map((_, ci) => rows.filter((r) => r.cells[ci]).length >= rows.length * 0.5)
  if (!keep.some(Boolean)) return null
  const kept = cols.filter((_, ci) => keep[ci])
  const keptRows = rows.map((r) => ({ cy: r.cy, cells: r.cells.filter((_, ci) => keep[ci]) })).filter((r) => r.cells.some(Boolean))
  return { columns: kept, rows: keptRows.map((r) => r.cells), rowCy: keptRows.map((r) => r.cy), h }
}

const linesBetween = (lines: Line[], box: Rect, cells: Rect[]) => lines.filter((l) => {
  const cx = (l.x0 + l.x1) / 2
  const cy = l.y + l.h * 0.35
  if (cx <= box[0] + 1 || cx >= box[2] - 1 || cy <= box[1] + 1 || cy >= box[3] - 1) return false
  return !cells.some((r) => cx >= r[0] - 1 && cx <= r[2] + 1 && cy >= r[1] - 1 && cy <= r[3] + 1)
})

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

/** The text right above each column: its own header, or a header spanning several columns. */
type Header = { text: string; help?: string; bottom: string; source: PdfColumnLabelSource }
function headersOf(grid: Grid, lines: Line[]): Array<Header | null> {
  const top = Math.max(...grid.rows[0].filter((c): c is Cell => Boolean(c)).map((c) => c.rect[3]))
  const band = lines.filter((l) => l.y >= top - 3 && l.y <= top + 240 && /[A-Za-z]/.test(l.str))
  const ownLines: Line[][] = grid.columns.map(() => [])
  const spanning: Array<{ l: Line; cols: number[] }> = []
  for (const l of band) {
    const w = Math.max(1, l.x1 - l.x0)
    const over = grid.columns.map((c) => overlap(l.x0, l.x1, c.x0, c.x1))
    const mostly = over.findIndex((o) => o >= w * 0.6)
    if (mostly >= 0) { ownLines[mostly].push(l); continue }
    const cols = over.map((o, i) => (o >= (grid.columns[i].x1 - grid.columns[i].x0) * 0.5 ? i : -1)).filter((i) => i >= 0)
    if (cols.length >= 2 && l.str.length <= 60) spanning.push({ l, cols })
  }
  // The header line nearest the boxes, and the lines above it while they run on (a header of several lines).
  const stack = (ls: Line[], reach = 30): { text: string; bottom: string; high: number } | null => {
    const sorted = ls.sort((a, b) => a.y - b.y)
    if (!sorted.length || sorted[0].y - top > reach) return null
    const picked = [sorted[0]]
    for (const l of sorted.slice(1)) {
      const prev = picked[picked.length - 1]
      if (l.y - prev.y <= Math.max(prev.h, l.h) * 1.9 + 1 && picked.length < 14) picked.push(l)
      else break
    }
    return { text: cleanLabel([...picked].reverse().map((l) => l.str).join(' ')), bottom: cleanLabel(sorted[0].str), high: picked[picked.length - 1].y }
  }
  // A header row whose cells start at different heights (a short header beside a long one with examples):
  // once one column's header sits right above the boxes, the others may start anywhere in that header row.
  const first = grid.columns.map((_, ci) => stack(ownLines[ci]))
  const zone = Math.max(0, ...first.map((h) => (h ? h.high - top : 0)))
  return grid.columns.map((_, ci) => {
    const own = first[ci] ?? (zone > 30 ? stack(ownLines[ci], zone) : null)
    if (own?.text) return { ...headerText(own.text), bottom: own.bottom, source: 'header' as const }
    const span = spanning.filter((s) => s.cols.includes(ci)).sort((a, b) => a.l.y - b.l.y)[0]
    if (span && span.l.y - top <= 30) {
      const n = span.cols.indexOf(ci) + 1
      return { text: `${cleanLabel(span.l.str)} ${n}`, bottom: cleanLabel(span.l.str), source: 'spanning_header' as const }
    }
    return null
  })
}

/** A header of several lines: the question, and the "For example …" that follows it as help. */
export function headerText(full: string): { text: string; help?: string } {
  const t = cleanLabel(full)
  const cut = /\s(?:for example|e\.g\.|eg\b|such as|including)\b/i.exec(t)
  if (cut && cut.index >= 3) return { text: cleanLabel(t.slice(0, cut.index)).slice(0, 200), help: t.slice(0, 1000) }
  if (t.length > 150) return { text: `${t.slice(0, 140).replace(/\s+\S*$/, '')}…`, help: t.slice(0, 1000) }
  return { text: t }
}

/** "(1) First name" / "a. Rent" → "First name" / "Rent" (the numbering is not part of the label). */
const stripNumbering = (s: string) => cleanLabel(s.replace(/^\(?(?:\d{1,2}|[a-z])[.)]\s+|^\(\d{1,2}\)\s*/i, ''))

/** The text left of each row (nearest to the first column), and whether more text is printed further left on the row. */
function rowLabelsOf(grid: Grid, lines: Line[]): Array<{ text: string | null; described: boolean }> {
  const x0 = grid.columns[0].x0
  return grid.rowCy.map((cy) => {
    const onRow = lines.filter((l) => l.x1 <= x0 + 3 && Math.abs(l.y + l.h * 0.35 - cy) < Math.max(6, grid.h * 0.5 + 3)).sort((a, b) => b.x1 - a.x1)
    const near = onRow[0] && x0 - onRow[0].x1 < 220 ? onRow[0] : null
    return { text: near ? cleanLabel(near.str) : null, described: Boolean(near && onRow.slice(1).some((l) => /[A-Za-z]{3}/.test(l.str) && near.x0 - l.x1 < 360)) }
  })
}

/** The fallback column label: the cells' shared tooltip / caption, else the shared name stem. */
function columnFallback(col: Array<PdfItem | null>, index: number): { text: string; source: PdfColumnLabelSource } {
  const items = col.filter((i): i is PdfItem => Boolean(i))
  const tips = items.filter((i) => i.labelSource === 'tooltip' || i.labelSource === 'xfa_caption').map((i) => cleanLabel(i.label).replace(/[\s_#-]*\d+$/, ''))
  const common = tips.length && tips.every((t) => t === tips[0]) ? tips[0] : ''
  if (common && /[A-Za-z]{2}/.test(common)) return { text: common, source: items[0].labelSource === 'xfa_caption' ? 'xfa_caption' : 'tooltip' }
  const name = humanizeFieldName(items[0]?.sourceFields[0] ?? '').replace(/[\s_#-]*\d+(?:\s+\d+)*$/, '').trim()
  return { text: name && /[A-Za-z]{2}/.test(name) ? name : `Column ${index + 1}`, source: 'field_name' }
}

/** Does the column's field names follow a numbered pattern (one stem, different numbers)? */
function namePattern(col: Array<PdfItem | null>): boolean {
  const names = col.filter((i): i is PdfItem => Boolean(i)).map((i) => i.sourceFields[0] ?? i.id)
  if (names.length < 2) return false
  const stems = new Set(names.map(nameStem))
  return stems.size === 1 && new Set(names).size === names.length && names.every((n) => /\d/.test(n))
}

/** Share of a column's cells that look like separate questions (distinct tooltips or name stems). */
function distinctness(col: Array<PdfItem | null>): number {
  const items = col.filter((i): i is PdfItem => Boolean(i))
  if (items.length < 2) return 0
  const keyOf = (i: PdfItem) => (i.labelSource === 'tooltip' || i.labelSource === 'xfa_caption' ? cleanLabel(i.label).toLowerCase().replace(/[^a-z]+/g, '') : nameStem(i.sourceFields[0] ?? i.id))
  return new Set(items.map(keyOf)).size / items.length
}

interface Candidate { page: number; grid: Grid; table: Omit<PdfTable, 'id' | 'name'> & { title?: string } }

const sameNounIncreasing = (list: Array<{ noun: string; n: number } | null>) => {
  const xs = list.filter((g): g is { noun: string; n: number } => Boolean(g))
  return xs.length > 0 && new Set(xs.map((g) => g.noun.toLowerCase())).size === 1 && xs.every((g, i) => i === 0 || g.n > xs[i - 1].n)
}

function tableOnPage(page: number, grid: Grid, lines: Line[]): Candidate | null {
  const rows = grid.rows.length
  const ncols = grid.columns.length
  const cellRects = grid.rows.flatMap((r) => r.filter((c): c is Cell => Boolean(c)).map((c) => c.rect))
  const box: Rect = [Math.min(...cellRects.map((r) => r[0])), Math.min(...cellRects.map((r) => r[1])), Math.max(...cellRects.map((r) => r[2])), Math.max(...cellRects.map((r) => r[3]))]
  const colItems = grid.columns.map((_, ci) => grid.rows.map((r) => r[ci]?.item ?? null))
  // Grids of checkboxes are option matrices (a calendar of available days, "tick all that apply" columns): kept as they are.
  const booleans = grid.columns.filter((c) => c.type === 'boolean').length
  if (booleans * 2 > ncols || (ncols === 1 && booleans)) return null
  // A normal form prints a label at (almost) every box: text between the boxes rules a table out.
  const between = linesBetween(lines, box, cellRects).filter((l) => /[A-Za-z]{2}/.test(l.str))
  if (between.length > rows * 0.3 + 1) return null
  const patterns = colItems.filter(namePattern).length
  const headers = headersOf(grid, lines)
  const rowInfo = rowLabelsOf(grid, lines)
  const rowText = rowInfo.map((r) => r.text)
  const labelled = rowText.filter(Boolean).length
  const generic = rowText.map((t) => (t ? genericRowLabel(t) : null))
  // Bare line numbers ("28", "29") with a description printed further left are line items, not a numbered list.
  const described = rowInfo.filter((r, i) => r.described && generic[i] && !generic[i]!.noun).length
  const allGeneric = labelled >= rows * 0.6 && generic.filter(Boolean).length === labelled && sameNounIncreasing(generic) && described < rows * 0.5
  const category = !allGeneric && labelled >= rows * 0.6
  const headerCount = headers.filter(Boolean).length
  // Each COLUMN is one entry ("Dependent 1 | Dependent 2 …" over rows "First name", "Last name" …): the table is turned round.
  const headerGeneric = headers.map((h) => (h ? genericRowLabel(h.bottom) ?? genericRowLabel(h.text) : null))
  const rowTypes = grid.rows.map((r) => new Set(r.filter((c): c is Cell => Boolean(c)).map((c) => c.item.type)))
  const transposed = ncols >= 2 && headerCount === ncols && headerGeneric.every(Boolean) && sameNounIncreasing(headerGeneric) && category && rowTypes.every((t) => t.size === 1)
  // Separate questions stacked along the list (distinct tooltips / captions / names) are not rows of one list.
  const along = transposed ? grid.rows.map((r) => r.map((c) => c?.item ?? null)) : colItems
  const separate = along.filter((c) => distinctness(c) > 0.5).length
  if (separate > along.length / 2) return null
  if (ncols === 1) {
    // One column: only a numbered list (numbered rows, or numbered names under a header) — a column of separate questions is not.
    if (rows < 4 || category) return null
    if (!allGeneric && !(patterns && headers[0] && headers[0].text.length <= 60 && !headers[0].help)) return null
  } else if (rows < 3 && !transposed) return null
  const evidence: string[] = [`${ncols} column${ncols === 1 ? '' : 's'} × ${rows} rows of aligned boxes`]
  if (patterns) evidence.push(`field names follow a numbered pattern (${colItems.find(namePattern)!.filter(Boolean).slice(0, 2).map((i) => i!.sourceFields[0]).join(', ')} …)`)
  if (headerCount) evidence.push(`column headers printed above (${headers.filter(Boolean).slice(0, 6).map((h) => `"${h!.text}"`).join(', ')})`)
  if (allGeneric) evidence.push(`numbered row labels ("${rowText.find(Boolean)}" …)`)
  const top = box[3]
  const itemIds = grid.rows.flatMap((r) => r.filter((c): c is Cell => Boolean(c)).map((c) => c.item.id))
  if (transposed) {
    const noun = headerGeneric[0]!.noun
    evidence.push(`each column is one ${noun || 'entry'} ("${headers[0]!.bottom}" …): rows and columns swapped`)
    const columns: PdfTableColumn[] = grid.rows.map((r, ri) => {
      const present = r.filter((c): c is Cell => Boolean(c)).map((c) => c.item)
      return {
        label: (stripNumbering(rowText[ri] ?? '') || `Field ${ri + 1}`).slice(0, 200), labelSource: 'header' as const, type: present[0].type, template: present[0].id,
        cells: r.map((c) => c?.item.id ?? null), ...(present.every((i) => i.required) ? { required: true } : {}),
      }
    })
    return { page, grid, table: { page, pages: [page], rows: ncols, maxRows: ncols, columns, rowLabelMode: 'generic', rowLabels: headers.map((h, i) => h?.bottom ?? `${noun} ${i + 1}`), noun, itemIds, totals: [], evidence, source: 'layout' } }
  }
  const columns: PdfTableColumn[] = grid.columns.map((col, ci) => {
    const cells = colItems[ci]
    const head = headers[ci]
    const label = head ?? columnFallback(cells, ci)
    const present = cells.filter((i): i is PdfItem => Boolean(i))
    return {
      label: label.text.slice(0, 200), labelSource: label.source, type: col.type, template: present[0].id,
      cells: cells.map((i) => i?.id ?? null),
      ...(head?.help ? { help: head.help } : {}),
      ...(present.every((i) => i.required) ? { required: true } : {}),
    }
  })
  // Several columns with one header ("Name" ×4 with no numbers): number them.
  const seen = new Map<string, number>()
  for (const c of columns) seen.set(c.label.toLowerCase(), (seen.get(c.label.toLowerCase()) ?? 0) + 1)
  const counter = new Map<string, number>()
  for (const c of columns) {
    const k = c.label.toLowerCase()
    if ((seen.get(k) ?? 0) > 1) { const n = (counter.get(k) ?? 0) + 1; counter.set(k, n); c.label = `${c.label} ${n}` }
  }
  const mode: PdfTable['rowLabelMode'] = allGeneric ? 'generic' : category ? 'category' : 'none'
  const noun = allGeneric ? generic.find(Boolean)!.noun : undefined
  // A short title right above the header (a name, not an instruction or a sentence fragment).
  const headerTop = Math.max(top, ...grid.columns.flatMap((_, ci) => (headers[ci] ? lines.filter((l) => l.y >= top - 3 && l.y <= top + 240 && overlap(l.x0, l.x1, grid.columns[ci].x0, grid.columns[ci].x1) > 0 && (headers[ci]!.help ?? headers[ci]!.text).includes(cleanLabel(l.str))).map((l) => l.y + l.h) : [])))
  const titleLine = lines
    .filter((l) => l.y > headerTop && l.y - headerTop < 40 && l.x0 < box[2] && l.x1 > box[0] - 60 && l.str.length >= 3 && l.str.length <= 50 && l.str.trim().split(/\s+/).length <= 6 && /^[A-Z0-9]/.test(l.str.trim()) && !/[.,;]$/.test(l.str.trim()) && /[A-Za-z]{4}/.test(l.str) && !/^(?:yes|no|n\/a|none)\b/i.test(l.str.trim()))
    .sort((a, b) => a.y - b.y)[0]
  let rowLabelHeader: string | undefined
  if (mode === 'category') {
    const head = lines.filter((l) => l.y >= top - 3 && l.y <= top + 30 && l.x1 <= grid.columns[0].x0 + 3 && grid.columns[0].x0 - l.x1 < 220).sort((a, b) => a.y - b.y)[0]
    if (head) rowLabelHeader = cleanLabel(head.str).slice(0, 120)
  }
  const firstLabel = columns[0]?.label ?? ''
  return {
    page, grid,
    table: {
      page, pages: [page], rows, maxRows: rows, columns, rowLabelMode: mode,
      ...(mode !== 'none' ? { rowLabels: rowText.map((t, i) => (t ? (mode === 'category' ? stripNumbering(t) || t : t) : `Row ${i + 1}`)) } : {}),
      ...(rowLabelHeader ? { rowLabelHeader } : {}),
      ...(noun !== undefined ? { noun } : {}),
      itemIds, totals: [], evidence, source: 'layout',
      ...(titleLine ? { title: cleanLabel(titleLine.str) } : firstLabel && firstLabel.length <= 40 && !firstLabel.includes('?') && !/^Column \d+$/.test(firstLabel) ? { title: `${firstLabel.replace(/\s+\d+$/, '')} list` } : {}),
    },
  }
}

/**
 * Find the tables of a fillable PDF's items (AcroForm / hybrid) and relabel
 * their cells. Pure: mutates `model` (tables, cell labels) only.
 */
export function detectTables(model: PdfFormModel, pages: PageText[]): PdfTable[] {
  const linesOf = new Map(pages.map((p) => [p.page, p.lines]))
  const found: Candidate[] = []
  const pagesOf = [...new Set(model.items.map((i) => i.page))].sort((a, b) => a - b)
  for (const page of pagesOf) {
    const lines = linesOf.get(page) ?? []
    const cells: Cell[] = model.items
      .filter((i) => i.page === page && i.rect && CELL_TYPES.has(i.type) && i.display !== 'radio' && !i.calc && i.sourceFields.length <= 3)
      .map((i) => ({ item: i, rect: i.rect! }))
    if (cells.length < 3) continue
    const cols = columnsOf(cells)
    // Group aligned columns (union-find), then a grid per group.
    const parent = cols.map((_, i) => i)
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) if (aligned(cols[i], cols[j])) parent[find(i)] = find(j)
    const groups = new Map<number, Column[]>()
    cols.forEach((c, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), c]))
    const used = new Set<string>()
    const candidates: Candidate[] = []
    for (const g of groups.values()) {
      // Overlapping columns in one group (two runs at one x): keep the longer.
      const sorted = [...g].sort((a, b) => b.cells.length - a.cells.length)
      const pick: Column[] = []
      for (const c of sorted) if (!pick.some((p) => overlap(p.x0, p.x1, c.x0, c.x1) > 2)) pick.push(c)
      const grid = gridOf(pick)
      if (!grid) continue
      const cand = tableOnPage(page, grid, lines)
      if (cand) candidates.push(cand)
    }
    for (const c of candidates.sort((a, b) => b.table.itemIds.length - a.table.itemIds.length)) {
      if (c.table.itemIds.some((id) => used.has(id))) continue
      c.table.itemIds.forEach((id) => used.add(id))
      found.push(c)
    }
  }
  // Continuations on the next page.
  const merged: Candidate[] = []
  for (const c of found.sort((a, b) => a.page - b.page)) {
    const prev = merged.find((m) => m.table.pages[m.table.pages.length - 1] === c.page - 1 && sameColumns(m, c))
    if (!prev) { merged.push(c); continue }
    const t = prev.table
    t.pages.push(c.page)
    t.columns.forEach((col, i) => { col.cells.push(...c.table.columns[i].cells); if (!c.table.columns[i].required) delete col.required })
    if (t.rowLabels || c.table.rowLabels) t.rowLabels = [...(t.rowLabels ?? Array.from({ length: t.rows }, (_, i) => `Row ${i + 1}`)), ...(c.table.rowLabels ?? Array.from({ length: c.table.rows }, (_, i) => `Row ${t.rows + i + 1}`))]
    t.rows += c.table.rows
    t.maxRows = t.rows
    t.itemIds.push(...c.table.itemIds)
    if (!t.evidence.some((e) => e.startsWith('continued'))) t.evidence.push(`continued on page ${c.page}`)
  }
  // Totals: a calculated SUM of one column's boxes.
  const byName = new Map<string, string>()
  for (const it of model.items) for (const n of [it.id, ...it.sourceFields]) { byName.set(n, it.id); const short = n.split('.').pop(); if (short && !byName.has(short)) byName.set(short, it.id) }
  const tables: PdfTable[] = merged.map((c, n) => {
    const { title, ...rest } = c.table
    const name = rest.rowLabelMode === 'generic' && rest.noun ? pluralize(rest.noun) : title || model.sections.find((s) => s.id === model.items.find((i) => i.id === rest.itemIds[0])?.section)?.title || `Table on page ${rest.page}`
    return { id: `table_${n + 1}`, name: name.slice(0, 120), ...rest }
  })
  for (const it of model.items) {
    if (it.calc?.op !== 'SUM' || it.calc.fields.length < 2) continue
    const ids = it.calc.fields.map((f) => byName.get(f) ?? byName.get(f.split('.').pop() ?? f))
    if (ids.some((x) => !x)) continue
    for (const t of tables) {
      const ci = t.columns.findIndex((col) => ids.every((id) => col.cells.includes(id!)))
      if (ci < 0 || t.totals.some((x) => x.item === it.id)) continue
      t.totals.push({ item: it.id, column: ci })
      if (t.columns[ci].type === 'text') t.columns[ci].type = 'number'
      t.evidence.push(`"${it.label}" adds up the "${t.columns[ci].label}" column`)
    }
  }
  // Readable labels for the cells (used when a table is kept as separate fields).
  const byId = new Map(model.items.map((i) => [i.id, i]))
  for (const t of tables) {
    for (const col of t.columns) {
      col.cells.forEach((id, r) => {
        const item = id ? byId.get(id) : null
        if (!item) return
        const row = t.rowLabels?.[r] ?? `row ${r + 1}`
        item.label = `${col.label} (${row})`.slice(0, 300)
        item.labelSource = 'table_header'
        delete item.question
      })
    }
  }
  return tables
}

/** Same columns (edges, types) on the next page: the table continues. */
function sameColumns(a: Candidate, b: Candidate): boolean {
  const ca = a.grid.columns
  const cb = b.grid.columns
  return ca.length === cb.length && ca.every((c, i) => Math.abs(c.x0 - cb[i].x0) <= 8 && Math.abs(c.x1 - cb[i].x1) <= 10 && c.type === cb[i].type)
}

/**
 * XFA: repeating subforms (occur max > 1 or unlimited) of value fields →
 * tables (one template row; the columns are its fields).
 */
export function detectXfaTables(model: PdfFormModel, t: XfaTemplate): PdfTable[] {
  const tables: PdfTable[] = []
  const repeating = t.sections.filter((s) => s.repeats).sort((a, b) => b.som.length - a.som.length)
  const taken = new Set<string>()
  for (const s of repeating) {
    const inner = repeating.filter((x) => x !== s && x.som.startsWith(`${s.som}.`))
    const items = model.items.filter((i) => !taken.has(i.id) && i.sourceFields[0]?.startsWith(`${s.som}.`) && !inner.some((x) => i.sourceFields[0].startsWith(`${x.som}.`)))
    if (!items.length || items.length > 30 || items.some((i) => !CELL_TYPES.has(i.type) && i.type !== 'multi_choice' && i.type !== 'signature')) continue
    items.forEach((i) => taken.add(i.id))
    const name = cleanLabel(s.title) || humanizeFieldName(s.som)
    const max = s.max === undefined ? null : s.max < 0 ? null : s.max
    tables.push({
      id: `table_${tables.length + 1}`, name: name.slice(0, 120), page: items[0].page, pages: [items[0].page], rows: 1, maxRows: max,
      columns: items.map((i) => ({ label: i.label, labelSource: i.labelSource === 'xfa_caption' ? 'xfa_caption' : 'field_name', type: i.type, template: i.id, cells: [i.id], ...(i.required ? { required: true } : {}) })),
      rowLabelMode: 'none', itemIds: items.map((i) => i.id), totals: [],
      evidence: [`a repeating subform in the XFA template (${max === null ? 'any number of' : `up to ${max}`} rows)`], source: 'xfa',
    })
  }
  return tables.reverse().map((x, i) => ({ ...x, id: `table_${i + 1}` }))
}
