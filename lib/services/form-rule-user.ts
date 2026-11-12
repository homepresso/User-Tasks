/**
 * The signed-in person as form rules read them (`user.*` in conditions,
 * placeholders and List validations — lib/forms/form-rules.ts ruleValue):
 *
 *   { id, email, name, roles: string[], teams: string[] }
 *
 * `roles`: the person's workspace roles (user_roles → roles), each as its
 * name, slug and id; `teams`: the teams they belong to in this workspace
 * (user_teams → teams), each as its name and id. So a condition can name a
 * role or team either way: `user.roles contains "Manager"`,
 * `user.teams contains "<team id>"` (comparisons ignore case).
 *
 * The browser reads it through the `forms.ruleUser` read; the server builds
 * its own for every check it makes at submit (Always rules, Validate rules,
 * rule claims, read-only writes, List validations) — never the browser's.
 * Anonymous visitors (public links) have no id and empty roles / teams.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- user_roles / user_teams are read untyped */

export interface RuleUser {
  id: string | null
  email: string | null
  name: string | null
  roles: string[]
  teams: string[]
}

/** Nobody signed in (a public link): empty roles and teams. */
export const ANONYMOUS_RULE_USER: RuleUser = Object.freeze({ id: null, email: null, name: null, roles: [], teams: [] }) as RuleUser

const unique = (values: unknown[]): string[] => [...new Set(values.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim()))]

/**
 * The person's rule user in a workspace. Read with explicit tenant and user
 * filters; a failed read gives empty roles / teams (rules that need a role
 * then fail closed).
 */
export async function loadRuleUser(db: any, tenantId: string | null | undefined, actorId: string | null | undefined): Promise<RuleUser> {
  if (!actorId || !db) return { ...ANONYMOUS_RULE_USER, roles: [], teams: [] }
  const [profile, roles, teams] = await Promise.all([
    Promise.resolve(db.from('users').select('id, email, display_name').eq('id', actorId).maybeSingle()).catch(() => ({ data: null })),
    tenantId
      ? Promise.resolve(db.from('user_roles').select('role_id, role:roles(id, name, slug)').eq('tenant_id', tenantId).eq('user_id', actorId)).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
    tenantId
      ? Promise.resolve(db.from('user_teams').select('team_id, team:teams(id, name, tenant_id)').eq('user_id', actorId)).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
  ])
  const roleRows = Array.isArray((roles as any)?.data) ? (roles as any).data : []
  const teamRows = Array.isArray((teams as any)?.data) ? (teams as any).data : []
  const roleValues = roleRows.flatMap((r: any) => {
    const role = Array.isArray(r.role) ? r.role[0] : r.role
    return [role?.name, role?.slug, role?.id ?? r.role_id]
  })
  // user_teams has no tenant column: only this workspace's teams count.
  const teamValues = teamRows.flatMap((t: any) => {
    const team = Array.isArray(t.team) ? t.team[0] : t.team
    if (!team || team.tenant_id !== tenantId) return []
    return [team.name, team.id ?? t.team_id]
  })
  const data = (profile as any)?.data ?? null
  return {
    id: actorId,
    email: (data?.email ?? null) as string | null,
    name: (data?.display_name ?? null) as string | null,
    roles: unique(roleValues),
    teams: unique(teamValues),
  }
}
