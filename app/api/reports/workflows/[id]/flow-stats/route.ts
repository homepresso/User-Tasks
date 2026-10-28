import { NextRequest, NextResponse } from 'next/server'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { getUserPermissions } from '@/lib/permissions-server'
import { buildAggregateFlowStats } from '@/lib/report-flow-stats'

/**
 * Per-node / per-edge visit counts for a workflow's newest runs (the process
 * overview heat map). Computed here so execution traces and node results
 * never ship to the browser. Session auth; the user's own client is used, so
 * workflow and run RLS apply exactly as on the page.
 */

export const dynamic = 'force-dynamic'

const RUN_LIMIT = 2000
const PAGE_SIZE = 250

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const perms = await getUserPermissions()
  if (!perms.has('reports.view')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { data: workflow, error } = await supabase
    .from('workflows')
    .select('id, nodes, edges')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!workflow) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })

  // Same run set as the page (newest RUN_LIMIT), fetched in pages to bound
  // the size of each response.
  const runs: Array<Record<string, unknown>> = []
  for (let offset = 0; offset < RUN_LIMIT; offset += PAGE_SIZE) {
    const { data, error: runsError } = await supabase
      .from('workflow_runs')
      .select('id, paused_node_id, node_results, execution_trace')
      .eq('workflow_id', id)
      .order('started_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, Math.min(offset + PAGE_SIZE, RUN_LIMIT) - 1)
    if (runsError) return NextResponse.json({ error: runsError.message }, { status: 500 })
    runs.push(...((data ?? []) as Array<Record<string, unknown>>))
    if ((data ?? []).length < PAGE_SIZE) break
  }

  return NextResponse.json(buildAggregateFlowStats(workflow, runs), {
    headers: { 'Cache-Control': 'private, max-age=30' },
  })
}
