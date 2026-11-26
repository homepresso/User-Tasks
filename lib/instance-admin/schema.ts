import { z } from 'zod'
import { isoDateTime } from '@/lib/zod-datetime'
import { INVITABLE_ROLES } from '@/lib/invitation-roles'

/**
 * Instance admin ("cloud admin") vocabulary, shared by the REST API, the app
 * builder's built-in "UserTasks instance" source, the app rule action, the
 * workflow step and the CLI. Client-safe: no server imports.
 *
 * Operational data only. Every dataset lists its columns here and the
 * services select exactly these (explicit column lists), so workspace
 * content — form submissions, data table rows, task contents and comments,
 * files, workflow definitions — can never reach a response. Names and titles
 * of objects and counts are operational and allowed.
 */

/** How an on-behalf action appears in the target workspace's own audit log. */
export const SUPPORT_ACTOR_LABEL = 'UserTasks support (on behalf)'
/** `object_audit_log.metadata.via` of an on-behalf action. */
export const SUPPORT_AUDIT_VIA = 'instance_support'

/* ── Datasets (lists and records) ─────────────────────────────────────── */

export const INSTANCE_DATASETS = [
  'overview',
  'alerts',
  'workspaces',
  'workspace',
  'users',
  'user',
  'memberships',
  'invitations',
  'usage',
  'ai_usage',
  'assets',
  'health',
  'queue',
  'signins',
  'licences',
  'audit',
  'workspace_audit',
] as const
export type InstanceDataset = (typeof INSTANCE_DATASETS)[number]

export interface InstanceColumn {
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'boolean' | 'currency' | 'bytes'
}

const c = (key: string, label: string, type: InstanceColumn['type'] = 'text'): InstanceColumn => ({ key, label, type })

