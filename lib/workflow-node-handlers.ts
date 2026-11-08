/**
 * Extracted node action handlers for the workflow engine.
 * Each handler is a pure-ish function that takes config + context and returns a result.
 * Database-dependent handlers still take supabase as a parameter.
 */

import { resolveExpression as resolveExpr, safeEval } from "./expression-resolver"
import type { ExpressionContext } from "./expression-resolver"
import { assertRegexInput, compileUserRegex } from "./safe-regex"

// Re-export the resolveExpression with our wrapper for convenience
export function resolveExpression(expr: any, ctx: ExpressionContext): any {
  return resolveExpr(expr, ctx)
}

// ─── Time Constants ───
export const TIME_MS = { MINUTE: 60_000, HOUR: 3_600_000, DAY: 86_400_000, WEEK: 604_800_000 } as const

// ─── Pure Operation Handlers (no DB needed) ───

export function handleMath(config: Record<string, any>, ctx: ExpressionContext): { expression: string; result: number; variable: string } {
  const expression = String(resolveExpression(config.expression, ctx) ?? "0")
  const result = safeEval(expression)
  const varName = config.output_var ?? "result"
  ctx.variables[varName] = result
  return { expression, result, variable: varName }
}

/** Natural names for Modify String operations ("upper") → the canonical ones ("uppercase"). */
const MODIFY_STRING_ALIASES: Record<string, string> = {
  upper: "uppercase", upper_case: "uppercase", to_upper: "uppercase", toupper: "uppercase", touppercase: "uppercase",
  lower: "lowercase", lower_case: "lowercase", to_lower: "lowercase", tolower: "lowercase", tolowercase: "lowercase",
}

export function canonicalModifyStringOperation(op: unknown): string {
  const raw = String(op ?? "trim").trim()
  return MODIFY_STRING_ALIASES[raw.toLowerCase()] ?? raw
}

export function handleModifyString(config: Record<string, any>, ctx: ExpressionContext): { input: string; operation: string; result: string; variable: string } {
  const input = String(resolveExpression(config.input, ctx) ?? "")
  const op = canonicalModifyStringOperation(config.operation)
  let result: string
  switch (op) {
    case "uppercase": result = input.toUpperCase(); break
    case "lowercase": result = input.toLowerCase(); break
    case "trim": result = input.trim(); break
    case "trim_start": result = input.trimStart(); break
    case "trim_end": result = input.trimEnd(); break
    case "replace": {
      const search = String(config.search ?? "")
      const replaceWith = String(resolveExpression(config.replace_with, ctx) ?? "")
      result = config.replace_all ? input.replaceAll(search, replaceWith) : input.replace(search, replaceWith)
      break
    }
    case "substring": {
      const start = Number(config.start ?? 0)
      const end = config.end ? Number(config.end) : undefined
      result = input.substring(start, end)
      break
    }
    case "pad_start": result = input.padStart(Number(config.length ?? 0), config.pad_char ?? " "); break
    case "pad_end": result = input.padEnd(Number(config.length ?? 0), config.pad_char ?? " "); break
    case "reverse": result = input.split("").reverse().join(""); break
    case "slug": result = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); break
    default: result = input
  }
  const varName = config.output_var ?? "modified_string"
  ctx.variables[varName] = result
  return { input, operation: op, result, variable: varName }
}

export function handleTextTemplate(config: Record<string, any>, ctx: ExpressionContext): { result: any; variable: string } {
  const template = String(config.template ?? "")
  const result = resolveExpression(template, ctx)
  const varName = config.output_var ?? "text"
  ctx.variables[varName] = result
  return { result, variable: varName }
}

