/**
 * A tiny in-memory stand-in for the Supabase query builder, enough for the
 * e-sign ledger / waits / events code (lib/esign): insert (with the unique
 * constraints of migration 20261206000000), select / update / delete with
 * eq / in / lt filters, maybeSingle / single, and rpc handlers.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form */

type Row = Record<string, any>
type Filter = (row: Row) => boolean

const UNIQUE: Record<string, string[][]> = {
  esign_envelopes: [['tenant_id', 'integration_id', 'client_reference']],
  esign_events: [['integration_id', 'dedupe_key']],
  esign_waits: [['event_id']],
}

export interface FakeDb {
  tables: Record<string, Row[]>
  rpcCalls: Array<{ name: string; args: any }>
  from(table: string): any
  rpc(name: string, args: any): Promise<{ data: any; error: any }>
}

export function fakeDb(seed: Record<string, Row[]> = {}, rpcs: Record<string, (args: any, db: FakeDb) => any> = {}): FakeDb {
  const tables: Record<string, Row[]> = {}
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }))
  const rpcCalls: FakeDb['rpcCalls'] = []
  let seq = 0

  const db: FakeDb = {
    tables,
    rpcCalls,
    from(table: string) {
      tables[table] ??= []
      const filters: Filter[] = []
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
      let payload: any = null
      let returning = false
      let limit: number | null = null
      const run = (): { data: any; error: any } => {
        const rows = tables[table]
        if (op === 'insert') {
          const list = Array.isArray(payload) ? payload : [payload]
          const inserted: Row[] = []
          for (const raw of list) {
            const row = { id: raw.id ?? `row-${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), updated_at: new Date(Date.now() + seq).toISOString(), status: raw.status, ...raw }
            for (const cols of UNIQUE[table] ?? []) {
              if (rows.some((r) => cols.every((c) => r[c] === row[c]))) return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on ${table}` } }
            }
            if (table === 'esign_waits') row.status ??= 'waiting'
            if (table === 'esign_envelopes') row.status ??= 'sending'
            rows.push(row)
            inserted.push(row)
          }
          return { data: returning ? inserted : null, error: null }
        }
        const matched = rows.filter((r) => filters.every((f) => f(r)))
        if (op === 'update') {
          for (const r of matched) Object.assign(r, payload)
          return { data: returning ? matched.map((r) => ({ ...r })) : null, error: null }
        }
        if (op === 'delete') {
          tables[table] = rows.filter((r) => !matched.includes(r))
          return { data: null, error: null }
        }
        const out = matched.map((r) => ({ ...r }))
        return { data: limit !== null ? out.slice(0, limit) : out, error: null }
      }
      const b: any = {
        select: () => { if (op !== 'select') returning = true; return b },
        insert: (v: any) => { op = 'insert'; payload = v; return b },
        update: (v: any) => { op = 'update'; payload = v; return b },
        delete: () => { op = 'delete'; return b },
        eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return b },
        neq: (c: string, v: any) => { filters.push((r) => r[c] !== v); return b },
        in: (c: string, v: any[]) => { filters.push((r) => v.includes(r[c])); return b },
        lt: (c: string, v: any) => { filters.push((r) => r[c] < v); return b },
        is: (c: string, v: any) => { filters.push((r) => (r[c] ?? null) === v); return b },
        order: () => b,
        limit: (n: number) => { limit = n; return b },
        maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error } },
        single: async () => { const r = run(); const row = Array.isArray(r.data) ? r.data[0] ?? null : r.data; return { data: row, error: r.error ?? (row ? null : { message: 'not found' }) } },
        then: (resolve: (v: any) => any, reject?: (e: any) => any) => Promise.resolve(run()).then(resolve, reject),
      }
      return b
    },
    async rpc(name: string, args: any) {
      rpcCalls.push({ name, args })
      const handler = rpcs[name]
      if (!handler) return { data: null, error: null }
      try { return { data: await handler(args, db), error: null } } catch (error: any) { return { data: null, error: { message: error.message } } }
    },
  }
  return db
}

/** claim_due_esign_waits for the fake db (waiting + due → processing). */
export function claimDueWaits(args: { p_worker_id: string; p_limit?: number }, db: FakeDb) {
  const now = new Date().toISOString()
  const due = (db.tables.esign_waits ?? []).filter((w) => w.status === 'waiting' && w.next_poll_at <= now).slice(0, args.p_limit ?? 10)
  for (const w of due) Object.assign(w, { status: 'processing', locked_by: args.p_worker_id, locked_at: now })
  return due.map((w) => ({ ...w }))
}
