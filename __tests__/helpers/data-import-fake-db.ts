/**
 * In-memory custom_tables / custom_table_rows for the data-import tests:
 * the PostgREST calls lib/services/data-import makes (select with
 * `alias:data->>key`, insert / upsert / update / delete, eq / in, order,
 * range / limit, single / maybeSingle). Rows get increasing created_at so
 * "newest first" ordering works. `failInsertWhen` makes an insert fail
 * (whole batch, then the matching single rows) to test failure isolation.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>

export interface ImportFakeDb {
  client: any
  tables: Record<string, Row[]>
  ops: Array<{ table: string; op: string; size?: number }>
  failInsertWhen?: (data: Row) => boolean
}

export function createImportFakeDb(seed: Record<string, Row[]> = {}): ImportFakeDb {
  let seq = 0
  const nextId = () => `10000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
  const stamp = () => new Date(Date.UTC(2026, 0, 1) + seq * 1000).toISOString()
  const db: ImportFakeDb = { client: null, tables: {}, ops: [] }
  for (const [name, rows] of Object.entries(seed)) {
    db.tables[name] = rows.map((r) => ({ id: r.id ?? nextId(), created_at: r.created_at ?? stamp(), ...r }))
  }

  function builder(table: string) {
    let op = 'select'
    let payload: any
    let cols = '*'
    let returning = false
    let mode: 'many' | 'single' | 'maybe' = 'many'
    const filters: Array<(r: Row) => boolean> = []
    const orders: Array<{ col: string; asc: boolean }> = []
    let from = 0
    let to: number | undefined
    let onConflict = 'id'
    const rows = () => (db.tables[table] ??= [])

    const project = (r: Row) => {
      const out: Row = { ...structuredClone(r) }
      for (const part of cols.split(',').map((p) => p.trim())) {
        const m = part.match(/^(\w+):data->>(\w+)$/)
        if (m) { const v = r.data?.[m[2]]; out[m[1]] = v === undefined || v === null ? null : String(v) }
      }
      return out
    }
    const shape = (list: Row[] | null) => {
      if (mode === 'many') return { data: list, error: null }
      const l = list ?? []
      if (!l.length) return mode === 'single' ? { data: null, error: { message: 'no rows', code: 'PGRST116' } } : { data: null, error: null }
      return { data: l[0], error: null }
    }
    const run = () => {
      const all = rows()
      if (op === 'insert') {
        const list: Row[] = Array.isArray(payload) ? payload : [payload]
        db.ops.push({ table, op, size: list.length })
        if (db.failInsertWhen && list.some(db.failInsertWhen)) return { data: null, error: { message: 'value too long' } }
        const inserted = list.map((r) => ({ id: nextId(), created_at: stamp(), ...structuredClone(r) }))
        all.push(...inserted)
        return shape(returning ? inserted.map(project) : null)
      }
      if (op === 'upsert') {
        const list: Row[] = Array.isArray(payload) ? payload : [payload]
        db.ops.push({ table, op, size: list.length })
        for (const r of list) {
          const hit = all.find((e) => e[onConflict] === r[onConflict])
          if (hit) Object.assign(hit, structuredClone(r))
          else all.push({ id: nextId(), created_at: stamp(), ...structuredClone(r) })
        }
        return shape(null)
      }
      let matched = all.filter((r) => filters.every((f) => f(r)))
      if (op === 'update') {
        db.ops.push({ table, op, size: matched.length })
        for (const r of matched) Object.assign(r, structuredClone(payload))
        return shape(returning ? matched.map(project) : null)
      }
      if (op === 'delete') {
        db.ops.push({ table, op, size: matched.length })
        db.tables[table] = all.filter((r) => !matched.includes(r))
        return shape(null)
      }
      for (const o of [...orders].reverse()) {
        matched = [...matched].sort((a, b) => (a[o.col] < b[o.col] ? -1 : a[o.col] > b[o.col] ? 1 : 0) * (o.asc ? 1 : -1))
      }
      matched = matched.slice(from, to === undefined ? undefined : to + 1)
      return shape(matched.map(project))
    }

    const api: any = {
      select(c?: string) { if (op === 'select') cols = c ?? '*'; else returning = true; return api },
      insert(r: any) { op = 'insert'; payload = r; return api },
      upsert(r: any, o?: { onConflict?: string }) { op = 'upsert'; payload = r; if (o?.onConflict) onConflict = o.onConflict; return api },
      update(p: any) { op = 'update'; payload = p; return api },
      delete() { op = 'delete'; return api },
      eq(col: string, v: any) { filters.push((r) => r[col] === v); return api },
      in(col: string, vs: any[]) { filters.push((r) => vs.includes(r[col])); return api },
      order(col: string, o?: { ascending?: boolean }) { orders.push({ col, asc: o?.ascending !== false }); return api },
      range(a: number, b: number) { from = a; to = b; return api },
      limit(n: number) { from = 0; to = n - 1; return api },
      single() { mode = 'single'; return Promise.resolve(run()) },
      maybeSingle() { mode = 'maybe'; return Promise.resolve(run()) },
      then(res: any, rej: any) { return Promise.resolve(run()).then(res, rej) },
    }
    return api
  }

  db.client = { from: (t: string) => builder(t) }
  return db
}