/** Columns of every dataset: the whole response shape (nothing else is ever returned). */
export const INSTANCE_DATASET_COLUMNS: Record<InstanceDataset, readonly InstanceColumn[]> = {
  overview: [
    c('workspaces', 'Workspaces', 'number'), c('new_workspaces_30d', 'New workspaces (30 days)', 'number'),
    c('people', 'People', 'number'), c('active_7d', 'Active (7 days)', 'number'), c('active_30d', 'Active (30 days)', 'number'),
    c('signups_7d', 'New people (7 days)', 'number'), c('pending_invitations', 'Pending invitations', 'number'),
    c('locked_accounts', 'Locked accounts', 'number'), c('trials_ending_14d', 'Trials ending (14 days)', 'number'),
    c('runs_7d', 'Runs (7 days)', 'number'), c('failed_runs_7d', 'Failed runs (7 days)', 'number'),
    c('failure_rate_7d', 'Failure rate (7 days, %)', 'number'), c('ai_cost_30d', 'AI spend (30 days)', 'currency'),
    c('ai_requests_30d', 'AI requests (30 days)', 'number'), c('storage_bytes', 'Storage', 'bytes'),
    c('queue_due', 'Queue: due', 'number'), c('queue_dead_24h', 'Queue: dead (24 h)', 'number'), c('generated_at', 'As of', 'date'),
    c('summary', 'Summary'), c('locked_summary', 'Locked accounts (text)'),
  ],
  alerts: [
    c('id', 'ID'), c('severity', 'Severity'), c('kind', 'Kind'), c('title', 'Alert'), c('detail', 'Detail'),
    c('workspace_id', 'Workspace ID'), c('workspace', 'Workspace'), c('user_id', 'Person ID'), c('at', 'When', 'date'),
  ],
  workspaces: [
    c('id', 'ID'), c('name', 'Workspace'), c('slug', 'Slug'), c('plan', 'Plan'), c('status', 'Status'), c('industry', 'Industry'),
    c('company_size', 'Company size'), c('created_at', 'Created', 'date'), c('members', 'Members', 'number'),
    c('active_7d', 'Active (7 days)', 'number'), c('pending_invitations', 'Pending invitations', 'number'),
    c('runs_30d', 'Runs (30 days)', 'number'), c('failed_runs_7d', 'Failed runs (7 days)', 'number'),
    c('ai_cost_30d', 'AI spend (30 days)', 'currency'), c('storage_bytes', 'Storage', 'bytes'),
    c('trial_ends_at', 'Trial ends', 'date'), c('last_activity_at', 'Last activity', 'date'),
  ],
  workspace: [
    c('id', 'ID'), c('name', 'Workspace'), c('slug', 'Slug'), c('subdomain', 'Subdomain'), c('custom_domain', 'Custom domain'),
    c('plan', 'Plan'), c('status', 'Status'), c('industry', 'Industry'), c('company_size', 'Company size'),
    c('onboarding_completed', 'Onboarding completed', 'boolean'), c('created_at', 'Created', 'date'),
    c('owners', 'Owners'), c('members', 'Members', 'number'), c('active_members', 'Active members', 'number'),
    c('active_7d', 'Active (7 days)', 'number'), c('active_30d', 'Active (30 days)', 'number'),
    c('pending_invitations', 'Pending invitations', 'number'), c('runs_30d', 'Runs (30 days)', 'number'),
    c('failed_runs_7d', 'Failed runs (7 days)', 'number'), c('open_tasks', 'Open tasks', 'number'),
    c('ai_requests_30d', 'AI requests (30 days)', 'number'), c('ai_cost_30d', 'AI spend (30 days)', 'currency'),
    c('storage_bytes', 'Storage', 'bytes'), c('queue_pending', 'Queue: pending', 'number'), c('queue_dead', 'Queue: dead (7 days)', 'number'),
    c('licences', 'Licences', 'number'), c('trial_ends_at', 'Trial ends', 'date'), c('sso_only', 'SSO only', 'boolean'),
    c('last_activity_at', 'Last activity', 'date'), c('summary', 'Summary'),
  ],
  users: [
    c('id', 'ID'), c('email', 'Email'), c('display_name', 'Name'), c('home_workspace', 'Home workspace'),
    c('workspaces', 'Workspaces', 'number'), c('status', 'Status'), c('locked', 'Locked', 'boolean'),
    c('last_seen_at', 'Last seen', 'date'), c('created_at', 'Joined', 'date'),
  ],
  user: [
    c('id', 'ID'), c('email', 'Email'), c('display_name', 'Name'), c('timezone', 'Time zone'), c('home_workspace_id', 'Home workspace ID'),
    c('home_workspace', 'Home workspace'), c('workspaces', 'Workspaces', 'number'), c('status', 'Status'),
    c('locked', 'Locked', 'boolean'), c('locked_until', 'Locked until', 'date'), c('failed_attempts', 'Failed sign-ins', 'number'),
    c('banned_until', 'Suspended until', 'date'), c('email_confirmed', 'Email confirmed', 'boolean'),
    c('mfa', 'MFA'), c('sign_in_methods', 'Sign-in methods'), c('open_sessions', 'Open sessions', 'number'),
    c('last_sign_in_at', 'Last sign-in', 'date'), c('last_seen_at', 'Last seen', 'date'), c('created_at', 'Joined', 'date'),
    c('auth_provider', 'Auth provider'),
  ],
  memberships: [
    c('id', 'ID'), c('workspace_id', 'Workspace ID'), c('workspace', 'Workspace'), c('workspace_slug', 'Workspace slug'),
    c('user_id', 'Person ID'), c('email', 'Email'), c('display_name', 'Name'), c('role', 'Role'), c('roles', 'Roles'),
    c('active', 'Active', 'boolean'), c('is_home', 'Home workspace', 'boolean'), c('joined_at', 'Joined', 'date'),
    c('last_seen_at', 'Last seen', 'date'),
  ],
  invitations: [
    c('id', 'ID'), c('workspace_id', 'Workspace ID'), c('workspace', 'Workspace'), c('email', 'Email'), c('role', 'Role'),
    c('status', 'Status'), c('invited_by', 'Invited by'), c('created_at', 'Sent', 'date'), c('expires_at', 'Expires', 'date'),
    c('accepted_at', 'Accepted', 'date'),
  ],
  usage: [
    c('workspace_id', 'Workspace ID'), c('workspace', 'Workspace'), c('runs', 'Runs', 'number'), c('failed_runs', 'Failed runs', 'number'),
    c('failure_rate', 'Failure rate (%)', 'number'), c('tasks', 'Tasks created', 'number'), c('ai_requests', 'AI requests', 'number'),
    c('ai_cost', 'AI spend', 'currency'), c('api_keys', 'Active API keys', 'number'), c('api_last_used_at', 'API last used', 'date'),
    c('storage_bytes', 'Storage', 'bytes'), c('days', 'Days', 'number'),
  ],
  ai_usage: [
    c('id', 'ID'), c('day', 'Day'), c('workspace_id', 'Workspace ID'), c('workspace', 'Workspace'), c('source', 'Source'),
    c('provider', 'Provider'), c('model', 'Model'), c('requests', 'Requests', 'number'), c('failed', 'Failed', 'number'),
    c('input_tokens', 'Input tokens', 'number'), c('output_tokens', 'Output tokens', 'number'), c('total_tokens', 'Total tokens', 'number'),
    c('cost', 'Cost', 'currency'), c('cost_currency', 'Currency'),
  ],
  assets: [
    c('workspace_id', 'Workspace ID'), c('kind', 'Kind'), c('label', 'Asset'), c('count', 'Count', 'number'), c('active', 'Active', 'number'),
  ],
  health: [
    c('workspace_id', 'Workspace ID'), c('workspace', 'Workspace'), c('runs_7d', 'Runs (7 days)', 'number'),
    c('failed_runs_7d', 'Failed runs (7 days)', 'number'), c('failure_rate_7d', 'Failure rate (%)', 'number'),
    c('agent_errors_7d', 'Agent errors (7 days)', 'number'), c('queue_pending', 'Queue: pending', 'number'),
    c('queue_dead_7d', 'Queue: dead (7 days)', 'number'), c('paused_runs', 'Licence-paused runs', 'number'),
    c('dead_letters_7d', 'Failed webhooks (7 days)', 'number'), c('last_failure_at', 'Last failure', 'date'), c('status', 'Health'),
  ],
  queue: [
    c('queue', 'Queue'), c('due', 'Due', 'number'), c('scheduled', 'Scheduled', 'number'), c('processing', 'Processing', 'number'),
    c('stuck', 'Stuck', 'number'), c('retrying', 'Retrying', 'number'), c('dead_24h', 'Dead (24 h)', 'number'),
    c('oldest_due_seconds', 'Oldest due (s)', 'number'),
  ],
  signins: [
    c('user_id', 'Person ID'), c('email', 'Email'), c('display_name', 'Name'), c('home_workspace', 'Home workspace'),
    c('last_seen_at', 'Last seen', 'date'), c('created_at', 'Joined', 'date'),
  ],
  licences: [
    c('id', 'ID'), c('workspace_id', 'Workspace ID'), c('workspace', 'Workspace'), c('extension_id', 'Extension'), c('edition', 'Edition'),
    c('status', 'Status'), c('source', 'Source'), c('starts_at', 'Starts', 'date'), c('ends_at', 'Ends', 'date'),
    c('days_left', 'Days left', 'number'), c('state', 'State'), c('updated_at', 'Updated', 'date'),
  ],
  audit: [
    c('id', 'ID'), c('created_at', 'When', 'date'), c('admin_email', 'Instance admin'), c('action', 'Action'), c('action_label', 'Action label'),
    c('workspace_id', 'Workspace ID'), c('workspace', 'Workspace'), c('target_user_id', 'Person ID'), c('target_label', 'Target'),
    c('reason', 'Reason'), c('outcome', 'Outcome'), c('via', 'Via'),
  ],
  workspace_audit: [
    c('id', 'ID'), c('created_at', 'When', 'date'), c('workspace_id', 'Workspace ID'), c('object_type', 'Object type'),
    c('action', 'Action'), c('actor', 'Actor'), c('on_behalf', 'On behalf', 'boolean'),
  ],
}

