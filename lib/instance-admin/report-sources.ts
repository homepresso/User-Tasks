import type { ReportColumn, ReportSource } from '@/lib/report-sources'
import { INSTANCE_DATASET_COLUMNS, type InstanceDataset } from './schema'

/**
 * Report sources over the built-in "UserTasks instance" data (virtual: rows
 * built on the server by lib/services/instance-admin/report-rows.ts). They
 * are listed only to instance admins (Reports → data sources) and every
 * read checks the instance admin again; anyone else gets an access message.
 * Client-safe.
 */

export const INSTANCE_REPORT_PREFIX = 'instance_'

const LISTS: Array<{ key: string; dataset: InstanceDataset; label: string; description: string; sort: string; dir: 'asc' | 'desc' }> = [
  { key: 'instance_workspaces', dataset: 'workspaces', label: 'Instance: workspaces', description: 'Every workspace with members, activity, runs, failures, AI spend and storage.', sort: 'created_at', dir: 'desc' },
  { key: 'instance_users', dataset: 'users', label: 'Instance: people', description: 'Everyone across workspaces: status, lockout, last seen.', sort: 'created_at', dir: 'desc' },
  { key: 'instance_invitations', dataset: 'invitations', label: 'Instance: invitations', description: 'Invitations across workspaces (no links or tokens).', sort: 'created_at', dir: 'desc' },
  { key: 'instance_usage', dataset: 'usage', label: 'Instance: usage by workspace (30 days)', description: 'Runs, failures, tasks, AI requests and spend, API keys and storage per workspace.', sort: 'runs', dir: 'desc' },
  { key: 'instance_ai_usage', dataset: 'ai_usage', label: 'Instance: AI usage (90 days)', description: 'AI requests per day, workspace, source and model with tokens and cost.', sort: 'day', dir: 'desc' },
  { key: 'instance_health', dataset: 'health', label: 'Instance: health by workspace (7 days)', description: 'Failed runs, agent errors, queue backlog and dead jobs per workspace.', sort: 'failed_runs_7d', dir: 'desc' },
  { key: 'instance_licences', dataset: 'licences', label: 'Instance: licences and trials', description: 'Workspace licences and trials with their state and days left.', sort: 'ends_at', dir: 'asc' },
  { key: 'instance_audit', dataset: 'audit', label: 'Instance: admin audit trail', description: 'Every on-behalf action of an instance admin.', sort: 'created_at', dir: 'desc' },
]

export const INSTANCE_DAILY_KINDS = {
  instance_signups_daily: { kind: 'signups', label: 'Instance: new workspaces per day', status: 'Plan' },
  instance_people_daily: { kind: 'people', label: 'Instance: new people per day', status: 'Status' },
  instance_runs_daily: { kind: 'runs', label: 'Instance: workflow runs per day', status: 'Status' },
  instance_ai_daily: { kind: 'ai_requests', label: 'Instance: AI requests and spend per day', status: 'Status' },
  instance_agent_runs_daily: { kind: 'agent_runs', label: 'Instance: agent runs per day', status: 'Status' },
} as const
export type InstanceDailySourceKey = keyof typeof INSTANCE_DAILY_KINDS

const columnType = (t: string): ReportColumn['type'] => (t === 'currency' || t === 'bytes' || t === 'number' ? 'number' : t === 'date' ? 'date' : t === 'boolean' ? 'boolean' : 'text')

export const INSTANCE_REPORT_SOURCES: ReportSource[] = [
  ...LISTS.map((l): ReportSource => ({
    key: l.key, table: `__${l.key}__`, label: l.label, category: 'UserTasks instance', description: `${l.description} Instance admins only.`,
    select: '*', virtual: true, defaultSort: { field: l.sort, direction: l.dir },
    columns: INSTANCE_DATASET_COLUMNS[l.dataset].map((c) => ({ key: c.key, label: c.label, type: columnType(c.type) })),
  })),
  ...Object.entries(INSTANCE_DAILY_KINDS).map(([key, d]): ReportSource => ({
    key, table: `__${key}__`, label: d.label, category: 'UserTasks instance', description: 'Per day and workspace, the last 365 days. Instance admins only.',
    select: '*', virtual: true, defaultSort: { field: 'day', direction: 'asc' },
    columns: [
      { key: 'id', label: 'ID', type: 'text' }, { key: 'day', label: 'Day', type: 'date' }, { key: 'week', label: 'Week (starting)', type: 'text' },
      { key: 'month', label: 'Month', type: 'text' }, { key: 'workspace_id', label: 'Workspace ID', type: 'text' }, { key: 'workspace', label: 'Workspace', type: 'text' },
      { key: 'status', label: d.status, type: 'text' }, { key: 'count', label: 'Count', type: 'number' }, { key: 'cost', label: 'Cost (USD)', type: 'number' },
    ],
  })),
]

export const INSTANCE_REPORT_DATASET: Record<string, InstanceDataset> = Object.fromEntries(LISTS.map((l) => [l.key, l.dataset]))

export function isInstanceReportSourceKey(key: unknown): boolean {
  return typeof key === 'string' && INSTANCE_REPORT_SOURCES.some((s) => s.key === key)
}
