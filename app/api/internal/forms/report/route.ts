import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { fromSession, isServiceError, ServiceError } from '@/lib/services/context'
import { runControlReport } from '@/lib/services/form-control-report'

/**
 * The `report` host service of custom form controls (capability `reports`):
 * the saved report a form field names, run as the signed-in person. Session
 * cookie auth, JSON only. The report id is read from the stored form, never
 * from this request — see lib/services/form-control-report.
 */

const Body = z.object({
  task_id: z.string().uuid().optional(),
  form_id: z.string().uuid().optional(),
  field_key: z.string().min(1).max(64).optional(),
  /** Designer preview: the (unsaved) field definition. */
  field: z.record(z.string(), z.unknown()).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
})

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: NextRequest) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Expected application/json' }, { status: 415, headers: NO_STORE })
  }
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE })
  const body = parsed.data
  try {
    if ((body.task_id || body.form_id) && !body.field_key) throw ServiceError.validation('field_key is required')
    let ctx = await fromSession()
    if (body.task_id) {
      // Act in the task's own workspace (RLS: only tasks the user can see).
      const { data: task } = await ctx.supabase.from('tasks').select('tenant_id').eq('id', body.task_id).maybeSingle()
      if (!task) throw ServiceError.notFound('Task not found')
      ctx = await fromSession({ tenantId: String((task as { tenant_id: string }).tenant_id) })
    }
    const result = await runControlReport(ctx, body)
    return NextResponse.json(result, { headers: NO_STORE })
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    console.error('[forms.report]', error)
    return NextResponse.json({ error: 'The report is not available right now' }, { status: 500, headers: NO_STORE })
  }
}
