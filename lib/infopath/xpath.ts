/**
 * XPath 1.0 (the subset InfoPath writes) → an AST, and the AST → UserTasks:
 *
 *  - toCondition: a rule condition (lib/forms/data-table DataTableConditionGroup:
 *    AND / OR groups of `column operator value`). `not(…)` is pushed down with
 *    De Morgan; comparisons with the field on the right are flipped.
 *  - toExpression: a formula in the {{= … }} language (lib/expression-functions),
 *    fields as {{form.<key>}}, List columns as PLUCK(form.<list>, "<column>").
 *
 * Both return `null` plus a reason when something has no equivalent (a
 * secondary data source, a role, a filtered node set, an unknown function…):
 * the caller keeps the original expression on a disabled rule and in the
 * report — never silently dropped.
 *
 * Paths are resolved against a context node (absolute path of local names,
 * e.g. `/expenseReport/items/item`): `..`, `.`, relative and absolute paths;
 * namespace prefixes are ignored (InfoPath's main data source is `my:`).
 */

import type { DataTableCondition, DataTableConditionGroup, DataTableOperator } from '@/lib/forms/data-table'

/* ── AST ──────────────────────────────────────────────────────────────── */

export type XNode =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'path'; abs: boolean; steps: string[]; filtered: boolean; raw: string }
  | { t: 'fn'; name: string; args: XNode[] }
  | { t: 'bin'; op: string; l: XNode; r: XNode }
  | { t: 'neg'; e: XNode }
  | { t: 'var'; name: string }

export class XPathError extends Error {
  constructor(message: string) { super(message); this.name = 'XPathError' }
}

/* ── Tokenizer ────────────────────────────────────────────────────────── */

type Tok = { k: 'num' | 'str' | 'name' | 'op' | 'var'; v: string }

const MAX_EXPR = 4000

function tokenize(src: string): Tok[] {
  if (src.length > MAX_EXPR) throw new XPathError('Expression is too long')
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1)
      if (end === -1) throw new XPathError('Unterminated string')
      out.push({ k: 'str', v: src.slice(i + 1, end) })
      i = end + 1
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+|^[0-9]+\.?/.exec(src.slice(i))!
      out.push({ k: 'num', v: m[0] })
      i += m[0].length
      continue
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)/.exec(src.slice(i))
      if (!m) throw new XPathError('Bad variable')
      out.push({ k: 'var', v: m[1] })
      i += m[0].length
      continue
    }
    const two = src.slice(i, i + 2)
    if (['!=', '<=', '>=', '//', '..', '::'].includes(two)) { out.push({ k: 'op', v: two }); i += 2; continue }
    if ('()[],=<>+-*/|@.'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue }
    const m = /^[A-Za-z_][\w.-]*(?::(?:[A-Za-z_][\w.-]*|\*))?|^\*/.exec(src.slice(i))
    if (!m) throw new XPathError(`Unexpected "${c}"`)
    // Names may not end in "." or "-" that are really operators (a-b is a name in XPath; keep XPath's rule).
    out.push({ k: 'name', v: m[0] })
    i += m[0].length
  }
  return out
}

/* ── Parser (precedence: or < and < = != < relational < additive < multiplicative < unary < union < path) ── */

