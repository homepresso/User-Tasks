import { getServiceDb, type ServiceDb } from '@/lib/providers/db'
import type { AuthDb } from './builtin/db'

/**
 * Account provisioning shared by every auth provider.
 *
 *  - onUserCreated: what the Supabase trigger on_auth_user_created does
 *    (personal workspace + public.users row + home membership), through the
 *    same idempotent database function public.provision_auth_user (migration
 *    20261106000000). Supabase Auth keeps its trigger; built-in / OIDC / SAML
 *    accounts call this. A user that already has a profile is left alone, so
 *    the two paths can't double-create.
 *  - checkInvitation / joinInvitedTenant / applyOrgOnSignIn: the invitation
 *    and organisation checks the login flow and the SSO callbacks ran in
 *    /api/auth/verify-invite, /api/auth/verify-tenant and /auth/callback,
 *    unchanged, now callable server-side with a verified user.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- service-role rows, as at the original call sites */

export async function onUserCreated(
  db: AuthDb,
  user: { id: string; email: string; displayName?: string | null; provider?: 'email' | 'google' | 'azure_ad' | 'saml' },
): Promise<boolean> {
  const { rows } = await db.query<{ created: boolean }>(
    'SELECT public.provision_auth_user($1, $2, $3, $4) AS created',
    [user.id, user.email.toLowerCase(), user.displayName ?? null, user.provider ?? 'email'],
  )
  return Boolean(rows[0]?.created)
}

export interface InvitationCheck {
  ok: boolean
  status: number
  error?: string
  tenantId?: string
  tenantName?: string
  inviteToken?: string | null
  role?: string
  hasExistingAccess?: boolean
  existingUserId?: string | null
}

/** Does `email` have an invitation to (or existing access in) organisation `slug`? */
export async function checkInvitation(slug: string, email: string, service: ServiceDb = getServiceDb()): Promise<InvitationCheck> {
  const supabase = service as any
  const { data: tenant } = await supabase.from('tenants').select('id, name').eq('slug', slug.toLowerCase()).single()
  if (!tenant) return { ok: false, status: 404, error: 'Organisation not found or access denied.' }

  // Any invitation (pending or accepted) — accepted means access was granted before.
  const { data: invitation } = await supabase
    .from('invitations')
    .select('id, token, role, accepted_at, expires_at')
    .eq('email', email.toLowerCase())
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let hasExistingAccess = false
  const { data: existingUser } = await supabase.from('users').select('id').eq('email', email.toLowerCase()).single()
  if (existingUser) {
    const { data: tenantLink } = await supabase.from('users').select('id')
      .eq('id', existingUser.id)
      .or(`tenant_id.eq.${tenant.id},current_tenant_id.eq.${tenant.id}`)
      .single()
    if (tenantLink) hasExistingAccess = true
    if (!hasExistingAccess) {
      const { data: roleLink } = await supabase.from('user_roles').select('id').eq('user_id', existingUser.id).eq('tenant_id', tenant.id).limit(1).maybeSingle()
      if (roleLink) hasExistingAccess = true
    }
  }

  if (!invitation && !hasExistingAccess) {
    return { ok: false, status: 403, error: 'No invitation found. Ask an admin to invite you.' }
  }
  if (invitation && !invitation.accepted_at && invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
    return { ok: false, status: 403, error: 'Your invitation has expired. Ask an admin to resend it.' }
  }
  return {
    ok: true,
    status: 200,
    tenantId: tenant.id,
    tenantName: tenant.name,
    inviteToken: invitation?.token ?? null,
    role: invitation?.role ?? 'viewer',
    hasExistingAccess,
    existingUserId: existingUser?.id ?? null,
  }
}

/** True when an unused invitation `token` was issued to `email` (proves the address). */
export async function inviteTokenMatches(token: string | null | undefined, email: string, service: ServiceDb = getServiceDb()): Promise<boolean> {
  if (!token) return false
  const { data } = await (service as any)
    .from('invitations')
    .select('id, expires_at, accepted_at')
    .eq('token', token)
    .eq('email', email.toLowerCase())
    .maybeSingle()
  return Boolean(data && !data.accepted_at && (!data.expires_at || new Date(data.expires_at) >= new Date()))
}

