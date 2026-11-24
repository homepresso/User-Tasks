/**
 * Raw AcroForm fields (+ the hybrid XFA template, + the page text) → the
 * intermediate model (pure: no I/O, so tests drive it directly).
 *
 *   labels     tooltip → XFA caption → nearby printed text → field name
 *   types      field kind + Acrobat script patterns (js-actions.ts)
 *   merges     checkbox families (X[0], X[1] … with distinct values),
 *              mutually exclusive checkboxes (scripts), Yes / No grids
 *              (separate boxes sharing one question), "Question - Option"
 *              checkbox families → one choice / multiple choice;
 *              split date / SSN / EIN boxes → one field
 *   required   the flag (rarely set) → XFA nullTest → an asterisk →
 *              "(required)" / "An entry is required" in the label
 *   order      page, row, column; printed question numbers; Part / Section
 *              headings → sections
 *   rules      Acrobat show / hide scripts, XFA presence scripts; printed
 *              routing text is linked afterwards (routing.ts)
 */

import { nearbyLabel, type PageText, type RawField, type Rect } from './acroform'
import { translateActions, type JsTranslation, type JsVisibility } from './js-actions'
import { cleanLabel, humanizeFieldName, type PdfCondition, type PdfFormModel, type PdfItem, type PdfOption, type PdfRule, type PdfSection } from './model'
import { questionNumberOf, type RoutingText } from './routing'
import { detectTables } from './tables'
import type { XfaField, XfaTemplate } from './xfa'
import { xfaScriptRules } from './xfa-rules'

export interface InferInput {
  title: string
  fields: RawField[]
  pages: PageText[]
  xfa: XfaTemplate | null
}

export interface InferResult {
  model: PdfFormModel
  routingTexts: RoutingText[]
}

const REQUIRED_TEXT = /\((?:required|mandatory)\)|\ban entry is required\b|\b(?:required|mandatory)\s+field\b|\bthis (?:field|question|box|section) (?:is|must be) (?:required|completed)\b|\s[-–]\s*required$/i

/** Is the label telling us the field is required (an asterisk, "(required)" …)? */
export function requiredFromText(raw: string): 'asterisk' | 'text' | null {
  const s = String(raw ?? '').trim()
  if (/^\*|\*\s*[:：]?$/.test(s) || /\s\*\s/.test(s)) return 'asterisk'
  if (REQUIRED_TEXT.test(s)) return 'text'
  return null
}

const cy = (r: Rect) => (r[1] + r[3]) / 2
const meaningful = (s: string, name: string) => {
  const t = s.trim()
  return t.length >= 2 && /[A-Za-zÀ-ɏЀ-ӿ一-鿿]/.test(t) && t !== name && t !== humanizeFieldName(name)
}

/** Screen-reader tooltips → labels: "Section 1., Enter First Name (Given Name)." → "First Name (Given Name)". */
export function tidyTooltip(raw: string): string {
  let t = String(raw ?? '').replace(/\s+/g, ' ').trim()
  const stripped = t.replace(/^(?:section|part|step|page)\s+[\w-]+\.?,?\s*(?:list\s+[A-C]\.\s*)?/i, '')
  if (stripped.length >= 3 && stripped !== t && /^[A-Za-z]/.test(stripped)) t = stripped
  const select = /^(?:please\s+)?select\s+(?:the\s+|your\s+)?(.{2,80}?)\s+from\s+the\s+(?:drop[- ]?down|list).*$/i.exec(t)
  if (select) t = select[1]
  t = t.replace(/^(?:please\s+)?(?:enter|type|provide|insert)\s+(?:the\s+|your\s+)?/i, '')
  t = t.replace(/\.\s*$/, '')
  // "Special Requests/Notes_1": a copy-paste counter, not part of the label.
  if (/[A-Za-z]{2}_\d{1,3}$/.test(t)) t = t.replace(/_\d{1,3}$/, '')
  return t ? t[0].toUpperCase() + t.slice(1) : String(raw ?? '')
}

/** Long labels: the first sentence (≤ 150 chars) is the label, the whole text the help. */
function splitLongLabel(text: string): { label: string; help?: string } {
  const t = cleanLabel(text)
  if (t.length <= 150) return { label: t }
  const sentence = /^(.{20,150}?[.?!:])\s/.exec(t)
  const label = sentence ? sentence[1] : `${t.slice(0, 140).replace(/\s+\S*$/, '')}…`
  return { label: cleanLabel(label), help: t.slice(0, 1000) }
}

