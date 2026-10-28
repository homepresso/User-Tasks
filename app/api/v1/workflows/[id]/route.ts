import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err } from '@/lib/api-auth'
import { canAccessWorkflow } from '@/lib/api-key-permissions'
import { apiRoute } from '@/lib/api/route'
import { deleteWorkflowEndpoint, updateWorkflowDefinitionEndpoint } from '@/lib/api-schemas/workflows'
import { deleteWorkflow, toWorkflowDefinition, updateWorkflow } from '@/lib/services/workflows'

/**
 * GET /api/v1/workflows/:id — Get workflow instance detail
 *
 * Returns the workflow definition, current run status (if any),
 * populated variables, node results, and execution progress.
 *
 * Query params:
 *   run_id — specific run to inspect (defaults to latest)
 *   include_logs — include workflow logs (default: false)
 *   include_definition — include the draft definition in author-payload shape (default: false)
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'workflows.view')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth
  const { id: workflowId } = await params
  if (!canAccessWorkflow(auth, workflowId)) return err('This API key is not allowed to access that workflow', 403)

  const searchParams = request.nextUrl.searchParams
  const runId = searchParams.get('run_id')
  const includeLogs = searchParams.get('include_logs') === 'true'
  const includeDefinition = searchParams.get('include_definition') === 'true'

  // Fetch workflow
  const { data: workflow } = await supabase
    .from('workflows')
    .select('id, name, trigger_type, is_active, published_version_id, has_unpublished_changes, created_at, updated_at')
    .eq('id', workflowId)
    .eq('tenant_id', tenantId)
    .single()

  if (!workflow) return err('Workflow not found', 404)

  // Fetch the draft definition (user variables are always returned)
  const { data: wfFull } = await supabase
    .from('workflows')
    .select('name, description, trigger_type, trigger_config, nodes, edges, user_variables, swimlanes, sections, tags')
    .eq('id', workflowId)
    .eq('tenant_id', tenantId)
    .single()

  const userVariables = (wfFull as any)?.user_variables ?? []

  // Optionally include the full definition (the author payload, so the
  // response can be edited and sent back to PATCH /workflows/:id)
  const definition = includeDefinition && wfFull ? toWorkflowDefinition(wfFull as any) : undefined

  // Fetch published version info
  let publishedVersion = null
  if ((workflow as any).published_version_id) {
    const { data: version } = await supabase
      .from('workflow_versions' as any)
      .select('id, version_number, published_by, is_active, publish_notes, created_at')
      .eq('id', (workflow as any).published_version_id)
      .single()
    publishedVersion = version
  }

  // Fetch the target run (specific or latest)
  let run: any = null
  if (runId) {
    const { data } = await supabase
      .from('workflow_runs')
      .select('*')
      .eq('id', runId)
      .eq('workflow_id', workflowId)
      .eq('tenant_id', tenantId)
      .single()
    run = data
  } else {
    // Get most recent run
    const { data } = await supabase
      .from('workflow_runs')
      .select('*')
      .eq('workflow_id', workflowId)
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    run = data
  }

  // Build run detail with execution state
  let runDetail = null
  if (run) {
    const nodeResults = (run.node_results ?? {}) as Record<string, any>
    const pauseVariables = (run.pause_variables ?? {}) as Record<string, any>

    // Determine which nodes have executed and current position
    const executedNodeIds = Object.keys(nodeResults)
    const currentNodeId = run.paused_node_id ?? null
    const isActive = ['running', 'waiting_for_event', 'paused'].includes(run.status)

    // Get the variables — either from pause_variables (if paused) or from the last known state
    const variables = Object.keys(pauseVariables).length > 0
      ? pauseVariables
      : extractVariablesFromResults(nodeResults)

    // Remove internal/system variables for cleaner output
    const { supabase: _s, ...cleanVariables } = variables as any
    delete cleanVariables._liveCache

    runDetail = {
      run_id: run.id,
      status: run.status,
      title: run.title,
      started_at: run.started_at,
      completed_at: run.completed_at,
      error: run.error,
      version_id: run.version_id,
      task_id: run.task_id,
      event_id: run.event_id,
      sla_label: run.sla_label ?? null,
      sla_due_at: run.sla_due_at ?? null,
      sla_warning_at: run.sla_warning_at ?? null,
      sla_status: run.sla_status ?? 'none',
      sla_warning_triggered_at: run.sla_warning_triggered_at ?? null,
      sla_breached_triggered_at: run.sla_breached_triggered_at ?? null,
      paused_node_id: currentNodeId,
      paused_at: run.paused_at,
      is_active: isActive,
      executed_nodes: executedNodeIds.length,
      node_results: nodeResults,
      variables: cleanVariables,
      progress: buildProgress(nodeResults),
    }
  }

  // Optionally fetch logs
  let logs = null
  if (includeLogs && run) {
    const { data: logData } = await supabase
      .from('workflow_logs')
      .select('*')
      .eq('run_id', run.id)
      .order('created_at', { ascending: true })
    logs = logData ?? []
  }

  // Run history summary (last 10)
  const { data: recentRuns } = await supabase
    .from('workflow_runs')
    .select('id, status, title, started_at, completed_at, error, sla_label, sla_due_at, sla_warning_at, sla_status')
    .eq('workflow_id', workflowId)
    .eq('tenant_id', tenantId)
    .order('started_at', { ascending: false })
    .limit(10)

  return ok({
    workflow: {
      ...workflow,
      user_variables: userVariables,
      published_version: publishedVersion,
    },
    current_run: runDetail,
    recent_runs: recentRuns ?? [],
    ...(definition ? { definition } : {}),
    ...(logs ? { logs } : {}),
  })
}

/** Extract variable assignments from node results (best-effort for completed runs) */
function extractVariablesFromResults(nodeResults: Record<string, any>): Record<string, any> {
  const vars: Record<string, any> = {}
  for (const [, result] of Object.entries(nodeResults)) {
    if (result?.output) {
      // Many nodes store their output variable name and value
      if (result.output.variable && result.output.value !== undefined) {
        vars[result.output.variable] = result.output.value
      }
      if (result.output.variable && result.output.result !== undefined) {
        vars[result.output.variable] = result.output.result
      }
    }
  }
  return vars
}

/** Build a progress summary from node results */
function buildProgress(nodeResults: Record<string, any>): { total_executed: number; succeeded: number; failed: number; waiting: number } {
  let succeeded = 0, failed = 0, waiting = 0
  for (const result of Object.values(nodeResults)) {
    if (result?.status === 'success') succeeded++
    else if (result?.status === 'error') failed++
    else if (result?.status === 'waiting') waiting++
  }
  return {
    total_executed: Object.keys(nodeResults).length,
    succeeded,
    failed,
    waiting,
  }
}

/** DELETE /api/v1/workflows/:id — queued delete (versions, runs and spawned tasks go with it). */
export const DELETE = apiRoute(deleteWorkflowEndpoint, async ({ ctx, params }) => deleteWorkflow(ctx, params.id))

/** PATCH /api/v1/workflows/:id — save draft changes (author payload; the GET response is accepted too). */
export const PATCH = apiRoute(updateWorkflowDefinitionEndpoint, async ({ ctx, params, body }) => updateWorkflow(ctx, params.id, body))
