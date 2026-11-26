import { afterEach, describe, expect, it } from 'vitest'
import { clientIpFrom } from '@/lib/client-ip'
import { visitorIp } from '@/lib/public-forms/route'

// Per-IP rate limits must not take the client-settable left end of
// X-Forwarded-For (2026-11 QA pass): behind an appending proxy a random
// header per request never tripped a limit.
const h = (values: Record<string, string>) => new Headers(values)

describe('clientIpFrom', () => {
  const prev = { hops: process.env.TRUSTED_PROXY_HOPS, vercel: process.env.VERCEL }
  afterEach(() => {
    if (prev.hops === undefined) delete process.env.TRUSTED_PROXY_HOPS; else process.env.TRUSTED_PROXY_HOPS = prev.hops
    if (prev.vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = prev.vercel
  })

  it('behind one appending proxy (default) takes the right-most entry, not the spoofed left one', () => {
    delete process.env.VERCEL
    delete process.env.TRUSTED_PROXY_HOPS
    expect(clientIpFrom(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }))).toBe('203.0.113.9')
    expect(clientIpFrom(h({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9')
  })

  it('TRUSTED_PROXY_HOPS=2 (CDN + nginx) takes the second from the right', () => {
    delete process.env.VERCEL
    process.env.TRUSTED_PROXY_HOPS = '2'
    expect(clientIpFrom(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 198.51.100.1' }))).toBe('203.0.113.9')
  })

  it('TRUSTED_PROXY_HOPS=0 ignores X-Forwarded-For', () => {
    delete process.env.VERCEL
    process.env.TRUSTED_PROXY_HOPS = '0'
    expect(clientIpFrom(h({ 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9')
    expect(clientIpFrom(h({ 'x-forwarded-for': '6.6.6.6' }))).toBeNull()
  })

  it('on Vercel uses the platform header', () => {
    process.env.VERCEL = '1'
    expect(clientIpFrom(h({ 'x-vercel-forwarded-for': '203.0.113.9', 'x-forwarded-for': '6.6.6.6' }))).toBe('203.0.113.9')
  })

  it('public-form visitor IPs follow the same rule', () => {
    delete process.env.VERCEL
    delete process.env.TRUSTED_PROXY_HOPS
    expect(visitorIp(new Request('http://x', { headers: { 'x-forwarded-for': `${Math.random()}, 203.0.113.9` } }))).toBe('203.0.113.9')
    expect(visitorIp(new Request('http://x'))).toBe('unknown')
  })
})
