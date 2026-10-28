import type { SupabaseClient } from '@supabase/supabase-js'
import { PERMISSION_KEYS, type Permission } from '@/lib/permissions'
import { toUrlSlug } from '@/lib/utils/slug'
import type { AuthAdmin } from '@/lib/providers/auth/types'

/**
 * Provisions a brand-new, fully isolated tenant with its first owner:
 *   1. creates the auth user (auto-confirmed) through the auth provider's
 *      admin API (Supabase Auth by default; built-in auth when configured),
 *   2. inserts the `tenants` row (a DB trigger also gives it the default
 *      workspace theme — 20261101000000_workspace_themes.sql),
 *   3. ensures the five system roles exist with their permission sets,
 *   4. upserts the `users` row and assigns the `owner` role.
 *
 * Shared by the cloud beta signup (app/actions/beta-signup.ts) and the
 * self-hosted first-run script (scripts/bootstrap-tenant.ts). Requires a
 * service-role client.
 *
 * Isolation: the new tenant is just another `tenants` row; every query in the
 * app (and RLS) scopes by tenant_id, so tenants are separated from each other
 * by the same mechanism everywhere.
 */

// ── system-role permission sets ──
const ALL: Permission[] = [...PERMISSION_KEYS]
const VIEWER: Permission[] = [
  'tasks.view_own', 'tasks.complete',
  'workflows.view', 'forms.view', 'forms.submit', 'data.view', 'reports.view',
  'team.view_members',
]
const MEMBER: Permission[] = [
  ...VIEWER,
  'tasks.create', 'tasks.assign',
  'data.manage_rows',
  'reports.create', 'reports.edit_own',
]
const MANAGER: Permission[] = ALL.filter((p) =>
  !p.startsWith('settings.manage_') &&
  p !== 'team.change_roles' && p !== 'team.remove' && p !== 'settings.edit' &&
  p !== 'observability.view',
)

export const SYSTEM_ROLES: { slug: string; name: string; description: string; permissions: Permission[] }[] = [
  { slug: 'owner', name: 'Owner', description: 'Full access to everything, including billing and API keys', permissions: ALL },
  { slug: 'admin', name: 'Admin', description: 'Full administrative access', permissions: ALL },
  { slug: 'manager', name: 'Manager', description: 'Builds and manages work; no org administration', permissions: MANAGER },
  { slug: 'member', name: 'Member', description: 'Works tasks, data, and reports', permissions: MEMBER },
  { slug: 'viewer', name: 'Viewer', description: 'Read-only access', permissions: VIEWER },
]

export interface ProvisionTenantInput {
  fullName: string
  email: string
  password: string
  company: string
  /** Mark onboarding done (beta signup) or leave it for /onboarding (self-hosted bootstrap). */
  onboardingCompleted: boolean
  settings?: Record<string, unknown>
  userMetadata?: Record<string, unknown>
}

export type ProvisionTenantResult =
  | { ok: true; tenantId: string; slug: string; userId: string }
  | { ok: false; reason: 'user_exists' | 'auth_failed' | 'provision_failed'; error: string }

/** Supabase Auth's admin API on a service-role client (the default, and scripts/bootstrap-tenant.ts). */
export function supabaseAuthAdmin(supabase: Pick<SupabaseClient, 'auth'>): Pick<AuthAdmin, 'createUser' | 'deleteUser'> {
  const admin = supabase.auth.admin
  return {
    async createUser({ email, password, emailConfirmed, metadata }) {
      const { data, error } = await admin.createUser({ email, password, email_confirm: emailConfirmed, user_metadata: metadata })
      if (error || !data?.user) throw Object.assign(new Error(String(error?.message ?? 'Auth user creation failed')), { name: 'AuthError' })
      return { id: data.user.id }
    },
    async deleteUser(userId) {
      await admin.deleteUser(userId)
    },
  }
}

