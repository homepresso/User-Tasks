import type { SupabaseClient } from '@supabase/supabase-js'
import { getServiceDb } from '@/lib/providers/db'
import { executeWorkflow } from '@/lib/workflow-engine'

const ACTIVE_RUN_STATUSES = ['running', 'paused', 'waiting_for_event'] as const

type WorkflowSlaEventType = 'warning' | 'breached'

function createServiceRoleClient() {
  return getServiceDb({ anonFallback: true })
}

function normalizeTriggerNodeConfig(workflow: any, version: any) {
  const versionNodes = Array.isArray(version?.nodes) ? version.nodes : []
  const workflowNodes = Array.isArray(workflow?.nodes) ? workflow.nodes : []
  return (
    versionNodes.find((node: any) => node?.type === 'workflow_sla')?.config
    ?? version?.trigger_config
    ?? workflowNodes.find((node: any) => node?.type === 'workflow_sla')?.config
    ?? workflow?.trigger_config
    ?? {}
  ) as Record<string, any>
}

function matchesConfiguredWorkflow(config: Record<string, any>, run: any) {
  const scope = config.workflow_scope === 'specific' ? 'specific' : 'all'
  const workflowIds = Array.isArray(config.workflow_ids)
    ? config.workflow_ids.filter(Boolean)
    : config.workflow_id
      ? [config.workflow_id]
      : []
  if (scope !== 'specific') return true
  return workflowIds.includes(run.workflow_id)
}

function matchesConfiguredEvent(config: Record<string, any>, eventType: WorkflowSlaEventType) {
  const eventTypes = Array.isArray(config.event_types) ? config.event_types.filter(Boolean) : []
  if (eventTypes.length === 0) return true
  return eventTypes.includes(eventType)
}

function buildVariables(run: any, workflow: any, eventType: WorkflowSlaEventType) {
  return {
    workflow_sla_event: eventType,
    workflow_sla_status: eventType === 'warning' ? 'warning' : 'breached',
    workflow_sla_label: run.sla_label ?? null,
    workflow_sla_due_at: run.sla_due_at ?? null,
    workflow_sla_warning_at: run.sla_warning_at ?? null,
    workflow_sla_run_id: run.id,
    workflow_sla_run_title: run.title ?? null,
    workflow_sla_run_status: run.status,
    workflow_sla_workflow_id: run.workflow_id,
    workflow_sla_workflow_name: workflow?.name ?? null,
    workflow_sla_task_id: run.task_id ?? null,
    workflow_sla_event_at: new Date().toISOString(),
  }
}

async function evaluateRun(supabase: SupabaseClient, run: any, nowIso: string) {
  const now = new Date(nowIso)
  const dueAt = run.sla_due_at ? new Date(run.sla_due_at) : null
  const warningAt = run.sla_warning_at ? new Date(run.sla_warning_at) : null

  let nextStatus = run.sla_status || 'none'
  if (!dueAt) nextStatus = 'none'
  else if (dueAt.getTime() <= now.getTime()) nextStatus = 'breached'
  else if (warningAt && warningAt.getTime() <= now.getTime()) nextStatus = 'warning'
  else nextStatus = 'on_track'

  const updates: Record<string, any> = {
    sla_status: nextStatus,
    sla_last_evaluated_at: nowIso,
  }
  const events: WorkflowSlaEventType[] = []

  if (nextStatus === 'warning' && !run.sla_warning_triggered_at) {
    updates.sla_warning_triggered_at = nowIso
    events.push('warning')
  }
  if (nextStatus === 'breached' && !run.sla_breached_triggered_at) {
    updates.sla_breached_triggered_at = nowIso
    events.push('breached')
  }

  await supabase.from('workflow_runs').update(updates as any).eq('id', run.id)
  return { ...run, ...updates, events }
}

export async function processWorkflowSlaTriggers(options?: { supabase?: SupabaseClient }) {
  const supabase = options?.supabase ?? createServiceRoleClient()
  const nowIso = new Date().toISOString()

  const { data: activeRuns, error: runsError } = await (supabase as any)
    .from('workflow_runs')
    .select('id, tenant_id, workflow_id, task_id, title, status, sla_label, sla_due_at, sla_warning_at, sla_status, sla_warning_triggered_at, sla_breached_triggered_at, sla_last_evaluated_at, sla_metadata')
    .in('status', [...ACTIVE_RUN_STATUSES])
    .not('sla_due_at', 'is', null)

  if (runsError) throw new Error(runsError.message)
  const runs = activeRuns ?? []
  if (runs.length === 0) return { ok: true, evaluated: 0, triggered: 0, warnings: 0, breaches: 0 }

  const workflowIds = [...new Set(runs.map((run: any) => run.workflow_id).filter(Boolean))]
  const tenantIds = [...new Set(runs.map((run: any) => run.tenant_id).filter(Boolean))]

  const [{ data: workflows, error: workflowsError }, { data: slaWorkflows, error: triggerError }] = await Promise.all([
    (supabase as any).from('workflows').select('id, tenant_id, name').in('id', workflowIds),
    (supabase as any).from('workflows').select('id, tenant_id, name, nodes, trigger_config, published_version_id').in('tenant_id', tenantIds).eq('trigger_type', 'workflow_sla').eq('is_active', true),
  ])
  if (workflowsError) throw new Error(workflowsError.message)
  if (triggerError) throw new Error(triggerError.message)

  const versionIds = [...new Set((slaWorkflows ?? []).map((workflow: any) => workflow.published_version_id).filter(Boolean))]
  const { data: versions, error: versionsError } = versionIds.length
    ? await (supabase as any).from('workflow_versions').select('id, nodes, trigger_config').in('id', versionIds)
    : { data: [], error: null }
  if (versionsError) throw new Error(versionsError.message)

  const workflowMap = new Map((workflows ?? []).map((workflow: any) => [workflow.id, workflow]))
  const versionMap = new Map((versions ?? []).map((version: any) => [version.id, version]))
  const triggerMap = new Map<string, any[]>()
  for (const workflow of slaWorkflows ?? []) {
    const list = triggerMap.get(workflow.tenant_id) ?? []
    list.push(workflow)
    triggerMap.set(workflow.tenant_id, list)
  }

  let triggered = 0
  let warnings = 0
  let breaches = 0

  for (const run of runs) {
    const updatedRun = await evaluateRun(supabase, run, nowIso)
    if (!updatedRun.events.length) continue

    const sourceWorkflow = workflowMap.get(run.workflow_id)
    const triggerWorkflows = triggerMap.get(run.tenant_id) ?? []
    for (const eventType of updatedRun.events as WorkflowSlaEventType[]) {
      for (const triggerWorkflow of triggerWorkflows) {
        const config = normalizeTriggerNodeConfig(triggerWorkflow, versionMap.get(triggerWorkflow.published_version_id))
        if (!matchesConfiguredWorkflow(config, run)) continue
        if (!matchesConfiguredEvent(config, eventType)) continue
        executeWorkflow(triggerWorkflow.id, undefined, false, buildVariables(updatedRun, sourceWorkflow, eventType), undefined, undefined, undefined, { initiator: { userId: null, via: 'event' } }).catch(() => {})
        triggered += 1
      }

      if (eventType === 'warning') warnings += 1
      if (eventType === 'breached') breaches += 1
    }
  }

  return { ok: true, evaluated: runs.length, triggered, warnings, breaches }
}
