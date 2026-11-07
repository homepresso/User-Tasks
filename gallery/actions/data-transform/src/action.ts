/**
 * ut_data — Data transform: JSON path selection, mapping, filtering, sorting,
 * grouping with aggregates, pivot / unpivot, de-duplication, joins and CSV
 * conversion for lists of objects. Pure computation.
 */

import { defineAction } from '@usertasks/action'
import { bool, choice, clean, getPath, isPlainObject, json, list, str, strList, text, toNumber, type Inputs } from '../../shared/inputs'
import { csvField, inferValue, parseCsv, sniffDelimiter } from './csv'

type Row = Record<string, unknown>
const MAX_ITEMS = 100_000

function rows(inputs: Inputs, name = 'items'): Row[] {
  const raw = list(inputs, name, { required: true })
  if (raw.length > MAX_ITEMS) throw new Error(`${name}: at most ${MAX_ITEMS} items`)
  return raw.map((item, i) => {
    if (!isPlainObject(item)) throw new Error(`${name}[${i}] is not an object (expected a list of objects)`)
    return item
  })
}

/** Set a value at a dotted path, creating objects on the way. */
function setPath(target: Row, path: string, value: unknown): void {
  const parts = path.split('.')
  let cur: Row = target
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]]
    if (!isPlainObject(next)) cur[parts[i]] = {}
    cur = cur[parts[i]] as Row
  }
  cur[parts[parts.length - 1]] = value
}

// ── JSON path ───────────────────────────────────────────────────────────────

type Seg = { kind: 'key'; key: string } | { kind: 'index'; index: number } | { kind: 'all' }

function parsePath(path: string): Seg[] {
  let p = path.trim()
  if (p === '$' || p === '') return []
  if (p.startsWith('$.')) p = p.slice(2)
  else if (p.startsWith('$[')) p = p.slice(1)
  const segs: Seg[] = []
  const re = /\.?([^.[\]]+)|\[(\*|-?\d+)\]|\[(?:"([^"]*)"|'([^']*)')\]/gy
  let m: RegExpExecArray | null
  let last = 0
  while (last < p.length && (m = re.exec(p))) {
    last = re.lastIndex
    if (m[1] !== undefined) segs.push(m[1] === '*' ? { kind: 'all' } : { kind: 'key', key: m[1] })
    else if (m[2] !== undefined) segs.push(m[2] === '*' ? { kind: 'all' } : { kind: 'index', index: Number(m[2]) })
    else segs.push({ kind: 'key', key: m[3] ?? m[4] ?? '' })
  }
  if (last !== p.length) throw new Error(`path "${path}" is not valid near "${p.slice(last, last + 15)}"`)
  return segs
}

function selectPath(source: unknown, path: string): { values: unknown[]; wildcard: boolean } {
  const segs = parsePath(path)
  let current: unknown[] = [source]
  let wildcard = false
  for (const seg of segs) {
    const next: unknown[] = []
    for (const v of current) {
      if (seg.kind === 'all') {
        if (Array.isArray(v)) next.push(...v)
        else if (isPlainObject(v)) next.push(...Object.values(v))
      } else if (seg.kind === 'index') {
        if (Array.isArray(v)) {
          const item = v[seg.index < 0 ? v.length + seg.index : seg.index]
          if (item !== undefined) next.push(item)
        }
      } else if ((isPlainObject(v) || Array.isArray(v)) && Object.prototype.hasOwnProperty.call(v, seg.key)) {
        next.push((v as Row)[seg.key])
      }
    }
    if (seg.kind === 'all') wildcard = true
    current = next
  }
  return { values: current, wildcard }
}

// ── Comparison ──────────────────────────────────────────────────────────────

const numeric = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = toNumber(v)
    return n !== null && Number.isFinite(n) ? n : null
  }
  return null
}

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0) || (isPlainObject(v) && Object.keys(v).length === 0)

const asText = (v: unknown, caseSensitive: boolean) => {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return caseSensitive ? s : s.toLowerCase()
}

type SortType = 'auto' | 'number' | 'text' | 'date'