export function parseXPath(src: string): XNode {
  const toks = tokenize(src)
  let p = 0
  const peek = (o = 0) => toks[p + o]
  const isOp = (v: string, o = 0) => peek(o)?.k === 'op' && peek(o)!.v === v
  const isName = (v: string, o = 0) => peek(o)?.k === 'name' && peek(o)!.v === v
  const expect = (v: string) => { if (!isOp(v)) throw new XPathError(`Expected "${v}"`); p++ }
  let depth = 0

  function binary(next: () => XNode, ops: string[], named = false): XNode {
    let l = next()
    for (;;) {
      const t = peek()
      if (!t) break
      const match = named ? (t.k === 'name' && ops.includes(t.v)) : (t.k === 'op' && ops.includes(t.v))
      // `*` / div / mod are operators only after an operand (always true here).
      if (!match) break
      p++
      l = { t: 'bin', op: t.v, l, r: next() }
    }
    return l
  }
  const orExpr = (): XNode => {
    if (++depth > 100) throw new XPathError('Expression is nested too deeply')
    try { return binary(andExpr, ['or'], true) } finally { depth-- }
  }
  const andExpr = (): XNode => binary(eqExpr, ['and'], true)
  const eqExpr = (): XNode => binary(relExpr, ['=', '!='])
  const relExpr = (): XNode => binary(addExpr, ['<', '>', '<=', '>='])
  const addExpr = (): XNode => binary(mulExpr, ['+', '-'])
  const mulExpr = (): XNode => {
    let l = unary()
    for (;;) {
      const t = peek()
      if (t && ((t.k === 'op' && t.v === '*') || (t.k === 'name' && (t.v === 'div' || t.v === 'mod' || t.v === '*')))) {
        p++
        l = { t: 'bin', op: t.v === '*' ? '*' : t.v, l, r: unary() }
      } else break
    }
    return l
  }
  const unary = (): XNode => {
    if (isOp('-')) { p++; return { t: 'neg', e: unary() } }
    return binary(primaryOrPath, ['|'])
  }
  function primaryOrPath(): XNode {
    const t = peek()
    if (!t) throw new XPathError('Unexpected end of expression')
    if (t.k === 'str') { p++; return { t: 'str', v: t.v } }
    if (t.k === 'num') { p++; return { t: 'num', v: Number(t.v) } }
    if (t.k === 'var') { p++; return { t: 'var', name: t.v } }
    if (isOp('(')) {
      p++
      const e = orExpr()
      expect(')')
      return withTail(e)
    }
    // Function call: name followed by "(" (node tests text() / node() are path steps).
    if (t.k === 'name' && isOp('(', 1) && !['text', 'node', 'comment', 'processing-instruction'].includes(t.v)) {
      p += 2
      const args: XNode[] = []
      if (!isOp(')')) {
        args.push(orExpr())
        while (isOp(',')) { p++; args.push(orExpr()) }
      }
      expect(')')
      return withTail({ t: 'fn', name: t.v, args })
    }
    return path()
  }
  /** A filter expression's trailing `/steps` (e.g. xdXDocument:GetDOM("x")/a/b): kept as an opaque function path. */
  function withTail(e: XNode): XNode {
    if (!isOp('/') && !isOp('//') && !isOp('[')) return e
    const steps: string[] = []
    let filtered = false
    while (isOp('[')) { skipPredicate(); filtered = true }
    while (isOp('/') || isOp('//')) {
      p++
      steps.push(step())
      while (isOp('[')) { skipPredicate(); filtered = true }
    }
    return { t: 'fn', name: '#filter-path', args: [e, { t: 'path', abs: false, steps, filtered, raw: steps.join('/') }] }
  }
  function skipPredicate() {
    expect('[')
    orExpr()
    expect(']')
  }
  function step(): string {
    if (isOp('..')) { p++; return '..' }
    if (isOp('.')) { p++; return '.' }
    if (isOp('@')) { p++; const n = peek(); if (!n || n.k !== 'name') throw new XPathError('Expected an attribute name'); p++; return `@${n.v}` }
    const n = peek()
    if (n?.k === 'name') {
      p++
      if (isOp('::')) { // axis::name — keep child / attribute / self / parent
        p++
        const target = peek()
        if (!target || target.k !== 'name') throw new XPathError('Expected a name after an axis')
        p++
        if (n.v === 'attribute') return `@${target.v}`
        if (n.v === 'parent') return '..'
        if (n.v === 'self') return '.'
        if (n.v === 'child') return target.v
        return `#${n.v}::${target.v}`
      }
      if (isOp('(')) { // text() / node()
        p++
        expect(')')
        return `${n.v}()`
      }
      return n.v
    }
    if (n?.k === 'op' && n.v === '*') { p++; return '*' }
    throw new XPathError('Expected a path step')
  }
  function path(): XNode {
    const start = p
    let abs = false
    const steps: string[] = []
    let filtered = false
    if (isOp('/') || isOp('//')) {
      abs = true
      if (isOp('//')) steps.push('#descendant')
      p++
      if (!peek() || (peek()!.k === 'op' && !['.', '..', '@', '*'].includes(peek()!.v))) return { t: 'path', abs, steps, filtered, raw: '/' }
    }
    steps.push(step())
    while (isOp('[')) { skipPredicate(); filtered = true }
    while (isOp('/') || isOp('//')) {
      if (isOp('//')) steps.push('#descendant')
      p++
      steps.push(step())
      while (isOp('[')) { skipPredicate(); filtered = true }
    }
    const raw = toks.slice(start, p).map((t) => t.v).join('')
    return { t: 'path', abs, steps, filtered, raw }
  }

  const e = orExpr()
  if (p < toks.length) throw new XPathError(`Unexpected "${toks[p].v}"`)
  return e
}

