import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import * as roles from '@/lib/services/roles'
import * as teams from '@/lib/services/teams'
import * as invitations from '@/lib/services/invitations'
import * as managers from '@/lib/services/manager-tasks'
import * as objectPermissions from '@/lib/services/object-permissions'
import { OBJECT_PERMISSION_TYPES } from '@/lib/object-permission-types'
import { messageOf } from './_util'

/*
 * Governance tools: thin wrappers over lib/services/{roles,teams,invitations},
 * which own permission checks, tenant filtering, system-role protection and
 * audit (mutating tools are in AUDITED_IN_SERVICE in ../authz). Reads are
 * gated with their *.view permission (READ_TOOL_PERMISSIONS in ../authz).
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

export function registerGovernanceTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  const GRANT_HELP = 'Grant columns: can_view, can_edit, can_delete, can_execute. Forms use View and Submit (can_execute): with the form in Available forms, a grant lists it in the person\'s Forms menu; Edit and Delete do not apply to forms.'

  server.tool('object_permissions_list', `List the explicit grants (role, team or person) on one object. ${GRANT_HELP}`, {
    object_type: z.enum(OBJECT_PERMISSION_TYPES).describe('Object type'),
    object_id: z.string().describe('Object ID'),
  }, async (args) => run(async () => {
    const permissions = await objectPermissions.listObjectPermissions(svc(), args.object_type, args.object_id)
    return { permissions, count: permissions.length }
  }))

  server.tool('object_permissions_set', `Add or change one grantee's grant on an object (team.change_roles; audited as grant on the object). Give exactly one of role_id, team_id, user_id. ${GRANT_HELP}`, {
    object_type: z.enum(OBJECT_PERMISSION_TYPES).describe('Object type'),
    object_id: z.string().describe('Object ID'),
    role_id: z.string().optional().describe('Grant to a role'),
    team_id: z.string().optional().describe('Grant to a team'),
    user_id: z.string().optional().describe('Grant to a person'),
    can_view: z.boolean().optional().describe('View (default true)'),
    can_edit: z.boolean().optional().describe('Edit (not used by forms)'),
    can_delete: z.boolean().optional().describe('Delete (not used by forms)'),
    can_execute: z.boolean().optional().describe('Execute; Submit for forms'),
  }, async (args) => run(async () => ({ permission: await objectPermissions.setObjectPermission(svc(), args) })))

  server.tool('object_permissions_remove', 'Remove one grant by its id (object_permissions_list → id); audited as revoke on the object.', {
    permission_id: z.string().describe('Grant ID'),
  }, async (args) => run(async () => objectPermissions.removeObjectPermission(svc(), args.permission_id)))

  server.tool('users_list', 'List users in the tenant so MCP can discover assignees, role targets, team members, and user-context API key subjects. Supports search and can include roles and teams for richer prompt-driven coordination.', {
    search: z.string().optional().describe('Search display name or email'),
    include_roles: z.boolean().optional().describe('Include assigned roles for each user'),
    include_teams: z.boolean().optional().describe('Include team memberships for each user'),
    limit: z.number().optional().describe('Max results (default 50, hard cap 200)'),
  }, async (args) => run(async () => {
    const limit = Math.max(1, Math.min(args.limit ?? 50, 200))
    const { users, total } = await roles.listUsers(svc(), {
      search: args.search, include_roles: args.include_roles, include_teams: args.include_teams,
    }, { limit, offset: 0 })
    return { users, count: users.length, total }
  }))

  server.tool('users_manager_get', 'Get a workspace member\'s reporting line: their manager, manager chain (nearest first) and direct reports. Reporting lines drive the manager view (tasks_list scope "reports") and who may act on a workflow task on behalf of its assignee. Use user_id "me" for the caller.', {
    user_id: z.string().describe('User ID, or "me"'),
  }, async (args) => run(async () => {
    const ctxSvc = svc()
    const id = args.user_id === 'me' ? ctxSvc.actorId : args.user_id
    if (!id) throw new Error('"me" needs a user-bound credential')
    return managers.getReportingLine(ctxSvc, id)
  }))

  server.tool('users_manager_set', 'Set or clear (manager_user_id null) a member\'s manager in this workspace. The manager must be an active member; loops are refused. Directory sync overwrites lines for users it manages when the provider has a manager attribute.', {
    user_id: z.string().describe('User ID of the member'),
    manager_user_id: z.string().nullable().describe('User ID of their manager, or null to clear'),
  }, async (args) => run(async () => managers.setManager(svc(), args.user_id, args.manager_user_id)))

  server.tool('users_reports', 'List a member\'s reports: direct reports, or every level with indirect=true (cycle-safe, up to 10 levels). Use user_id "me" for the caller.', {
    user_id: z.string().describe('User ID, or "me"'),
    indirect: z.boolean().optional().describe('Include reports of reports'),
  }, async (args) => run(async () => {
    const ctxSvc = svc()
    const id = args.user_id === 'me' ? ctxSvc.actorId : args.user_id
    if (!id) throw new Error('"me" needs a user-bound credential')
    return managers.listReportsOf(ctxSvc, id, { indirect: args.indirect === true })
  }))

  server.tool('roles_list', 'List all roles (system and custom) with their permissions so MCP can target governance, assignments, and role-based automation safely.', {}, async () => run(async () => {
    const { roles: rows } = await roles.listRoles(svc())
    return { roles: rows }
  }))

  server.tool('team_members_list', 'List users with their role assignments so MCP can understand team-wide governance context and assign work accurately.', {}, async () => run(async () => {
    const { users } = await roles.listUsers(svc(), { include_roles: true }, { limit: null, offset: 0 })
    const members = users.map(({ id, display_name, email, role, roles: assigned }: Record<string, unknown>) => ({ id, display_name, email, role, roles: assigned ?? [] }))
    return { members, count: members.length }
  }))

  server.tool('roles_manage', 'Create, update, or delete roles, and assign or remove roles from users. Use this for MCP-driven governance administration without relying on the UI. System roles keep their name and cannot be deleted.', {
    action: z.enum(['create_role', 'update_role', 'delete_role', 'assign_role', 'remove_role']).describe('Action to perform'),
    role_name: z.string().optional().describe('Role name (for create/update)'),
    role_id: z.string().optional().describe('Role ID (for update/delete/assign/remove)'),
    user_id: z.string().optional().describe('User ID (for assign/remove)'),
    description: z.string().optional(),
    permissions: z.array(z.string()).optional().describe('Permission keys (for create/update)'),
  }, async (args) => run(async () => {
    const ctxSvc = svc()
    switch (args.action) {
      case 'create_role': {
        if (!args.role_name) throw new Error('role_name required')
        const role = await roles.createRole(ctxSvc, { name: args.role_name, description: args.description, permissions: args.permissions ?? [] })
        return { created: true, role }
      }
      case 'update_role': {
        if (!args.role_id) throw new Error('role_id required')
        const role = await roles.updateRole(ctxSvc, args.role_id, { name: args.role_name, description: args.description, permissions: args.permissions })
        return { updated: true, role_id: args.role_id, role }
      }
      case 'delete_role': {
        if (!args.role_id) throw new Error('role_id required')
        await roles.deleteRole(ctxSvc, args.role_id)
        return { deleted: true, role_id: args.role_id }
      }
      case 'assign_role': {
        if (!args.user_id || !args.role_id) throw new Error('user_id and role_id required')
        const result = await roles.assignRole(ctxSvc, args.user_id, args.role_id)
        return result.already_assigned ? { already_assigned: true } : { assigned: true, user_id: args.user_id, role_id: args.role_id }
      }
      case 'remove_role': {
        if (!args.user_id || !args.role_id) throw new Error('user_id and role_id required')
        const result = await roles.removeUserRole(ctxSvc, args.user_id, args.role_id)
        return { removed: result.removed, user_id: args.user_id, role_id: args.role_id }
      }
      default: throw new Error('Unknown action')
    }
  }))

  server.tool('roles_get', 'Get one role with its permission keys.', {
    role_id: z.string().describe('Role ID'),
  }, async (args) => run(async () => ({ role: await roles.getRole(svc(), args.role_id) })))

  server.tool('audit_log_query', 'Query the permission audit log so MCP can inspect governance changes such as role creation, role assignment, and related access-control events.', {
    limit: z.number().optional(),
    action_filter: z.string().optional().describe('Filter by action type (e.g. role_created, user_role_assigned)'),
  }, async (args) => run(async () => ({ entries: await roles.listGovernanceLog(svc(), { action: args.action_filter, limit: args.limit }) })))

  // --- Teams ---

  server.tool('teams_list', 'List teams with member counts so MCP can discover assignment targets, routing groups, and team organization.', {}, async () => run(async () => {
    const { teams: rows } = await teams.listTeams(svc())
    return { teams: rows, count: rows.length }
  }))

  server.tool('teams_get', 'Get one team with its members.', {
    team_id: z.string().describe('Team ID'),
  }, async (args) => run(() => teams.getTeam(svc(), args.team_id)))

  const teamFields = {
    parent_id: z.string().nullable().optional().describe('Parent team ID (loops are refused)'),
    lead_user_id: z.string().nullable().optional().describe('Team lead (an active member)'),
    org_unit_id: z.string().nullable().optional().describe('Org unit the team belongs to'),
    colour: z.string().nullable().optional().describe('Hex colour like #3366FF'),
    kind: z.string().nullable().optional().describe('team (default), squad, guild or custom'),
  }

  server.tool('teams_create', 'Create a new team that can be used for task routing, governance, and workflow assignment.', {
    name: z.string().describe('Team name'),
    description: z.string().optional(),
    ...teamFields,
  }, async (args) => run(async () => ({ created: true, team: await teams.createTeam(svc(), args) })))

  server.tool('teams_update', 'Update a team including its name or description.', {
    team_id: z.string().describe('Team ID'),
    name: z.string().optional(),
    description: z.string().optional(),
    ...teamFields,
  }, async ({ team_id, ...input }) => run(async () => {
    await teams.updateTeam(svc(), team_id, input)
    return { updated: true, team_id }
  }))

  server.tool('teams_delete', 'Delete a team and remove all member associations. Use with care because workflows and assignments may depend on team targeting.', {
    team_id: z.string().describe('Team ID'),
  }, async (args) => run(async () => {
    await teams.deleteTeam(svc(), args.team_id)
    return { deleted: true, team_id: args.team_id }
  }))

  server.tool('teams_add_member', 'Add a user to a team so the team can be used for routing, governance, and workflow assignment.', {
    team_id: z.string().describe('Team ID'),
    user_id: z.string().describe('User ID'),
  }, async (args) => run(async () => {
    const result = await teams.addTeamMember(svc(), args.team_id, args.user_id)
    return result.already_member ? { already_member: true } : { added: true, team_id: args.team_id, user_id: args.user_id }
  }))

  server.tool('teams_remove_member', 'Remove a user from a team.', {
    team_id: z.string().describe('Team ID'),
    user_id: z.string().describe('User ID'),
  }, async (args) => run(async () => {
    const result = await teams.removeTeamMember(svc(), args.team_id, args.user_id)
    return { removed: result.removed, team_id: args.team_id, user_id: args.user_id }
  }))

  // --- Invitations ---

  server.tool('invitations_list', 'List pending invitations that have not yet been accepted. Acceptance tokens are never returned.', {}, async () => run(async () => {
    const { invitations: rows } = await invitations.listInvitations(svc(), { status: 'pending' }, { limit: null, offset: 0 })
    return { invitations: rows, count: rows.length }
  }))

  server.tool('invitations_send', 'Invite someone to the tenant by email. The acceptance link is emailed (never returned) and expires after 7 days.', {
    email: z.string().describe('Email address to invite'),
    role: z.string().describe('Role to assign: owner, admin, manager, member or viewer'),
  }, async (args) => run(async () => {
    const result = await invitations.sendInvitation(svc(), { email: args.email, role: args.role })
    return { sent: true, ...result }
  }))

  server.tool('invitations_revoke', 'Revoke (delete) a pending invitation', {
    invitation_id: z.string().describe('Invitation ID'),
  }, async (args) => run(async () => {
    await invitations.revokeInvitation(svc(), args.invitation_id)
    return { revoked: true, invitation_id: args.invitation_id }
  }))

  server.tool('invitations_resend', 'Email a pending invitation again with a fresh link and a new 7-day expiry.', {
    invitation_id: z.string().describe('Invitation ID'),
  }, async (args) => run(async () => ({ resent: true, ...(await invitations.resendInvitation(svc(), args.invitation_id)) })))
}
