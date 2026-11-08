-- ============================================================================
-- 20261231000002_agent_background_jobs.sql
--
-- The Agent keeps working when its panel closes (lib/assistants/background.ts):
-- every chat turn is a public.user_jobs row of kind 'agent.turn', and a turn
-- that ran in the background keeps its transcript (the Agent's messages, tool
-- results and cards) in user_jobs.checkpoint until the person's browser merges
-- it into the conversation.
--
-- That transcript is the person's own conversation, so workspace admins
-- (settings.edit), who read every other job of the workspace, do not read
-- Agent jobs of other people: the select policy is replaced with one that
-- leaves 'agent.turn' rows to their owner. No new columns; no client writes
-- (the server writes with the service role, as before).
--
-- Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.user_jobs') IS NULL THEN
    RAISE NOTICE 'public.user_jobs not found; apply 20261114000000_user_jobs first';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS user_jobs_select ON public.user_jobs;
  CREATE POLICY user_jobs_select ON public.user_jobs FOR SELECT TO authenticated
    USING (
      user_id = (SELECT auth.uid())
      OR (kind <> 'agent.turn' AND public.user_has_tenant_permission(tenant_id::text, 'settings.edit'))
    );

  -- The panel lists a person's Agent jobs of one conversation.
  CREATE INDEX IF NOT EXISTS idx_user_jobs_agent
    ON public.user_jobs (user_id, (params->>'conversation_id'), created_at)
    WHERE kind = 'agent.turn';
END $$;

COMMENT ON TABLE public.user_jobs IS 'Background jobs started from the UI, API, MCP or CLI (exports, imports, bulk actions) and Agent turns (agent.turn, private to their person). Runner: lib/user-jobs/runner.ts.';

RESET lock_timeout;
