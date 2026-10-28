import { describe, expect, it, vi } from 'vitest'
import { RequestHandler, type Identity, type TxClient } from '../src/handler'
import { parseQueryParams, parseSelect } from '../src/parse'
import { buildReadPlan, mainRead } from '../src/plan'
import { resolveRelationship } from '../src/relationships'
import { PgExecutor } from '../src/executor'
import type { SchemaCache, Table } from '../src/schema'
import { SchemaStore } from '../src/schema'
import { SqlBuilder } from '../src/sql'
import { PgrstError } from '../src/errors'

/** Planner / parser behaviour that needs no database (the conformance suite covers results). */

function table(name: string, cols: Array<[string, string]>, pk = ['id']): Table {
  return {
    schema: 'public',
    name,
    kind: 'r',
    columns: new Map(cols.map(([n, type]) => [n, { name: n, type, baseType: type, nullable: true, default: null }])),
    columnOrder: cols.map(([n]) => n),
    primaryKey: pk,
    uniqueKeys: [pk],
  }
}

const cache: SchemaCache = {
  schema: 'public',
  tables: new Map([
    ['tasks', table('tasks', [['id', 'uuid'], ['title', 'text'], ['assignee_id', 'uuid'], ['assigner_id', 'uuid'], ['parent_id', 'uuid'], ['metadata', 'jsonb']])],
    ['users', table('users', [['id', 'uuid'], ['name', 'text']])],
    ['profiles', table('profiles', [['user_id', 'uuid'], ['bio', 'text']], ['user_id'])],
    ['tags', table('tags', [['id', 'uuid'], ['name', 'text']])],
    ['task_tags', table('task_tags', [['task_id', 'uuid'], ['tag_id', 'uuid']], ['task_id', 'tag_id'])],
  ]),
  foreignKeys: [
    { name: 'tasks_assignee_id_fkey', table: 'tasks', columns: ['assignee_id'], refTable: 'users', refColumns: ['id'] },
    { name: 'tasks_assigner_id_fkey', table: 'tasks', columns: ['assigner_id'], refTable: 'users', refColumns: ['id'] },
    { name: 'tasks_parent_id_fkey', table: 'tasks', columns: ['parent_id'], refTable: 'tasks', refColumns: ['id'] },
    { name: 'profiles_user_id_fkey', table: 'profiles', columns: ['user_id'], refTable: 'users', refColumns: ['id'] },
    { name: 'task_tags_task_id_fkey', table: 'task_tags', columns: ['task_id'], refTable: 'tasks', refColumns: ['id'] },
    { name: 'task_tags_tag_id_fkey', table: 'task_tags', columns: ['tag_id'], refTable: 'tags', refColumns: ['id'] },
  ],
  functions: new Map(),
  roleSettings: new Map(),
}

function sqlFor(query: string) {
  const qp = parseQueryParams(new URLSearchParams(query), false)
  const plan = buildReadPlan({ cache, rootName: 'tasks', action: 'read', params: qp, aggregatesEnabled: false })
  const sql = new SqlBuilder()
  return { text: mainRead(sql, plan, true, 'array'), params: sql.params }
}

describe('parser', () => {
  it('parses aliases, hints, join types, json paths, casts and spreads', () => {
    expect(parseSelect('id,a:users!tasks_assignee_id_fkey!inner(name),metadata->x->>y,n:title::text,...tags(name)')).toEqual([
      { type: 'field', field: { name: 'id', path: [] }, agg: null, aggCast: null, cast: null, alias: null },
      { type: 'relation', name: 'users', alias: 'a', hint: 'tasks_assignee_id_fkey', joinType: 'inner', spread: false,
        children: [{ type: 'field', field: { name: 'name', path: [] }, agg: null, aggCast: null, cast: null, alias: null }] },
      { type: 'field', field: { name: 'metadata', path: [{ arrow: '->', key: 'x', isIdx: false }, { arrow: '->>', key: 'y', isIdx: false }] }, agg: null, aggCast: null, cast: null, alias: null },
      { type: 'field', field: { name: 'title', path: [] }, agg: null, aggCast: null, cast: 'text', alias: 'n' },
      { type: 'relation', name: 'tags', alias: null, hint: null, joinType: null, spread: true,
        children: [{ type: 'field', field: { name: 'name', path: [] }, agg: null, aggCast: null, cast: null, alias: null }] },
    ])
  })

  it('parses or() trees with nested and(), quoted values and in-lists', () => {
    const qp = parseQueryParams(new URLSearchParams({ or: '(a.eq.1,and(b.in.("x,y",z),c.not.is.null),d.ilike."%,)%")' }), false)
    const [[, tree]] = qp.logic
    expect(tree).toMatchObject({
      type: 'expr', op: 'or', not: false,
      children: [
        { type: 'stmt', filter: { field: { name: 'a' }, expr: { not: false, operation: { kind: 'quant', op: 'eq', value: '1' } } } },
        { type: 'expr', op: 'and', children: [
          { type: 'stmt', filter: { expr: { operation: { kind: 'in', values: ['x,y', 'z'] } } } },
          { type: 'stmt', filter: { expr: { not: true, operation: { kind: 'is', value: 'null' } } } },
        ] },
        { type: 'stmt', filter: { expr: { operation: { kind: 'quant', op: 'ilike', value: '%,)%' } } } },
      ],
    })
  })

  it('rejects unknown operators with PGRST100', () => {
    expect(() => parseQueryParams(new URLSearchParams({ id: 'bogus.1' }), false)).toThrow(PgrstError)
  })
})

