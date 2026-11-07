import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { fromSession, isServiceError, ServiceError } from '@/lib/services/context'
import { applyTableChangesFromButton } from '@/lib/services/form-table-changes'

/**
 * An in-form Button's "Apply table changes" step for the signed-in user's
 * form (a task's form or a reusable form's page). The rule — targets,
 * mappings — is read from the saved form; the request only carries which
 * button step, the form's values (the change set among them) and a key per
 * click so a retry or double click is applied once.
 * lib/services/form-table-changes.ts.
 */

const Body = z.object({
  task_id: z.string().uuid().optional(),
  form_id: z.string().uuid().optional(),
  button_key: z.string().min(1).max(64),
  action_index: z.number().int().min(0).max(20),
  /** A step inside a question's response ("If Yes → …"). */
  branch: z.object({ response: z.string().regex(/^[a-z0-9_]{1,40}$/), index: z.number().int().min(0).max(20) }).nullable().optional(),
  values: z.record(z.string(), z.unknown()).optional(),
  idempotency_key: z.string().min(8).max(100),
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
    if (body.task_id) {
      const session = await fromSession()
      const { data: task } = await session.supabase.from('tasks').select('tenant_id').eq('id', body.task_id).maybeSingle()
      if (!task) throw ServiceError.notFound('Task not found')
      const ctx = await fromSession({ tenantId: String((task as { tenant_id: string }).tenant_id) })
      return NextResponse.json(await applyTableChangesFromButton(ctx, { task_id: body.task_id }, body), { headers: NO_STORE })
    }
    if (!body.form_id) throw ServiceError.validation('task_id or form_id is required')
    return NextResponse.json(await applyTableChangesFromButton(await fromSession(), { form_id: body.form_id }, body), { headers: NO_STORE })
  } catch (error) {
    if (isServiceError(error)) {
      return NextResponse.json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) }, { status: error.status, headers: NO_STORE })
    }
    console.error('[forms.tableChanges]', error)
    return NextResponse.json({ error: 'The table changes could not be applied' }, { status: 500, headers: NO_STORE })
  }
}
