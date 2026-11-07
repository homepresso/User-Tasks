import { describe, expect, it } from 'vitest'
import { defineAction } from '../src/index'
import { runAction } from '../src/testing'

const manifest = {
  manifest_version: 1,
  key: 'acme_test',
  name: 'Test',
  version: '1.0.0',
  operations: [
    { id: 'add', label: 'Add', inputs: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }], outputs: [{ name: 'sum', type: 'number' }] },
    { id: 'call', label: 'Call', inputs: [{ name: 'url', type: 'string' }], outputs: [{ name: 'status', type: 'number' }] },
  ],
  capabilities: {
    http: { hosts: ['api.example.com'] },
    data: { read: true, write: true },
    files: true,
    credentials: [{ name: 'api_key' }],
  },
  limits: { timeout_ms: 2000, memory_mb: 16 },
}

const MODULE = `export default {
  operations: {
    add: (i, ctx) => { ctx.log.info('adding', { a: i.a }); return { sum: i.a + i.b } },
    call: async (i, ctx) => {
      const res = await ctx.http.fetch(i.url, { headers: { authorization: 'Bearer secret://api_key' } })
      return { status: res.status, body: res.json }
    },
    secret: async (i, ctx) => ({ value: await ctx.secrets.get(i.ref) }),
    rows: async (i, ctx) => {
      await ctx.data.insert('orders', { total: 5 })
      const page = await ctx.data.query('orders', { limit: 10 })
      return { total: page.total, first: page.rows[0].data }
    },
    file: async (i, ctx) => ({ text: (await ctx.files.read(i.file, { as: 'text' })).text }),
    hmac: async (i, ctx) => ({ mac: await ctx.crypto.hmac('SHA-256', 'secret://api_key', 'msg') }),
    loop: () => { for (;;) {} },
    boom: (i, ctx) => ctx.fail('nope', { retryable: true }),
  },
}`

describe('defineAction', () => {
  it('returns the definition and refuses one without operations', () => {
    const def = { operations: { add: (i: { a: number }) => ({ a: i.a }) } }
    expect(defineAction(def)).toBe(def)
    expect(() => defineAction({} as never)).toThrow(/operations/)
  })
})

describe('runAction (local runner with mocks)', () => {
  it('runs an operation and returns outputs, logs and stats', async () => {
    const r = await runAction({ module: MODULE, manifest, operation: 'add', inputs: { a: 2, b: 3 } })
    expect(r.ok).toBe(true)
    expect(r.outputs).toEqual({ sum: 5 })
    expect(r.logs[0]).toMatchObject({ level: 'info', message: 'adding', metadata: { a: 2 } })
    expect(r.stats.host_calls).toBe(0)
  })

  it('answers ctx.http.fetch from the mock, only for manifest hosts', async () => {
    const seen: string[] = []
    const mocks = { http: (url: string) => { seen.push(url); return { status: 201, json: { ok: true } } } }
    const ok = await runAction({ module: MODULE, manifest, operation: 'call', inputs: { url: 'https://api.example.com/x' }, mocks })
    expect(ok).toMatchObject({ ok: true, outputs: { status: 201, body: { ok: true } } })
    expect(ok.stats.host_calls).toBe(1)
    const denied = await runAction({ module: MODULE, manifest, operation: 'call', inputs: { url: 'https://evil.example.net/' }, mocks })
    expect(denied.ok).toBe(false)
    expect(denied.error?.code).toBe('capability')
    expect(seen).toEqual(['https://api.example.com/x'])
  })

  it('reads declared secrets only', async () => {
    const mocks = { secrets: { api_key: 'k1' } }
    expect((await runAction({ module: MODULE, manifest, operation: 'secret', inputs: { ref: 'secret://api_key' }, mocks })).outputs).toEqual({ value: 'k1' })
    const other = await runAction({ module: MODULE, manifest, operation: 'secret', inputs: { ref: 'secret://other' }, mocks })
    expect(other.error?.code).toBe('capability')
    const hmac = await runAction({ module: MODULE, manifest, operation: 'hmac', mocks })
    expect(hmac.outputs.mac).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reads and writes mocked tables, and refuses undeclared capabilities', async () => {
    const orders: Array<Record<string, unknown>> = [{ total: 1 }]
    const r = await runAction({ module: MODULE, manifest, operation: 'rows', mocks: { data: { orders } } })
    expect(r.outputs).toEqual({ total: 2, first: { total: 1 } })
    expect(orders).toHaveLength(2)
    const readOnly = { ...manifest, capabilities: { data: { read: true } } }
    expect((await runAction({ module: MODULE, manifest: readOnly, operation: 'rows', mocks: { data: { orders } } })).error?.code).toBe('capability')
    const none = { ...manifest, capabilities: {} }
    expect((await runAction({ module: MODULE, manifest: none, operation: 'file', inputs: { file: 'a.txt' }, mocks: { files: { 'a.txt': 'hi' } } })).error?.code).toBe('capability')
  })

  it('reads mocked files', async () => {
    const r = await runAction({ module: MODULE, manifest, operation: 'file', inputs: { file: 'notes.txt' }, mocks: { files: { 'notes.txt': 'hello' } } })
    expect(r.outputs).toEqual({ text: 'hello' })
  })

  it('reports timeouts, failures and unknown operations with their codes', async () => {
    const loop = await runAction({ module: MODULE, manifest, operation: 'loop', timeoutMs: 200 })
    expect(loop.error).toMatchObject({ code: 'timeout' })
    const boom = await runAction({ module: MODULE, manifest, operation: 'boom' })
    expect(boom.error).toMatchObject({ code: 'action', message: 'nope', retryable: true })
    const missing = await runAction({ module: MODULE, manifest, operation: 'nope' })
    expect(missing.error?.code).toBe('invalid')
  })
})
