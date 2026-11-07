import { describe, expect, it } from 'vitest'
import { runInSandbox } from '@/lib/custom-actions/sandbox'
import { createActionHost, syncHelpers, zonedParts, zonedToUtc } from '@/lib/custom-actions/host'
import { parseActionManifest } from '@/lib/custom-actions/manifest'

const run = (source: string, extra: Partial<Parameters<typeof runInSandbox>[0]> = {}) => runInSandbox({
  source, mode: 'module', operation: 'go', inputs: {}, timeoutMs: 2000, memoryMb: 16, host: { callSync: syncHelpers }, ...extra,
})

describe('custom action sandbox: isolation', () => {
  it('runs an operation and returns its outputs', async () => {
    const r = await run(`export default { operations: { go: (i) => ({ sum: i.a + i.b }) } }`, { inputs: { a: 2, b: 3 } })
    expect(r.ok).toBe(true)
    expect(r.outputs).toEqual({ sum: 5 })
    expect(r.stats.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('accepts a default-exported function and async operations', async () => {
    const r = await run(`export default async function (i) { await null; return { twice: i.n * 2 } }`, { inputs: { n: 21 } })
    expect(r.outputs).toEqual({ twice: 42 })
  })

  it('has no process, require, env, fs, fetch, timers or host globals', async () => {
    const r = await run(`export default { operations: { go: () => ({
      process: typeof process, require: typeof require, fetch: typeof fetch, setTimeout: typeof setTimeout,
      Buffer: typeof Buffer, hostCall: typeof __ut_host_call, hostSync: typeof __ut_host_sync,
      escape: (() => { try { return typeof (0).constructor.constructor('return this')().process } catch (e) { return 'threw' } })(),
      importMeta: typeof globalThis.import,
    }) } }`)
    expect(r.ok).toBe(true)
    expect(r.outputs).toEqual({ process: 'undefined', require: 'undefined', fetch: 'undefined', setTimeout: 'undefined', Buffer: 'undefined', hostCall: 'undefined', hostSync: 'undefined', escape: 'undefined', importMeta: 'undefined' })
  })

  it('refuses imports (one self-contained module)', async () => {
    const r = await run(`import fs from 'fs'; export default { operations: { go: () => ({ x: typeof fs }) } }`)
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('invalid')
  })

  it('interrupts an infinite loop at the deadline', async () => {
    const started = Date.now()
    const r = await run(`export default { operations: { go: () => { while (true) {} } } }`, { timeoutMs: 300 })
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('stops a run that allocates past its memory cap', async () => {
    const r = await run(`export default { operations: { go: () => { const a = []; for (;;) a.push({ i: a.length, s: 'y' + a.length }) } } }`, { memoryMb: 8, timeoutMs: 5000 })
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('memory')
  })

  it('stops runaway recursion', async () => {
    const r = await run(`export default { operations: { go: () => { const f = (n) => f(n + 1) + 1; return { x: f(0) } } } }`)
    expect(r.ok).toBe(false)
    expect(['memory', 'action']).toContain(r.error?.code)
  })

  it('a later run sees nothing from an earlier one', async () => {
    await run(`globalThis.leak = 'secret'; export default { operations: { go: () => ({}) } }`)
    const r = await run(`export default { operations: { go: () => ({ leak: typeof globalThis.leak }) } }`)
    expect(r.outputs).toEqual({ leak: 'undefined' })
  })

  it('reports a thrown error and ctx.fail retry hints', async () => {
    const thrown = await run(`export default { operations: { go: () => { throw new Error('nope') } } }`)
    expect(thrown.error).toMatchObject({ code: 'action', message: 'nope', retryable: false })
    const failed = await run(`export default { operations: { go: (i, ctx) => ctx.fail('try later', { retryable: true }) } }`)
    expect(failed.error).toMatchObject({ code: 'action', message: 'try later', retryable: true })
  })

  it('an unknown operation is invalid; a non-object result is invalid', async () => {
    const r = await run(`export default { operations: { other: () => ({}) } }`)
    expect(r.error?.code).toBe('invalid')
    const r2 = await run(`export default { operations: { go: () => 42 } }`)
    expect(r2.error?.code).toBe('invalid')
  })

  it('collects logs (console and ctx.log)', async () => {
    const r = await run(`export default { operations: { go: (i, ctx) => { console.log('hello'); ctx.log.warn('careful', { n: 1 }); return {} } } }`)
    expect(r.logs.map((l) => [l.level, l.message])).toEqual([['info', 'hello'], ['warn', 'careful']])
    expect(r.logs[1].metadata).toEqual({ n: 1 })
  })

  it('a promise that never settles fails instead of hanging', async () => {
    const r = await run(`export default { operations: { go: () => new Promise(() => {}) } }`)
    expect(r.ok).toBe(false)
  })

  it('crypto and intl helpers are available without capabilities', async () => {
    const r = await run(`export default { operations: { go: (i, ctx) => ({
      uuid: ctx.crypto.randomUUID(), sha: ctx.crypto.digest('SHA-256', 'abc'),
      money: ctx.intl.formatNumber(1234.5, 'de-DE', { style: 'currency', currency: 'EUR' }),
    }) } }`)
    expect(r.ok).toBe(true)
    expect(String(r.outputs.uuid)).toMatch(/^[0-9a-f-]{36}$/)
    expect(r.outputs.sha).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(String(r.outputs.money).replace(/\s/g, ' ')).toBe('1.234,50 €')
  })

  it('runs legacy activity sources (run function, body return, helpers)', async () => {
    const a = await runInSandbox({ source: 'async function run(inputs, context, helpers) { helpers.setVariable("seen", inputs.x); return { outputs: { y: inputs.x + 1 } } }', mode: 'legacy', operation: 'run', inputs: { x: 1 }, timeoutMs: 1000, memoryMb: 16, host: { callSync: syncHelpers }, legacy: { context: {}, variables: {} } })
    expect(a.ok).toBe(true)
    expect(a.raw).toEqual({ outputs: { y: 2 } })
    expect(a.variables).toEqual({ seen: 1 })
    const b = await runInSandbox({ source: 'return { outputs: { v: helpers.getVariable("name") } }', mode: 'legacy', operation: 'run', inputs: {}, timeoutMs: 1000, memoryMb: 16, host: { callSync: syncHelpers }, legacy: { context: {}, variables: { name: 'Ada' } } })
    expect(b.raw).toEqual({ outputs: { v: 'Ada' } })
    const c = await runInSandbox({ source: 'function run() { return { outputs: { p: typeof process } } }', mode: 'legacy', operation: 'run', inputs: {}, timeoutMs: 1000, memoryMb: 16, legacy: { context: {}, variables: {} } })
    expect(c.raw).toEqual({ outputs: { p: 'undefined' } })
  })
})

describe('custom action host: capability gating', () => {
  const manifest = parseActionManifest({
    key: 'acme_test', name: 'Test', version: '1.0.0',
    operations: [{ id: 'go', inputs: [{ name: 'doc', type: 'file' }], outputs: [{ name: 'x', type: 'json' }] }],
    capabilities: { http: { hosts: ['api.example.com', 'other.example.com'] }, credentials: [{ name: 'api_key' }], data: { read: true } },
  })
  const bare = parseActionManifest({ key: 'acme_bare', name: 'Bare', version: '1.0.0', operations: [{ id: 'go', outputs: [{ name: 'x', type: 'json' }] }] })
  const calls: string[] = []
  const fetchImpl = (async (url: string) => {
    calls.push(String(url))
    return new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  const hostFor = (m = manifest, grants: Partial<Parameters<typeof createActionHost>[0]['grants']> = {}) => createActionHost({
    manifest: m, operation: m.operations[0], inputs: { doc: { url: 'storage://a/b.pdf', name: 'b.pdf' } },
    grants: { approved_hosts: ['api.example.com'], data_grants: [{ table_id: 't1', name: 'Customers', access: 'read' }], secret_values: { api_key: 'enc' }, ...grants },
    deps: { tenantId: 'tenant', fetchImpl, decrypt: (v) => (v === 'enc' ? 'plain-key' : v) },
    remainingMs: () => 5000,
  })
  const go = (src: string, host = hostFor()) => runInSandbox({ source: `export default { operations: { go: async (i, ctx) => { ${src} } } }`, mode: 'module', operation: 'go', inputs: { doc: { url: 'storage://a/b.pdf' } }, timeoutMs: 3000, memoryMb: 16, host })

  it('HTTP: only approved and declared hosts', async () => {
    const ok = await go(`const r = await ctx.http.fetch('https://api.example.com/v1'); return { x: r.json }`)
    expect(ok.outputs).toEqual({ x: { ok: 1 } })
    const declaredNotApproved = await go(`await ctx.http.fetch('https://other.example.com/'); return {}`)
    expect(declaredNotApproved.error?.code).toBe('capability')
    const undeclared = await go(`await ctx.http.fetch('https://evil.example.net/'); return {}`)
    expect(undeclared.error?.code).toBe('capability')
    const none = await go(`await ctx.http.fetch('https://api.example.com/'); return {}`, hostFor(bare))
    expect(none.error?.code).toBe('capability')
    expect(calls).toEqual(['https://api.example.com/v1'])
  })

  it('HTTP: the egress guard blocks private addresses even when approved', async () => {
    const m = parseActionManifest({ key: 'acme_local', name: 'L', version: '1.0.0', operations: [{ id: 'go', outputs: [{ name: 'x', type: 'json' }] }], capabilities: { http: { hosts: ['localhost.localdomain', 'metadata.google.internal'] } } })
    const r = await go(`await ctx.http.fetch('http://metadata.google.internal/'); return {}`, hostFor(m, { approved_hosts: ['metadata.google.internal'] }))
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('capability')
  })

  it('secrets: only declared names, via secret://', async () => {
    const ok = await go(`return { x: await ctx.secrets.get('secret://api_key') }`)
    expect(ok.outputs).toEqual({ x: 'plain-key' })
    const undeclared = await go(`return { x: await ctx.secrets.get('secret://other') }`)
    expect(undeclared.error?.code).toBe('capability')
    const none = await go(`return { x: await ctx.secrets.get('secret://api_key') }`, hostFor(bare))
    expect(none.error?.code).toBe('capability')
    const unset = await go(`return { x: await ctx.secrets.get('secret://api_key') }`, hostFor(manifest, { secret_values: {} }))
    expect(unset.error?.code).toBe('host')
  })

  it('hmac with a secret ref resolves the secret on the host', async () => {
    const r = await go(`return { x: await ctx.crypto.hmac('SHA-256', 'secret://api_key', 'msg') }`)
    const { createHmac } = await import('node:crypto')
    expect(r.outputs).toEqual({ x: createHmac('sha256', 'plain-key').update('msg').digest('hex') })
  })

  it('data: only granted tables, write needs write access', async () => {
    const ungranted = await go(`await ctx.data.query('Orders'); return {}`)
    expect(ungranted.error?.code).toBe('capability')
    const write = await go(`await ctx.data.insert('Customers', { a: 1 }); return {}`)
    expect(write.error?.code).toBe('capability')
    const none = await go(`await ctx.data.query('Customers'); return {}`, hostFor(bare))
    expect(none.error?.code).toBe('capability')
  })

  it('files: only files given as file inputs', async () => {
    const r = await go(`await ctx.files.read('storage://other/secret.pdf'); return {}`)
    expect(r.error?.code).toBe('capability')
  })

  it('caps host calls per run', async () => {
    const r = await go(`for (let i = 0; i < 500; i++) { try { await ctx.secrets.get('secret://nope') } catch (e) { if (/More than/.test(e.message)) throw e } } return {}`)
    expect(r.ok).toBe(false)
    expect(r.error?.message).toMatch(/More than/)
  })
})

describe('intl time zone helpers', () => {
  it('zoned parts and local → UTC across DST', () => {
    expect(zonedParts('2026-07-01T00:00:00Z', 'Pacific/Auckland')).toMatchObject({ year: 2026, month: 7, day: 1, hour: 12, offset_minutes: 720 })
    expect(zonedToUtc('2026-01-15T09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z')
    expect(zonedToUtc('2026-07-15T09:00', 'America/New_York')).toBe('2026-07-15T13:00:00.000Z')
  })
})