/**
 * Join the verified user to organisation `slug` when they are a member or
 * invited: profile row, invitation acceptance, invited role. Identity comes
 * from the verified session / provider — never from request input.
 */
export async function joinInvitedTenant(
  user: { id: string; email?: string | null },
  slug: string,
  inviteToken: string | null | undefined,
  service: ServiceDb = getServiceDb(),
): Promise<{ ok: boolean; status: number; error?: string; tenantId?: string }> {
  const supabase = service as any
  const userId = user.id
  const email = user.email ?? null

  const { data: tenant } = await supabase.from('tenants').select('id, name, slug').eq('slug', slug.toLowerCase()).single()
  if (!tenant) return { ok: false, status: 404, error: 'Organisation not found or access denied.' }

  const [directMember, currentTenant, hasRole, hasMembership, hasInvite] = await Promise.all([
    supabase.from('users').select('id').eq('id', userId).eq('tenant_id', tenant.id).maybeSingle(),
    supabase.from('users').select('id').eq('id', userId).eq('current_tenant_id', tenant.id).maybeSingle(),
    supabase.from('user_roles').select('id').eq('user_id', userId).eq('tenant_id', tenant.id).limit(1).maybeSingle(),
    supabase.from('user_memberships').select('id').eq('user_id', userId).eq('tenant_id', tenant.id).eq('is_active', true).limit(1).maybeSingle(),
    email ? supabase.from('invitations').select('id').eq('email', email.toLowerCase()).eq('tenant_id', tenant.id).limit(1).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const isMember = !!(directMember.data || currentTenant.data || hasRole.data || hasMembership.data || hasInvite.data)
  if (!isMember) return { ok: false, status: 403, error: 'Access denied. Ask an admin to invite you.' }

  const { data: existingProfile } = await supabase.from('users').select('id').eq('id', userId).single()
  if (!existingProfile) {
    await supabase.from('users').insert({
      id: userId,
      email: email?.toLowerCase() ?? '',
      display_name: email?.split('@')[0] ?? 'New User',
      tenant_id: tenant.id,
      current_tenant_id: tenant.id,
      role: 'viewer',
    })
  } else {
    await supabase.from('users').update({ tenant_id: tenant.id, current_tenant_id: tenant.id }).eq('id', userId)
  }

  if (inviteToken) {
    await supabase.from('invitations').update({ accepted_at: new Date().toISOString() })
      .eq('token', inviteToken).eq('email', email?.toLowerCase()).is('accepted_at', null)
  }
  if (!inviteToken && email) {
    await supabase.from('invitations').update({ accepted_at: new Date().toISOString() })
      .eq('email', email.toLowerCase()).eq('tenant_id', tenant.id).is('accepted_at', null)
  }

  let invitedRoleSlug = 'viewer'
  if (email) {
    const { data: inv } = await supabase.from('invitations').select('role')
      .eq('email', email.toLowerCase()).eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (inv?.role) invitedRoleSlug = inv.role
  }
  const { data: assignedRole } = await supabase.from('roles').select('id')
    .eq('tenant_id', tenant.id).eq('slug', invitedRoleSlug).eq('is_system', true).single()
  if (assignedRole) {
    const { data: existingAssignment } = await supabase.from('user_roles').select('id')
      .eq('tenant_id', tenant.id).eq('user_id', userId).limit(1).maybeSingle()
    if (!existingAssignment) {
      await supabase.from('user_roles').insert({ tenant_id: tenant.id, user_id: userId, role_id: assignedRole.id })
    }
  }
  return { ok: true, status: 200, tenantId: tenant.id }
}

/**
 * After an OAuth / SSO sign-in that named an organisation (`?org=`): switch a
 * member into it, or accept their invitation. 'no_invite' when they have
 * neither (the caller sends them back to the login page). Best effort, as
 * /auth/callback always was: lookup failures don't block the sign-in.
 */
export async function applyOrgOnSignIn(
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
  orgSlug: string,
  service: ServiceDb = getServiceDb(),
): Promise<'ok' | 'no_invite'> {
  try {
    const db = service as any
    const { data: tenant } = await db.from('tenants').select('id').eq('slug', orgSlug.toLowerCase()).single()
    if (!tenant) return 'ok'

    const { data: existingUser } = await db.from('users').select('id').eq('id', user.id).eq('tenant_id', tenant.id).single()
    // Membership can also come from directory sync or an org switch — an
    // active user_memberships (or user_roles) row means they belong here even
    // though their home users.tenant_id points elsewhere.
    let isMember = Boolean(existingUser)
    if (!isMember) {
      const [{ data: membership }, { data: roleRow }] = await Promise.all([
        db.from('user_memberships').select('id').eq('user_id', user.id).eq('tenant_id', tenant.id).eq('is_active', true).limit(1).maybeSingle(),
        db.from('user_roles').select('id').eq('user_id', user.id).eq('tenant_id', tenant.id).limit(1).maybeSingle(),
      ])
      isMember = Boolean(membership || roleRow)
    }

    if (isMember) {
      await db.from('users').update({ current_tenant_id: tenant.id }).eq('id', user.id)
      return 'ok'
    }

    const userEmail = user.email?.toLowerCase() ?? ''
    const { data: invitation } = await db.from('invitations').select('id')
      .eq('email', userEmail).eq('tenant_id', tenant.id).limit(1).maybeSingle()
    if (!invitation) return 'no_invite'

    await db.from('users').insert({
      id: user.id,
      email: userEmail,
      display_name: (user.user_metadata?.full_name as string | undefined) ?? user.email?.split('@')[0] ?? 'New User',
      tenant_id: tenant.id,
      current_tenant_id: tenant.id,
      role: 'viewer',
    })
    await db.from('invitations').update({ accepted_at: new Date().toISOString() })
      .eq('email', userEmail).eq('tenant_id', tenant.id).is('accepted_at', null)
    const { data: inv } = await db.from('invitations').select('role')
      .eq('email', userEmail).eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const { data: assignedRole } = await db.from('roles').select('id')
      .eq('tenant_id', tenant.id).eq('slug', inv?.role ?? 'viewer').eq('is_system', true).single()
    if (assignedRole) {
      await db.from('user_roles').insert({ tenant_id: tenant.id, user_id: user.id, role_id: assignedRole.id })
    }
    return 'ok'
  } catch {
    // Best effort — don't block login.
    return 'ok'
  }
}

/**
 * Give `userId` a role in the tenant `slug` (SSO JIT provisioning and
 * group → role mapping): active membership and exactly one system role
 * assignment (`replace` swaps an existing one); `setHome` also makes it the
 * user's home and current workspace.
 */
export async function grantTenantRole(
  userId: string,
  slug: string,
  roleSlug: string,
  { replace = false, setHome = false, service = getServiceDb() }: { replace?: boolean; setHome?: boolean; service?: ServiceDb } = {},
): Promise<boolean> {
  const db = service as any
  const { data: tenant } = await db.from('tenants').select('id').eq('slug', slug.toLowerCase()).maybeSingle()
  if (!tenant) return false
  const { data: role } = await db.from('roles').select('id')
    .eq('tenant_id', tenant.id).eq('slug', roleSlug).eq('is_system', true).maybeSingle()
  if (!role) return false

  const { error: upsertErr } = await db.from('user_memberships')
    .upsert({ user_id: userId, tenant_id: tenant.id, is_active: true }, { onConflict: 'user_id,tenant_id' })
  if (upsertErr) {
    await db.from('user_memberships').insert({ user_id: userId, tenant_id: tenant.id, is_active: true }).then(() => {}, () => {})
  }

  const { data: existing } = await db.from('user_roles').select('id, role_id').eq('tenant_id', tenant.id).eq('user_id', userId)
  const rows = (existing ?? []) as Array<{ id: string; role_id: string }>
  if (rows.length === 0) {
    await db.from('user_roles').insert({ tenant_id: tenant.id, user_id: userId, role_id: role.id })
  } else if (replace && !rows.some((r) => r.role_id === role.id)) {
    await db.from('user_roles').delete().eq('tenant_id', tenant.id).eq('user_id', userId)
    await db.from('user_roles').insert({ tenant_id: tenant.id, user_id: userId, role_id: role.id })
  }
  // A freshly provisioned account lands in this workspace instead of its personal one.
  if (setHome) await db.from('users').update({ tenant_id: tenant.id, current_tenant_id: tenant.id }).eq('id', userId).then(() => {}, () => {})
  return true
}
