-- Workflow queue leases and stuck-job recovery.
--
-- Before this migration a workflow_queue job left in `processing` by a worker
-- that crashed, was OOM-killed or timed out (a serverless function past its
-- maxDuration) stayed there for ever: claim_jobs only picks pending jobs and
-- failed jobs due for a retry, and the queue UI/API refused to touch a
-- processing job.
--
-- * workflow_queue gets a lease: lease_expires_at (set by claim_jobs when the
--   caller passes p_lease_seconds and pushed forward by renew_job_leases while
--   the job runs), run_id (the run the job started or continued, written by
--   the processor as soon as it exists), lease_lost_count /
--   last_lease_lost_at / last_lease_owner (recovery bookkeeping, shown in the
--   queue UI).
-- * queue_job_lease_expired(lease_expires_at, locked_at): a processing job is
--   stuck when its lease expired, or — claimed by code that sets no lease —
--   when it was locked more than 15 minutes ago.
-- * recover_expired_jobs(limit): stuck jobs go back to `failed` with the
--   usual exponential back-off (claimed again when due), or to `dead` after
--   max_attempts, with a clear "Worker lost" error. A resume job whose run had
--   already started running again is not retried (the pause it was meant to
--   resume is gone): it goes to `dead` and the run is marked failed.
--   claim_jobs and claim_next_job run it first, so the scheduler tick, the
--   web app's processor and separate workers all recover stuck jobs; no
--   pg_cron needed.
-- * claim_jobs(worker, limit, lease_seconds): + optional lease. Replaces the
--   two-argument version (same name; callers passing two arguments get no
--   lease, i.e. the 15-minute rule).
-- * renew_job_leases(worker, ids, lease_seconds): extends the leases the
--   worker still holds and returns their ids (a missing id = lease lost).
-- * complete_leased_job / fail_leased_job: complete_job / fail_job fenced on
--   the lease holder, so a worker that lost its lease cannot write its result
--   over a recovered (retried, cancelled) job. Return whether they applied.
-- * recover_queue_job(job, tenant, action, force): Workflow queue → Retry /
--   Cancel of a processing job. Allowed when its lease expired; cancel also
--   with force (a live job: the worker's result is then discarded by the
--   fence above). Returns the outcome; the service layer audits it.
-- * get_queue_health(tenant): counts per state, stuck jobs and the oldest
--   due job's age (Settings, metrics, autoscalers).
-- * cron_tick_probe: the tick's workflow_queue probe also sees stuck jobs, so
--   the scheduler runs the claim (and with it the recovery) when the queue
--   holds nothing but stuck jobs. Same as 20261206000000_esign otherwise.
--
-- Plain SQL (no pg_cron, no Supabase-only features). Worker RPCs are
-- service_role only. Idempotent: safe to run more than once.

ALTER TABLE public.workflow_queue
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS run_id uuid,
  ADD COLUMN IF NOT EXISTS lease_lost_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_lease_lost_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_lease_owner text;

CREATE INDEX IF NOT EXISTS idx_queue_processing_lease
  ON public.workflow_queue USING btree (lease_expires_at, locked_at)
  WHERE status = 'processing';

-- ── queue_job_lease_expired ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.queue_job_lease_expired(p_lease_expires_at timestamptz, p_locked_at timestamptz)
  RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT CASE
    WHEN p_lease_expires_at IS NOT NULL THEN p_lease_expires_at < now()
    ELSE coalesce(p_locked_at, '-infinity'::timestamptz) < now() - interval '15 minutes'
  END
$$;

