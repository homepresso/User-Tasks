/**
 * Shared expression resolver for workflow engine and form rules.
 * Replaces {{variable}} patterns with values from a context object.
 * Supports inline functions: {{=FUNCTION_NAME(arg1, arg2)}}
 */

import { evaluateFunction } from "./expression-functions"

export interface ExpressionContext {
  variables: Record<string, any>
  task?: Record<string, any>
  /**
   * Applied to every interpolated value (variables and function results) —
   * e.g. HTML-escaping for templates whose result is HTML. When set, the
   * result is always a string.
   */
  escape?: (value: string) => string
  /**
   * Interpolate object / array values as JSON instead of String() — for
   * templates whose result is JSON (e.g. a reference's custom body), where
   * "[object Object]" would corrupt the document.
   */
  json?: boolean
}

/**
 * Extract {{=FUNC(...)}} expressions from a string using balanced-brace parsing.
 * Respects quoted strings so `}` inside quotes won't terminate the match.
 * Returns array of { start, end, expr } where expr is the content between {{= and }}.
 */
function extractFunctionExpressions(str: string): { start: number; end: number; expr: string }[] {
  const results: { start: number; end: number; expr: string }[] = []
  let i = 0
  while (i < str.length - 4) {
    // Look for {{=
    if (str[i] === '{' && str[i + 1] === '{' && str[i + 2] === '=') {
      const exprStart = i
      let j = i + 3
      let depth = 0
      let inString = false
      let stringChar = ''

      while (j < str.length) {
        const ch = str[j]

        if (inString) {
          if (ch === '\\' && j + 1 < str.length) {
            j += 2 // skip escaped char
            continue
          }
          if (ch === stringChar) inString = false
          j++
          continue
        }

        if (ch === '"' || ch === "'") {
          inString = true
          stringChar = ch
          j++
          continue
        }

        // A nested {{variable}} (e.g. `{{= {{a}} + {{b}} }}`): skip to its own
        // closing braces so they don't end the expression early.
        if (ch === '{' && str[j + 1] === '{') {
          const close = str.indexOf('}}', j + 2)
          if (close !== -1) { j = close + 2; continue }
        }

        // Check for closing }}
        if (ch === '}' && j + 1 < str.length && str[j + 1] === '}' && depth === 0) {
          results.push({
            start: exprStart,
            end: j + 2,
            expr: str.slice(exprStart + 3, j),
          })
          i = j + 2
          break
        }

        if (ch === '(') depth++
        else if (ch === ')') depth--
        j++
      }

      // If we didn't find closing }}, skip past the {{=
      if (j >= str.length) i = exprStart + 3
    } else {
      i++
    }
  }
  return results
}

/**
 * Substitute bare (unbraced) variable identifiers inside a {{=FUNC(...)}}
 * expression, so `ROUND(retail_price, 2)` works as well as
 * `ROUND({{retail_price}}, 2)` — the unbraced spelling is what people
 * naturally write, and without this it evaluated against the literal string
 * "retail_price" (→ 0/NaN/Invalid Date).
 *
 * Left untouched: quoted strings, function names (identifier followed by
 * "("), true/false/null literals, and identifiers with no matching variable.
 * String values are re-quoted so commas/parens inside them can't corrupt
 * argument parsing; arrays/objects are not substituted (text substitution
 * can't carry them — use the {{var}} whole-expression form for those).
 */
function substituteBareIdentifiers(fnExpr: string, ctx: ExpressionContext): string {
  const pattern = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([A-Za-z_][A-Za-z0-9_]*(?:\[\d+\])*(?:\.[A-Za-z0-9_]+(?:\[\d+\])*)*)/g
  return fnExpr.replace(pattern, (match: string, quoted: string, identifier: string, offset: number) => {
    if (quoted) return match
    // Function name? (next non-space char is an open paren)
    let next = offset + match.length
    while (next < fnExpr.length && fnExpr[next] === ' ') next++
    if (fnExpr[next] === '(') return match
    if (identifier === 'true' || identifier === 'false' || identifier === 'null') return match
    const value = resolveVariable(identifier, ctx)
    if (value === undefined) return match
    if (value === null) return 'null'
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (typeof value === 'object') return match
    return JSON.stringify(String(value))
  })
}

