/**
 * Grouping and child records against the real schema and RLS (migration
 * 20270119090000_data_table_grouping, applied inside this test's transaction
 * and rolled back). User `a` (owner of workspace A only) runs the grid's
 * reads through a pg-query client bound to their identity — exactly as the
 * dashboard runs them:
 *
 *  - data_table_row_groups / data_table_rows_page are SECURITY INVOKER: a row
 *    of another workspace (even one stored under A's table id) never counts,
 *    groups or lists; B's table answers nothing;
 *  - child counts and child rows follow RLS the same way;
 *  - the SQL filter, grouping and sort agree with lib/grid/grouping.ts.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/data-table-grouping-db.test.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, type Pool } from 'pg'
import { createPgQuery } from '@user-tasks/pg-query'
import { runUiRead } from '@/lib/services/ui-reads'
import type { ServiceContext } from '@/lib/services/context'
import { buildGroupTree, groupRowsInMemory, rowMatchesFilters, sortRowsLikeDatabase } from '@/lib/grid/grouping'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20270119090000_data_table_grouping.sql'), 'utf8')

function uid(key: string): string {
  const h = createHash('md5').update(`dt-grouping-db:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const TENANT = { A: uid('tenant:A'), B: uid('tenant:B') }
const USER = { A: uid('user:a'), B: uid('user:b') }
const ORDERS = { A: uid('orders:A'), B: uid('orders:B') }
const LINES_A = uid('lines:A')
const O1 = uid('o1')
const O2 = uid('o2')

/** One connection inside the test's transaction; pg-query's BEGIN/COMMIT become a savepoint. */
function savepointPool(client: Client): Pool {
  let chain: Promise<unknown> = Promise.resolve()
  let statements: Promise<unknown> = Promise.resolve()
  const query = (text: any, values?: any) => {
    const next = statements.then(() => client.query(text, values))
    statements = next.catch(() => {})
    return next
  }
  return {
    query,
    async connect() {
      let release!: () => void
      const turn = chain.then(() => undefined)
      chain = turn.then(() => new Promise<void>((r) => { release = r }))
      await turn
      return {
        query(text: any, values?: any) {
          if (typeof text === 'string' && /^BEGIN\b/.test(text)) return query('SAVEPOINT pgq')
          if (text === 'COMMIT' || text === 'ROLLBACK') return query('ROLLBACK TO SAVEPOINT pgq; RELEASE SAVEPOINT pgq')
          return query(text, values)
        },
        release: () => release(),
      }
    },
  } as unknown as Pool
}

