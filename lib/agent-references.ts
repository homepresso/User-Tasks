import type { SupabaseClient } from '@supabase/supabase-js'
import { invalidateDataTableTriggerCache } from '@/lib/data-table-workflow-triggers'

/**
 * Agent reference-integrity helpers.
 *
 * A run_agent workflow node references an agent by `config.agent_id`. Deleting
 * the agent would leave those nodes dangling — the workflow would fail at
 * runtime with "Agent not found". Per the product decision, deletion is allowed
 * but any referencing workflow is deactivated (paused) so it can't run broken,
 * and the caller surfaces which ones were affected.
 */

export interface ReferencingWorkflow {
  id: string
  name: string
}

/** Workflows in the tenant whose nodes include a run_agent node for `agentId`. */
export async function findWorkflowsReferencingAgent(
  supabase: SupabaseClient<any, any, any>,
  tenantId: string,
  agentId: string,
): Promise<ReferencingWorkflow[]> {
  const { data } = await (supabase as any)
    .from('workflows')
    .select('id, name, nodes')
    .eq('tenant_id', tenantId)

  const matches: ReferencingWorkflow[] = []
  for (const wf of (data ?? []) as any[]) {
    const nodes = Array.isArray(wf.nodes) ? wf.nodes : []
    const referenced = nodes.some((n: any) => String(n?.config?.agent_id ?? '').trim() === agentId)
    if (referenced) matches.push({ id: wf.id, name: wf.name ?? wf.id })
  }
  return matches
}

/**
 * Deactivate every workflow referencing `agentId`. Returns the deactivated
 * workflows (for surfacing to the user / audit). Never throws — a best-effort
 * cleanup around the delete.
 */
export async function deactivateWorkflowsReferencingAgent(
  supabase: SupabaseClient<any, any, any>,
  tenantId: string,
  agentId: string,
): Promise<ReferencingWorkflow[]> {
  try {
    const referencing = await findWorkflowsReferencingAgent(supabase, tenantId, agentId)
    if (referencing.length === 0) return []
    await (supabase as any)
      .from('workflows')
      .update({ is_active: false })
      .eq('tenant_id', tenantId)
      .in('id', referencing.map((w) => w.id))
    invalidateDataTableTriggerCache(tenantId)
    return referencing
  } catch (err: any) {
    console.warn('[agent-references] deactivate referencing workflows failed:', err?.message)
    return []
  }
}
