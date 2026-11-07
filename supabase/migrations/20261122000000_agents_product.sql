-- ============================================================================
-- 20261122000000_agents_product.sql
--
-- AI agents: write lockdown, approvals, traces, versions and evaluations.
--
-- 1. Write lockdown. agents, agent_runs and agent_queue were writable by any
--    member of a tenant through PostgREST (membership-only policies): a
--    member without agents.edit could rewrite an agent's tools / prompt,
--    forge run records, or enqueue a job with created_by = another user
--    (the queue acted as that user). INSERT / UPDATE / DELETE are revoked
--    from anon and authenticated on all three; the app writes with the
--    service role after its own permission checks (lib/services/agents.ts,
--    lib/agent-run-service.ts, lib/agents/*). Reads are unchanged.
--
-- 2. agents.version — bumped on every saved change; agent_versions keeps a
--    snapshot of each version (restore = save an old snapshot as the newest
--    version). Members read their workspace's versions; service-role writes.
--
-- 3. agent_runs: steps (the run trace: every LLM call and tool call with
--    latency, tokens, redacted arguments / results), files (files produced
--    by tools), agent_version, approval_event_id (the task event a run
--    paused for approval waits on), eval_run_id; index (agent_id,
--    started_at) for per-agent budgets and usage.
--
-- 4. agent_queue: kind ('run' | 'resume'), resume_run_id (a run continuing
--    after an approval), options (acting user, Run Agent step link, files,
--    limits, decision).
--
-- 5. agent_eval_cases (an agent's test cases: input + expectations) and
--    agent_eval_runs (one run of the suite: per-case results, pass counts).
--    Members read their workspace's rows; service-role writes.
-- ============================================================================

-- ── 1. Write lockdown ───────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.agents FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.agent_runs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.agent_queue FROM anon, authenticated;

DROP POLICY IF EXISTS "Users can insert tenant agents" ON public.agents;
DROP POLICY IF EXISTS "Users can update tenant agents" ON public.agents;
DROP POLICY IF EXISTS "Users can delete tenant agents" ON public.agents;
DROP POLICY IF EXISTS "Users can insert tenant agent runs" ON public.agent_runs;
DROP POLICY IF EXISTS "Users can update tenant agent runs" ON public.agent_runs;
DROP POLICY IF EXISTS tenant_isolation_delete ON public.agent_runs;
DROP POLICY IF EXISTS "Users can insert into agent queue" ON public.agent_queue;
DROP POLICY IF EXISTS tenant_isolation_update ON public.agent_queue;
DROP POLICY IF EXISTS tenant_isolation_delete ON public.agent_queue;

-- ── 2. Versions ─────────────────────────────────────────────────────────────
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.agent_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  note text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);
CREATE INDEX IF NOT EXISTS idx_agent_versions_tenant ON public.agent_versions (tenant_id, agent_id, version DESC);

-- ── 3. Runs ─────────────────────────────────────────────────────────────────
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS steps jsonb,
  ADD COLUMN IF NOT EXISTS files jsonb,
  ADD COLUMN IF NOT EXISTS agent_version integer,
  ADD COLUMN IF NOT EXISTS approval_event_id text,
  ADD COLUMN IF NOT EXISTS eval_run_id uuid;
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_started ON public.agent_runs (agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_approval_event ON public.agent_runs (approval_event_id) WHERE approval_event_id IS NOT NULL;

-- ── 4. Queue ────────────────────────────────────────────────────────────────
ALTER TABLE public.agent_queue
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'run',
  ADD COLUMN IF NOT EXISTS resume_run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS options jsonb;
DO $$ BEGIN
  ALTER TABLE public.agent_queue ADD CONSTRAINT agent_queue_kind_check CHECK (kind IN ('run', 'resume'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5. Evaluations ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_eval_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  name text NOT NULL,
  input_message text NOT NULL,
  expected jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_eval_cases_agent ON public.agent_eval_cases (tenant_id, agent_id);

CREATE TABLE IF NOT EXISTS public.agent_eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  agent_version integer,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  total integer NOT NULL DEFAULT 0,
  passed integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  usage jsonb,
  error text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_agent_eval_runs_agent ON public.agent_eval_runs (tenant_id, agent_id, started_at DESC);

-- RLS: members read their workspace's rows; no client writes.
DO $$
DECLARE
  t text;
  m constant text := 'tenant_id = ANY ((SELECT ARRAY[u.tenant_id, COALESCE(u.current_tenant_id, u.tenant_id)] '
                     'FROM public.users u WHERE u.id = (SELECT auth.uid()))::uuid[])';
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_versions', 'agent_eval_cases', 'agent_eval_runs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (%s)', t || '_select', t, m);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
