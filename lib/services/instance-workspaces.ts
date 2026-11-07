/**
 * Instance admin: create a workspace (tenant) with its owner, and read one
 * by slug. Behind POST / GET /api/v1/admin/workspaces (instance admin token
 * only; lib/api/instance-admin-route.ts) and `usertasks admin-workspaces`.
 *
 *  - Idempotent on slug: a live workspace with the slug is returned
 *    unchanged with created: false (no owner change; a key only when asked).
 *  - The owner: an existing user (public.users, by email) is added to the
 *    new workspace as owner (active membership + owner role; their home
 *    workspace is not changed). Otherwise an account is created through the
 *    configured auth provider, email confirmed, exactly as
 *    `usertasks-admin bootstrap` does (lib/tenant-provisioning), with the
 *    given password or a random one nobody knows (SSO or "Forgot password").
 *    No invitation is sent: an invitation needs an inviting member, and a new
 *    workspace has none yet.
 *  - Slug rules: the onboarding / workspace address rules (lib/workspace-address).
 *  - Optional first API key: minted through the API key service in the new
 *    workspace (same validation and audit as POST /api-keys), shown once.
 *  - Audited in the workspace's audit log (actor: none; metadata via
 *    instance_admin_api and the caller's IP) and logged.
 *
 * Works with any database provider (the service client: Supabase or the
 * in-process postgres provider) and auth provider (Supabase or built-in).
 */

import { randomBytes } from 'node:crypto'
import { PERMISSION_KEYS } from '@/lib/permissions'
import { subdomainProblem } from '@/lib/workspace-address'
import { writeAudit } from '@/lib/audit-log'
import { ServiceError, type AnySupabaseClient, type ServiceContext } from './context'

/* eslint-disable @typescript-eslint/no-explicit-any -- provisioning tables are untyped here, as in tenant-provisioning */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const WORKSPACE_COLUMNS = 'id, slug, name, subdomain, created_at, deleted_at'

export interface CreateWorkspaceInput {
  slug: string
  name: string
  owner_email: string
  owner_name?: string
  owner_password?: string
  create_api_key?: boolean
  api_key_name?: string
  api_key_permissions?: string[]
  api_key_expires_in_days?: number
}

/** Injected for tests: the service database client and the auth admin API. */
export const instanceWorkspaceDeps = {
  db: async (): Promise<AnySupabaseClient> => (await import('@/lib/providers/db')).getServiceDb() as AnySupabaseClient,
  authAdmin: async () => (await import('@/lib/providers/auth')).getAuthProvider().then((p) => p.admin),
}

/** Why `slug` can't name a new workspace, or null. */
export function workspaceSlugProblem(slug: unknown): string | null {
  if (typeof slug !== 'string') return 'slug is required'
  const problem = subdomainProblem(slug)
  if (problem) return `slug: ${problem}`
  // provision_auth_user names personal workspaces personal-<user id prefix>.
  if (slug.startsWith('personal-')) return 'slug: "personal-…" is reserved for personal workspaces.'
  return null
}

function publicWorkspace(row: any) {
  return { id: row.id as string, slug: row.slug as string, name: row.name as string, subdomain: (row.subdomain ?? null) as string | null, created_at: (row.created_at ?? null) as string | null }
}

async function findBySlug(db: AnySupabaseClient, slug: string) {
  const { data, error } = await (db as any).from('tenants').select(WORKSPACE_COLUMNS).eq('slug', slug).limit(1)
  if (error) throw new ServiceError('internal', `Workspace lookup failed: ${error.message}`)
  return (data ?? [])[0] ?? null
}

/** GET /admin/workspaces/{slug}: a live workspace, else 404. */
export async function getWorkspaceBySlug(slug: string) {
  const db = await instanceWorkspaceDeps.db()
  const row = await findBySlug(db, String(slug ?? '').trim().toLowerCase())
  if (!row || row.deleted_at) throw ServiceError.notFound('Workspace not found')
  return { workspace: publicWorkspace(row) }
}

async function ownerOf(db: AnySupabaseClient, tenantId: string): Promise<string | null> {
  const { data: role } = await (db as any).from('roles').select('id').eq('tenant_id', tenantId).eq('slug', 'owner').eq('is_system', true).maybeSingle()
  if (!role) return null
  const { data } = await (db as any).from('user_roles').select('user_id').eq('tenant_id', tenantId).eq('role_id', role.id).limit(1)
  return (data ?? [])[0]?.user_id ?? null
}

