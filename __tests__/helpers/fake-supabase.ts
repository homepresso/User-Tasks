/**
 * Minimal in-memory Supabase client for engine tests: tables of plain rows,
 * the PostgREST-style builder calls the engine uses (select/insert/upsert/
 * update/delete + eq/in/neq/is/ilike/contains/order/limit +
 * single/maybeSingle; eq also on a
 * JSON path like `col->a->>b`), and pluggable RPCs.
 * Every request is recorded in `calls` so tests can count round trips.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>
type Filter = (row: Row) => boolean
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number }

interface QueryBuilder extends PromiseLike<Result> {
  select(cols?: string, opts?: { head?: boolean; count?: string }): QueryBuilder
  insert(rows: unknown): QueryBuilder
  upsert(rows: unknown, opts?: { onConflict?: string }): QueryBuilder
  update(patch: unknown): QueryBuilder
  delete(): QueryBuilder
  eq(col: string, val: unknown): QueryBuilder
  neq(col: string, val: unknown): QueryBuilder
  in(col: string, vals: unknown[]): QueryBuilder
  is(col: string, val: unknown): QueryBuilder
  ilike(col: string, pattern: string): QueryBuilder
  contains(col: string, val: unknown): QueryBuilder
  order(...args: unknown[]): QueryBuilder
  limit(n: number): QueryBuilder
  single(): Promise<Result>
  maybeSingle(): Promise<Result>
}

export interface FakeCall {
  table?: string
  rpc?: string
  op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' | 'rpc'
  args?: unknown
}

export interface FakeSupabase {
  client: SupabaseClient
  tables: Record<string, Row[]>
  calls: FakeCall[]
  rpcs: Record<string, (args: Record<string, unknown>) => { data?: unknown; error?: { message: string; code?: string } | null }>
  count: (table: string, op?: FakeCall['op']) => number
}

/** A column or a JSON path (`col->key->>leaf`, the last ->> compares as text). */
function columnValue(row: Row, col: string): unknown {
  if (!col.includes('->')) return row[col]
  const [head, ...keys] = col.split(/->>?/)
  let value: unknown = row[head]
  for (const key of keys) value = value && typeof value === 'object' ? (value as Row)[key] : undefined
  return col.includes('->>') && value !== undefined && value !== null ? String(value) : value
}

/** jsonb @> containment. */
function containsValue(have: unknown, want: unknown): boolean {
  if (Array.isArray(want)) return Array.isArray(have) && want.every((w) => have.some((h) => containsValue(h, w)))
  if (want && typeof want === 'object') {
    return !!have && typeof have === 'object' && Object.entries(want as Row).every(([k, v]) => containsValue((have as Row)[k], v))
  }
  return have === want
}

let idCounter = 0
const newId = () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`

export function createFakeSupabase(seed: Record<string, Row[]> = {}): FakeSupabase {
  const tables: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }))
  const calls: FakeCall[] = []
  const rpcs: FakeSupabase['rpcs'] = {}

  function builder(table: string): QueryBuilder {
    let op: FakeCall['op'] = 'select'
    let payload: unknown
    let selectAfterWrite = false
    const filters: Filter[] = []
    let limitN: number | undefined
    let mode: 'many' | 'single' | 'maybeSingle' = 'many'
    let head = false
    let conflictCols: string[] = ['id']

    const rowsOf = () => (tables[table] ??= [])
    const run = (): Result => {
      calls.push({ table, op, args: payload })
      const all = rowsOf()
      if (op === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[]
        const inserted = list.map((r) => ({ id: r.id ?? newId(), ...r }))
        all.push(...inserted)
        return shape(selectAfterWrite ? inserted : null)
      }
      if (op === 'upsert') {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[]
        const out: Row[] = []
        for (const r of list) {
          const hit = all.find((e) => conflictCols.every((c) => r[c] !== undefined && e[c] === r[c]))
          if (hit) { Object.assign(hit, r); out.push(hit) } else { const row = { id: r.id ?? newId(), ...r }; all.push(row); out.push(row) }
        }
        return shape(selectAfterWrite ? out.map((r) => structuredClone(r)) : null)
      }
      const matched = all.filter((r) => filters.every((f) => f(r)))
      if (op === 'update') {
        for (const r of matched) Object.assign(r, payload as Row)
        // A snapshot, like PostgREST's RETURNING (later writes don't show through).
        return shape(selectAfterWrite ? matched.map((r) => structuredClone(r)) : null)
      }
      if (op === 'delete') {
        tables[table] = all.filter((r) => !matched.includes(r))
        return shape(null)
      }
      const limited = limitN === undefined ? matched : matched.slice(0, limitN)
      if (head) return { data: null, error: null, count: matched.length }
      return shape(limited.map((r) => structuredClone(r)))
    }
    const shape = (rows: Row[] | null): Result => {
      if (mode === 'many') return { data: rows, error: null }
      const list = rows ?? []
      if (list.length === 0) {
        return mode === 'single'
          ? { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } }
          : { data: null, error: null }
      }
      return { data: list[0], error: null }
    }

    const api: QueryBuilder = {
      select(_cols?: string, opts?: { head?: boolean }) {
        if (op !== 'select') selectAfterWrite = true
        if (opts?.head) head = true
        return api
      },
      insert(rows: unknown) { op = 'insert'; payload = rows; return api },
      upsert(rows: unknown, opts?: { onConflict?: string }) {
        op = 'upsert'; payload = rows
        if (opts?.onConflict) conflictCols = opts.onConflict.split(',').map((c) => c.trim())
        return api
      },
      update(patch: unknown) { op = 'update'; payload = patch; return api },
      delete() { op = 'delete'; return api },
      eq(col: string, val: unknown) { filters.push((r) => columnValue(r, col) === val); return api },
      neq(col: string, val: unknown) { filters.push((r) => r[col] !== val); return api },
      in(col: string, vals: unknown[]) { filters.push((r) => vals.includes(r[col])); return api },
      is(col: string, val: unknown) { filters.push((r) => (r[col] ?? null) === val); return api },
      ilike(col: string, pattern: string) {
        const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i')
        filters.push((r) => re.test(String(r[col] ?? '')))
        return api
      },
      contains(col: string, val: unknown) { filters.push((r) => containsValue(r[col], val)); return api },
      order() { return api },
      limit(n: number) { limitN = n; return api },
      single() { mode = 'single'; return Promise.resolve(run()) },
      maybeSingle() { mode = 'maybeSingle'; return Promise.resolve(run()) },
      then(resolve, reject) {
        return Promise.resolve(run()).then(resolve, reject)
      },
    }
    return api
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ rpc: name, op: 'rpc', args })
      const handler = rpcs[name]
      if (!handler) return { data: null, error: { message: `Could not find the function public.${name}`, code: 'PGRST202' } }
      const out = handler(args)
      return { data: out.data ?? null, error: out.error ?? null }
    },
  }

  return {
    client: client as unknown as SupabaseClient,
    tables,
    calls,
    rpcs,
    count: (table, op) => calls.filter((c) => c.table === table && (!op || c.op === op)).length,
  }
}
