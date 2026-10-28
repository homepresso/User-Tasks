import { NextRequest } from 'next/server'
import { prepareRoundTripBody } from '@/lib/api-schemas/registry'
import { validateApiKey, requireApiPermission, ok, err } from '@/lib/api-auth'
import { normalizeAgentOutputConfig } from '@/lib/agent-knowledge'
import { deactivateWorkflowsReferencingAgent } from '@/lib/agent-references'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'agents.view')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth
  const { id } = await params

  const includeRuns = request.nextUrl.searchParams.get('include_runs') === 'true'

  const { data: agent, error } = await (supabase as any).from('agents').select('*').eq('id', id).eq('tenant_id', tenantId).single()
  if (error || !agent) return err('Agent not found', 404)

  const result: any = { agent }

  if (includeRuns) {
    const { data: runs } = await (supabase as any).from('agent_runs').select('id, input_message, output_response, iterations, tool_calls, usage, duration_ms, status, created_at')
      .eq('agent_id', id).order('created_at', { ascending: false }).limit(20)
    result.runs = runs ?? []
  }

  return ok(result)
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'agents.edit')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth
  const { id } = await params

  // The GET response (`{ agent: {...} }`) is accepted as the body too.
  const body = prepareRoundTripBody(undefined, { unwrap: 'agent' }, await request.json()) as Record<string, any>
  const allowedFields = ['name', 'description', 'model', 'system_prompt', 'role', 'task', 'boundaries', 'tools', 'output_config', 'integration_id', 'temperature', 'max_tokens', 'max_iterations', 'is_active']
  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  for (const key of allowedFields) {
    if (key in body) updates[key] = body[key]
  }
  if ('output_config' in updates) {
    updates.output_config = normalizeAgentOutputConfig(updates.output_config)
  }

  const { data, error } = await (supabase as any).from('agents').update(updates).eq('id', id).eq('tenant_id', tenantId).select('*').single()
  if (error) return err(error.message, 500)
  if (!data) return err('Agent not found', 404)
  return ok({ agent: data })
}

/** PATCH is the same partial update as PUT. */
export const PATCH = PUT

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'agents.delete')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth
  const { id } = await params

  // Deactivate any workflows that reference this agent so they don't run broken.
  const deactivated = await deactivateWorkflowsReferencingAgent(supabase, tenantId, id)

  const { error } = await (supabase as any).from('agents').delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) return err(error.message, 500)
  return ok({ deleted: true, deactivated_workflows: deactivated })
}
