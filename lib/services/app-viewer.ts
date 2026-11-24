/**
 * The viewer's profile for an app's system variables (lib/apps/variables.ts
 * systemVariables): name, email, avatar, teams, roles, manager, timezone
 * and the workspace — the signed-in person's own data only, for someone who
 * can open the app. Read-only; the server never trusts these values back
 * (server actions use the session).
 */

import type { Viewer } from '@/lib/apps/variables'
import { ServiceError, type ServiceContext } from './context'
import { serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- joined rows */

export interface AppViewerProfile { user: Viewer; workspace: { id: string; name: string | null } }

export async function appViewerProfile(ctx: ServiceContext, appKey: string): Promise<AppViewerProfile> {
  const { getAppAccess } = await import('./apps')
  if (!(await getAppAccess(ctx, appKey))) throw ServiceError.notFound('App not found')
  const db = await serviceRoleClient(ctx) as any
  const uid = ctx.actorId ?? null
  const [tenant, user, teams, roles] = await Promise.all([
    db.from('tenants').select('id, name').eq('id', ctx.tenantId).maybeSingle(),
    uid ? db.from('users').select('id, display_name, email, avatar_url, timezone, manager_id').eq('id', uid).maybeSingle() : { data: null },
    uid ? db.from('user_teams').select('team:teams!inner(id, name, tenant_id)').eq('user_id', uid).eq('team.tenant_id', ctx.tenantId) : { data: [] },
    uid ? db.from('user_roles').select('role:roles(id, name)').eq('tenant_id', ctx.tenantId).eq('user_id', uid) : { data: [] },
  ])
  const u = user.data
  let manager: Viewer['manager'] = null
  if (u?.manager_id) {
    // Only a manager who is a member of this workspace.
    const { data: m } = await db.from('user_memberships').select('user:users(id, display_name, email)').eq('tenant_id', ctx.tenantId).eq('user_id', u.manager_id).eq('is_active', true).maybeSingle()
    if (m?.user) manager = { id: String(m.user.id), name: m.user.display_name ?? null, email: m.user.email ?? null }
  }
  const one = (x: any) => (Array.isArray(x) ? x[0] : x)
  return {
    user: {
      id: uid, name: u?.display_name ?? null, email: u?.email ?? null, avatar: u?.avatar_url ?? null, timezone: u?.timezone ?? null, manager,
      teams: ((teams.data ?? []) as any[]).map((t) => one(t.team)).filter(Boolean).map((t) => ({ id: String(t.id), name: String(t.name ?? '') })),
      roles: ((roles.data ?? []) as any[]).map((r) => one(r.role)).filter(Boolean).map((r) => ({ id: String(r.id), name: String(r.name ?? '') })),
    },
    workspace: { id: ctx.tenantId, name: tenant.data?.name ?? null },
  }
}