describe('SQL generation', () => {
  it('binds every request value as a parameter (never interpolated)', () => {
    const evil = "x'); DROP TABLE tasks; --"
    const { text, params } = sqlFor(new URLSearchParams({ select: 'id', title: `eq.${evil}`, or: `(title.ilike.${evil.replace(/[,()]/g, '')})`, 'metadata->>k': `in.(${evil.replace(/[,()]/g, '')})`, limit: '5' }).toString())
    expect(text).not.toContain('DROP TABLE')
    expect(params).toContain(evil)
    expect(text).toMatch(/"tasks"\."title" = \$\d+/)
  })

  it('quotes identifiers, so a hostile column name stays an identifier', () => {
    const { text } = sqlFor(new URLSearchParams({ select: '"id\\" from tasks; --"' }).toString())
    expect(text).toContain('"public"."tasks"."id"" from tasks; --"')
  })

  it('embeds with lateral joins named like PostgREST and resolves hints', () => {
    const { text } = sqlFor(new URLSearchParams({ select: 'id,assignee:users!tasks_assignee_id_fkey(name)' }).toString())
    expect(text).toContain('LEFT JOIN LATERAL ( SELECT "users_1"."name" FROM "public"."users" AS "users_1"')
    expect(text).toContain('"users_1"."id" = "public"."tasks"."assignee_id"')
    expect(text).toContain('row_to_json("tasks_assignee_1".*)::jsonb AS "assignee"')
  })

  it('applies to-json for JSON paths on non-json columns only', () => {
    expect(sqlFor('select=metadata->>a,title->>b').text).toMatch(/"public"\."tasks"\."metadata"->>\$\d+ AS "a", to_jsonb\("public"\."tasks"\."title"\)->>\$\d+ AS "b"/)
  })
})

describe('relationships', () => {
  it('requires a hint when two FKs point at the same table (PGRST201)', () => {
    expect(() => resolveRelationship(cache, 'tasks', 'users', null)).toThrow(/more than one relationship/)
    expect(resolveRelationship(cache, 'tasks', 'users', 'tasks_assigner_id_fkey').pairs).toEqual([['assigner_id', 'id']])
    expect(resolveRelationship(cache, 'tasks', 'users', 'assignee_id').constraint).toBe('tasks_assignee_id_fkey')
  })

  it('detects one-to-one (FK columns are the key) and many-to-many (junction PK)', () => {
    expect(resolveRelationship(cache, 'users', 'profiles', null).cardinality).toBe('o2o')
    expect(resolveRelationship(cache, 'tasks', 'tags', null)).toMatchObject({ cardinality: 'm2m', junction: { table: 'task_tags' } })
  })

  it('follows the self-relationship convention (table name → children, column → parent)', () => {
    expect(resolveRelationship(cache, 'tasks', 'tasks', null).cardinality).toBe('o2m')
    expect(resolveRelationship(cache, 'tasks', 'parent_id', null).cardinality).toBe('m2o')
    expect(() => resolveRelationship(cache, 'tasks', 'nope', null)).toThrow(/Could not find a relationship/)
  })
})

