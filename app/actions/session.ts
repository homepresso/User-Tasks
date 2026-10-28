'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { ServiceError } from '@/lib/services/context'

/*
 * Session-level reads and the workspace switch the dashboard shell made
 * from the browser. They need no current workspace (a user in the unified
 * view, or one being set up, still gets an answer) and run as the user: the
 * database functions resolve the workspace and check membership.
 */

async function sessionDb() {
  return (await sessionUser()).supabase
}

async function sessionUser() {
  const { supabase, user } = await getSessionDbWithUser()
  if (!user) throw new ServiceError('unauthorized', 'Not authenticated')
  return { supabase, user }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the profile row as the shell reads it */

/**
 * The signed-in user's profile with their home workspace, plus role and
 * permissions (the dashboard auth cache, filled at boot and on login).
 * `profile` is null when the user has no profile row.
 */
export async function getMySession(): Promise<ActionResult<{ profile: any | null; role: string | null; permissions: string[] }>> {
  return runAction('getMySession', 'Could not load your profile.', async () => {
    const { supabase: db, user } = await sessionUser()
    const [profile, role, permissions] = await Promise.all([
      db.from('users').select('*, tenant:tenants!users_tenant_id_fkey(*)').eq('id', user.id).maybeSingle(),
      db.rpc('get_user_role_in_tenant'),
      db.rpc('get_user_permissions' as never),
    ])
    if (profile.error) throw new Error(profile.error.message)
    return {
      profile: profile.data ?? null,
      role: role.error ? null : ((role.data as string | null) ?? null),
      permissions: permissions.error ? [] : (((permissions.data as unknown) as string[] | null) ?? []),
    }
  })
}

/** The user's current workspace id; null = the unified "All organizations" view. */
export async function getMyCurrentTenantId(): Promise<ActionResult<string | null>> {
  return runAction('getMyCurrentTenantId', 'Could not load your workspace.', async () => {
    const { supabase: db, user } = await sessionUser()
    const { data, error } = await db.from('users').select('current_tenant_id').eq('id', user.id).maybeSingle()
    if (error) throw new Error(error.message)
    return ((data as { current_tenant_id?: string | null } | null)?.current_tenant_id ?? null)
  })
}

/** Role and permission keys in the current workspace (dashboard auth cache). */
export async function getMyAccess(): Promise<ActionResult<{ role: string | null; permissions: string[] }>> {
  return runAction('getMyAccess', 'Could not load your permissions.', async () => {
    const db = await sessionDb()
    const [role, permissions] = await Promise.all([
      db.rpc('get_user_role_in_tenant'),
      db.rpc('get_user_permissions' as never),
    ])
    return {
      role: role.error ? null : ((role.data as string | null) ?? null),
      permissions: permissions.error ? [] : (((permissions.data as unknown) as string[] | null) ?? []),
    }
  })
}

/** Switch the current workspace; null = the unified "All organizations" view. */
export async function switchWorkspace(tenantId: string | null): Promise<ActionResult<null>> {
  return runAction('switchWorkspace', 'Could not switch workspace.', async () => {
    const db = await sessionDb()
    const { error } = await db.rpc('switch_tenant', { p_tenant_id: tenantId as string })
    if (error) throw ServiceError.forbidden(error.message)
    return null
  })
}
