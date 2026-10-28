import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROVIDER_IDS, PROVIDER_AREAS } from '@/lib/config/schema'
import { catalogueBadges, catalogueEntry, filterCatalogue, parseArea, PROVIDER_CATALOGUE } from '@/lib/admin/catalogue'
import { canViewInfrastructure, instanceAdminEmails, parseAdminEmails } from '@/lib/admin/instance-admins'
import { runDoctor, worstStatus } from '@/lib/admin/doctor'
import { resolveInstanceConfig } from '@/lib/config'

// The page's dependencies, for the Settings → Infrastructure tests below.
const session = vi.hoisted(() => ({ user: null as null | { id: string; email?: string }, allowed: false, loads: 0 }))
vi.mock('@/lib/providers/db/session', () => ({ getSessionDbWithUser: async () => ({ supabase: {}, user: session.user }) }))
vi.mock('@/lib/admin/infrastructure', () => ({
  viewerCanSeeInfrastructure: async (user: { email?: string } | null) => Boolean(user && session.allowed),
  loadInfrastructureView: async () => {
    session.loads++
    return { areas: [], checkedAt: new Date(0).toISOString(), switches: [], switchLogError: null, housekeeping: null, housekeepingError: null, appVersion: '0.0.0' }
  },
}))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))

/**
 * Admin CLI + Infrastructure page (providers phase 11): the provider
 * catalogue, instance-admin access (allowed and denied), the page's 404 for
 * everyone else, and the doctor's reporting.
 */

describe('provider catalogue', () => {
  it('has exactly one entry per provider id', () => {
    for (const area of PROVIDER_AREAS) {
      const ids = PROVIDER_CATALOGUE.filter((e) => e.area === area).map((e) => e.id).sort()
      expect(ids, area).toEqual([...PROVIDER_IDS[area]].sort())
    }
  })

  it("matches each provider implementation's own onPrem flag", async () => {
    const { resolveStorageProvider } = await import('@/lib/providers/storage')
    for (const id of PROVIDER_IDS.storage) {
      const provider = resolveStorageProvider(id, { local_root: '/tmp/x', endpoint: 'http://minio', azure_account_name: 'a', gcs_project_id: 'p' })
      expect(catalogueEntry('storage', id)!.onPrem, `storage ${id}`).toBe(provider.onPrem)
    }
    const { resolveSchedulerProvider } = await import('@/lib/providers/scheduler')
    for (const id of PROVIDER_IDS.scheduler) expect(catalogueEntry('scheduler', id)!.onPrem).toBe(resolveSchedulerProvider(id).onPrem)
    const { resolveDbProvider } = await import('@/lib/providers/db/provider')
    for (const id of PROVIDER_IDS.db) expect(catalogueEntry('db', id)!.onPrem).toBe(resolveDbProvider(id).onPrem)
    const { resolveSecretStore } = await import('@/lib/providers/secrets')
    for (const id of ['env', 'db', 'supabase_vault'] as const) expect(catalogueEntry('secrets', id)!.onPrem, id).toBe(resolveSecretStore(id, {}).onPrem)
    const { resolveCacheStore } = await import('@/lib/providers/cache')
    for (const id of PROVIDER_IDS.cache) expect(catalogueEntry('cache', id)!.onPrem, `cache ${id}`).toBe(resolveCacheStore(id, { redis_url: 'redis://127.0.0.1:1' }).onPrem)
    const { resolveKmsProvider } = await import('@/lib/providers/kms')
    for (const id of PROVIDER_IDS.kms) expect(catalogueEntry('kms', id)!.onPrem, `kms ${id}`).toBe(resolveKmsProvider(id, {}).onPrem)
    const { resolveEmailProvider } = await import('@/lib/providers/email')
    for (const id of ['console', 'smtp', 'resend'] as const) {
      expect(catalogueEntry('email', id)!.onPrem, id).toBe(resolveEmailProvider(id, { smtp_host: 'mail', resend_api_key: 'k' }).onPrem)
    }
  })

  it('filters by on-prem / Azure / GCP, and every area has an on-prem option', () => {
    for (const area of PROVIDER_AREAS) expect(filterCatalogue({ area, onPrem: true }).length, area).toBeGreaterThan(0)
    expect(filterCatalogue({ azure: true }).map((e) => `${e.area}:${e.id}`)).toEqual(expect.arrayContaining(['storage:azure_blob', 'secrets:azure_key_vault', 'email:azure_communication', 'kms:azure_key_vault']))
    expect(filterCatalogue({ gcp: true }).map((e) => `${e.area}:${e.id}`)).toEqual(expect.arrayContaining(['storage:gcs', 'secrets:gcp_secret_manager', 'kms:gcp_kms']))
    expect(filterCatalogue({ aws: true }).map((e) => `${e.area}:${e.id}`)).toEqual(expect.arrayContaining(['db:postgres', 'storage:s3', 'email:ses', 'secrets:aws_secrets_manager', 'kms:aws_kms', 'cache:redis']))
    // Every area has a first-class AWS option.
    for (const area of PROVIDER_AREAS) expect(filterCatalogue({ area, aws: true }).length, `aws ${area}`).toBeGreaterThan(0)
    expect(catalogueBadges(catalogueEntry('email', 'ses')!)).toEqual(['aws'])
    expect(catalogueBadges(catalogueEntry('email', 'resend')!)).toEqual(['cloud'])
    expect(parseArea('database')).toBe('db')
    expect(parseArea('Storage')).toBe('storage')
    expect(parseArea('files')).toBeNull()
  })
})

