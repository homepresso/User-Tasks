/**
 * Explicit workflow grants (object_permissions, object_type 'workflow')
 * naming a person directly, a role they hold or a team they are in.
 *
 *  - can_view: the person sees every run of the workflow (run-visibility).
 *  - can_edit: the person MANAGES the workflow ("workflow manager / owner"):
 *    on top of seeing its runs, they may open its User Tasks and act on
 *    behalf of the assignee with a reason (lib/task-authz.ts), audited as
 *    such. A View-only grant never allows acting.
 *
 * Reads are tenant-filtered; `db` must be able to read grants, roles and
 * teams of the workspace (the service-role client on the server).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped client rows */

export type WorkflowGrantLevel = 'can_view' | 'can_edit'

export class WorkflowGrantError extends Error {
  constructor(message: string) { super(message); this.name = 'WorkflowGrantError' }
}

/** Workflow ids the person holds an explicit grant of `level` on (optionally only among `workflowIds`). */
export async function workflowGrantIds(db: any, tenantId: string, userId: string, level: WorkflowGrantLevel = 'can_view', workflowIds?: string[]): Promise<string[]> {
  if (workflowIds && workflowIds.length === 0) return []
  let grantsQuery = db.from('object_permissions').select('object_id, user_id, role_id, team_id')
    .eq('tenant_id', tenantId).eq('object_type', 'workflow').eq(level, true)
  if (workflowIds) grantsQuery = grantsQuery.in('object_id', workflowIds)
  const [roles, teams, grants] = await Promise.all([
    db.from('user_roles').select('role_id').eq('tenant_id', tenantId).eq('user_id', userId),
    db.from('user_teams').select('team_id').eq('user_id', userId),
    grantsQuery,
  ])
  for (const r of [roles, teams, grants]) if (r.error) throw new WorkflowGrantError(r.error.message ?? 'Failed to load workflow grants')
  const roleIds = new Set(((roles.data ?? []) as any[]).map((r) => r.role_id).filter(Boolean))
  // Teams of this workspace only (user_teams has no tenant column).
  const allTeamIds = ((teams.data ?? []) as any[]).map((t) => t.team_id).filter(Boolean)
  let teamIds = new Set<string>()
  if (allTeamIds.length) {
    const { data, error } = await db.from('teams').select('id').eq('tenant_id', tenantId).in('id', allTeamIds)
    if (error) throw new WorkflowGrantError(error.message ?? 'Failed to load teams')
    teamIds = new Set(((data ?? []) as any[]).map((t) => String(t.id)))
  }
  const mine = ((grants.data ?? []) as any[]).filter((g) =>
    g.user_id === userId || (g.role_id && roleIds.has(g.role_id)) || (g.team_id && teamIds.has(String(g.team_id))))
  return [...new Set(mine.map((g) => String(g.object_id)))]
}

/** Does the person manage (explicit Edit grant on) this workflow? */
export async function isWorkflowManager(db: any, tenantId: string, userId: string | null, workflowId: string | null | undefined): Promise<boolean> {
  if (!userId || !workflowId) return false
  return (await workflowGrantIds(db, tenantId, userId, 'can_edit', [workflowId])).includes(workflowId)
}
