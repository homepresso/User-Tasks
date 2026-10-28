import { NextRequest } from 'next/server'
import { validateApiKey, ok, err, requireApiPermission, parsePagination } from '@/lib/api-auth'

/** GET /api/v1/github-sync/deployments — paginated deployment history. */
export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'sync.view')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth

  const { limit, offset } = parsePagination(request.nextUrl.searchParams)
  let query = (supabase as any)
    .from('github_deployments')
    .select('id, source, dry_run, status, stats, error, created_at, started_at, completed_at', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
  if (offset > 0) query = query.range(offset, offset + (limit ?? 50) - 1)
  else query = query.limit(limit ?? 50)

  const { data, count, error } = await query
  if (error) return err(error.message, 500)
  return ok({ deployments: data ?? [], total: count ?? 0 })
}