describe('instance admins', () => {
  const verified = async () => true
  const admin = { id: 'u-admin', email: 'Ops@Example.com' }

  it('parses lists from the env and the setting (case-insensitive, deduplicated, emails only)', () => {
    expect(parseAdminEmails(' ops@example.com, OPS@example.com;bad  sre@example.com ')).toEqual(['ops@example.com', 'sre@example.com'])
    expect(parseAdminEmails(['a@b.c', 'nope'])).toEqual(['a@b.c'])
    expect([...instanceAdminEmails(['x@y.z'], 'ops@example.com')].sort()).toEqual(['ops@example.com', 'x@y.z'])
  })

  it('allows a listed user with a verified email (env or instance setting)', async () => {
    expect(await canViewInfrastructure(admin, { adminSetting: async () => undefined, emailVerified: verified, env: 'ops@example.com' })).toBe(true)
    expect(await canViewInfrastructure(admin, { adminSetting: async () => ['ops@example.com'], emailVerified: verified, env: '' })).toBe(true)
  })

  it('denies a tenant owner who is not on the list, unverified emails, anonymous users and empty lists', async () => {
    const owner = { id: 'u-owner', email: 'owner@customer.com' }
    expect(await canViewInfrastructure(owner, { adminSetting: async () => ['ops@example.com'], emailVerified: verified, env: 'ops@example.com' })).toBe(false)
    expect(await canViewInfrastructure(admin, { adminSetting: async () => undefined, emailVerified: async () => false, env: 'ops@example.com' })).toBe(false)
    expect(await canViewInfrastructure(admin, { adminSetting: async () => undefined, emailVerified: async () => { throw new Error('auth down') }, env: 'ops@example.com' })).toBe(false)
    expect(await canViewInfrastructure(null, { adminSetting: async () => undefined, emailVerified: verified, env: 'ops@example.com' })).toBe(false)
    expect(await canViewInfrastructure({ id: 'u', email: undefined }, { adminSetting: async () => undefined, emailVerified: verified, env: 'ops@example.com' })).toBe(false)
    expect(await canViewInfrastructure(admin, { adminSetting: async () => undefined, emailVerified: verified, env: '' })).toBe(false)
    // A broken setting read falls back to the env list only.
    expect(await canViewInfrastructure(admin, { adminSetting: async () => { throw new Error('db down') }, emailVerified: verified, env: '' })).toBe(false)
  })

  it('the emailVerified dependency only sees the normalised address of a listed user', async () => {
    const seen: string[] = []
    await canViewInfrastructure(admin, { adminSetting: async () => undefined, emailVerified: async (u) => { seen.push(u.email); return true }, env: 'ops@example.com' })
    await canViewInfrastructure({ id: 'x', email: 'other@example.com' }, { adminSetting: async () => undefined, emailVerified: async (u) => { seen.push(u.email); return true }, env: 'ops@example.com' })
    expect(seen).toEqual(['ops@example.com'])
  })
})

