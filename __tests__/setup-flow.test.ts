import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupFakeDb } from './helpers/setup-fake-db'
import {
  announceSetupCode, checkSetupCode, claimSetup, CLAIM_KEY, CODE_KEY, ensureSetupCode, isSetupNeeded,
  readCodeRow, resetSetupStateForTests, rotateSetupCode, CLAIM_STALE_MS, FRESH_CODE_MS,
} from '@/lib/setup/state'
import { hashSetupCode } from '@/lib/setup/code'
import { runSetup, suggestSlug, validateSetupInput, type SetupDeps, type SetupInput } from '@/lib/setup/run'
import type { ProvisionTenantInput } from '@/lib/tenant-provisioning'

beforeEach(() => resetSetupStateForTests())

const CODE = 'ABCD-EFGH-JKLM'
const seedCode = (updatedAt = new Date().toISOString()) => ({
  instance_settings: [{ key: CODE_KEY, value: { hash: hashSetupCode(CODE), created_at: updatedAt }, secret: false, updated_at: updatedAt }],
})

describe('when setup is needed', () => {
  it('only on self-hosted installs with no tenants and no users', async () => {
    const empty = setupFakeDb()
    expect(await isSetupNeeded(() => empty.db, { selfHosted: false })).toBe(false)
    expect(await isSetupNeeded(() => empty.db, { selfHosted: true })).toBe(true)
    resetSetupStateForTests()
    expect(await isSetupNeeded(() => setupFakeDb({ tenants: [{ id: 't1' }] }).db, { selfHosted: true })).toBe(false)
    resetSetupStateForTests()
    expect(await isSetupNeeded(() => setupFakeDb({ users: [{ id: 'u1' }] }).db, { selfHosted: true })).toBe(false)
  })

  it('caches briefly while needed, and forever once not', async () => {
    const fake = setupFakeDb()
    const db = vi.fn(() => fake.db)
    expect(await isSetupNeeded(db, { selfHosted: true, now: 1_000 })).toBe(true)
    expect(await isSetupNeeded(db, { selfHosted: true, now: 2_000 })).toBe(true)
    expect(db).toHaveBeenCalledTimes(1)
    fake.tables.tenants.push({ id: 't1' })
    expect(await isSetupNeeded(db, { selfHosted: true, now: 10_000 })).toBe(false)
    fake.tables.tenants.length = 0
    expect(await isSetupNeeded(db, { selfHosted: true, now: 100_000, fresh: true })).toBe(false)
    expect(db).toHaveBeenCalledTimes(2)
  })

  it('answers false (not cached) when the database cannot answer', async () => {
    const broken = { from: () => ({ select: () => ({ limit: async () => ({ data: null, error: { message: 'down' } }) }) }) }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await isSetupNeeded(() => broken, { selfHosted: true })).toBe(false)
    expect(await isSetupNeeded(() => setupFakeDb().db, { selfHosted: true })).toBe(true)
    warn.mockRestore()
  })
})

