import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err } from '@/lib/api-auth'
import { z } from 'zod'
import { workflowQueueActionBody as actionSchema } from '@/lib/api-schemas/workflows'
import { fromApiAuth, isServiceError } from '@/lib/services/context'
import { actOnQueueJob } from '@/lib/services/workflow-queue'

/** POST /api/v1/workflows/queue/{id}/action — cancel (pending/failed jobs) / retry (failed/dead jobs); see lib/services/workflow-queue. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'workflows.activate')
  if (forbidden) return forbidden
  const { id: jobId } = await params

  let body
  try {
    body = actionSchema.parse(await request.json())
  } catch (e) {
    const zodError = e as z.ZodError
    return err(`Validation failed: ${zodError.issues?.map(i => i.message).join(', ') ?? 'invalid JSON body'}`)
  }

  try {
    return ok(await actOnQueueJob(fromApiAuth(auth), jobId, body.action))
  } catch (e) {
    if (isServiceError(e)) return err(e.message, e.status)
    return err(e instanceof Error ? e.message : 'Request failed', 500)
  }
}