function compareValues(a: unknown, b: unknown, type: SortType = 'auto'): number {
  const ae = isEmpty(a)
  const be = isEmpty(b)
  if (ae || be) return ae && be ? 0 : ae ? 1 : -1
  if (type === 'number' || type === 'auto') {
    const x = numeric(a)
    const y = numeric(b)
    if (x !== null && y !== null) return x - y
    if (type === 'number') return x === null ? (y === null ? 0 : 1) : -1
  }
  if (type === 'date') {
    const x = Date.parse(String(a))
    const y = Date.parse(String(b))
    if (!Number.isNaN(x) && !Number.isNaN(y)) return x - y
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  const x = asText(a, false)
  const y = asText(b, false)
  return x < y ? -1 : x > y ? 1 : 0
}

const OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains', 'starts_with', 'ends_with', 'in', 'not_in', 'empty', 'not_empty'] as const
type Operator = (typeof OPERATORS)[number]
const OPERATOR_ALIASES: Record<string, Operator> = {
  '=': 'eq', '==': 'eq', equals: 'eq', '!=': 'ne', '<>': 'ne', not_equals: 'ne', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte',
  is_empty: 'empty', is_not_empty: 'not_empty',
}

interface Condition { field: string; operator: Operator; value: unknown }

function parseConditions(inputs: Inputs): Condition[] {
  return list(inputs, 'conditions', { required: true }).map((c, i) => {
    if (!isPlainObject(c)) throw new Error(`conditions[${i}] must be an object like { "field": "status", "operator": "eq", "value": "open" }`)
    const field = String(c.field ?? '').trim()
    if (!field) throw new Error(`conditions[${i}].field is required`)
    const rawOp = String(c.operator ?? 'eq').trim().toLowerCase()
    const operator = (OPERATORS as readonly string[]).includes(rawOp) ? rawOp as Operator : OPERATOR_ALIASES[rawOp]
    if (!operator) throw new Error(`conditions[${i}].operator must be one of ${OPERATORS.join(', ')}`)
    return { field, operator, value: c.value }
  })
}

function listOf(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return v.split(',').map((s) => s.trim())
  return [v]
}

function test(row: Row, c: Condition, caseSensitive: boolean): boolean {
  const actual = getPath(row, c.field)
  const eq = (a: unknown, b: unknown) => {
    const x = numeric(a)
    const y = numeric(b)
    if (x !== null && y !== null) return x === y
    if (isEmpty(a) && isEmpty(b)) return true
    return asText(a, caseSensitive) === asText(b, caseSensitive)
  }
  switch (c.operator) {
    case 'eq': return eq(actual, c.value)
    case 'ne': return !eq(actual, c.value)
    case 'gt': return !isEmpty(actual) && compareValues(actual, c.value) > 0
    case 'gte': return !isEmpty(actual) && compareValues(actual, c.value) >= 0
    case 'lt': return !isEmpty(actual) && compareValues(actual, c.value) < 0
    case 'lte': return !isEmpty(actual) && compareValues(actual, c.value) <= 0
    case 'contains':
    case 'not_contains': {
      const has = Array.isArray(actual) ? actual.some((v) => eq(v, c.value)) : asText(actual, caseSensitive).includes(asText(c.value, caseSensitive))
      return c.operator === 'contains' ? has : !has
    }
    case 'starts_with': return asText(actual, caseSensitive).startsWith(asText(c.value, caseSensitive))
    case 'ends_with': return asText(actual, caseSensitive).endsWith(asText(c.value, caseSensitive))
    case 'in': return listOf(c.value).some((v) => eq(actual, v))
    case 'not_in': return !listOf(c.value).some((v) => eq(actual, v))
    case 'empty': return isEmpty(actual)
    case 'not_empty': return !isEmpty(actual)
  }
}

// ── Aggregates ──────────────────────────────────────────────────────────────

const AGG_OPS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'first', 'last', 'list'] as const
type AggOp = (typeof AGG_OPS)[number]
interface Aggregate { op: AggOp; field: string; as: string }