/** Resolve {{var}} references and bare identifiers inside a function body. */
function resolveFunctionArgs(fnExpr: string, ctx: ExpressionContext): string {
  const withBraced = fnExpr.replace(/\{\{\s*([\w.\-[\]]+)\s*\}\}/g, (match: string, path: string) => {
    const value = resolveVariable(path, ctx)
    if (value === undefined) return match
    if (value === null) return 'null'
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    // Arrays/objects can't ride text substitution — strip to a bare identifier so
    // the scope-aware arg resolver hands the function the REAL value.
    if (typeof value === 'object') return path
    // Quote strings so commas/parens inside them can't corrupt argument parsing.
    return JSON.stringify(String(value))
  })
  return substituteBareIdentifiers(withBraced, ctx)
}

/**
 * Flat evaluation scope for scope-aware function args (arrays/objects intact):
 * `task` plus every variable, variables winning. Built lazily and without
 * copying — `ctx.variables` itself when there is no task, else a read-only
 * view — so a call no longer spreads hundreds of variables per expression.
 */
function buildFunctionScope(ctx: ExpressionContext): Record<string, any> {
  const { variables, task } = ctx
  if (!task) return variables
  return new Proxy(variables, {
    has: (target, key) => key in target || key === 'task',
    get: (target, key) => (key in target ? target[key as string] : key === 'task' ? task : undefined),
  })
}

interface ParsedTemplate {
  fnMatches: { start: number; end: number; expr: string }[]
  /** Path of a whole-string `{{var}}`, else null. */
  wholeVar: string | null
  /** The whole string is exactly one `{{=FUNC(...)}}`. */
  wholeFn: boolean
}

// Parsed-template LRU: workflow fields are resolved over and over (every loop
// iteration, every run) with the same template text, and parsing is pure.
const TEMPLATE_CACHE_MAX = 1000
const TEMPLATE_CACHE_MAX_LENGTH = 4096
const templateCache = new Map<string, ParsedTemplate>()

function parseTemplate(expr: string): ParsedTemplate {
  const cached = templateCache.get(expr)
  if (cached) {
    // Refresh recency (Map keeps insertion order).
    templateCache.delete(expr)
    templateCache.set(expr, cached)
    return cached
  }
  const fnMatches = extractFunctionExpressions(expr)
  const parsed: ParsedTemplate = {
    fnMatches,
    wholeVar: /^\{\{([\w.\-[\]]+)\}\}$/.test(expr) ? expr.slice(2, -2) : null,
    wholeFn: fnMatches.length === 1 && fnMatches[0].start === 0 && fnMatches[0].end === expr.length,
  }
  if (expr.length <= TEMPLATE_CACHE_MAX_LENGTH) {
    if (templateCache.size >= TEMPLATE_CACHE_MAX) {
      const oldest = templateCache.keys().next().value
      if (oldest !== undefined) templateCache.delete(oldest)
    }
    templateCache.set(expr, parsed)
  }
  return parsed
}