describe('Settings → Infrastructure page', () => {
  // The page module pulls in the switch engine: import it once up front, outside the per-test timeout.
  beforeAll(async () => { await import('@/app/(dashboard)/settings/infrastructure/page') }, 60_000)
  beforeEach(() => { session.loads = 0 })
  afterEach(() => { session.user = null; session.allowed = false })

  it('404s for a tenant owner and for anonymous visitors, without loading anything', async () => {
    const { default: Page } = await import('@/app/(dashboard)/settings/infrastructure/page')
    session.user = { id: 'owner', email: 'owner@customer.com' }
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
    session.user = null
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(session.loads).toBe(0)
  })

  it('renders for an instance admin', async () => {
    const { default: Page } = await import('@/app/(dashboard)/settings/infrastructure/page')
    session.user = { id: 'admin', email: 'ops@example.com' }
    session.allowed = true
    const element = await Page({ searchParams: Promise.resolve({ refresh: '1' }) })
    expect(element).toBeTruthy()
    expect(session.loads).toBe(1)
  })

  it('the server action used for the Settings link reflects the same check', async () => {
    const { canViewInfrastructureAction } = await import('@/app/actions/infrastructure')
    session.user = { id: 'owner', email: 'owner@customer.com' }
    expect(await canViewInfrastructureAction()).toBe(false)
    session.allowed = true
    expect(await canViewInfrastructureAction()).toBe(true)
  })

  it('the Settings link is gated on instance admin, not on a workspace permission; the page has no switching UI', () => {
    const tabs = readFileSync(path.join(process.cwd(), 'components/settings/settings-tabs.tsx'), 'utf8')
    expect(tabs).toMatch(/href: "\/settings\/infrastructure",[\s\S]{0,80}instanceAdmin: true/)
    expect(tabs).toMatch(/if \(link\.instanceAdmin\) return instanceAdmin;/)
    const view = readFileSync(path.join(process.cwd(), 'components/settings/infrastructure-view.tsx'), 'utf8')
    expect(view).not.toMatch(/'use client'|"use client"|onClick|<form|<button/)
  })
})

describe('doctor', () => {
  it('ranks statuses', () => {
    expect(worstStatus(['ok', 'skip'])).toBe('ok')
    expect(worstStatus(['ok', 'warn', 'skip'])).toBe('warn')
    expect(worstStatus(['warn', 'fail'])).toBe('fail')
    expect(worstStatus([])).toBe('skip')
  })

  it('reports without a database connection and never prints secret values', async () => {
    const saved = { ...process.env }
    try {
      delete process.env.DB_PROVIDER
      Object.assign(process.env, { EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'mail.internal', SMTP_PASSWORD: 'hunter2-very-secret', EMAIL_FROM: 'Tasks <t@x.test>' })
      const config = resolveInstanceConfig(new Map())
      const report = await runDoctor({ config, sql: null, areas: ['db', 'email', 'scheduler'] })
      expect(report.checks.find((c) => c.area === 'db')).toMatchObject({ status: 'skip' })
      expect(report.checks.find((c) => c.area === 'email' && c.name === 'config')).toMatchObject({ status: 'ok' })
      expect(JSON.stringify(report)).not.toContain('hunter2')
      expect(report.areas.email).toBe('ok')
      // The postgres db provider can't run without its connection: a failure, not a skip.
      process.env.DB_PROVIDER = 'postgres'
      const strict = await runDoctor({ config: resolveInstanceConfig(new Map()), sql: null, areas: ['db'] })
      expect(strict.checks[0]).toMatchObject({ status: 'fail' })
    } finally {
      process.env = saved
    }
  })
})