/* ── Paths ────────────────────────────────────────────────────────────── */

export const localOf = (name: string) => (name.includes(':') ? name.slice(name.indexOf(':') + 1) : name)

/** Absolute path (local names) of `steps` from `context` (also local names, "/a/b"). Null when it can't be followed. */
export function resolveSteps(context: string, abs: boolean, steps: string[]): string | null {
  const parts = abs ? [] : context.split('/').filter(Boolean)
  for (const s of steps) {
    if (s === '.' || s === 'text()' || s === 'node()') continue
    if (s === '..') { if (!parts.length) return null; parts.pop(); continue }
    if (s.startsWith('#') || s === '*') return null
    parts.push(s.startsWith('@') ? `@${localOf(s.slice(1))}` : localOf(s))
  }
  return `/${parts.join('/')}`
}

/** A binding as written in a view / the manifest (`my:a/my:b`, `../my:c`) → absolute local-name path. */
export function resolveBinding(context: string, binding: string): string | null {
  const b = binding.trim()
  if (!b) return null
  try {
    const node = parseXPath(b)
    if (node.t !== 'path') return null
    return resolveSteps(context, node.abs, node.steps)
  } catch {
    return null
  }
}

/* ── Translation ──────────────────────────────────────────────────────── */

/** What a path is in the generated form. */
export type Ref =
  | { kind: 'field'; key: string; type?: string }
  | { kind: 'list'; key: string }
  | { kind: 'column'; list: string; column: string; type?: string }

export interface TranslateEnv {
  /** The node `.` refers to (absolute local-name path). */
  context: string
  /** Absolute path → what it became; null = not on the form. */
  resolve: (path: string) => Ref | null
  /** Inside a List row (conditions / formulas on a repeating table's columns): its key. */
  row?: string | null
}

export type Translated<T> = { ok: true; value: T; notes: string[] } | { ok: false; reason: string }

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })

/** Functions with a direct {{= }} equivalent: name (local, lower-case) → catalog name. */
const FN_MAP: Record<string, string> = {
  concat: 'CONCAT', 'string-length': 'LENGTH', contains: 'CONTAINS', round: 'ROUND', floor: 'ROUND_DOWN', ceiling: 'ROUND_UP',
  number: 'TO_NUMBER', string: 'TO_STRING', boolean: 'TO_BOOLEAN', not: 'NOT', 'normalize-space': 'TRIM', abs: 'ABS',
  today: 'TODAY', now: 'NOW', adddays: 'ADD_DAYS', nz: 'COALESCE', avg: 'AVG', max: 'MAX', min: 'MIN', sum: 'SUM', count: 'COUNT', substring: 'MID',
}