describe('the setup code lifecycle', () => {
  it('startup creates a code, and prints it', async () => {
    const fake = setupFakeDb()
    const lines: string[] = []
    await announceSetupCode(fake.db, { startup: true, log: (l) => lines.push(l), env: {} })
    expect(lines[0]).toMatch(/^UserTasks setup code: [A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4} \(open \/setup to create the admin account\)$/)
    const row = await readCodeRow(fake.db)
    expect(row?.hash).toMatch(/^scrypt\$/)
    // The plain code is never stored.
    expect(JSON.stringify(fake.tables.instance_settings)).not.toContain(lines[0].slice(22, 36))
  })

  it('a restart rotates an old code it cannot print; a fresh sibling code is kept', async () => {
    const old = new Date(Date.now() - FRESH_CODE_MS - 1_000).toISOString()
    const fake = setupFakeDb(seedCode(old))
    const restart = await ensureSetupCode(fake.db, { startup: true, env: {} })
    expect(restart.kind).toBe('code')
    expect(await checkSetupCode(fake.db, CODE, {})).toBe(false)

    resetSetupStateForTests()
    const sibling = setupFakeDb(seedCode())
    expect((await ensureSetupCode(sibling.db, { startup: true, env: {} })).kind).toBe('elsewhere')
    expect(await checkSetupCode(sibling.db, CODE, {})).toBe(true)
  })

  it('page visits never rotate (a visitor cannot invalidate the printed code)', async () => {
    const fake = setupFakeDb(seedCode(new Date(0).toISOString()))
    expect((await ensureSetupCode(fake.db, { startup: false, env: {} })).kind).toBe('elsewhere')
    expect(await checkSetupCode(fake.db, CODE, {})).toBe(true)
  })

  it('reprints a code this process made, unless usertasks-admin replaced it', async () => {
    const fake = setupFakeDb()
    const mine = await rotateSetupCode(fake.db)
    expect(await ensureSetupCode(fake.db, { startup: false, env: {} })).toEqual({ kind: 'code', code: mine })
    fake.tables.instance_settings[0].value.hash = hashSetupCode('ZZZZ-ZZZZ-ZZZZ')
    expect((await ensureSetupCode(fake.db, { startup: false, env: {} })).kind).toBe('elsewhere')
  })

  it('USERTASKS_SETUP_CODE overrides the stored code and is never printed', async () => {
    const fake = setupFakeDb(seedCode())
    const env = { USERTASKS_SETUP_CODE: 'compose-code-1234' }
    expect(await checkSetupCode(fake.db, 'COMPOSE-CODE-1234', env)).toBe(true)
    expect(await checkSetupCode(fake.db, CODE, env)).toBe(false)
    const lines: string[] = []
    await announceSetupCode(fake.db, { startup: true, log: (l) => lines.push(l), env })
    expect(lines).toEqual(['UserTasks setup code: set by USERTASKS_SETUP_CODE (open /setup to create the admin account)'])
    // Too short: ignored, with a warning, and the generated code is used.
    const short: string[] = []
    resetSetupStateForTests()
    await announceSetupCode(fake.db, { startup: true, log: (l) => short.push(l), env: { USERTASKS_SETUP_CODE: 'abc' } })
    expect(short[0]).toMatch(/shorter than 8 characters and was ignored/)
  })

  it('a stale claim (crashed request) can be taken over; a live one cannot', async () => {
    const fake = setupFakeDb()
    const now = Date.now()
    expect(await claimSetup(fake.db, now)).toEqual(expect.any(String))
    expect(await claimSetup(fake.db, now + 1_000)).toBeNull()
    expect(await claimSetup(fake.db, now + CLAIM_STALE_MS + 1_000)).toEqual(expect.any(String))
  })
})

