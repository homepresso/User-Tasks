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
 *   4. upserts the `users` row and assigns the `owner` role,
 *   5. removes the personal workspace that account creation also made.
 *
 * One account, one workspace: creating the account (step 1) runs the
 * provisioning every new account gets — the Supabase trigger
 * on_auth_user_created, or onUserCreated for built-in accounts — which makes
 * a personal "<name>'s Workspace" (slug personal-<user id prefix>) and points
 * the user at it. Here the named workspace replaces it: the user is repointed
 * (users row, home owner membership), and the personal one, still empty and
 * memberless, is deleted. Before this, every signup left it behind next to
 * the named workspace.
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
// Completing anyone's workflow task on their behalf (note required, audited):
// Owner and Admin (SQL seed_tenant_roles, 20261227000000). Manager and below
// act on behalf only through reporting lines or a workflow Edit grant.
const ADMIN: Permission[] = [...ALL]
// Viewer: a read-only consumer — works the tasks assigned to them, submits the
// forms they are given, reads data and reports, sees the people directory. No
// build, design or admin areas (governance audit 2026-11: workflows.view and
// forms.view removed — they opened the Build menu and full workflow / form
// definitions to every Viewer).
const VIEWER: Permission[] = [
  'tasks.view_own', 'tasks.complete',
  'forms.submit', 'data.view', 'reports.view',
  'team.view_members', 'org.view', 'projects.view',
]
// Member: does work — creates and assigns tasks, edits data rows, builds own
// reports, and sees the workflow queue items they are involved in. The form
// wizard (forms.wizard, 20261229000000) lets them make their own forms,
// surveys and approvals: the server creates exactly the wizard's objects,
// owned by them — no general build access (forms.edit, workflows.create…).
const MEMBER: Permission[] = [
  ...VIEWER,
  'tasks.create', 'tasks.assign',
  'data.manage_rows',
  'reports.create', 'reports.edit_own',
  'workflows.view_queue',
  'forms.wizard',
]
const MANAGER: Permission[] = ADMIN.filter((p) =>
  p !== 'tasks.complete_any' &&
  !p.startsWith('settings.manage_') &&
  p !== 'team.change_roles' && p !== 'team.remove' && p !== 'settings.edit' && p !== 'org.manage' &&
  p !== 'observability.view' && p !== 'assistants.manage',
)

export const SYSTEM_ROLES: { slug: string; name: string; description: string; permissions: Permission[] }[] = [
  { slug: 'owner', name: 'Owner', description: 'Full access to everything, including billing and API keys', permissions: ALL },
  { slug: 'admin', name: 'Admin', description: 'Full administrative access', permissions: ADMIN },
  { slug: 'manager', name: 'Manager', description: 'Builds and manages work; no org administration', permissions: MANAGER },
  { slug: 'member', name: 'Member', description: 'Works tasks, data, and reports', permissions: MEMBER },
  { slug: 'viewer', name: 'Viewer', description: 'Read-only access', permissions: VIEWER },
]

export interface ProvisionTenantInput {
  fullName: string
  email: string
  password: string
  company: string
  /**
   * Exact workspace slug (the instance admin API): used as is, and a taken
   * slug fails with reason `slug_taken`. Omitted: derived from `company`,
   * with a random suffix when taken.
   */
  slug?: string
  /** Mark onboarding done (beta signup) or leave it for /onboarding (self-hosted bootstrap). */
  onboardingCompleted: boolean
  settings?: Record<string, unknown>
  userMetadata?: Record<string, unknown>
}

export type ProvisionTenantResult =
  | { ok: true; tenantId: string; slug: string; userId: string }
  | { ok: false; reason: 'user_exists' | 'auth_failed' | 'provision_failed' | 'slug_taken'; error: string }

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

/** The personal workspace account creation gave `userId`, if any (its users row points at personal-<id prefix>). */
async function personalWorkspaceOf(db: any, userId: string): Promise<string | null> {
  const { data: user } = await db.from('users').select('tenant_id').eq('id', userId).maybeSingle()
  if (!user?.tenant_id) return null
  const { data: tenant } = await db.from('tenants').select('id, slug').eq('id', user.tenant_id).maybeSingle()
  return tenant?.slug === personalWorkspaceSlug(userId) ? (tenant.id as string) : null
}