/** Mint the first key in the workspace through the API key service (validation, rate limit, audit). */
async function mintKey(db: AnySupabaseClient, tenantId: string, ownerId: string | null, input: CreateWorkspaceInput) {
  const ctx: ServiceContext = {
    db, supabase: db, tenantId,
    // No acting user: attributed to the workspace owner as the key's creator.
    actorId: null, credentialOwnerId: ownerId,
    permissions: new Set(PERMISSION_KEYS),
    authKind: 'api_key', source: 'api', keyType: 'tenant',
  }
  const { createApiKey } = await import('./api-keys')
  return createApiKey(ctx, {
    name: input.api_key_name?.trim() || 'Provisioning',
    ...(input.api_key_permissions ? { permissions: input.api_key_permissions } : {}),
    ...(input.api_key_expires_in_days ? { expires_in_days: input.api_key_expires_in_days } : {}),
  })
}

async function auditCreate(db: AnySupabaseClient, tenantId: string, summary: string, metadata: Record<string, unknown>) {
  await writeAudit({ supabase: db, tenantId, actorId: null, objectType: 'workspace', objectId: tenantId, action: 'create', summary, metadata: { via: 'instance_admin_api', ...metadata } })
}

/** Add an existing user to a fresh workspace as its owner (membership + owner role). */
async function addExistingOwner(db: any, tenantId: string, userId: string): Promise<void> {
  const { data: role, error: roleErr } = await db.from('roles').select('id').eq('tenant_id', tenantId).eq('slug', 'owner').eq('is_system', true).maybeSingle()
  if (roleErr || !role) throw new Error(`owner role missing: ${roleErr?.message ?? 'not seeded'}`)
  const { error: upsertErr } = await db.from('user_memberships').upsert({ user_id: userId, tenant_id: tenantId, is_active: true }, { onConflict: 'user_id,tenant_id' })
  if (upsertErr) {
    // As grantTenantRole: environments without the unique constraint take a plain insert.
    const { error: insertErr } = await db.from('user_memberships').insert({ user_id: userId, tenant_id: tenantId, is_active: true })
    if (insertErr) throw new Error(`membership: ${insertErr.message}`)
  }
  const { error: grantErr } = await db.from('user_roles').insert({ tenant_id: tenantId, user_id: userId, role_id: role.id })
  if (grantErr) throw new Error(`owner role: ${grantErr.message}`)
}

/** A workspace row with its system roles (seeded by the tenants insert trigger, else here). */
async function insertWorkspace(db: any, input: { slug: string; name: string; email: string; ownerName: string }) {
  const { data: tenant, error } = await db.from('tenants').insert({
    name: input.name, slug: input.slug, plan: 'business_team', onboarding_completed: true,
    contact_name: input.ownerName, contact_email: input.email,
    settings: { provisioned: { source: 'instance_admin_api', created_at: new Date().toISOString() } },
  }).select(WORKSPACE_COLUMNS).single()
  if (error || !tenant) {
    if (error?.code === '23505') return null
    throw new Error(`tenant insert: ${error?.message ?? 'no row'}`)
  }
  const { data: roles } = await db.from('roles').select('id').eq('tenant_id', tenant.id).eq('is_system', true)
  if (!roles?.length) {
    const { SYSTEM_ROLES } = await import('@/lib/tenant-provisioning')
    const { error: rolesErr } = await db.from('roles').insert(SYSTEM_ROLES.map((r) => ({
      tenant_id: tenant.id, name: r.name, slug: r.slug, description: r.description, permissions: r.permissions, is_system: true,
    })))
    if (rolesErr) {
      await db.from('tenants').delete().eq('id', tenant.id).then(() => {}, () => {})
      throw new Error(`roles seed: ${rolesErr.message}`)
    }
  }
  return tenant
}

async function removeWorkspace(db: any, tenantId: string) {
  try {
    await db.from('user_roles').delete().eq('tenant_id', tenantId)
    await db.from('user_memberships').delete().eq('tenant_id', tenantId)
    await db.from('roles').delete().eq('tenant_id', tenantId)
    await db.from('tenants').delete().eq('id', tenantId)
  } catch { /* best effort */ }
}

/** Another request created the slug meanwhile: answer as the idempotent repeat (once). */
function raced(input: CreateWorkspaceInput, meta: { ip?: string }, retried: boolean): Promise<CreateWorkspaceResult> {
  if (retried) throw ServiceError.conflict(`The slug "${input.slug}" is taken`)
  return createWorkspace(input, meta, true)
}

