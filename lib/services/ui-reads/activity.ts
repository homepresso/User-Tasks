import { z } from 'zod'
import { getDb } from '../context'
import { defineRead, id, type UiRead } from './define'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows as the browser read them */

/** Activity: the unified trace viewer (everything that shared a trace id). */

export const reads = {
  /** Workflow runs, agent runs and integration calls sharing a trace id. */
  'activity.trace': defineRead({
    args: z.object({ traceId: id }),
    // /activity is gated on settings.view; observability.view reads the same events.
    perm: ['settings.view', 'observability.view'],
    run: async (ctx, { traceId }) => {
      const db = getDb(ctx) as any
      const [workflowRuns, agentRuns, integrationCalls] = await Promise.all([
        db.from('workflow_runs')
          .select('id, status, error, started_at, completed_at, workflow:workflows(id, name)')
          .eq('trace_id', traceId),
        db.from('agent_runs')
          .select('id, agent_id, status, error, started_at, completed_at, duration_ms, total_tokens, agent:agents(id, name)')
          .eq('trace_id', traceId),
        db.from('integration_call_logs')
          .select('id, integration_id, method, url, response_status, error, started_at, completed_at, duration_ms, integration:integrations(id, name)')
          .eq('trace_id', traceId),
      ])
      return {
        workflowRuns: (workflowRuns.data ?? []) as any[],
        agentRuns: (agentRuns.data ?? []) as any[],
        integrationCalls: (integrationCalls.data ?? []) as any[],
      }
    },
  }),
} satisfies Record<string, UiRead<any, any>>
