import { NextRequest } from 'next/server'
import { validateApiKey, ok, err, requireApiPermission } from '@/lib/api-auth'
import { processPushBatch } from '@/lib/github-sync/push'

export const maxDuration = 60

/**
 * POST /api/v1/github-sync/commit
 * Body: { message?: string }
 * Flushes this workspace's pending sync queue to the connected repo as a
 * single commit (the API twin of the settings screen's "Commit now").
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'sync.manage')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth

  const body = await request.json().catch(() => ({}))
  try {
    const result = await processPushBatch(supabase as any, tenantId, {
      message: typeof body.message === 'string' ? body.message : undefined,
    })
    if (!result.commitSha) return ok({ committed: false, message: 'No pending changes' })
    return ok({ committed: true, commit_sha: result.commitSha, files_changed: result.filesChanged, changes: result.processed })
  } catch (error: any) {
    return err(error?.message ?? 'Commit failed', 502)
  }
}