export interface CreateWorkspaceResult {
  created: boolean
  workspace: ReturnType<typeof publicWorkspace>
  owner: { id: string; email: string; created: boolean } | null
  api_key?: unknown
  key?: string
}

export async function createWorkspace(input: CreateWorkspaceInput, meta: { ip?: string } = {}, retried = false): Promise<CreateWorkspaceResult> {
  const slug = String(input.slug ?? '').trim()
  const slugProblem = workspaceSlugProblem(slug)
  if (slugProblem) throw ServiceError.validation(slugProblem)
  const name = String(input.name ?? '').trim()
  if (!name || name.length > 100) throw ServiceError.validation('name must be 1-100 characters')
  const email = String(input.owner_email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(email) || email.length > 320) throw ServiceError.validation('owner_email must be a valid email address')
  if (input.api_key_permissions) {
    const valid = new Set<string>(PERMISSION_KEYS)
    const unknown = input.api_key_permissions.filter((p) => !valid.has(p))
    if (unknown.length) throw ServiceError.validation(`Unknown permissions: ${unknown.join(', ')}`)
  }
  const ownerName = input.owner_name?.trim() || email.split('@')[0]
  const db = await instanceWorkspaceDeps.db()
  const sdb = db as any

  // Idempotent on slug.
  const existing = await findBySlug(db, slug)
  if (existing) {
    if (existing.deleted_at) throw ServiceError.conflict(`The slug "${slug}" belongs to a deleted workspace`)
    const result: CreateWorkspaceResult = { created: false, workspace: publicWorkspace(existing), owner: null }
    if (input.create_api_key) {
      const minted = await mintKey(db, existing.id, await ownerOf(db, existing.id), input)
      Object.assign(result, { api_key: minted.api_key, key: minted.key })
    }
    console.info(`[instance-admin] workspace "${slug}" already exists (${existing.id})${input.create_api_key ? '; minted an API key' : ''}`)
    return result
  }

  const { data: users, error: userErr } = await sdb.from('users').select('id, email').eq('email', email).order('created_at').limit(1)
  if (userErr) throw new ServiceError('internal', `User lookup failed: ${userErr.message}`)
  const existingUser = (users ?? [])[0] as { id: string } | undefined

  let tenantRow: any
  let owner: { id: string; email: string; created: boolean }
  if (existingUser) {
    tenantRow = await insertWorkspace(sdb, { slug, name, email, ownerName })
    if (!tenantRow) return raced(input, meta, retried)
    try {
      await addExistingOwner(sdb, tenantRow.id, existingUser.id)
    } catch (error) {
      await removeWorkspace(sdb, tenantRow.id)
      throw new ServiceError('internal', `Workspace setup failed: ${(error as Error).message}`)
    }
    owner = { id: existingUser.id, email, created: false }
  } else {
    const { provisionTenant } = await import('@/lib/tenant-provisioning')
    const result = await provisionTenant(db, {
      fullName: ownerName, email, company: name, slug,
      password: input.owner_password || randomBytes(32).toString('base64url'),
      onboardingCompleted: true,
      userMetadata: { provisioned_by: 'instance_admin_api' },
      settings: { provisioned: { source: 'instance_admin_api', created_at: new Date().toISOString() } },
    }, await instanceWorkspaceDeps.authAdmin())
    if (!result.ok) {
      if (result.reason === 'slug_taken') return raced(input, meta, retried)
      if (result.reason === 'user_exists') throw ServiceError.conflict(`An account for ${email} exists but has no profile yet: sign in with it once, then retry`)
      throw new ServiceError('internal', `Workspace setup failed: ${result.error}`)
    }
    tenantRow = await findBySlug(db, result.slug)
    owner = { id: result.userId, email, created: true }
  }

  await auditCreate(db, tenantRow.id, `Workspace "${name}" (${slug}) created through the instance admin API`, {
    owner_id: owner.id, owner_created: owner.created, api_key: Boolean(input.create_api_key), ip: meta.ip ?? null,
  })
  console.info(`[instance-admin] created workspace "${slug}" (${tenantRow.id}); owner ${owner.id}${owner.created ? ' (new account)' : ''}`)

  const out: CreateWorkspaceResult = { created: true, workspace: publicWorkspace(tenantRow), owner }
  if (input.create_api_key) {
    const minted = await mintKey(db, tenantRow.id, owner.id, input)
    Object.assign(out, { api_key: minted.api_key, key: minted.key })
  }
  return out
}