export async function provisionTenant(
  supabase: SupabaseClient<any, any, any>,
  input: ProvisionTenantInput,
  admin: Pick<AuthAdmin, 'createUser' | 'deleteUser'> = supabaseAuthAdmin(supabase as SupabaseClient),
): Promise<ProvisionTenantResult> {
  const { fullName, email, password, company } = input
  const db = supabase as any

  // Unique slug from the company name.
  let slug = toUrlSlug(company, 50) || 'team'
  const { data: taken } = await db.from('tenants').select('slug').ilike('slug', `${slug}%`).is('deleted_at', null)
  if ((taken ?? []).some((t: any) => t.slug === slug)) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`
  }

  // 1. Auth user (auto-confirmed — no email round-trip).
  let userId: string
  try {
    ;({ id: userId } = await admin.createUser({
      email,
      password,
      emailConfirmed: true,
      metadata: { display_name: fullName, ...(input.userMetadata ?? {}) },
    }))
  } catch (createErr) {
    const msg = String((createErr as Error)?.message ?? '')
    if ((createErr as { code?: string }).code === 'user_exists' || /already|registered|exists/i.test(msg)) {
      return { ok: false, reason: 'user_exists', error: msg || 'User already exists' }
    }
    return { ok: false, reason: 'auth_failed', error: msg || 'Auth user creation failed' }
  }

  // Best-effort rollback if any later step fails, so retries aren't wedged on
  // half-provisioned state.
  const rollback = async (tenantId?: string) => {
    try {
      if (tenantId) {
        await db.from('user_roles').delete().eq('tenant_id', tenantId)
        await db.from('roles').delete().eq('tenant_id', tenantId)
        await db.from('users').delete().eq('id', userId)
        await db.from('tenants').delete().eq('id', tenantId)
      }
      await admin.deleteUser(userId)
    } catch { /* best effort */ }
  }

  try {
    // 2. Tenant row.
    const { data: tenant, error: tenantErr } = await db
      .from('tenants')
      .insert({
        name: company,
        slug,
        plan: 'business_team',
        onboarding_completed: input.onboardingCompleted,
        contact_name: fullName,
        contact_email: email,
        settings: input.settings ?? {},
      })
      .select('id, slug')
      .single()
    if (tenantErr || !tenant) { await rollback(); throw new Error(`tenant insert: ${tenantErr?.message}`) }

    // 3. System roles — a DB trigger seeds all five on tenant insert. Fetch
    // them; seed manually only when the trigger isn't present.
    let { data: roles } = await db
      .from('roles')
      .select('id, slug')
      .eq('tenant_id', tenant.id)
      .eq('is_system', true)
    if (!roles?.length) {
      const { data: seeded, error: rolesErr } = await db
        .from('roles')
        .insert(SYSTEM_ROLES.map((r) => ({
          tenant_id: tenant.id,
          name: r.name,
          slug: r.slug,
          description: r.description,
          permissions: r.permissions,
          is_system: true,
        })))
        .select('id, slug')
      if (rolesErr || !seeded?.length) { await rollback(tenant.id); throw new Error(`roles seed: ${rolesErr?.message}`) }
      roles = seeded
    }
    const ownerRole = (roles as any[]).find((r) => r.slug === 'owner')
    if (!ownerRole) { await rollback(tenant.id); throw new Error('roles seed: no owner role') }

    // 4. App user + owner role. An auth-level trigger may already have
    // inserted a `users` row pointing at a default tenant — upsert to repoint
    // it at the new isolated tenant.
    const { error: userErr } = await db.from('users').upsert({
      id: userId,
      email,
      display_name: fullName,
      tenant_id: tenant.id,
      current_tenant_id: tenant.id,
      role: 'owner',
    }, { onConflict: 'id' })
    if (userErr) { await rollback(tenant.id); throw new Error(`users upsert: ${userErr.message}`) }

    const { error: roleErr } = await db.from('user_roles').insert({
      tenant_id: tenant.id,
      user_id: userId,
      role_id: ownerRole.id,
    })
    if (roleErr) { await rollback(tenant.id); throw new Error(`user_roles insert: ${roleErr.message}`) }

    // user_memberships is one of the access checks in verify-tenant; keep it
    // consistent if the table is in use (ignore failure — not all envs have it).
    await db.from('user_memberships').insert({
      user_id: userId,
      tenant_id: tenant.id,
      is_active: true,
    }).then(() => {}, () => {})

    // The auth-level trigger may also grant membership/roles in a default
    // tenant — remove any grant that isn't for the new isolated tenant,
    // otherwise verify-tenant would let the user switch into it.
    await db.from('user_memberships').delete().eq('user_id', userId).neq('tenant_id', tenant.id).then(() => {}, () => {})
    await db.from('user_roles').delete().eq('user_id', userId).neq('tenant_id', tenant.id).then(() => {}, () => {})

    return { ok: true, tenantId: tenant.id as string, slug: tenant.slug as string, userId }
  } catch (err: any) {
    return { ok: false, reason: 'provision_failed', error: String(err?.message ?? err) }
  }
}
