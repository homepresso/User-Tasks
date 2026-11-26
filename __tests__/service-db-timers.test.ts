/**
 * GitHub issue #14 (web server heap grows until "JavaScript heap out of
 * memory"): every server-side database client must be collectable once its
 * caller is done with it. supabase-js's default auth options start a 30 s
 * setInterval per client in Node (GoTrueClient auto-refresh), which is never
 * cleared and keeps the whole client reachable, so a client created per call
 * leaked one client + one timer per call for the life of the process.
 *
 * Uses the real @supabase/supabase-js (no mock) with fake timers: creating
 * many clients through the factories must leave no timer behind. No network:
 * DB_PROVIDER=postgres clients answer REST in-process and are never queried.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ENV_KEYS = ['DB_PROVIDER', 'DATABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const
const saved: Record<string, string | undefined> = {}

/** Let supabase-js finish its async constructor work (GoTrueClient._initialize). */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  vi.resetModules()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('server database clients start no background timers (issue #14)', () => {
  it('getServiceDb with DB_PROVIDER=postgres', async () => {
    process.env.DB_PROVIDER = 'postgres'
    process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:1/db'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
    const { getServiceDb } = await import('@/lib/providers/db')
    await settle()
    const before = vi.getTimerCount()
    for (let i = 0; i < 50; i++) getServiceDb()
    await settle()
    expect(vi.getTimerCount() - before).toBe(0)
  })

  it('getServiceDb against a Supabase project (DB_PROVIDER=supabase)', async () => {
    process.env.DB_PROVIDER = 'supabase'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
    const { getServiceDb } = await import('@/lib/providers/db')
    await settle()
    const before = vi.getTimerCount()
    for (let i = 0; i < 50; i++) getServiceDb()
    await settle()
    expect(vi.getTimerCount() - before).toBe(0)
  })

  it('getIdentityDb (built-in / OIDC / SAML session clients)', async () => {
    process.env.DB_PROVIDER = 'postgres'
    process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:1/db'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    const { getIdentityDb } = await import('@/lib/providers/db')
    await settle()
    const before = vi.getTimerCount()
    for (let i = 0; i < 50; i++) await getIdentityDb({ role: 'authenticated', claims: { sub: `u${i}` } } as never)
    await getIdentityDb(null)
    await settle()
    expect(vi.getTimerCount() - before).toBe(0)
  })

  it('control: supabase-js defaults do start one timer per client (what the factories must avoid)', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    await settle()
    const before = vi.getTimerCount()
    for (let i = 0; i < 5; i++) createClient('http://127.0.0.1:54321', 'service')
    await settle()
    expect(vi.getTimerCount() - before).toBe(5)
  })
})
