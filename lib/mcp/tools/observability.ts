import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import { EVENT_CATEGORIES, EVENT_SEVERITIES, EVENTS_MAX_LIMIT, listEvents, splitList } from '@/lib/services/events'

/**
 * Observability MCP tools — read-only access to the Phase 1 instrumentation
 * tables so MCP clients (Claude, external integrations) can query the
 * platform's call graph, audit trail, and execution history.
 *
 * All tools are read-only. Audit data must not be mutated through the API.
 */
export function registerObservabilityTools(server: McpToolServer, ctx: McpContext) {
  const { tenantId, supabase } = ctx

  // ─── Unified event stream ────────────────────────────────────────────

  server.tool(
    'events_list',
    'Read the unified event stream: workflow runs and step logs, integration calls, agent runs, task lifecycle, system jobs, and (with settings.view) audit and security events. Oldest first; pass next_cursor back as `after` to page or to poll for new events. Use `since` (e.g. "15m", "1h" or an ISO time) to start from a recent point. Attributes are allow-listed: no request/response bodies, headers, prompts or credentials. Events are retained for 72 hours by default.',
    {
      category: z.union([z.enum(EVENT_CATEGORIES), z.array(z.enum(EVENT_CATEGORIES))]).optional().describe(`Only these categories: ${EVENT_CATEGORIES.join(', ')}`),
      type: z.union([z.string(), z.array(z.string())]).optional().describe('Event types or globs, e.g. "workflow.run.*", "*.failed", "integration.call"'),
      severity: z.enum(EVENT_SEVERITIES).optional().describe('Minimum severity'),
      workflow_id: z.string().optional().describe('Only events of this workflow'),
      run_id: z.string().optional().describe('Only events of this workflow run'),
      task_id: z.string().optional().describe('Only events of this task'),
      trace_id: z.string().optional().describe('Only events with this trace id'),
      after: z.string().optional().describe('Cursor: the next_cursor of the previous call'),
      since: z.string().optional().describe('ISO timestamp or duration back from now (30s, 15m, 1h, 2d)'),
      until: z.string().optional().describe('ISO timestamp or duration: events at or before'),
      limit: z.number().optional().describe(`Max events, default 100, max ${EVENTS_MAX_LIMIT}`),
    },
    async (args) => {
      try {
        return mcpOk(await listEvents(fromMcpContext(ctx), {
          categories: splitList(args.category),
          types: splitList(args.type),
          min_severity: args.severity,
          workflow_id: args.workflow_id,
          run_id: args.run_id,
          task_id: args.task_id,
          trace_id: args.trace_id,
          after: args.after,
          since: args.since,
          until: args.until,
          limit: args.limit,
        }))
      } catch (error) {
        return mcpErr(error instanceof Error ? error.message : 'Failed to read events')
      }
    }
  )

  // ─── Integration call logs ───────────────────────────────────────────

  server.tool(
    'integration_calls_list',
    'List outbound integration API calls captured by the reference executor. Returns method, URL, status, duration, caller context, and error. Sensitive headers and query params are redacted. Filter by integration, reference, caller type, status code range, date range.',
    {
      integration_id: z.string().optional().describe('Filter by integration id'),
      reference_id: z.string().optional().describe('Filter by integration reference id'),
      caller_type: z.string().optional().describe('Filter by caller type: workflow_node, mcp, manual_test, agent_tool, api, cron'),
      caller_id: z.string().optional().describe('Filter by caller id (workflow_run_id, agent_run_id, etc.)'),
      min_status: z.number().optional().describe('Minimum HTTP status code (inclusive)'),
      max_status: z.number().optional().describe('Maximum HTTP status code (inclusive)'),
      only_errors: z.boolean().optional().describe('If true, return only failed calls (4xx/5xx or error message present)'),
      from: z.string().optional().describe('ISO timestamp — only calls started at or after this time'),
      to: z.string().optional().describe('ISO timestamp — only calls started at or before this time'),
      limit: z.number().optional().describe('Max results, default 50, max 500'),
    },
    async (args) => {
      const limit = Math.min(args.limit ?? 50, 500)
      let query = (supabase as any).from('integration_call_logs')
        .select('id, integration_id, reference_id, method, url, response_status, duration_ms, caller_type, caller_id, caller_node_id, trace_id, error, started_at, completed_at, integration:integrations(id, name), reference:integration_references(id, name)')
        .eq('tenant_id', tenantId)
        .order('started_at', { ascending: false })
        .limit(limit)

      if (args.integration_id) query = query.eq('integration_id', args.integration_id)
      if (args.reference_id) query = query.eq('reference_id', args.reference_id)
      if (args.caller_type) query = query.eq('caller_type', args.caller_type)
      if (args.caller_id) query = query.eq('caller_id', args.caller_id)
      if (args.min_status != null) query = query.gte('response_status', args.min_status)
      if (args.max_status != null) query = query.lte('response_status', args.max_status)
      if (args.only_errors) query = query.or('response_status.gte.400,error.not.is.null')
      if (args.from) query = query.gte('started_at', args.from)
      if (args.to) query = query.lte('started_at', args.to)

      const { data, error } = await query
      if (error) return mcpErr(error.message)
      return mcpOk({ calls: data ?? [], count: data?.length ?? 0 })
    }
  )

  server.tool(
    'integration_calls_get',
    'Get a single integration call log with the full request body, response body, and headers (sensitive values redacted). Use this for detailed debugging of a specific outbound integration call.',
    {
      call_id: z.string().describe('Integration call log id'),
    },
    async (args) => {
      const { data, error } = await (supabase as any).from('integration_call_logs')
        .select('*, integration:integrations(id, name), reference:integration_references(id, name)')
        .eq('id', args.call_id)
        .eq('tenant_id', tenantId)
        .single()
      if (error || !data) return mcpErr('Call not found')
      return mcpOk(data)
    }
  )

  // ─── Agent runs ──────────────────────────────────────────────────────

  server.tool(
    'agent_runs_list',
    'List agent execution runs. Returns agent, status, model, iterations, token usage, duration, caller context. Use this to audit what agents have been doing, their cost, and their success rate.',
    {
      agent_id: z.string().optional().describe('Filter by agent id'),
      caller_type: z.string().optional().describe('Filter by caller type: workflow_node, manual, queue, mcp, api'),
      caller_id: z.string().optional().describe('Filter by caller id (workflow_run_id, etc.)'),
      status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional().describe('Filter by run status'),
      from: z.string().optional().describe('ISO timestamp — only runs started at or after'),
      to: z.string().optional().describe('ISO timestamp — only runs started at or before'),
      limit: z.number().optional().describe('Max results, default 50, max 500'),
    },
    async (args) => {
      const limit = Math.min(args.limit ?? 50, 500)
      let query = (supabase as any).from('agent_runs')
        .select('id, agent_id, status, model, iterations, total_tokens, input_tokens, output_tokens, duration_ms, caller_type, caller_id, trace_id, error, started_at, completed_at, created_at, agent:agents(id, name)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (args.agent_id) query = query.eq('agent_id', args.agent_id)
      if (args.caller_type) query = query.eq('caller_type', args.caller_type)
      if (args.caller_id) query = query.eq('caller_id', args.caller_id)
      if (args.status) query = query.eq('status', args.status)
      if (args.from) query = query.gte('started_at', args.from)
      if (args.to) query = query.lte('started_at', args.to)

      const { data, error } = await query
      if (error) return mcpErr(error.message)
      return mcpOk({ runs: data ?? [], count: data?.length ?? 0 })
    }
  )

  server.tool(
    'agent_runs_get',
    'Get a single agent run with the full conversation (input message, output response), tool_calls array, and token breakdown. Use this for detailed audit of a specific execution.',
    {
      run_id: z.string().describe('Agent run id'),
    },
    async (args) => {
      const { data, error } = await (supabase as any).from('agent_runs')
        .select('*, agent:agents(id, name, model)')
        .eq('id', args.run_id)
        .eq('tenant_id', tenantId)
        .single()
      if (error || !data) return mcpErr('Run not found')
      return mcpOk(data)
    }
  )

  // ─── Object audit log ────────────────────────────────────────────────

  server.tool(
    'object_audit_log_query',
    'Query the unified object audit log — every create, update, delete, publish, toggle, and configuration change across the platform. This is the authoritative source for who changed what and when.',
    {
      object_type: z.string().optional().describe('Filter by entity type: workflow, agent, integration, report, data_table, team, role, api_key, mcp_server'),
      object_id: z.string().optional().describe('Filter by specific entity id'),
      actor_id: z.string().optional().describe('Filter by user id who performed the action'),
      action: z.string().optional().describe('Filter by action: create, update, delete, publish, unpublish, toggle, execute, grant, revoke, rename, duplicate, share, unshare'),
      from: z.string().optional().describe('ISO timestamp — only events at or after'),
      to: z.string().optional().describe('ISO timestamp — only events at or before'),
      limit: z.number().optional().describe('Max results, default 100, max 500'),
    },
    async (args) => {
      const limit = Math.min(args.limit ?? 100, 500)
      let query = (supabase as any).from('object_audit_log')
        .select('id, object_type, object_id, action, summary, diff, metadata, created_at, actor:users!object_audit_log_actor_id_fkey(id, display_name, email)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (args.object_type) query = query.eq('object_type', args.object_type)
      if (args.object_id) query = query.eq('object_id', args.object_id)
      if (args.actor_id) query = query.eq('actor_id', args.actor_id)
      if (args.action) query = query.eq('action', args.action)
      if (args.from) query = query.gte('created_at', args.from)
      if (args.to) query = query.lte('created_at', args.to)

      const { data, error } = await query
      if (error) return mcpErr(error.message)
      return mcpOk({ events: data ?? [], count: data?.length ?? 0 })
    }
  )

  // ─── Unified trace ───────────────────────────────────────────────────

  server.tool(
    'trace_get',
    'Get all entities that share a single trace_id — the full call graph for a workflow execution. Returns workflow runs, agent runs, and integration calls sorted chronologically. Use to debug a full request flow end-to-end.',
    {
      trace_id: z.string().describe('The trace id to stitch together'),
    },
    async (args) => {
      const [workflowRuns, agentRuns, integrationCalls] = await Promise.all([
        (supabase as any).from('workflow_runs')
          .select('id, status, error, started_at, completed_at, workflow:workflows(id, name)')
          .eq('tenant_id', tenantId)
          .eq('trace_id', args.trace_id),
        (supabase as any).from('agent_runs')
          .select('id, agent_id, status, error, started_at, completed_at, duration_ms, total_tokens, agent:agents(id, name)')
          .eq('tenant_id', tenantId)
          .eq('trace_id', args.trace_id),
        (supabase as any).from('integration_call_logs')
          .select('id, integration_id, reference_id, method, url, response_status, error, started_at, completed_at, duration_ms, integration:integrations(id, name)')
          .eq('tenant_id', tenantId)
          .eq('trace_id', args.trace_id),
      ])

      const events: any[] = []
      for (const run of workflowRuns.data ?? []) events.push({ type: 'workflow_run', ...run, _sort: new Date(run.started_at).getTime() })
      for (const run of agentRuns.data ?? []) events.push({ type: 'agent_run', ...run, _sort: new Date(run.started_at).getTime() })
      for (const call of integrationCalls.data ?? []) events.push({ type: 'integration_call', ...call, _sort: new Date(call.started_at).getTime() })

      events.sort((a, b) => a._sort - b._sort)
      events.forEach(e => delete e._sort)

      return mcpOk({
        trace_id: args.trace_id,
        event_count: events.length,
        events,
      })
    }
  )
}
