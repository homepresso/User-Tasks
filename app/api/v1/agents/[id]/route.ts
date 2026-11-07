import { NextRequest } from 'next/server'
import { prepareRoundTripBody } from '@/lib/api-schemas/registry'
import { validateApiKey, requireApiPermission, ok, err } from '@/lib/api-auth'
import { fromApiAuth, isServiceError } from '@/lib/services/context'
import { deleteAgent, updateAgent } from '@/lib/services/agents'

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
    const { data: runs } = await (supabase as any).from('agent_runs').select('id, input_message, output_response, outputs, iterations, tool_calls, usage, total_tokens, duration_ms, status, error, caller_type, created_at')
      .eq('agent_id', id).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(20)
    result.runs = runs ?? []
  }

  return ok(result)
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'agents.edit')
  if (forbidden) return forbidden
  const { id } = await params

  // The GET response (`{ agent: {...} }`) is accepted as the body too.
  const body = prepareRoundTripBody(undefined, { unwrap: 'agent' }, await request.json().catch(() => ({}))) as Record<string, any>
  try {
    const agent = await updateAgent(fromApiAuth(auth), id, body)
    return ok({ agent })
  } catch (error) {
    if (isServiceError(error)) return err(error.message, error.status)
    return err((error as Error)?.message ?? 'Failed to update the agent', 500)
  }
}

/** PATCH is the same partial update as PUT. */
export const PATCH = PUT

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'agents.delete')
  if (forbidden) return forbidden
  const { id } = await params
  try {
    // Queued (as in the designer); referencing workflows are deactivated first.
    return ok(await deleteAgent(fromApiAuth(auth), id))
  } catch (error) {
    if (isServiceError(error)) return err(error.message, error.status)
    return err((error as Error)?.message ?? 'Failed to delete the agent', 500)
  }
}
