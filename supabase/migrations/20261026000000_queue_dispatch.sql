-- Perf phase 2: queue dispatch.
--
-- * claim_jobs(worker, n) claims up to n runnable workflow_queue jobs in one
--   statement (FOR UPDATE SKIP LOCKED), with exactly claim_next_job's
--   predicate, ordering and bookkeeping: pending jobs whose scheduled_for has
--   passed (incl. delay_resume jobs) and failed jobs due for a retry; status
--   'processing', locked_at/locked_by set, started_at kept from the first
--   attempt, attempts + 1. The processor runs the claimed jobs with bounded
--   concurrency and falls back to claim_next_job while this is missing, so
--   the migration can be applied after the code ships.
-- * release_jobs(ids, worker) hands back claimed jobs the processor did not
--   start before its time budget ran out (attempt not counted).
-- * idx_queue_claim matches the claim ordering (priority DESC, scheduled_for)
--   over the runnable statuses.
-- * complete_job keeps only {status, run_id, event_id, reason, error} of the
--   result — the full node_results was stored per job (the run row has them).
-- * enqueue_workflow_batch(tenant, jobs) queues many jobs of one tenant in
--   one call with enqueue_workflow's checks (data-table triggers enqueue one
--   job per matching workflow per row write).
-- * purge_queue_history(before, batch) deletes finished workflow_queue
--   (completed/dead) and agent_queue (completed/failed/dead) rows created
--   before the cutoff, at most batch rows per table per call
--   (/api/cron/cleanup-logs loops it daily).
--
-- Worker RPCs are service_role only; enqueue_workflow_batch keeps
-- enqueue_workflow's grants (authenticated + service_role).
-- Idempotent: safe to run more than once.

-- ── claim_jobs ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_jobs(p_worker_id text, p_limit integer DEFAULT 10)
  RETURNS SETOF public.workflow_queue
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT q.id FROM workflow_queue q
    WHERE (
      (q.status = 'pending' AND q.scheduled_for <= now())
      OR (q.status = 'failed' AND q.attempts < q.max_attempts AND q.next_retry_at <= now())
    )
    ORDER BY q.priority DESC, q.scheduled_for ASC
    LIMIT greatest(1, least(coalesce(p_limit, 10), 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE workflow_queue q SET
    status = 'processing',
    locked_at = now(),
    locked_by = coalesce(p_worker_id, 'default'),
    started_at = COALESCE(q.started_at, now()),
    attempts = q.attempts + 1
  FROM picked
  WHERE q.id = picked.id
  RETURNING q.*;
END;
$$;

-- ── release_jobs ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.release_jobs(p_job_ids uuid[], p_worker_id text)
  RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE workflow_queue SET
    status = 'pending',
    scheduled_for = LEAST(scheduled_for, now()),
    locked_at = NULL,
    locked_by = NULL,
    attempts = greatest(attempts - 1, 0),
    started_at = CASE WHEN attempts <= 1 THEN NULL ELSE started_at END
  WHERE id = ANY(p_job_ids)
    AND status = 'processing'
    AND locked_by = p_worker_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_queue_claim
  ON public.workflow_queue USING btree (priority DESC, scheduled_for)
  WHERE status IN ('pending', 'failed');

-- ── complete_job: slim result ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.complete_job(p_job_id uuid, p_result jsonb DEFAULT '{}'::jsonb)
  RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE workflow_queue SET
    status = 'completed',
    completed_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    result = CASE
      WHEN p_result IS NULL OR jsonb_typeof(p_result) <> 'object' THEN NULL
      ELSE jsonb_strip_nulls(jsonb_build_object(
        'status', p_result->'status',
        'run_id', p_result->'run_id',
        'event_id', p_result->'event_id',
        'reason', p_result->'reason',
        'error', to_jsonb(left(p_result->>'error', 2000))
      ))
    END
  WHERE id = p_job_id;
END;
$$;

-- ── enqueue_workflow_batch ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enqueue_workflow_batch(p_tenant_id uuid, p_jobs jsonb)
  RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_tenant_id IS NULL OR p_jobs IS NULL OR jsonb_typeof(p_jobs) <> 'array' THEN
    RAISE EXCEPTION 'p_tenant_id and a p_jobs array are required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_jobs) = 0 THEN
    RETURN 0;
  END IF;
  IF jsonb_array_length(p_jobs) > 1000 THEN
    RAISE EXCEPTION 'at most 1000 jobs per batch' USING ERRCODE = '22023';
  END IF;

  -- Same membership rule as enqueue_workflow.
  IF NOT (pg_trigger_depth() > 0 OR public.is_trusted_db_caller())
     AND NOT EXISTS (
       SELECT 1 FROM public.get_user_tenant_ids() AS t(id) WHERE t.id = p_tenant_id
     ) THEN
    RAISE EXCEPTION 'not a member of this tenant' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_jobs) AS j(job)
    LEFT JOIN public.workflows w
      ON w.id = (j.job->>'workflow_id')::uuid AND w.tenant_id = p_tenant_id
    WHERE w.id IS NULL
  ) THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO workflow_queue (workflow_id, tenant_id, trigger_type, trigger_data, priority, scheduled_for)
  SELECT
    (j.job->>'workflow_id')::uuid,
    p_tenant_id,
    coalesce(j.job->>'trigger_type', 'manual'),
    coalesce(j.job->'trigger_data', '{}'::jsonb),
    coalesce((j.job->>'priority')::integer, 0),
    now() + make_interval(secs => greatest(coalesce((j.job->>'delay_seconds')::integer, 0), 0))
  FROM jsonb_array_elements(p_jobs) AS j(job);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM pg_notify('workflow_queue', json_build_object(
    'tenant_id', p_tenant_id,
    'count', v_count
  )::text);

  RETURN v_count;
END;
$$;

-- ── purge_queue_history ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.purge_queue_history(p_before timestamptz, p_batch_size integer DEFAULT 5000)
  RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_batch_size, 5000), 50000));
  v_workflow integer;
  v_agent integer;
BEGIN
  DELETE FROM public.workflow_queue q
  WHERE q.id IN (
    SELECT id FROM public.workflow_queue
    WHERE status IN ('completed', 'dead') AND created_at < p_before
    LIMIT v_limit
  );
  GET DIAGNOSTICS v_workflow = ROW_COUNT;

  DELETE FROM public.agent_queue q
  WHERE q.id IN (
    SELECT id FROM public.agent_queue
    WHERE status IN ('completed', 'failed', 'dead') AND created_at < p_before
    LIMIT v_limit
  );
  GET DIAGNOSTICS v_agent = ROW_COUNT;

  RETURN jsonb_build_object('workflow_queue', v_workflow, 'agent_queue', v_agent);
END;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.claim_jobs(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jobs(text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.release_jobs(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_jobs(uuid[], text) TO service_role;
REVOKE ALL ON FUNCTION public.complete_job(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_job(uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.purge_queue_history(timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_queue_history(timestamptz, integer) TO service_role;
REVOKE ALL ON FUNCTION public.enqueue_workflow_batch(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_workflow_batch(uuid, jsonb) TO authenticated, service_role;
