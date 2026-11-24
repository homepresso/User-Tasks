import { NextRequest, NextResponse } from "next/server"
import type { NodeEvent } from "@/lib/workflow-engine"
import { resumeRun, startRun } from "@/lib/processing/dispatch"
import {
  authorizeTestRunResume,
  authorizeWorkflowExecute,
  authzErrorResponse,
} from "@/lib/services/workflow-designer-runs"
import { isServiceError } from "@/lib/services/context"

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * The designer's Test runner: start a test run of a workflow (workflows.edit
 * in its workspace), or resume the caller's own paused test run. Production
 * runs never resume here (lib/services/workflow-designer-runs).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const { workflow_id, resume_event_id, form_submission, form_drafts } = (body ?? {}) as Record<string, any>
  let variables = (body as { variables?: Record<string, unknown> } | null)?.variables

  // Authorise before anything runs: 401 signed out, 404 not in the caller's
  // workspace, 403 lacking workflows.edit / not their own test run.
  let workflowId: string
  let resumeRunId: string | null = null
  let resumeEventId: string | undefined
  let actorId: string | null
  let tenantId: string
  // "Use form drafts" (Test runner toggle): linked forms' working drafts, for testers who can edit forms.
  let testFormDrafts = false
  let preLogs: Array<{ level: string; message: string; metadata?: Record<string, unknown> }> = []
  try {
    if (resume_event_id) {
      const authorized = await authorizeTestRunResume({ resumeKey: resume_event_id, workflowId: workflow_id })
      workflowId = authorized.workflow.id
      resumeRunId = authorized.run.id
      resumeEventId = authorized.run.event_id ?? undefined
      actorId = authorized.ctx.actorId
      tenantId = authorized.run.tenant_id
      // Attachments in the test task's values: only the tester's own uploads, as the server recorded them.
      const taskData = variables?.task_data
      if (taskData && typeof taskData === 'object' && !Array.isArray(taskData)) {
        const [{ sanitizeTestTaskFiles }, { createServiceClient }] = await Promise.all([import('@/lib/services/form-files'), import('@/lib/cron-auth')])
        variables = { ...variables, task_data: await sanitizeTestTaskFiles(createServiceClient(), authorized.ctx.tenantId, actorId, taskData as Record<string, unknown>) }
      }
    } else if (workflow_id) {
      const authorized = await authorizeWorkflowExecute({ workflowId: workflow_id, test: true })
      workflowId = authorized.workflow.id
      actorId = authorized.ctx.actorId
      tenantId = authorized.workflow.tenant_id
      if (form_drafts === true) {
        const { hasPerm } = await import('@/lib/services/context')
        testFormDrafts = hasPerm(authorized.ctx, 'forms.edit')
      }
      // A workflow that starts from a form never test-runs before that form
      // is submitted: a "Form submitted" trigger needs a test submission
      // (server-built payload), a start form values that pass its checks.
      const { prepareTestStart } = await import('@/lib/services/workflow-start-form')
      const prepared = await prepareTestStart(authorized.ctx, workflowId, { variables, form_submission })
      variables = prepared.variables
      preLogs = prepared.logs
      if (testFormDrafts) preLogs = [...preLogs, { level: 'info', message: 'Using form drafts: User Task steps that link a reusable form use its unpublished draft, when it has one.' }]
    } else {
      return NextResponse.json({ error: 'workflow_id or resume_event_id required' }, { status: 400 })
    }
  } catch (error) {
    if (isServiceError(error) && error.code === 'validation_error') {
      const details = error.details as { fields?: Record<string, string>; needs_form_input?: boolean } | undefined
      return NextResponse.json({ error: error.message, ...(details?.fields ? { fields: details.fields } : {}), ...(details?.needs_form_input ? { needs_form_input: true } : {}) }, { status: 422 })
    }
    const { status, body: errorBody } = authzErrorResponse(error)
    return NextResponse.json(errorBody, { status })
  }
  // Designer test runs are started by the signed-in user (workflow_started_by).
  const initiator = { userId: actorId, via: 'test' as const }
  // Resume exactly the paused state that was checked (run id + its event).
  // Test runs run here, or — with separate processing workers and "Run test
  // runs on workers" — on a worker, its events relayed back to this stream
  // (lib/processing/dispatch).
  const runTest = (onEvent: (event: NodeEvent) => void) => resumeRunId
    ? resumeRun({
        runId: resumeRunId,
        tenantId,
        workflowId,
        test: true,
        onEvent,
        ...(resumeEventId ? { eventId: resumeEventId } : {}),
        variables: {
          outcome: variables?.outcome ?? 'completed',
          outcome_notes: variables?.outcome_notes ?? '',
          ...(variables ?? {}),
        },
      })
    : startRun({
        workflowId,
        tenantId,
        test: true,
        onEvent,
        variables: variables ?? undefined,
        initiator,
        ...(testFormDrafts ? { testFormDrafts } : {}),
      })

  // Check if client accepts SSE
  const acceptsSSE = request.headers.get('accept')?.includes('text/event-stream')

  // The engine emits its own `done` event; this route sends exactly ONE
  // `done` at the end (the engine's data + the result with the run id), so
  // the Test runner never handles a finish twice (it logged "Workflow
  // paused" once per `done`). The engine's `done` data is kept to merge.
  let engineDone: Record<string, unknown> = {}
  function withoutDone(forward: (event: NodeEvent) => void) {
    return (event: NodeEvent) => {
      if (event.type === 'done') { engineDone = { ...((event as { data?: Record<string, unknown> }).data ?? {}) }; return }
      forward(event)
    }
  }

  // Collect events for non-streaming fallback
  const events: NodeEvent[] = preLogs.map((data) => ({ type: 'log', data }) as NodeEvent)
  const collectEvent = withoutDone((event) => { events.push(event) })

  if (acceptsSSE) {
    // Streaming mode — send events as SSE
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: NodeEvent) {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch {}
        }
        const engineSend = withoutDone(send)

        for (const data of preLogs) send({ type: 'log', data } as NodeEvent)
        try {
          const result = await runTest(engineSend)
          send({ type: 'done', data: { ...engineDone, ...result, run_id: result.run_id } } as NodeEvent)
        } catch (error: any) {
          send({ type: 'log', data: { level: 'error', message: `Resume/execute failed: ${error.message}` } })
          send({ type: 'done', data: { status: 'failed', error: error.message } })
        }

        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Defeat proxy/CDN response buffering so node events reach the
        // test runner as they happen instead of arriving in one batch.
        "X-Accel-Buffering": "no",
      },
    })
  }

  // Non-streaming fallback — collect all events and return as JSON
  try {
    const result: any = await runTest(collectEvent)
    return NextResponse.json({ events, result: { ...engineDone, ...result, run_id: result?.run_id } })
  } catch (error: any) {
    return NextResponse.json({
      events: [...events, { type: 'log', data: { level: 'error', message: `Resume/execute failed: ${error.message}` } }],
      result: { status: 'failed', error: error.message },
    })
  }
}
