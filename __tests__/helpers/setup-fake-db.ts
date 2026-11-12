/**
 * In-memory stand-in for the REST-shaped service client, covering exactly the
 * calls lib/setup makes (select/eq/lt/limit/maybeSingle, insert with a
 * primary-key conflict, upsert, update…select, delete). Every operation
 * yields to the event loop first, so concurrent callers really interleave.
 */
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const PK: Record<string, string> = { instance_settings: 'key', tenants: 'id', users: 'id' }

export function setupFakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = { tenants: [], users: [], instance_settings: [], ...structuredClone(seed) }
  const tick = () => new Promise((r) => setTimeout(r, 0))

  function from(table: string) {
    const rows = (tables[table] ??= [])
    const filters: ((r: Row) => boolean)[] = []
    let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
    let payload: Row | null = null
    let max = Infinity
    let single = false
    let returning = false
    const run = async () => {
      await tick()
      const match = () => rows.filter((r) => filters.every((f) => f(r)))
      if (op === 'insert') {
        const pk = PK[table]
        if (pk && rows.some((r) => r[pk] === payload![pk])) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
        rows.push({ ...payload })
        return { data: null, error: null }
      }
      if (op === 'upsert') {
        const pk = PK[table]
        const i = rows.findIndex((r) => r[pk] === payload![pk])
        if (i >= 0) rows[i] = { ...rows[i], ...payload }
        else rows.push({ ...payload })
        return { data: null, error: null }
      }
      if (op === 'update') {
        const hit = match()
        for (const r of hit) Object.assign(r, payload)
        return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null }
      }
      if (op === 'delete') {
        const hit = new Set(match())
        const kept = rows.filter((r) => !hit.has(r))
        rows.splice(0, rows.length, ...kept)
        return { data: null, error: null }
      }
      const data = match().slice(0, max).map((r) => ({ ...r }))
      return { data: single ? (data[0] ?? null) : data, error: null }
    }
    const builder = {
      select(_cols?: string) { if (op !== 'select') returning = true; return builder },
      insert(row: Row) { op = 'insert'; payload = row; return builder },
      upsert(row: Row) { op = 'upsert'; payload = row; return builder },
      update(row: Row) { op = 'update'; payload = row; return builder },
      delete() { op = 'delete'; return builder },
      eq(col: string, v: unknown) { filters.push((r) => r[col] === v); return builder },
      lt(col: string, v: string) { filters.push((r) => String(r[col]) < v); return builder },
      limit(n: number) { max = n; return builder },
      maybeSingle() { single = true; return builder },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) { return run().then(resolve, reject) },
    }
    return builder
  }
  return { db: { from }, tables }
}
