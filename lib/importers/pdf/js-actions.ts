/**
 * Acrobat field JavaScript → UserTasks behaviour, by PATTERN MATCHING ONLY
 * (pure, client-safe). Nothing here — or anywhere in the importer — runs a
 * script: pdf.js is opened with scripting and eval off, and a script is a
 * string that is matched against known shapes:
 *
 *   AFDate_Format / Keystroke(Ex)     → a date field
 *   AFNumber_Format(…, "$")           → currency (number without a symbol)
 *   AFPercent_*                       → number (percent noted)
 *   AFSpecial_* (0 zip, 1 zip+4,      → a pattern (phone → a phone field)
 *     2 phone, 3 SSN; KeystrokeEx mask)
 *   AFRange_Validate                  → min / max
 *   AFSimple_Calculate                → a calculated (Label) field
 *   Calculate: event.value = a + b*2  → a calculated (Label) field (plain
 *     on getField(…).value only)        arithmetic only; else untranslated)
 *   getField(x).display = display.*   → show / hide rules, with a simple
 *     inside if / else                  if (value == "…") / else
 *   getField(x).required = true|false → noted (conditionally required)
 *   a regex literal in Validate       → a pattern (medium confidence)
 *   getField(y).value = "Off"         → mutually exclusive checkboxes
 *
 * Anything else is kept as "untranslated" (event + the script's start) for
 * the report.
 */

import { findNestedQuantifier, MAX_REGEX_PATTERN_LENGTH } from '@/lib/safe-regex'
import type { PdfItemType } from './model'

export interface JsVisibility {
  target: string
  mode: 'show' | 'hide'
  /** The condition the statement sits under; null = unconditional (e.g. a radio option's MouseUp). */
  when: { field: string | null; op: 'equals' | 'not_equals'; value: string } | null
  confidence: 'high' | 'low'
  event: string
  original: string
}

export interface JsTranslation {
  type?: PdfItemType
  /** The date / number picture (e.g. "mm/dd/yyyy"). */
  format?: string
  decimals?: number
  currency?: string
  percent?: boolean
  pattern?: string
  patternMessage?: string
  patternConfidence?: 'high' | 'medium'
  min?: number
  max?: number
  /** A calculation: SUM / AVG / PRD / MIN / MAX of `fields`, or EXPR — `expr` with $0, $1 … standing for `fields` in order. */
  calc?: { op: string; fields: string[]; expr?: string }
  visibility: JsVisibility[]
  required: Array<{ target: string; value: boolean; original: string }>
  exclusiveWith: string[]
  /** What was understood, for the report ("date (mm/dd/yyyy)", "range 0–100"). */
  translated: string[]
  untranslated: Array<{ event: string; js: string }>
}

const SPECIAL: Record<string, { name: string; pattern: string; type?: PdfItemType; message: string }> = {
  0: { name: 'ZIP code', pattern: '^\\d{5}$', message: 'Enter a 5-digit ZIP code' },
  1: { name: 'ZIP+4', pattern: '^\\d{5}-?\\d{4}$', message: 'Enter a ZIP+4 code (12345-6789)' },
  2: { name: 'phone number', pattern: '^\\(?\\d{3}\\)?[ .-]?\\d{3}[ .-]?\\d{4}$', type: 'phone', message: 'Enter a 10-digit phone number' },
  3: { name: 'social security number', pattern: '^\\d{3}-?\\d{2}-?\\d{4}$', message: 'Enter a social security number (123-45-6789)' },
}

const CURRENCY: Record<string, string> = { '$': 'USD', 'US$': 'USD', 'USD': 'USD', '£': 'GBP', 'GBP': 'GBP', '€': 'EUR', 'EUR': 'EUR', '¥': 'JPY', 'C$': 'CAD', 'CA$': 'CAD', 'A$': 'AUD', 'AU$': 'AUD', 'NZ$': 'NZD', 'CHF': 'CHF', '₹': 'INR' }

/** An Acrobat keystroke mask ("999-99-9999", "AAA 9999") → an anchored pattern. */
export function maskToPattern(mask: string): string | null {
  if (!mask || mask.length > 60) return null
  let out = '^'
  for (const ch of mask) {
    if (ch === '9') out += '\\d'
    else if (ch === 'A') out += '[A-Za-z]'
    else if (ch === 'X' || ch === 'O') out += '[A-Za-z0-9]'
    else if (ch === '*') out += '.'
    else out += ch.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
  }
  return `${out}$`
}

