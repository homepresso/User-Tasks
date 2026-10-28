import { parseError } from './errors'

/**
 * Query-string grammar, ported from PostgREST v14's ApiRequest/QueryParams.hs
 * (select trees, filters with embed paths and JSON paths, and/or logic trees,
 * order terms, limit/offset per embed level, columns, on_conflict).
 */

export interface JsonOp {
  arrow: '->' | '->>'
  key: string
  isIdx: boolean
}

export interface Field {
  name: string
  path: JsonOp[]
}

export type AggFn = 'sum' | 'avg' | 'count' | 'max' | 'min'

export type SelectItem =
  | { type: 'field'; field: Field; agg: AggFn | null; aggCast: string | null; cast: string | null; alias: string | null }
  | {
      type: 'relation'
      name: string
      alias: string | null
      hint: string | null
      joinType: 'inner' | 'left' | null
      spread: boolean
      children: SelectItem[]
    }

export type SimpleOp = 'neq' | 'cs' | 'cd' | 'ov' | 'sl' | 'sr' | 'nxr' | 'nxl' | 'adj'
export type QuantOp = 'eq' | 'gte' | 'gt' | 'lte' | 'lt' | 'like' | 'ilike' | 'match' | 'imatch'
export type FtsOp = 'fts' | 'plfts' | 'phfts' | 'wfts'
export type IsVal = 'null' | 'not_null' | 'true' | 'false' | 'unknown'

export type Operation =
  | { kind: 'op'; op: SimpleOp; value: string }
  | { kind: 'quant'; op: QuantOp; quant: 'any' | 'all' | null; value: string }
  | { kind: 'in'; values: string[] }
  | { kind: 'is'; value: IsVal }
  | { kind: 'isdistinct'; value: string }
  | { kind: 'fts'; op: FtsOp; lang: string | null; value: string }

export interface OpExpr {
  not: boolean
  operation: Operation
}

export interface Filter {
  field: Field
  /** null: an RPC GET argument (no operator). */
  expr: OpExpr | null
  raw: string
}

export type LogicTree =
  | { type: 'stmt'; filter: Filter }
  | { type: 'expr'; not: boolean; op: 'and' | 'or'; children: LogicTree[] }

export interface OrderTerm {
  /** Set for `rel(col)` terms (ordering by a to-one embed's column). */
  relation: string | null
  field: Field
  dir: 'asc' | 'desc' | null
  nulls: 'first' | 'last' | null
}

export interface Range {
  offset: number
  /** null: no limit. */
  limit: number | null
}

export interface QueryParams {
  select: SelectItem[]
  /** [embed path, filter] */
  filters: Array<[string[], Filter]>
  logic: Array<[string[], LogicTree]>
  order: Array<[string[], OrderTerm[]]>
  /** Keyed by embed path joined with '.', '' for the root. */
  ranges: Map<string, Range>
  columns: string[] | null
  onConflict: string[] | null
  /** RPC GET arguments (params without an operator). */
  rpcArgs: Array<[string, string]>
  filterFields: Set<string>
}

class ParseFailure extends Error {}

class Cursor {
  pos = 0
  constructor(readonly src: string) {}
  get done() {
    return this.pos >= this.src.length
  }
  peek(n = 0) {
    return this.src[this.pos + n]
  }
  startsWith(s: string) {
    return this.src.startsWith(s, this.pos)
  }
  eat(s: string): boolean {
    if (this.startsWith(s)) {
      this.pos += s.length
      return true
    }
    return false
  }
  expect(s: string) {
    if (!this.eat(s)) this.fail(`expecting "${s}"`)
  }
  fail(msg: string): never {
    throw new ParseFailure(`${msg} at column ${this.pos + 1}`)
  }
  /** Run `fn`; on failure restore the position and return null. */
  try<T>(fn: () => T): T | null {
    const save = this.pos
    try {
      return fn()
    } catch (e) {
      if (!(e instanceof ParseFailure)) throw e
      this.pos = save
      return null
    }
  }
  ws() {
    while (this.peek() === ' ' || this.peek() === '\t') this.pos++
  }
}

const IDENT_CHAR = /[\p{L}\p{N}_$ ]/u

function identifier(c: Cursor): string {
  const start = c.pos
  while (!c.done && IDENT_CHAR.test(c.peek())) c.pos++
  if (c.pos === start) c.fail('expecting field name (* or [a..z0..9_$])')
  return c.src.slice(start, c.pos).trim()
}

