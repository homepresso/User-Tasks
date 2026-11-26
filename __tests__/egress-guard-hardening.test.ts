/**
 * Egress guard (QA 2026-11-24): reserved IPv4 space is not "public", and
 * safeFetch never forwards credentials to another origin on a redirect.
 */
import { describe, expect, it, vi } from 'vitest'
import { assertSafeEgressUrl, safeFetch } from '@/lib/egress-guard'

describe('egress guard hardening', () => {
  it.each(['192.0.0.170', '198.18.0.1', '198.19.255.254', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255'])('blocks reserved address %s', async (ip) => {
    await expect(assertSafeEgressUrl(`http://${ip}/`)).rejects.toThrow()
  })

  it('still allows a public address', async () => {
    await expect(assertSafeEgressUrl('https://8.8.8.8/')).resolves.toBeTruthy()
  })

  it('drops credential headers when a redirect leaves the origin, keeps them on the same origin', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const responses = [
      new Response(null, { status: 302, headers: { location: 'https://8.8.8.8/same' } }),
      new Response(null, { status: 302, headers: { location: 'https://1.1.1.1/other' } }),
      new Response('ok', { status: 200 }),
    ]
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), headers: { ...(init?.headers ?? {}) } })
      return responses.shift()!
    }) as unknown as typeof fetch
    const res = await safeFetch('https://8.8.8.8/start', { headers: { Authorization: 'Bearer s3cret', 'X-Api-Secret': 'x', Accept: 'application/json' } }, { fetchImpl })
    expect(res.status).toBe(200)
    expect(calls[1].headers.Authorization).toBe('Bearer s3cret')
    expect(calls[2].headers).toEqual({ Accept: 'application/json' })
  })
})
