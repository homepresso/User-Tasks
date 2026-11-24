import { z } from 'zod'
import { INVITABLE_ROLES } from '@/lib/invitation-roles'
import { defineEndpoint } from './registry'

/**
 * Instance admin ("cloud admin") operations (/api/v1/instance/*): monitor
 * every workspace of the installation and act on a workspace's behalf
 * (lib/services/instance-admin). For INSTANCE ADMINS only — a person whose
 * verified email is on INSTANCE_ADMIN_EMAILS or the instance.admin_emails
 * setting — calling with their own user API key or OAuth token (the CLI).
 * Everyone else, workspace owners included, gets 404. Operational data only:
 * no form submissions, data table rows, task contents, files or workflow
 * definitions. Every action needs a reason and is recorded in the instance
 * admin audit trail and in the target workspace's own audit log as
 * "UserTasks support (on behalf)".
 */

const AUTH_NOTE = 'Instance admins only (a user API key or OAuth token of a person whose verified email is on INSTANCE_ADMIN_EMAILS / instance.admin_emails); everyone else gets 404. Tenant-wide API keys are refused. Operational data only.'
const ACTION_NOTE = `${AUTH_NOTE} Needs a reason; audited in the instance admin trail and in the workspace's own audit log as "UserTasks support (on behalf)". 503 until migration 20270129090000_instance_admin.sql is applied. Rate-limited (30 actions a minute). Send idempotency_key to make a retry return the first result.`

const tags = ['Instance admin (cloud)']

const listQuery = z.object({
  q: z.string().max(200).optional().describe('Search (names, emails, slugs)'),
  workspace_id: z.string().uuid().optional().describe('Only this workspace'),
  user_id: z.string().uuid().optional().describe('Only this person'),
  status: z.string().max(40).optional().describe('Status filter (dataset-specific, e.g. Locked, pending, Failing, expiring)'),
  plan: z.string().max(40).optional().describe('Workspace plan'),
  days: z.coerce.number().int().min(1).max(365).optional().describe('Look-back window in days (usage, AI usage, sign-ins, audit)'),
  sort: z.string().max(60).optional().describe('Column key to sort by'),
  dir: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
  limit: z.coerce.number().int().min(1).max(200).optional().describe('Page size (1-200, default 25)'),
  offset: z.coerce.number().int().min(0).optional().describe('Rows to skip'),
})

const page = z.looseObject({
  dataset: z.string(),
  rows: z.array(z.looseObject({})),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  truncated: z.boolean().optional(),
  note: z.string().optional(),
})

const record = (key: string) => z.looseObject({ [key]: z.looseObject({}) })

const idParam = z.object({ id: z.string().uuid().describe('Id') })

const list = (path: string, operationId: string, summary: string, verb: string, query: z.ZodType = listQuery) => defineEndpoint({
  method: 'GET', path, operationId, tags, summary: `${summary} (instance admin)`, description: AUTH_NOTE,
  permission: null, query, response: page, listKey: 'rows',
  cli: { resource: 'instance', verb },
})

export const listInstanceAlertsEndpoint = list('/instance/alerts', 'listInstanceAlerts', 'Alerts: locked accounts, trials ending, lapsed licences, failing workspaces, AI spend spikes', 'alerts')
export const listInstanceWorkspacesEndpoint = list('/instance/workspaces', 'listInstanceWorkspaces', 'Workspaces with members, activity, runs, failures, AI spend and storage', 'workspaces')
export const listInstanceUsersEndpoint = list('/instance/users', 'listInstanceUsers', 'People across workspaces (search by email or name; status=Locked)', 'users')
export const listInstanceMembershipsEndpoint = list('/instance/memberships', 'listInstanceMemberships', 'Memberships of a workspace or a person, with roles', 'memberships')
export const listInstanceInvitationsEndpoint = list('/instance/invitations', 'listInstanceInvitations', 'Invitations across workspaces (status=pending|expired|accepted; tokens never returned)', 'invitations')
export const listInstanceUsageEndpoint = list('/instance/usage', 'listInstanceUsage', 'Usage per workspace: runs, failures, tasks, AI requests and spend, API keys, storage', 'usage')
export const listInstanceAiUsageEndpoint = list('/instance/ai-usage', 'listInstanceAiUsage', 'AI usage per day, workspace, source and model, with tokens and cost', 'ai-usage')
export const listInstanceAssetsEndpoint = list('/instance/assets', 'listInstanceAssets', 'Asset counts (forms, workflows, apps, tables, reports, agents, …) of a workspace or the instance', 'assets')
export const listInstanceHealthEndpoint = list('/instance/health', 'listInstanceHealth', 'Health per workspace: failed runs, agent errors, queue backlog, dead jobs, licence-paused runs', 'health')
export const listInstanceQueueEndpoint = list('/instance/queue', 'listInstanceQueue', 'Queue health of the instance (workflow, agent, background jobs, deletion)', 'queue', z.object({}))
export const listInstanceSignInsEndpoint = list('/instance/sign-ins', 'listInstanceSignIns', 'Recent sign-in activity (last seen)', 'sign-ins')
export const listInstanceLicencesEndpoint = list('/instance/licences', 'listInstanceLicences', 'Licences and trials of workspaces (status=expiring|expired|trial|…)', 'licences')
export const listInstanceAuditEndpoint = list('/instance/audit', 'listInstanceAudit', 'The instance admin audit trail (every on-behalf action)', 'audit')