function parseAggregates(inputs: Inputs): Aggregate[] {
  const raw = list(inputs, 'aggregates')
  const out = raw.map((a, i) => {
    let op = ''
    let field = ''
    let as = ''
    if (isPlainObject(a)) {
      op = String(a.op ?? a.operation ?? a.function ?? '').trim().toLowerCase()
      field = String(a.field ?? '').trim()
      as = String(a.as ?? a.name ?? '').trim()
    } else {
      // "sum:amount", "sum(amount)", "sum(amount) as total", "count".
      const m = /^\s*([a-z_]+)\s*(?:[:(]\s*([^)\s]+?)\s*\)?)?\s*(?:as\s+(\S+))?\s*$/i.exec(String(a))
      if (!m) throw new Error(`aggregates[${i}]: write it as op:field (sum:amount) or { "op": "sum", "field": "amount" }`)
      op = m[1].toLowerCase()
      field = m[2] ?? ''
      as = m[3] ?? ''
    }
    if (op === 'average' || op === 'mean') op = 'avg'
    if (!(AGG_OPS as readonly string[]).includes(op)) throw new Error(`aggregates[${i}]: op must be one of ${AGG_OPS.join(', ')}`)
    if (op !== 'count' && !field) throw new Error(`aggregates[${i}]: ${op} needs a field`)
    return { op: op as AggOp, field, as: as || (op === 'count' && !field ? 'count' : `${op}_${field.replace(/\W+/g, '_')}`) }
  })
  return out
}

function aggregate(group: Row[], agg: Aggregate): unknown {
  const values = agg.field ? group.map((r) => getPath(r, agg.field)) : group
  const present = values.filter((v) => !isEmpty(v))
  switch (agg.op) {
    case 'count': return agg.field ? present.length : group.length
    case 'count_distinct': return new Set(present.map((v) => JSON.stringify(v))).size
    case 'first': return values.find((v) => v !== undefined) ?? null
    case 'last': return [...values].reverse().find((v) => v !== undefined) ?? null
    case 'list': return present
    default: {
      const nums = present.map((v) => numeric(v)).filter((n): n is number => n !== null)
      if (agg.op === 'sum') return clean(nums.reduce((s, n) => s + n, 0))
      if (nums.length === 0) return null
      if (agg.op === 'avg') return clean(nums.reduce((s, n) => s + n, 0) / nums.length)
      if (agg.op === 'min') return Math.min(...nums)
      return Math.max(...nums)
    }
  }
}

const keyOf = (row: Row, fields: string[], caseSensitive = true) => JSON.stringify(fields.map((f) => {
  const v = getPath(row, f)
  return typeof v === 'string' && !caseSensitive ? v.toLowerCase() : v ?? null
}))

// ── Operations ──────────────────────────────────────────────────────────────