/** provision_auth_user's slug for a user's personal workspace. */
export function personalWorkspaceSlug(userId: string): string {
  return `personal-${userId.slice(0, 8)}`
}

/**
 * Deletes the fresh personal workspace of a just-created account — only while
 * nobody else is tied to it (it is seconds old; never touches a workspace in use).
 */
async function removePersonalWorkspace(db: any, tenantId: string, userId: string): Promise<void> {
  const [{ data: members }, { data: users }] = await Promise.all([
    db.from('user_memberships').select('user_id').eq('tenant_id', tenantId).neq('user_id', userId).limit(1),
    db.from('users').select('id').or(`tenant_id.eq.${tenantId},current_tenant_id.eq.${tenantId}`).neq('id', userId).limit(1),
  ])
  if ((members ?? []).length || (users ?? []).length) return
  await db.from('user_roles').delete().eq('tenant_id', tenantId).eq('user_id', userId)
  await db.from('user_memberships').delete().eq('tenant_id', tenantId).eq('user_id', userId)
  const { error } = await db.from('tenants').delete().eq('id', tenantId)
  if (error) console.warn(`[tenant-provisioning] could not remove personal workspace ${tenantId}: ${error.message}`)
}

export async function provisionTenant(
  supabase: SupabaseClient<any, any, any>,
  input: ProvisionTenantInput,
  admin: Pick<AuthAdmin, 'createUser' | 'deleteUser'> = supabaseAuthAdmin(supabase as SupabaseClient),
): Promise<ProvisionTenantResult> {
  const { fullName, email, password, company } = input
  const db = supabase as any

  let slug: string
  if (input.slug) {
    // Exact slug: never altered (slugs are unique across live and deleted workspaces).
    slug = input.slug
    const { data: existing } = await db.from('tenants').select('id').eq('slug', slug).limit(1)
    if ((existing ?? []).length) return { ok: false, reason: 'slug_taken', error: `The slug "${slug}" is taken` }
  } else {
    // Unique slug from the company name.
    slug = toUrlSlug(company, 50) || 'team'
    const { data: taken } = await db.from('tenants').select('slug').ilike('slug', `${slug}%`).is('deleted_at', null)
    if ((taken ?? []).some((t: any) => t.slug === slug)) {
      slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`
    }
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

  // The personal workspace account creation just made (none when the auth
  // provider doesn't provision): replaced by the named one below.
  const personalTenantId = await personalWorkspaceOf(db, userId).catch(() => null)

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
      if (personalTenantId) await removePersonalWorkspace(db, personalTenantId, userId)
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

    // user_memberships is one of the access checks in verify-tenant: the
    // owner's home membership (what provision_auth_user gives a personal
    // workspace). Ignore failure — not all envs have it.
    await db.from('user_memberships').upsert({
      user_id: userId,
      tenant_id: tenant.id,
      role: 'owner',
      is_home: true,
      is_active: true,
    }, { onConflict: 'user_id,tenant_id' }).then(() => {}, () => {})

    // Account creation granted membership in the personal workspace — remove
    // any grant that isn't for the new isolated tenant (otherwise verify-tenant
    // would let the user switch into it), then the personal workspace itself.
    await db.from('user_memberships').delete().eq('user_id', userId).neq('tenant_id', tenant.id).then(() => {}, () => {})
    await db.from('user_roles').delete().eq('user_id', userId).neq('tenant_id', tenant.id).then(() => {}, () => {})
    if (personalTenantId && personalTenantId !== tenant.id) {
      await removePersonalWorkspace(db, personalTenantId, userId).catch(() => {})
    }

    return { ok: true, tenantId: tenant.id as string, slug: tenant.slug as string, userId }
  } catch (err: any) {
    return { ok: false, reason: 'provision_failed', error: String(err?.message ?? err) }
  }
}
