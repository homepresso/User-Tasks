/**
 * AcroForm widgets → raw fields (server-only: pdf.js annotations, scripting
 * off). One raw field per PDF field name, with its widgets (radio options /
 * checkbox states / repeated appearances), flags, options, actions and the
 * text printed around it. Labels and merging happen in infer.ts.
 */

import type { PdfDoc, TextLine } from './load'
import { pageTextLines } from './load'

export type Rect = [number, number, number, number]

export interface RawWidget {
  page: number
  rect: Rect
  /** Radio / checkbox export value of this widget. */
  onValue?: string
  /** Text printed right of the widget on the same row (option label + any routing). */
  rightText?: string
  actions?: Record<string, unknown> | null
}

export interface RawField {
  name: string
  page: number
  rect: Rect
  pdfType: 'Tx' | 'Btn' | 'Ch' | 'Sig' | string
  kind: 'text' | 'multiline' | 'checkbox' | 'radio' | 'push' | 'combo' | 'list' | 'signature' | 'other'
  tooltip: string
  required: boolean
  readOnly: boolean
  hidden: boolean
  maxLen?: number
  comb: boolean
  multiSelect: boolean
  options: Array<{ value: string; label: string }>
  widgets: RawWidget[]
  actions: Record<string, unknown> | null
}

export interface PageText {
  page: number
  width: number
  height: number
  lines: TextLine[]
}

/* eslint-disable @typescript-eslint/no-explicit-any -- pdf.js annotation objects */

const rectOf = (r: any): Rect => {
  const a = Array.isArray(r) ? r.map(Number) : [0, 0, 0, 0]
  return [Math.min(a[0], a[2]), Math.min(a[1], a[3]), Math.max(a[0], a[2]), Math.max(a[1], a[3])].map((n) => Math.round(n * 10) / 10) as Rect
}

/** Text right of a widget on its row, up to the next widget on that row. */
export function rightTextOf(lines: TextLine[], rect: Rect, nextX: number): string {
  const cy = (rect[1] + rect[3]) / 2
  const h = rect[3] - rect[1]
  const row = lines
    .filter((l) => l.x0 >= rect[2] - 2 && l.x0 < nextX - 1 && l.x0 - rect[2] < 260 && Math.abs(l.y + l.h * 0.35 - cy) < Math.max(6, h / 2 + 2))
    .sort((a, b) => a.x0 - b.x0)
  return row.map((l) => l.str).join(' ').replace(/\s+/g, ' ').trim().slice(0, 300)
}