export function handleFormatDate(config: Record<string, any>, ctx: ExpressionContext): { date: any; format: string; result: string; variable: string } {
  // Builder UI writes `date`; imported/hand-authored workflows often say `input`.
  // No date at all means "now" — formatting the current time is the common intent.
  const dateStr = resolveExpression(config.date ?? config.input, ctx)
  const d = dateStr === undefined || dateStr === null || dateStr === "" ? new Date() : new Date(dateStr)
  // A pattern in `format` ("YYYY-MM-DD") means a custom format.
  const { format: fmt, custom_format: customFormat } = canonicalFormatDate(config)
  let result: string
  switch (fmt) {
    case "iso": result = d.toISOString(); break
    case "date": result = d.toLocaleDateString("en-US"); break
    case "time": result = d.toLocaleTimeString("en-US"); break
    case "datetime": result = d.toLocaleString("en-US"); break
    case "short": result = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); break
    case "relative": {
      const diff = Date.now() - d.getTime()
      const days = Math.round(diff / TIME_MS.DAY)
      result = days === 0 ? "today" : days === 1 ? "yesterday" : days === -1 ? "tomorrow" : `${Math.abs(days)} days ${days > 0 ? "ago" : "from now"}`
      break
    }
    case "custom": {
      result = formatDatePattern(d, customFormat ?? "YYYY-MM-DD")
      break
    }
    default: result = d.toISOString()
  }
  const varName = config.output_var ?? "formatted_date"
  ctx.variables[varName] = result
  return { date: dateStr, format: fmt, result, variable: varName }
}

export const FORMAT_DATE_PRESETS = ["iso", "date", "time", "datetime", "short", "relative", "custom"] as const

/**
 * `format` / `custom_format` as the handler reads them: a value that is not
 * a preset but looks like a pattern ("YYYY-MM-DD", "dddd, MMMM D") is a
 * custom format.
 */
export function canonicalFormatDate(config: Record<string, any>): { format: string; custom_format?: string } {
  const raw = config.format == null || config.format === "" ? "iso" : String(config.format)
  if ((FORMAT_DATE_PRESETS as readonly string[]).includes(raw)) {
    return raw === "custom" ? { format: "custom", custom_format: config.custom_format } : { format: raw }
  }
  if (/YY|MM|DD|HH|hh|mm|ss|ddd|(?<![A-Za-z])[DM](?![A-Za-z])/.test(raw)) return { format: "custom", custom_format: raw }
  return { format: raw }
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/**
 * Format a date with a pattern: YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h
 * mm ss A (AM/PM); text in [brackets] is kept as is. Single-letter tokens only count
 * on their own (not inside a word), so "Due D" keeps the word "Due".
 */
export function formatDatePattern(d: Date, pattern: string): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  const h12 = d.getHours() % 12 || 12
  const tokens: Record<string, () => string> = {
    YYYY: () => String(d.getFullYear()),
    YY: () => String(d.getFullYear()).slice(-2),
    MMMM: () => MONTHS[d.getMonth()],
    MMM: () => MONTHS[d.getMonth()].slice(0, 3),
    MM: () => pad(d.getMonth() + 1),
    M: () => String(d.getMonth() + 1),
    DD: () => pad(d.getDate()),
    D: () => String(d.getDate()),
    dddd: () => WEEKDAYS[d.getDay()],
    ddd: () => WEEKDAYS[d.getDay()].slice(0, 3),
    HH: () => pad(d.getHours()),
    H: () => String(d.getHours()),
    hh: () => pad(h12),
    h: () => String(h12),
    mm: () => pad(d.getMinutes()),
    ss: () => pad(d.getSeconds()),
    A: () => (d.getHours() < 12 ? "AM" : "PM"),
  }
  return pattern.replace(
    /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|DD|dddd|ddd|HH|hh|mm|ss|(?<![A-Za-z])(?:M|D|H|h|A)(?![A-Za-z])/g,
    (match, literal: string | undefined) => (literal !== undefined ? literal : tokens[match]?.() ?? match),
  )
}

