import { z } from 'zod'
import { INVITABLE_ROLES } from '@/lib/invitation-roles'
import { OBJECT_PERMISSION_TYPES } from '@/lib/object-permission-types'
import { defineEndpoint } from './registry'
import { booleanFlag, deletedResponse, idParams, itemResponse, listResponse, paginationQuery } from './common'

const SYSTEM_ROLE_NOTE = 'System roles keep their name and cannot be deleted; their description and permissions can be edited. Unknown permission keys are dropped.'

export const roleCreateBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().nullable().optional(),
  permissions: z.array(z.string()).default([]).describe('Permission keys, e.g. ["tasks.view_all", "workflows.view"]'),
})

export const roleUpdateBody = z.object({
  name: z.string().min(1).max(100).optional().describe('New name (custom roles only)'),
  description: z.string().nullable().optional(),
  permissions: z.array(z.string()).optional().describe('Replaces the role permission list'),
})

export const teamCreateBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional().describe('Parent team id (loops are refused)'),
  lead_user_id: z.string().nullable().optional().describe('Team lead (an active member)'),
  org_unit_id: z.string().nullable().optional().describe('Org unit the team belongs to'),
  colour: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional().describe('Hex colour like #3366FF'),
  kind: z.string().max(50).nullable().optional().describe('team (default), squad, guild or any custom kind'),
})

export const teamUpdateBody = teamCreateBody.partial()

export const teamMemberBody = z.object({
  role: z.string().max(50).optional().describe('Member role within the team (default member)'),
})

export const invitationCreateBody = z.object({
  email: z.string().email(),
  role: z.enum(INVITABLE_ROLES).default('member').describe('Workspace role granted on acceptance'),
})

const userRoleParams = z.object({ id: z.string().describe('User id'), roleId: z.string().describe('Role id') })
const teamMemberParams = z.object({ id: z.string().describe('Team id'), userId: z.string().describe('User id') })

const roleTags = ['Roles & users']
const teamTags = ['Teams']
const invitationTags = ['Invitations']

export const listRolesEndpoint = defineEndpoint({
  method: 'GET', path: '/roles', operationId: 'listRoles', tags: roleTags,
  summary: 'List system and custom roles with their permissions', permission: 'team.view_members',
  response: listResponse('roles'), listKey: 'roles',
  cli: { resource: 'roles', verb: 'list' },
})

export const createRoleEndpoint = defineEndpoint({
  method: 'POST', path: '/roles', operationId: 'createRole', tags: roleTags,
  summary: 'Create a custom role', description: SYSTEM_ROLE_NOTE, permission: 'team.change_roles',
  body: roleCreateBody, successStatus: 201, response: itemResponse('role'),
  cli: { resource: 'roles', verb: 'create' },
})

export const getRoleEndpoint = defineEndpoint({
  method: 'GET', path: '/roles/{id}', operationId: 'getRole', tags: roleTags,
  summary: 'Get a role', permission: 'team.view_members', params: idParams, response: itemResponse('role'),
  cli: { resource: 'roles', verb: 'get', positional: ['id'] },
})

export const updateRoleEndpoint = defineEndpoint({
  method: 'PATCH', path: '/roles/{id}', operationId: 'updateRole', tags: roleTags,
  summary: 'Update a role', description: SYSTEM_ROLE_NOTE, permission: 'team.change_roles',
  params: idParams, body: roleUpdateBody, response: itemResponse('role'),
  roundTrip: { unwrap: 'role' },
  cli: { resource: 'roles', verb: 'update', positional: ['id'] },
})

export const deleteRoleEndpoint = defineEndpoint({
  method: 'DELETE', path: '/roles/{id}', operationId: 'deleteRole', tags: roleTags,
  summary: 'Delete a custom role (its assignments are removed; 409 for system roles)', permission: 'team.change_roles',
  params: idParams, response: deletedResponse,
  cli: { resource: 'roles', verb: 'delete', positional: ['id'] },
})

export const listUsersEndpoint = defineEndpoint({
  method: 'GET', path: '/users', operationId: 'listUsers', tags: roleTags,
  summary: 'List workspace users', permission: 'team.view_members',
  query: paginationQuery.extend({
    search: z.string().optional().describe('Display name or email contains'),
    include_roles: booleanFlag('Include each user\'s roles'),
    include_teams: booleanFlag('Include each user\'s teams'),
  }),
  response: listResponse('users'), listKey: 'users',
  cli: { resource: 'users', verb: 'list' },
})

