-- ============================================================================
-- 20261126000000_media_jobs.sql
--
-- Media steps (images, audio, video): the background job queue.
--
-- A Transcribe / Analyze Video / Redact Video / Media Utilities step on long
-- media (or in Background run mode) does not hold the workflow run open: the
-- engine stores the step's resolved settings here, pauses the run on the
-- job's event ('mediawait_…') and the scheduler tick (lib/jobs/registry.ts
-- `process-media`) or an in-process kick runs the job. Provider jobs that
-- take long (AssemblyAI, AWS Transcribe, Gemini file processing) are polled
-- across ticks: `state` holds the provider job id (never media bytes or
-- secrets) and `run_after` the next poll. When the job finishes, the run
-- resumes through the workflow resume queue with the step's variables.
--
-- RLS on, no client grants: only the server (service role) reads and writes
-- jobs; the workflow run (and its history) is what people see.
-- claim_next_media_job() claims one due job with SKIP LOCKED.
--
-- Adds objects only; nothing locks existing tables.
-- ============================================================================

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.media_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  workflow_id uuid,
  -- The event the paused run waits on (unique per job).
  event_id text NOT NULL UNIQUE,
  node_id text NOT NULL,
  node_type text NOT NULL,
  node_label text,
  -- Variable prefix of the step (<prefix>_<name> variables, like inline runs).
  output_prefix text,
  -- The step's settings with expressions resolved; file inputs as references.
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Resumable state (provider job ids, input name / duration).
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_after timestamptz NOT NULL DEFAULT now(),
  -- The job fails when it is not done by then (MEDIA_JOB_TIMEOUT_SECONDS).
  deadline_at timestamptz,
  locked_by text,
  locked_at timestamptz,
  error text,
  -- Compact step output (what the run history shows).
  output jsonb,
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS media_jobs_due_idx ON public.media_jobs (run_after) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS media_jobs_processing_idx ON public.media_jobs (locked_at) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS media_jobs_tenant_idx ON public.media_jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS media_jobs_run_idx ON public.media_jobs (run_id);

ALTER TABLE public.media_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_jobs FROM anon, authenticated;
GRANT ALL ON public.media_jobs TO service_role;

-- Claim the next due job (oldest due first), marking it processing.
CREATE OR REPLACE FUNCTION public.claim_next_media_job(p_worker_id text)
  RETURNS public.media_jobs
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
DECLARE
  job public.media_jobs;
BEGIN
  SELECT * INTO job
    FROM public.media_jobs
   WHERE status = 'pending' AND run_after <= now()
   ORDER BY run_after
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE public.media_jobs
     SET status = 'processing', locked_by = p_worker_id, locked_at = now(), attempts = attempts + 1, updated_at = now()
   WHERE id = job.id
  RETURNING * INTO job;
  RETURN job;
END
$$;

REVOKE ALL ON FUNCTION public.claim_next_media_job(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_media_job(text) TO service_role;

-- The tick probe gains `media_jobs` (due or processing media jobs) so the
-- every-minute `process-media` job is skipped when there is nothing to do.
-- Same function as 20261109000000 plus that key (CREATE OR REPLACE keeps grants).
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

  -- Same predicate as claim_jobs (uses idx_queue_claim).
  BEGIN
    v := EXISTS (SELECT 1 FROM workflow_queue q
                  WHERE (q.status = 'pending' AND q.scheduled_for <= now())
                     OR (q.status = 'failed' AND q.attempts < q.max_attempts AND q.next_retry_at <= now()));
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

  RETURN r;
END;
$$;