export function handleDateMath(config: Record<string, any>, ctx: ExpressionContext): any {
  // Builder UI writes `date`; hand-authored workflows often say `input`.
  const dateStr = resolveExpression(config.date ?? config.input, ctx)
  const d = new Date(dateStr)
  const op = config.operation ?? "add"
  if (op === "add" || op === "subtract") {
    const amount = Number(resolveExpression(config.amount, ctx)) || 0
    const unit = config.unit ?? "days"
    const mult = op === "subtract" ? -1 : 1
    switch (unit) {
      case "minutes": d.setMinutes(d.getMinutes() + amount * mult); break
      case "hours": d.setHours(d.getHours() + amount * mult); break
      case "days": d.setDate(d.getDate() + amount * mult); break
      case "weeks": d.setDate(d.getDate() + amount * 7 * mult); break
      case "months": d.setMonth(d.getMonth() + amount * mult); break
      case "years": d.setFullYear(d.getFullYear() + amount * mult); break
    }
    const varName = config.output_var ?? "new_date"
    ctx.variables[varName] = d.toISOString()
    return { operation: op, result: d.toISOString(), variable: varName }
  }
  if (op === "interval") {
    const date2Str = resolveExpression(config.date2, ctx)
    const d2 = new Date(date2Str)
    const diffMs = d2.getTime() - d.getTime()
    const varName = config.output_var ?? "interval"
    const result = {
      ms: diffMs,
      seconds: Math.round(diffMs / 1000),
      minutes: Math.round(diffMs / 60000),
      hours: Math.round(diffMs / TIME_MS.HOUR),
      days: Math.round(diffMs / TIME_MS.DAY),
    }
    ctx.variables[varName] = result
    return { operation: "interval", result, variable: varName }
  }
  return { skipped: true }
}

export function handleRegex(config: Record<string, any>, ctx: ExpressionContext): any {
  const input = String(resolveExpression(config.input, ctx) ?? "")
  const pattern = config.pattern ?? ""
  const flags = config.flags ?? "g"
  const op = config.operation ?? "match"
  // ReDoS guard: throws a clear UnsafeRegexError for a too-long or
  // nested-quantifier pattern, or an input over the size cap.
  const re = compileUserRegex(String(pattern), flags)
  assertRegexInput(input)
  let result: any
  if (op === "match") {
    result = input.match(re) ?? []
  } else if (op === "test") {
    result = re.test(input)
  } else if (op === "replace") {
    result = input.replace(re, String(config.replace_with ?? ""))
  } else if (op === "split") {
    result = input.split(re)
  }
  const varName = config.output_var ?? "regex_result"
  ctx.variables[varName] = result
  return { input, pattern, operation: op, result, variable: varName }
}

// ─── Collection Handlers (pure) ───

export function handleCollectionCount(config: Record<string, any>, ctx: ExpressionContext): { count: number; variable: string } {
  const items = resolveExpression(config.collection, ctx)
  const count = Array.isArray(items) ? items.length : 0
  const varName = config.output_var ?? "count"
  ctx.variables[varName] = count
  return { count, variable: varName }
}

export function handleCollectionGet(config: Record<string, any>, ctx: ExpressionContext): { result: any; variable: string } {
  const items = resolveExpression(config.collection, ctx)
  const arr = Array.isArray(items) ? items : []
  let result: any
  if (config.by === "last") {
    result = arr[arr.length - 1]
  } else if (config.by === "key" && config.key) {
    result = arr.find((item: any) => item?.[config.key_field] === resolveExpression(config.key, ctx))
  } else {
    const idx = Number(resolveExpression(config.index, ctx)) || 0
    result = arr[idx]
  }
  const varName = config.output_var ?? "item"
  ctx.variables[varName] = result
  return { result, variable: varName }
}

export function handleCollectionFilter(config: Record<string, any>, ctx: ExpressionContext, evaluateRule: (field: string, operator: string, value: string, ctx: any) => boolean): { count: number; variable: string } {
  const items = resolveExpression(config.collection, ctx)
  const arr = Array.isArray(items) ? items : []
  const field = config.field ?? ""
  const operator = config.operator ?? "equals"
  const value = resolveExpression(config.value, ctx)
  const result = arr.filter((item: any) => {
    const fieldVal = field ? item?.[field] : item
    return evaluateRule(String(fieldVal), operator, String(value), ctx)
  })
  const varName = config.output_var ?? "filtered"
  ctx.variables[varName] = result
  return { count: result.length, variable: varName }
}

export function handleCollectionSort(config: Record<string, any>, ctx: ExpressionContext): { count: number; variable: string } {
  const items = resolveExpression(config.collection, ctx)
  const arr = Array.isArray(items) ? [...items] : []
  const field = config.field ?? ""
  const dir = config.direction ?? "asc"
  arr.sort((a: any, b: any) => {
    const va = field ? a?.[field] : a
    const vb = field ? b?.[field] : b
    const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true })
    return dir === "desc" ? -cmp : cmp
  })
  const varName = config.output_var ?? "sorted"
  ctx.variables[varName] = arr
  return { count: arr.length, variable: varName }
}