export const getInstanceOverviewEndpoint = defineEndpoint({
  method: 'GET', path: '/instance/overview', operationId: 'getInstanceOverview', tags,
  summary: 'Instance KPIs: workspaces, active people, signups, trials ending, failed runs, AI spend, storage, queue (instance admin)',
  description: AUTH_NOTE, permission: null, response: record('overview'),
  cli: { resource: 'instance', verb: 'overview' },
})

export const getInstanceWorkspaceEndpoint = defineEndpoint({
  method: 'GET', path: '/instance/workspaces/{id}', operationId: 'getInstanceWorkspace', tags,
  summary: 'One workspace: owners, members, usage, health, licences (instance admin)', description: AUTH_NOTE,
  permission: null, params: idParam, response: record('workspace'),
  cli: { resource: 'instance', verb: 'workspace', positional: ['id'] },
})

export const listInstanceWorkspaceAuditEndpoint = defineEndpoint({
  method: 'GET', path: '/instance/workspaces/{id}/audit', operationId: 'listInstanceWorkspaceAudit', tags,
  summary: 'A workspace\'s audit log: when, object type, action, actor — no summaries or changes (instance admin)', description: AUTH_NOTE,
  permission: null, params: idParam, query: listQuery.pick({ days: true, status: true, limit: true, offset: true }), response: page, listKey: 'rows',
  cli: { resource: 'instance', verb: 'workspace-audit', positional: ['id'] },
})

export const getInstanceUserEndpoint = defineEndpoint({
  method: 'GET', path: '/instance/users/{id}', operationId: 'getInstanceUser', tags,
  summary: 'One person: sign-in state, lockout, MFA and sign-in methods, workspaces (instance admin)', description: AUTH_NOTE,
  permission: null, params: idParam, response: record('user'),
  cli: { resource: 'instance', verb: 'user', positional: ['id'] },
})

/* ── Actions ──────────────────────────────────────────────────────────── */

const reason = z.string().min(3).max(1000).describe('Why (recorded in both audit logs)')
const idempotency = z.string().min(8).max(200).optional().describe('Retry key: a repeat returns the first result')
const role = z.enum(INVITABLE_ROLES)
const actionResult = z.looseObject({
  result: z.looseObject({
    action: z.string(), outcome: z.enum(['ok', 'noop']), message: z.string(),
    workspace_id: z.string().nullable(), user_id: z.string().nullable(), detail: z.looseObject({}), audit_id: z.number().nullable(),
    replayed: z.boolean().optional(),
  }),
})

const reasonBody = z.object({ reason, idempotency_key: idempotency })

const action = (method: 'POST', path: string, operationId: string, summary: string, verb: string, params: z.ZodObject, body: z.ZodObject, positional: string[]) => defineEndpoint({
  method, path, operationId, tags, summary: `${summary} (instance admin, on behalf)`, description: ACTION_NOTE,
  permission: null, params, body, response: actionResult,
  cli: { resource: 'instance', verb, positional },
})

const memberParams = z.object({ id: z.string().uuid().describe('Workspace id'), user_id: z.string().uuid().describe('Person id') })
const licenceParams = z.object({ id: z.string().uuid().describe('Workspace id'), extension_id: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/).describe('Extension id') })

