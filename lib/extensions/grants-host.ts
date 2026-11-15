/**
 * ctx.grants: explicit grants on an extension's own workflows and bound forms
 * (lib/services/object-permissions — the same rules, permission
 * team.change_roles, and audit entries as the object Permissions panel), so
 * an extension page can show and change who may edit, run or submit the
 * objects it made (e.g. a SharePoint list's forms and workflows) without
 * core UI. Workflows / forms of anything else read as absent (404).
 * Server-only.
 */

import { ExtensionError, type ExtensionGrant, type ExtensionGrantInput, type ExtensionGrantObject } from '@/lib/extensions/sdk'
import { asExtensionError, ownForm, ownWorkflow, serviceContext, type ObjectsHost } from './objects-host'

/* eslint-disable @typescript-eslint/no-explicit-any -- supabase rows */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function own(host: ObjectsHost, type: ExtensionGrantObject, id: string): Promise<void> {
  if (type === 'workflow') await ownWorkflow(host, id)
  else if (type === 'form') await ownForm(host, id)
  else throw new ExtensionError('invalid_request', 'Grants are for workflows and forms', 400)
}

function present(row: Record<string, any>): ExtensionGrant {
  const kind = row.role_id ? 'role' : row.team_id ? 'team' : 'person'
  const id = String(row.role_id ?? row.team_id ?? row.user_id ?? '')
  const name = kind === 'role' ? row.role?.name : kind === 'team' ? row.team?.name : (row.user?.display_name || row.user?.email)
  return { id: String(row.id), who: { kind, id, name: String(name ?? '') }, view: row.can_view === true, edit: row.can_edit === true, delete: row.can_delete === true, execute: row.can_execute === true, selfGranted: kind === 'person' && Boolean(row.granted_by) && row.granted_by === row.user_id }
}

export function hostGrants(host: ObjectsHost) {
  const service = () => import('@/lib/services/object-permissions')
  return {
    async list(type: ExtensionGrantObject, objectId: string): Promise<ExtensionGrant[]> {
      await own(host, type, objectId)
      const ctx = await serviceContext(host)
      const { listObjectPermissions } = await service()
      const rows = await asExtensionError(() => listObjectPermissions(ctx as any, type, objectId))
      const out = rows.map(present)
      // Names the embed could not resolve (e.g. a client without the joins).
      const missing = out.filter((g) => !g.who.name)
      if (missing.length) {
        const [roles, teams, users] = await Promise.all([
          host.serviceDb.from('roles').select('id, name').eq('tenant_id', host.tenantId).in('id', missing.filter((g) => g.who.kind === 'role').map((g) => g.who.id)),
          host.serviceDb.from('teams').select('id, name').eq('tenant_id', host.tenantId).in('id', missing.filter((g) => g.who.kind === 'team').map((g) => g.who.id)),
          host.serviceDb.from('users').select('id, display_name, email').in('id', missing.filter((g) => g.who.kind === 'person').map((g) => g.who.id)),
        ])
        const names = new Map<string, string>([...(roles.data ?? []), ...(teams.data ?? [])].map((r: any) => [String(r.id), String(r.name)]))
        for (const u of (users.data ?? []) as any[]) names.set(String(u.id), String(u.display_name || u.email))
        for (const g of missing) g.who.name = names.get(g.who.id) ?? g.who.kind
      }
      return out
    },
    async set(type: ExtensionGrantObject, objectId: string, input: ExtensionGrantInput): Promise<ExtensionGrant> {
      await own(host, type, objectId)
      const ctx = await serviceContext(host)
      const { setObjectPermission } = await service()
      const row = await asExtensionError(() => setObjectPermission(ctx as any, {
        object_type: type, object_id: objectId, role_id: input?.role ?? null, team_id: input?.team ?? null, user_id: input?.person ?? null,
        can_view: input?.view !== false, can_edit: Boolean(input?.edit), can_delete: Boolean(input?.delete), can_execute: Boolean(input?.execute),
      }))
      return (await this.list(type, objectId)).find((g) => g.id === String(row.id)) ?? present(row)
    },
    async remove(type: ExtensionGrantObject, objectId: string, grantId: string): Promise<void> {
      await own(host, type, objectId)
      if (!UUID_RE.test(String(grantId))) throw new ExtensionError('not_found', 'Grant not found', 404)
      // The grant must be on THIS object (never another object's grant through this one).
      const { data } = await host.serviceDb.from('object_permissions').select('id').eq('tenant_id', host.tenantId).eq('object_type', type).eq('object_id', objectId).eq('id', grantId).maybeSingle()
      if (!data) throw new ExtensionError('not_found', 'Grant not found', 404)
      const ctx = await serviceContext(host)
      const { removeObjectPermission } = await service()
      await asExtensionError(() => removeObjectPermission(ctx as any, grantId))
    },
    async principals() {
      if (!host.tenantId) throw new Error('grants.principals needs a workspace')
      if (host.permissions && !host.permissions.has('team.change_roles')) throw new ExtensionError('forbidden', 'Forbidden: you lack team.change_roles', 403)
      const [roles, teams] = await Promise.all([
        host.serviceDb.from('roles').select('id, name, permissions').eq('tenant_id', host.tenantId).order('name').limit(200),
        host.serviceDb.from('teams').select('id, name').eq('tenant_id', host.tenantId).order('name').limit(500),
      ])
      return {
        roles: ((roles.data ?? []) as any[]).map((r) => ({ id: String(r.id), name: String(r.name), permissions: Array.isArray(r.permissions) ? r.permissions.map(String) : [] })),
        teams: ((teams.data ?? []) as any[]).map((t) => ({ id: String(t.id), name: String(t.name) })),
      }
    },
  }
}