export function handleCollectionUnique(config: Record<string, any>, ctx: ExpressionContext): { original: number; unique: number; variable: string } {
  const items = resolveExpression(config.collection, ctx)
  const arr = Array.isArray(items) ? items : []
  const field = config.field ?? ""
  const seen = new Set<string>()
  const result = arr.filter((item: any) => {
    const key = field ? String(item?.[field]) : JSON.stringify(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const varName = config.output_var ?? "unique"
  ctx.variables[varName] = result
  return { original: arr.length, unique: result.length, variable: varName }
}

export function handleCollectionJoin(config: Record<string, any>, ctx: ExpressionContext): { result: string; variable: string } {
  const items = resolveExpression(config.collection, ctx)
  const arr = Array.isArray(items) ? items : []
  const separator = config.separator ?? ", "
  const field = config.field ?? ""
  const result = arr.map((item: any) => field ? String(item?.[field] ?? "") : String(item)).join(separator)
  const varName = config.output_var ?? "joined"
  ctx.variables[varName] = result
  return { result, variable: varName }
}

// ─── Condition Evaluation (pure) ───

export function handleCondition(config: Record<string, any>, ctx: ExpressionContext, evaluateRule: (field: string, operator: string, value: string, ctx: any) => boolean): any {
  const branches: { label: string; logic: string; rules: { field: string; operator: string; value: string }[] }[] =
    config.branches ?? []

  // Rule groups (no branches): groups are OR'd, the rules in a group use its
  // logic; the result routes the True / False ports (labels "True" / "False").
  const groups: { logic?: string; rules?: { field: string; operator: string; value: string }[] }[] =
    branches.length === 0 && Array.isArray(config.groups) ? config.groups : []
  if (groups.length > 0) {
    const result = groups.some((group) => {
      const rules = (group?.rules ?? []).filter(r => r?.field && String(r.field).trim())
      if (rules.length === 0) return false
      return String(group.logic ?? 'and').toLowerCase().trim() === 'or'
        ? rules.some(r => evaluateRule(r.field, r.operator, r.value, ctx))
        : rules.every(r => evaluateRule(r.field, r.operator, r.value, ctx))
    })
    const label = result ? 'True' : 'False'
    return { result, matched_branches: [label], matched_branch: label }
  }

  // Legacy single-condition fallback
  if (branches.length === 0 && config.field) {
    const result = evaluateRule(config.field, config.operator, config.value, ctx)
    return { result, matched_branches: [result ? "true" : "false"], matched_branch: result ? "true" : "false", field: config.field, value: resolveExpression(config.field, ctx) }
  }

  const matchedBranches: string[] = []
  for (const branch of branches) {
    const configuredRules = (branch.rules ?? []).filter(r => r.field && r.field.trim())
    if (configuredRules.length === 0) continue

    // Compare logic case-insensitively so configs written by the MCP
    // or by hand don't silently fall back to AND just because the
    // author wrote "OR" or "Or" instead of "or".
    const logic = String(branch.logic ?? 'and').toLowerCase().trim()
    const match = logic === "or"
      ? configuredRules.some(r => evaluateRule(r.field, r.operator, r.value, ctx))
      : configuredRules.every(r => evaluateRule(r.field, r.operator, r.value, ctx))

    if (match) {
      matchedBranches.push(branch.label)
      // if/else-if semantics: stop at the first matching branch. Default is
      // 'all' (every matching branch fires) to preserve existing workflows.
      if (String(config.match_mode ?? 'all').toLowerCase() === 'first') break
    }
  }

  if (matchedBranches.length === 0 && config.has_else !== false) {
    matchedBranches.push("Else")
  }

  return {
    result: matchedBranches.length > 0,
    matched_branches: matchedBranches,
    matched_branch: matchedBranches[0] ?? null,
  }
}

export function handleSwitchCase(config: Record<string, any>, ctx: ExpressionContext): any {
  const value = String(resolveExpression(config.field, ctx))
  const cases: Array<{ value: string; label: string } | string> = config.cases ?? []
  const matched = cases.find((c) => {
    const caseValue = typeof c === 'object' && c !== null ? c.value : String(c)
    return String(caseValue).toLowerCase() === value.toLowerCase()
  })
  if (matched) {
    const matchedLabel = typeof matched === 'object' && matched !== null ? matched.label : String(matched)
    return { value, matched_case: matchedLabel }
  }
  if (config.has_default !== false) return { value, matched_case: "default" }
  return { value, matched_case: null }
}

// ─── Delay Helper ───

// ─── JSON Operation Handlers ───

export function handleJsonBuildObject(config: Record<string, any>, ctx: ExpressionContext): any {
  const varName = config.output_var ?? 'json_object'
  const existingVar = config.source_var ? ctx.variables[config.source_var] : null
  const base: Record<string, any> = (existingVar && typeof existingVar === 'object' && !Array.isArray(existingVar))
    ? { ...existingVar } : {}

  // Build from key/value pairs
  const pairs = (config.fields ?? []) as { key: string; value: string }[]
  for (const pair of pairs) {
    if (!pair.key) continue
    let value: any = resolveExpression(pair.value, ctx)
    // Auto-parse JSON strings
    if (typeof value === 'string') {
      try { const parsed = JSON.parse(value); if (typeof parsed === 'object') value = parsed } catch { /* keep as string */ }
    }
    base[pair.key] = value
  }

  ctx.variables[varName] = base
  return { variable: varName, keys: Object.keys(base), field_count: Object.keys(base).length }
}

export function handleJsonBuildArray(config: Record<string, any>, ctx: ExpressionContext): any {
  const varName = config.output_var ?? 'json_array'
  const existingVar = config.source_var ? ctx.variables[config.source_var] : null
  const base: any[] = Array.isArray(existingVar) ? [...existingVar] : []

  // Add items from config: [{ value }] (the builder), or plain values ("apple", 3).
  const items = (Array.isArray(config.items) ? config.items : []) as unknown[]
  for (const item of items) {
    const raw = item !== null && typeof item === 'object' && !Array.isArray(item) && 'value' in item
      ? (item as { value: unknown }).value
      : item
    let value: any = typeof raw === 'string' ? resolveExpression(raw, ctx) : raw
    if (typeof value === 'string') {
      try { const parsed = JSON.parse(value); value = parsed } catch { /* keep as string */ }
    }
    if (value != null) base.push(value)
  }

  ctx.variables[varName] = base
  return { variable: varName, count: base.length }
}

export function handleJsonAddToArray(config: Record<string, any>, ctx: ExpressionContext): any {
  const varName = config.array_var ?? 'json_array'
  const existing = ctx.variables[varName]
  const arr: any[] = Array.isArray(existing) ? [...existing] : []

  // Build the object to add from fields
  const fields = (config.fields ?? []) as { key: string; value: string }[]
  if (fields.length > 0) {
    const obj: Record<string, any> = {}
    for (const f of fields) {
      if (!f.key) continue
      obj[f.key] = resolveExpression(f.value, ctx)
    }
    arr.push(obj)
  } else {
    // Single value mode
    let value: any = resolveExpression(config.value, ctx)
    if (typeof value === 'string') {
      try { const parsed = JSON.parse(value); value = parsed } catch {}
    }
    if (value != null) arr.push(value)
  }

  ctx.variables[varName] = arr
  return { variable: varName, count: arr.length, added: 1 }
}

export function handleJsonGetValue(config: Record<string, any>, ctx: ExpressionContext): any {
  const varName = config.output_var ?? 'json_value'
  const source = resolveExpression(config.source, ctx)
  const path = config.path ?? ''

  let value: any = source
  if (path) {
    for (const key of path.split('.')) {
      if (value == null) break
      const arrMatch = key.match(/^(\w+)\[(\d+)\]$/)
      if (arrMatch) {
        value = value[arrMatch[1]]?.[Number(arrMatch[2])]
      } else if (key.match(/^\d+$/)) {
        value = Array.isArray(value) ? value[Number(key)] : value[key]
      } else {
        value = value[key]
      }
    }
  }

  ctx.variables[varName] = value
  return { variable: varName, path, type: Array.isArray(value) ? 'array' : typeof value }
}

// ─── Delay Helper ───

const DELAY_UNITS = ["seconds", "minutes", "hours", "days"] as const

/**
 * `duration` + `unit` of a Delay node; `{ seconds: 5 }` (or minutes / hours /
 * days) is read as that duration when `duration` is not set.
 */
export function canonicalDelay(config: Record<string, any>): { duration: any; unit?: string } {
  if (config.duration !== undefined && config.duration !== null && config.duration !== "") {
    return { duration: config.duration, unit: config.unit }
  }
  for (const unit of DELAY_UNITS) {
    const v = config[unit]
    if (v !== undefined && v !== null && v !== "") return { duration: v, unit }
  }
  return { duration: config.duration, unit: config.unit }
}

export function calculateDelay(duration: any, unit?: string): number {
  const d = Number(duration) || 0
  switch (unit ?? "minutes") {
    case "seconds": return d * 1000
    case "minutes": return d * TIME_MS.MINUTE
    case "hours": return d * TIME_MS.HOUR
    case "days": return d * TIME_MS.DAY
    default: return d * TIME_MS.MINUTE
  }
}

// ─── Data step (update_data_table) list filters ───

/**
 * The filter operators the Data step's list / live list understands
 * (`filters: [{ column, operator, value }]`). `like` / `ilike` match the
 * value anywhere in the cell; `starts_with` / `ends_with` ignore case.
 */
export const DATA_FILTER_OPERATORS = [
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "starts_with", "ends_with", "is_null", "not_null",
] as const
export type DataFilterOperator = (typeof DATA_FILTER_OPERATORS)[number]

/** Natural / condition-style spellings ("equals", "==", "contains") → the canonical operator. */
export const DATA_FILTER_OPERATOR_ALIASES: Record<string, DataFilterOperator> = {
  equals: "eq", equal: "eq", "==": "eq", "=": "eq", "===": "eq", is: "eq",
  not_equals: "neq", not_equal: "neq", ne: "neq", "!=": "neq", "!==": "neq", "<>": "neq", is_not: "neq",
  greater_than: "gt", ">": "gt",
  greater_than_or_equal: "gte", greater_or_equal: "gte", ">=": "gte",
  less_than: "lt", "<": "lt",
  less_than_or_equal: "lte", less_or_equal: "lte", "<=": "lte",
  contains: "ilike", startswith: "starts_with", begins_with: "starts_with", endswith: "ends_with",
  is_empty: "is_null", empty: "is_null", is_not_set: "is_null",
  is_not_empty: "not_null", not_empty: "not_null", is_not_null: "not_null", is_set: "not_null",
}

/** The canonical operator for a Data step filter, or the trimmed input when it is unknown. */
export function canonicalDataFilterOperator(op: unknown): string {
  const raw = String(op ?? "").trim()
  const lower = raw.toLowerCase()
  if ((DATA_FILTER_OPERATORS as readonly string[]).includes(lower)) return lower
  return DATA_FILTER_OPERATOR_ALIASES[lower] ?? raw
}

// ─── Call Reference inputs ───

/**
 * The value a Call Reference step passes for one reference input: its
 * mapping (an expression), else the input's static / default value — or,
 * for an unmapped dynamic input, a run variable of the same name when one is
 * set. A blank optional input stays empty (undefined → the executor leaves
 * it out of the query / headers and renders it empty in templates): the
 * input's NAME is never sent as its value (resolving the bare name used to
 * return it verbatim, so `?page_size=page_size` went out).
 */
export function callReferenceInputValue(
  input: { name: string; source?: string; default_value?: any },
  mapping: unknown,
  ctx: ExpressionContext,
): any {
  if (typeof mapping === "string" ? mapping.trim() : mapping !== undefined && mapping !== null && mapping !== "") {
    return resolveExpression(mapping, ctx)
  }
  if (input.source === "static") return input.default_value
  const name = String(input.name ?? "")
  let auto: any
  if (name && Object.prototype.hasOwnProperty.call(ctx.variables, name)) auto = ctx.variables[name]
  else if (/^[\w.\-[\]]+$/.test(name)) auto = resolveExpression(`{{${name}}}`, ctx)
  return auto === undefined || auto === null || auto === "" ? input.default_value : auto
}
