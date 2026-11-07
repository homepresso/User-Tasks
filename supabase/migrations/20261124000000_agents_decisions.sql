-- ============================================================================
-- 20261124000000_agents_decisions.sql
--
-- AI agents: per-table data grants, run-record visibility, cost.
--
-- 1. Data grants. output_config.data_access is now explicit per table
--    (grants: read / insert / update / delete) and new agents start with
--    none. Before, an agent without data_access (every agent created by the
--    designer) could read / insert / update every table of its workspace.
--    Existing agents keep exactly what they had: no data_access or mode
--    'all' → {"mode":"all","legacy":true} (the designer shows a banner
--    suggesting narrowing); mode 'selected' → one grant per listed table
--    with read / insert / update (delete did not exist). The same rewrite
--    is applied to saved versions (agent_versions.snapshot), so restoring an
--    old version or a workflow pinned to one behaves as before.
--
-- 2. Run records restricted. agent_runs (input, output, trace, tool calls)
--    and agent_eval_runs / agent_queue were readable by every member of the
--    workspace. Now: members with agents.view, or the user the run acted for
--    (actor_id) / who started it (initiated_by, new column) for their own
--    runs. The realtime NOTIFY trigger carries actor_id / initiated_by so the
--    SSE provider can apply the same rule (lib/realtime/events.ts).
--
-- 3. Cost. agent_runs.cost_amount / cost_currency / cost_status ('priced' |
--    'unknown') / price (the price entry used) — computed when the run is
--    recorded from the price table (lib/agents/pricing.ts: shipped list
--    prices, the instance setting instance.ai_model_prices, workspace
--    overrides); never recomputed. agent_cost_settings holds a workspace's
--    price overrides and workspace budgets. agent_usage_totals() sums tokens
--    and cost (per currency) for budgets and usage.
--
-- Nothing here locks for long: two UPDATEs over agents / agent_versions
-- (small tables), ADD COLUMN without defaults, policy swaps.
-- ============================================================================

SET lock_timeout = '5s';