export function resolveExpression(expr: any, ctx: ExpressionContext): any {
  if (typeof expr !== "string") return expr
  // Nothing to resolve without "{{" — the common case for plain config text.
  if (!expr.includes("{{")) return expr
  resolveGeneration++

  const { fnMatches, wholeVar, wholeFn } = parseTemplate(expr)
  const escape = ctx.escape
  const json = ctx.json
  const interpolate = (value: unknown) => {
    const text = value === undefined || value === null
      ? ""
      : json && typeof value === "object"
        ? JSON.stringify(value)
        : String(value)
    return escape ? escape(text) : text
  }
  let fnScope: ReturnType<typeof buildFunctionScope> | undefined
  const evaluate = (fnExpr: string) =>
    evaluateFunction(resolveFunctionArgs(fnExpr, ctx), (fnScope ??= buildFunctionScope(ctx)))

  // The entire string is a single function expression → its raw value. Evaluated
  // exactly once, so non-deterministic functions (GUID, NOW, RANDOM) return the
  // value that was computed, not a second evaluation.
  if (wholeFn) return escape ? interpolate(evaluate(fnMatches[0].expr)) : evaluate(fnMatches[0].expr)

  // Step 1: Resolve {{=FUNCTION(...)}} expressions (reverse order keeps indices valid)
  let resolved = expr
  for (let i = fnMatches.length - 1; i >= 0; i--) {
    const m = fnMatches[i]
    const replacement = interpolate(evaluate(m.expr))
    resolved = resolved.slice(0, m.start) + replacement + resolved.slice(m.end)
  }

  // If the entire string was a single variable expression, return the raw value (not string)
  if (wholeVar !== null) {
    const raw = resolveVariable(wholeVar, ctx)
    if (escape) return interpolate(raw)
    if (raw !== undefined) return raw
    return ""
  }

  // Step 2: Resolve remaining {{variable}} patterns
  return resolved.replace(/\{\{([\w.\-[\]]+)\}\}/g, (_: string, path: string) => {
    return interpolate(resolveVariable(path, ctx))
  })
}

/**
 * Value-aware resolver for form rules: resolves {{=FUNC(...)}} (with real values,
 * so COUNT(items) / SUM(PLUCK(items,"price")) work against a control) and {{var}}
 * against a FLAT scope. Returns the RAW typed value when the whole string is a
 * single expression (number, array, etc.); otherwise a filled string.
 */
export function resolveExpressionValues(expr: any, scope: Record<string, any>): any {
  if (typeof expr !== 'string' || !expr.includes('{{')) return expr
  // Tolerate surrounding whitespace: '{{=COUNT(items)}} ' must still return the raw
  // typed value (a number), not fall into the stringifying mixed-string path.
  const trimmed = expr.trim()
  if (trimmed !== expr) return resolveExpressionValues(trimmed, scope)
  const stripInner = (body: string) => body.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, '$1')
  const path = (p: string): any => {
    if (p in scope) return scope[p]              // flat key first (e.g. 'user.display_name', 'rulevar.tier')
    const parts = p.split('.')
    if (!(parts[0] in scope)) return undefined
    let v: any = scope[parts[0]]
    for (let i = 1; i < parts.length; i++) v = v?.[parts[i]]
    return v
  }
  const str = (v: any) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

  const { fnMatches, wholeFn } = parseTemplate(expr)

  // Whole string is one function expression → raw typed result.
  if (wholeFn) {
    return evaluateFunction(stripInner(fnMatches[0].expr), scope)
  }
  // Whole string is one {{var}} → raw value.
  const wholeVar = expr.match(/^\{\{\s*([\w.-]+)\s*\}\}$/)
  if (wholeVar) return path(wholeVar[1])

  // Mixed string: stringify each function result (right-to-left), then variables.
  let out = expr
  for (let i = fnMatches.length - 1; i >= 0; i--) {
    const m = fnMatches[i]
    out = out.slice(0, m.start) + str(evaluateFunction(stripInner(m.expr), scope)) + out.slice(m.end)
  }
  return out.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_: string, p: string) => str(path(p)))
}

// Case-insensitive variable lookup: lower-cased key → first matching key.
// Built at most once per resolveExpression call (variables can change between
// calls, never during one), instead of a linear scan per lookup.
let resolveGeneration = 0
const lowerKeyMaps = new WeakMap<object, { generation: number; map: Map<string, string> }>()

function lowerCaseKeys(variables: object): Map<string, string> {
  const entry = lowerKeyMaps.get(variables)
  if (entry && entry.generation === resolveGeneration) return entry.map
  const map = new Map<string, string>()
  for (const key of Object.keys(variables)) {
    const lower = key.toLowerCase()
    if (!map.has(lower)) map.set(lower, key) // first match wins, like Array.find
  }
  lowerKeyMaps.set(variables, { generation: resolveGeneration, map })
  return map
}

