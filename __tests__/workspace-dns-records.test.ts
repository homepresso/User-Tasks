import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultDnsHostTab, detectDnsProvider, dnsHostingFrom, dnsRecordsFor, recordLine, relativeHost,
  selfHostedRecords, vercelDnsRecords, vercelNameserverRecords,
} from '@/lib/workspace-dns-records'

/**
 * Settings → Workspace DNS: the records per environment and DNS host
 * (lib/workspace-dns-records), provider detection, and the page's access
 * guard (instance admins only, like Infrastructure).
 */

const session = vi.hoisted(() => ({ user: null as null | { id: string; email?: string }, allowed: false, loads: 0 }))
vi.mock('@/lib/providers/db/session', () => ({ getSessionDbWithUser: async () => ({ supabase: {}, user: session.user }) }))
vi.mock('@/lib/admin/infrastructure', () => ({
  viewerCanSeeInfrastructure: async (user: { email?: string } | null) => Boolean(user && session.allowed),
}))
vi.mock('@/lib/workspace-dns-check', () => ({
  getWorkspaceDnsReport: async () => { session.loads++; return { enabled: true, baseDomain: 'usertasks.com', checks: [] } },
}))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))

describe('detectDnsProvider', () => {
  it('recognises GoDaddy, Vercel, Cloudflare and Route 53 nameservers', () => {
    expect(detectDnsProvider(['ns51.domaincontrol.com', 'ns52.domaincontrol.com'])).toBe('godaddy')
    expect(detectDnsProvider(['NS1.VERCEL-DNS.COM.', 'ns2.vercel-dns.com'])).toBe('vercel')
    expect(detectDnsProvider(['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'])).toBe('cloudflare')
    expect(detectDnsProvider(['ns-12.awsdns-01.com', 'ns-900.awsdns-40.co.uk'])).toBe('route53')
    expect(detectDnsProvider(['ns1.example.net'])).toBe('other')
    expect(detectDnsProvider([])).toBe('unknown')
  })
  it('opens the matching tab (GoDaddy by default)', () => {
    expect(defaultDnsHostTab('godaddy')).toBe('godaddy')
    expect(defaultDnsHostTab('unknown')).toBe('godaddy')
    expect(defaultDnsHostTab('vercel')).toBe('godaddy')
    expect(defaultDnsHostTab('cloudflare')).toBe('cloudflare')
    expect(defaultDnsHostTab('route53')).toBe('other')
  })
})