-- ── 1. Data grants ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.legacy_data_access(p_config jsonb)
  RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
      WHEN coalesce(p_config -> 'data_access' ? 'grants', false) THEN p_config -> 'data_access'
      WHEN p_config #>> '{data_access,mode}' = 'selected' THEN jsonb_build_object(
        'mode', CASE WHEN jsonb_array_length(coalesce(p_config #> '{data_access,table_ids}', '[]'::jsonb)) > 0 THEN 'selected' ELSE 'none' END,
        'table_ids', coalesce(p_config #> '{data_access,table_ids}', '[]'::jsonb),
        'grants', coalesce((
          SELECT jsonb_agg(jsonb_build_object('table_id', t, 'read', true, 'insert', true, 'update', true, 'delete', false))
            FROM jsonb_array_elements_text(coalesce(p_config #> '{data_access,table_ids}', '[]'::jsonb)) AS t
        ), '[]'::jsonb),
        'legacy', true)
      ELSE jsonb_build_object('mode', 'all', 'table_ids', '[]'::jsonb, 'grants', '[]'::jsonb, 'legacy', true)
    END
  $$;

CREATE OR REPLACE FUNCTION pg_temp.as_object(p jsonb)
  RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN jsonb_typeof(p) = 'object' THEN p ELSE '{}'::jsonb END
  $$;

UPDATE public.agents
   SET output_config = jsonb_set(pg_temp.as_object(output_config), '{data_access}', pg_temp.legacy_data_access(pg_temp.as_object(output_config)))
 WHERE NOT coalesce(pg_temp.as_object(output_config) -> 'data_access' ? 'grants', false);

UPDATE public.agent_versions
   SET snapshot = jsonb_set(snapshot, '{output_config}',
         jsonb_set(pg_temp.as_object(snapshot -> 'output_config'), '{data_access}',
           pg_temp.legacy_data_access(pg_temp.as_object(snapshot -> 'output_config'))))
 WHERE jsonb_typeof(snapshot) = 'object'
   AND NOT coalesce(pg_temp.as_object(snapshot -> 'output_config') -> 'data_access' ? 'grants', false);

-- ── 2. Run records restricted ───────────────────────────────────────────────
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS initiated_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_actor ON public.agent_runs (tenant_id, actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_initiated_by ON public.agent_runs (tenant_id, initiated_by) WHERE initiated_by IS NOT NULL;

DROP POLICY IF EXISTS "Users can view tenant agent runs" ON public.agent_runs;
DROP POLICY IF EXISTS agent_runs_select ON public.agent_runs;
CREATE POLICY agent_runs_select ON public.agent_runs FOR SELECT TO authenticated USING (
  tenant_id = ANY ((SELECT ARRAY[u.tenant_id, COALESCE(u.current_tenant_id, u.tenant_id)] FROM public.users u WHERE u.id = (SELECT auth.uid()))::uuid[])
  AND (
    actor_id = (SELECT auth.uid())
    OR initiated_by = (SELECT auth.uid())
    OR (SELECT public.user_has_tenant_permission(tenant_id::text, 'agents.view'))
  )
);

DROP POLICY IF EXISTS agent_eval_runs_select ON public.agent_eval_runs;
CREATE POLICY agent_eval_runs_select ON public.agent_eval_runs FOR SELECT TO authenticated USING (
  tenant_id = ANY ((SELECT ARRAY[u.tenant_id, COALESCE(u.current_tenant_id, u.tenant_id)] FROM public.users u WHERE u.id = (SELECT auth.uid()))::uuid[])
  AND (
    created_by = (SELECT auth.uid())
    OR (SELECT public.user_has_tenant_permission(tenant_id::text, 'agents.view'))
  )
);

DROP POLICY IF EXISTS "Users can view tenant agent queue" ON public.agent_queue;
DROP POLICY IF EXISTS agent_queue_select ON public.agent_queue;
CREATE POLICY agent_queue_select ON public.agent_queue FOR SELECT TO authenticated USING (
  tenant_id = ANY ((SELECT ARRAY[u.tenant_id, COALESCE(u.current_tenant_id, u.tenant_id)] FROM public.users u WHERE u.id = (SELECT auth.uid()))::uuid[])
  AND (
    created_by = (SELECT auth.uid())
    OR (SELECT public.user_has_tenant_permission(tenant_id::text, 'agents.view'))
  )
);

-- Realtime: carry the run's people so the SSE provider can route own runs.
DO $$
BEGIN
  IF to_regprocedure('app_realtime.notify_changes()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS realtime_notify_insert ON public.agent_runs;
    CREATE TRIGGER realtime_notify_insert AFTER INSERT ON public.agent_runs
      REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
      EXECUTE FUNCTION app_realtime.notify_changes('actor_id', 'initiated_by');
  END IF;
END $$;

-- ── 3. Cost ─────────────────────────────────────────────────────────────────
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS cost_amount numeric(20, 10),
  ADD COLUMN IF NOT EXISTS cost_currency text,
  ADD COLUMN IF NOT EXISTS cost_status text,
  ADD COLUMN IF NOT EXISTS price jsonb;
DO $$ BEGIN
  ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_cost_status_check CHECK (cost_status IS NULL OR cost_status IN ('priced', 'unknown'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_started ON public.agent_runs (tenant_id, started_at DESC);

ALTER TABLE public.agent_eval_runs ADD COLUMN IF NOT EXISTS cost jsonb;

CREATE TABLE IF NOT EXISTS public.agent_cost_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Workspace price overrides: [{provider, model, input_per_1m, output_per_1m, cached_input_per_1m, currency, effective_date}]
  model_prices jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Workspace budgets: {daily_token_budget, monthly_token_budget, daily_cost_budget, monthly_cost_budget, budget_currency}
  budgets jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_cost_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_cost_settings_select ON public.agent_cost_settings;
CREATE POLICY agent_cost_settings_select ON public.agent_cost_settings FOR SELECT USING (
  tenant_id = ANY ((SELECT ARRAY[u.tenant_id, COALESCE(u.current_tenant_id, u.tenant_id)] FROM public.users u WHERE u.id = (SELECT auth.uid()))::uuid[])
);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.agent_cost_settings FROM anon, authenticated;
GRANT SELECT ON public.agent_cost_settings TO authenticated;
GRANT ALL ON public.agent_cost_settings TO service_role;

-- Tokens and cost (per currency) since a time, for one agent or a whole
-- workspace. Service role only (budgets, usage endpoints check permissions).
CREATE OR REPLACE FUNCTION public.agent_usage_totals(p_tenant_id uuid, p_agent_id uuid, p_since timestamptz)
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path TO ''
AS $$
  SELECT jsonb_build_object(
    'runs', count(*),
    'tokens', coalesce(sum(r.total_tokens), 0),
    'unpriced_runs', count(*) FILTER (WHERE r.cost_status IS DISTINCT FROM 'priced'),
    'cost', coalesce((
      SELECT jsonb_object_agg(c.cost_currency, c.amount)
        FROM (
          SELECT r2.cost_currency, sum(r2.cost_amount) AS amount
            FROM public.agent_runs r2
           WHERE r2.tenant_id = p_tenant_id
             AND (p_agent_id IS NULL OR r2.agent_id = p_agent_id)
             AND r2.started_at >= p_since
             AND r2.cost_status = 'priced'
           GROUP BY r2.cost_currency
        ) c
    ), '{}'::jsonb)
  )
  FROM public.agent_runs r
  WHERE r.tenant_id = p_tenant_id
    AND (p_agent_id IS NULL OR r.agent_id = p_agent_id)
    AND r.started_at >= p_since
$$;
REVOKE ALL ON FUNCTION public.agent_usage_totals(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_usage_totals(uuid, uuid, timestamptz) TO service_role;

-- Event stream: agent.run.* events carry the run's cost.
CREATE OR REPLACE FUNCTION app_events.tg_agent_runs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_status text;
BEGIN
  BEGIN
    v_status := app_events.seg(coalesce(NEW.status, 'running'));
    PERFORM app_events.emit(
      NEW.tenant_id, 'agent.run.' || v_status, 'agent',
      CASE WHEN v_status IN ('failed', 'error') THEN 'error' ELSE 'info' END,
      'Agent run ' || CASE v_status
        WHEN 'running' THEN 'started'
        WHEN 'completed' THEN 'completed'
        WHEN 'failed' THEN 'failed'
        ELSE 'is now ' || v_status END
        || coalesce(' using ' || NEW.model, '')
        || coalesce(' (' || NEW.total_tokens || ' tokens', '')
        || CASE WHEN NEW.total_tokens IS NOT NULL THEN coalesce(', ' || NEW.duration_ms || 'ms)', ')')
                ELSE coalesce(' (' || NEW.duration_ms || 'ms)', '') END
        || CASE WHEN v_status IN ('failed', 'error') THEN coalesce(': ' || app_events.clip(NEW.error, 300), '') ELSE '' END,
      'agent_runs', NEW.id::text, NEW.trace_id, NEW.workflow_run_id, NULL, NULL, NEW.actor_id,
      jsonb_build_object(
        'agent_id', NEW.agent_id,
        'status', NEW.status,
        'previous_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
        'model', NEW.model,
        'iterations', NEW.iterations,
        'input_tokens', NEW.input_tokens,
        'output_tokens', NEW.output_tokens,
        'total_tokens', NEW.total_tokens,
        'duration_ms', NEW.duration_ms,
        'caller_type', NEW.caller_type,
        'cost_amount', NEW.cost_amount,
        'cost_currency', NEW.cost_currency,
        'cost_status', NEW.cost_status,
        'error', app_events.clip(NEW.error)
      ),
      CASE WHEN TG_OP = 'INSERT' THEN coalesce(NEW.completed_at, NEW.started_at, NEW.created_at)
           ELSE coalesce(NEW.completed_at, now()) END
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_events.tg_agent_runs failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$function$;

RESET lock_timeout;
