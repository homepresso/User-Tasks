'use server'

import { createClient, getCachedUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePermission } from '@/lib/permissions-server'
import { writeAudit } from '@/lib/audit-log'
import { enqueueDeletionJob, kickDeletionProcessor } from '@/lib/deletion-queue'
import { recordAssetChange } from '@/lib/github-sync/enqueue'
import { invalidateDataTableTriggerCache } from '@/lib/data-table-workflow-triggers'
import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import * as workflowsService from '@/lib/services/workflows'
import { activationBlockMessage, workflowActivationBlock } from '@/lib/packages/activation'

export async function createWorkflow(formData: FormData) {
  const supabase = await createClient()
  // Independent reads — permission check doesn't depend on the user profile
  // (or vice versa), so run them concurrently instead of round-tripping twice.
  const [, user] = await Promise.all([requirePermission('workflows.create'), getCachedUser()])
  if (!user) throw new Error('Not authenticated')
  const { data: profile } = await supabase.from('users').select('current_tenant_id, tenant_id').eq('id', user.id).single()
  const tenantId = profile?.current_tenant_id ?? profile?.tenant_id
  if (!tenantId) throw new Error('No tenant')

  const name = formData.get('name') as string
  const triggerType = formData.get('trigger_type') as string || 'task_created'

  const triggerLabels: Record<string, string> = {
    task_created: 'Task Created',
    task_received: 'Task Received',
    task_submitted: 'Task Submitted',
    task_updated: 'Task Updated',
    task_completed: 'Task Completed',
    task_rejected: 'Task Rejected',
    workflow_error: 'Workflow Error',
    workflow_sla: 'Workflow SLA',
    retention_policy_review: 'Policy Review',
    retention_policy_executed: 'Policy Executed',
    data_table_event: 'Data Table Event',
    form_submitted: 'Form Submitted',
    middleware_received: 'Middleware',
    schedule: 'Schedule',
    webhook_received: 'Webhook',
  }
  const initialNode = {
    id: crypto.randomUUID(),
    type: triggerType,
    label: triggerLabels[triggerType] ?? triggerType,
    position: { x: 300, y: 20 },
    config: {},
  }
  const initialNodes = [initialNode]
  const initialEdges: { id: string; source: string; target: string }[] = []

  if (triggerType === 'middleware_received') {
    const endNodeId = crypto.randomUUID()
    initialNodes.push({
      id: endNodeId,
      type: 'end_workflow',
      label: 'Return Response',
      position: { x: 300, y: 180 },
      config: {
        reason: 'Middleware completed',
        response_status_code: '200',
        response_body_mode: 'json',
        response_mappings: [{ key: 'ok', value: 'true' }],
      },
    } as any)
    initialEdges.push({
      id: crypto.randomUUID(),
      source: initialNode.id,
      target: endNodeId,
    })
  }

  const { data, error } = await supabase.from('workflows').insert({
    tenant_id: tenantId,
    name,
    trigger_type: triggerType,
    nodes: initialNodes,
    edges: initialEdges,
    created_by: user.id,
  } as any).select('id').single()

  if (error) throw error
  await writeAudit({
    supabase, tenantId, actorId: user.id,
    objectType: 'workflow', objectId: data.id, action: 'create',
    summary: `Created workflow "${name}"`,
    metadata: { trigger_type: triggerType },
  })
  void recordAssetChange({ supabase, tenantId, assetType: 'workflow', assetId: data.id, assetName: name, action: 'save', actorId: user.id })
  revalidatePath('/automations')
  redirect(`/automations/${data.id}`)
}

const SAVE_WORKFLOW_FIELDS = ['nodes', 'edges', 'name', 'trigger_type', 'trigger_config', 'user_variables', 'swimlanes', 'sections'] as const

export async function saveWorkflow(workflowId: string, data: { nodes: any; edges: any; name?: string; trigger_type?: string; trigger_config?: any; user_variables?: any; swimlanes?: any; sections?: any }) {
  await requirePermission('workflows.edit')
  const supabase = await createClient()
  // Only the designer's own fields: never is_active (workflows.activate),
  // tenant_id, created_by, published_version_id, ... from the client.
  const fields: Record<string, unknown> = {}
  for (const key of SAVE_WORKFLOW_FIELDS) {
    if (data && Object.prototype.hasOwnProperty.call(data, key) && (data as Record<string, unknown>)[key] !== undefined) {
      fields[key] = (data as Record<string, unknown>)[key]
    }
  }
  const { data: updated, error } = await supabase.from('workflows').update({
    ...fields,
    has_unpublished_changes: true,
  } as any).eq('id', workflowId).select('tenant_id, name').single()
  if (error) throw error
  invalidateDataTableTriggerCache((updated as any)?.tenant_id)
  if ((updated as any)?.tenant_id) {
    void recordAssetChange({ supabase, tenantId: (updated as any).tenant_id, assetType: 'workflow', assetId: workflowId, assetName: (updated as any).name ?? null, action: 'save' })
  }
  // No revalidatePath — builder manages its own state. Revalidation on Vercel
  // triggers a page re-render that destroys client state (test runner, dialogs).
}

