/**
 * The "Agents & AI usage" report source (key `ai_usage`, virtual): one row
 * per AI call of the workspace — every agent run (public.agent_runs) and
 * every in-product Agent / PDF import / redaction AI request
 * (public.assistant_usage) — with flat columns for reports, summary charts,
 * filters, CSV export and app report widgets.
 *
 * Access: agents.view (SOURCE_PERMISSIONS); the person columns (user_id,
 * user_name, team_name) need assistants.manage, like Agents → Costs &
 * budgets → By person (assertReportSourceAccess). With known permissions the
 * rows are read with the service role, so totals match the Costs page;
 * without (session callers that pass none) the caller's client and RLS
 * decide.
 *
 * Cost per row: the cost stored with the call when there is one
 * (cost_status "priced"); else, when its model has a price today, the cost
 * at today's price (cost_status "estimated", cost_estimated true); else
 * none ("unknown"). Same rules as lib/agents/cost-breakdown.ts.
 *
 * Rows are read newest first, at most AI_USAGE_ROW_CAP per table; filters
 * on occurred_at and the report's date range are pushed into the queries.
 */
import { costOf, resolvePrice } from '@/lib/agents/pricing'
import { COST_SOURCE_LABELS, PROFILE_SOURCES, type CostSource } from '@/lib/agents/cost-breakdown'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

export const AI_USAGE_SOURCE_KEY = 'ai_usage'
export const AI_USAGE_ROW_CAP = 10_000
/** Person columns: assistants.manage only. */
export const AI_USAGE_PERSON_COLUMNS = ['user_id', 'user_name', 'team_name'] as const
export const AI_USAGE_PERSON_PERMISSION = 'assistants.manage'

export interface AiUsageBounds { fromIso?: string | null; toIso?: string | null }

const isoWeekStart = (ms: number) => {
  const d = new Date(ms)
  const day = (d.getUTCDay() + 6) % 7
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10)
}

/** Lower / upper bounds on occurred_at from the report's filters and date range (pushed into both queries). */
export function aiUsageBounds(config: { filters?: any[]; date_range?: { field?: string; from?: string; to?: string } | null }, extraFilters: any[] = []): AiUsageBounds {
  let from: number | null = null
  let to: number | null = null
  const lower = (v: unknown) => { const t = Date.parse(String(v ?? '')); if (Number.isFinite(t)) from = from === null ? t : Math.max(from, t) }
  const upper = (v: unknown, inclusive: boolean) => { const t = Date.parse(String(v ?? '')); if (Number.isFinite(t)) { const u = inclusive ? t + 1 : t; to = to === null ? u : Math.min(to, u) } }
  for (const f of [...(config.filters ?? []), ...extraFilters]) {
    if (f?.field !== 'occurred_at') continue
    if (f.operator === 'gte' || f.operator === 'gt') lower(f.value)
    if (f.operator === 'lte') upper(f.value, true)
    if (f.operator === 'lt') upper(f.value, false)
  }
  if (config.date_range?.field === 'occurred_at') {
    if (config.date_range.from) lower(config.date_range.from)
    if (config.date_range.to) upper(config.date_range.to, true)
  }
  return { fromIso: from === null ? null : new Date(from).toISOString(), toIso: to === null ? null : new Date(to).toISOString() }
}

/**
 * The source's rows. `db` reads both tables; `canSeePeople` adds the person
 * columns (else they are absent, and assertReportSourceAccess refuses a
 * config that names them).
 */
