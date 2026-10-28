import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err } from '@/lib/api-auth'
import { resumeWorkflow } from '@/lib/workflow-engine'
import { z } from 'zod'
import { findOpenWorkflowTaskForEvent, USER_TASK_EVENT_MESSAGE } from '@/lib/task-authz'
import { workflowEventCompleteBody as completeSchema } from '@/lib/api-schemas/workflows'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'workflows.activate')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth
  const { id: eventId } = await params

  let body
  try {
    body = completeSchema.parse(await request.json())
  } catch (e) {
    const zodError = e as z.ZodError
    return err(`Validation failed: ${zodError.issues.map(i => i.message).join(', ')}`)
  }

  // Find paused run by event_id, scoped to tenant
  const { data: run } = await supabase
    .from('workflow_runs')
    .select('id, workflow_id, status')
    .eq('event_id', eventId)
    .eq('tenant_id', tenantId)
    .in('status', ['waiting_for_event', 'paused'])
    .single()

  if (!run) {
    return err('No waiting workflow found for this event_id. It may have already been completed or cancelled.', 404)
  }

  // A user task's event completes through the task (assignee rule).
  const userTaskId = await findOpenWorkflowTaskForEvent(supabase, tenantId, eventId)
  if (userTaskId) return err(USER_TASK_EVENT_MESSAGE, 409)

  try {
    const result = await resumeWorkflow(run.id, body.return_variables ?? {})
    return ok({
      run_id: run.id,
      workflow_id: run.workflow_id,
      status: result.status,
      variables_received: Object.keys(body.return_variables ?? {}),
    })
  } catch (e: any) {
    return err(`Failed to resume workflow: ${e.message}`, 500)
  }
}
