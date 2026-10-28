import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Data for the governance settings page. Loaded only once the tenant is known
 * (an empty id would query `tenant_id=eq.` and fail). permission_audit_log has
 * no foreign key on actor_id, so the actor is resolved from the tenant's users
 * here — a PostgREST embed (`actor:users!…`) answered 400 and left the audit
 * log empty.
 */
type Row = Record<string, unknown>
interface UserRow extends Row { id: string; display_name: string | null }
interface AssignmentRow extends Row { user_id: string }
interface AuditRow extends Row { actor_id: string | null }

export async function loadGovernanceData(supabase: SupabaseClient, tenantId: string) {
  if (!tenantId) throw new Error('loadGovernanceData: tenant id is required')
  // Untyped tables (roles, user_roles, …) are not all in the generated types.
  const db = supabase as unknown as { from: (table: string) => ReturnType<SupabaseClient['from']> }

  const [
    { data: roles },
    { data: users },
    { data: userRoleAssignments },
    { data: retentionPolicies },
    { data: auditLog },
  ] = await Promise.all([
    db.from('roles')
      .select('*, retention_policy:retention_policies(id, name, description, policy_mode, duration_value, duration_unit, exact_date, applies_to)')
      .eq('tenant_id', tenantId)
      .order('is_system', { ascending: false })
      .order('name'),
    db.from('users').select('id, display_name, email, role').eq('tenant_id', tenantId).order('display_name'),
    db.from('user_roles').select('id, user_id, role_id, role:roles(id, name, slug, is_system)').eq('tenant_id', tenantId),
    db.from('retention_policies').select('id, name, description, policy_mode, duration_value, duration_unit, exact_date, applies_to').eq('tenant_id', tenantId).order('name'),
    db.from('permission_audit_log')
      .select('id, action, actor_id, target_user_id, role_id, details, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }).limit(50),
  ])

  const userRows = (users ?? []) as UserRow[]
  const assignmentMap = new Map<string, AssignmentRow[]>()
  for (const a of (userRoleAssignments ?? []) as AssignmentRow[]) {
    if (!assignmentMap.has(a.user_id)) assignmentMap.set(a.user_id, [])
    assignmentMap.get(a.user_id)!.push(a)
  }
  const usersById = new Map(userRows.map((u) => [u.id, u]))

  return {
    roles: (roles ?? []) as Row[],
    users: userRows.map((u) => ({ ...u, assignments: assignmentMap.get(u.id) ?? [] })),
    retentionPolicies: (retentionPolicies ?? []) as Row[],
    auditLog: ((auditLog ?? []) as AuditRow[]).map((entry) => {
      const actor = entry.actor_id ? usersById.get(entry.actor_id) : undefined
      return { ...entry, actor: actor ? { id: actor.id, display_name: actor.display_name } : null }
    }),
  }
}
