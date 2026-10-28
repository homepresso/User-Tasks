import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err, parsePagination } from '@/lib/api-auth'
import { hasWorkflowScope } from '@/lib/api-key-permissions'
import { apiRoute } from '@/lib/api/route'
import { createWorkflowEndpoint } from '@/lib/api-schemas/workflows'
import { createWorkflow } from '@/lib/services/workflows'

export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'workflows.view')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth

  const params = request.nextUrl.searchParams
  const { limit, offset } = parsePagination(params)
  const activeOnly = params.get('active') !== 'false'

  let query = supabase
    .from('workflows')
    .select('id, name, trigger_type, is_active, created_at, updated_at', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })

  if (hasWorkflowScope(auth)) query = query.in('id', auth.scopes.workflow_ids)
  if (activeOnly) query = query.eq('is_active', true)
  if (offset > 0) query = query.range(offset, offset + (limit ?? 1000) - 1)
  else if (limit) query = query.limit(limit)

  const { data, count, error } = await query
  if (error) return err(error.message, 500)

  return ok({ workflows: data ?? [], total: count ?? 0 })
}

/**
 * POST /api/v1/workflows — create a workflow from an author payload (draft
 * save, plus version 1 when `publish: true`). Update with PATCH /workflows/{id}.
 */
export const POST = apiRoute(createWorkflowEndpoint, async ({ ctx, body }) => createWorkflow(ctx, body))
