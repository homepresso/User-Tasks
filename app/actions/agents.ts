'use server'

import { createClient, getCachedUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePermission } from '@/lib/permissions-server'
import { writeAudit } from '@/lib/audit-log'
import { enqueueDeletionJob, kickDeletionProcessor } from '@/lib/deletion-queue'
import { normalizeAgentOutputConfig } from '@/lib/agent-knowledge'
import { deactivateWorkflowsReferencingAgent } from '@/lib/agent-references'
import { recordAssetChange } from '@/lib/github-sync/enqueue'

export async function createAgent(data: { name: string; description?: string }) {
  await requirePermission('agents.create')
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')
  const { data: profile } = await supabase.from('users').select('current_tenant_id, tenant_id').eq('id', user.id).single()
  const tenantId = profile?.current_tenant_id ?? profile?.tenant_id

  const { data: agent, error } = await (supabase as any).from('agents').insert({
    tenant_id: tenantId,
    name: data.name,
    description: data.description || null,
    created_by: user.id,
    system_prompt: '',
    role: '',
    task: '',
    boundaries: '',
    output_config: normalizeAgentOutputConfig({ variables: [] }),
    tools: [],
  }).select('id').single()
  if (error) throw new Error(error.message)
  if (tenantId) {
    await writeAudit({
      supabase, tenantId, actorId: user.id,
      objectType: 'agent', objectId: (agent as any).id, action: 'create',
      summary: `Created agent "${data.name}"`,
    })
    void recordAssetChange({ supabase, tenantId, assetType: 'agent', assetId: (agent as any).id, assetName: data.name, action: 'save', actorId: user.id })
  }
  revalidatePath('/agents')
  redirect(`/agents/${(agent as any).id}`)
}

export async function saveAgent(agentId: string, updates: Record<string, any>) {
  await requirePermission('agents.edit')
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')
  const { data: existing } = await (supabase as any).from('agents').select('id, name, tenant_id').eq('id', agentId).single()
  if (!existing) throw new Error('Agent not found')
  const { error } = await (supabase as any).from('agents').update({
    ...updates,
    ...(updates.output_config !== undefined ? { output_config: normalizeAgentOutputConfig(updates.output_config) } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', agentId)
  if (error) throw new Error(error.message)
  await writeAudit({
    supabase,
    tenantId: existing.tenant_id,
    actorId: user.id,
    objectType: 'agent',
    objectId: agentId,
    action: 'update',
    summary: `Updated agent "${updates.name ?? existing.name}"`,
  })
  void recordAssetChange({ supabase, tenantId: existing.tenant_id, assetType: 'agent', assetId: agentId, assetName: updates.name ?? existing.name ?? null, action: 'save', actorId: user.id })
  revalidatePath('/agents')
  revalidatePath(`/agents/${agentId}`)
}

export async function deleteAgent(agentId: string) {
  await requirePermission('agents.delete')
  const supabase = await createClient()
  const user = await getCachedUser()
  const { data: agent } = await (supabase as any).from('agents').select('name, tenant_id').eq('id', agentId).single()
  if (!agent) throw new Error('Agent not found')
  // Reference integrity: deactivate workflows referencing this agent before it's gone.
  const deactivated = await deactivateWorkflowsReferencingAgent(supabase, agent.tenant_id, agentId)
  await enqueueDeletionJob(supabase, {
    tenantId: agent.tenant_id,
    createdBy: user?.id ?? null,
    targetType: 'agent',
    targetId: agentId,
    payload: { name: agent.name ?? null },
  })
  if (user && agent) {
    await writeAudit({
      supabase, tenantId: agent.tenant_id, actorId: user.id,
      objectType: 'agent', objectId: agentId, action: 'delete',
      summary: `Queued deletion for agent "${agent.name}"`,
      metadata: deactivated.length > 0 ? { deactivated_workflows: deactivated } : undefined,
    })
  }
  void recordAssetChange({ supabase, tenantId: agent.tenant_id, assetType: 'agent', assetId: agentId, assetName: agent.name ?? null, action: 'delete', actorId: user?.id ?? null })
  kickDeletionProcessor()
  revalidatePath('/agents')
}

export async function bulkDeleteAgents(agentIds: string[]) {
  await requirePermission('agents.delete')
  const supabase = await createClient()
  const user = await getCachedUser()

  const uniqueIds = Array.from(new Set(agentIds.map((id) => id.trim()).filter(Boolean)))
  if (uniqueIds.length === 0) return { queued: 0 }

  const { data: agents } = await (supabase as any)
    .from('agents')
    .select('id, name, tenant_id')
    .in('id', uniqueIds)

  for (const agent of agents ?? []) {
    // Reference integrity: deactivate workflows referencing this agent before it's gone.
    const deactivated = await deactivateWorkflowsReferencingAgent(supabase, (agent as any).tenant_id, (agent as any).id)
    await enqueueDeletionJob(supabase, {
      tenantId: (agent as any).tenant_id,
      createdBy: user?.id ?? null,
      targetType: 'agent',
      targetId: (agent as any).id,
      payload: { name: (agent as any).name ?? null },
    })
    if (user) {
      await writeAudit({
        supabase,
        tenantId: (agent as any).tenant_id,
        actorId: user.id,
        objectType: 'agent',
        objectId: (agent as any).id,
        action: 'delete',
        summary: `Queued deletion for agent "${(agent as any).name}"`,
        metadata: deactivated.length > 0 ? { deactivated_workflows: deactivated } : undefined,
      })
    }
    void recordAssetChange({ supabase, tenantId: (agent as any).tenant_id, assetType: 'agent', assetId: (agent as any).id, assetName: (agent as any).name ?? null, action: 'delete', actorId: user?.id ?? null })
  }

  kickDeletionProcessor()
  revalidatePath('/agents')
  return { queued: (agents ?? []).length }
}