export default defineAction({
  operations: {
    select(inputs: Inputs) {
      const data = json(inputs, 'data')
      const path = str(inputs, 'path', { required: true })
      const { values, wildcard } = selectPath(data, path)
      const value = wildcard ? values : values.length ? values[0] : null
      return { value: value === undefined ? null : value, values, found: values.length > 0, count: values.length }
    },

    map(inputs: Inputs) {
      const items = rows(inputs)
      const keepOther = bool(inputs, 'keep_other_fields', false)
      const specs = list(inputs, 'fields', { required: true }).map((spec, i) => {
        if (isPlainObject(spec)) {
          const from = String(spec.from ?? spec.field ?? '').trim()
          if (!from) throw new Error(`fields[${i}].from is required`)
          return { from, to: String(spec.to ?? spec.as ?? from).trim(), dflt: spec.default }
        }
        const m = /^\s*(.+?)\s+(?:as|->|=>)\s+(.+?)\s*$/i.exec(String(spec))
        const from = (m ? m[1] : String(spec)).trim()
        if (!from) throw new Error(`fields[${i}] is empty`)
        return { from, to: (m ? m[2] : from).trim(), dflt: undefined as unknown }
      })
      const out = items.map((row) => {
        const next: Row = keepOther ? { ...row } : {}
        for (const s of specs) {
          if (keepOther && s.from !== s.to && Object.prototype.hasOwnProperty.call(next, s.from)) delete next[s.from]
          const v = getPath(row, s.from)
          setPath(next, s.to, v === undefined ? (s.dflt ?? null) : v)
        }
        return next
      })
      return { items: out, count: out.length }
    },

    filter(inputs: Inputs) {
      const items = rows(inputs)
      const conditions = parseConditions(inputs)
      const combine = choice(inputs, 'combine', ['all', 'any'] as const, 'all')
      const caseSensitive = bool(inputs, 'case_sensitive', false)
      const kept = items.filter((row) => (combine === 'all' ? conditions.every((c) => test(row, c, caseSensitive)) : conditions.some((c) => test(row, c, caseSensitive))))
      return { items: kept, count: kept.length, removed: items.length - kept.length }
    },

    sort(inputs: Inputs) {
      const items = rows(inputs)
      const keys = list(inputs, 'keys', { required: true }).map((k, i) => {
        let field = ''
        let direction = 'asc'
        let type = 'auto'
        if (isPlainObject(k)) {
          field = String(k.field ?? '').trim()
          direction = String(k.direction ?? 'asc').toLowerCase()
          type = String(k.type ?? 'auto').toLowerCase()
        } else {
          const parts = String(k).trim().split(/\s+/)
          field = parts[0] ?? ''
          if (field.startsWith('-')) { field = field.slice(1); direction = 'desc' }
          if (parts[1]) direction = parts[1].toLowerCase()
          if (parts[2]) type = parts[2].toLowerCase()
        }
        if (!field) throw new Error(`keys[${i}]: a field is required`)
        if (direction !== 'asc' && direction !== 'desc') throw new Error(`keys[${i}]: direction must be asc or desc`)
        if (!['auto', 'number', 'text', 'date'].includes(type)) throw new Error(`keys[${i}]: type must be auto, number, text or date`)
        return { field, desc: direction === 'desc', type: type as SortType }
      })
      const indexed = items.map((row, i) => ({ row, i }))
      indexed.sort((a, b) => {
        for (const k of keys) {
          const av = getPath(a.row, k.field)
          const bv = getPath(b.row, k.field)
          // Empty values always sort last.
          if (isEmpty(av) || isEmpty(bv)) {
            const c = compareValues(av, bv)
            if (c !== 0) return c
            continue
          }
          const c = k.type === 'text' ? compareValues(asText(av, false), asText(bv, false), 'text') : compareValues(av, bv, k.type)
          if (c !== 0) return k.desc ? -c : c
        }
        return a.i - b.i
      })
      return { items: indexed.map((x) => x.row), count: indexed.length }
    },

    group(inputs: Inputs) {
      const items = rows(inputs)
      const by = strList(inputs, 'group_by', { required: true })
      const aggs = parseAggregates(inputs)
      const groups = new Map<string, Row[]>()
      for (const row of items) {
        const key = keyOf(row, by)
        const g = groups.get(key)
        if (g) g.push(row)
        else groups.set(key, [row])
      }
      const out = [...groups.values()].map((g) => {
        const row: Row = {}
        for (const f of by) setPath(row, f, getPath(g[0], f) ?? null)
        if (!aggs.some((a) => a.as === 'count')) row.count = g.length
        for (const a of aggs) row[a.as] = aggregate(g, a)
        return row
      })
      return { groups: out, count: out.length }
    },

    pivot(inputs: Inputs) {
      const items = rows(inputs)
      const rowFields = strList(inputs, 'rows', { required: true })
      const column = str(inputs, 'column', { required: true })
      const valueField = str(inputs, 'value')
      const op = choice(inputs, 'aggregate', ['sum', 'count', 'avg', 'min', 'max', 'first', 'last'] as const, 'sum')
      if (op !== 'count' && !valueField) throw new Error(`value is required for ${op}`)
      const fill = inputs.fill === undefined ? null : json(inputs, 'fill')
      const columns: string[] = []
      const table = new Map<string, { first: Row; cells: Map<string, Row[]> }>()
      for (const row of items) {
        const raw = getPath(row, column)
        const col = isEmpty(raw) ? '(blank)' : asText(raw, true)
        if (!columns.includes(col)) columns.push(col)
        const key = keyOf(row, rowFields)
        let entry = table.get(key)
        if (!entry) {
          entry = { first: row, cells: new Map() }
          table.set(key, entry)
        }
        const cell = entry.cells.get(col)
        if (cell) cell.push(row)
        else entry.cells.set(col, [row])
      }
      const agg: Aggregate = { op, field: op === 'count' ? '' : valueField, as: 'v' }
      const out = [...table.values()].map(({ first, cells }) => {
        const row: Row = {}
        for (const f of rowFields) setPath(row, f, getPath(first, f) ?? null)
        for (const col of columns) {
          const cell = cells.get(col)
          row[col] = cell ? aggregate(cell, agg) : fill
        }
        return row
      })
      return { items: out, columns, count: out.length }
    },

    unpivot(inputs: Inputs) {
      const items = rows(inputs)
      const keep = strList(inputs, 'keep_fields')
      const only = strList(inputs, 'columns')
      const nameField = str(inputs, 'name_field', { default: 'name' })
      const valueField = str(inputs, 'value_field', { default: 'value' })
      const skipEmpty = bool(inputs, 'skip_empty', false)
      if (nameField === valueField) throw new Error('name_field and value_field must differ')
      const out: Row[] = []
      for (const row of items) {
        const cols = only.length ? only : Object.keys(row).filter((k) => !keep.includes(k))
        for (const col of cols) {
          const v = getPath(row, col)
          if (skipEmpty && isEmpty(v)) continue
          const next: Row = {}
          for (const k of keep) setPath(next, k, getPath(row, k) ?? null)
          next[nameField] = col
          next[valueField] = v === undefined ? null : v
          out.push(next)
        }
      }
      return { items: out, count: out.length }
    },

    dedupe(inputs: Inputs) {
      const items = list(inputs, 'items', { required: true })
      if (items.length > MAX_ITEMS) throw new Error(`items: at most ${MAX_ITEMS} items`)
      const fields = strList(inputs, 'fields')
      const keep = choice(inputs, 'keep', ['first', 'last'] as const, 'first')
      const caseSensitive = bool(inputs, 'case_sensitive', true)
      const keyFor = (item: unknown) => {
        if (fields.length && isPlainObject(item)) return keyOf(item, fields, caseSensitive)
        const s = JSON.stringify(item ?? null)
        return caseSensitive ? s : s.toLowerCase()
      }
      const seen = new Map<string, number>()
      items.forEach((item, i) => {
        const k = keyFor(item)
        if (keep === 'last' || !seen.has(k)) seen.set(k, i)
      })
      const keepIdx = new Set(seen.values())
      const out = items.filter((_, i) => keepIdx.has(i))
      return { items: out, count: out.length, removed: items.length - out.length }
    },

    join(inputs: Inputs) {
      const left = rows(inputs, 'left')
      const right = rows(inputs, 'right')
      const leftKeys = strList(inputs, 'left_key', { required: true })
      const rightKeysRaw = strList(inputs, 'right_key')
      const rightKeys = rightKeysRaw.length ? rightKeysRaw : leftKeys
      if (leftKeys.length !== rightKeys.length) throw new Error('left_key and right_key must name the same number of fields')
      const type = choice(inputs, 'type', ['inner', 'left', 'right', 'full'] as const, 'inner')
      const prefix = str(inputs, 'right_prefix')
      const caseSensitive = bool(inputs, 'case_sensitive', true)
      const norm = (row: Row, keys: string[]) => JSON.stringify(keys.map((k) => {
        const v = getPath(row, k)
        if (v === null || v === undefined) return null
        const s = typeof v === 'number' ? String(v) : asText(v, caseSensitive)
        return s
      }))
      const index = new Map<string, number[]>()
      right.forEach((r, i) => {
        const k = norm(r, rightKeys)
        const list = index.get(k)
        if (list) list.push(i)
        else index.set(k, [i])
      })
      const leftFields = new Set<string>()
      for (const l of left) for (const k of Object.keys(l)) leftFields.add(k)
      const merge = (l: Row | null, r: Row | null): Row => {
        const out: Row = l ? { ...l } : {}
        if (!l && r) rightKeys.forEach((rk, i) => { out[leftKeys[i]] = getPath(r, rk) ?? null })
        if (r) {
          for (const [k, v] of Object.entries(r)) {
            if (!prefix && rightKeys.includes(k) && leftKeys[rightKeys.indexOf(k)] === k) continue
            const name = prefix ? `${prefix}${k}` : leftFields.has(k) ? `right_${k}` : k
            out[name] = v
          }
        }
        return out
      }
      const out: Row[] = []
      const usedRight = new Set<number>()
      let unmatchedLeft = 0
      for (const l of left) {
        const k = norm(l, leftKeys)
        const hasKey = !JSON.parse(k).every((v: unknown) => v === null)
        const matches = hasKey ? index.get(k) ?? [] : []
        if (matches.length) {
          for (const i of matches) {
            usedRight.add(i)
            out.push(merge(l, right[i]))
          }
        } else {
          unmatchedLeft++
          if (type === 'left' || type === 'full') out.push(merge(l, null))
        }
      }
      const unmatchedRight = right.length - usedRight.size
      if (type === 'right' || type === 'full') {
        right.forEach((r, i) => {
          if (!usedRight.has(i)) out.push(merge(null, r))
        })
      }
      return { items: out, count: out.length, unmatched_left: unmatchedLeft, unmatched_right: unmatchedRight }
    },

    csv_to_json(inputs: Inputs) {
      const csv = text(inputs, 'csv', { required: true, max: 5_000_000 })
      const rawDelim = str(inputs, 'delimiter', { default: 'auto', trim: false })
      const named: Record<string, string> = { auto: '', comma: ',', semicolon: ';', tab: '\t', '\\t': '\t', pipe: '|' }
      let delimiter = rawDelim in named ? named[rawDelim] : rawDelim
      if (!delimiter) delimiter = sniffDelimiter(csv)
      if (delimiter.length > 3 || /["\r\n]/.test(delimiter)) throw new Error('delimiter must be 1–3 characters other than quotes and line breaks')
      const header = bool(inputs, 'header', true)
      const infer = bool(inputs, 'infer_types', true)
      const trim = bool(inputs, 'trim', true)
      let table = parseCsv(csv, delimiter)
      table = table.filter((r) => !(r.length === 1 && r[0].trim() === ''))
      if (table.length > MAX_ITEMS + 1) throw new Error(`The CSV has more than ${MAX_ITEMS} rows`)
      const width = table.reduce((w, r) => Math.max(w, r.length), 0)
      let columns: string[]
      if (header && table.length) {
        const seen = new Map<string, number>()
        columns = Array.from({ length: width }, (_, i) => {
          let name = (table[0][i] ?? '').trim() || `column_${i + 1}`
          const n = seen.get(name) ?? 0
          seen.set(name, n + 1)
          if (n) name = `${name}_${n + 1}`
          return name
        })
        table = table.slice(1)
      } else {
        columns = Array.from({ length: width }, (_, i) => `column_${i + 1}`)
      }
      const items = table.map((r) => {
        const row: Row = {}
        columns.forEach((c, i) => {
          let cell = r[i] ?? ''
          if (trim) cell = cell.trim()
          row[c] = infer ? inferValue(cell) : cell
        })
        return row
      })
      return { items, columns, count: items.length }
    },

    json_to_csv(inputs: Inputs) {
      const items = rows(inputs)
      const delimiterRaw = str(inputs, 'delimiter', { default: ',', trim: false })
      const delimiter = delimiterRaw === 'tab' || delimiterRaw === '\\t' ? '\t' : delimiterRaw
      if (!delimiter || delimiter.length > 3 || /["\r\n]/.test(delimiter)) throw new Error('delimiter must be 1–3 characters other than quotes and line breaks')
      const header = bool(inputs, 'header', true)
      const eol = choice(inputs, 'line_ending', ['crlf', 'lf'] as const, 'crlf') === 'crlf' ? '\r\n' : '\n'
      const escapeFormulas = bool(inputs, 'escape_formulas', true)
      const specs = strList(inputs, 'columns').map((c) => {
        const m = /^\s*(.+?)\s+as\s+(.+?)\s*$/i.exec(c)
        return m ? { field: m[1], title: m[2] } : { field: c, title: c }
      })
      if (!specs.length) {
        const seen: string[] = []
        for (const row of items) for (const k of Object.keys(row)) if (!seen.includes(k)) seen.push(k)
        specs.push(...seen.map((k) => ({ field: k, title: k })))
      }
      const lines: string[] = []
      if (header) lines.push(specs.map((s) => csvField(s.title, delimiter, false)).join(delimiter))
      for (const row of items) lines.push(specs.map((s) => csvField(getPath(row, s.field), delimiter, escapeFormulas)).join(delimiter))
      return { csv: lines.length ? lines.join(eol) + eol : '', columns: specs.map((s) => s.title), count: items.length }
    },
  },
})