describe('identity', () => {
  const store = new SchemaStore(async () => cache)

  it('runs every request in a transaction that sets role and claims first', async () => {
    const calls: Array<[string, unknown[] | undefined]> = []
    const client = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        calls.push([text, values])
        return { rows: [{ total_result_set: null, page_total: '0', body: '[]', response_inserted: '' }] }
      }),
      release: vi.fn(),
    }
    const pool = { connect: vi.fn(async () => client) }
    const handler = new RequestHandler({ schemas: store, tx: new PgExecutor({ pool: pool as never }) })
    const identity: Identity = { role: 'authenticated', claims: { sub: 'u1', role: 'authenticated' } }
    const res = await handler.handle({ method: 'GET', path: 'tasks', search: new URLSearchParams('select=id'), headers: new Headers(), body: null }, identity)
    expect(res.status).toBe(200)
    expect(calls[0][0]).toBe('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY')
    const settings = calls[1][1] as string[]
    const pairs = Object.fromEntries(Array.from({ length: settings.length / 2 }, (_, i) => [settings[2 * i], settings[2 * i + 1]]))
    expect(pairs).toMatchObject({ role: 'authenticated', 'request.jwt.claims': JSON.stringify(identity.claims), 'request.jwt.claim.sub': 'u1' })
    expect(calls[1][0]).toMatch(/^select set_config\(\$1, \$2, true\)/)
    expect(calls.at(-1)?.[0]).toBe('COMMIT')
    expect(client.release).toHaveBeenCalled()
  })

  it('service_role without BYPASSRLS (managed Postgres) keeps the owner role; other roles are still switched', async () => {
    const settingsFor = async (rolesWithoutBypassRls: Set<string> | undefined, identity: Identity) => {
      const calls: Array<[string, unknown[] | undefined]> = []
      const client = {
        query: vi.fn(async (text: string, values?: unknown[]) => {
          calls.push([text, values])
          return { rows: [{ total_result_set: null, page_total: '0', body: '[]', response_inserted: '' }] }
        }),
        release: vi.fn(),
      }
      const handler = new RequestHandler({
        schemas: new SchemaStore(async () => ({ ...cache, rolesWithoutBypassRls })),
        tx: new PgExecutor({ pool: { connect: async () => client } as never }),
      })
      await handler.handle({ method: 'GET', path: 'tasks', search: new URLSearchParams('select=id'), headers: new Headers(), body: null }, identity)
      const values = calls[1][1] as string[]
      return Object.fromEntries(Array.from({ length: values.length / 2 }, (_, i) => [values[2 * i], values[2 * i + 1]]))
    }
    const service: Identity = { role: 'service_role', claims: { role: 'service_role' } }
    const member: Identity = { role: 'authenticated', claims: { sub: 'u1', role: 'authenticated' } }
    // Supabase / superuser-migrated: service_role has BYPASSRLS → switched to as usual.
    expect(await settingsFor(new Set(), service)).toMatchObject({ role: 'service_role' })
    expect(await settingsFor(undefined, service)).toMatchObject({ role: 'service_role' })
    // Without it: no role switch (the schema owner bypasses RLS), claims still say service_role.
    const fallback = await settingsFor(new Set(['service_role', 'anon', 'authenticated']), service)
    expect(fallback).not.toHaveProperty('role')
    expect(fallback['request.jwt.claims']).toBe(JSON.stringify(service.claims))
    // End-user roles never fall back.
    expect(await settingsFor(new Set(['service_role', 'anon', 'authenticated']), member)).toMatchObject({ role: 'authenticated' })
  })

  it('refuses roles outside the allowlist (no SET ROLE to arbitrary roles)', async () => {
    const pool = { connect: vi.fn() }
    const handler = new RequestHandler({ schemas: store, tx: new PgExecutor({ pool: pool as never }) })
    const res = await handler.handle({ method: 'GET', path: 'tasks', search: new URLSearchParams(), headers: new Headers(), body: null }, { role: 'postgres', claims: {} })
    expect(res.status).toBe(401)
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('rolls back when the result fails a singular request', async () => {
    const calls: string[] = []
    const client = {
      query: vi.fn(async (text: string) => {
        calls.push(text)
        return { rows: [{ total_result_set: null, page_total: '2', body: '[{},{}]', response_inserted: '' }] }
      }),
      release: vi.fn(),
    }
    const handler = new RequestHandler({ schemas: store, tx: new PgExecutor({ pool: { connect: async () => client } as never }) })
    const res = await handler.handle(
      { method: 'PATCH', path: 'tasks', search: new URLSearchParams('select=id&title=eq.y'), headers: new Headers({ accept: 'application/vnd.pgrst.object+json', prefer: 'return=representation' }), body: '{"title":"x"}' },
      { role: 'service_role', claims: {} },
    )
    expect(res.status).toBe(406)
    expect(JSON.parse(res.body as string).code).toBe('PGRST116')
    expect(calls).toContain('ROLLBACK')
    expect(calls).not.toContain('COMMIT')
  })
})

// Keep the TxClient type referenced for readers of this file.
export type { TxClient }
