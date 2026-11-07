import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err } from '@/lib/api-auth'
import { canAccessWorkflow } from '@/lib/api-key-permissions'
import { fromApiAuth } from '@/lib/services/context'
import { resolveRunScope, runInScope } from '@/lib/services/run-visibility'
import { loadRunTasksForRun } from '@/lib/services/run-tasks'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'workflows.view_queue')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth
  const { id } = await params

  const { data: run, error } = await supabase
    .from('workflow_runs')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single()

  if (error || !run) return err('Run not found', 404)
  if (!canAccessWorkflow(auth, run.workflow_id)) return err('This API key is not allowed to access that workflow', 403)
  const ctx = fromApiAuth(auth)
  if (!runInScope(await resolveRunScope(ctx), run)) return err('Run not found', 404)

  // Its User Tasks, with the caller's per-task access (lib/run-tasks.ts).
  const [{ data: logs }, tasks] = await Promise.all([supabase
    .from('workflow_logs')
    .select('*')
    .eq('run_id', id)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true }), loadRunTasksForRun(ctx, run)])

  return ok({ run, logs: logs ?? [], tasks })
}
