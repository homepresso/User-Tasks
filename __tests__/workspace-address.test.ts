/**
 * Workspace addresses and friendly form names (lib/workspace-address.ts,
 * lib/forms/system-name.ts): subdomain validation and reserved names (the
 * TypeScript list equals the migration's SQL list), the base domain, host
 * classification, the /ws/ return hop and open-redirect protection, and
 * system-name validation, suggestion and de-duplication.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RESERVED_SUBDOMAINS, apexOrigin, canShareCookies, classifyHost, friendlyFormUrl, isUnderBaseDomain, isValidSubdomain,
  parseWorkspaceHop, resolveBaseDomain, safeLocalPath, subdomainProblem, suggestSubdomain, workspaceHopPath, workspaceOrigin,
} from '@/lib/workspace-address'
import { isValidSystemName, nextFreeSystemName, suggestSystemName, systemNameProblem } from '@/lib/forms/system-name'

const MIGRATION = readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261223000000_workspace_subdomains.sql'), 'utf8')

describe('subdomain validation', () => {
  it('accepts lowercase letters, digits and inner hyphens, 3–40 characters', () => {
    for (const ok of ['acme', 'acme-corp', 'a1b', 'abc', '123', 'x'.repeat(40), 'northwind-trading']) expect(isValidSubdomain(ok), ok).toBe(true)
  })

  it('rejects bad characters, case, length and edge hyphens', () => {
    expect(subdomainProblem('ab')).toMatch(/at least 3/)
    expect(subdomainProblem('x'.repeat(41))).toMatch(/at most 40/)
    expect(subdomainProblem('Acme')).toMatch(/lowercase/)
    expect(subdomainProblem('-acme')).toMatch(/hyphen/)
    expect(subdomainProblem('acme-')).toMatch(/hyphen/)
    expect(subdomainProblem('ac--me')).toMatch(/two hyphens/)
    expect(subdomainProblem('xn--80ak6aa92e')).toMatch(/two hyphens/)
    for (const bad of ['ac_me', 'ac.me', 'ac me', 'acmé', 'ac/me', '', null, 42]) expect(isValidSubdomain(bad), String(bad)).toBe(false)
  })

  it('refuses reserved names', () => {
    for (const name of ['www', 'app', 'api', 'docs', 'admin', 'mail', 'status', 'cdn', 'static', 'assets', 'auth', 'login', 'help', 'support', 'blog', 'gallery', 'form', 'forms']) {
      expect(subdomainProblem(name), name).toMatch(/reserved/)
    }
    // p / f / ws are reserved too (and too short anyway).
    for (const name of ['p', 'f', 'ws']) expect(isValidSubdomain(name)).toBe(false)
  })

  it('the reserved list in the migration is the same as in lib/workspace-address', () => {
    const body = /subdomain_is_reserved[\s\S]*?ARRAY\[([\s\S]*?)\]::text\[\]/.exec(MIGRATION)?.[1] ?? ''
    const sql = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect([...sql].sort()).toEqual([...RESERVED_SUBDOMAINS].sort())
  })

  it('the migration CHECK matches the TypeScript rule', () => {
    expect(MIGRATION).toMatch(/subdomain ~ '\^\[a-z0-9\]\(\[a-z0-9-\]\*\[a-z0-9\]\)\?\$' AND length\(subdomain\) BETWEEN 3 AND 40 AND position\('--' IN subdomain\) = 0/)
    expect(MIGRATION).toMatch(/length\(system_name\) BETWEEN 3 AND 60/)
  })

  it('suggests an address from a workspace name', () => {
    expect(suggestSubdomain('Acme Corp.')).toBe('acme-corp')
    expect(suggestSubdomain('Café Olé')).toBe('cafe-ole')
    expect(suggestSubdomain('IT')).toBe('it-team')
    expect(suggestSubdomain('Admin')).toBe('admin-team')
    expect(suggestSubdomain('日本')).toBe('')
  })
})

describe('base domain', () => {
  it('APP_BASE_DOMAIN wins; "off" disables', () => {
    expect(resolveBaseDomain({ baseDomain: 'usertasks.com', cloud: false })).toBe('usertasks.com')
    expect(resolveBaseDomain({ baseDomain: 'https://Tasks.Example.com/', cloud: false })).toBe('tasks.example.com')
    expect(resolveBaseDomain({ baseDomain: 'localhost', cloud: false })).toBe('localhost')
    expect(resolveBaseDomain({ baseDomain: 'off', appUrl: 'https://usertasks.com', cloud: true })).toBeNull()
    expect(resolveBaseDomain({ baseDomain: 'not a host!', cloud: true })).toBeNull()
  })

  it('cloud defaults to the app URL host (www. / app. stripped)', () => {
    expect(resolveBaseDomain({ appUrl: 'https://usertasks.com', cloud: true })).toBe('usertasks.com')
    expect(resolveBaseDomain({ appUrl: 'https://www.usertasks.com', cloud: true })).toBe('usertasks.com')
    expect(resolveBaseDomain({ appUrl: 'https://app.usertasks.com', cloud: true })).toBe('usertasks.com')
    expect(resolveBaseDomain({ appUrl: 'http://127.0.0.1:3000', cloud: true })).toBeNull()
  })

  it('self-hosted without a base domain: subdomains are off', () => {
    expect(resolveBaseDomain({ appUrl: 'https://tasks.example.com', cloud: false })).toBeNull()
    expect(resolveBaseDomain({})).toBeNull()
  })
})

describe('host classification', () => {
  const base = 'usertasks.com'
  it('the apex, www and app keep working as today', () => {
    expect(classifyHost('usertasks.com', base)).toEqual({ kind: 'apex' })
    expect(classifyHost('www.usertasks.com', base)).toEqual({ kind: 'apex' })
    expect(classifyHost('app.usertasks.com:443', base)).toEqual({ kind: 'apex' })
  })

  it('a single valid label is a workspace address', () => {
    expect(classifyHost('acme.usertasks.com', base)).toEqual({ kind: 'workspace', label: 'acme' })
    expect(classifyHost('ACME.UserTasks.com.', base)).toEqual({ kind: 'workspace', label: 'acme' })
    expect(classifyHost('acme.localhost:3100', 'localhost')).toEqual({ kind: 'workspace', label: 'acme' })
  })

  it('reserved, malformed or nested labels are invalid (404), other hosts are left alone', () => {
    expect(classifyHost('api.usertasks.com', base)).toEqual({ kind: 'invalid' })
    expect(classifyHost('a.b.usertasks.com', base)).toEqual({ kind: 'invalid' })
    expect(classifyHost('ac--me.usertasks.com', base)).toEqual({ kind: 'invalid' })
    expect(classifyHost('evilusertasks.com', base)).toEqual({ kind: 'none' })
    expect(classifyHost('usertasks.com.evil.com', base)).toEqual({ kind: 'none' })
    expect(classifyHost('my-app.vercel.app', base)).toEqual({ kind: 'none' })
    expect(classifyHost('acme.usertasks.com', null)).toEqual({ kind: 'none' })
  })

  it('cookie scoping: under the base domain only; shared only for a dotted, Secure base', () => {
    expect(isUnderBaseDomain('acme.usertasks.com', base)).toBe(true)
    expect(isUnderBaseDomain('usertasks.com', base)).toBe(true)
    expect(isUnderBaseDomain('evilusertasks.com', base)).toBe(false)
    expect(canShareCookies(base, true)).toBe(true)
    expect(canShareCookies(base, false)).toBe(false)
    expect(canShareCookies('localhost', true)).toBe(false)
    expect(canShareCookies(null, true)).toBe(false)
  })
})

describe('URLs and the /ws/ return hop (open-redirect protection)', () => {
  it('workspace and apex origins follow the app URL scheme and port', () => {
    expect(workspaceOrigin('acme', 'usertasks.com', 'https://usertasks.com')).toBe('https://acme.usertasks.com')
    expect(workspaceOrigin('acme', 'localhost', 'http://localhost:3100')).toBe('http://acme.localhost:3100')
    expect(apexOrigin('usertasks.com', 'https://www.usertasks.com')).toBe('https://www.usertasks.com')
    expect(apexOrigin('usertasks.com', 'https://other.example')).toBe('https://usertasks.com')
    expect(friendlyFormUrl('https://acme.usertasks.com/', 'employee-onboarding')).toBe('https://acme.usertasks.com/form/employee-onboarding')
  })

  it('builds and parses a hop for our own subdomain and a same-origin path', () => {
    expect(workspaceHopPath('acme', '/form/x?a=1')).toBe('/ws/acme/form/x?a=1')
    expect(workspaceHopPath('acme', '/')).toBe('/ws/acme')
    expect(workspaceHopPath('acme', 'https://evil.com')).toBe('/ws/acme')
    expect(parseWorkspaceHop('/ws/acme/form/x', '?a=1')).toEqual({ subdomain: 'acme', path: '/form/x?a=1' })
    expect(parseWorkspaceHop('/ws/acme')).toEqual({ subdomain: 'acme', path: '/' })
  })

  it('never lets a hop name another host', () => {
    for (const bad of ['/ws/evil.com/x', '/ws/evil.com', '/ws/acme.evil.com/', '/ws/www/x', '/ws/a/x', '/ws/acme//evil.com', '/ws/acme/\\evil.com', '/ws/%2F%2Fevil.com', '/ws/acme@evil.com/x', '/wsx/acme']) {
      expect(parseWorkspaceHop(bad), bad).toBeNull()
    }
    expect(parseWorkspaceHop('/ws/acme/https://evil.com')).toBeNull()
  })

  it('safeLocalPath keeps paths, drops anything that leaves the origin', () => {
    expect(safeLocalPath('/home')).toBe('/home')
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'evil.com', '/x\r\nSet-Cookie: a=b', '', null]) expect(safeLocalPath(bad)).toBeNull()
  })
})

describe('form system names', () => {
  it('same rules as subdomains, 3–60 characters, no reserved list', () => {
    expect(isValidSystemName('employee-onboarding')).toBe(true)
    expect(isValidSystemName('www')).toBe(true)
    expect(isValidSystemName('x'.repeat(60))).toBe(true)
    expect(systemNameProblem('x'.repeat(61))).toMatch(/at most 60/)
    expect(systemNameProblem('ab')).toMatch(/at least 3/)
    expect(systemNameProblem('Employee')).toMatch(/lowercase/)
    expect(systemNameProblem('-a-b')).toMatch(/hyphen/)
    expect(systemNameProblem('a--b')).toMatch(/two hyphens/)
    expect(systemNameProblem('a_b')).toMatch(/letters/)
  })

  it('suggests from the form name', () => {
    expect(suggestSystemName('Employee onboarding')).toBe('employee-onboarding')
    expect(suggestSystemName('  Expense claim (v2)!  ')).toBe('expense-claim-v2')
    expect(suggestSystemName('Ünïcodé form')).toBe('unicode-form')
    expect(suggestSystemName('HR')).toBe('form-hr')
    expect(suggestSystemName('日本語')).toBe('form')
    expect(suggestSystemName('x'.repeat(80)).length).toBe(60)
  })

  it('de-duplicates with -2, -3 … and keeps within 60 characters', () => {
    expect(nextFreeSystemName('visitor', new Set())).toBe('visitor')
    expect(nextFreeSystemName('visitor', new Set(['visitor']))).toBe('visitor-2')
    expect(nextFreeSystemName('visitor', new Set(['visitor', 'visitor-2']))).toBe('visitor-3')
    const long = 'x'.repeat(60)
    const next = nextFreeSystemName(long, new Set([long]))
    expect(next.length).toBeLessThanOrEqual(60)
    expect(next.endsWith('-2')).toBe(true)
  })
})
