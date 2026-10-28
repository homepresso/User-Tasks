import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err } from '@/lib/api-auth'
import { z } from 'zod'
import { workflowRunActionBody as actionSchema } from '@/lib/api-schemas/workflows'
import { fromApiAuth, isServiceError } from '@/lib/services/context'
import { actOnWorkflowRun } from '@/lib/services/workflow-runs'

/** POST /api/v1/workflows/runs/{id}/action — pause / resume (optionally at goto_node_id) / cancel; see lib/services/workflow-runs. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'workflows.activate')
  if (forbidden) return forbidden
  const { id: runId } = await params

  let body
  try {
    body = actionSchema.parse(await request.json())
  } catch (e) {
    const zodError = e as z.ZodError
    return err(`Validation failed: ${zodError.issues?.map(i => i.message).join(', ') ?? 'invalid JSON body'}`)
  }

  try {
    const result = await actOnWorkflowRun(fromApiAuth(auth), { runId }, {
      action: body.action,
      variables: body.return_variables ?? null,
      gotoNodeId: body.goto_node_id ?? null,
    })
    return ok(result)
  } catch (e) {
    if (isServiceError(e)) return err(e.message, e.status)
    return err(e instanceof Error ? e.message : 'Request failed', 500)
  }
}