/** A pattern the form builder will accept (length, no nested quantifiers, compiles). */
export function safePattern(pattern: string): string | null {
  if (!pattern || pattern.length > Math.min(MAX_REGEX_PATTERN_LENGTH, 300)) return null
  if (findNestedQuantifier(pattern)) return null
  try { new RegExp(pattern) } catch { return null }
  return pattern
}

const stripComments = (js: string) => js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/[^\n\r]*/g, '$1')

const DISPLAY_RE = /getField\(\s*["']([^"']+)["']\s*\)\s*\.display\s*=\s*display\.(hidden|visible|noPrint|noView)/g

/** A simple condition → { field (null = the field the script is on), op, value }. */
function parseCondition(raw: string): { field: string | null; op: 'equals' | 'not_equals'; value: string } | null {
  const c = raw.trim().replace(/^\(+|\)+$/g, '').trim()
  const subj = String.raw`(event\.(?:target\.)?value|event\.value|this\.value|this\.getField\(\s*["']([^"']+)["']\s*\)\.value(?:AsString)?|getField\(\s*["']([^"']+)["']\s*\)\.value(?:AsString)?)`
  let m = new RegExp(`^${subj}\\s*(==|===|!=|!==)\\s*["']([^"']*)["']$`).exec(c)
  if (m) return { field: m[2] ?? m[3] ?? null, op: m[4].startsWith('!') ? 'not_equals' : 'equals', value: m[5] }
  m = new RegExp(`^["']([^"']*)["']\\s*(==|===|!=|!==)\\s*${subj}$`).exec(c)
  if (m) return { field: m[4] ?? m[5] ?? null, op: m[2].startsWith('!') ? 'not_equals' : 'equals', value: m[1] }
  m = /^(!)?\s*event\.target\.isBoxChecked\(\s*0\s*\)$/.exec(c)
  if (m) return { field: null, op: m[1] ? 'not_equals' : 'equals', value: '__checked__' }
  return null
}

/** Index just past the `)` closing the `(` at `open` (quotes respected), or -1. */
function closeParen(js: string, open: number): number {
  let depth = 0
  let quote = ''
  for (let i = open; i < js.length; i++) {
    const ch = js[i]
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) return i + 1
  }
  return -1
}

