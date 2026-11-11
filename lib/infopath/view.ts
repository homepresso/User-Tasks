/**
 * An InfoPath view (viewN.xsl) → its controls and static text, in document
 * order, with a rough grid position (layout-table row / column) each.
 *
 * The XSL is HTML with InfoPath attributes (xd:xctname, xd:binding,
 * xd:CtrlId…) and XSLT around repeating / optional parts. The walk:
 *   - follows xsl:apply-templates into the template of that mode (the
 *     binding context becomes the selected node) and xsl:for-each;
 *   - a layout table's <tr> is a row, its <td> a column (colspan counted);
 *   - a repeating table (class xdRepeatingTable / tbody xd:xctname=
 *     RepeatingTable) takes its column titles from the header row and its
 *     columns from the controls of the repeated row; the footer (totals) is
 *     read as ordinary content after it;
 *   - sections (xd:xctname Section / OptionalSection / RepeatingSection, or
 *     class xdSection / xdRepeatingSection) become containers; an xsl:if
 *     around one is its show condition;
 *   - conditional formatting (xsl:attribute style / xd:disableEditing with
 *     xsl:when / xsl:if) is kept per control: DISPLAY: none → hide,
 *     disableEditing → disable, anything else → style (reported, not mapped).
 * Labels are matched afterwards (associateLabels): text before a control in
 * the same cell, the cell to its left, or the cell above; a check box's or an
 * option button's text after it.
 */

import { attr, elements, type XmlChild, type XmlElement } from '@/lib/documents/xml'
import { resolveBinding, localOf } from './xpath'
import type { IpControl, IpControlKind, IpFormatting, IpOption, IpText, IpView, IpViewItem } from './model'

const PEOPLE_CLSID = '61e40d31-993d-4777-8fa0-19ca59b6d0bb'
const MAX_ITEMS = 5000
const MAX_DEPTH = 300

export interface ViewParseOptions {
  /** The schema root's absolute path (`/expenseReport`). */
  root: string
  /** Is this absolute path a repeating node (schema maxOccurs / manifest xCollection)? */
  isRepeating: (path: string) => boolean
  /** Is it an optional section (manifest xOptional)? */
  isOptional: (path: string) => boolean
}

interface Ctx {
  path: string
  row: number
  col: number
  /** Inside a cell (td): text and controls share the position. */
  inCell: boolean
  /** Repeating table / section depth. */
  repeating: number
  showIf: string[]
  templates: string[]
}

const xd = (el: XmlElement, local: string): string | undefined => {
  for (const [k, v] of Object.entries(el.attrs)) if (k === `xd:${local}` || (k.endsWith(`:${local}`) && k.startsWith('xd'))) return v
  return undefined
}
const cls = (el: XmlElement) => (attr(el, 'class') ?? '').toLowerCase()

const XCT_KIND: Record<string, IpControlKind> = {
  plaintext: 'text', richtext: 'richtext', dtpicker: 'date', datepicker: 'date', dropdown: 'dropdown', combobox: 'combobox',
  listbox: 'listbox', multipleselectlist: 'multiselect', multipleselectlistbox: 'multiselect', checkbox: 'checkbox', optionbutton: 'option',
  fileattachment: 'attachment', 'sharepoint:sharepointfileattachment': 'attachment', button: 'button', picturebutton: 'button',
  expressionbox: 'expression', hyperlink: 'hyperlink', inlineimage: 'picture', linkedimage: 'picture', inlinepicture: 'picture', linkedpicture: 'picture',
  signatureline: 'signature', inkpicture: 'ink', bulletedlist: 'bulleted_list', numberedlist: 'bulleted_list', plainnumberedlist: 'bulleted_list', plainlist: 'bulleted_list',
  datetimepicker: 'datetime',
}

const SECTION_XCT = new Set(['section', 'optionalsection', 'repeatingsection'])
const INNER_PARTS = new Set(['dtpicker_dttext', 'dtpicker_dtbutton'])
const SKIP_TAGS = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'colgroup', 'col', 'object-param', 'img'])

function textChildren(el: XmlElement): string {
  return el.children.filter((c): c is string => typeof c === 'string').join(' ').replace(/\s+/g, ' ').trim()
}