/** Package installs with incomplete setup keep their workflows inactive (lib/packages/activation). */
async function packageBlockMessage(workflowId: string): Promise<string | null> {
  // The workflow's tenant, read as the caller (RLS): another tenant's
  // workflow id tells them nothing.
  const { data: workflow } = await (await createClient()).from('workflows').select('tenant_id').eq('id', workflowId).maybeSingle()
  const tenantId = (workflow as { tenant_id?: string } | null)?.tenant_id
  if (!tenantId) return null
  let admin
  try {
    // Via lib/cron-auth (which wraps lib/providers/db) so existing mocks apply.
    const { createServiceClient } = await import('@/lib/cron-auth')
    admin = createServiceClient()
  } catch {
    return null
  }
  const block = await workflowActivationBlock(admin, workflowId, tenantId)
  return block ? activationBlockMessage(block) : null
}

/** The designer's "Needs configuration" banner: why this workflow can't be activated yet (null = it can). */
export async function getWorkflowPackageBlock(workflowId: string): Promise<string | null> {
  await requirePermission('workflows.view')
  return packageBlockMessage(workflowId)
}

export async function publishWorkflow(workflowId: string, notes?: string): Promise<{ version_number: number; version_id: string } | { error: string }> {
  await requirePermission('workflows.activate')
  // Returned, not thrown: thrown Server Function errors are redacted in production.
  const blocked = await packageBlockMessage(workflowId)
  if (blocked) return { error: blocked }
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')

  const { data: profile } = await supabase.from('users').select('current_tenant_id, tenant_id').eq('id', user.id).single()
  const tenantId = profile?.current_tenant_id ?? profile?.tenant_id

  // Load current workflow
  const { data: workflow } = await supabase.from('workflows').select('*').eq('id', workflowId).single()
  if (!workflow) throw new Error('Workflow not found')

  // Get next version number (use maybeSingle to handle first publish)
  const { data: lastVersion } = await (supabase as any)
    .from('workflow_versions')
    .select('version_number')
    .eq('workflow_id', workflowId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = (lastVersion?.version_number ?? 0) + 1

  // Deactivate all previous active versions for this workflow
  await (supabase as any)
    .from('workflow_versions')
    .update({ is_active: false })
    .eq('workflow_id', workflowId)
    .eq('is_active', true)

  // Linked reusable forms are pinned to their current version in the snapshot.
  const { pinWorkflowForms } = await import('@/lib/services/forms')
  const { createServiceClient } = await import('@/lib/cron-auth')
  const pinned = await pinWorkflowForms(createServiceClient(), String(tenantId), workflow.nodes, (workflow as any).trigger_config ?? {})

  // Create version snapshot (includes trigger_config)
  const { data: version, error: versionError } = await (supabase as any)
    .from('workflow_versions')
    .insert({
      workflow_id: workflowId,
      tenant_id: tenantId,
      version_number: nextVersion,
      nodes: pinned.nodes,
      edges: workflow.edges,
      user_variables: (workflow as any).user_variables ?? [],
      swimlanes: (workflow as any).swimlanes ?? [],
      trigger_type: workflow.trigger_type,
      trigger_config: pinned.trigger_config,
      publish_notes: notes || null,
      published_by: user.id,
      is_active: true,
    })
    .select('id')
    .single()

  if (versionError) throw new Error(versionError.message)

  // Update workflow to point to published version
  await supabase.from('workflows').update({
    published_version_id: version.id,
    has_unpublished_changes: false,
    is_active: true,
  } as any).eq('id', workflowId)

  await writeAudit({
    supabase, tenantId: tenantId!, actorId: user.id,
    objectType: 'workflow', objectId: workflowId, action: 'publish',
    summary: `Published version ${nextVersion} of "${workflow.name}"`,
    metadata: { version_number: nextVersion, version_id: version.id, publish_notes: notes ?? null },
  })

  if (tenantId) {
    void recordAssetChange({ supabase, tenantId, assetType: 'workflow', assetId: workflowId, assetName: workflow.name ?? null, action: 'save', actorId: user.id })
  }

  invalidateDataTableTriggerCache()
  revalidatePath('/automations')
  return { version_number: nextVersion, version_id: version.id }
}

export async function revertToVersion(workflowId: string, versionId: string) {
  await requirePermission('workflows.edit')
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')

  // Load version snapshot (verify it belongs to this workflow)
  const { data: version } = await (supabase as any)
    .from('workflow_versions')
    .select('*')
    .eq('id', versionId)
    .eq('workflow_id', workflowId)
    .single()

  if (!version) throw new Error('Version not found')

  // Overwrite draft with version's snapshot (includes trigger_config). Form
  // pins are dropped: drafts follow the latest version of linked forms.
  const { unpinFormVersions } = await import('@/lib/forms/definition')
  const unpinned = unpinFormVersions(version.nodes, version.trigger_config ?? {})
  await supabase.from('workflows').update({
    nodes: unpinned.nodes,
    edges: version.edges,
    user_variables: version.user_variables,
    swimlanes: version.swimlanes,
    trigger_type: version.trigger_type,
    trigger_config: unpinned.trigger_config,
    has_unpublished_changes: true,
  } as any).eq('id', workflowId)

  if (version.tenant_id) {
    void recordAssetChange({ supabase, tenantId: version.tenant_id, assetType: 'workflow', assetId: workflowId, action: 'save', actorId: user.id })
  }

  invalidateDataTableTriggerCache()
  revalidatePath('/automations')
}

export async function toggleWorkflow(workflowId: string, active: boolean) {
  await requirePermission('workflows.activate')
  if (active) {
    const blocked = await packageBlockMessage(workflowId)
    if (blocked) throw new Error(blocked)
  }
  const supabase = await createClient()
  const user = await getCachedUser()
  const { error } = await supabase.from('workflows').update({ is_active: active }).eq('id', workflowId)
  if (error) throw error
  if (user) {
    const { data: profile } = await supabase.from('users').select('current_tenant_id').eq('id', user.id).single()
    const tenantId = (profile as any)?.current_tenant_id
    if (tenantId) {
      await writeAudit({
        supabase, tenantId, actorId: user.id,
        objectType: 'workflow', objectId: workflowId, action: 'toggle',
        summary: active ? 'Activated workflow' : 'Deactivated workflow',
        diff: { is_active: { before: !active, after: active } },
      })
      void recordAssetChange({ supabase, tenantId, assetType: 'workflow', assetId: workflowId, action: 'save', actorId: user.id })
    }
  }
  invalidateDataTableTriggerCache()
  revalidatePath('/automations')
}

export async function updateWorkflowTags(workflowId: string, tags: string[]) {
  await requirePermission('workflows.edit')
  const supabase = await createClient()
  const { error } = await supabase.from('workflows').update({ tags } as any).eq('id', workflowId)
  if (error) throw error
  revalidatePath('/automations')
}

export async function deleteWorkflow(workflowId: string) {
  await requirePermission('workflows.delete')
  const supabase = await createClient()
  const user = await getCachedUser()
  const { data: wf } = await supabase.from('workflows').select('name, tenant_id').eq('id', workflowId).single()
  if (!wf) throw new Error('Workflow not found')
  await enqueueDeletionJob(supabase, {
    tenantId: (wf as any).tenant_id,
    createdBy: user?.id ?? null,
    targetType: 'workflow',
    targetId: workflowId,
    payload: { name: (wf as any).name ?? null },
  })
  if (user && wf) {
    await writeAudit({
      supabase, tenantId: (wf as any).tenant_id, actorId: user.id,
      objectType: 'workflow', objectId: workflowId, action: 'delete',
      summary: `Queued deletion for workflow "${(wf as any).name}"`,
    })
  }
  void recordAssetChange({ supabase, tenantId: (wf as any).tenant_id, assetType: 'workflow', assetId: workflowId, assetName: (wf as any).name ?? null, action: 'delete', actorId: user?.id ?? null })
  kickDeletionProcessor()
  invalidateDataTableTriggerCache()
  revalidatePath('/automations')
  // No redirect() — throws NEXT_REDIRECT, which breaks bulk deletes.
}

export async function bulkDeleteWorkflows(workflowIds: string[]) {
  await requirePermission('workflows.delete')
  if (workflowIds.length === 0) return
  const supabase = await createClient()
  const user = await getCachedUser()
  const { data: workflows, error } = await supabase
    .from('workflows')
    .select('id, name, tenant_id')
    .in('id', workflowIds)
  if (error) throw error
  for (const workflow of workflows ?? []) {
    await enqueueDeletionJob(supabase, {
      tenantId: (workflow as any).tenant_id,
      createdBy: user?.id ?? null,
      targetType: 'workflow',
      targetId: workflow.id,
      payload: { name: workflow.name ?? null },
    })
    void recordAssetChange({ supabase, tenantId: (workflow as any).tenant_id, assetType: 'workflow', assetId: workflow.id, assetName: workflow.name ?? null, action: 'delete', actorId: user?.id ?? null })
  }
  kickDeletionProcessor()
  invalidateDataTableTriggerCache()
  revalidatePath('/automations')
}

export async function bulkToggleWorkflows(workflowIds: string[], active: boolean) {
  await requirePermission('workflows.activate')
  if (workflowIds.length === 0) return
  const supabase = await createClient()
  const { error } = await supabase.from('workflows').update({ is_active: active }).in('id', workflowIds)
  if (error) throw error
  invalidateDataTableTriggerCache()
  revalidatePath('/automations')
}

/** Star / unstar a node type in the designer palette. */
export async function setNodeFavorite(nodeType: string, favorite: boolean): Promise<ActionResult<{ node_type: string; favorite: boolean }>> {
  return runAction('setNodeFavorite', 'Could not update favorites.', async () =>
    workflowsService.setNodeFavorite(await fromSession(), nodeType, favorite))
}