/** `data[0].items[2]` → `data.0.items.2` (the dotted form every lookup walks). */
export function normalizeIndexPath(path: string): string {
  return path.replace(/\[(\d+)\]/g, ".$1").replace(/^\./, "")
}

function resolveVariable(path: string, ctx: ExpressionContext): any {
  // Flat dotted keys first (e.g. a variable literally named 'user.email') —
  // mirrors the form-rules resolver so mappings created there read back here.
  if (path in ctx.variables) return ctx.variables[path]

  // Index paths: `data[0].name` reads like `data.0.name`.
  const parts = (path.includes("[") ? normalizeIndexPath(path) : path).split(".")

  // Check variables first (exact match, then case-insensitive fallback)
  let rootKey = parts[0]
  if (ctx.variables[rootKey] === undefined) {
    const match = lowerCaseKeys(ctx.variables).get(rootKey.toLowerCase())
    if (match) rootKey = match
  }
  if (ctx.variables[rootKey] !== undefined) {
    let value = ctx.variables[rootKey]
    for (let i = 1; i < parts.length; i++) value = value?.[parts[i]]
    return value
  }
  // Then check task data
  if (parts[0] === "task" && ctx.task) {
    let value: any = ctx.task
    for (let i = 1; i < parts.length; i++) value = value?.[parts[i]]
    return value
  }
  // Direct task field reference
  if (ctx.task?.[parts[0]] !== undefined) {
    let value = ctx.task[parts[0]]
    for (let i = 1; i < parts.length; i++) value = value?.[parts[i]]
    return value
  }

  return undefined
}

/**
 * Safe math evaluation using a recursive descent parser.
 * Only supports: numbers, +, -, *, /, %, parentheses.
 * No Function() or eval() — immune to code injection.
 */
export function safeEval(expression: string): number {
  const sanitized = expression.replace(/[^0-9+\-*/%(). ]/g, "").trim()
  if (!sanitized || sanitized.length > 200) return 0

  let pos = 0

  function skipWhitespace() {
    while (pos < sanitized.length && sanitized[pos] === ' ') pos++
  }

  function parseNumber(): number {
    skipWhitespace()
    // Handle unary minus/plus
    let sign = 1
    while (pos < sanitized.length && (sanitized[pos] === '-' || sanitized[pos] === '+')) {
      if (sanitized[pos] === '-') sign *= -1
      pos++
      skipWhitespace()
    }
    if (pos < sanitized.length && sanitized[pos] === '(') {
      pos++ // skip '('
      const val = parseAddSub()
      skipWhitespace()
      if (pos < sanitized.length && sanitized[pos] === ')') pos++ // skip ')'
      return sign * val
    }
    const start = pos
    while (pos < sanitized.length && (sanitized[pos] >= '0' && sanitized[pos] <= '9' || sanitized[pos] === '.')) pos++
    const num = parseFloat(sanitized.slice(start, pos))
    return isNaN(num) ? 0 : sign * num
  }

  function parseMulDiv(): number {
    let left = parseNumber()
    skipWhitespace()
    while (pos < sanitized.length && (sanitized[pos] === '*' || sanitized[pos] === '/' || sanitized[pos] === '%')) {
      const op = sanitized[pos++]
      const right = parseNumber()
      if (op === '*') left *= right
      else if (op === '/') left = right !== 0 ? left / right : Infinity
      else left = right !== 0 ? left % right : 0
      skipWhitespace()
    }
    return left
  }

  function parseAddSub(): number {
    let left = parseMulDiv()
    skipWhitespace()
    while (pos < sanitized.length && (sanitized[pos] === '+' || sanitized[pos] === '-')) {
      const op = sanitized[pos++]
      const right = parseMulDiv()
      left = op === '+' ? left + right : left - right
      skipWhitespace()
    }
    return left
  }

  try {
    const result = parseAddSub()
    return typeof result === 'number' && isFinite(result) ? result : 0
  } catch {
    return 0
  }
}