/** Recognised but not convertible, with the reason shown in the report. */
const NO_EQUIVALENT: Record<string, string> = {
  getdom: 'reads a secondary data source (a data connection)',
  'get-role': 'reads the InfoPath user role (map roles to UserTasks permissions or a rule on user.email)',
  'get-username': 'reads the Windows user name (use {{user.name}} / {{user.email}} in a rule)',
  username: 'reads the Windows user name (use {{user.name}} / {{user.email}} in a rule)',
  'get-userprofilebyname': 'reads a SharePoint user profile',
  'get-serverurl': 'reads the SharePoint server address',
  'get-sharepointserverrooturl': 'reads the SharePoint server address',
  'get-sharepointsiteurl': 'reads the SharePoint site address',
  'get-sharepointsitecollectionurl': 'reads the SharePoint site address',
  eval: 'evaluates an expression per repeating row (xdMath:Eval)',
  'substring-before': 'has no direct UserTasks function',
  'substring-after': 'has no direct UserTasks function',
  translate: 'translates characters (only lower → upper case and the reverse convert)',
  position: 'reads a row position',
  last: 'reads a row position',
  'current': 'reads the current node',
  'function-available': 'is an InfoPath compatibility check',
  'xdextension': 'calls form code',
}

const fnLocal = (name: string) => localOf(name).toLowerCase()