describe('records', () => {
  it('Vercel option A: the two Vercel nameservers for the zone', () => {
    const r = vercelNameserverRecords({ baseDomain: 'usertasks.com' })
    expect(r.map((x) => [x.type, x.host, x.value])).toEqual([['NS', '@', 'ns1.vercel-dns.com'], ['NS', '@', 'ns2.vercel-dns.com']])
  })

  it('Vercel option B on GoDaddy: * CNAME and _acme-challenge NS, hosts relative to the zone', () => {
    const r = vercelDnsRecords({ baseDomain: 'usertasks.com' }, 'godaddy')
    expect(r.map((x) => [x.type, x.host, x.value, x.ttl])).toEqual([
      ['CNAME', '*', 'cname.vercel-dns.com', 3600],
      ['NS', '_acme-challenge', 'ns1.vercel-dns.com', 3600],
      ['NS', '_acme-challenge', 'ns2.vercel-dns.com', 3600],
    ])
    expect(r[0].fqdn).toBe('*.usertasks.com')
    expect(r[0].note).toBeUndefined()
  })

  it('Cloudflare: the CNAME says DNS only (grey cloud)', () => {
    expect(vercelDnsRecords({ baseDomain: 'usertasks.com' }, 'cloudflare')[0].note).toMatch(/DNS only/)
  })

  it('a base domain under a parent zone gets relative hosts (*.tasks)', () => {
    const r = vercelDnsRecords({ baseDomain: 'tasks.example.com', zone: 'example.com' })
    expect(r.map((x) => x.host)).toEqual(['*.tasks', '_acme-challenge.tasks', '_acme-challenge.tasks'])
    // A zone that doesn't contain the base is ignored.
    expect(vercelDnsRecords({ baseDomain: 'tasks.example.com', zone: 'other.org' })[0].host).toBe('*')
    expect(relativeHost('example.com', 'example.com')).toBe('@')
  })

  it('self-hosted: the wildcard at the apex addresses, or placeholders', () => {
    expect(selfHostedRecords({ baseDomain: 'example.com', apexAddresses: { v4: ['203.0.113.10'], v6: ['2001:db8::1'] } }).map((x) => [x.type, x.host, x.value]))
      .toEqual([['A', '*', '203.0.113.10'], ['AAAA', '*', '2001:db8::1']])
    const placeholders = selfHostedRecords({ baseDomain: 'example.com' })
    expect(placeholders.map((x) => x.type)).toEqual(['A', 'CNAME'])
    expect(placeholders[0].value).toMatch(/^</)
  })

  it('dnsRecordsFor picks by mode, host and route; recordLine is tab-separated', () => {
    const opts = { baseDomain: 'usertasks.com' }
    expect(dnsRecordsFor('vercel', opts, 'godaddy', 'nameservers').every((x) => x.type === 'NS' && x.host === '@')).toBe(true)
    expect(dnsRecordsFor('vercel', opts, 'godaddy', 'records')[0].type).toBe('CNAME')
    expect(dnsRecordsFor('self_hosted', opts)[0].host).toBe('*')
    expect(recordLine(dnsRecordsFor('vercel', opts, 'godaddy', 'records')[0])).toBe('CNAME\t*\tcname.vercel-dns.com\t3600')
  })

  it('hosting: Vercel for the cloud edition or when VERCEL is set', () => {
    expect(dnsHostingFrom({ deploymentMode: 'cloud' })).toBe('vercel')
    expect(dnsHostingFrom({ deploymentMode: 'self_hosted', vercel: '1' })).toBe('vercel')
    expect(dnsHostingFrom({ deploymentMode: 'self_hosted' })).toBe('self_hosted')
  })
})

describe('Settings → Workspace DNS access', () => {
  afterEach(() => { session.user = null; session.allowed = false; session.loads = 0 })

  it('404s for a tenant owner and anonymous visitors without running checks', async () => {
    const { default: Page } = await import('@/app/(dashboard)/settings/workspace-dns/page')
    session.user = { id: 'owner', email: 'owner@customer.com' }
    await expect(Page()).rejects.toThrow('NEXT_NOT_FOUND')
    session.user = null
    await expect(Page()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(session.loads).toBe(0)
  })

  it('renders for an instance admin', async () => {
    const { default: Page } = await import('@/app/(dashboard)/settings/workspace-dns/page')
    session.user = { id: 'admin', email: 'ops@example.com' }
    session.allowed = true
    expect(await Page()).toBeTruthy()
    expect(session.loads).toBe(1)
  })

  it('"Check again" re-checks access', async () => {
    const { checkWorkspaceDnsAction } = await import('@/app/actions/workspace-dns')
    session.user = { id: 'owner', email: 'owner@customer.com' }
    expect(await checkWorkspaceDnsAction()).toEqual({ error: expect.stringMatching(/instance admins/) })
    expect(session.loads).toBe(0)
    session.allowed = true
    expect(await checkWorkspaceDnsAction()).toHaveProperty('report')
    expect(session.loads).toBe(1)
  })

  it('the Settings link is gated on instance admin', () => {
    const nav = readFileSync(path.join(process.cwd(), 'components/settings/settings-frame.tsx'), 'utf8')
    expect(nav).toMatch(/href: "\/settings\/workspace-dns",[\s\S]{0,80}instanceAdmin: true/)
    const card = readFileSync(path.join(process.cwd(), 'components/settings/workspace-address-card.tsx'), 'utf8')
    expect(card).toMatch(/instanceAdmin\s*\n?\s*\? <>[\s\S]*\/settings\/workspace-dns/)
  })
})
