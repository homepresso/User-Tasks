/**
 * Live (waiting / paused) instance counts per version of a workflow, from the
 * workflow_live_instance_counts RPC (SECURITY INVOKER: run RLS applies).
 * Shared by the workflow page badge and the version history.
 */

export interface LiveInstanceCount { version_id: string | null; instances: number }

interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}

export async function fetchLiveInstanceCounts(supabase: unknown, tenantId: string, workflowId: string): Promise<LiveInstanceCount[]> {
  const { data, error } = await (supabase as RpcClient).rpc('workflow_live_instance_counts', { p_tenant_id: tenantId, p_workflow_id: workflowId })
  if (error || !Array.isArray(data)) return []
  return (data as LiveInstanceCount[]).map((r) => ({ version_id: r.version_id ?? null, instances: Number(r.instances) || 0 }))
}