/** A workspace in one line, for headers: "conca · 1 member · owners: ada@example.com". */
export function workspaceSummary(w: { slug?: unknown; members?: unknown; owners?: unknown }): string {
  const n = typeof w.members === 'number' && Number.isFinite(w.members) ? w.members : null
  const owners = typeof w.owners === 'string' && w.owners.trim() ? w.owners.trim() : '—'
  return [typeof w.slug === 'string' && w.slug ? w.slug : null, n === null ? null : `${n} member${n === 1 ? '' : 's'}`, `owners: ${owners}`].filter(Boolean).join(' · ')
}

/** Datasets that answer one record (not a list). */
export const INSTANCE_RECORD_DATASETS: ReadonlySet<InstanceDataset> = new Set(['overview', 'workspace', 'user'])

/** Parameters a dataset accepts (from the API query, an app widget's params or a rule's inputs). */
export const instanceDatasetParamsSchema = z.object({
  q: z.string().trim().max(200).optional(),
  workspace_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  status: z.string().trim().max(40).optional(),
  plan: z.string().trim().max(40).optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
  sort: z.string().trim().max(60).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
}).strict()
export type InstanceDatasetParams = z.infer<typeof instanceDatasetParamsSchema>

/* ── Facts (metrics, KPIs, charts, pivots and heat maps) ──────────────── */

