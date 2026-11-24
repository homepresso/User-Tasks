/**
 * The dashboard's cached role and permissions follow the current workspace.
 * Seen in a real browser: a user who owns one workspace and is a member of
 * another opened the second one's address in another tab (which switches the
 * current workspace); reloading the first tab still showed the owner's
 * controls (the workspace address editable) on the workspace where they are
 * only a member, for up to 50 minutes. The reverse made an owner's own
 * settings read-only.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cachedAuthMatchesWorkspace } from '@/lib/dashboard-auth-cache'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('cachedAuthMatchesWorkspace', () => {
  const cachedFor = (tenant: string | null) => ({ profile: { current_tenant_id: tenant } })

  it('keeps a cache for the workspace the server renders', () => {
    expect(cachedAuthMatchesWorkspace(cachedFor('acme'), 'acme')).toBe(true)
    expect(cachedAuthMatchesWorkspace(cachedFor(null), null)).toBe(true)
  })

  it("drops another workspace's role and permissions", () => {
    expect(cachedAuthMatchesWorkspace(cachedFor('bravo'), 'acme')).toBe(false)
    expect(cachedAuthMatchesWorkspace(cachedFor('acme'), null)).toBe(false)
    expect(cachedAuthMatchesWorkspace(cachedFor(null), 'acme')).toBe(false)
    expect(cachedAuthMatchesWorkspace({ profile: null }, 'acme')).toBe(false)
  })

  it('trusts the cache when the server did not say (embed shells, signed out)', () => {
    expect(cachedAuthMatchesWorkspace(cachedFor('bravo'), undefined)).toBe(true)
  })

  it('no cache is never a match', () => {
    expect(cachedAuthMatchesWorkspace(null, 'acme')).toBe(false)
    expect(cachedAuthMatchesWorkspace(undefined, undefined)).toBe(false)
  })
})

describe('wiring', () => {
  it('the dashboard layout tells the auth provider the current workspace', () => {
    const layout = read('app/(dashboard)/layout.tsx')
    expect(layout).toMatch(/<DashboardAuthProvider currentTenantId=\{/)
    expect(layout).toContain('loadSessionWorkspace()')
  })

  it('the auth provider checks every cache read against it', () => {
    const src = read('lib/dashboard-auth-context.tsx')
    expect(src).toContain('cachedAuthMatchesWorkspace(parsed, serverTenantId)')
    expect(src.match(/readCache\(currentTenantId\)/g)?.length).toBe(2)
  })
})
