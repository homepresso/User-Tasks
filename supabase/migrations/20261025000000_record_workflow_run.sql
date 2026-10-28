-- Perf phase 1: atomic workflow run stats.
--
-- The engine updated workflows.run_count as read-modify-write
-- (run_count = <value read at run start> + 1), so concurrent runs of the same
-- workflow lost increments. record_workflow_run increments in one statement.
-- The engine falls back to the old update while this function is missing, so
-- the migration can be applied after the code ships.
--
-- service_role only (the engine runs with the service key).
-- Idempotent: safe to run more than once.

CREATE OR REPLACE FUNCTION public.record_workflow_run(p_workflow_id uuid) RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  UPDATE public.workflows
     SET run_count = coalesce(run_count, 0) + 1,
         last_run_at = now()
   WHERE id = p_workflow_id;
$$;

REVOKE ALL ON FUNCTION public.record_workflow_run(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_workflow_run(uuid) TO service_role;
