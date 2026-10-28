import { NextRequest, NextResponse } from 'next/server'
import { validateApiKey, requireApiPermission } from '@/lib/api-auth'
import { z } from 'zod'
import { taskIngestBody as ingestSchema } from '@/lib/api-schemas/tasks'
import { sanitizeTaskDescription } from '@/lib/html-sanitize'
import { claimIdempotencyKey, idempotencyClaimKey, releaseIdempotencyKey, waitForIdempotentResult } from '@/lib/idempotency'

export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'tasks.create')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth

  // Also fetch workflow_source for the key
  const { data: keyWithSource } = await supabase
    .from('api_keys')
    .select('workflow_source_id')
    .eq('id', auth.keyId)
    .single()

  // Parse and validate body
  let body
  try {
    body = ingestSchema.parse(await request.json())
  } catch (e) {
    const zodError = e as z.ZodError
    return NextResponse.json({ error: 'Validation failed', details: zodError.issues }, { status: 400 })
  }

  // Idempotency check. The claim stops two concurrent requests with the
  // same key (on any replica, with a shared cache store) from both creating.
  let claim: string | null = null
  if (body.idempotency_key) {
    const idempotencyKey = body.idempotency_key
    const findExisting = async () => {
      const { data } = await supabase
        .from('tasks')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('metadata->>idempotency_key', idempotencyKey)
        .limit(1)
        .maybeSingle()
      return data as { id: string } | null
    }
    const existing = await findExisting()
    if (existing) {
      return NextResponse.json({ task_id: existing.id, deduplicated: true })
    }
    claim = idempotencyClaimKey('task-ingest', String(tenantId), idempotencyKey)
    if (!(await claimIdempotencyKey(claim))) {
      const created = await waitForIdempotentResult(findExisting)
      if (created) return NextResponse.json({ task_id: created.id, deduplicated: true })
      return NextResponse.json({ error: 'A request with this idempotency_key is still being processed; retry shortly' }, { status: 409 })
    }
  }

  // Resolve assignee email to user_id
  let assigneeId = null
  if (body.assignee_email) {
    const { data: assignee } = await supabase
      .from('users')
      .select('id')
      .eq('email', body.assignee_email)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    assigneeId = assignee?.id ?? null
  }

  // Handle workflow source
  let workflowSourceId = (keyWithSource as any)?.workflow_source_id ?? null
  if (body.workflow && !workflowSourceId) {
    // Create or find workflow source
    const { data: ws } = await supabase
      .from('workflow_sources')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('engine_type', body.workflow.engine_type ?? 'manual')
      .eq('instance_id', body.workflow.instance_id ?? '')
      .maybeSingle()

    if (ws) {
      workflowSourceId = ws.id
    } else if (body.workflow.engine_type) {
      const { data: newWs } = await supabase.from('workflow_sources').insert({
        tenant_id: tenantId,
        engine_type: body.workflow.engine_type,
        display_name: body.workflow.engine_type,
        instance_id: body.workflow.instance_id ?? null,
        callback_url: body.workflow.callback_url ?? null,
      }).select('id').single()
      workflowSourceId = newWs?.id
    }
  }

  // Create root task
  const { data: task, error: taskError } = await supabase.from('tasks').insert({
    tenant_id: tenantId,
    title: body.title,
    description: sanitizeTaskDescription(body.description ?? null),
    priority: body.priority,
    due_date: body.due_date ?? null,
    assignee_id: assigneeId,
    estimated_effort_assigner: body.estimated_effort ?? null,
    workflow_source_id: workflowSourceId,
    workflow_step_id: body.workflow?.step_id ?? null,
    workflow_position: body.workflow?.position ?? null,
    metadata: body.idempotency_key ? { idempotency_key: body.idempotency_key } : {},
  }).select('id').single()

  if (taskError) {
    if (claim) await releaseIdempotencyKey(claim)
    return NextResponse.json({ error: taskError.message }, { status: 500 })
  }

  // Create subtasks
  if (body.subtasks.length > 0) {
    const subtasks = body.subtasks.map((st, i) => ({
      tenant_id: tenantId,
      parent_task_id: task.id,
      title: st.title,
      description: sanitizeTaskDescription(st.description ?? null),
      estimated_effort_assigner: st.estimated_effort ?? null,
      sequence: st.sequence ?? i + 1,
      priority: body.priority,
    }))

    await supabase.from('tasks').insert(subtasks)
  }

  return NextResponse.json({
    task_id: task.id,
    tenant_id: tenantId,
    subtask_count: body.subtasks.length,
  }, { status: 201 })
}