export const assignUserRoleEndpoint = defineEndpoint({
  method: 'PUT', path: '/users/{id}/roles/{roleId}', operationId: 'assignUserRole', tags: roleTags,
  summary: 'Give a user a role (idempotent)', permission: 'team.change_roles',
  params: userRoleParams, response: z.looseObject({ assigned: z.literal(true), already_assigned: z.boolean() }),
  cli: { resource: 'users', verb: 'add-role', positional: ['id', 'roleId'] },
})

export const removeUserRoleEndpoint = defineEndpoint({
  method: 'DELETE', path: '/users/{id}/roles/{roleId}', operationId: 'removeUserRole', tags: roleTags,
  summary: 'Remove a role from a user', permission: 'team.change_roles',
  params: userRoleParams, response: z.looseObject({ removed: z.boolean() }),
  cli: { resource: 'users', verb: 'remove-role', positional: ['id', 'roleId'] },
})

const userIdOrMe = z.object({ id: z.string().min(1).describe('User id, or `me` for the caller') })

export const managerSetBody = z.object({
  manager_user_id: z.string().uuid().nullable().describe('The member\'s manager in this workspace (null clears it). Must be an active member; loops are refused'),
})

const personSchema = z.looseObject({ id: z.string(), display_name: z.string().nullable(), email: z.string().nullable() })
const reportingLineResponse = z.looseObject({
  user: personSchema,
  manager: personSchema.nullable(),
  manager_source: z.string().nullable().describe("'manual' (Settings, API, MCP, CLI) or 'directory' (directory sync)"),
  manager_updated_at: z.string().nullable(),
  direct_reports: z.array(personSchema),
  chain: z.array(personSchema).describe('Managers above the member, nearest first'),
})

export const getUserManagerEndpoint = defineEndpoint({
  method: 'GET', path: '/users/{id}/manager', operationId: 'getUserManager', tags: roleTags,
  summary: 'A member\'s manager, manager chain and direct reports', permission: 'team.view_members',
  params: userIdOrMe, response: reportingLineResponse,
  cli: { resource: 'users', verb: 'manager', positional: ['id'] },
})

export const setUserManagerEndpoint = defineEndpoint({
  method: 'PUT', path: '/users/{id}/manager', operationId: 'setUserManager', tags: roleTags,
  summary: 'Set or clear a member\'s manager in this workspace', permission: 'team.change_roles',
  description: 'Reporting lines drive the manager view (GET /tasks?scope=reports) and who may act on a workflow task on behalf of its assignee. Directory sync overwrites lines for users it manages when the provider has a manager attribute.',
  params: userIdOrMe, body: managerSetBody, response: reportingLineResponse,
  cli: { resource: 'users', verb: 'set-manager', positional: ['id'] },
})

export const listUserReportsEndpoint = defineEndpoint({
  method: 'GET', path: '/users/{id}/reports', operationId: 'listUserReports', tags: roleTags,
  summary: 'A member\'s reports (direct, or all levels with indirect=true)', permission: 'team.view_members',
  params: userIdOrMe,
  query: z.object({ indirect: booleanFlag('Include reports of reports (up to 10 levels, cycle-safe)') }),
  response: z.looseObject({
    manager_user_id: z.string(), indirect: z.boolean(), max_depth: z.number().int(),
    reports: z.array(personSchema.extend({ depth: z.number().int(), manager_user_id: z.string() })),
  }),
  listKey: 'reports',
  cli: { resource: 'users', verb: 'reports', positional: ['id'] },
})

export const listTeamsEndpoint = defineEndpoint({
  method: 'GET', path: '/teams', operationId: 'listTeams', tags: teamTags,
  summary: 'List teams with member counts', permission: 'team.view_members',
  response: listResponse('teams'), listKey: 'teams',
  cli: { resource: 'teams', verb: 'list' },
})

export const createTeamEndpoint = defineEndpoint({
  method: 'POST', path: '/teams', operationId: 'createTeam', tags: teamTags,
  summary: 'Create a team', permission: 'team.invite',
  body: teamCreateBody, successStatus: 201, response: itemResponse('team'),
  cli: { resource: 'teams', verb: 'create' },
})