/** Read every page's widgets and text. */
export async function readAcroForm(doc: PdfDoc, opts: { maxWidgets: number; deadline: number }): Promise<{ fields: RawField[]; pages: PageText[]; widgetCount: number; truncated: boolean }> {
  const fields = new Map<string, RawField>()
  const pages: PageText[] = []
  let widgetCount = 0
  let truncated = false
  for (let p = 1; p <= doc.numPages; p++) {
    if (Date.now() > opts.deadline) { truncated = true; break }
    const page = await doc.getPage(p)
    const view = page.view ?? [0, 0, 612, 792]
    const lines = await pageTextLines(page)
    pages.push({ page: p, width: view[2] - view[0], height: view[3] - view[1], lines })
    const anns = ((await page.getAnnotations()) as any[]).filter((a) => a?.subtype === 'Widget' && a.fieldName)
    const rowWidgets = anns.map((a) => rectOf(a.rect))
    for (const a of anns) {
      if (++widgetCount > opts.maxWidgets) { truncated = true; break }
      const name = String(a.fieldName).slice(0, 300)
      const rect = rectOf(a.rect)
      let f = fields.get(name)
      if (!f) {
        const kind: RawField['kind'] = a.fieldType === 'Btn' ? (a.pushButton ? 'push' : a.radioButton ? 'radio' : 'checkbox')
          : a.fieldType === 'Ch' ? (a.combo ? 'combo' : 'list')
            : a.fieldType === 'Tx' ? (a.multiLine ? 'multiline' : 'text')
              : a.fieldType === 'Sig' ? 'signature' : 'other'
        f = {
          name, page: p, rect, pdfType: String(a.fieldType ?? ''), kind,
          tooltip: typeof a.alternativeText === 'string' ? a.alternativeText : '',
          required: a.required === true, readOnly: a.readOnly === true, hidden: a.hidden === true,
          ...(Number(a.maxLen) > 0 ? { maxLen: Number(a.maxLen) } : {}),
          comb: a.comb === true, multiSelect: a.multiSelect === true,
          options: Array.isArray(a.options) ? a.options.map((o: any) => ({ value: String(o?.exportValue ?? o?.displayValue ?? ''), label: String(o?.displayValue ?? o?.exportValue ?? '') })).filter((o: { value: string }) => o.value !== '').slice(0, 500) : [],
          widgets: [],
          actions: a.actions && typeof a.actions === 'object' ? a.actions : null,
        }
        fields.set(name, f)
      }
      const onValue = a.radioButton ? a.buttonValue : a.checkBox ? a.exportValue : undefined
      const cy = (rect[1] + rect[3]) / 2
      const nextX = Math.min(...rowWidgets.filter((r) => r[0] > rect[2] && Math.abs((r[1] + r[3]) / 2 - cy) < 6).map((r) => r[0]), Infinity)
      f.widgets.push({
        page: p, rect,
        ...(onValue !== undefined && onValue !== null ? { onValue: String(onValue) } : {}),
        ...(f.kind === 'radio' || f.kind === 'checkbox' ? { rightText: rightTextOf(lines, rect, nextX) } : {}),
        actions: a.actions && typeof a.actions === 'object' ? a.actions : null,
      })
      if (!f.actions && a.actions) f.actions = a.actions
    }
    if (truncated) break
  }
  return { fields: [...fields.values()], pages, widgetCount, truncated }
}

/* ── Nearby text (labels) ────────────────────────────────────────────── */

export interface NearbyLabel { text: string; how: 'left' | 'right' | 'above' | 'inside' }

/**
 * The text printed nearest to a widget, scored: left on the same row, above
 * (just over the box), inside (a light caption in the box) and — for single
 * checkboxes — right.
 */
export function nearbyLabel(lines: TextLine[], rect: Rect, prefer: 'left' | 'right'): NearbyLabel | null {
  const [x1, y1, x2, y2] = rect
  const h = y2 - y1
  const cy = (y1 + y2) / 2
  const cands: Array<{ l: TextLine; s: number; how: NearbyLabel['how'] }> = []
  for (const l of lines) {
    const ly = l.y + l.h * 0.35
    if (prefer === 'right' && l.x0 >= x2 - 2 && l.x0 - x2 < 40 && Math.abs(ly - cy) < Math.max(6, h / 2 + 3)) cands.push({ l, s: l.x0 - x2, how: 'right' })
    if (l.x1 <= x1 + 3 && x1 - l.x1 < 220 && Math.abs(ly - cy) < Math.max(6, h / 2 + 3)) cands.push({ l, s: (x1 - l.x1) * 0.3 + 5, how: 'left' })
    if (l.y >= y2 - 2 && l.y - y2 < 22 && l.x0 < x2 && l.x1 > x1 - 10) cands.push({ l, s: (l.y - y2) * 2 + 10, how: 'above' })
    if (l.y > y1 && l.y < y2 && l.x0 >= x1 - 2 && l.x0 < x2) cands.push({ l, s: 20, how: 'inside' })
  }
  // Separators and dot leaders are not labels.
  const useful = cands.filter((c) => /[A-Za-zÀ-ɏЀ-ӿ一-鿿]{2,}/.test(c.l.str))
  useful.sort((a, b) => a.s - b.s)
  return useful[0] ? { text: useful[0].l.str.slice(0, 300), how: useful[0].how } : null
}