-- ── recover_expired_jobs ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.recover_expired_jobs(p_limit integer DEFAULT 100)
  RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_job record;
  v_run_ref text;
  v_run_status text;
  v_is_resume boolean;
  v_msg text;
  v_requeued integer := 0;
  v_dead integer := 0;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  FOR v_job IN
    SELECT q.* FROM workflow_queue q
    WHERE q.status = 'processing'
      AND public.queue_job_lease_expired(q.lease_expires_at, q.locked_at)
    ORDER BY q.locked_at NULLS FIRST
    LIMIT greatest(1, least(coalesce(p_limit, 100), 1000))
    FOR UPDATE SKIP LOCKED
  LOOP
    v_run_ref := coalesce(
      v_job.run_id::text,
      v_job.result->>'run_id',
      v_job.trigger_data->>'_resume_run_id',
      v_job.trigger_data->'_task_resume'->>'run_id'
    );
    v_is_resume := coalesce(v_job.trigger_data ? '_resume_run_id' OR v_job.trigger_data ? '_task_resume', false);
    v_run_status := NULL;
    IF v_run_ref ~ uuid_re THEN
      SELECT r.status INTO v_run_status FROM workflow_runs r WHERE r.id = v_run_ref::uuid;
    END IF;
    v_msg := format(
      'Worker lost: %s stopped renewing its lease on this job (lease expired %s, attempt %s of %s).',
      coalesce(v_job.locked_by, 'the worker'),
      to_char(coalesce(v_job.lease_expires_at, v_job.locked_at + interval '15 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS "UTC"'),
      v_job.attempts, v_job.max_attempts
    );

    IF v_job.attempts >= v_job.max_attempts OR (v_is_resume AND v_run_status = 'running') THEN
      UPDATE workflow_queue SET
        status = 'dead',
        error = v_msg || CASE
          WHEN v_job.attempts >= v_job.max_attempts THEN ' Gave up: no attempts left.'
          ELSE ' The run was interrupted while resuming and is not retried automatically.'
        END,
        completed_at = now(),
        locked_at = NULL,
        locked_by = NULL,
        lease_expires_at = NULL,
        last_lease_owner = v_job.locked_by,
        lease_lost_count = v_job.lease_lost_count + 1,
        last_lease_lost_at = now()
      WHERE id = v_job.id;
      v_dead := v_dead + 1;
      IF v_run_status = 'running' THEN
        UPDATE workflow_runs SET
          status = 'failed',
          completed_at = now(),
          error = 'Interrupted. ' || v_msg
        WHERE id = v_run_ref::uuid AND status = 'running';
      END IF;
    ELSE
      UPDATE workflow_queue SET
        status = 'failed',
        error = v_msg || ' Retrying.',
        -- Same back-off as fail_job: 30 s, 2 min, 8 min, … (at most 1 h).
        next_retry_at = now() + least(30 * power(4, greatest(v_job.attempts - 1, 0)), 3600) * interval '1 second',
        locked_at = NULL,
        locked_by = NULL,
        lease_expires_at = NULL,
        last_lease_owner = v_job.locked_by,
        lease_lost_count = v_job.lease_lost_count + 1,
        last_lease_lost_at = now()
      WHERE id = v_job.id;
      v_requeued := v_requeued + 1;
    END IF;
    v_ids := v_ids || v_job.id;
  END LOOP;

  RETURN jsonb_build_object('requeued', v_requeued, 'dead', v_dead, 'job_ids', to_jsonb(v_ids));
END;
$$;

-- ── claim_jobs (+ lease, + recovery) ────────────────────────────────────────

DROP FUNCTION IF EXISTS public.claim_jobs(text, integer);

CREATE OR REPLACE FUNCTION public.claim_jobs(p_worker_id text, p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT NULL)
  RETURNS SETOF public.workflow_queue
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.recover_expired_jobs(50);

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
    last_lease_owner = coalesce(p_worker_id, 'default'),
    lease_expires_at = CASE
      WHEN p_lease_seconds IS NULL THEN NULL
      ELSE now() + make_interval(secs => greatest(10, least(p_lease_seconds, 3600)))
    END,
    started_at = COALESCE(q.started_at, now()),
    attempts = q.attempts + 1
  FROM picked
  WHERE q.id = picked.id
  RETURNING q.*;
END;
$$;

-- ── claim_next_job (legacy single claim: + recovery) ────────────────────────

CREATE OR REPLACE FUNCTION public.claim_next_job(p_worker_id text DEFAULT 'default'::text)
  RETURNS public.workflow_queue
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_job workflow_queue;
BEGIN
  PERFORM public.recover_expired_jobs(20);

  SELECT * INTO v_job FROM workflow_queue
  WHERE (
    (status = 'pending' AND scheduled_for <= now())
    OR (status = 'failed' AND attempts < max_attempts AND next_retry_at <= now())
  )
  ORDER BY priority DESC, scheduled_for ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_job.id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE workflow_queue SET
    status = 'processing',
    locked_at = now(),
    locked_by = p_worker_id,
    last_lease_owner = p_worker_id,
    lease_expires_at = NULL,
    started_at = COALESCE(started_at, now()),
    attempts = attempts + 1
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

-- ── renew_job_leases ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.renew_job_leases(p_worker_id text, p_job_ids uuid[], p_lease_seconds integer DEFAULT 120)
  RETURNS SETOF uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  UPDATE workflow_queue SET
    lease_expires_at = now() + make_interval(secs => greatest(10, least(coalesce(p_lease_seconds, 120), 3600)))
  WHERE id = ANY(p_job_ids)
    AND status = 'processing'
    AND locked_by = p_worker_id
  RETURNING id;
END;
$$;

-- ── release_jobs (+ clear the lease) ────────────────────────────────────────

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
    lease_expires_at = NULL,
    attempts = greatest(attempts - 1, 0),
    started_at = CASE WHEN attempts <= 1 THEN NULL ELSE started_at END
  WHERE id = ANY(p_job_ids)
    AND status = 'processing'
    AND locked_by = p_worker_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── complete_job / fail_job (legacy, unfenced: + clear the lease) ───────────

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
    lease_expires_at = NULL,
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

CREATE OR REPLACE FUNCTION public.fail_job(p_job_id uuid, p_error text)
  RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_attempts integer;
  v_max_attempts integer;
  v_delay interval;
BEGIN
  SELECT attempts, max_attempts INTO v_attempts, v_max_attempts
  FROM workflow_queue WHERE id = p_job_id;

  -- Exponential backoff: 30s, 120s, 480s
  v_delay := (30 * power(4, v_attempts - 1)) * interval '1 second';

  IF v_attempts >= v_max_attempts THEN
    UPDATE workflow_queue SET
      status = 'dead',
      error = p_error,
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL
    WHERE id = p_job_id;
  ELSE
    UPDATE workflow_queue SET
      status = 'failed',
      error = p_error,
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      next_retry_at = now() + v_delay
    WHERE id = p_job_id;
  END IF;
END;
$$;

-- ── complete_leased_job / fail_leased_job (fenced on the lease holder) ──────

CREATE OR REPLACE FUNCTION public.complete_leased_job(p_job_id uuid, p_worker_id text, p_result jsonb DEFAULT '{}'::jsonb)
  RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE workflow_queue SET
    status = 'completed',
    completed_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    lease_expires_at = NULL,
    run_id = coalesce(run_id, CASE
      WHEN p_result->>'run_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN (p_result->>'run_id')::uuid END),
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
  WHERE id = p_job_id AND status = 'processing' AND locked_by = p_worker_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_leased_job(p_job_id uuid, p_worker_id text, p_error text)
  RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE workflow_queue SET
    status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'failed' END,
    error = left(p_error, 4000),
    completed_at = CASE WHEN attempts >= max_attempts THEN now() ELSE completed_at END,
    next_retry_at = CASE WHEN attempts >= max_attempts THEN next_retry_at
      ELSE now() + (30 * power(4, greatest(attempts - 1, 0))) * interval '1 second' END,
    locked_at = NULL,
    locked_by = NULL,
    lease_expires_at = NULL
  WHERE id = p_job_id AND status = 'processing' AND locked_by = p_worker_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

-- ── recover_queue_job (queue UI / API: retry or cancel a processing job) ────

CREATE OR REPLACE FUNCTION public.recover_queue_job(p_job_id uuid, p_tenant_id uuid, p_action text, p_force boolean DEFAULT false)
  RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_job workflow_queue;
  v_expired boolean;
  v_run_ref text;
BEGIN
  IF p_action NOT IN ('retry', 'cancel') THEN
    RAISE EXCEPTION 'p_action must be retry or cancel' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job FROM workflow_queue
  WHERE id = p_job_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_job.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_job.status <> 'processing' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_processing', 'status', v_job.status);
  END IF;

  v_expired := public.queue_job_lease_expired(v_job.lease_expires_at, v_job.locked_at);
  -- Retrying a job a live worker still runs would run it twice; cancelling
  -- one needs force (its result is then discarded by the lease fence).
  IF NOT v_expired AND (p_action = 'retry' OR NOT coalesce(p_force, false)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'lease_active', 'lease_expires_at', v_job.lease_expires_at, 'locked_by', v_job.locked_by);
  END IF;

  v_run_ref := coalesce(
    v_job.run_id::text, v_job.result->>'run_id',
    v_job.trigger_data->>'_resume_run_id', v_job.trigger_data->'_task_resume'->>'run_id'
  );

  IF p_action = 'retry' THEN
    UPDATE workflow_queue SET
      status = 'pending',
      scheduled_for = now(),
      error = NULL,
      attempts = 0,
      next_retry_at = NULL,
      completed_at = NULL,
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      last_lease_owner = v_job.locked_by,
      lease_lost_count = v_job.lease_lost_count + 1,
      last_lease_lost_at = now()
    WHERE id = v_job.id;
  ELSE
    UPDATE workflow_queue SET
      status = 'dead',
      error = CASE WHEN v_expired
        THEN 'Cancelled after the worker was lost (lease expired)'
        ELSE 'Force-cancelled while a worker was processing it' END,
      completed_at = now(),
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      last_lease_owner = v_job.locked_by
    WHERE id = v_job.id;
    IF v_run_ref ~ uuid_re THEN
      UPDATE workflow_runs SET
        status = 'failed',
        completed_at = now(),
        error = 'Cancelled from the workflow queue while processing'
      WHERE id = v_run_ref::uuid AND tenant_id = p_tenant_id AND status = 'running';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'action', p_action,
    'lease_expired', v_expired,
    'locked_by', v_job.locked_by,
    'run_id', CASE WHEN v_run_ref ~ uuid_re THEN v_run_ref END
  );
END;
$$;

-- ── get_queue_health ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_queue_health(p_tenant_id uuid DEFAULT NULL)
  RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT jsonb_build_object(
    'due', count(*) FILTER (WHERE status = 'pending' AND scheduled_for <= now()),
    'scheduled', count(*) FILTER (WHERE status = 'pending' AND scheduled_for > now()),
    'processing', count(*) FILTER (WHERE status = 'processing'),
    'stuck', count(*) FILTER (WHERE status = 'processing' AND public.queue_job_lease_expired(lease_expires_at, locked_at)),
    'retrying', count(*) FILTER (WHERE status = 'failed' AND attempts < max_attempts),
    'dead_24h', count(*) FILTER (WHERE status = 'dead' AND coalesce(completed_at, created_at) > now() - interval '24 hours'),
    'oldest_due_seconds', coalesce(extract(epoch FROM now() - min(scheduled_for) FILTER (
      WHERE (status = 'pending' AND scheduled_for <= now())
         OR (status = 'failed' AND attempts < max_attempts AND next_retry_at <= now())
    ))::bigint, 0),
    'at', now()
  )
  FROM workflow_queue
  WHERE (p_tenant_id IS NULL OR tenant_id = p_tenant_id)
    AND status IN ('pending', 'processing', 'failed', 'dead')
$$;

-- ── cron_tick_probe (+ stuck jobs) ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cron_tick_probe()
  RETURNS jsonb
  LANGUAGE plpgsql STABLE
  SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  r jsonb := '{}'::jsonb;
  v boolean;
BEGIN
  BEGIN
    v := EXISTS (SELECT 1 FROM workflows WHERE trigger_type = 'schedule' AND is_active);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('schedules', v);

  -- Same predicate as claim_jobs (uses idx_queue_claim), plus stuck jobs
  -- (processing with an expired lease): the claim recovers them.
  BEGIN
    v := EXISTS (SELECT 1 FROM workflow_queue q
                  WHERE (q.status = 'pending' AND q.scheduled_for <= now())
                     OR (q.status = 'failed' AND q.attempts < q.max_attempts AND q.next_retry_at <= now()))
      OR EXISTS (SELECT 1 FROM workflow_queue q
                  WHERE q.status = 'processing' AND public.queue_job_lease_expired(q.lease_expires_at, q.locked_at));
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('workflow_queue', v);

  -- 'processing' too: the agent worker resets jobs abandoned mid-run.
  BEGIN
    v := EXISTS (SELECT 1 FROM agent_queue
                  WHERE (status = 'pending' AND scheduled_for <= now()) OR status = 'processing');
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('agent_queue', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM tenant_connectors WHERE connector_key = 'github_sync' AND is_enabled)
      OR EXISTS (SELECT 1 FROM github_sync_runs WHERE status IN ('pending', 'running'));
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('github_sync', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM github_deployments WHERE status IN ('pending', 'running'));
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('github_deployments', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM log_destinations WHERE enabled);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('log_destinations', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM workflow_runs
                  WHERE status IN ('running', 'paused', 'waiting_for_event') AND sla_due_at IS NOT NULL);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('sla', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM task_reminders WHERE NOT is_sent);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('reminders', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM task_escalations WHERE NOT is_escalated);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('escalations', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM deletion_queue WHERE status = 'pending');
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('deletions', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM tenant_connectors
                  WHERE connector_key IN ('entra_directory', 'okta_directory', 'ldap_directory', 'google_directory') AND is_enabled)
      OR EXISTS (SELECT 1 FROM directory_sync_runs WHERE status IN ('pending', 'running'));
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('directory_sync', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM tenant_connectors WHERE is_enabled AND (config->>'expires_at') IS NOT NULL);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('oauth_connectors', v);

  -- 'processing' too: the media worker resets jobs abandoned mid-run.
  BEGIN
    v := EXISTS (SELECT 1 FROM media_jobs
                  WHERE (status = 'pending' AND run_after <= now()) OR status = 'processing');
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('media_jobs', v);

  -- 'processing' too: a poll worker that died leaves rows to reclaim.
  BEGIN
    v := EXISTS (SELECT 1 FROM esign_waits
                  WHERE (status = 'waiting' AND next_poll_at <= now()) OR status = 'processing');
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('esign_waits', v);

  RETURN r;
END;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.queue_job_lease_expired(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_job_lease_expired(timestamptz, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.recover_expired_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_expired_jobs(integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_jobs(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jobs(text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_next_job(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_job(text) TO service_role;
REVOKE ALL ON FUNCTION public.renew_job_leases(text, uuid[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_job_leases(text, uuid[], integer) TO service_role;
REVOKE ALL ON FUNCTION public.release_jobs(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_jobs(uuid[], text) TO service_role;
REVOKE ALL ON FUNCTION public.complete_job(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_job(uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fail_job(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_job(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.complete_leased_job(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_leased_job(uuid, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fail_leased_job(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_leased_job(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.recover_queue_job(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_queue_job(uuid, uuid, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.get_queue_health(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_queue_health(uuid) TO service_role;