function quotedValue(c: Cursor): string {
  c.expect('"')
  let out = ''
  while (true) {
    if (c.done) c.fail('unterminated quoted value')
    const ch = c.peek()
    if (ch === '\\') {
      c.pos++
      if (c.done) c.fail('unterminated escape')
      out += c.peek()
      c.pos++
    } else if (ch === '"') {
      c.pos++
      return out
    } else {
      out += ch
      c.pos++
    }
  }
}

/** Identifier pieces joined by '-' (a dash not starting '->'). */
function sepByDash(c: Cursor, piece: (c: Cursor) => string): string {
  const parts = [piece(c)]
  while (c.peek() === '-' && c.peek(1) !== '>') {
    const save = c.pos
    c.pos++
    const next = c.try(() => piece(c))
    if (next === null) {
      c.pos = save
      break
    }
    parts.push(next)
  }
  return parts.join('-')
}

function fieldName(c: Cursor): string {
  if (c.peek() === '"') return quotedValue(c)
  return sepByDash(c, identifier)
}

function jsonKeyIdentifier(c: Cursor): string {
  const start = c.pos
  while (!c.done && !'(-:.,>)'.includes(c.peek())) c.pos++
  if (c.pos === start) c.fail('expecting json key')
  return c.src.slice(start, c.pos).trim()
}

function jsonPath(c: Cursor): JsonOp[] {
  const ops: JsonOp[] = []
  while (true) {
    let arrow: JsonOp['arrow']
    if (c.startsWith('->>')) arrow = '->>'
    else if (c.startsWith('->')) arrow = '->'
    else break
    const save = c.pos
    c.pos += arrow.length
    // Index: optional '-' then digits, followed by ->, ::, ., , or end.
    const idx = c.try(() => {
      const m = /^-?\d+/.exec(c.src.slice(c.pos))
      if (!m) c.fail('expecting digit')
      c.pos += m[0].length
      if (!(c.done || c.startsWith('->') || c.startsWith('::') || c.startsWith('.') || c.startsWith(','))) c.fail('expecting end of index')
      return m[0]
    })
    if (idx !== null) {
      ops.push({ arrow, key: idx, isIdx: true })
      continue
    }
    const key = c.try(() => (c.peek() === '"' ? quotedValue(c) : sepByDash(c, jsonKeyIdentifier)))
    if (key === null) {
      c.pos = save
      break
    }
    ops.push({ arrow, key, isIdx: false })
  }
  return ops
}

function field(c: Cursor): Field {
  c.ws()
  const name = fieldName(c)
  const path = jsonPath(c)
  c.ws()
  return { name, path }
}

function aliasPrefix(c: Cursor): string | null {
  return c.try(() => {
    const name = fieldName(c)
    if (c.peek() !== ':' || c.peek(1) === ':') c.fail('expecting alias separator')
    c.pos++
    return name
  })
}

function embedParams(c: Cursor): { hint: string | null; joinType: 'inner' | 'left' | null } {
  let hint: string | null = null
  let joinType: 'inner' | 'left' | null = null
  for (let i = 0; i < 2; i++) {
    if (c.peek() !== '!') break
    c.pos++
    if (c.try(() => (c.eat('left') && (c.peek() === '(' || c.peek() === '!') ? true : c.fail('x')))) {
      joinType ??= 'left'
    } else if (c.try(() => (c.eat('inner') && (c.peek() === '(' || c.peek() === '!') ? true : c.fail('x')))) {
      joinType ??= 'inner'
    } else {
      const h = fieldName(c)
      hint ??= h
    }
  }
  return { hint, joinType }
}

function selectEnd(c: Cursor) {
  if (!(c.done || c.peek() === ')' || c.peek() === ',')) c.fail(`unexpected "${c.peek()}"`)
}

function castIdentifier(c: Cursor): string {
  return identifier(c)
}

function fieldSelect(c: Cursor): SelectItem {
  c.ws()
  const star = c.try(() => {
    c.expect('*')
    selectEnd(c)
    return true
  })
  if (star) return { type: 'field', field: { name: '*', path: [] }, agg: null, aggCast: null, cast: null, alias: null }
  const countAgg = c.try(() => {
    const alias = aliasPrefix(c)
    c.expect('count()')
    const aggCast = c.eat('::') ? castIdentifier(c) : null
    selectEnd(c)
    return { alias, aggCast }
  })
  if (countAgg) {
    return { type: 'field', field: { name: '*', path: [] }, agg: 'count', aggCast: countAgg.aggCast, cast: null, alias: countAgg.alias }
  }
  const alias = aliasPrefix(c)
  const fld = field(c)
  const cast = c.eat('::') ? castIdentifier(c) : null
  const agg = c.try(() => {
    c.expect('.')
    for (const fn of ['sum', 'avg', 'count', 'max', 'min'] as const) {
      if (c.eat(fn)) {
        c.expect('()')
        return fn
      }
    }
    return c.fail('expecting aggregate')
  })
  const aggCast = c.eat('::') ? castIdentifier(c) : null
  c.ws()
  selectEnd(c)
  return { type: 'field', field: fld, agg, aggCast, cast, alias }
}