/** A block `{ … }` (no nested braces) or one statement `…;` at `from`: [body, end]. */
function blockAt(js: string, from: number): [string, number] | null {
  const rest = js.slice(from)
  const lead = rest.length - rest.trimStart().length
  const at = from + lead
  if (js[at] === '{') {
    const close = js.indexOf('}', at)
    if (close < 0 || js.slice(at + 1, close).includes('{')) return null
    return [js.slice(at + 1, close), close + 1]
  }
  const semi = js.indexOf(';', at)
  if (semi < 0) return null
  const stmt = js.slice(at, semi + 1)
  return /[{}]|\bif\s*\(/.test(stmt) ? null : [stmt, semi + 1]
}

/** if (cond) { a } else { b } — one level, no nesting; null when the script has another shape. */
export function splitIfElse(js: string): { cond: string; then: string; else: string } | null {
  const m = /^\s*if\s*\(/.exec(js)
  if (!m) return null
  const open = m[0].length - 1
  const close = closeParen(js, open)
  if (close < 0) return null
  const cond = js.slice(open + 1, close - 1)
  const then = blockAt(js, close)
  if (!then) return null
  let tail = js.slice(then[1])
  let elseBody = ''
  const e = /^\s*else\b/.exec(tail)
  if (e) {
    const b = blockAt(tail, e[0].length)
    if (!b) return null
    elseBody = b[0]
    tail = tail.slice(b[1])
  }
  return /^[\s;]*$/.test(tail) ? { cond, then: then[0], else: elseBody } : null
}

function displayStatements(block: string): Array<{ target: string; mode: 'show' | 'hide' }> {
  return [...block.matchAll(DISPLAY_RE)].map((m) => ({ target: m[1], mode: m[2] === 'visible' || m[2] === 'noPrint' ? 'show' as const : 'hide' as const }))
}

/** Translate a field's (or widget's) actions: { Format: [...], Keystroke: [...], Validate: [...], Calculate: [...], MouseUp: [...] }. */
export function translateActions(actions: Record<string, unknown> | null | undefined): JsTranslation {
  const out: JsTranslation = { visibility: [], required: [], exclusiveWith: [], translated: [], untranslated: [] }
  if (!actions || typeof actions !== 'object') return out
  for (const [event, value] of Object.entries(actions)) {
    const scripts = (Array.isArray(value) ? value : [value]).filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    for (const original of scripts) {
      const js = stripComments(original).slice(0, 20_000)
      let handled = false
      let m: RegExpExecArray | null
      if ((m = /AFDate_(?:Format|Keystroke)Ex\(\s*["']([^"']+)["']/.exec(js))) { out.type = 'date'; out.format = m[1]; handled = true }
      else if (/AFDate_(?:Format|Keystroke)\(\s*\d+/.test(js)) { out.type = 'date'; handled = true }
      if (/AFTime_(?:Format|Keystroke)/.test(js)) { out.translated.push('time format (kept as text)'); handled = true }
      if ((m = /AFNumber_(?:Format|Keystroke)\(\s*(\d+)\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*["']([^"']*)["']/.exec(js))) {
        const symbol = m[2].trim()
        out.decimals = Number(m[1])
        if (symbol) { out.type = 'currency'; out.currency = CURRENCY[symbol] ?? 'USD' } else if (out.type !== 'currency') out.type = 'number'
        handled = true
      } else if (/AFNumber_(?:Format|Keystroke)\(/.test(js)) { if (out.type !== 'currency') out.type = 'number'; handled = true }
      if (/AFPercent_(?:Format|Keystroke)\(/.test(js)) { out.type = 'number'; out.percent = true; handled = true }
      if ((m = /AFSpecial_(?:Format|Keystroke)\(\s*(\d)\s*\)/.exec(js)) && SPECIAL[m[1]]) {
        const s = SPECIAL[m[1]]
        out.pattern = s.pattern; out.patternMessage = s.message; out.patternConfidence = 'high'; out.format = s.name
        if (s.type) out.type = s.type
        handled = true
      } else if ((m = /AFSpecial_KeystrokeEx\(\s*["']([^"']+)["']/.exec(js))) {
        const p = safePattern(maskToPattern(m[1]) ?? '')
        if (p) { out.pattern = p; out.patternMessage = `Use the format ${m[1]}`; out.patternConfidence = 'high'; out.format = m[1] }
        handled = true
      }
      if ((m = /AFRange_Validate\(\s*(true|false)\s*,\s*(-?[\d.]+)\s*,\s*(true|false)\s*,\s*(-?[\d.]+)/.exec(js))) {
        if (m[1] === 'true') out.min = Number(m[2])
        if (m[3] === 'true') out.max = Number(m[4])
        handled = true
      }
      if ((m = /AFSimple_Calculate\(\s*["'](SUM|AVG|PRD|MIN|MAX)["']\s*,\s*(?:new\s+Array\s*\(([^)]*)\)|\[([^\]]*)\]|["']([^"']+)["'])/.exec(js))) {
        const list = m[2] ?? m[3] ?? `"${m[4]}"`
        out.calc = { op: m[1], fields: (list.match(/["']([^"']+)["']/g) ?? []).map((s) => s.slice(1, -1)).slice(0, 50) }
        handled = true
      } else if (/^calc/i.test(event)) {
        const arithmetic = simpleArithmetic(js)
        if (arithmetic) { out.calc = { op: 'EXPR', fields: arithmetic.fields, expr: arithmetic.expr }; handled = true }
      }
      // Show / hide.
      const statements = displayStatements(js)
      if (statements.length) {
        const shape = splitIfElse(js)
        const cond = shape ? parseCondition(shape.cond) : null
        if (shape && cond) {
          for (const s of displayStatements(shape.then)) out.visibility.push({ ...s, when: cond, confidence: 'high', event, original })
          for (const s of displayStatements(shape.else)) out.visibility.push({ ...s, when: { ...cond, op: cond.op === 'equals' ? 'not_equals' : 'equals' }, confidence: 'high', event, original })
        } else if (!/\bif\s*\(|\?|\bswitch\b|\bfor\s*\(|\bwhile\s*\(/.test(js)) {
          // No condition at all: the event itself is the condition (a radio option / checkbox click).
          for (const s of statements) out.visibility.push({ ...s, when: null, confidence: 'high', event, original })
        } else {
          for (const s of statements) out.visibility.push({ ...s, when: null, confidence: 'low', event, original })
        }
        handled = true
      }
      for (const r of js.matchAll(/getField\(\s*["']([^"']+)["']\s*\)\s*\.required\s*=\s*(true|false)/g)) { out.required.push({ target: r[1], value: r[2] === 'true', original }); handled = true }
      // A regex literal tested in a Validate / Keystroke script → a pattern (the script may do more: medium confidence).
      if (!out.pattern && (event === 'Validate' || event === 'Keystroke') && (m = /\/(\^[^/\n]{1,200}?\$)\/[gimsu]*/.exec(js))) {
        const p = safePattern(m[1])
        if (p) { out.pattern = p; out.patternConfidence = 'medium'; handled = true }
      }
      // Checkbox mutual exclusion: this box turns the others off.
      const offs = [...js.matchAll(/getField\(\s*["']([^"']+)["']\s*\)\s*\.(?:value\s*=\s*["']Off["']|checkThisBox\(\s*0\s*,\s*false\s*\))/g)].map((x) => x[1])
      if (offs.length && !statements.length) { out.exclusiveWith.push(...offs.filter((f) => !out.exclusiveWith.includes(f))); handled = true }
      if (!handled) out.untranslated.push({ event, js: original.replace(/\s+/g, ' ').trim().slice(0, 300) })
    }
  }
  if (out.type === 'date') out.translated.push(`date${out.format ? ` (${out.format})` : ''}`)
  if (out.type === 'currency') out.translated.push(`currency (${out.currency}${out.decimals !== undefined ? `, ${out.decimals} decimals` : ''})`)
  if (out.type === 'number') out.translated.push(out.percent ? 'percentage (number)' : 'number')
  if (out.pattern) out.translated.push(`${out.format ? out.format : 'pattern'}${out.patternConfidence === 'medium' ? ' (from a validation script: check it)' : ''}`)
  if (out.min !== undefined || out.max !== undefined) out.translated.push(`range ${out.min ?? '…'}–${out.max ?? '…'}`)
  if (out.calc) out.translated.push(out.calc.op === 'EXPR' ? 'calculation (arithmetic)' : `calculation (${out.calc.op})`)
  return out
}

const FIELD_REF = String.raw`(?:AFMakeNumber\(\s*)?(?:this\.)?getField\(\s*["']([^"']+)["']\s*\)\.value(?:\s*\))?`

/**
 * A custom Calculate script that is plain arithmetic on other fields:
 *   event.value = this.getField("a").value + getField("b").value * 2;
 *   event.value = AFMakeNumber(getField("qty").value) * AFMakeNumber(getField("price").value);
 *   var a = this.getField("a").value; var b = getField("b").value; event.value = a - b;
 * → { expr: "$0 + $1 * 2", fields: ["a", "b"] }. Anything else (conditions,
 * loops, other calls, strings) → null. Matched, never executed.
 */
export function simpleArithmetic(js: string): { expr: string; fields: string[] } | null {
  const code = js.trim()
  if (!code || code.length > 2000 || /\b(?:if|for|while|switch|function|return|new|try|eval)\b|=>|\?/.test(code)) return null
  const declaration = new RegExp(String.raw`^(?:var|let|const)\s+([A-Za-z_]\w*)\s*=\s*${FIELD_REF}$`)
  const vars = new Map<string, string>()
  let target: string | null = null
  for (const statement of code.split(/[;\n]/).map((x) => x.trim()).filter(Boolean)) {
    const d = declaration.exec(statement)
    if (d) { vars.set(d[1], d[2]); continue }
    const v = /^event\.value\s*=\s*(.+)$/.exec(statement)
    if (v && target === null) { target = v[1]; continue }
    return null
  }
  if (!target) return null
  const fields: string[] = []
  const slot = (name: string) => {
    let i = fields.indexOf(name)
    if (i < 0) { fields.push(name); i = fields.length - 1 }
    return `$${i}`
  }
  let expr = target.replace(new RegExp(FIELD_REF, 'g'), (_all, name: string) => slot(name))
  expr = expr.replace(/\b[A-Za-z_]\w*\b/g, (word) => (vars.has(word) ? slot(vars.get(word)!) : word))
  // Only slots, numbers, + - * / ( ) and spaces may remain.
  if (!fields.length || fields.length > 50 || !/^[\s$\d.+\-*/()]+$/.test(expr)) return null
  return { expr: expr.replace(/\s+/g, ' ').trim(), fields }
}