interface Work {
  item: PdfItem
  raw: RawField[]
  js: JsTranslation
  /** Per option value: the text printed right of its box (routing). */
  optionText: Map<string, string>
  /** For per-widget scripts (radio options): option value → its translation. */
  widgetJs: Array<{ onValue: string; js: JsTranslation }>
  /** The printed question text the XFA template draws before the field (hybrid PDFs). */
  context?: string
  /** Merged away into another item. */
  dead?: boolean
}

export function inferFromAcroForm(input: InferInput): InferResult {
  const notes: string[] = []
  const xfaBySom = new Map<string, XfaField>((input.xfa?.fields ?? []).map((f) => [f.som, f]))
  const linesOf = new Map(input.pages.map((p) => [p.page, p.lines]))
  const works: Work[] = []
  const skipped: string[] = []

  for (const f of input.fields) {
    if (f.kind === 'push') { skipped.push(f.name); continue }
    if (f.kind === 'other') { skipped.push(f.name); continue }
    const lines = linesOf.get(f.page) ?? []
    const xfa = xfaBySom.get(f.name)
    const isOptionGroup = f.kind === 'radio' || (f.kind === 'checkbox' && new Set(f.widgets.map((w) => w.onValue)).size > 1)
    // Label: tooltip → XFA caption / tooltip / question text → nearby text → name.
    let labelSource: PdfItem['labelSource'] = 'field_name'
    let rawLabel = ''
    if (meaningful(f.tooltip, f.name)) { rawLabel = f.tooltip; labelSource = 'tooltip' }
    else if (xfa && meaningful(xfa.caption, f.name)) { rawLabel = xfa.caption; labelSource = 'xfa_caption' }
    else if (xfa && meaningful(xfa.tooltip, f.name)) { rawLabel = xfa.tooltip; labelSource = 'xfa_caption' }
    else if (xfa && isOptionGroup && meaningful(xfa.context, f.name)) { rawLabel = xfa.context; labelSource = 'xfa_caption' }
    else {
      const near = isOptionGroup
        ? nearbyLabel(lines, unionRect(f.widgets.map((w) => w.rect)), 'left')
        : nearbyLabel(lines, f.rect, f.kind === 'checkbox' ? 'right' : 'left')
      if (near && meaningful(near.text, f.name)) { rawLabel = near.text; labelSource = 'nearby_text' }
      else rawLabel = humanizeFieldName(f.name)
    }
    const reqText = requiredFromText(rawLabel) ?? (labelSource !== 'nearby_text' ? requiredFromText(nearbyLabel(lines, f.rect, 'left')?.text ?? '') : null)
    const { label, help } = splitLongLabel(labelSource === 'tooltip' ? tidyTooltip(rawLabel) : rawLabel)
    const js = translateActions(isOptionGroup && f.kind === 'radio' ? null : f.actions)
    const widgetJs: Work['widgetJs'] = []
    if (f.kind === 'radio' || f.kind === 'checkbox') {
      for (const w of f.widgets) if (w.actions) widgetJs.push({ onValue: w.onValue ?? 'Yes', js: translateActions(w.actions) })
    }
    const item: PdfItem = {
      id: f.name, type: 'text', label: label || humanizeFieldName(f.name), labelSource, page: f.page, rect: f.rect,
      sourceFields: [f.name], origin: 'deterministic', notes: [],
      ...(help ? { help } : {}),
    }
    const optionText = new Map<string, string>()
    switch (f.kind) {
      case 'text':
        item.type = js.type ?? (xfa?.type && xfa.type !== 'boolean' && xfa.type !== 'choice' ? xfa.type : 'text')
        break
      case 'multiline': item.type = 'textarea'; break
      case 'signature': item.type = 'signature'; break
      case 'combo': case 'list':
        item.type = f.multiSelect ? 'multi_choice' : 'choice'
        item.display = f.kind === 'list' ? (f.multiSelect ? 'listbox' : 'dropdown') : 'dropdown'
        item.options = dedupeOptions(f.options.map((o) => ({ value: o.value, label: o.label || o.value })))
        if (!item.options.length && xfa?.options.length) item.options = dedupeOptions(xfa.options)
        break
      case 'radio': case 'checkbox': {
        if (isOptionGroup) {
          item.type = 'choice'
          item.display = 'radio'
          const opts: PdfOption[] = []
          for (const w of f.widgets) {
            const value = w.onValue ?? `Option ${opts.length + 1}`
            if (opts.some((o) => o.value === value)) continue
            const member = xfa?.members?.find((m) => m.onValue === value)
            const right = w.rightText ?? ''
            optionText.set(value, right)
            opts.push({ value, label: optionLabel(right) || member?.caption || value })
          }
          item.options = opts
        } else {
          item.type = 'boolean'
          const w = f.widgets[0]
          if (w?.rightText) optionText.set('true', w.rightText)
          if (f.widgets.length > 1) item.notes.push(`appears ${f.widgets.length} times in the PDF (one checkbox here)`)
        }
        break
      }
    }
    if (f.kind === 'text' && f.widgets.length > 1) item.notes.push(`appears ${f.widgets.length} times in the PDF (one field here)`)
    // Text-like details.
    if (item.type === 'text' || item.type === 'textarea' || item.type === 'phone' || item.type === 'email') {
      const max = f.maxLen ?? xfa?.maxChars
      if (max) item.maxLength = max
      if (js.pattern) { item.pattern = js.pattern; if (js.patternMessage) item.patternMessage = js.patternMessage }
      if (!js.type && /\be-?mail\b/i.test(label)) item.type = 'email'
      else if (!js.type && item.type === 'text' && (f.maxLen ?? 10) <= 10 && /\bdd\s*\/?\s*mm\b|\bmm\s*\/?\s*dd\b|\bdate of birth\b|^date\b|\bdate\s*\(/i.test(rawLabel)) {
        item.type = 'date'
        delete item.maxLength
        item.notes.push('a date (from its label)')
      }
    }
    if (item.type === 'number' || item.type === 'currency') {
      if (js.min !== undefined) item.min = js.min
      if (js.max !== undefined) item.max = js.max
      if (item.type === 'currency') item.currency = js.currency ?? 'USD'
    }
    if (js.calc) { item.calc = js.calc; item.readOnly = true }
    if (js.translated.length) item.notes.push(`Acrobat script: ${js.translated.join(', ')}`)
    if (js.untranslated.length || widgetJs.some((w) => w.js.untranslated.length)) item.untranslated = [...js.untranslated, ...widgetJs.flatMap((w) => w.js.untranslated)].slice(0, 10)
    // Required.
    if (f.required) { item.required = true; item.requiredSource = 'flag' }
    else if (xfa?.required) { item.required = true; item.requiredSource = 'xfa' }
    else if (reqText) { item.required = true; item.requiredSource = reqText }
    if (f.readOnly && !js.calc) item.readOnly = true
    if (f.hidden || xfa?.hidden) item.hidden = true
    works.push({ item, raw: [f], js, optionText, widgetJs, ...(xfa?.context ? { context: xfa.context } : {}) })
  }

  mergeCheckboxFamilies(works, linesOf)
  mergeExclusive(works)
  mergeSharedQuestion(works)
  mergeSplitBoxes(works, linesOf)

  let live = works.filter((w) => !w.dead)
  // Reading order: page, row (6 pt buckets, top first), column.
  live.sort((a, b) => a.item.page - b.item.page || Math.round((b.item.rect?.[3] ?? 0) / 6) - Math.round((a.item.rect?.[3] ?? 0) / 6) || (a.item.rect?.[0] ?? 0) - (b.item.rect?.[0] ?? 0))
  // Unique ids are the PDF names already; keep a name → item map for scripts.
  const itemOfField = new Map<string, PdfItem>()
  for (const w of live) for (const n of w.item.sourceFields) itemOfField.set(n, w.item)

  assignQuestions(live.map((w) => w.item), input.pages)
  const sections = assignSections(live.map((w) => w.item), input.pages)

  // Rules from Acrobat scripts.
  const rules: PdfRule[] = []
  let ruleN = 0
  const nextId = () => `rule_${++ruleN}`
  const jsRules = collectJsRules(live, itemOfField)
  for (const r of jsRules) rules.push({ id: nextId(), ...r })
  // Rules from the hybrid XFA template's presence scripts.
  if (input.xfa) {
    const xr = xfaScriptRules(input.xfa, { field: (som) => itemOfField.get(som)?.id ?? null, section: () => null })
    for (const r of xr.rules) rules.push({ id: nextId(), ...r })
  }
  // Conditional "required" toggles: noted on the target.
  for (const w of live) {
    for (const r of [...w.js.required, ...w.widgetJs.flatMap((x) => x.js.required)]) {
      const target = itemOfField.get(r.target)
      if (target) target.notes.push(`an Acrobat script makes it ${r.value ? 'required' : 'optional'} when "${w.item.label}" changes: rebuild it as a rule if needed`)
    }
  }

  // Routing text: an option's trailing text, and lines with routing words near choice questions.
  const routingTexts: RoutingText[] = []
  for (const w of live) {
    for (const [value, text] of w.optionText) if (text) routingTexts.push({ itemId: w.item.id, optionValue: value, text, page: w.item.page })
  }
  for (const p of input.pages) {
    const choices = live.filter((w) => w.item.page === p.page && (w.item.type === 'choice' || w.item.type === 'boolean') && w.item.rect)
    for (const l of p.lines) {
      if (!/\b(?:skip|go|continue|proceed|answer|complete)\b/i.test(l.str)) continue
      if (live.some((w) => [...w.optionText.values()].some((t) => t && t.includes(l.str)))) continue
      const near = choices
        .map((w) => ({ w, d: l.y - cy(w.item.rect!) }))
        .filter((x) => x.d > -60 && x.d < 140)
        .sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0]
      if (near) routingTexts.push({ itemId: near.w.item.id, text: l.str, page: p.page })
    }
  }

  live = live.filter((w) => !w.dead)
  // Tables of boxes → repeating lists (their cells stay as items, relabelled "Header (row label)").
  const tables = detectTables({ title: input.title, kind: 'acroform', pages: input.pages.length, sections, items: live.map((w) => w.item), rules, notes }, input.pages)
  if (skipped.length) notes.push(`${skipped.length} button${skipped.length === 1 ? '' : 's'} (print, reset, submit …) left out: ${skipped.slice(0, 8).join(', ')}${skipped.length > 8 ? ' …' : ''}`)
  const model: PdfFormModel = {
    title: input.title, kind: input.xfa?.fields.length ? 'hybrid' : 'acroform', pages: input.pages.length || Math.max(1, ...live.map((w) => w.item.page)),
    sections, items: live.map((w) => w.item), rules, notes, ...(tables.length ? { tables } : {}),
  }
  return { model, routingTexts }
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function unionRect(rects: Rect[]): Rect {
  if (!rects.length) return [0, 0, 0, 0]
  return [Math.min(...rects.map((r) => r[0])), Math.min(...rects.map((r) => r[1])), Math.max(...rects.map((r) => r[2])), Math.max(...rects.map((r) => r[3]))]
}

function dedupeOptions(list: PdfOption[]): PdfOption[] {
  const seen = new Set<string>()
  return list.map((o) => ({ value: o.value.trim(), label: o.label.trim() })).filter((o) => { if (!o.value || seen.has(o.value)) return false; seen.add(o.value); return true }).slice(0, 200)
}

/** An option's label from the text right of its box, without routing ("No Go to question 10" → "No"). */
export function optionLabel(right: string): string {
  const yn = /^(yes|no|don['’]?t know|do not know|not sure)\b[\s,.:;–—-]+\S/i.exec(String(right ?? '').trim())
  if (yn) return yn[1][0].toUpperCase() + yn[1].slice(1)
  return cleanLabel(String(right ?? '')
    .replace(/\s*(?:[(➔➜→►▶]|->|–|—|-)?\s*(?:if\s+\w+[,]?\s+)?(?:please\s+)?(?:skip|go|continue|proceed|move|turn|jump)\s+(?:on\s+|straight\s+|directly\s+|now\s+|ahead\s+)?to\b.*$/i, '')
    .replace(/[)]\s*$/, '')).slice(0, 200)
}

function kill(target: Work, into: Work) {
  target.dead = true
  into.raw.push(...target.raw)
  into.item.sourceFields.push(...target.item.sourceFields)
  for (const wj of target.widgetJs) into.widgetJs.push(wj)
  into.js.visibility.push(...target.js.visibility)
  into.js.required.push(...target.js.required)
  if (target.item.required && !into.item.required) { into.item.required = true; into.item.requiredSource = target.item.requiredSource }
}

const baseName = (n: string) => n.replace(/\[\d+\]$/, '')

/** X[0], X[1] … checkboxes with distinct "on" values: one exclusive group (as XFA binds them). */
function mergeCheckboxFamilies(works: Work[], linesOf: Map<number, PageText['lines']>) {
  const groups = new Map<string, Work[]>()
  for (const w of works) {
    const f = w.raw[0]
    if (w.dead || f.kind !== 'checkbox' || w.item.type !== 'boolean' || !/\[\d+\]$/.test(f.name)) continue
    const key = `${f.page}|${baseName(f.name)}`
    groups.set(key, [...(groups.get(key) ?? []), w])
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const values = list.map((w) => w.raw[0].widgets[0]?.onValue ?? '')
    if (new Set(values).size !== list.length || values.some((v) => !v || v === 'Off')) continue
    const head = list[0]
    const opts: PdfOption[] = []
    list.forEach((w, i) => {
      const right = w.raw[0].widgets[0]?.rightText ?? ''
      const label = optionLabel(right) || (w.item.labelSource !== 'field_name' ? w.item.label : '') || values[i]
      opts.push({ value: values[i], label })
      head.optionText.set(values[i], right)
    })
    head.item.type = 'choice'
    head.item.display = 'radio'
    head.item.options = dedupeOptions(opts)
    head.item.id = baseName(head.raw[0].name)
    // The question: the text left of / above the group (the boxes' own labels are its options).
    const ownQuestion = head.item.labelSource === 'tooltip' && !opts.some((o) => o.label === head.item.label)
    if (!ownQuestion) {
      const near = nearbyLabel(linesOf.get(head.item.page) ?? [], unionRect(list.map((w) => w.raw[0].rect)), 'left')
      const context = head.context && !opts.some((o) => head.context!.startsWith(o.label)) ? head.context : ''
      const text = context || (near && !opts.some((o) => near.text.startsWith(o.label)) ? near.text : '')
      const split = splitLongLabel(text || 'Choose one')
      head.item.label = split.label
      if (split.help) head.item.help = split.help
      head.item.labelSource = context ? 'xfa_caption' : text ? 'nearby_text' : 'field_name'
    }
    head.item.notes.push(`${list.length} checkboxes with one name and different values merged into one choice`)
    for (const w of list.slice(1)) kill(w, head)
    for (const w of list.slice(1)) head.optionText.set(w.raw[0].widgets[0]?.onValue ?? '', w.raw[0].widgets[0]?.rightText ?? '')
  }
}

/** Checkboxes whose scripts turn the others off: one exclusive choice. */
function mergeExclusive(works: Work[]) {
  const byName = new Map(works.map((w) => [w.raw[0].name, w]))
  for (const w of works) {
    if (w.dead || w.item.type !== 'boolean') continue
    const others = [...w.js.exclusiveWith, ...w.widgetJs.flatMap((x) => x.js.exclusiveWith)].map((n) => byName.get(n)).filter((x): x is Work => Boolean(x && !x.dead && x !== w && x.item.type === 'boolean'))
    if (!others.length) continue
    const members = [w, ...others]
    w.item.type = 'choice'
    w.item.display = 'radio'
    w.item.options = members.map((m) => {
      const right = m.raw[0].widgets[0]?.rightText ?? ''
      const label = optionLabel(right) || m.item.label
      w.optionText.set(label, right)
      return { value: label, label }
    })
    w.item.options = dedupeOptions(w.item.options)
    w.item.notes.push(`${members.length} checkboxes an Acrobat script keeps mutually exclusive merged into one choice`)
    for (const o of others) kill(o, w)
  }
}

const YES_NO = /^(yes|no|don['’]?t know|do not know|not sure|n\/a|not applicable|unsure|true|false)$/i

/**
 * Separate checkboxes for one question: same page, same tooltip (or "Question - Option" tooltips
 * with the same question), close together → a choice (Yes / No style, or two boxes) or a multiple
 * choice ("all that apply", or more options that are not Yes / No).
 */
function mergeSharedQuestion(works: Work[]) {
  const groups = new Map<string, Work[]>()
  for (const w of works) {
    const f = w.raw[0]
    if (w.dead || w.item.type !== 'boolean' || !f.tooltip.trim()) continue
    const tip = f.tooltip.replace(/\s+/g, ' ').trim()
    const dash = /^(.{8,}?)\s+[-–—]\s+(.{1,80})$/.exec(tip)
    const question = dash ? dash[1] : tip
    const key = `${f.page}|${question.toLowerCase()}`
    groups.set(key, [...(groups.get(key) ?? []), w])
  }
  for (const [key, list] of groups) {
    if (list.length < 2) continue
    const rects = list.map((w) => w.raw[0].rect)
    const span = unionRect(rects)
    if (span[3] - span[1] > 180 || span[2] - span[0] > 400) continue
    const question = key.split('|').slice(1).join('|')
    const head = list[0]
    const opts = list.map((w) => {
      const tip = w.raw[0].tooltip.replace(/\s+/g, ' ').trim()
      const dash = /^.{8,}?\s+[-–—]\s+(.{1,80})$/.exec(tip)
      const right = w.raw[0].widgets[0]?.rightText ?? ''
      const label = (dash ? cleanLabel(dash[1]) : '') || optionLabel(right) || humanizeFieldName(w.raw[0].name)
      return { w, label, right }
    })
    const labels = opts.map((o) => o.label)
    if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) continue
    const allThatApply = /\ball that apply\b|\btick (?:any|each)\b|\bselect (?:any|all)\b/i.test(`${question} ${head.item.help ?? ''}`)
    const yesNo = labels.every((l) => YES_NO.test(l))
    const multi = allThatApply || (!yesNo && list.length > 2)
    const original = list[0].raw[0].tooltip
    head.item.type = multi ? 'multi_choice' : 'choice'
    head.item.display = multi ? 'checkboxes' : 'radio'
    head.item.options = dedupeOptions(opts.map((o) => ({ value: o.label, label: o.label })))
    for (const o of opts) head.optionText.set(o.label, o.right)
    const { label, help } = splitLongLabel(/^(.{8,}?)\s+[-–—]\s+.{1,80}$/.exec(original.replace(/\s+/g, ' ').trim())?.[1] ?? original)
    head.item.label = label
    if (help) head.item.help = help
    head.item.labelSource = 'tooltip'
    head.item.notes.push(`${list.length} separate checkboxes for one question merged into ${multi ? 'a multiple choice' : 'one choice'}: check the options`)
    for (const o of opts.slice(1)) kill(o.w, head)
  }
}

const DATE_PART = /^(?:dd|d|day|mm|m|month|yy|yyyy|year|jj|aaaa)\b/i

/** Two or three small text boxes on one row: a date (DD/MM/YYYY), an SSN (3-2-4), an EIN (2-7). */
function mergeSplitBoxes(works: Work[], linesOf: Map<number, PageText['lines']>) {
  const texts = works.filter((w) => !w.dead && (w.item.type === 'text' || w.item.type === 'number') && w.item.rect)
  texts.sort((a, b) => a.item.page - b.item.page || Math.round(cy(b.item.rect!) / 4) - Math.round(cy(a.item.rect!) / 4) || a.item.rect![0] - b.item.rect![0])
  for (let i = 0; i < texts.length; i++) {
    const head = texts[i]
    if (head.dead) continue
    const run = [head]
    for (let j = i + 1; j < texts.length && run.length < 3; j++) {
      const prev = run[run.length - 1].item.rect!
      const next = texts[j]
      const r = next.item.rect!
      if (next.dead || next.item.page !== head.item.page || Math.abs(cy(r) - cy(prev)) > 3 || r[0] - prev[2] < -1 || r[0] - prev[2] > 28) break
      run.push(next)
    }
    if (run.length < 2) continue
    const widths = run.map((w) => w.item.rect![2] - w.item.rect![0])
    if (widths.some((x) => x > 110)) continue
    const lens = run.map((w) => w.item.maxLength ?? 0)
    const lines = linesOf.get(head.item.page) ?? []
    // Text printed between / inside / above the boxes.
    const span = unionRect(run.map((w) => w.item.rect!))
    const around = lines.filter((l) => l.x0 >= span[0] - 4 && l.x1 <= span[2] + 4 && l.y >= span[1] - 12 && l.y <= span[3] + 14).map((l) => l.str).join(' ')
    const words = `${run.map((w) => `${w.raw[0].tooltip} ${w.item.labelSource !== 'field_name' ? w.item.label : ''} ${w.raw[0].name}`).join(' ')} ${around}`
    const partLabels = run.map((w) => cleanLabel(w.raw[0].tooltip || w.item.label))
    const partName = (w: Work) => w.raw[0].name.replace(/\[\d+\]/g, '').split('.').pop() ?? ''
    const datePart = (w: Work, i: number) => DATE_PART.test(partLabels[i]) || /^(day|month|year)\b/i.test(partLabels[i]) || /(day|month|year|_dd|_mm|_yy|yyyy)$/i.test(partName(w))
    const dateLens = lens.join(',')
    const dateish = run.every((w) => w.item.type !== 'date') && (run.filter(datePart).length >= 2
      || (/^(2,2,4|2,2,2|4,2,2)$/.test(dateLens) && /\bdate\b|\bbirth\b/i.test(words)))
    const ssn = run.length === 3 && (/social security/i.test(words) || (lens[0] === 3 && lens[1] === 2 && lens[2] === 4))
    const ein = run.length === 2 && (/employer identification/i.test(words) || (lens[0] === 2 && lens[1] === 7))
    if (!dateish && !ssn && !ein) continue
    const kindName = dateish ? 'date' : ssn ? 'social security number' : 'employer identification number'
    // The label: the group's question, not "DD" / "–".
    const outer = run.map((w) => w.item).find((it) => it.labelSource !== 'field_name' && it.label.length > 3 && !DATE_PART.test(it.label) && !/^[-–/.]$/.test(it.label))
    const printed = nearbyLabel(lines, span, 'left')
    const fallback = dateish ? (printed && !DATE_PART.test(printed.text) ? printed.text : 'Date') : ssn ? 'Social security number' : 'Employer identification number'
    const fits = outer && (dateish || (ssn ? /social security/i.test(outer.label) : /employer identification/i.test(outer.label)))
    head.item.label = cleanLabel(fits ? outer!.label.replace(/\.\s*First \d+ digits\.?$/i, '') : fallback)
    if (dateish) { head.item.type = 'date'; delete head.item.maxLength; delete head.item.pattern }
    else if (ssn) { head.item.type = 'text'; head.item.pattern = '^\\d{3}-?\\d{2}-?\\d{4}$'; head.item.patternMessage = 'Enter a social security number (123-45-6789)'; head.item.maxLength = 11 }
    else { head.item.type = 'text'; head.item.pattern = '^\\d{2}-?\\d{7}$'; head.item.patternMessage = 'Enter an employer identification number (12-3456789)'; head.item.maxLength = 10 }
    head.item.notes.push(`${run.length} separate boxes (${run.map((w) => w.raw[0].name).join(', ')}) merged into one ${kindName} field`)
    head.item.rect = span
    for (const w of run.slice(1)) kill(w, head)
  }
}

/** Printed question numbers → item.question (nearest number at or above the field, in its column). */
function assignQuestions(items: PdfItem[], pages: PageText[]) {
  for (const p of pages) {
    const anchors = p.lines.map((l) => ({ l, q: questionNumberOf(l.str) })).filter((a): a is { l: PageText['lines'][number]; q: NonNullable<ReturnType<typeof questionNumberOf>> } => Boolean(a.q && a.l.x0 < p.width * 0.75 && (a.q.rest.length > 2 || a.l.str.trim().length <= 4)))
    if (!anchors.length) continue
    for (const it of items.filter((x) => x.page === p.page && x.rect)) {
      const r = it.rect!
      const best = anchors
        .filter((a) => a.l.y + a.l.h >= cy(r) - 6 && a.l.x0 <= r[0] + 40 && a.l.y - r[3] < 260)
        .map((a) => ({ a, score: (a.l.y - cy(r)) + Math.max(0, r[0] - a.l.x1) * 0.15 + (a.l.x0 > r[0] ? 50 : 0) }))
        .sort((x, y) => x.score - y.score)[0]
      if (best) {
        it.question = best.a.q.num
        // "3. Do you own a vehicle?" → "Do you own a vehicle?" (the number is kept as the item's question).
        if (it.labelSource === 'nearby_text' || it.labelSource === 'xfa_caption') {
          const own = questionNumberOf(it.label)
          if (own && own.num === it.question && own.rest.length >= 3) it.label = own.rest
        }
      }
    }
  }
}

const HEADING = /^(?:part|section|step|schedule)\s+([A-Z]|\d{1,2}|[IVX]{1,4})\b[\s.:–—-]*(.*)$/i

/** "Part 2 – About you" / "Section B" headings → sections (rows below them until the next). */
function assignSections(items: PdfItem[], pages: PageText[]): PdfSection[] {
  const sections: PdfSection[] = []
  for (const p of pages) {
    const heads = p.lines.filter((l) => HEADING.test(l.str) && l.str.length <= 120).sort((a, b) => b.y - a.y)
    if (!heads.length) continue
    for (const it of items.filter((x) => x.page === p.page && x.rect)) {
      const top = it.rect![3]
      const h = heads.filter((l) => l.y >= top - 4).sort((a, b) => a.y - b.y)[0]
      if (!h) continue
      const id = `p${p.page}_${heads.indexOf(h) + 1}`
      if (!sections.some((s) => s.id === id)) sections.push({ id, title: cleanLabel(h.str).slice(0, 120), page: p.page, origin: 'deterministic' })
      it.section = id
    }
  }
  return sections
}

/** Acrobat show / hide scripts → rules (merged per target and subject; complements folded). */
function collectJsRules(works: Work[], itemOfField: Map<string, PdfItem>): Array<Omit<PdfRule, 'id'>> {
  const out: Array<Omit<PdfRule, 'id'>> = []
  const toCond = (w: Work, v: JsVisibility, onValue: string | null): PdfCondition | null => {
    const subject = v.when?.field ? itemOfField.get(v.when.field) : w.item
    if (!subject) return null
    const isBool = subject.type === 'boolean'
    if (!v.when) {
      // Unconditional on a click: the option clicked (radio) / the box being checked (checkbox).
      if (onValue !== null && subject.type === 'choice') return { item: subject.id, op: 'equals', value: optionValueOf(subject, onValue) }
      if (isBool) return { item: subject.id, op: 'equals', value: 'true' }
      return null
    }
    const value = v.when.value
    if (isBool) {
      const checked = value === '__checked__' || (value !== 'Off' && value !== '' && value !== 'false')
      const isTrue = (v.when.op === 'equals') === checked
      return { item: subject.id, op: 'equals', value: isTrue ? 'true' : 'false' }
    }
    return { item: subject.id, op: v.when.op, value: optionValueOf(subject, value) }
  }
  const collected: Array<{ v: JsVisibility; when: PdfCondition | null; target: PdfItem | null }> = []
  for (const w of works) {
    for (const v of w.js.visibility) collected.push({ v, when: toCond(w, v, null), target: itemOfField.get(v.target) ?? null })
    for (const wj of w.widgetJs) for (const v of wj.js.visibility) collected.push({ v, when: toCond(w, v, wj.onValue), target: itemOfField.get(v.target) ?? null })
  }
  // Group by target + subject.
  const groups = new Map<string, typeof collected>()
  for (const c of collected) {
    const key = `${c.target?.id ?? `?${c.v.target}`}|${c.when?.item ?? '?'}`
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  for (const list of groups.values()) {
    const target = list[0].target
    const good = list.filter((c) => c.when && c.v.confidence === 'high' && target)
    const original = [...new Set(list.map((c) => c.v.original.replace(/\s+/g, ' ').trim()))].join(' | ').slice(0, 800)
    if (!target || good.length !== list.length) {
      out.push({ mode: 'hide', when: list.find((c) => c.when)?.when ?? null, targets: target ? [target.id] : [], confidence: 'low', source: 'acrobat_js', original, origin: 'deterministic', reason: !target ? `its target "${list[0].v.target}" is not a field of the form` : 'the script\'s condition is not one the importer understands' })
      continue
    }
    const shows = good.filter((c) => c.v.mode === 'show').map((c) => c.when!)
    const hides = good.filter((c) => c.v.mode === 'hide').map((c) => c.when!)
    const uniq = (cs: PdfCondition[]) => cs.filter((c, i) => cs.findIndex((d) => d.item === c.item && d.op === c.op && d.value === c.value) === i)
    // "Show when A" + "hide when not A / when B" → one Show rule (it hides whenever its condition doesn't hold).
    const conds = uniq(shows.length ? shows : hides)
    out.push({ mode: shows.length ? 'show' : 'hide', when: conds[0], ...(conds.length > 1 ? { any: conds.slice(1) } : {}), targets: [target.id], confidence: 'high', source: 'acrobat_js', original, origin: 'deterministic' })
  }
  // Merge rules with the same condition into one rule with several targets.
  const merged: Array<Omit<PdfRule, 'id'>> = []
  for (const r of out) {
    const same = merged.find((m) => m.confidence === 'high' && r.confidence === 'high' && m.mode === r.mode && JSON.stringify([m.when, m.any ?? []]) === JSON.stringify([r.when, r.any ?? []]))
    if (same) { same.targets.push(...r.targets.filter((t) => !same.targets.includes(t))); same.original = `${same.original} | ${r.original}`.slice(0, 800) }
    else merged.push({ ...r, targets: [...r.targets] })
  }
  return merged
}

function optionValueOf(item: PdfItem, value: string): string {
  if (!item.options?.length) return value
  const hit = item.options.find((o) => o.value === value) ?? item.options.find((o) => o.label.toLowerCase() === value.toLowerCase())
  return hit?.value ?? value
}
