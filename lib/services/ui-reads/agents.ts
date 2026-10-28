import { z } from 'zod'
import { getDb } from '../context'
import { check, defineRead, id, NO_ARGS, type UiRead } from './define'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows as the browser read them */

/** AI agents: list, designer (agent + its pickers), runs list/stats/detail. */

const RUNS_PAGE_SIZE = 25

export const reads = {
  'agents.list': defineRead({
    args: NO_ARGS,
    perm: 'agents.view',
    run: async (ctx) => check(await (getDb(ctx) as any).from('agents')
      .select('*, integration:integrations(id, name, type)')
      .order('updated_at', { ascending: false })) ?? [],
  }),

  'agents.get': defineRead({
    args: z.object({ id }),
    perm: 'agents.view',
    run: async (ctx, { id }) => {
      const { data } = await (getDb(ctx) as any).from('agents').select('*').eq('id', id).maybeSingle()
      return data
    },
  }),

  'agents.meta': defineRead({
    args: z.object({ id }),
    perm: 'agents.view',
    run: async (ctx, { id }) => {
      const { data } = await (getDb(ctx) as any).from('agents').select('id, name, model').eq('id', id).maybeSingle()
      return data as { id: string; name: string; model: string | null } | null
    },
  }),

  /** Pickers the agent designer offers (integrations, references, data tables, workflows, teams). */
  'agents.designerOptions': defineRead({
    args: NO_ARGS,
    perm: 'agents.view',
    run: async (ctx) => {
      const db = getDb(ctx) as any
      const [integrations, references, dataTables, workflows, teams] = await Promise.all([
        db.from('integrations').select('id, name, type, config').eq('is_active', true).order('name'),
        // integration_references has no `method` column — it lives in request_config.
        db.from('integration_references').select('id, name, description, request_config, integration:integrations(id, name)').order('name'),
        db.from('custom_tables').select('id, name, description, created_at, updated_at').order('updated_at', { ascending: false }),
        db.from('workflows').select('id, name, description, trigger_type, is_active, created_at, updated_at').order('updated_at', { ascending: false }),
        db.from('teams').select('id, name, description, created_at, updated_at').order('updated_at', { ascending: false }),
      ])
      return {
        integrations: (integrations.data ?? []) as any[],
        references: ((references.data ?? []) as Array<{ request_config?: { method?: string } | null }>)
          .map((r) => ({ ...r, method: r.request_config?.method ?? 'GET' })) as any[],
        dataTables: (dataTables.data ?? []) as any[],
        workflows: (workflows.data ?? []) as any[],
        teams: (teams.data ?? []) as any[],
      }
    },
  }),

  'agents.runs': defineRead({
    args: z.object({ agentId: id, status: z.string().max(50).optional(), page: z.number().int().min(0).max(10_000) }),
    perm: 'agents.view',
    run: async (ctx, { agentId, status, page }) => {
      let query = (getDb(ctx) as any).from('agent_runs')
        .select('id, status, model, input_message, iterations, total_tokens, duration_ms, caller_type, started_at, created_at, error', { count: 'exact' })
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .range(page * RUNS_PAGE_SIZE, page * RUNS_PAGE_SIZE + RUNS_PAGE_SIZE - 1)
      if (status) query = query.eq('status', status)
      const { data, count } = await query
      return { rows: (data ?? []) as any[], total: (count ?? 0) as number }
    },
  }),

  /** Quick stats over the agent's latest 1000 runs (computed here, not in the browser). */
  'agents.runStats': defineRead({
    args: z.object({ agentId: id }),
    perm: 'agents.view',
    run: async (ctx, { agentId }) => {
      const { data } = await (getDb(ctx) as any).from('agent_runs')
        .select('status, total_tokens, duration_ms')
        .eq('agent_id', agentId)
        .limit(1000)
      const rows = (data ?? []) as Array<{ status: string; total_tokens: number | null; duration_ms: number | null }>
      return {
        total: rows.length,
        completed: rows.filter((r) => r.status === 'completed').length,
        failed: rows.filter((r) => r.status === 'failed').length,
        totalTokens: rows.reduce((s, r) => s + (r.total_tokens ?? 0), 0),
        avgDuration: rows.length > 0 ? Math.round(rows.reduce((s, r) => s + (r.duration_ms ?? 0), 0) / rows.length) : 0,
      }
    },
  }),

  'agents.run': defineRead({
    args: z.object({ agentId: id, runId: id }),
    perm: 'agents.view',
    run: async (ctx, { agentId, runId }) => {
      const db = getDb(ctx) as any
      const [{ data: run }, { data: agent }] = await Promise.all([
        db.from('agent_runs').select('*').eq('id', runId).maybeSingle(),
        db.from('agents').select('id, name, model').eq('id', agentId).maybeSingle(),
      ])
      return { run: run as any, agent: agent as any }
    },
  }),

  /** The workflow run that called an agent (run detail → Related). */
  'agents.parentWorkflowRun': defineRead({
    args: z.object({ runId: id }),
    perm: 'agents.view',
    run: async (ctx, { runId }) => {
      const { data } = await (getDb(ctx) as any).from('workflow_runs')
        .select('id, workflow:workflows(id, name), status')
        .eq('id', runId)
        .maybeSingle()
      return data as any
    },
  }),

  /** Integration calls made during an agent run (by trace id). */
  'agents.runIntegrationCalls': defineRead({
    args: z.object({ traceId: id }),
    perm: 'agents.view',
    run: async (ctx, { traceId }) => {
      const { data } = await (getDb(ctx) as any).from('integration_call_logs')
        .select('id, integration_id, reference_id, method, url, response_status, duration_ms, started_at')
        .eq('trace_id', traceId)
        .order('started_at', { ascending: true })
      return (data ?? []) as any[]
    },
  }),
} satisfies Record<string, UiRead<any, any>>
