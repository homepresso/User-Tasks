import { NextRequest } from 'next/server'
import { validateApiKey, ok, err, requireApiPermission } from '@/lib/api-auth'

/** GET /api/v1/github-sync/deployments/{id} — poll deployment status. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'sync.view')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth

  const { data, error } = await (supabase as any)
    .from('github_deployments')
    .select('id, source, dry_run, status, stats, error, created_at, started_at, completed_at')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  if (error) return err(error.message, 500)
  if (!data) return err('Deployment not found', 404)
  return ok({ deployment: data })
}