export const unlockInstanceUserEndpoint = action('POST', '/instance/users/{id}/unlock', 'unlockInstanceUser', 'Unlock an account (clear a failed sign-in lockout / suspension)', 'unlock', idParam, reasonBody, ['id'])
export const sendInstancePasswordResetEndpoint = action('POST', '/instance/users/{id}/password-reset', 'sendInstancePasswordReset', 'Send the normal password reset email', 'password-reset', idParam, reasonBody, ['id'])
export const signOutInstanceUserEndpoint = action('POST', '/instance/users/{id}/sign-out', 'signOutInstanceUser', 'Sign a person out everywhere', 'sign-out', idParam, reasonBody, ['id'])
export const inviteInstanceUserEndpoint = defineEndpoint({
  method: 'POST', path: '/instance/invitations', operationId: 'inviteInstanceUser', tags,
  summary: 'Invite a person to a workspace with a role (instance admin, on behalf)', description: ACTION_NOTE,
  permission: null, body: z.object({ workspace_id: z.string().uuid().describe('Workspace id'), email: z.string().email().max(320), role: role.optional().describe('Default member'), reason, idempotency_key: idempotency }),
  response: actionResult, successStatus: 201,
  cli: { resource: 'instance', verb: 'invite' },
})
export const resendInstanceInvitationEndpoint = action('POST', '/instance/invitations/{id}/resend', 'resendInstanceInvitation', 'Resend an invitation (new link, 7 more days)', 'resend-invitation', idParam, reasonBody, ['id'])
export const revokeInstanceInvitationEndpoint = action('POST', '/instance/invitations/{id}/revoke', 'revokeInstanceInvitation', 'Revoke a pending invitation', 'revoke-invitation', idParam, reasonBody, ['id'])
export const changeInstanceMemberRoleEndpoint = action('POST', '/instance/workspaces/{id}/members/{user_id}/role', 'changeInstanceMemberRole', 'Change a member\'s role (the last owner is guarded)', 'change-role', memberParams, z.object({ role, reason, idempotency_key: idempotency }), ['id', 'user_id'])
export const deactivateInstanceMemberEndpoint = action('POST', '/instance/workspaces/{id}/members/{user_id}/deactivate', 'deactivateInstanceMember', 'Deactivate a member (the last owner is guarded)', 'deactivate', memberParams, reasonBody, ['id', 'user_id'])
export const reactivateInstanceMemberEndpoint = action('POST', '/instance/workspaces/{id}/members/{user_id}/reactivate', 'reactivateInstanceMember', 'Reactivate a deactivated member', 'reactivate', memberParams, z.object({ role: role.optional().describe('Role when they have none (default member)'), reason, idempotency_key: idempotency }), ['id', 'user_id'])
export const extendInstanceTrialEndpoint = action('POST', '/instance/workspaces/{id}/licences/{extension_id}/extend', 'extendInstanceTrial', 'Extend a trial or licence of a workspace', 'extend-trial', licenceParams,
  z.object({ days: z.coerce.number().int().min(1).max(365).optional().describe('Days to add (from the current end, or today)'), ends_at: z.string().datetime({ offset: true }).optional().describe('Or the new end'), reason, idempotency_key: idempotency }), ['id', 'extension_id'])
export const reactivateInstanceLicenceEndpoint = action('POST', '/instance/workspaces/{id}/licences/{extension_id}/reactivate', 'reactivateInstanceLicence', 'Reactivate a suspended licence of a workspace', 'reactivate-licence', licenceParams, reasonBody, ['id', 'extension_id'])
export const resumeInstancePausedRunsEndpoint = action('POST', '/instance/workspaces/{id}/resume-paused-runs', 'resumeInstancePausedRuns', 'Resume workflow runs paused by a lapsed licence', 'resume-paused-runs', idParam,
  z.object({ extension_id: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/).optional(), reason, idempotency_key: idempotency }), ['id'])

export const instanceEndpoints = [
  getInstanceOverviewEndpoint,
  listInstanceAlertsEndpoint,
  listInstanceWorkspacesEndpoint,
  getInstanceWorkspaceEndpoint,
  listInstanceWorkspaceAuditEndpoint,
  listInstanceUsersEndpoint,
  getInstanceUserEndpoint,
  listInstanceMembershipsEndpoint,
  listInstanceInvitationsEndpoint,
  listInstanceUsageEndpoint,
  listInstanceAiUsageEndpoint,
  listInstanceAssetsEndpoint,
  listInstanceHealthEndpoint,
  listInstanceQueueEndpoint,
  listInstanceSignInsEndpoint,
  listInstanceLicencesEndpoint,
  listInstanceAuditEndpoint,
  unlockInstanceUserEndpoint,
  sendInstancePasswordResetEndpoint,
  signOutInstanceUserEndpoint,
  inviteInstanceUserEndpoint,
  resendInstanceInvitationEndpoint,
  revokeInstanceInvitationEndpoint,
  changeInstanceMemberRoleEndpoint,
  deactivateInstanceMemberEndpoint,
  reactivateInstanceMemberEndpoint,
  extendInstanceTrialEndpoint,
  reactivateInstanceLicenceEndpoint,
  resumeInstancePausedRunsEndpoint,
]
