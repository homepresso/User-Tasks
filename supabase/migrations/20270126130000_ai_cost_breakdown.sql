-- ============================================================================
-- AI cost breakdown (Agents → Costs & budgets: by model, profile, source,
-- agent, person).
--
-- 1. public.assistant_usage.source — which feature made the AI call: NULL /
--    'assistant' (the in-product Agent chat), 'pdf_import' (PDF import AI
--    assist), 'redact_ai' (Redact Document AI detection). Rows written before
--    this column count as 'assistant'.
-- 2. public.assistant_usage.cached_tokens — prompt tokens read from the
--    provider's prompt cache (part of prompt_tokens), like agent_runs.usage.
--    lib/assistants/limits.ts recordAssistantUsage() writes both and leaves
--    them out until this migration is applied.
-- 3. public.ai_usage_breakdown(tenant, from, to) — agent_runs and
--    assistant_usage of one workspace in [from, to), grouped per UTC day,
--    source, provider, model, agent, profile, capability, person, cost status
--    and currency. Service role only: the costs endpoints check agents.view
--    (and assistants.manage for the per-person view) before calling it.
--    Uses the existing (tenant_id, started_at) / (tenant_id, created_at)
--    indexes — no new index needed.
--
-- Additive and idempotent. Until it is applied the app sums the rows itself
-- (lib/agents/usage.ts), bounded to 50,000 rows per table.
-- ============================================================================

SET lock_timeout = '5s';

ALTER TABLE public.assistant_usage
  ADD COLUMN IF NOT EXISTS source text CHECK (source IS NULL OR char_length(source) <= 40),
  ADD COLUMN IF NOT EXISTS cached_tokens integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.assistant_usage.source IS
  'Feature that made the AI call: NULL/assistant (Agent chat), pdf_import, redact_ai.';
COMMENT ON COLUMN public.assistant_usage.cached_tokens IS
  'Prompt tokens read from the provider prompt cache (part of prompt_tokens).';

CREATE OR REPLACE FUNCTION public.ai_usage_breakdown(p_tenant_id uuid, p_from timestamptz, p_to timestamptz)
  RETURNS TABLE (
    day date, source text, provider text, model text, agent_id uuid, profile text, capability text, user_id uuid,
    cost_status text, cost_currency text, calls bigint, input_tokens bigint, output_tokens bigint,
    cached_tokens bigint, cache_write_tokens bigint, total_tokens bigint, cost_amount numeric
  )
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path TO ''
AS $$
  SELECT f.day, f.source, f.provider, f.model, f.agent_id, f.profile, f.capability, f.user_id, f.cost_status, f.cost_currency,
         count(*)::bigint, sum(f.input_tokens)::bigint, sum(f.output_tokens)::bigint, sum(f.cached_tokens)::bigint,
         sum(f.cache_write_tokens)::bigint, sum(f.total_tokens)::bigint, sum(f.cost_amount)
    FROM (
      SELECT (r.started_at AT TIME ZONE 'UTC')::date AS day,
             CASE WHEN r.caller_type = 'workflow_node' OR r.workflow_run_id IS NOT NULL THEN 'workflow_agent' ELSE 'agent' END AS source,
             NULLIF(r.price->>'provider', '*') AS provider,
             r.model,
             r.agent_id,
             NULL::text AS profile,
             NULL::text AS capability,
             NULL::uuid AS user_id,
             CASE WHEN r.cost_status = 'priced' AND r.cost_currency IS NOT NULL THEN 'priced' ELSE 'unknown' END AS cost_status,
             CASE WHEN r.cost_status = 'priced' THEN r.cost_currency END AS cost_currency,
             coalesce(r.input_tokens, 0) AS input_tokens,
             coalesce(r.output_tokens, 0) AS output_tokens,
             CASE WHEN jsonb_typeof(r.usage->'cached_tokens') = 'number' THEN (r.usage->>'cached_tokens')::numeric ELSE 0 END AS cached_tokens,
             CASE WHEN jsonb_typeof(r.usage->'cache_write_tokens') = 'number' THEN (r.usage->>'cache_write_tokens')::numeric ELSE 0 END AS cache_write_tokens,
             coalesce(r.total_tokens, coalesce(r.input_tokens, 0) + coalesce(r.output_tokens, 0)) AS total_tokens,
             CASE WHEN r.cost_status = 'priced' THEN r.cost_amount END AS cost_amount
        FROM public.agent_runs r
       WHERE r.tenant_id = p_tenant_id AND r.started_at >= p_from AND r.started_at < p_to
      UNION ALL
      SELECT (u.created_at AT TIME ZONE 'UTC')::date,
             coalesce(u.source, 'assistant'),
             u.provider,
             u.model,
             NULL::uuid,
             u.model_rule,
             u.capability,
             u.user_id,
             CASE WHEN u.cost_status = 'priced' AND u.cost_currency IS NOT NULL THEN 'priced' ELSE 'unknown' END,
             CASE WHEN u.cost_status = 'priced' THEN u.cost_currency END,
             u.prompt_tokens,
             u.completion_tokens,
             coalesce(u.cached_tokens, 0),
             0,
             u.total_tokens,
             CASE WHEN u.cost_status = 'priced' THEN u.cost_amount END
        FROM public.assistant_usage u
       WHERE u.tenant_id = p_tenant_id AND u.created_at >= p_from AND u.created_at < p_to
    ) f
   GROUP BY f.day, f.source, f.provider, f.model, f.agent_id, f.profile, f.capability, f.user_id, f.cost_status, f.cost_currency
$$;

REVOKE ALL ON FUNCTION public.ai_usage_breakdown(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_usage_breakdown(uuid, timestamptz, timestamptz) TO service_role;
