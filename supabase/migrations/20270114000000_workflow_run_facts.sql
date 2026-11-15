-- ============================================================================
-- 20270114000000_workflow_run_facts.sql
--
-- Multi-agent workflows: the shared blackboard of a workflow run
-- (lib/agents/blackboard.ts). Run Agent steps with "Share context" read and
-- write facts here WHILE they run (read_shared_facts, write_shared_fact,
-- wait_for_shared_fact), so agents running at the same time — in Parallel
-- branches, inline or on the agent queue — see each other's facts at once.
--
-- One row per (run, key); writers upsert ON CONFLICT (run_id, key), which is
-- atomic per key: concurrent writers never lose each other's keys, and on the
-- same key the last write wins with its writer (agent, step, branch) and time
-- recorded. Rows go with their run (and tenant): ON DELETE CASCADE.
--
-- Access: the engine and the agent queue use the service role and always
-- filter on tenant_id; members can read their workspaces' rows (like
-- workflow_runs); clients cannot write.
--
-- Additive and idempotent. Until it is applied, agents fall back to the
-- previous behaviour (facts shared between steps through agent_context only).
-- ============================================================================

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.workflow_run_facts (
  run_id      uuid NOT NULL REFERENCES public.workflow_runs (id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  key         text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 100),
  value       jsonb,
  written_by  jsonb NOT NULL DEFAULT '{}'::jsonb,
  written_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_run_facts_tenant_run
  ON public.workflow_run_facts (tenant_id, run_id);

COMMENT ON TABLE public.workflow_run_facts IS
  'Shared facts (blackboard) of a workflow run''s agents, one row per key: last writer wins per key, writer recorded. Written by the service role only.';

ALTER TABLE public.workflow_run_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_run_facts_select ON public.workflow_run_facts;
CREATE POLICY workflow_run_facts_select ON public.workflow_run_facts FOR SELECT TO authenticated
  USING (tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

REVOKE ALL ON public.workflow_run_facts FROM anon, authenticated;
GRANT SELECT ON public.workflow_run_facts TO authenticated;
GRANT ALL ON public.workflow_run_facts TO service_role;
