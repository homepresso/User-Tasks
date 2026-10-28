/**
 * Minimal in-memory Supabase/PostgREST stand-in for service tests.
 * Supports the builder calls the integration services use: select (with
 * count), eq / neq / gt / gte / lte / is / in / contains (arrays) / like / filter('a->>b','eq',v) / ilike / or (ignored),
 * order (stable, nulls last), limit, range, single, maybeSingle, insert / update / delete with
 * a trailing select. Embedded selects (`x:table(...)`) are not joined.
 * Every mutation is recorded in `calls` for assertions.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped table rows */

type Row = Record<string, any>
type Filter = (row: Row) => boolean

export interface MemoryCall { table: string; op: string; payload?: unknown }

export function createMemorySupabase(seed: Record<string, Row[]> = {}, options: { uuids?: boolean } = {}) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed))
  const calls: MemoryCall[] = []
  let nextId = 1
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? null))

  function builder(table: string) {
    const state = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete',
      conflict: undefined as string[] | undefined,
      payload: undefined as any,
      filters: [] as Filter[],
      single: false as false | 'single' | 'maybe',
      count: false,
      limit: undefined as number | undefined,
      range: undefined as [number, number] | undefined,
      order: [] as Array<{ field: string; ascending: boolean }>,
    }
    const rows = () => (tables[table] ??= [])
    const matches = () => rows().filter((row) => state.filters.every((f) => f(row)))

    const execute = () => {
      let data: any
      if (state.op === 'insert') {
        const items = (Array.isArray(state.payload) ? state.payload : [state.payload]).map((item: Row) => {
          // upsert(…, { onConflict }) replaces the row with the same key columns.
          if (state.conflict) {
            const existing = rows().find((row) => state.conflict!.every((col) => row[col] === item[col]))
            if (existing) return clone(Object.assign(existing, clone(item)))
          }
          const row = { id: item.id ?? (options.uuids ? crypto.randomUUID() : `${table}_${nextId++}`), ...clone(item) }
          rows().push(row)
          return clone(row)
        })
        data = items
      } else if (state.op === 'update') {
        data = matches().map((row) => clone(Object.assign(row, clone(state.payload))))
      } else if (state.op === 'delete') {
        const removed = matches()
        tables[table] = rows().filter((row) => !removed.includes(row))
        data = clone(removed)
      } else {
        data = matches().map(clone)
        for (const { field, ascending } of [...state.order].reverse()) {
          data.sort((a: Row, b: Row) => {
            const left = a[field] ?? null
            const right = b[field] ?? null
            if (left === right) return 0
            if (left === null) return 1
            if (right === null) return -1
            return (left < right ? -1 : 1) * (ascending ? 1 : -1)
          })
        }
        const total = data.length
        if (state.range) data = data.slice(state.range[0], state.range[1] + 1)
        else if (state.limit !== undefined) data = data.slice(0, state.limit)
        if (state.single) {
          if (data.length === 0) return { data: null, error: state.single === 'single' ? { message: 'No rows' } : null }
          return { data: data[0], error: null }
        }
        return { data, error: null, count: state.count ? total : null }
      }
      if (state.single) return { data: data[0] ?? null, error: data[0] || state.single === 'maybe' ? null : { message: 'No rows' } }
      return { data, error: null }
    }

    const api: any = {
      select(_columns?: string, options?: { count?: string }) { if (options?.count) state.count = true; return api },
      insert(payload: unknown) { state.op = 'insert'; state.payload = payload; calls.push({ table, op: 'insert', payload: clone(payload) }); return api },
      update(payload: unknown) { state.op = 'update'; state.payload = payload; calls.push({ table, op: 'update', payload: clone(payload) }); return api },
      upsert(payload: unknown, opts?: { onConflict?: string }) {
        state.op = 'insert'; state.payload = payload
        state.conflict = opts?.onConflict?.split(',').map((c) => c.trim())
        calls.push({ table, op: 'upsert', payload: clone(payload) }); return api
      },
      delete() { state.op = 'delete'; calls.push({ table, op: 'delete' }); return api },
      eq(field: string, value: unknown) { state.filters.push((row) => row[field] === value); return api },
      is(field: string, value: unknown) { state.filters.push((row) => (row[field] ?? null) === value); return api },
      neq(field: string, value: unknown) { state.filters.push((row) => row[field] !== value); return api },
      gte(field: string, value: any) { state.filters.push((row) => row[field] != null && row[field] >= value); return api },
      lte(field: string, value: any) { state.filters.push((row) => row[field] != null && row[field] <= value); return api },
      // Numeric-aware: bigint cursors arrive as strings.
      gt(field: string, value: any) { state.filters.push((row) => row[field] != null && Number(row[field]) > Number(value)); return api },
      like(field: string, pattern: string) {
        let source = ''
        for (let i = 0; i < pattern.length; i++) {
          const ch = pattern[i]
          if (ch === '\\' && i + 1 < pattern.length) source += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          else if (ch === '%') source += '.*'
          else if (ch === '_') source += '.'
          else source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        }
        const re = new RegExp(`^${source}$`)
        state.filters.push((row) => re.test(String(row[field] ?? '')))
        return api
      },
      in(field: string, values: unknown[]) { state.filters.push((row) => values.includes(row[field])); return api },
      /** Array column contains every value (PostgREST `cs`). */
      contains(field: string, values: unknown[]) { state.filters.push((row) => Array.isArray(row[field]) && values.every((v) => row[field].includes(v))); return api },
      filter(path: string, _op: string, value: unknown) {
        const [col, key] = path.split('->>')
        state.filters.push((row) => String(row[col]?.[key]) === String(value))
        return api
      },
      ilike(field: string, pattern: string) {
        const needle = pattern.replace(/^%|%$/g, '').toLowerCase()
        state.filters.push((row) => String(row[field] ?? '').toLowerCase().includes(needle))
        return api
      },
      or() { return api },
      order(field: string, opts?: { ascending?: boolean }) { state.order.push({ field, ascending: opts?.ascending ?? true }); return api },
      limit(n: number) { state.limit = n; return api },
      range(from: number, to: number) { state.range = [from, to]; return api },
      single() { state.single = 'single'; return Promise.resolve(execute()) },
      maybeSingle() { state.single = 'maybe'; return Promise.resolve(execute()) },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(execute()).then(resolve, reject)
      },
    }
    return api
  }

  return { from: (table: string) => builder(table), tables, calls }
}