export const INSTANCE_FACT_DATASETS = [
  'signups', 'people', 'active_people', 'runs', 'tasks', 'ai_requests', 'agent_errors', 'invitations', 'storage', 'admin_actions',
] as const
export type InstanceFactDataset = (typeof INSTANCE_FACT_DATASETS)[number]

/** Fields of each fact dataset's rows (`data`), for "group by field" and sum / average. */
export const INSTANCE_FACT_FIELDS: Record<InstanceFactDataset, readonly string[]> = {
  signups: ['workspace', 'plan'],
  people: ['workspace'],
  active_people: ['workspace'],
  runs: ['workspace', 'status'],
  tasks: ['workspace', 'status'],
  ai_requests: ['workspace', 'status', 'cost'],
  agent_errors: ['workspace'],
  invitations: ['workspace', 'role', 'status'],
  storage: ['workspace', 'bytes', 'mb'],
  admin_actions: ['action', 'admin', 'workspace', 'outcome'],
}

export const INSTANCE_FACT_LABELS: Record<InstanceFactDataset, string> = {
  signups: 'New workspaces',
  people: 'New people',
  active_people: 'Active people (last seen)',
  runs: 'Workflow runs',
  tasks: 'Tasks created',
  ai_requests: 'AI requests',
  agent_errors: 'Agent errors',
  invitations: 'Invitations',
  storage: 'Storage by workspace',
  admin_actions: 'Instance admin actions',
}

/* ── Actions ──────────────────────────────────────────────────────────── */

export const INSTANCE_ACTIONS = [
  'unlock_user',
  'send_password_reset',
  'force_sign_out',
  'invite_user',
  'resend_invitation',
  'revoke_invitation',
  'change_role',
  'deactivate_member',
  'reactivate_member',
  'extend_trial',
  'reactivate_licence',
  'resume_paused_runs',
] as const
export type InstanceAction = (typeof INSTANCE_ACTIONS)[number]

