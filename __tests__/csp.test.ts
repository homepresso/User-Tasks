import { describe, expect, it } from 'vitest'
import { buildContentSecurityPolicy, supabaseConnectSources } from '@/lib/csp'

const connectSrc = (supabaseUrl: string | undefined, isDev = false) =>
  buildContentSecurityPolicy({ supabaseUrl, isDev }).split('; ').find((d) => d.startsWith('connect-src'))

describe('CSP connect-src', () => {
  it('allows only self and the hosted Supabase project (https + wss) in production', () => {
    expect(connectSrc('https://abcd.supabase.co')).toBe("connect-src 'self' https://abcd.supabase.co wss://abcd.supabase.co")
    expect(connectSrc('https://db.example.com:8443/')).toBe("connect-src 'self' https://db.example.com:8443 wss://db.example.com:8443")
  })

  it('allows plain http/ws only for a loopback Supabase (local stack)', () => {
    expect(supabaseConnectSources('http://127.0.0.1:54321')).toEqual(['http://127.0.0.1:54321', 'ws://127.0.0.1:54321'])
    expect(supabaseConnectSources('http://localhost:54321')).toEqual(['http://localhost:54321', 'ws://localhost:54321'])
    expect(supabaseConnectSources('http://[::1]:54321')).toEqual(['http://[::1]:54321', 'ws://[::1]:54321'])
  })

  it('never allows a remote plain-http origin (or a lookalike of loopback)', () => {
    for (const url of ['http://supabase.example.com', 'http://127.0.0.1.evil.com:54321', 'http://localhost.evil.com']) {
      const sources = supabaseConnectSources(url)
      expect(sources).toEqual(['https:', 'wss:'])
      expect(connectSrc(url)).not.toMatch(/http:|ws:\/\//)
    }
  })

  it('falls back to https:/wss: without a usable URL', () => {
    expect(connectSrc(undefined)).toBe("connect-src 'self' https: wss:")
    expect(connectSrc('not a url')).toBe("connect-src 'self' https: wss:")
  })

  it('keeps the rest of the policy locked down; unsafe-eval only in dev', () => {
    const prod = buildContentSecurityPolicy({ supabaseUrl: 'https://x.supabase.co', isDev: false })
    expect(prod).toContain("frame-ancestors 'none'")
    expect(prod).toContain("object-src 'none'")
    expect(prod).not.toContain('unsafe-eval')
    expect(buildContentSecurityPolicy({ supabaseUrl: 'https://x.supabase.co', isDev: true })).toContain("'unsafe-eval'")
  })
})
