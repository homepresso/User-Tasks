import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /setup and the redirects to it: 404 in the cloud edition, /login once the
 * install has an admin, and `/`, `/login` and the dashboard send a brand-new
 * self-hosted install to /setup.
 */
const env = vi.hoisted(() => ({ mode: 'self_hosted' as 'cloud' | 'self_hosted', empty: true, hasDb: true }))

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) },
}))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/deployment', () => ({
  getDeploymentMode: () => env.mode,
  isCloud: () => env.mode === 'cloud',
}))
vi.mock('@/lib/providers/db', () => ({
  hasServiceDb: () => env.hasDb,
  getServiceDb: () => ({
    from: (table: string) => ({
      select: () => ({ limit: async () => ({ data: env.empty || table === 'instance_settings' ? [] : [{ id: 'x' }], error: null }) }),
    }),
  }),
}))
vi.mock('@/app/(auth)/setup/setup-form', () => ({ SetupForm: () => null }))

const { resetSetupStateForTests } = await import('@/lib/setup/state')
const { redirectToSetupIfNeeded, setupNeeded } = await import('@/lib/setup/server')
const { default: SetupPage } = await import('@/app/(auth)/setup/page')

beforeEach(() => {
  resetSetupStateForTests()
  Object.assign(env, { mode: 'self_hosted', empty: true, hasDb: true })
})

describe('/setup', () => {
  it('shows on an empty self-hosted install', async () => {
    expect(await SetupPage()).toBeTruthy()
  })

  it('is a 404 in the cloud edition', async () => {
    env.mode = 'cloud'
    await expect(SetupPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('redirects to /login once the install has an admin', async () => {
    env.empty = false
    await expect(SetupPage()).rejects.toThrow('NEXT_REDIRECT /login')
  })
})

describe('redirects while setup is needed', () => {
  it('sends `/`, `/login` and dashboard pages to /setup', async () => {
    await expect(redirectToSetupIfNeeded()).rejects.toThrow('NEXT_REDIRECT /setup')
  })

  it('does nothing once set up, in the cloud edition, or without a database', async () => {
    env.empty = false
    await expect(redirectToSetupIfNeeded()).resolves.toBeUndefined()
    resetSetupStateForTests()
    Object.assign(env, { empty: true, mode: 'cloud' })
    expect(await setupNeeded()).toBe(false)
    Object.assign(env, { mode: 'self_hosted', hasDb: false })
    expect(await setupNeeded()).toBe(false)
  })

  it('is wired into the root page, the login page and the dashboard layout (not docs or APIs)', () => {
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
    for (const file of ['app/page.tsx', 'app/(auth)/login/page.tsx', 'app/(dashboard)/layout.tsx']) {
      expect(read(file)).toMatch(/await redirectToSetupIfNeeded\(\)/)
    }
    expect(read('app/docs/layout.tsx')).not.toMatch(/redirectToSetupIfNeeded/)
    expect(read('proxy.ts')).not.toMatch(/setup/i)
    // Startup logs the code (self-hosted only, in the background).
    expect(read("instrumentation.ts")).toMatch(/announceSetupCode\(setupDb\(\), { startup: true }\)/)
  })
})
