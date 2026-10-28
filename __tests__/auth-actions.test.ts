/**
 * The login page's server-side flow (app/actions/auth.ts signInAction) with a
 * stub AuthProvider: the same steps the page used to run in the browser —
 * sign in; else invitation check → create account → join the organisation —
 * now server side, with the provider setting the cookies. Also: redirects are
 * sanitised, provider errors surface, built-in confirmation goes to
 * /check-email, and only a matching invite token skips confirmation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError, type AuthProvider } from '@/lib/providers/auth/types'

vi.mock('next/headers', () => import('./helpers/next-headers-mock'))

const state = vi.hoisted(() => ({
  provider: null as unknown as AuthProvider,
  invitation: { ok: true, status: 200 } as Record<string, unknown>,
  tokenMatches: false,
  joined: [] as Array<{ user: { id: string }; slug: string; invite: string | null }>,
}))

vi.mock('@/lib/providers/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/auth')>()),
  getAuthProvider: async () => state.provider,
}))
vi.mock('@/lib/providers/auth/provisioning', () => ({
  checkInvitation: async () => state.invitation,
  inviteTokenMatches: async () => state.tokenMatches,
  joinInvitedTenant: async (user: { id: string }, slug: string, invite: string | null) => {
    state.joined.push({ user, slug, invite })
    return { ok: true, status: 200, tenantId: 't-1' }
  },
}))
vi.mock('@/lib/supabase/server', () => ({ getCachedUser: async () => null }))
vi.mock('@/lib/last-seen', () => ({ touchUserLastSeen: async () => undefined }))

function stubProvider(overrides: Partial<AuthProvider>): AuthProvider {
  return {
    id: 'supabase',
    onPrem: false,
    signInWithPassword: vi.fn(async () => { throw new AuthError('invalid_credentials', 'Invalid login credentials') }),
    signUp: vi.fn(async () => ({ user: { id: 'new-user', email: 'new@x.test' }, signedIn: true })),
    ...overrides,
  } as unknown as AuthProvider
}

const input = { org: 'Acme', email: 'new@x.test', password: 'pw-123456', redirect: '/reports' }

describe('signInAction', () => {
  beforeEach(() => {
    state.invitation = { ok: true, status: 200, inviteToken: 'inv-1', existingUserId: null }
    state.tokenMatches = false
    state.joined = []
  })

  it('existing account: signs in and returns the (sanitised) redirect', async () => {
    const { signInAction } = await import('@/app/actions/auth')
    state.provider = stubProvider({ signInWithPassword: vi.fn(async () => ({ id: 'u-1', email: 'a@x.test' })) })
    expect(await signInAction(input)).toEqual({ ok: true, redirect: '/reports', step: 'signed_in' })
    expect(await signInAction({ ...input, redirect: 'https://evil.example' })).toMatchObject({ ok: true, redirect: '/tasks' })
    expect(await signInAction({ ...input, redirect: '//evil.example' })).toMatchObject({ redirect: '/tasks' })
  })

  it('no invitation: the generic error, nothing created', async () => {
    const { signInAction } = await import('@/app/actions/auth')
    state.provider = stubProvider({})
    state.invitation = { ok: false, status: 403, error: 'No invitation found.' }
    expect(await signInAction(input)).toEqual({ ok: false, error: "Invalid email or password. If you're new, ask an admin to invite you first." })
    expect(state.provider.signUp).not.toHaveBeenCalled()
  })

  it('invited, account exists: wrong password', async () => {
    const { signInAction } = await import('@/app/actions/auth')
    state.provider = stubProvider({})
    state.invitation = { ok: true, status: 200, existingUserId: 'u-9' }
    expect(await signInAction(input)).toMatchObject({ ok: false, error: 'Incorrect password. Please try again.' })
  })

  it('invited, no account: creates it (invitation token travels on) and joins the organisation', async () => {
    const { signInAction } = await import('@/app/actions/auth')
    state.provider = stubProvider({})
    expect(await signInAction({ ...input, inviteToken: 'from-link' })).toEqual({ ok: true, redirect: '/reports', step: 'created' })
    expect(state.provider.signUp).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@x.test', invited: true, emailConfirmed: false, pending: { org: 'acme', invite: 'from-link', redirect: '/reports' } }), expect.anything())
    expect(state.joined).toEqual([{ user: { id: 'new-user', email: 'new@x.test' }, slug: 'acme', invite: 'from-link' }])
  })

  it('a matching invite token proves the address (no confirmation email)', async () => {
    const { signInAction } = await import('@/app/actions/auth')
    state.provider = stubProvider({})
    state.tokenMatches = true
    await signInAction({ ...input, inviteToken: 'from-link' })
    expect(state.provider.signUp).toHaveBeenCalledWith(expect.objectContaining({ emailConfirmed: true }), expect.anything())
  })

  it('built-in with confirmation pending → /check-email, no workspace join yet', async () => {
    const { signInAction } = await import('@/app/actions/auth')
    state.provider = stubProvider({ id: 'builtin', signUp: vi.fn(async () => ({ user: { id: 'n' }, signedIn: false })) })
    expect(await signInAction(input)).toEqual({ ok: true, redirect: '/check-email', step: 'confirm_email' })
    expect(state.joined).toEqual([])
  })

  it('lockout / rate limits / unconfirmed email surface as-is (no invitation probing)', async () => {
    const { signInAction } = await import('@/app/actions/auth')
    for (const code of ['locked', 'rate_limited', 'email_not_confirmed'] as const) {
      state.provider = stubProvider({ signInWithPassword: vi.fn(async () => { throw new AuthError(code, `msg ${code}`) }) })
      expect(await signInAction(input)).toEqual({ ok: false, error: `msg ${code}`, code })
      expect(state.provider.signUp).not.toHaveBeenCalled()
    }
  })

  it('validates input', async () => {
    const { signInAction } = await import('@/app/actions/auth')
    expect(await signInAction({ ...input, org: ' ' })).toEqual({ ok: false, error: 'Organisation is required.' })
    expect(await signInAction({ ...input, password: '' })).toEqual({ ok: false, error: 'Email and password are required.' })
  })
})