export async function buildAiUsageRows(db: any, tenantId: string, opts: { bounds?: AiUsageBounds; canSeePeople: boolean; cap?: number }): Promise<Array<Record<string, any>>> {
  const cap = Math.max(1, Math.min(opts.cap ?? AI_USAGE_ROW_CAP, AI_USAGE_ROW_CAP))
  const { fromIso, toIso } = opts.bounds ?? {}
  const { selectAssistantUsage, agentNames, profileNames, userNames } = await import('@/lib/agents/usage')
  const { priceLayers } = await import('@/lib/agents/costs')
  let runsQuery = db.from('agent_runs')
    .select('id, started_at, caller_type, workflow_run_id, price, model, agent_id, status, error, iterations, cost_status, cost_currency, cost_amount, input_tokens, output_tokens, total_tokens, usage, duration_ms, initiated_by, actor_id')
    .eq('tenant_id', tenantId)
  if (fromIso) runsQuery = runsQuery.gte('started_at', fromIso)
  if (toIso) runsQuery = runsQuery.lt('started_at', toIso)
  const [runsResult, usage, layers, agents, profiles] = await Promise.all([
    runsQuery.order('started_at', { ascending: false }).limit(cap),
    selectAssistantUsage(db, tenantId, { fromIso, toIso, limit: cap, columns: 'id, created_at, provider, model, capability, user_id, status, error, llm_calls, cost_status, cost_currency, cost_amount, prompt_tokens, completion_tokens, total_tokens' }),
    priceLayers(db, tenantId),
    agentNames(db, tenantId).catch(() => ({} as Record<string, { name: string; provider?: string | null }>)),
    profileNames(db, tenantId).catch(() => ({} as Record<string, { name: string }>)),
  ])
  if (runsResult.error) throw new Error(runsResult.error.message)
  const runs = (runsResult.data ?? []) as any[]

  // Workflow names of the runs' workflow runs.
  const runIds = Array.from(new Set(runs.map((r) => r.workflow_run_id).filter(Boolean))).map(String)
  const workflowOf = new Map<string, { id: string | null; name: string | null }>()
  for (let i = 0; i < runIds.length; i += 200) {
    const { data } = await db.from('workflow_runs').select('id, workflow_id, workflow:workflows(name)').eq('tenant_id', tenantId).in('id', runIds.slice(i, i + 200))
    for (const w of (data ?? []) as any[]) workflowOf.set(String(w.id), { id: w.workflow_id ?? null, name: w.workflow?.name ?? null })
  }

  // People (assistants.manage only): the Agent request's person, the agent run's initiator.
  let people: Record<string, string> = {}
  const teamOf = new Map<string, string>()
  if (opts.canSeePeople) {
    const ids = Array.from(new Set([...usage.map((u) => u.user_id), ...runs.map((r) => r.initiated_by ?? r.actor_id)].filter(Boolean).map(String)))
    people = await userNames(db, ids).catch(() => ({}))
    if (ids.length) {
      const { data: members } = await db.from('user_teams').select('user_id, team:teams!inner(name, tenant_id)').in('user_id', ids.slice(0, 1000)).eq('team.tenant_id', tenantId).limit(5000)
      for (const m of (members ?? []) as any[]) {
        if (!m.team?.name) continue
        const id = String(m.user_id)
        teamOf.set(id, teamOf.has(id) ? `${teamOf.get(id)}, ${m.team.name}` : String(m.team.name))
      }
    }
  }

  const priceCache = new Map<string, ReturnType<typeof resolvePrice>>()
  const cost = (r: { priced: boolean; amount: unknown; currency: unknown; provider: string | null; model: string | null; input: number; output: number; cached: number; written: number }) => {
    if (r.priced) return { cost_amount: Number(r.amount) || 0, cost_currency: String(r.currency), cost_status: 'priced', cost_estimated: false }
    if (r.model && (r.input || r.output)) {
      const key = `${r.provider ?? ''}:${r.model}`
      if (!priceCache.has(key)) priceCache.set(key, resolvePrice(layers, r.provider ?? '', r.model))
      const price = priceCache.get(key)
      if (price) return { cost_amount: costOf({ prompt_tokens: r.input, completion_tokens: r.output, cached_tokens: r.cached, cache_write_tokens: r.written }, price), cost_currency: price.currency, cost_status: 'estimated', cost_estimated: true }
    }
    return { cost_amount: null, cost_currency: null, cost_status: 'unknown', cost_estimated: false }
  }
  const time = (ts: unknown) => {
    const t = Date.parse(String(ts ?? ''))
    if (!Number.isFinite(t)) return null
    const iso = new Date(t).toISOString()
    return { occurred_at: iso, day: iso.slice(0, 10), week: isoWeekStart(t), month: iso.slice(0, 7) }
  }
  const person = (id: string | null) => (opts.canSeePeople ? { user_id: id, user_name: id ? people[id] ?? 'Former member' : null, team_name: id ? teamOf.get(id) ?? null : null } : {})
  const n = (v: unknown) => Number(v) || 0

  const out: Array<Record<string, any>> = []
  for (const r of runs) {
    const t = time(r.started_at)
    if (!t) continue
    const source: CostSource = r.caller_type === 'workflow_node' || r.workflow_run_id ? 'workflow_agent' : 'agent'
    const provider = r.price?.provider && r.price.provider !== '*' ? String(r.price.provider) : (r.agent_id ? agents[String(r.agent_id)]?.provider ?? null : null)
    const input = n(r.input_tokens)
    const output = n(r.output_tokens)
    const cached = typeof r.usage?.cached_tokens === 'number' ? r.usage.cached_tokens : 0
    const failed = r.status === 'failed' || r.status === 'cancelled'
    const wf = r.workflow_run_id ? workflowOf.get(String(r.workflow_run_id)) : undefined
    out.push({
      id: `run:${r.id}`, ...t, source, source_label: COST_SOURCE_LABELS[source], provider, model: r.model ?? null,
      agent_id: r.agent_id ?? null, agent_name: r.agent_id ? agents[String(r.agent_id)]?.name ?? 'Deleted agent' : null,
      profile_id: null, profile_name: null, capability: null,
      workflow_run_id: r.workflow_run_id ?? null, workflow_id: wf?.id ?? null, workflow_name: wf?.name ?? null,
      status: r.status ?? null, outcome: failed ? 'error' : r.status === 'completed' ? 'success' : 'pending',
      error: r.error ? String(r.error).slice(0, 300) : null, error_percent: failed ? 100 : 0,
      calls: 1, llm_calls: n(r.iterations),
      input_tokens: input, output_tokens: output, cached_tokens: cached, total_tokens: r.total_tokens == null ? input + output : n(r.total_tokens),
      ...cost({ priced: r.cost_status === 'priced' && Boolean(r.cost_currency), amount: r.cost_amount, currency: r.cost_currency, provider, model: r.model ?? null, input, output, cached, written: typeof r.usage?.cache_write_tokens === 'number' ? r.usage.cache_write_tokens : 0 }),
      duration_ms: r.duration_ms == null ? null : n(r.duration_ms),
      ...person(r.initiated_by ?? r.actor_id ?? null),
    })
  }
  for (const u of usage) {
    const t = time(u.created_at)
    if (!t) continue
    const source: CostSource = (PROFILE_SOURCES as readonly string[]).includes(u.source) ? u.source : 'assistant'
    const input = n(u.prompt_tokens)
    const output = n(u.completion_tokens)
    const failed = u.status === 'failed' || u.status === 'cancelled'
    const profileId = u.model_rule ?? null
    out.push({
      id: `agent:${u.id}`, ...t, source, source_label: COST_SOURCE_LABELS[source], provider: u.provider ?? null, model: u.model ?? null,
      agent_id: null, agent_name: null,
      profile_id: profileId ?? 'default', profile_name: profileId ? profiles[profileId]?.name ?? 'Deleted profile' : 'Default', capability: u.capability ?? null,
      workflow_run_id: null, workflow_id: null, workflow_name: null,
      status: u.status ?? null, outcome: failed ? 'error' : u.status === 'awaiting_confirmation' ? 'pending' : 'success',
      error: u.error ? String(u.error).slice(0, 300) : null, error_percent: failed ? 100 : 0,
      calls: 1, llm_calls: n(u.llm_calls),
      input_tokens: input, output_tokens: output, cached_tokens: n(u.cached_tokens), total_tokens: n(u.total_tokens),
      ...cost({ priced: u.cost_status === 'priced' && Boolean(u.cost_currency), amount: u.cost_amount, currency: u.cost_currency, provider: u.provider ?? null, model: u.model ?? null, input, output, cached: n(u.cached_tokens), written: 0 }),
      duration_ms: null,
      ...person(u.user_id ?? null),
    })
  }
  return out.sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)))
}
