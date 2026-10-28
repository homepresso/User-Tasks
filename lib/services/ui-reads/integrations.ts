import { z } from 'zod'
import { getDb } from '../context'
import { defineRead, id, NO_ARGS, type UiRead } from './define'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows as the browser read them */

/** Integrations: catalog page, integration detail, call logs (list/stats/detail/related), objects panel. */

const CALLS_PAGE_SIZE = 30

export const reads = {
  'integrations.list': defineRead({
    args: NO_ARGS,
    perm: 'integrations.view',
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('integrations').select('*').order('name')
      return (data ?? []) as any[]
    },
  }),

  'integrations.references': defineRead({
    args: NO_ARGS,
    perm: 'integrations.view',
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('integration_references')
        .select('*, integration:integrations(id, name, type)')
        .order('name')
      return (data ?? []) as any[]
    },
  }),

  'integrations.connectors': defineRead({
    args: NO_ARGS,
    perm: 'integrations.view',
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('tenant_connectors').select('*').order('created_at', { ascending: false })
      return (data ?? []) as any[]
    },
  }),

  'integrations.tagDefinitions': defineRead({
    args: NO_ARGS,
    perm: 'integrations.view',
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('tag_definitions').select('id, name, color').order('name')
      return (data ?? []) as any[]
    },
  }),

  'integrations.mcpServers': defineRead({
    args: NO_ARGS,
    perm: 'integrations.view',
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('mcp_servers').select('*').order('created_at', { ascending: false })
      return (data ?? []) as any[]
    },
  }),

  'integrations.get': defineRead({
    args: z.object({ id }),
    perm: 'integrations.view',
    run: async (ctx, { id }) => {
      const { data } = await (getDb(ctx) as any).from('integrations').select('*').eq('id', id).maybeSingle()
      return data as any
    },
  }),

  /** One integration's references (detail page). */
  'integrations.referencesFor': defineRead({
    args: z.object({ integrationId: id }),
    perm: 'integrations.view',
    run: async (ctx, { integrationId }) => {
      const { data } = await (getDb(ctx) as any).from('integration_references')
        .select('*')
        .eq('integration_id', integrationId)
        .order('name')
      return (data ?? []) as any[]
    },
  }),

  'integrations.meta': defineRead({
    args: z.object({ id }),
    perm: 'integrations.view',
    run: async (ctx, { id }) => {
      const { data } = await (getDb(ctx) as any).from('integrations').select('id, name, type').eq('id', id).maybeSingle()
      return data as { id: string; name: string; type: string } | null
    },
  }),

  'integrations.calls': defineRead({
    args: z.object({
      integrationId: id,
      method: z.string().max(20).optional(),
      status: z.enum(['success', 'error']).optional(),
      page: z.number().int().min(0).max(10_000),
    }),
    perm: 'integrations.view',
    run: async (ctx, { integrationId, method, status, page }) => {
      let query = (getDb(ctx) as any).from('integration_call_logs')
        .select('id, method, url, response_status, duration_ms, caller_type, caller_id, error, started_at, reference_id', { count: 'exact' })
        .eq('integration_id', integrationId)
        .order('started_at', { ascending: false })
        .range(page * CALLS_PAGE_SIZE, page * CALLS_PAGE_SIZE + CALLS_PAGE_SIZE - 1)
      if (method) query = query.eq('method', method)
      if (status === 'success') query = query.gte('response_status', 200).lt('response_status', 400)
      if (status === 'error') query = query.or('response_status.gte.400,response_status.is.null')
      const { data, count } = await query
      return { rows: (data ?? []) as any[], total: (count ?? 0) as number }
    },
  }),

  /** Quick stats over the integration's latest 1000 calls (computed here, not in the browser). */
  'integrations.callStats': defineRead({
    args: z.object({ integrationId: id }),
    perm: 'integrations.view',
    run: async (ctx, { integrationId }) => {
      const { data } = await (getDb(ctx) as any).from('integration_call_logs')
        .select('response_status, duration_ms, error')
        .eq('integration_id', integrationId)
        .limit(1000)
      const rows = (data ?? []) as Array<{ response_status: number | null; duration_ms: number | null; error: string | null }>
      return {
        total: rows.length,
        success: rows.filter((r) => r.response_status && r.response_status < 400).length,
        errors: rows.filter((r) => !r.response_status || r.response_status >= 400 || r.error).length,
        avgDuration: rows.length > 0 ? Math.round(rows.reduce((s, r) => s + (r.duration_ms ?? 0), 0) / rows.length) : 0,
      }
    },
  }),

  /** A call log with its integration and (when set) its reference. */
  'integrations.call': defineRead({
    args: z.object({ integrationId: id, callId: id }),
    perm: 'integrations.view',
    run: async (ctx, { integrationId, callId }) => {
      const db = getDb(ctx) as any
      const [{ data: call }, { data: integration }] = await Promise.all([
        db.from('integration_call_logs').select('*').eq('id', callId).maybeSingle(),
        db.from('integrations').select('id, name, type').eq('id', integrationId).maybeSingle(),
      ])
      let reference: any = null
      if (call?.reference_id) {
        const { data } = await db.from('integration_references')
          .select('id, name, description')
          .eq('id', call.reference_id)
          .maybeSingle()
        reference = data
      }
      return { call: call as any, integration: integration as any, reference }
    },
  }),

  /** The workflow run that made a call (call detail → Related). */
  'integrations.callWorkflowRun': defineRead({
    args: z.object({ runId: id }),
    perm: 'integrations.view',
    run: async (ctx, { runId }) => {
      const { data } = await (getDb(ctx) as any).from('workflow_runs')
        .select('id, workflow:workflows(id, name), status')
        .eq('id', runId)
        .maybeSingle()
      return data as any
    },
  }),

  /** Other calls in the same trace (call detail → Related). */
  'integrations.callTraceSiblings': defineRead({
    args: z.object({ traceId: id, callId: id }),
    perm: 'integrations.view',
    run: async (ctx, { traceId, callId }) => {
      const { data } = await (getDb(ctx) as any).from('integration_call_logs')
        .select('id, integration_id, method, url, response_status, started_at')
        .eq('trace_id', traceId)
        .neq('id', callId)
        .order('started_at', { ascending: true })
      return (data ?? []) as any[]
    },
  }),

  /** Agent runs in the same trace (call detail → Related). */
  'integrations.callTraceAgentRuns': defineRead({
    args: z.object({ traceId: id }),
    perm: 'integrations.view',
    run: async (ctx, { traceId }) => {
      const { data } = await (getDb(ctx) as any).from('agent_runs')
        .select('id, agent_id, agent:agents(name), status')
        .eq('trace_id', traceId)
      return (data ?? []) as any[]
    },
  }),

  /** Integration objects with their sources, each source hydrated with its table / reference name. */
  'integrations.objects': defineRead({
    args: NO_ARGS,
    perm: 'integrations.view',
    run: async (ctx) => {
      const db = getDb(ctx) as any
      const { data: objs } = await db.from('integration_objects')
        .select('*')
        .order('created_at', { ascending: false })
      if (!objs?.length) return [] as any[]

      // Fetch sources separately (more reliable than nested join)
      const objIds = objs.map((o: any) => o.id)
      const { data: allSources } = await db.from('integration_object_sources')
        .select('*')
        .in('object_id', objIds)
        .order('sort_order')

      // Fetch table names and reference names for display
      const tableIds = [...new Set((allSources ?? []).filter((s: any) => s.table_id).map((s: any) => s.table_id))] as string[]
      const refIds = [...new Set((allSources ?? []).filter((s: any) => s.reference_id).map((s: any) => s.reference_id))] as string[]

      const [{ data: tableNames }, { data: refNames }] = await Promise.all([
        tableIds.length ? db.from('custom_tables').select('id, name').in('id', tableIds) : Promise.resolve({ data: [] as any[] }),
        refIds.length ? db.from('integration_references').select('id, name, request_config').in('id', refIds) : Promise.resolve({ data: [] as any[] }),
      ])

      const tableMap = new Map((tableNames ?? []).map((t: any) => [t.id, t]))
      const refMap = new Map((refNames ?? []).map((r: any) => [r.id, r]))

      return objs.map((obj: any) => ({
        ...obj,
        sources: (allSources ?? [])
          .filter((s: any) => s.object_id === obj.id)
          .map((s: any) => ({
            ...s,
            table: s.table_id ? tableMap.get(s.table_id) : null,
            reference: s.reference_id ? refMap.get(s.reference_id) : null,
          })),
      })) as any[]
    },
  }),

  /** Tables (with columns) offered as object sources. */
  'integrations.objectTables': defineRead({
    args: NO_ARGS,
    perm: 'integrations.view',
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('custom_tables').select('id, name, columns').order('name')
      return (data ?? []) as any[]
    },
  }),
} satisfies Record<string, UiRead<any, any>>
