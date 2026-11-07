import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { fromSession, isServiceError, ServiceError } from '@/lib/services/context'
import { queryDataTable } from '@/lib/services/form-data-table'

/**
 * Rows of a Data table field for the signed-in user's form: a task's form,
 * a reusable form's page (/f/<id>, start form pages), or the designer's live
 * preview (the unsaved field; edit rights needed). Session cookie auth, JSON
 * only (no cross-site form posts). The source, columns, base filter and
 * limits come from the saved form — lib/services/form-data-table.ts.
 */

const Body = z.object({
  task_id: z.string().uuid().optional(),
  form_id: z.string().uuid().optional(),
  field_key: z.string().min(1).max(64).optional(),
  /** Designer preview: the (unsaved) field definition. */
  field: z.record(z.string(), z.unknown()).optional(),
  query: z.record(z.string(), z.unknown()).optional(),
  values: z.record(z.string(), z.unknown()).optional(),
})

const NO_STORE = { 'Cache-Control': 'no-store' }

function fail(error: unknown) {
  if (isServiceError(error)) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
  }
  console.error('[forms.dataTable]', error)
  return NextResponse.json({ error: 'The table is not available right now' }, { status: 500, headers: NO_STORE })
}

export async function POST(request: NextRequest) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Expected application/json' }, { status: 415, headers: NO_STORE })
  }
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE })
  const body = parsed.data
  try {
    if (body.task_id) {
      if (!body.field_key) throw ServiceError.validation('field_key is required')
      // The task's workspace (RLS: only tasks the user can see), then act there.
      const session = await fromSession()
      const { data: task } = await session.supabase.from('tasks').select('tenant_id').eq('id', body.task_id).maybeSingle()
      if (!task) throw ServiceError.notFound('Task not found')
      const ctx = await fromSession({ tenantId: String((task as { tenant_id: string }).tenant_id) })
      return NextResponse.json(await queryDataTable(ctx, { task_id: body.task_id }, body), { headers: NO_STORE })
    }
    if (body.form_id) {
      if (!body.field_key) throw ServiceError.validation('field_key is required')
      return NextResponse.json(await queryDataTable(await fromSession(), { form_id: body.form_id }, body), { headers: NO_STORE })
    }
    if (!body.field) throw ServiceError.validation('task_id, form_id or field is required')
    return NextResponse.json(await queryDataTable(await fromSession(), { preview_field: body.field }, body), { headers: NO_STORE })
  } catch (error) {
    return fail(error)
  }
}