describe.skipIf(!DB_URL)('data table grouping and child records (local DB, RLS)', () => {
  const db = new Client({ connectionString: DB_URL })
  let ctx: ServiceContext
  const read = async (name: string, args: unknown) => {
    const res = await runUiRead(ctx, { name, args })
    if (!res.ok) throw new Error(`${name}: ${JSON.stringify(res)}`)
    return res.data as any
  }
  const orderRows = [
    { id: O1, data: { order_no: 'A-1', status: 'open', region: 'east', total: 100 } },
    { id: O2, data: { order_no: 'A-2', status: 'open', region: 'west', total: '50.5' } },
    { id: uid('o3'), data: { order_no: 'A-3', status: 'closed', region: 'east', total: 7 } },
    { id: uid('o4'), data: { order_no: 'A-4', status: ' ', total: 'n/a' } },
    { id: uid('o5'), data: { order_no: 'A-5', region: 'west', total: 1 } },
  ]

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    await db.query(MIGRATION)
    for (const k of ['A', 'B'] as const) {
      await db.query('INSERT INTO public.tenants (id, name, slug) VALUES ($1, $2, $3)', [TENANT[k], `grp ${k}`, `dt-grouping-db-${k.toLowerCase()}`])
      await db.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [USER[k], `grp-${k.toLowerCase()}@iso.test`])
      await db.query('DELETE FROM public.user_memberships WHERE user_id = $1', [USER[k]])
      await db.query('UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1', [USER[k], TENANT[k]])
      await db.query('INSERT INTO public.user_memberships (user_id, tenant_id, role, is_home) VALUES ($1, $2, $3, true)', [USER[k], TENANT[k], 'owner'])
      await db.query('INSERT INTO public.custom_tables (id, tenant_id, name, slug, columns, child_relations) VALUES ($1, $2, $3, $4, $5, $6)', [
        ORDERS[k], TENANT[k], 'Orders', `orders-${k.toLowerCase()}`,
        JSON.stringify([{ key: 'order_no', name: 'Order No', type: 'text' }, { key: 'status', name: 'Status', type: 'select' }, { key: 'total', name: 'Total', type: 'number' }]),
        JSON.stringify(k === 'A' ? [{ id: 'r_lines', table_id: LINES_A, lookup_column: 'order' }] : []),
      ])
    }
    await db.query('INSERT INTO public.custom_tables (id, tenant_id, name, slug, columns) VALUES ($1, $2, $3, $4, $5)', [
      LINES_A, TENANT.A, 'Order lines', 'order-lines-a', JSON.stringify([{ key: 'order', name: 'Order', type: 'lookup', lookup: { sourceTableId: ORDERS.A, sourceColumn: 'Order No' } }, { key: 'qty', name: 'Qty', type: 'number' }]),
    ])
    const insert = (table: string, tenant: string, data: object, rowId?: string) =>
      db.query('INSERT INTO public.custom_table_rows (id, table_id, tenant_id, data) VALUES (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4)', [rowId ?? null, table, tenant, JSON.stringify(data)])
    for (const row of orderRows) await insert(ORDERS.A, TENANT.A, row.data, row.id)
    await insert(ORDERS.B, TENANT.B, { order_no: 'A-1', status: 'open', total: 999 })
    // A row of workspace B stored under A's table id: RLS must keep it out of everything.
    await insert(ORDERS.A, TENANT.B, { order_no: 'A-1', status: 'open', total: 5000 })
    await insert(LINES_A, TENANT.A, { order: 'A-1', qty: 2 })
    await insert(LINES_A, TENANT.A, { order: 'A-1', qty: 3 })
    await insert(LINES_A, TENANT.A, { order: 'A-2', qty: 1 })
    await insert(LINES_A, TENANT.B, { order: 'A-1', qty: 99 })

    const pgq = createPgQuery({ pool: savepointPool(db), maxRows: 1000 })
    const client = pgq.client({ role: 'authenticated', claims: { sub: USER.A, role: 'authenticated', aud: 'authenticated' } })
    ctx = { db: client as any, supabase: client as any, tenantId: TENANT.A, actorId: USER.A, permissions: null, authKind: 'session', source: 'ui' }
  }, 60_000)

  afterAll(async () => {
    await db.query('ROLLBACK').catch(() => {})
    await db.end()
  })

  it('groups the whole table through data_table_row_groups (exact) and only the caller\'s rows', async () => {
    const res = await read('data.rowGroups', { tableId: ORDERS.A, groupBy: ['status', 'region'], sum: ['total'] })
    expect(res.exact).toBe(true)
    expect(res.total).toBe(orderRows.length)
    // The same tree the in-memory grouping builds from the same rows.
    expect(res.groups).toEqual(buildGroupTree(groupRowsInMemory(orderRows, ['status', 'region'], ['total']), 2))
    expect(JSON.stringify(res)).not.toContain('5000')
    expect((await read('data.rowGroups', { tableId: ORDERS.B, groupBy: ['status'] })).groups).toEqual([])
  })

  it('reads a group\'s rows (and search / sort) through data_table_rows_page, like the in-memory filter', async () => {
    const filters = [{ field: 'status', operator: 'in', value: ['open'] }]
    const page = await read('data.rowPage', { tableId: ORDERS.A, filters, sort: 'total', dir: 'desc', limit: 10, offset: 0 })
    expect(page.truncated).toBe(false)
    expect(page.total).toBe(2)
    expect(page.rows.map((r: any) => r.id)).toEqual(sortRowsLikeDatabase(orderRows.filter((r) => rowMatchesFilters(r, filters as never)), 'total', 'desc').map((r) => r.id))
    const empty = await read('data.rowPage', { tableId: ORDERS.A, filters: [{ field: 'status', operator: 'is_empty' }] })
    expect(empty.total).toBe(2)
    const searched = await read('data.rowPage', { tableId: ORDERS.A, search: 'A-4', filters: [{ field: 'total', operator: 'not_empty' }] })
    expect(searched.rows.map((r: any) => r.data.order_no)).toEqual(['A-4'])
    expect((await read('data.rowPage', { tableId: ORDERS.B, filters })).rows).toEqual([])
  })

  it('lists a hierarchy\'s top level in SQL as filterRoots does (missing parent and self-parent stay)', async () => {
    const res = await read('data.rowPage', { tableId: ORDERS.A, filters: [{ field: 'region', operator: 'is_root', value: 'order_no' }] })
    // No order_no equals a region, so every row is a root; then a real parent link:
    expect(res.total).toBe(orderRows.length)
    await db.query(`UPDATE public.custom_table_rows SET data = data || '{"region":"A-1"}' WHERE id = $1`, [O2])
    const rooted = await read('data.rowPage', { tableId: ORDERS.A, filters: [{ field: 'region', operator: 'is_root', value: 'order_no' }] })
    expect(rooted.rows.map((r: any) => r.id)).not.toContain(O2)
    expect(rooted.total).toBe(orderRows.length - 1)
    const groups = await read('data.rowGroups', { tableId: ORDERS.A, groupBy: ['status'], filters: [{ field: 'region', operator: 'is_root', value: 'order_no' }] })
    expect(groups.total).toBe(orderRows.length - 1)
    await db.query(`UPDATE public.custom_table_rows SET data = data || '{"region":"west"}' WHERE id = $1`, [O2])
  })

  it('counts and lists child rows under RLS (another workspace\'s rows never link)', async () => {
    const counts = await read('data.childCounts', { tableId: ORDERS.A, rowIds: [O1, O2] })
    expect(counts.counts.r_lines).toEqual({ [O1]: 2, [O2]: 1 })
    const children = await read('data.childRows', { tableId: ORDERS.A, rowId: O1, relationId: 'r_lines' })
    expect(children.rows.map((r: any) => r.data.qty).sort()).toEqual([2, 3])
    expect(children.total).toBe(2)
  })

  it('gives anon no EXECUTE on the new functions', async () => {
    const { rows } = await db.query(`select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'data_table_%'`)
    expect(rows.length).toBeGreaterThanOrEqual(5)
    expect(rows.filter((r: any) => r.anon)).toEqual([])
  })
})