function relationSelect(c: Cursor, spread: boolean): SelectItem {
  c.ws()
  let alias: string | null = null
  if (spread) c.expect('...')
  else alias = aliasPrefix(c)
  const name = fieldName(c)
  if (!spread && name === 'count') c.fail('count is not a relation')
  const { hint, joinType } = embedParams(c)
  if (c.peek() !== '(') c.fail('expecting "("')
  c.pos++
  const children = fieldForest(c)
  c.expect(')')
  c.ws()
  return { type: 'relation', name, alias, hint, joinType, spread, children }
}

function fieldForest(c: Cursor): SelectItem[] {
  const items: SelectItem[] = []
  const one = () =>
    c.try(() => relationSelect(c, true)) ?? c.try(() => relationSelect(c, false)) ?? fieldSelect(c)
  // `sepBy`: zero or more.
  if (c.done || c.peek() === ')') return items
  items.push(one())
  while (true) {
    c.ws()
    if (!c.eat(',')) break
    c.ws()
    items.push(one())
  }
  return items
}

export function parseSelect(src: string): SelectItem[] {
  return runParser(src, `failed to parse select parameter (${src})`, (c) => {
    const items = fieldForest(c)
    if (!c.done) c.fail(`unexpected "${c.peek()}"`)
    return items
  })
}

function runParser<T>(src: string, what: string, fn: (c: Cursor) => T): T {
  const c = new Cursor(src)
  try {
    return fn(c)
  } catch (e) {
    if (e instanceof ParseFailure) throw parseError(`"${what}" (line 1, column ${c.pos + 1})`, e.message)
    throw e
  }
}

const SIMPLE_OPS: SimpleOp[] = ['neq', 'cs', 'cd', 'ov', 'sl', 'sr', 'nxr', 'nxl', 'adj']
const QUANT_OPS: QuantOp[] = ['eq', 'gte', 'gt', 'lte', 'lt', 'like', 'ilike', 'match', 'imatch']
const FTS_OPS: FtsOp[] = ['fts', 'plfts', 'phfts', 'wfts']

function listVal(c: Cursor): string[] {
  c.ws()
  c.expect('(')
  c.ws()
  const values: string[] = []
  const element = () => {
    const quoted = c.try(() => {
      const v = quotedValue(c)
      if (!(c.done || c.peek() === ',' || c.peek() === ')')) c.fail('x')
      return v
    })
    if (quoted !== null) return quoted
    const start = c.pos
    while (!c.done && c.peek() !== ',' && c.peek() !== ')') c.pos++
    return c.src.slice(start, c.pos)
  }
  values.push(element())
  while (c.eat(',')) values.push(element())
  c.ws()
  c.expect(')')
  c.ws()
  return values
}

function opExpr(c: Cursor, singleVal: (c: Cursor) => string): OpExpr {
  const not = c.try(() => {
    c.expect('not')
    c.expect('.')
    return true
  }) ?? false
  const operation =
    c.try(() => {
      c.expect('in')
      c.expect('.')
      return { kind: 'in', values: listVal(c) } as Operation
    }) ??
    c.try(() => {
      c.expect('is')
      c.expect('.')
      const rest = c.src.slice(c.pos)
      for (const v of ['null', 'not_null', 'true', 'false', 'unknown'] as const) {
        if (rest.toLowerCase().startsWith(v)) {
          c.pos += v.length
          return { kind: 'is', value: v } as Operation
        }
      }
      return c.fail('isVal: (null, not_null, true, false, unknown)')
    }) ??
    c.try(() => {
      c.expect('isdistinct')
      c.expect('.')
      return { kind: 'isdistinct', value: singleVal(c) } as Operation
    }) ??
    c.try(() => {
      // phfts/plfts before fts so the longest name wins.
      const op = [...FTS_OPS].sort((a, b) => b.length - a.length).find((o) => c.startsWith(o))
      if (!op) c.fail('fts')
      c.pos += op.length
      let lang: string | null = null
      if (c.peek() === '(') {
        c.pos++
        lang = identifier(c)
        c.expect(')')
      }
      c.expect('.')
      return { kind: 'fts', op, lang, value: singleVal(c) } as Operation
    }) ??
    c.try(() => {
      const op = SIMPLE_OPS.find((o) => c.startsWith(o + '.'))
      if (!op) c.fail('simple op')
      c.pos += op.length + 1
      return { kind: 'op', op, value: singleVal(c) } as Operation
    }) ??
    c.try(() => {
      let op: QuantOp | null = null
      for (const o of QUANT_OPS) {
        const ok = c.try(() => {
          c.expect(o)
          if (c.peek() !== '.' && c.peek() !== '(') c.fail('x')
          return true
        })
        if (ok) {
          op = o
          break
        }
      }
      if (!op) c.fail('expecting operator (eq, gt, ...)')
      let quant: 'any' | 'all' | null = null
      if (c.peek() === '(') {
        const q = c.try(() => {
          c.expect('(')
          const v = c.eat('any') ? 'any' : c.eat('all') ? 'all' : c.fail('quant')
          c.expect(')')
          return v as 'any' | 'all'
        })
        quant = q
      }
      c.expect('.')
      return { kind: 'quant', op, quant, value: singleVal(c) } as Operation
    })
  if (!operation) c.fail('expecting operator (eq, gt, ...)')
  return { not, operation }
}