/** All text under an element, skipping XSLT instructions and form controls. */
function plainText(el: XmlElement, depth = 0): string {
  if (depth > 40) return ''
  const parts: string[] = []
  for (const c of el.children) {
    if (typeof c === 'string') parts.push(c)
    else if (!c.name.startsWith('xsl:') && !['select', 'input', 'textarea', 'object', 'button', 'option'].includes(c.local) && !xd(c, 'xctname')) parts.push(plainText(c, depth + 1))
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function humanize(path: string | undefined): string {
  const leaf = localOf((path ?? '').split('/').filter(Boolean).pop() ?? '').replace(/^@/, '')
  return leaf
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
}

/** Conditional formatting on an element: its xsl:attribute children with xsl:when / xsl:if. */
function formattingOf(el: XmlElement): IpFormatting[] {
  const out: IpFormatting[] = []
  for (const a of elements(el).filter((c) => c.name === 'xsl:attribute')) {
    const name = (attr(a, 'name') ?? '').toLowerCase()
    const conds: Array<{ test: string; body: XmlElement }> = []
    const collect = (n: XmlElement, depth = 0) => {
      if (depth > 6) return
      for (const c of elements(n)) {
        if ((c.name === 'xsl:when' || c.name === 'xsl:if') && attr(c, 'test')) conds.push({ test: attr(c, 'test')!, body: c })
        else if (c.name === 'xsl:choose') collect(c, depth + 1)
      }
    }
    collect(a)
    for (const { test, body } of conds) {
      const text = plainTextAll(body)
      if (/function-available/.test(test)) continue
      const caption = /caption:\s*([^;]+)/i.exec(text)?.[1]?.trim()
      if ((name === 'style' && /display\s*:\s*none/i.test(text))) out.push({ condition: test, effect: 'hide', ...(caption ? { caption } : {}) })
      else if ((name === 'xd:disableediting' || name.endsWith('disableediting') || name === 'disabled' || name === 'contenteditable') && /yes|true|disabled|false/i.test(text)) {
        if (name === 'contenteditable' && !/false/i.test(text)) continue
        out.push({ condition: test, effect: 'disable', ...(caption ? { caption } : {}) })
      } else if (name === 'style' && text.replace(/caption:[^;]*;?/gi, '').trim()) {
        out.push({ condition: test, effect: 'style', style: text.replace(/caption:[^;]*;?/gi, '').trim().slice(0, 200), ...(caption ? { caption } : {}) })
      }
    }
  }
  return out
}

function plainTextAll(el: XmlElement): string {
  return el.children.map((c) => (typeof c === 'string' ? c : plainTextAll(c))).join('').replace(/\s+/g, ' ').trim()
}

function kindOf(el: XmlElement): { kind: IpControlKind; xct: string } | null {
  const xct = (xd(el, 'xctname') ?? '').toLowerCase()
  const c = cls(el)
  if (xct) {
    if (INNER_PARTS.has(xct)) return null
    if (xct.includes(PEOPLE_CLSID)) return { kind: 'people', xct }
    if (xct.startsWith('{')) return { kind: 'activex', xct }
    if (XCT_KIND[xct]) {
      // A date-time picker: the date picker with a time format.
      return { kind: XCT_KIND[xct], xct }
    }
    if (SECTION_XCT.has(xct) || xct === 'repeatingtable') return null
    return { kind: 'unknown', xct }
  }
  if (el.local === 'object') {
    const classid = (attr(el, 'classid') ?? attr(el, 'classId') ?? '').toLowerCase()
    return { kind: classid.includes(PEOPLE_CLSID) ? 'people' : 'activex', xct: classid || 'object' }
  }
  if (c.includes('xddtpicker')) return { kind: 'date', xct: 'DTPicker' }
  if (c.includes('xdexpressionbox')) return { kind: 'expression', xct: 'ExpressionBox' }
  if (c.includes('xdrichtextbox')) return { kind: 'richtext', xct: 'RichText' }
  if (xd(el, 'binding') && c.includes('xdtextbox')) return { kind: 'text', xct: 'PlainText' }
  if (el.local === 'select') return { kind: attr(el, 'size') && Number(attr(el, 'size')) > 1 ? 'listbox' : 'dropdown', xct: 'select' }
  if (el.local === 'textarea') return { kind: 'text', xct: 'textarea' }
  if (el.local === 'input') {
    const t = (attr(el, 'type') ?? 'text').toLowerCase()
    if (t === 'checkbox') return { kind: 'checkbox', xct: 'checkbox' }
    if (t === 'radio') return { kind: 'option', xct: 'radio' }
    if (t === 'button' || t === 'submit') return { kind: 'button', xct: 'button' }
    if (xd(el, 'binding')) return { kind: 'text', xct: 'input' }
    return null
  }
  if (xd(el, 'binding') && !c.includes('xddttext')) return { kind: c.includes('xdbehavior_boolean') ? 'checkbox' : 'text', xct: el.local }
  return null
}

function isSectionEl(el: XmlElement): boolean {
  const xct = (xd(el, 'xctname') ?? '').toLowerCase()
  if (SECTION_XCT.has(xct)) return true
  const c = cls(el)
  return el.local === 'div' && (/\bxdsection\b/.test(c) || /\bxdrepeatingsection\b/.test(c))
}

function isRepeatingTable(el: XmlElement): boolean {
  if (el.local !== 'table') return false
  if (/xdrepeatingtable/.test(cls(el)) || (xd(el, 'xctname') ?? '').toLowerCase() === 'repeatingtable') return true
  return elements(el).some((t) => t.local === 'tbody' && ((xd(t, 'xctname') ?? '').toLowerCase() === 'repeatingtable' || xd(t, 'repeating')))
}

function rowsOf(table: XmlElement): XmlElement[] {
  const out: XmlElement[] = []
  for (const c of elements(table)) {
    if (c.local === 'tr') out.push(c)
    else if (['tbody', 'thead', 'tfoot'].includes(c.local)) out.push(...elements(c).filter((r) => r.local === 'tr'))
  }
  return out
}

export function parseView(doc: XmlElement, meta: { name: string; caption: string; file: string; default: boolean; hidden: boolean; print_view?: string }, options: ViewParseOptions): IpView {
  const view: IpView = { ...meta, items: [], warnings: [] }
  const templates = elements(doc).filter((e) => e.name === 'xsl:template')
  const byMode = new Map<string, XmlElement[]>()
  for (const t of templates) {
    const mode = attr(t, 'mode') ?? ''
    byMode.set(mode, [...(byMode.get(mode) ?? []), t])
  }
  // The main template: mode-less, matching the root ("/" or my:root).
  const main = templates.find((t) => !attr(t, 'mode') && (attr(t, 'match') === '/' || localOf(attr(t, 'match') ?? '') === localOf(options.root.split('/').filter(Boolean)[0] ?? '')))
    ?? templates.find((t) => !attr(t, 'mode'))
  if (!main) { view.warnings.push(`${meta.file} has no main template`); return view }
  const mainCtx = attr(main, 'match') === '/' ? '' : options.root

  let rowCounter = 0
  let count = 0
  let generated = 0
  const nextRow = () => ++rowCounter

  const pushText = (items: IpViewItem[], ctx: Ctx, text: string, heading: boolean) => {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (!clean || /^[\s *]*$/.test(clean)) return
    const last = items[items.length - 1]
    // Text pieces in the same cell join up ("Name" + ":").
    if (last && last.kind === 'static' && last.row === ctx.row && last.col === ctx.col && ctx.inCell) {
      last.text = `${last.text} ${clean}`.replace(/\s+([:,.])/g, '$1')
      last.heading = last.heading && heading
      return
    }
    items.push({ kind: 'static', text: clean, heading, row: ctx.row, col: ctx.col })
  }

  const makeControl = (el: XmlElement, kind: IpControlKind, xct: string, ctx: Ctx): IpControl => {
    const id = xd(el, 'CtrlId') ?? `X${++generated}`
    let binding = xd(el, 'binding')
    let bindingEl = el
    if (!binding && (kind === 'date' || kind === 'datetime')) {
      const inner = findDesc(el, (e) => /xddttext/.test(cls(e)) || (xd(e, 'xctname') ?? '').toLowerCase() === 'dtpicker_dttext')
      if (inner) { binding = xd(inner, 'binding'); bindingEl = inner }
    }
    if (!binding && kind === 'people') {
      const p = findDesc(el, (e) => e.local === 'param' && /binding/i.test(attr(e, 'name') ?? ''))
      binding = p ? attr(p, 'value') : undefined
    }
    const control: IpControl = { id, kind, xctname: xct, row: ctx.row, col: ctx.col, context: ctx.path, formatting: [...formattingOf(el), ...(bindingEl !== el ? formattingOf(bindingEl) : [])] }
    if (binding && kind !== 'expression') {
      control.binding = binding
      const path = resolveBinding(ctx.path, binding)
      if (path) control.path = path
      else view.warnings.push(`${id}: binding ${binding} could not be followed`)
    }
    const title = attr(el, 'title')
    if (title && !/^CTRL\d+/i.test(title)) control.title = title
    if (ctx.showIf.length) control.formatting.push(...ctx.showIf.map((t) => ({ condition: `not(${t})`, effect: 'hide' as const })))
    const disable = xd(el, 'disableEditing') ?? xd(bindingEl, 'disableEditing')
    if (disable === 'yes') control.read_only = true
    const datafmt = (xd(bindingEl, 'datafmt') ?? '').toLowerCase()
    if (datafmt) control.format = datafmt.split(',')[0].replace(/"/g, '')
    if ((kind === 'date' || kind === 'text') && datafmt.includes('"datetime"')) control.kind = 'datetime'
    else if (kind === 'text' && datafmt.includes('"date"')) control.kind = 'date'
    else if (kind === 'text' && datafmt.includes('"time"')) control.kind = 'time'
    if (kind === 'checkbox' || kind === 'option') {
      const on = xd(el, 'onValue')
      const off = xd(el, 'offValue')
      if (on !== undefined) control.on_value = on
      if (off !== undefined) control.off_value = off
    }
    if (kind === 'button') {
      const caption = attr(el, 'value') ?? plainText(el)
      if (caption) control.caption = caption
    }
    if (kind === 'expression') {
      const v = findDesc(el, (e) => e.name === 'xsl:value-of')
      const select = attr(v, 'select') ?? binding
      if (select) control.expression = select
      delete control.path
      delete control.binding
    }
    if (kind === 'dropdown' || kind === 'combobox' || kind === 'listbox') {
      const { options: opts, source, placeholder } = selectOptions(el)
      if (opts.length) control.options = opts
      if (source) control.options_source = source
      if (placeholder) control.placeholder = placeholder
    }
    if (kind === 'multiselect') {
      const opts: IpOption[] = []
      for (const cb of findAll(el, (e) => e.local === 'input')) {
        const v = xd(cb, 'onValue')
        if (v === undefined) continue
        const after = nextText(el, cb)
        opts.push({ value: v, label: after || v })
      }
      if (opts.length) control.options = opts
      const each = findDesc(el, (e) => e.name === 'xsl:for-each')
      if (!control.binding) {
        const inner = findDesc(el, (e) => Boolean(xd(e, 'binding')) && e !== el)
        const b = inner ? xd(inner, 'binding') : attr(each, 'select')
        if (b && b !== '.') { control.binding = b; const p = resolveBinding(ctx.path, b); if (p) control.path = p }
      }
      if (each && /GetDOM/.test(attr(each, 'select') ?? '')) control.options_source = attr(each, 'select')
    }
    return control
  }

  function selectOptions(sel: XmlElement): { options: IpOption[]; source?: string; placeholder?: string } {
    const options: IpOption[] = []
    let placeholder: string | undefined
    let source: string | undefined
    const walk = (n: XmlElement, depth = 0) => {
      if (depth > 10) return
      for (const c of elements(n)) {
        if (c.local === 'option') {
          const label = textChildren(c) || plainText(c)
          const value = attr(c, 'value')
          if (value === undefined) {
            // A value from data (xsl:attribute name=value) or the "Select..." placeholder.
            const dyn = elements(c).find((x) => x.name === 'xsl:attribute' && attr(x, 'name') === 'value')
            if (dyn) continue
            if (label) placeholder = label
            continue
          }
          if (value === '' && label) { placeholder = label; continue }
          options.push({ value, label: label || value })
        } else if (c.name === 'xsl:for-each') {
          source = attr(c, 'select')
        } else walk(c, depth + 1)
      }
    }
    walk(sel)
    return { options, ...(source ? { source } : {}), ...(placeholder ? { placeholder } : {}) }
  }

  /** Walk the children of `el` into `items` (the current container). */
  function walkChildren(el: XmlElement, ctx: Ctx, items: IpViewItem[], depth: number) {
    for (const c of el.children) walkNode(c, ctx, items, depth + 1, el)
  }

  function walkNode(node: XmlChild, ctx: Ctx, items: IpViewItem[], depth: number, parent: XmlElement) {
    if (depth > MAX_DEPTH) { view.warnings.push('The view is nested too deeply: part of it is skipped'); return }
    if (++count > MAX_ITEMS * 10) return
    if (typeof node === 'string') {
      if (ctx.inCell || node.trim()) {
        const heading = isHeadingContext(parent)
        pushText(items, ctx, node, heading)
      }
      return
    }
    const el = node
    if (SKIP_TAGS.has(el.local) && !el.name.startsWith('xsl:')) return
    if (el.name.startsWith('xsl:')) return walkXsl(el, ctx, items, depth)
    if (/optionalplaceholder/.test(cls(el)) || /xCollection::insert|xOptional::insert/.test(xd(el, 'action') ?? '')) return
    if (isRepeatingTable(el)) return repeatingTable(el, ctx, items, depth)
    if (isSectionEl(el)) return section(el, ctx, items, depth)
    const k = kindOf(el)
    if (k) {
      if (items.length + 1 > MAX_ITEMS) return
      items.push(makeControl(el, k.kind, k.xct, ctx))
      return
    }
    if (el.local === 'table') return layoutTable(el, ctx, items, depth)
    if (el.local === 'hr') { items.push({ kind: 'static', text: '—', heading: false, row: nextRow(), col: 0 }); return }
    // Block elements outside a cell start a new row.
    if (!ctx.inCell && ['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr'].includes(el.local)) {
      const blockCtx = { ...ctx, row: nextRow(), col: 0 }
      return walkChildren(el, blockCtx, items, depth)
    }
    walkChildren(el, ctx, items, depth)
  }

  function walkXsl(el: XmlElement, ctx: Ctx, items: IpViewItem[], depth: number) {
    switch (el.local) {
      case 'attribute': case 'variable': case 'param': case 'value-of': case 'text': case 'copy-of': case 'comment': return
      case 'if': {
        const test = attr(el, 'test') ?? ''
        if (/function-available|xdImage|xdXDocument:IsSigned/.test(test)) return walkChildren(el, ctx, items, depth)
        return walkChildren(el, { ...ctx, showIf: [...ctx.showIf, test] }, items, depth)
      }
      case 'choose': {
        // Show conditions per branch (when / otherwise).
        const branches = elements(el)
        const tests: string[] = []
        for (const b of branches) {
          if (b.local === 'when') { const t = attr(b, 'test') ?? ''; walkChildren(b, { ...ctx, showIf: [...ctx.showIf, t] }, items, depth); tests.push(t) }
          else if (b.local === 'otherwise') walkChildren(b, { ...ctx, showIf: [...ctx.showIf, ...tests.map((t) => `not(${t})`)] }, items, depth)
        }
        return
      }
      case 'apply-templates': {
        const select = attr(el, 'select') ?? ''
        const mode = attr(el, 'mode') ?? ''
        const target = resolveBinding(ctx.path, select)
        if (!target) { if (select) view.warnings.push(`Template for ${select} could not be followed`); return }
        const leaf = localOf(select.split('/').filter(Boolean).pop() ?? '')
        const candidates = byMode.get(mode) ?? []
        const tpl = candidates.find((t) => localOf((attr(t, 'match') ?? '').split('/').pop() ?? '') === leaf) ?? candidates[0]
        if (!tpl) return
        const key = `${mode}|${target}`
        if (ctx.templates.includes(key)) return
        const inner: Ctx = { ...ctx, path: target, templates: [...ctx.templates, key] }
        // A repeating node rendered by a template without its own section div: a repeating section.
        if (options.isRepeating(target) && !findDesc(tpl, (e) => isSectionEl(e) || isRepeatingTable(e))) {
          const control: IpControl = { id: `X${++generated}`, kind: 'repeating_section', xctname: 'apply-templates', path: target, binding: select, row: nextRow(), col: 0, formatting: [], children: [] }
          walkChildren(tpl, { ...inner, row: control.row, col: 0, inCell: false, repeating: ctx.repeating + 1, showIf: [] }, control.children!, depth)
          items.push(control)
          return
        }
        return walkChildren(tpl, inner, items, depth)
      }
      case 'for-each': {
        const select = attr(el, 'select') ?? ''
        if (/GetDOM/.test(select)) return // data-connection repeat (options etc.)
        const target = resolveBinding(ctx.path, select)
        if (!target) return
        if (options.isRepeating(target) && !findDesc(el, (e) => isSectionEl(e))) {
          const control: IpControl = { id: `X${++generated}`, kind: 'repeating_section', xctname: 'for-each', path: target, binding: select, row: nextRow(), col: 0, formatting: [], children: [] }
          walkChildren(el, { ...ctx, path: target, row: control.row, col: 0, inCell: false, repeating: ctx.repeating + 1, showIf: [] }, control.children!, depth)
          items.push(control)
          return
        }
        return walkChildren(el, { ...ctx, path: target }, items, depth)
      }
      case 'call-template': return
      default: return walkChildren(el, ctx, items, depth)
    }
  }

  function section(el: XmlElement, ctx: Ctx, items: IpViewItem[], depth: number) {
    const xct = (xd(el, 'xctname') ?? '').toLowerCase()
    const c = cls(el)
    const repeating = xct === 'repeatingsection' || /xdrepeatingsection/.test(c)
    const optional = xct === 'optionalsection' || /xdoptional/.test(c) || options.isOptional(ctx.path)
    const kind: IpControlKind = repeating ? 'repeating_section' : optional ? 'optional_section' : 'section'
    const control: IpControl = {
      id: xd(el, 'CtrlId') ?? `X${++generated}`, kind, xctname: xd(el, 'xctname') ?? 'section', path: ctx.path, context: ctx.path,
      row: nextRow(), col: 0, formatting: formattingOf(el), children: [],
    }
    const caption = attr(el, 'caption') ?? attr(el, 'caption_0') ?? xd(el, 'caption')
    if (caption && !/^Rule \d+$/i.test(caption)) control.caption = caption
    const title = attr(el, 'title')
    if (title && !/^CTRL\d+/i.test(title)) control.title = title
    if (ctx.showIf.length) control.show_if = ctx.showIf.length === 1 ? ctx.showIf[0] : ctx.showIf.map((t) => `(${t})`).join(' and ')
    walkChildren(el, { ...ctx, row: control.row, col: 0, inCell: false, showIf: [], repeating: kind === 'repeating_section' ? ctx.repeating + 1 : ctx.repeating }, control.children!, depth)
    items.push(control)
  }

  function layoutTable(table: XmlElement, ctx: Ctx, items: IpViewItem[], depth: number) {
    for (const tr of rowsOf(table)) {
      const row = nextRow()
      let col = 0
      for (const td of elements(tr).filter((c) => c.local === 'td' || c.local === 'th' || c.name === 'xsl:if' || c.name === 'xsl:choose')) {
        if (td.name.startsWith('xsl:')) { walkXsl(td, { ...ctx, row, col, inCell: true }, items, depth); continue }
        walkChildren(td, { ...ctx, row, col, inCell: true }, items, depth)
        col += Math.max(1, Number(attr(td, 'colSpan') ?? attr(td, 'colspan') ?? 1) || 1)
      }
    }
  }

  function repeatingTable(table: XmlElement, ctx: Ctx, items: IpViewItem[], depth: number) {
    const bodies = elements(table).filter((e) => ['tbody', 'thead', 'tfoot'].includes(e.local))
    const header = bodies.find((b) => /xdtableheader/.test(cls(b)) || b.local === 'thead')
    const footer = bodies.find((b) => /xdtablefooter/.test(cls(b)) || b.local === 'tfoot')
    const body = bodies.find((b) => (xd(b, 'xctname') ?? '').toLowerCase() === 'repeatingtable' || xd(b, 'repeating')) ?? bodies.find((b) => b !== header && b !== footer)
    const headers: string[] = []
    const headRow = header ? elements(header).find((r) => r.local === 'tr') : undefined
    for (const cell of headRow ? elements(headRow).filter((c) => c.local === 'td' || c.local === 'th') : []) headers.push(plainText(cell))
    const control: IpControl = { id: xd(body ?? table, 'CtrlId') ?? xd(table, 'CtrlId') ?? `X${++generated}`, kind: 'repeating_table', xctname: 'RepeatingTable', row: nextRow(), col: 0, context: ctx.path, formatting: formattingOf(table), children: [], headers }
    const title = attr(table, 'title') ?? attr(body ?? table, 'title')
    if (title && !/^CTRL\d+/i.test(title)) control.title = title
    if (ctx.showIf.length) control.show_if = ctx.showIf.join(' and ')
    // The repeated row: xsl:for-each select / apply-templates in the body.
    let rowCtx = ctx.path
    let rowEl: XmlElement | undefined = body
    const each = body ? findDesc(body, (e) => e.name === 'xsl:for-each' || e.name === 'xsl:apply-templates') : undefined
    if (each) {
      const select = attr(each, 'select') ?? ''
      const target = resolveBinding(ctx.path, select)
      if (target) { rowCtx = target; control.path = target; control.binding = select }
      if (each.name === 'xsl:apply-templates') {
        const mode = attr(each, 'mode') ?? ''
        const leaf = localOf(select.split('/').pop() ?? '')
        rowEl = (byMode.get(mode) ?? []).find((t) => localOf((attr(t, 'match') ?? '').split('/').pop() ?? '') === leaf) ?? (byMode.get(mode) ?? [])[0]
      } else rowEl = each
    }
    if (rowEl) {
      const tr = findDesc(rowEl, (e) => e.local === 'tr') ?? rowEl
      let col = 0
      for (const td of elements(tr).filter((c) => c.local === 'td')) {
        const cellItems: IpViewItem[] = []
        walkChildren(td, { ...ctx, path: rowCtx, row: control.row, col, inCell: true, repeating: ctx.repeating + 1, showIf: [] }, cellItems, depth)
        for (const item of cellItems) {
          if (item.kind !== 'static' && !item.label && headers[col]) item.label = headers[col]
          if (item.kind === 'static') continue // static text in a row cell
          control.children!.push(item)
        }
        col += Math.max(1, Number(attr(td, 'colSpan') ?? 1) || 1)
      }
    }
    items.push(control)
    if (footer) layoutTable({ ...footer, local: 'table', name: 'table', attrs: {}, children: footer.children }, ctx, items, depth)
  }

  function isHeadingContext(parent: XmlElement): boolean {
    if (['strong', 'b', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em'].includes(parent.local)) return true
    if (parent.local === 'font' && Number(attr(parent, 'size') ?? 0) >= 3) return true
    const style = (attr(parent, 'style') ?? '').toLowerCase()
    return /font-weight\s*:\s*bold/.test(style) || /font-size\s*:\s*(1[4-9]|[2-9]\d)pt/.test(style)
  }

  walkChildren(main, { path: mainCtx, row: nextRow(), col: 0, inCell: false, repeating: 0, showIf: [], templates: [] }, view.items, 0)
  associateLabels(view.items)
  return view
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function findDesc(el: XmlElement, pred: (e: XmlElement) => boolean, depth = 0): XmlElement | undefined {
  if (depth > 60) return undefined
  for (const c of elements(el)) {
    if (pred(c)) return c
    const hit = findDesc(c, pred, depth + 1)
    if (hit) return hit
  }
  return undefined
}

function findAll(el: XmlElement, pred: (e: XmlElement) => boolean, depth = 0, out: XmlElement[] = []): XmlElement[] {
  if (depth > 60) return out
  for (const c of elements(el)) {
    if (pred(c)) out.push(c)
    findAll(c, pred, depth + 1, out)
  }
  return out
}

/** The text right after `target` inside `root` (a check box's caption). */
function nextText(root: XmlElement, target: XmlElement): string {
  let found = false
  let text = ''
  const walk = (n: XmlElement, depth = 0): boolean => {
    if (depth > 40) return false
    for (const c of n.children) {
      if (c === target) { found = true; continue }
      if (typeof c === 'string') { if (found && c.trim()) { text = c.trim(); return true } continue }
      if (c.name.startsWith('xsl:') && found) continue
      if (found && (c.local === 'input')) return true
      if (walk(c, depth + 1)) return true
    }
    return false
  }
  walk(root)
  return text
}

const LABELLED: ReadonlySet<IpControlKind> = new Set(['text', 'richtext', 'date', 'datetime', 'time', 'dropdown', 'combobox', 'listbox', 'multiselect', 'checkbox', 'option', 'attachment', 'expression', 'hyperlink', 'people', 'picture', 'signature', 'ink', 'activex', 'bulleted_list', 'unknown'])

/**
 * Match static text to the controls it labels and merge option buttons that
 * share a binding. Consumed text is removed; the rest stays as headings /
 * instructions. Recurses into sections and repeating parts.
 */
export function associateLabels(items: IpViewItem[]) {
  const consumed = new Set<IpText>()
  const texts = items.filter((i): i is IpText => i.kind === 'static')
  const controls = (row: number) => items.filter((i): i is IpControl => i.kind !== 'static' && i.row === row)
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]
    if (item.kind === 'static') continue
    if (item.children) associateLabels(item.children)
    if ((item.kind === 'repeating_table' || item.kind === 'repeating_section') && !item.label) {
      const prev = items[idx - 1]
      if (prev && prev.kind === 'static' && !consumed.has(prev) && prev.text.length <= 80) { item.label = prev.text.replace(/:\s*$/, ''); consumed.add(prev) }
      continue
    }
    if (!LABELLED.has(item.kind) || item.label) continue
    const sameCell = (t: IpText) => t.row === item.row && t.col === item.col && !consumed.has(t)
    const before = items.slice(0, idx).reverse().find((i): i is IpText => i.kind === 'static' && sameCell(i))
    const afterItem = items[idx + 1]
    const after = afterItem && afterItem.kind === 'static' && sameCell(afterItem) ? afterItem : undefined
    // Check boxes and option buttons: the caption follows them.
    if ((item.kind === 'checkbox' || item.kind === 'option') && after) {
      if (item.kind === 'option') {
        item.options = [{ value: item.on_value ?? after.text, label: after.text.replace(/:$/, '') }]
        consumed.add(after)
        if (before && !before.heading) { item.label = before.text.replace(/:\s*$/, ''); consumed.add(before) }
        else {
          const left = texts.filter((t) => t.row === item.row && t.col < item.col && !consumed.has(t)).sort((a, b) => b.col - a.col)[0]
          if (left) { item.label = left.text.replace(/:\s*$/, ''); consumed.add(left) }
        }
        continue
      }
      item.label = after.text.replace(/:$/, '')
      consumed.add(after)
      continue
    }
    if (before) { item.label = before.text.replace(/:\s*$/, ''); consumed.add(before); continue }
    // The nearest cell to the left in the same row, with no control in between.
    const left = texts.filter((t) => t.row === item.row && t.col < item.col && !consumed.has(t)).sort((a, b) => b.col - a.col)[0]
    if (left && !controls(item.row).some((c) => c !== item && c.col > left.col && c.col < item.col)) { item.label = left.text.replace(/:\s*$/, ''); consumed.add(left); continue }
    // The cell above (a label row over an input row).
    const above = texts.filter((t) => t.row < item.row && t.col === item.col && !consumed.has(t) && !controls(t.row).length).sort((a, b) => b.row - a.row)[0]
    if (above && item.row - above.row <= 2 && (!above.heading || /:\s*$/.test(above.text))) { item.label = above.text.replace(/:\s*$/, ''); consumed.add(above); continue }
    if (item.kind === 'option' && item.on_value !== undefined && !item.options) item.options = [{ value: item.on_value, label: item.on_value }]
  }
  // Merge option buttons bound to the same node into one control.
  const firstByPath = new Map<string, IpControl>()
  const merged = new Set<IpControl>()
  for (const item of items) {
    if (item.kind !== 'option' || !item.path) continue
    const firstOpt = firstByPath.get(item.path)
    if (!firstOpt) { firstByPath.set(item.path, item); if (!item.options && item.on_value !== undefined) item.options = [{ value: item.on_value, label: item.on_value }]; continue }
    for (const o of item.options ?? (item.on_value !== undefined ? [{ value: item.on_value, label: item.on_value }] : [])) {
      if (!firstOpt.options?.some((x) => x.value === o.value)) (firstOpt.options ??= []).push(o)
    }
    ;(firstOpt.merged ??= []).push(item.id)
    if (!firstOpt.label && item.label) firstOpt.label = item.label
    merged.add(item)
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if ((it.kind === 'static' && consumed.has(it)) || (it.kind !== 'static' && merged.has(it))) items.splice(i, 1)
  }
  for (const item of items) if (item.kind !== 'static' && !item.label && LABELLED.has(item.kind)) item.label = item.title ?? humanize(item.path ?? item.binding)
}

export { humanize }