export const getTeamEndpoint = defineEndpoint({
  method: 'GET', path: '/teams/{id}', operationId: 'getTeam', tags: teamTags,
  summary: 'Get a team with its members', permission: 'team.view_members', params: idParams, response: itemResponse('team'),
  cli: { resource: 'teams', verb: 'get', positional: ['id'] },
})

export const updateTeamEndpoint = defineEndpoint({
  method: 'PATCH', path: '/teams/{id}', operationId: 'updateTeam', tags: teamTags,
  summary: 'Update a team', permission: 'team.invite',
  params: idParams, body: teamUpdateBody, response: itemResponse('team'),
  roundTrip: { unwrap: 'team' },
  cli: { resource: 'teams', verb: 'update', positional: ['id'] },
})

export const deleteTeamEndpoint = defineEndpoint({
  method: 'DELETE', path: '/teams/{id}', operationId: 'deleteTeam', tags: teamTags,
  summary: 'Delete a team and its memberships', permission: 'team.remove',
  params: idParams, response: deletedResponse,
  cli: { resource: 'teams', verb: 'delete', positional: ['id'] },
})

export const addTeamMemberEndpoint = defineEndpoint({
  method: 'PUT', path: '/teams/{id}/members/{userId}', operationId: 'addTeamMember', tags: teamTags,
  summary: 'Add a user to a team (idempotent)', permission: 'team.invite',
  params: teamMemberParams, body: teamMemberBody, response: z.looseObject({ added: z.literal(true), already_member: z.boolean() }),
  cli: { resource: 'teams', verb: 'add-member', positional: ['id', 'userId'] },
})

export const removeTeamMemberEndpoint = defineEndpoint({
  method: 'DELETE', path: '/teams/{id}/members/{userId}', operationId: 'removeTeamMember', tags: teamTags,
  summary: 'Remove a user from a team', permission: 'team.remove',
  params: teamMemberParams, response: z.looseObject({ removed: z.boolean() }),
  cli: { resource: 'teams', verb: 'remove-member', positional: ['id', 'userId'] },
})

const INVITE_NOTE = 'The acceptance link is emailed to the invitee and expires after 7 days; the token itself is never returned.'

export const listInvitationsEndpoint = defineEndpoint({
  method: 'GET', path: '/invitations', operationId: 'listInvitations', tags: invitationTags,
  summary: 'List invitations (pending by default)', permission: 'team.invite',
  query: paginationQuery.extend({ status: z.enum(['pending', 'all']).optional().describe('pending (default) or all') }),
  response: listResponse('invitations'), listKey: 'invitations',
  cli: { resource: 'invitations', verb: 'list' },
})

export const sendInvitationEndpoint = defineEndpoint({
  method: 'POST', path: '/invitations', operationId: 'sendInvitation', tags: invitationTags,
  summary: 'Invite someone to the workspace by email', description: INVITE_NOTE, permission: 'team.invite',
  body: invitationCreateBody, successStatus: 201,
  response: z.looseObject({ invitation: z.looseObject({}), email_sent: z.boolean() }),
  cli: { resource: 'invitations', verb: 'send' },
})

export const revokeInvitationEndpoint = defineEndpoint({
  method: 'DELETE', path: '/invitations/{id}', operationId: 'revokeInvitation', tags: invitationTags,
  summary: 'Revoke an invitation (its link stops working)', permission: 'team.invite',
  params: idParams, response: z.looseObject({ revoked: z.literal(true) }),
  cli: { resource: 'invitations', verb: 'revoke', positional: ['id'] },
})

export const resendInvitationEndpoint = defineEndpoint({
  method: 'POST', path: '/invitations/{id}/resend', operationId: 'resendInvitation', tags: invitationTags,
  summary: 'Email a pending invitation again with a fresh link and expiry', description: INVITE_NOTE, permission: 'team.invite',
  params: idParams, response: z.looseObject({ invitation: z.looseObject({}), email_sent: z.boolean() }),
  cli: { resource: 'invitations', verb: 'resend', positional: ['id'] },
})