const restOfInput = (c: Cursor) => {
  const v = c.src.slice(c.pos)
  c.pos = c.src.length
  return v
}

function logicSingleVal(c: Cursor): string {
  const quoted = c.try(() => {
    const v = quotedValue(c)
    if (!(c.done || c.peek() === ',' || c.peek() === ')')) c.fail('x')
    return v
  })
  if (quoted !== null) return quoted
  const arr = c.try(() => {
    const start = c.pos
    c.expect('{')
    while (!c.done && c.peek() !== '{' && c.peek() !== '}') c.pos++
    c.expect('}')
    return c.src.slice(start, c.pos)
  })
  if (arr !== null) return arr
  const start = c.pos
  while (!c.done && c.peek() !== ',' && c.peek() !== ')') c.pos++
  return c.src.slice(start, c.pos)
}

function logicTree(c: Cursor): LogicTree {
  const stmt = c.try(() => {
    const fld = field(c)
    c.expect('.')
    const expr = opExpr(c, logicSingleVal)
    return { type: 'stmt', filter: { field: fld, expr, raw: '' } } as LogicTree
  })
  if (stmt) return stmt
  const not = c.try(() => {
    c.expect('not')
    c.expect('.')
    return true
  }) ?? false
  const op = c.eat('and') ? 'and' : c.eat('or') ? 'or' : c.fail('expecting logic operator (and, or)')
  c.ws()
  c.expect('(')
  c.ws()
  const children = [logicTree(c)]
  while (true) {
    c.ws()
    if (!c.eat(',')) break
    c.ws()
    children.push(logicTree(c))
  }
  c.ws()
  c.expect(')')
  c.ws()
  return { type: 'expr', not, op, children }
}

function treePath(c: Cursor): { path: string[]; field: Field } {
  const names = [fieldName(c)]
  while (c.eat('.')) names.push(fieldName(c))
  const path = jsonPath(c)
  return { path: names.slice(0, -1), field: { name: names[names.length - 1], path } }
}

function orderTerms(c: Cursor): OrderTerm[] {
  const terms: OrderTerm[] = []
  const end = () => {
    if (!(c.done || c.peek() === ',')) c.fail(`unexpected "${c.peek()}"`)
  }
  const suffix = (): Pick<OrderTerm, 'dir' | 'nulls'> => {
    let dir: OrderTerm['dir'] = null
    let nulls: OrderTerm['nulls'] = null
    if (c.startsWith('.asc')) {
      c.pos += 4
      dir = 'asc'
    } else if (c.startsWith('.desc')) {
      c.pos += 5
      dir = 'desc'
    }
    if (c.startsWith('.nullsfirst')) {
      c.pos += 11
      nulls = 'first'
    } else if (c.startsWith('.nullslast')) {
      c.pos += 10
      nulls = 'last'
    }
    end()
    return { dir, nulls }
  }
  const term = (): OrderTerm => {
    c.ws()
    const rel = c.try(() => {
      const name = fieldName(c)
      c.expect('(')
      const fld = field(c)
      c.expect(')')
      return { relation: name, field: fld, ...suffix() }
    })
    if (rel) return rel
    const fld = field(c)
    const t = { relation: null, field: fld, ...suffix() }
    c.ws()
    return t
  }
  terms.push(term())
  while (c.eat(',')) terms.push(term())
  return terms
}

