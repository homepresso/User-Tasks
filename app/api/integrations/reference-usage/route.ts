import { NextRequest, NextResponse } from 'next/server'
import { createClient, getSessionUserFast } from '@/lib/supabase/server'
import { getCurrentTenantId, getOwnedReference } from '@/lib/integrations/auth'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const sessionUser = await getSessionUserFast()
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const refId = request.nextUrl.searchParams.get('id')
  if (!refId) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Get user's tenant
  const tenantId = await getCurrentTenantId(supabase, sessionUser.id)
  await getOwnedReference(supabase, tenantId, refId, 'id')

  // Find workflows using this reference (scan nodes JSON)
  const { data: workflows } = await supabase
    .from('workflows')
    .select('id, name, is_active, last_run_at, run_count, nodes')
    .eq('tenant_id', tenantId)

  const usingWorkflows = (workflows ?? [])
    .filter(w => {
      const nodes = w.nodes as any[]
      return nodes?.some((n: any) => n.config?.reference_id === refId)
    })
    .map(w => {
      const nodes = w.nodes as any[]
      const refNodes = nodes.filter((n: any) => n.config?.reference_id === refId)
      return {
        id: w.id,
        name: w.name,
        is_active: w.is_active,
        last_run_at: w.last_run_at,
        run_count: w.run_count ?? 0,
        node_count: refNodes.length,
        node_labels: refNodes.map((n: any) => n.label),
      }
    })

  // Count executions from workflow_logs
  // Since logs don't store reference_id directly, count by matching node_ids across workflows
  let totalExecutions = 0
  let lastExecutedAt: string | null = null

  // Get node IDs that use this reference across all workflows
  const refNodeIds: string[] = []
  for (const w of workflows ?? []) {
    const nodes = w.nodes as any[]
    for (const n of nodes ?? []) {
      if (n.config?.reference_id === refId) refNodeIds.push(n.id)
    }
  }

  if (refNodeIds.length > 0) {
    // Query workflow_logs for these node IDs
    const { count } = await (supabase as any)
      .from('workflow_logs')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('node_type', 'call_reference')
      .in('node_id', refNodeIds)

    totalExecutions = count ?? 0

    // Get last execution time
    const { data: lastLog } = await (supabase as any)
      .from('workflow_logs')
      .select('created_at')
      .eq('tenant_id', tenantId)
      .eq('node_type', 'call_reference')
      .in('node_id', refNodeIds)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    lastExecutedAt = lastLog?.created_at ?? null
  }

  return NextResponse.json({
    reference_id: refId,
    workflows: usingWorkflows,
    workflow_count: usingWorkflows.length,
    total_executions: totalExecutions,
    last_executed_at: lastExecutedAt,
  })
}
