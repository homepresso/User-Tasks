/**
 * QA pass 2026-11-24 regressions (MCP / auth):
 *  - MCP task tools refuse an assignee who is not a person of the caller's
 *    workspace (the MCP client is service-role: an unchecked id let a task,
 *    its notifications and tasks_get's assignee join reach another workspace).
 *  - Form data-binding sources (custom_tables / integration_references) are
 *    read in the caller's workspace only (forms_data_source and
 *    POST /api/v1/forms/{id}/data-source take an unsaved definition, so the
 *    bound source id is caller-controlled).
 *  - OAuth refresh-token rotation is single-use under concurrency.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/providers/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/providers/cache')>()
  const store = actual.resolveCacheStore('memory')
  return { ...actual, getCacheStore: async () => store }
})

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}
const inserts: Array<{ table: string; row: Row }> = []
/** Optional pause before a read of `table` resolves (to line up concurrent requests). */
let readGate: { table: string; wait: () => Promise<void> } | null = null

/** PostgREST-ish builder over `tables`: eq/is/in filters, inserts recorded, updates applied. */
function builder(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let op: 'select' | 'insert' | 'update' = 'select'
  let payload: Row | null = null
  let limit = Infinity
  const matching = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, limit)
  const run = async () => {
    // Yield once so concurrent callers interleave between their read and write.
    await Promise.resolve()
    if (op === 'select' && readGate?.table === table) await readGate.wait()
    if (op === 'insert') {
      const row = { id: `${table}-${inserts.length + 1}`, ...payload! }
      inserts.push({ table, row })
      ;(tables[table] ??= []).push(row)
      return [row]
    }
    if (op === 'update') {
      const hit = matching()
      for (const r of hit) Object.assign(r, payload)
      return hit
    }
    return matching()
  }
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (col: string, value: unknown) => { filters.push((r) => r[col] === value); return b },
    is: (col: string, value: unknown) => { filters.push((r) => (r[col] ?? null) === value); return b },
    in: (col: string, values: unknown[]) => { filters.push((r) => values.includes(r[col])); return b },
    or: () => b,
    order: () => b,
    range: () => b,
    limit: (n: number) => { limit = n; return b },
    insert: (row: Row) => { op = 'insert'; payload = row; return b },
    update: (values: Row) => { op = 'update'; payload = values; return b },
    single: async () => ({ data: (await run())[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: (await run())[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      run().then((data) => ({ data, error: null })).then(resolve, reject),
  }
  return b
}

const fakeDb = { from: (table: string) => builder(table), rpc: async () => ({ data: null, error: null }) }

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeDb }))

import { createMcpServer } from '@/lib/mcp/server'
import { formSourceDeps } from '@/lib/services/form-sources'
import { POST as tokenPOST } from '@/app/api/oauth/token/route'
import { hashOAuthToken } from '@/lib/oauth/tokens'

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key]
  inserts.length = 0
  readGate = null
  tables.users = [
    { id: 'user-a', tenant_id: 'tenant-a' },
    { id: 'user-b', tenant_id: 'tenant-b' },
    { id: 'guest-a', tenant_id: 'tenant-c' },
  ]
  tables.user_memberships = [{ id: 'm1', user_id: 'guest-a', tenant_id: 'tenant-a', is_active: true }]
})

const textOf = (result: { content: Array<{ text: string }> }) => result.content.map((c) => c.text).join('\n')