function columnsList(c: Cursor): string[] {
  const cols = [fieldName(c)]
  while (true) {
    c.ws()
    if (!c.eat(',')) break
    c.ws()
    cols.push(fieldName(c))
  }
  if (!c.done) c.fail(`unexpected "${c.peek()}"`)
  return cols
}

const RESERVED = new Set(['select', 'columns', 'on_conflict'])
const RESERVED_EMBEDDABLE = new Set(['order', 'limit', 'offset', 'and', 'or'])

const lastWord = (k: string) => k.split('.').pop() ?? ''

export function parseQueryParams(search: URLSearchParams, isRpcRead: boolean): QueryParams {
  const all = [...search.entries()]
  const nonEmpty = all.filter(([, v]) => v !== '')
  const lookup = (k: string) => {
    const hit = all.find(([key]) => key === k)
    return hit ? hit[1] : null
  }

  const selectSrc = lookup('select') ?? '*'
  const select = parseSelect(selectSrc)

  const order: QueryParams['order'] = nonEmpty
    .filter(([k]) => lastWord(k) === 'order')
    .map(([k, v]) => {
      const path = runParser(k, `failed to parse tree path (${k})`, (c) => treePath(c))
      const terms = runParser(v, `failed to parse order (${v})`, (c) => orderTerms(c))
      return [[...path.path, path.field.name].slice(0, -1), terms]
    })

  const logic: QueryParams['logic'] = nonEmpty
    .filter(([k]) => ['and', 'or'].includes(lastWord(k)))
    .map(([k, v]) => {
      const parts = runParser(k, `failed to parse logic path (${k})`, (c) => {
        const names = [fieldName(c)]
        while (c.eat('.')) names.push(fieldName(c))
        return names
      })
      const op = parts[parts.length - 1]
      const isNot = parts.slice(0, -1).includes('not')
      const path = parts.slice(0, -1).filter((p) => p !== 'not')
      const tree = runParser((isNot ? 'not.' : '') + op + v, `failed to parse logic tree (${v})`, (c) => {
        const t = logicTree(c)
        if (!c.done) c.fail(`unexpected "${c.peek()}"`)
        return t
      })
      return [path, tree]
    })

  const ranges = new Map<string, Range>()
  const limitFor = new Map<string, number | null>()
  const offsetFor = new Map<string, number>()
  for (const [k, v] of nonEmpty) {
    const w = lastWord(k)
    if (w !== 'limit' && w !== 'offset') continue
    const key = k.split('.').slice(0, -1).join('.')
    const n = /^-?\d+$/.test(v) ? Number(v) : null
    if (w === 'limit') limitFor.set(key, n !== null && n >= 0 ? n : null)
    else offsetFor.set(key, n !== null && n >= 0 ? n : 0)
  }
  for (const key of new Set([...limitFor.keys(), ...offsetFor.keys()])) {
    ranges.set(key, { offset: offsetFor.get(key) ?? 0, limit: limitFor.has(key) ? (limitFor.get(key) ?? null) : null })
  }

  const filterParams = nonEmpty.filter(([k]) => !RESERVED_EMBEDDABLE.has(lastWord(k)) && !RESERVED.has(k))
  const filters: QueryParams['filters'] = []
  const rpcArgs: Array<[string, string]> = []
  for (const [k, v] of filterParams) {
    const tp = runParser(k, `failed to parse tree path (${k})`, (c) => {
      const r = treePath(c)
      if (!c.done) c.fail(`unexpected "${c.peek()}"`)
      return r
    })
    let expr: OpExpr | null
    try {
      expr = runParser(v, `failed to parse filter (${v})`, (c) => opExpr(c, restOfInput))
    } catch (e) {
      if (!isRpcRead) throw e
      expr = null
    }
    if (expr === null) {
      rpcArgs.push([tp.field.name, v])
      continue
    }
    filters.push([tp.path, { field: tp.field, expr, raw: v }])
  }

  const columnsSrc = lookup('columns')
  const columns = columnsSrc === null ? null : runParser(columnsSrc, `failed to parse columns parameter (${columnsSrc})`, columnsList)
  const onConflictSrc = lookup('on_conflict')
  const onConflict =
    onConflictSrc === null ? null : runParser(onConflictSrc, `failed to parse on_conflict parameter (${onConflictSrc})`, columnsList)

  return {
    select,
    filters,
    logic,
    order,
    ranges,
    columns,
    onConflict,
    rpcArgs,
    filterFields: new Set(filterParams.map(([k]) => k)),
  }
}