function lit(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function refOf(node: XNode, env: TranslateEnv): Ref | null | 'filtered' | 'unresolved' {
  if (node.t !== 'path') return null
  if (node.filtered) return 'filtered'
  const abs = resolveSteps(env.context, node.abs, node.steps)
  if (!abs) return 'unresolved'
  return env.resolve(abs) ?? 'unresolved'
}

function pathText(node: XNode): string {
  return node.t === 'path' ? node.raw : ''
}

/** A formula for an XPath expression (null + reason when it has no equivalent). */
export function toExpression(src: string | XNode, env: TranslateEnv): Translated<string> {
  let ast: XNode
  try { ast = typeof src === 'string' ? parseXPath(src) : src } catch (error) { return fail(`could not be read (${(error as Error).message})`) }
  const notes: string[] = []
  const go = (n: XNode): string => {
    switch (n.t) {
      case 'num': return String(n.v)
      case 'str': return lit(n.v)
      case 'var': throw new XPathError(`reads the variable $${n.name}`)
      case 'neg': return `(0 - ${go(n.e)})`
      case 'path': {
        const ref = refOf(n, env)
        if (ref === 'filtered') throw new XPathError(`filters rows (${n.raw})`)
        if (ref === 'unresolved' || !ref) throw new XPathError(`reads ${n.raw || 'a node'}, which is not on the form`)
        if (ref.kind === 'field') return `{{form.${ref.key}}}`
        if (ref.kind === 'list') return `{{form.${ref.key}}}`
        if (env.row && ref.list === env.row) return `{{row.${ref.column}}}`
        return `PLUCK({{form.${ref.list}}}, ${lit(ref.column)})`
      }
      case 'bin': {
        const ops: Record<string, string> = { '+': '+', '-': '-', '*': '*', div: '/', '=': '==', '!=': '!=', '<': '<', '>': '>', '<=': '<=', '>=': '>=' }
        if (n.op === 'mod') return `MOD(${go(n.l)}, ${go(n.r)})`
        if (n.op === 'and') return `AND(${go(n.l)}, ${go(n.r)})`
        if (n.op === 'or') return `OR(${go(n.l)}, ${go(n.r)})`
        if (n.op === '|') throw new XPathError('combines node sets (|)')
        return `(${go(n.l)} ${ops[n.op]} ${go(n.r)})`
      }
      case 'fn': {
        const name = fnLocal(n.name)
        if (name === '#filter-path') throw new XPathError(NO_EQUIVALENT[fnLocal((n.args[0] as { name?: string }).name ?? '')] ?? 'reads a secondary data source (a data connection)')
        if (name === 'true') return 'true'
        if (name === 'false') return 'false'
        if (name === 'today') return 'TODAY()'
        if (name === 'now') return 'NOW()'
        if (name === 'string-compare') return `(${go(n.args[0])} == ${go(n.args[1])})` // only used inside comparisons; see toCondition
        if (name === 'translate' && n.args.length === 3 && n.args[1].t === 'str' && n.args[2].t === 'str') {
          const from = n.args[1].v; const to = n.args[2].v
          if (from === 'abcdefghijklmnopqrstuvwxyz' && to === 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') return `UPPER(${go(n.args[0])})`
          if (from === 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' && to === 'abcdefghijklmnopqrstuvwxyz') return `LOWER(${go(n.args[0])})`
        }
        if (name === 'starts-with') return `(FIND(${go(n.args[0])}, ${go(n.args[1])}) == 1)`
        if (name === 'round') return `ROUND(${go(n.args[0])}, 0)`
        if (name === 'floor') return `ROUND_DOWN(${go(n.args[0])}, 0)`
        if (name === 'ceiling') return `ROUND_UP(${go(n.args[0])}, 0)`
        if (name === 'nz') return `COALESCE(${go(n.args[0])}, 0)`
        if (name === 'normalize-space') notes.push('normalize-space became TRIM (inner runs of spaces are kept)')
        if (name === 'string-length' && !n.args.length) return `LENGTH({{form.${currentKey(env)}}})`
        if (name === 'count') {
          const a = n.args[0]
          const ref = a ? refOf(a, env) : null
          if (ref && typeof ref === 'object' && ref.kind === 'list') return `COUNT({{form.${ref.key}}})`
          if (ref && typeof ref === 'object' && ref.kind === 'column') return `COUNT(${go(a)})`
          throw new XPathError(`counts ${a ? pathText(a) || 'nodes' : 'nodes'} that are not a repeating table on the form`)
        }
        if (name === 'sum' || name === 'avg' || name === 'max' || name === 'min') {
          const a = n.args[0]
          if (n.args.length === 1 && a?.t === 'path') return `${FN_MAP[name]}(${go(a)})`
          if (name === 'sum' && a?.t === 'fn' && fnLocal(a.name) === 'eval') throw new XPathError(NO_EQUIVALENT.eval)
          return `${FN_MAP[name]}(${n.args.map(go).join(', ')})`
        }
        if (NO_EQUIVALENT[name]) throw new XPathError(`${n.name}() ${NO_EQUIVALENT[name]}`)
        if (name === 'adddays' || name === 'addseconds') {
          if (name === 'addseconds') return `ADD_MINUTES(${go(n.args[0])}, (${go(n.args[1])}) / 60)`
          return `ADD_DAYS(${go(n.args[0])}, ${go(n.args[1])})`
        }
        const mapped = FN_MAP[name]
        if (!mapped) throw new XPathError(`${n.name}() has no UserTasks equivalent`)
        return `${mapped}(${n.args.map(go).join(', ')})`
      }
    }
  }
  try {
    return { ok: true, value: go(ast), notes }
  } catch (error) {
    return fail((error as Error).message)
  }
}

function currentKey(env: TranslateEnv): string {
  const ref = env.resolve(env.context)
  if (!ref || ref.kind !== 'field') throw new XPathError('reads the current field, which is not on the form')
  return ref.key
}

/* ── Conditions ───────────────────────────────────────────────────────── */

type Cond = DataTableCondition | DataTableConditionGroup

const NEGATE: Partial<Record<DataTableOperator, DataTableOperator>> = { eq: 'neq', neq: 'eq', gt: 'lte', gte: 'lt', lt: 'gte', lte: 'gt', is_set: 'is_not_set', is_not_set: 'is_set' }
const FLIP: Record<string, DataTableOperator> = { '=': 'eq', '!=': 'neq', '<': 'gt', '<=': 'gte', '>': 'lt', '>=': 'lte' }
const DIRECT: Record<string, DataTableOperator> = { '=': 'eq', '!=': 'neq', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' }

function isGroup(c: Cond): c is DataTableConditionGroup {
  return 'match' in c
}

function negate(c: Cond): Cond {
  if (isGroup(c)) return { match: c.match === 'all' ? 'any' : 'all', conditions: c.conditions.map(negate) }
  const op = NEGATE[c.operator]
  if (!op) throw new XPathError(`"not" of a ${c.operator} comparison has no equivalent`)
  return { ...c, operator: op }
}

/** The subject a condition reads (a field key, or row.<column> inside a List row). */
function subjectOf(node: XNode, env: TranslateEnv): string | null {
  if (node.t === 'fn' && fnLocal(node.name) === 'string' && node.args.length === 1) return subjectOf(node.args[0], env)
  if (node.t === 'fn' && fnLocal(node.name) === 'number' && node.args.length === 1) return subjectOf(node.args[0], env)
  if (node.t === 'fn' && fnLocal(node.name) === 'normalize-space' && node.args.length === 1) return subjectOf(node.args[0], env)
  const ref = refOf(node, env)
  if (!ref || typeof ref !== 'object') {
    if (ref === 'filtered') throw new XPathError(`filters rows (${pathText(node)})`)
    if (ref === 'unresolved') throw new XPathError(`reads ${pathText(node) || 'a node'}, which is not on the form`)
    return null
  }
  if (ref.kind === 'field') return ref.key
  if (ref.kind === 'column' && env.row === ref.list) return `row.${ref.column}`
  if (ref.kind === 'column') throw new XPathError(`compares a repeating-table column (${pathText(node)}) outside its row`)
  return null
}

/** A constant / another field as a condition value (templates allowed). */
function valueOf(node: XNode, env: TranslateEnv): string | null {
  if (node.t === 'str') return node.v
  if (node.t === 'num') return String(node.v)
  if (node.t === 'neg' && node.e.t === 'num') return String(-node.e.v)
  if (node.t === 'fn') {
    const name = fnLocal(node.name)
    if (name === 'true' && !node.args.length) return 'true'
    if (name === 'false' && !node.args.length) return 'false'
    if (name === 'string' && node.args.length === 1) return valueOf(node.args[0], env)
    if (name === 'today' && !node.args.length) return '{{today}}'
    if (name === 'now' && !node.args.length) return '{{now}}'
  }
  const subject = subjectOf(node, env)
  if (subject) return subject.startsWith('row.') ? `{{${subject}}}` : `{{form.${subject}}}`
  return null
}

/** A rule condition for an XPath boolean expression (null + reason when it has no equivalent). */
export function toCondition(src: string | XNode, env: TranslateEnv): Translated<DataTableConditionGroup> {
  let ast: XNode
  try { ast = typeof src === 'string' ? parseXPath(src) : src } catch (error) { return fail(`could not be read (${(error as Error).message})`) }
  const go = (n: XNode): Cond => {
    if (n.t === 'bin' && (n.op === 'and' || n.op === 'or')) {
      const match = n.op === 'and' ? 'all' : 'any'
      const parts = [go(n.l), go(n.r)].flatMap((c) => (isGroup(c) && c.match === match ? c.conditions : [c]))
      return { match, conditions: parts }
    }
    if (n.t === 'fn') {
      const name = fnLocal(n.name)
      if (name === 'not' && n.args.length === 1) return negate(go(n.args[0]))
      if (name === 'true' && !n.args.length) throw new XPathError('is always true')
      if ((name === 'contains' || name === 'starts-with') && n.args.length === 2) {
        const subject = subjectOf(n.args[0], env)
        const value = valueOf(n.args[1], env)
        if (!subject || value === null) throw new XPathError(`${name}() compares values that are not fields and constants`)
        return { column: subject, operator: name === 'contains' ? 'contains' : 'starts_with', value }
      }
      if (name === 'boolean' && n.args.length === 1) {
        const subject = subjectOf(n.args[0], env)
        if (subject) return { column: subject, operator: 'is_set' }
      }
      if (NO_EQUIVALENT[name]) throw new XPathError(`${n.name}() ${NO_EQUIVALENT[name]}`)
      if (name === '#filter-path') throw new XPathError('reads a secondary data source (a data connection)')
      throw new XPathError(`${n.name}() is not a condition UserTasks can check`)
    }
    if (n.t === 'path') {
      // A bare node test: "the field has a value" (InfoPath: node exists / non-empty).
      const subject = subjectOf(n, env)
      if (subject) return { column: subject, operator: 'is_set' }
      throw new XPathError(`tests ${n.raw}, which is not a field on the form`)
    }
    if (n.t === 'bin' && (DIRECT[n.op])) {
      let l = n.l
      let r = n.r
      // msxsl:string-compare(a, b) <op> 0  →  a <op> b (dates and text compare in order).
      if (l.t === 'fn' && fnLocal(l.name) === 'string-compare' && l.args.length >= 2 && r.t === 'num' && r.v === 0) {
        const [a, b] = l.args
        return go({ t: 'bin', op: n.op, l: a, r: b })
      }
      // string-length(x) > 0 / = 0 → is set / is empty.
      if (l.t === 'fn' && fnLocal(l.name) === 'string-length' && r.t === 'num') {
        const subject = l.args.length ? subjectOf(l.args[0], env) : subjectOf({ t: 'path', abs: false, steps: ['.'], filtered: false, raw: '.' }, env)
        if (!subject) throw new XPathError('string-length() of something that is not a field')
        if ((n.op === '>' && r.v === 0) || (n.op === '>=' && r.v === 1) || (n.op === '!=' && r.v === 0)) return { column: subject, operator: 'is_set' }
        if ((n.op === '=' && r.v === 0) || (n.op === '<' && r.v === 1) || (n.op === '<=' && r.v === 0)) return { column: subject, operator: 'is_not_set' }
        throw new XPathError('compares a text length with a number other than 0')
      }
      let op: DataTableOperator = DIRECT[n.op]
      let subject = subjectOf(l, env)
      if (!subject) {
        subject = subjectOf(r, env)
        if (!subject) {
          for (const side of [l, r]) {
            if (side.t === 'fn' && NO_EQUIVALENT[fnLocal(side.name)]) throw new XPathError(`${side.name}() ${NO_EQUIVALENT[fnLocal(side.name)]}`)
            if (side.t === 'fn' && fnLocal(side.name) === '#filter-path') throw new XPathError('reads a secondary data source (a data connection)')
          }
          throw new XPathError(`compares ${describe(l)} with ${describe(r)}`)
        }
        op = FLIP[n.op]
        ;[l, r] = [r, l]
      }
      const value = valueOf(r, env)
      if (value === null) throw new XPathError(`compares a field with ${describe(r)}`)
      if (value === '' && op === 'eq') return { column: subject, operator: 'is_not_set' }
      if (value === '' && op === 'neq') return { column: subject, operator: 'is_set' }
      return { column: subject, operator: op, value }
    }
    throw new XPathError(`${describe(n)} is not a condition UserTasks can check`)
  }
  try {
    const c = go(ast)
    return { ok: true, value: isGroup(c) ? c : { match: 'all', conditions: [c] }, notes: [] }
  } catch (error) {
    return fail((error as Error).message)
  }
}

function describe(n: XNode): string {
  switch (n.t) {
    case 'str': return `"${n.v}"`
    case 'num': return String(n.v)
    case 'path': return n.raw
    case 'fn': return `${n.name}()`
    case 'var': return `$${n.name}`
    case 'neg': return 'a negative value'
    case 'bin': return 'a calculation'
  }
}

/** Every absolute path an expression reads (dependencies of a calculation). */
export function expressionPaths(src: string, context: string): string[] {
  let ast: XNode
  try { ast = parseXPath(src) } catch { return [] }
  const out = new Set<string>()
  const walk = (n: XNode) => {
    if (n.t === 'path') { const a = resolveSteps(context, n.abs, n.steps); if (a) out.add(a) }
    else if (n.t === 'fn') n.args.forEach(walk)
    else if (n.t === 'bin') { walk(n.l); walk(n.r) }
    else if (n.t === 'neg') walk(n.e)
  }
  walk(ast)
  return [...out]
}

/** InfoPath function names an expression uses (local, for the report). */
export function functionNames(src: string): string[] {
  let ast: XNode
  try { ast = parseXPath(src) } catch { return [] }
  const out = new Set<string>()
  const walk = (n: XNode) => {
    if (n.t === 'fn') { if (!n.name.startsWith('#')) out.add(n.name); n.args.forEach(walk) }
    else if (n.t === 'bin') { walk(n.l); walk(n.r) }
    else if (n.t === 'neg') walk(n.e)
  }
  walk(ast)
  return [...out]
}