describe('MCP task tools: assignees must belong to the workspace', () => {
  const server = () => createMcpServer({
    tenantId: 'tenant-a',
    supabase: fakeDb,
    keyType: 'tenant',
    permissions: ['tasks.create', 'tasks.escalate', 'tasks.redirect', 'tasks.manage_queue'],
  })

  it('tasks_create refuses a user of another workspace', async () => {
    const result = await server().callTool('tasks_create', { title: 'x', assignee_id: 'user-b' })
    expect(result.isError).toBe(true)
    expect(textOf(result as never)).toContain('member of this workspace')
    expect(inserts.filter((i) => i.table === 'tasks')).toHaveLength(0)
  })

  it('tasks_create accepts a home-workspace user and an active member', async () => {
    for (const assignee of ['user-a', 'guest-a']) {
      const result = await server().callTool('tasks_create', { title: 'x', assignee_id: assignee })
      expect(result.isError, textOf(result as never)).toBeFalsy()
    }
    expect(inserts.filter((i) => i.table === 'tasks').map((i) => i.row.assignee_id)).toEqual(['user-a', 'guest-a'])
  })

  it('tasks_escalate / tasks_redirect / tasks_update refuse a user of another workspace', async () => {
    tables.tasks = [{ id: 'task-1', tenant_id: 'tenant-a', assignee_id: 'user-a', deleted_at: null }]
    const calls: Array<[string, Record<string, unknown>]> = [
      ['tasks_escalate', { task_id: 'task-1', escalate_to: 'user-b' }],
      ['tasks_redirect', { task_id: 'task-1', redirect_to: 'user-b' }],
      ['tasks_update', { task_id: 'task-1', assignee_id: 'user-b' }],
    ]
    for (const [tool, args] of calls) {
      const result = await server().callTool(tool, args)
      expect(result.isError, tool).toBe(true)
      expect(textOf(result as never), tool).toContain('member of this workspace')
    }
    expect(tables.tasks[0].assignee_id).toBe('user-a')
  })

  it('a deactivated membership does not count', async () => {
    tables.user_memberships = [{ id: 'm1', user_id: 'guest-a', tenant_id: 'tenant-a', is_active: false }]
    const result = await server().callTool('tasks_create', { title: 'x', assignee_id: 'guest-a' })
    expect(result.isError).toBe(true)
  })
})

describe('form data-binding sources are read in the caller\'s workspace', () => {
  const ctx = { db: fakeDb, supabase: fakeDb, tenantId: 'tenant-a', actorId: null, permissions: null, authKind: 'api_key', source: 'api' } as never

  it('a data table of another workspace is not found', async () => {
    tables.custom_tables = [
      { id: 'tbl-b', tenant_id: 'tenant-b', name: 'Salaries', columns: [{ key: 'salary', name: 'Salary', type: 'number' }] },
      { id: 'tbl-a', tenant_id: 'tenant-a', name: 'Mine', columns: [] },
    ]
    expect(await formSourceDeps.table(ctx, 'tbl-b')).toBeNull()
    expect(await formSourceDeps.table(ctx, 'tbl-a')).toMatchObject({ id: 'tbl-a', name: 'Mine' })
  })

  it('an API reference of another workspace is not found', async () => {
    tables.integration_references = [
      { id: 'ref-b', tenant_id: 'tenant-b', name: 'Theirs', request_config: { url: 'https://internal.example' } },
      { id: 'ref-a', tenant_id: 'tenant-a', name: 'Ours', request_config: {} },
    ]
    expect(await formSourceDeps.reference(ctx, 'ref-b')).toBeNull()
    expect(await formSourceDeps.reference(ctx, 'ref-a')).toMatchObject({ id: 'ref-a' })
  })
})

describe('OAuth refresh rotation', () => {
  const REFRESH = 'uor_qa_wf_refresh_token_value'
  const form = () => new NextRequest('https://app.test/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'public-client', refresh_token: REFRESH }).toString(),
  })

  beforeEach(() => {
    tables.oauth_clients = [{
      id: 'c1', tenant_id: null, client_id: 'public-client', client_secret_hash: null, client_type: 'public',
      grant_types: ['authorization_code', 'refresh_token'], allowed_scopes: ['tasks:read'], revoked_at: null, created_by: null,
    }]
    tables.oauth_tokens = [{
      id: 'rt-1', tenant_id: 'tenant-a', token_type: 'refresh', token_hash: hashOAuthToken(REFRESH), client_id: 'public-client',
      user_id: 'user-a', grant_type: 'authorization_code:code-1', scopes: ['tasks:read'], refresh_parent: null,
      expires_at: '2099-01-01T00:00:00Z', revoked_at: null,
    }]
  })

  it('two concurrent refreshes with the same token mint exactly one pair', async () => {
    // Both requests read the (still live) refresh token before either rotates it.
    let arrived = 0
    let release!: () => void
    const both = new Promise<void>((resolve) => { release = resolve })
    readGate = { table: 'oauth_tokens', wait: async () => { if (++arrived === 2) release(); await both; readGate = null } }
    const responses = await Promise.all([tokenPOST(form()), tokenPOST(form())])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400])
    const minted = inserts.filter((i) => i.table === 'oauth_tokens')
    expect(minted.map((i) => i.row.token_type).sort()).toEqual(['access', 'refresh'])
  })

  it('a sequential replay is refused', async () => {
    expect((await tokenPOST(form())).status).toBe(200)
    expect((await tokenPOST(form())).status).toBe(400)
  })
})
