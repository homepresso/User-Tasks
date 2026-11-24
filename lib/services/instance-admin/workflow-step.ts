import {
  INSTANCE_RECORD_DATASETS, isInstanceAction, isInstanceDataset, type InstanceActionResult,
} from '@/lib/instance-admin/schema'
import { ServiceError, type ServiceContext } from '../context'
import { instanceDb, isInstanceAdminUser, type InstanceAdmin } from './access'
import { runInstanceAction } from './actions'
import { readDataset, type InstancePage } from './reads'
import { instanceDatasetParamsSchema } from '@/lib/instance-admin/schema'
import { rateLimit } from '@/lib/rate-limit'

/**
 * The "UserTasks instance" workflow step (node type `instance_admin`): read
 * a dataset or run an on-behalf action from a workflow — e.g. the cloud
 * admin app's forms run their actions through workflows, and a scheduled
 * digest reads the overview.
 *
 * Who the step acts as is taken from the RUN ROW (workflow_runs.started_by /
 * started_via, written by the engine), never from run variables:
 *
 *  - Actions: only for a run a PERSON started (form submission, app button,
 *    Run now, API) who is an instance admin right now. Runs started by a
 *    schedule, a webhook, an event, an anonymous form or a test are refused,
 *    so no one can make a workflow act with an admin's identity.
 *  - Reads: the same, and also for runs started by the system (schedule,
 *    agent_error / workflow_error events) when BOTH the workflow's owner and
 *    the person who published the running version are instance admins — so
 *    a workspace member who can edit workflows can't repoint a digest.
 *    Webhook and anonymous starts are always refused.
 *
 * Every refusal names the reason; the step fails (the workflow's error
 * handling decides what happens next).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

const SYSTEM_READ_VIA = new Set(['schedule', 'event', 'system'])
// Not 'agent' (the in-app Agent must not act across workspaces), 'anonymous', 'webhook' or 'test'.
const PERSON_VIA = new Set(['ui', 'api', 'cli', 'mcp', 'form', 'task', 'data_table', 'subworkflow'])

export interface InstanceStepInput {
  tenantId: string
  runId: string | null | undefined
  workflowId: string | null | undefined
  isTest: boolean
  config: { mode?: string; dataset?: string; action?: string; params?: Record<string, unknown>; inputs?: Record<string, unknown> }
  /** Resolves a config template ({{var}}) against the run. */
  resolve: (value: unknown) => unknown
}

export type InstanceStepResult =
  | { mode: 'read'; dataset: string; rows: Array<Record<string, unknown>>; record: Record<string, unknown> | null; total: number }
  | { mode: 'action'; result: InstanceActionResult }

async function whoRuns(input: InstanceStepInput): Promise<{ admin: InstanceAdmin | null; systemRead: boolean; reason: string }> {
  if (input.isTest) return { admin: null, systemRead: false, reason: 'Test runs can’t use UserTasks instance steps: run the published workflow' }
  if (!input.runId) return { admin: null, systemRead: false, reason: 'This step needs a saved run' }
  const db = instanceDb() as any
  const { data: run } = await db.from('workflow_runs').select('id, tenant_id, workflow_id, started_by, started_via, version_id').eq('id', input.runId).maybeSingle()
  if (!run || run.tenant_id !== input.tenantId) return { admin: null, systemRead: false, reason: 'The run was not found' }
  const via = String(run.started_via ?? '')
  if (run.started_by && PERSON_VIA.has(via)) {
    const who = await isInstanceAdminUser(run.started_by)
    if (who.ok && who.email) return { admin: { userId: run.started_by, email: who.email, via: 'workflow' }, systemRead: false, reason: '' }
    return { admin: null, systemRead: false, reason: 'Only UserTasks instance admins can run this step: the person who started this run is not one' }
  }
  if (!run.started_by && SYSTEM_READ_VIA.has(via)) {
    const [{ data: wf }, { data: version }] = await Promise.all([
      db.from('workflows').select('created_by').eq('id', run.workflow_id).eq('tenant_id', input.tenantId).maybeSingle(),
      run.version_id ? db.from('workflow_versions').select('published_by').eq('id', run.version_id).eq('tenant_id', input.tenantId).maybeSingle() : Promise.resolve({ data: null }),
    ])
    const owner = wf?.created_by ? await isInstanceAdminUser(wf.created_by) : { ok: false, email: null }
    const publisher = version?.published_by ? await isInstanceAdminUser(version.published_by) : { ok: false, email: null }
    if (owner.ok && publisher.ok && owner.email) {
      return { admin: { userId: wf.created_by, email: owner.email, via: 'workflow' }, systemRead: true, reason: '' }
    }
    return { admin: null, systemRead: false, reason: 'A scheduled or event-started run reads UserTasks instance data only when the workflow’s owner and the person who published it are both instance admins' }
  }
  return { admin: null, systemRead: false, reason: `Runs started by ${via || 'this trigger'} can’t use UserTasks instance steps` }
}

const text = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).trim()

function resolvedMap(map: Record<string, unknown> | undefined, resolve: (v: unknown) => unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(map ?? {})) {
    if (!/^[a-z_]{1,40}$/.test(k)) continue
    const value = text(resolve(v)).slice(0, 1000)
    if (value) out[k] = value
  }
  return out
}

export async function runInstanceStep(input: InstanceStepInput): Promise<InstanceStepResult> {
  const mode = input.config.mode === 'action' ? 'action' : 'read'
  const who = await whoRuns(input)
  if (!who.admin) throw ServiceError.forbidden(who.reason)
  const admin = who.admin
  if (mode === 'action') {
    if (who.systemRead) throw ServiceError.forbidden('Scheduled and event-started runs can only read UserTasks instance data: actions need a person who is an instance admin to start the run')
    const action = input.config.action
    if (!isInstanceAction(action)) throw ServiceError.validation('Choose an instance action')
    // A context for the audit trail only: the admin was checked above.
    const ctx: ServiceContext = { supabase: instanceDb(), tenantId: input.tenantId, actorId: admin.userId, permissions: null, authKind: 'job', source: 'job' }
    const limited = await rateLimit(`instance-admin:action:${admin.userId}`, { max: 30, windowMs: 60_000 })
    if (!limited.ok) throw new ServiceError('rate_limited', 'Too many instance admin actions: try again in a minute')
    const result = await runInstanceAction(ctx, action, resolvedMap(input.config.inputs, input.resolve), { via: 'workflow', admin })
    return { mode: 'action', result }
  }
  const dataset = input.config.dataset
  if (!isInstanceDataset(dataset)) throw ServiceError.validation('Choose an instance dataset')
  const limited = await rateLimit(`instance-admin:read:${admin.userId}`, { max: 300, windowMs: 60_000 })
  if (!limited.ok) throw new ServiceError('rate_limited', 'Too many instance admin reads: try again in a minute')
  const parsed = instanceDatasetParamsSchema.safeParse(resolvedMap(input.config.params, input.resolve))
  if (!parsed.success) throw ServiceError.validation(`Instance step parameters: ${parsed.error.issues[0]?.message ?? 'check them'}`)
  const page: InstancePage = await readDataset(dataset, parsed.data)
  return {
    mode: 'read', dataset, rows: page.rows, total: page.total,
    record: INSTANCE_RECORD_DATASETS.has(dataset) ? page.rows[0] ?? null : null,
  }
}
