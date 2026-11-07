/**
 * #6 GET /api/version and the version in /api/config/public: package.json
 * version, the git commit from VERCEL_GIT_COMMIT_SHA / GIT_COMMIT /
 * SOURCE_COMMIT (hex SHAs only), the build time; public, cached briefly,
 * nothing secret.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GET } from '@/app/api/version/route'
import { buildCommit, versionInfo } from '@/lib/version'

const NAMES = ['VERCEL_GIT_COMMIT_SHA', 'GIT_COMMIT', 'SOURCE_COMMIT', 'BUILD_TIME', 'SUPABASE_SERVICE_ROLE_KEY'] as const
const saved: Record<string, string | undefined> = {}
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }

beforeEach(() => {
  for (const name of NAMES) { saved[name] = process.env[name]; delete process.env[name] }
})
afterEach(() => {
  for (const name of NAMES) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
})

describe('GET /api/version', () => {
  it('returns the package version, no commit and no build time when none is configured', async () => {
    const res = GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60')
    expect(await res.json()).toEqual({ version: pkg.version, commit: null, buildTime: null })
  })

  it('takes the commit from VERCEL_GIT_COMMIT_SHA, then GIT_COMMIT, then SOURCE_COMMIT', () => {
    process.env.SOURCE_COMMIT = 'c'.repeat(40)
    expect(buildCommit()).toBe('c'.repeat(40))
    process.env.GIT_COMMIT = ' ABCDEF1 '
    expect(buildCommit()).toBe('abcdef1')
    process.env.VERCEL_GIT_COMMIT_SHA = 'a'.repeat(40)
    expect(buildCommit()).toBe('a'.repeat(40))
  })

  it('never echoes anything but a hex SHA, and normalises the build time', () => {
    process.env.GIT_COMMIT = 'not-a-sha; secret=1'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-secret'
    process.env.BUILD_TIME = '2026-11-07T10:00:00Z'
    const info = versionInfo()
    expect(info).toEqual({ version: pkg.version, commit: null, buildTime: '2026-11-07T10:00:00.000Z' })
    expect(JSON.stringify(info)).not.toContain('secret')
    process.env.BUILD_TIME = 'yesterday-ish'
    expect(versionInfo().buildTime).toBeNull()
  })
})