export const INSTANCE_ACTION_LABELS: Record<InstanceAction, string> = {
  unlock_user: 'Unlock account',
  send_password_reset: 'Send password reset email',
  force_sign_out: 'Sign out everywhere',
  invite_user: 'Invite a person',
  resend_invitation: 'Resend invitation',
  revoke_invitation: 'Revoke invitation',
  change_role: 'Change role',
  deactivate_member: 'Deactivate member',
  reactivate_member: 'Reactivate member',
  extend_trial: 'Extend trial / licence',
  reactivate_licence: 'Reactivate licence',
  resume_paused_runs: 'Resume licence-paused runs',
}

const reason = z.string().trim().min(3, 'Give a reason (at least 3 characters)').max(1000)
const uuid = z.string().uuid()
const role = z.enum(INVITABLE_ROLES)
const extension = z.string().trim().regex(/^[a-z][a-z0-9-]{0,62}$/, 'An extension id (lowercase letters, digits and -)')

/** Every action needs a reason; `idempotency_key` makes a retry return the first result. */
const base = { reason, idempotency_key: z.string().trim().min(8).max(200).optional() }

export const INSTANCE_ACTION_INPUTS = {
  unlock_user: z.object({ ...base, user_id: uuid }).strict(),
  send_password_reset: z.object({ ...base, user_id: uuid }).strict(),
  force_sign_out: z.object({ ...base, user_id: uuid }).strict(),
  invite_user: z.object({ ...base, workspace_id: uuid, email: z.string().trim().toLowerCase().email().max(320), role: role.default('member') }).strict(),
  resend_invitation: z.object({ ...base, invitation_id: uuid }).strict(),
  revoke_invitation: z.object({ ...base, invitation_id: uuid }).strict(),
  change_role: z.object({ ...base, workspace_id: uuid, user_id: uuid, role }).strict(),
  deactivate_member: z.object({ ...base, workspace_id: uuid, user_id: uuid }).strict(),
  reactivate_member: z.object({ ...base, workspace_id: uuid, user_id: uuid, role: role.optional() }).strict(),
  extend_trial: z.object({ ...base, workspace_id: uuid, extension_id: extension, days: z.coerce.number().int().min(1).max(365).optional(), ends_at: isoDateTime({ offset: true }).optional() }).strict()
    .refine((v) => v.days !== undefined || v.ends_at !== undefined, 'Give days or ends_at'),
  reactivate_licence: z.object({ ...base, workspace_id: uuid, extension_id: extension }).strict(),
  resume_paused_runs: z.object({ ...base, workspace_id: uuid, extension_id: extension.optional() }).strict(),
} satisfies Record<InstanceAction, z.ZodType>

export type InstanceActionInput<A extends InstanceAction> = z.output<(typeof INSTANCE_ACTION_INPUTS)[A]>

/** Result of every action. */
export interface InstanceActionResult {
  action: InstanceAction
  /** ok: changed; noop: already in that state (idempotent); replayed: an idempotency key's first result. */
  outcome: 'ok' | 'noop'
  message: string
  workspace_id: string | null
  user_id: string | null
  /** Small, operational facts (new role, new end date, counts). */
  detail: Record<string, string | number | boolean | null>
  audit_id: number | null
  replayed?: boolean
}

export function isInstanceAction(value: unknown): value is InstanceAction {
  return typeof value === 'string' && (INSTANCE_ACTIONS as readonly string[]).includes(value)
}
export function isInstanceDataset(value: unknown): value is InstanceDataset {
  return typeof value === 'string' && (INSTANCE_DATASETS as readonly string[]).includes(value)
}
export function isInstanceFactDataset(value: unknown): value is InstanceFactDataset {
  return typeof value === 'string' && (INSTANCE_FACT_DATASETS as readonly string[]).includes(value)
}

/** Keep only a dataset's declared columns (the response-shape guarantee; tests assert it). */
export function projectRow(dataset: InstanceDataset, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const col of INSTANCE_DATASET_COLUMNS[dataset]) out[col.key] = row[col.key] ?? null
  return out
}
