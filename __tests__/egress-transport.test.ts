/**
 * Connection pinning (lib/egress-transport): the socket's own DNS lookup is
 * the egress check, so a name cannot pass the guard with a public address and
 * then connect to a blocked one (DNS rebinding). 2026-11 QA pass.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

// The guard's pre-check (assertSafeEgressUrl) resolves through node:dns/promises.
const precheck = vi.hoisted(() => ({ answers: {} as Record<string, string> }))
vi.mock('node:dns/promises', async (orig) => ({
  ...(await orig<object>()),
  lookup: async (host: string) => [{ address: precheck.answers[host] ?? '93.184.216.34', family: 4 }],
}))

import { EgressBlockedError, safeFetch } from '@/lib/egress-guard'
import { connectorFetch } from '@/lib/integrations/http'
import { egressLookup, setEgressResolver } from '@/lib/egress-transport'

let server: http.Server
let port = 0
beforeAll(async () => {
  server = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ host: req.headers.host })) })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  port = (server.address() as AddressInfo).port
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))
afterEach(() => {
  setEgressResolver(null)
  precheck.answers = {}
  delete process.env.ALLOW_PRIVATE_EGRESS
})

/** A resolver that answers `first` once, then `later` (a rebinding DNS server). */
function rebinding(first: string, later: string) {
  let calls = 0
  return vi.fn(async () => [{ address: calls++ === 0 ? first : later, family: 4 }])
}

describe('pinned egress transport', () => {
  it.each(['127.0.0.1', '169.254.169.254'])('refuses a name that rebinds to %s after the check passed', async (target) => {
    // The guard's check sees a public address; the connection's lookup gets the blocked one.
    setEgressResolver(rebinding(target, target))
    await expect(connectorFetch(`http://rebind.example.test:${port}/x`, {}, { retry: 'never' })).rejects.toBeInstanceOf(EgressBlockedError)
    await expect(safeFetch(`http://rebind.example.test:${port}/x`)).rejects.toBeInstanceOf(EgressBlockedError)
  })

  it('a resolver answering public first and loopback second is refused at connect (pinned lookup is the one used)', async () => {
    const resolver = rebinding('93.184.216.34', '127.0.0.1')
    setEgressResolver(resolver)
    const first = await new Promise<unknown>((r) => egressLookup('flip.example.test', { all: true }, (err, addr) => r(err ?? addr)))
    expect(first).toEqual([{ address: '93.184.216.34', family: 4 }])
    const second = await new Promise<unknown>((r) => egressLookup('flip.example.test', { all: true }, (err, addr) => r(err ?? addr)))
    expect(second).toBeInstanceOf(EgressBlockedError)
  })

  it('refuses a mixed answer (any blocked address refuses the name)', async () => {
    setEgressResolver(async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }])
    const out = await new Promise<unknown>((r) => egressLookup('mixed.example.test', {}, (err, addr) => r(err ?? addr)))
    expect(out).toBeInstanceOf(EgressBlockedError)
  })

  it('a normal public host is allowed (lookup returns its address)', async () => {
    setEgressResolver(async () => [{ address: '93.184.216.34', family: 4 }])
    const out = await new Promise<unknown>((r) => egressLookup('api.example.com', {}, (err, addr, family) => r(err ?? [addr, family])))
    expect(out).toEqual(['93.184.216.34', 4])
  })

  it('connects to the address its own lookup checked (ALLOW_PRIVATE_EGRESS keeps private targets working; Host unchanged)', async () => {
    process.env.ALLOW_PRIVATE_EGRESS = 'true'
    precheck.answers['pinned.example.test'] = '127.0.0.1'
    setEgressResolver(async () => [{ address: '127.0.0.1', family: 4 }])
    const res = await connectorFetch(`http://pinned.example.test:${port}/ok`, {}, { retry: 'never' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ host: `pinned.example.test:${port}` })
  })

  it('metadata addresses stay blocked even with ALLOW_PRIVATE_EGRESS', async () => {
    process.env.ALLOW_PRIVATE_EGRESS = 'true'
    setEgressResolver(async () => [{ address: '169.254.169.254', family: 4 }])
    await expect(connectorFetch(`http://meta.example.test:${port}/`, {}, { retry: 'never' })).rejects.toBeInstanceOf(EgressBlockedError)
  })

  it('IP-literal hosts are checked before connecting', async () => {
    setEgressResolver(async () => [{ address: '93.184.216.34', family: 4 }]) // opt in to the real transport
    await expect(safeFetch(`http://127.0.0.1:${port}/`, {}, { fetchImpl: undefined })).rejects.toBeInstanceOf(EgressBlockedError)
  })

  it('FormData bodies from the runtime are sent', async () => {
    process.env.ALLOW_PRIVATE_EGRESS = 'true'
    precheck.answers['form.example.test'] = '127.0.0.1'
    setEgressResolver(async () => [{ address: '127.0.0.1', family: 4 }])
    const form = new FormData()
    form.append('a', '1')
    const res = await connectorFetch(`http://form.example.test:${port}/f`, { method: 'POST', body: form }, { retry: 'never' })
    expect(res.status).toBe(200)
  })
})
