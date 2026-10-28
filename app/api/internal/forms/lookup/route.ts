import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { fromSession, isServiceError, ServiceError } from '@/lib/services/context'
import { lookupFormField, lookupTaskField, previewLookup } from '@/lib/services/form-lookup'

/**
 * Autocomplete / lookup suggestions for the signed-in user's task form (or
 * the form designer's preview). Session cookie auth, JSON only (no
 * cross-site form posts). The task variant acts in the task's own workspace
 * (the unified view spans several); everything else — authorisation by the
 * task, config from the stored form, limits — is lib/services/form-lookup.
 */

const Body = z.object({
  task_id: z.string().uuid().optional(),
  /** A reusable form's own page (/f/<id>). */
  form_id: z.string().uuid().optional(),
  field_key: z.string().min(1).max(64).optional(),
  /** Designer preview: the (unsaved) field definition. */
  field: z.record(z.string(), z.unknown()).optional(),
  query: z.string().max(500).optional(),
  values: z.record(z.string(), z.unknown()).optional(),
})

const NO_STORE = { 'Cache-Control': 'no-store' }

function fail(error: unknown) {
  if (isServiceError(error)) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
  }
  console.error('[forms.lookup]', error)
  return NextResponse.json({ error: 'The lookup is not available right now' }, { status: 500, headers: NO_STORE })
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
      // Find the task's workspace (RLS: only tasks the user can see), then act there.
      const session = await fromSession()
      const { data: task } = await session.supabase.from('tasks').select('tenant_id').eq('id', body.task_id).maybeSingle()
      if (!task) throw ServiceError.notFound('Task not found')
      const ctx = await fromSession({ tenantId: String((task as { tenant_id: string }).tenant_id) })
      const result = await lookupTaskField(ctx, body.task_id, { field_key: body.field_key, query: body.query, values: body.values })
      return NextResponse.json(result, { headers: NO_STORE })
    }
    if (body.form_id) {
      if (!body.field_key) throw ServiceError.validation('field_key is required')
      const ctx = await fromSession()
      const result = await lookupFormField(ctx, body.form_id, { field_key: body.field_key, query: body.query, values: body.values })
      return NextResponse.json(result, { headers: NO_STORE })
    }
    if (!body.field) throw ServiceError.validation('task_id, form_id or field is required')
    const ctx = await fromSession()
    const result = await previewLookup(ctx, { field: body.field, query: body.query, values: body.values })
    return NextResponse.json(result, { headers: NO_STORE })
  } catch (error) {
    return fail(error)
  }
}