describe('runSetup (the /setup form)', () => {
  const input: SetupInput = {
    org: 'Acme Inc', slug: 'acme-inc', fullName: 'Ada Lovelace', email: 'Ada@Acme.example',
    password: 'correct horse', confirmPassword: 'correct horse', code: 'abcd efgh jklm',
  }

  function deps(fake: ReturnType<typeof setupFakeDb>, over: Partial<SetupDeps> = {}) {
    const provision = vi.fn(async (data: ProvisionTenantInput) => {
      // Like provisionTenant: a tenant and a user appear (after some I/O).
      await new Promise((r) => setTimeout(r, 5))
      fake.tables.tenants.push({ id: `t-${fake.tables.tenants.length + 1}`, slug: data.slug })
      fake.tables.users.push({ id: `u-${fake.tables.users.length + 1}`, email: data.email })
      return { ok: true as const, tenantId: `t-${fake.tables.tenants.length}`, slug: data.slug!, userId: `u-${fake.tables.users.length}` }
    })
    const hits = new Map<string, number>()
    const d: SetupDeps = {
      db: fake.db,
      ip: '203.0.113.7',
      env: {},
      provision,
      rateLimit: async (key) => { const n = (hits.get(key) ?? 0) + 1; hits.set(key, n); return { ok: n <= 5, retryAfterMs: 600_000 } },
      signIn: vi.fn(async () => true),
      audit: vi.fn(async () => {}),
      ...over,
    }
    return { d, provision }
  }

  it('validates the fields', () => {
    expect(validateSetupInput(input)).toBeNull()
    expect(validateSetupInput({ ...input, org: ' ' })?.field).toBe('org')
    expect(validateSetupInput({ ...input, slug: '-acme' })?.field).toBe('slug')
    expect(validateSetupInput({ ...input, slug: 'Acme' })?.field).toBe('slug')
    expect(validateSetupInput({ ...input, email: 'nope' })?.field).toBe('email')
    expect(validateSetupInput({ ...input, password: 'short', confirmPassword: 'short' })?.field).toBe('password')
    expect(validateSetupInput({ ...input, password: 'é'.repeat(40), confirmPassword: 'é'.repeat(40) })?.field).toBe('password')
    expect(validateSetupInput({ ...input, confirmPassword: 'different' })?.field).toBe('confirmPassword')
    expect(validateSetupInput({ ...input, code: '' })?.field).toBe('code')
    expect(suggestSlug('Acme Inc. (NZ)')).toBe('acme-inc-nz')
  })

  it('creates the workspace and owner with the right code, expires the code, audits and signs in', async () => {
    const fake = setupFakeDb(seedCode())
    const { d, provision } = deps(fake)
    const result = await runSetup(input, d)
    expect(result).toEqual({ ok: true, slug: 'acme-inc', signedIn: true, redirect: '/onboarding' })
    expect(provision).toHaveBeenCalledWith(expect.objectContaining({ company: 'Acme Inc', slug: 'acme-inc', email: 'ada@acme.example', fullName: 'Ada Lovelace', onboardingCompleted: false }))
    expect(d.signIn).toHaveBeenCalledWith('ada@acme.example', 'correct horse')
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-1', userId: 'u-1' }))
    expect(fake.tables.instance_settings.find((r) => r.key === CODE_KEY)).toBeUndefined()
    expect(fake.tables.instance_settings.find((r) => r.key === CLAIM_KEY)?.value).toMatchObject({ tenant_id: 't-1', user_id: 'u-1', completed_at: expect.any(String) })
    // Once set up, the same submission is refused.
    expect(await runSetup(input, d)).toMatchObject({ ok: false, done: true })
  })

  it('rejects a wrong code without provisioning, and rate-limits attempts per IP', async () => {
    const fake = setupFakeDb(seedCode())
    const { d, provision } = deps(fake)
    for (let i = 0; i < 5; i++) {
      expect(await runSetup({ ...input, code: 'WRONG-CODE-0000' }, d)).toMatchObject({ ok: false, field: 'code', error: expect.stringMatching(/isn't right/) })
    }
    // Sixth attempt: limited, even with the right code.
    expect(await runSetup(input, d)).toMatchObject({ ok: false, field: 'code', error: expect.stringMatching(/Too many attempts. Try again in 10 minutes/) })
    expect(provision).not.toHaveBeenCalled()
    // Another address is not affected.
    expect(await runSetup(input, { ...d, ip: '198.51.100.2' })).toMatchObject({ ok: true })
  })

  it('concurrent submissions create exactly one owner', async () => {
    const fake = setupFakeDb(seedCode())
    const { d, provision } = deps(fake)
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => runSetup({ ...input, email: `owner${i}@acme.example` }, { ...d, ip: `10.0.0.${i}` })))
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(provision).toHaveBeenCalledTimes(1)
    expect(fake.tables.tenants).toHaveLength(1)
    expect(fake.tables.users).toHaveLength(1)
    for (const r of results.filter((x) => !x.ok)) expect(r).toMatchObject({ ok: false })
  })

  it('gives the claim back when provisioning fails, so a retry works', async () => {
    const fake = setupFakeDb(seedCode())
    const { d } = deps(fake)
    const failing = { ...d, provision: vi.fn(async () => ({ ok: false as const, reason: 'user_exists' as const, error: 'exists' })) }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await runSetup(input, failing)).toMatchObject({ ok: false, field: 'email' })
    expect(fake.tables.instance_settings.find((r) => r.key === CLAIM_KEY)).toBeUndefined()
    expect(await runSetup(input, d)).toMatchObject({ ok: true })
    err.mockRestore()
  })

  it('sends people to sign in when the automatic sign-in fails', async () => {
    const fake = setupFakeDb(seedCode())
    const { d } = deps(fake, { signIn: async () => false })
    expect(await runSetup(input, d)).toEqual({ ok: true, slug: 'acme-inc', signedIn: false, redirect: '/login?org=acme-inc' })
  })
})
