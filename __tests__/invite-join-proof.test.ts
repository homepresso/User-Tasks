/**
 * joinInvitedTenant with requireInviteToken (2026-11 QA pass): with Supabase
 * and email confirmations off, sign-up hands out a session without proving
 * the address, so anyone who knew an invited email and the org slug could
 * sign up first and take the invited seat. An invitation alone is now joined
 * only with the invitation's own token; existing members are unaffected.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fake rows */
import { describe, expect, it } from 'vitest'
import { joinInvitedTenant } from '@/lib/providers/auth/provisioning'
import { createFakeSupabase } from './helpers/fake-supabase'

const T = '0e610000-0000-4000-8000-00000000000a'
const U = '0e610000-0000-4000-8000-0000000000c1'

function seed(extra: Record<string, unknown[]> = {}) {
  return createFakeSupabase({
    tenants: [{ id: T, name: 'Acme', slug: 'acme' }],
    invitations: [{ id: 'i1', tenant_id: T, email: 'invited@x.test', token: 'tok-1', role: 'admin', accepted_at: null, expires_at: null, created_at: '2026-11-01' }],
    roles: [{ id: 'r-admin', tenant_id: T, slug: 'admin', is_system: true }],
    users: [], user_roles: [], user_memberships: [],
    ...extra,
  } as never)
}
const user = { id: U, email: 'invited@x.test' }

describe('joinInvitedTenant: proof of the invited address', () => {
  it('refuses an invitation-only join without the token when proof is required', async () => {
    const fake = seed()
    const result = await joinInvitedTenant(user, 'acme', null, fake.client as never, { requireInviteToken: true })
    expect(result).toMatchObject({ ok: false, status: 403 })
    expect((fake.tables as any).user_roles).toHaveLength(0)
    expect((fake.tables as any).invitations[0].accepted_at).toBeNull()
  })

  it('refuses a wrong token', async () => {
    const result = await joinInvitedTenant(user, 'acme', 'guess', seed().client as never, { requireInviteToken: true })
    expect(result.ok).toBe(false)
  })

  it('joins with the invitation token', async () => {
    const fake = seed()
    const result = await joinInvitedTenant(user, 'acme', 'tok-1', fake.client as never, { requireInviteToken: true })
    expect(result).toMatchObject({ ok: true, tenantId: T })
  })

  it('an existing member needs no token', async () => {
    const fake = seed({ user_memberships: [{ id: 'm1', user_id: U, tenant_id: T, is_active: true }] })
    const result = await joinInvitedTenant(user, 'acme', null, fake.client as never, { requireInviteToken: true })
    expect(result.ok).toBe(true)
  })

  it('without the option (confirmed email) behaves as before', async () => {
    const result = await joinInvitedTenant(user, 'acme', null, seed().client as never)
    expect(result.ok).toBe(true)
  })
})