export const listAuditLogEndpoint = defineEndpoint({
  method: 'GET', path: '/audit-log', operationId: 'listAuditLog', tags: ['Audit log'],
  summary: 'Query the object audit log (newest first)',
  description: 'Every create, update, delete, publish, grant and revoke recorded across the workspace, with the actor and a short diff. Forms also record availability toggles (toggle), retention-policy changes (retention), submission purges (purge) and legal holds (legal_hold / legal_hold_release).',
  permission: 'settings.view',
  query: paginationQuery.extend({
    object_type: z.string().optional().describe('e.g. workflow, data_table, form, role, api_key, webhook'),
    object_id: z.string().optional(),
    actor_id: z.string().optional().describe('User id of the actor'),
    action: z.string().optional().describe('e.g. create, update, delete, grant, revoke, toggle, retention, purge, legal_hold'),
    from: z.string().optional().describe('ISO timestamp: events at or after'),
    to: z.string().optional().describe('ISO timestamp: events at or before'),
  }),
  response: listResponse('events'), listKey: 'events',
  cli: { resource: 'audit-log', verb: 'list' },
})

const OBJECT_TYPES_NOTE = `Explicit grants on one object: a role, a team or a person, with View, Edit, Delete and Execute columns. object_type: ${OBJECT_PERMISSION_TYPES.join(', ')}. Forms use View and Submit (can_execute): a grant lists the form in the person's Forms menu when the form is in Available forms; Edit and Delete do not apply to forms (stored false). Every change is in the audit log (grant / revoke on the object).`
const objectPermissionTags = ['Object permissions']

export const objectPermissionGrantBody = z.object({
  object_type: z.enum(OBJECT_PERMISSION_TYPES).describe('Type of the object'),
  object_id: z.string().describe('Object id'),
  role_id: z.string().nullable().optional().describe('Grant to a role (give exactly one of role_id, team_id, user_id)'),
  team_id: z.string().nullable().optional().describe('Grant to a team'),
  user_id: z.string().nullable().optional().describe('Grant to a person'),
  can_view: z.boolean().optional().describe('View (default true)'),
  can_edit: z.boolean().optional().describe('Edit (not used by forms)'),
  can_delete: z.boolean().optional().describe('Delete (not used by forms)'),
  can_execute: z.boolean().optional().describe('Execute; Submit for forms'),
})

export const listObjectPermissionsEndpoint = defineEndpoint({
  method: 'GET', path: '/object-permissions', operationId: 'listObjectPermissions', tags: objectPermissionTags,
  summary: 'List the grants on an object', description: OBJECT_TYPES_NOTE, permission: 'team.change_roles',
  query: z.object({ object_type: z.enum(OBJECT_PERMISSION_TYPES), object_id: z.string() }),
  response: listResponse('permissions'), listKey: 'permissions',
  cli: { resource: 'object-permissions', verb: 'list' },
})

export const setObjectPermissionEndpoint = defineEndpoint({
  method: 'POST', path: '/object-permissions', operationId: 'setObjectPermission', tags: objectPermissionTags,
  summary: 'Add or change one grantee\'s grant on an object', description: OBJECT_TYPES_NOTE, permission: 'team.change_roles',
  body: objectPermissionGrantBody, response: itemResponse('permission'),
  cli: { resource: 'object-permissions', verb: 'set' },
})

export const removeObjectPermissionEndpoint = defineEndpoint({
  method: 'DELETE', path: '/object-permissions/{id}', operationId: 'removeObjectPermission', tags: objectPermissionTags,
  summary: 'Remove a grant', description: OBJECT_TYPES_NOTE, permission: 'team.change_roles',
  params: idParams, response: deletedResponse,
  cli: { resource: 'object-permissions', verb: 'remove', positional: ['id'] },
})

export const governanceEndpoints = [
  listRolesEndpoint, createRoleEndpoint, getRoleEndpoint, updateRoleEndpoint, deleteRoleEndpoint,
  listUsersEndpoint, assignUserRoleEndpoint, removeUserRoleEndpoint,
  getUserManagerEndpoint, setUserManagerEndpoint, listUserReportsEndpoint,
  listTeamsEndpoint, createTeamEndpoint, getTeamEndpoint, updateTeamEndpoint, deleteTeamEndpoint,
  addTeamMemberEndpoint, removeTeamMemberEndpoint,
  listInvitationsEndpoint, sendInvitationEndpoint, revokeInvitationEndpoint, resendInvitationEndpoint,
  listAuditLogEndpoint,
  listObjectPermissionsEndpoint, setObjectPermissionEndpoint, removeObjectPermissionEndpoint,
]
