import { NextResponse } from 'next/server'
import { apiRoute } from '@/lib/api/route'
import { startWorkflowEndpoint } from '@/lib/api-schemas/workflows'
import { startWorkflow } from '@/lib/services/workflow-start'
import { isCliUserAgent } from '@/lib/workflow-initiator'

/**
 * POST /api/v1/workflows/start — start a run (sync, or async via the queue).
 * Declared inputs are validated and coerced (400 with per-field details);
 * async starts answer 202 with the queue job id.
 */
export const POST = apiRoute(startWorkflowEndpoint, async ({ ctx, body, request }) => {
  // workflow_started_via: the CLI identifies itself by its User-Agent.
  const result = await startWorkflow(ctx, body, { via: isCliUserAgent(request.headers.get('user-agent')) ? 'cli' : 'api' })
  if (result.mode === 'async') return NextResponse.json({ success: true, data: result }, { status: 202 })
  return result
})
