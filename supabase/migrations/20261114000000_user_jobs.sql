-- ============================================================================
-- 20261114000000_user_jobs.sql
--
-- Background jobs for slow UI / API actions (exports, imports, bulk actions,
-- package builds, sync runs): the request enqueues a job and returns at once;
-- the job runs right after the response (next/server after()) and, when that
-- invocation dies or the job needs more time, from the scheduler tick
-- (lib/jobs/registry.ts `user-jobs`). Runner: lib/user-jobs/runner.ts.
--
-- 1. public.user_jobs: one row per job — who (tenant, user), what (kind,
--    params, origin = the credential it was started with), state (status
--    queued → running → succeeded | failed | cancelled, progress 0–100 and a
--    message), result (file storage ref, filename, size, counts, small JSON
--    data) or error, a lease (lease_owner / lease_expires_at / heartbeat_at)
--    and a checkpoint for jobs that run in chunks, retries with backoff
--    (attempts / max_attempts / run_after), cancel requests and expires_at
--    (results are deleted with their files by the cleanup job).
--
-- 2. RLS: users read their own jobs; workspace admins (settings.edit) read
--    every job of the workspace. No client writes — the server writes with
--    the service role after its own checks.
--
-- 3. public.user_jobs_claim(holder, lease_seconds, limit, job_id): claims
--    due queued jobs and running jobs whose lease expired (the invocation
--    died) with FOR UPDATE SKIP LOCKED; jobs that ran out of attempts fail.
--    public.user_jobs_actor(user, tenant): membership and live role
--    permissions of a user, so the runner re-checks permissions as that user.
--    Both service_role only.
--
-- 4. notifications.job_id: the bell links a "your export is ready" item to
--    its job (removed with the job).
--
-- 5. Realtime: NOTIFY triggers (SSE provider, 20261105000000) and the
--    supabase_realtime publication, routed by user_id.
--
-- 6. Storage: private `job-results` bucket (Supabase Storage only; other
--    providers create it on first write). Served only through
--    /api/jobs/<id>/download and GET /api/v1/jobs/{id}/download.
--
-- Additive and idempotent; works on plain PostgreSQL (no storage schema, no
-- publication).
-- ============================================================================

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.user_jobs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- NULL for jobs started with a tenant API key (no acting user).
  user_id              uuid REFERENCES public.users(id) ON DELETE CASCADE,
  kind                 text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  title                text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  params               jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- How the job was started: source (ui / api / mcp), auth kind, API key id,
  -- the credential's permission ceiling. Never secrets.
  origin               jsonb NOT NULL DEFAULT '{}'::jsonb,
  status               text NOT NULL DEFAULT 'queued'
                         CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  progress             smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  message              text CHECK (message IS NULL OR char_length(message) <= 500),
  result               jsonb,
  error                text,
  checkpoint           jsonb,
  attempts             integer NOT NULL DEFAULT 0,
  max_attempts         integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  run_after            timestamptz NOT NULL DEFAULT now(),
  lease_owner          text,
  lease_expires_at     timestamptz,
  heartbeat_at         timestamptz,
  cancel_requested_at  timestamptz,
  idempotency_key      text CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 200),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  started_at           timestamptz,
  finished_at          timestamptz,
  expires_at           timestamptz
);

COMMENT ON TABLE public.user_jobs IS 'Background jobs started from the UI, API, MCP or CLI (exports, imports, bulk actions). Runner: lib/user-jobs/runner.ts.';

CREATE INDEX IF NOT EXISTS idx_user_jobs_due ON public.user_jobs (run_after) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_user_jobs_user ON public.user_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_jobs_tenant ON public.user_jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_jobs_expires ON public.user_jobs (expires_at) WHERE expires_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_jobs_idempotency
  ON public.user_jobs (tenant_id, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP TRIGGER IF EXISTS trg_user_jobs_updated_at ON public.user_jobs;
CREATE TRIGGER trg_user_jobs_updated_at BEFORE UPDATE ON public.user_jobs
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

ALTER TABLE public.user_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_jobs TO authenticated;
GRANT ALL ON public.user_jobs TO service_role;

DROP POLICY IF EXISTS user_jobs_select ON public.user_jobs;
CREATE POLICY user_jobs_select ON public.user_jobs FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.user_has_tenant_permission(tenant_id::text, 'settings.edit')
  );

-- ── Claim ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_jobs_claim(
  p_holder text,
  p_lease_seconds integer DEFAULT 120,
  p_limit integer DEFAULT 1,
  p_job_id uuid DEFAULT NULL
)
  RETURNS SETOF public.user_jobs
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  IF p_holder IS NULL OR p_holder = '' THEN
    RAISE EXCEPTION 'holder required';
  END IF;

  -- A job whose invocation died with no attempts left fails for good.
  UPDATE public.user_jobs
     SET status = 'failed',
         error = coalesce(error, 'The job stopped responding and has no retries left'),
         finished_at = now(),
         lease_owner = NULL,
         lease_expires_at = NULL,
         expires_at = now() + interval '7 days'
   WHERE status = 'running'
     AND lease_expires_at < now()
     AND attempts >= max_attempts
     AND (p_job_id IS NULL OR id = p_job_id);

  RETURN QUERY
  WITH picked AS (
    SELECT j.id
      FROM public.user_jobs j
     WHERE (p_job_id IS NULL OR j.id = p_job_id)
       AND ((j.status = 'queued' AND j.run_after <= now() AND j.cancel_requested_at IS NULL)
         OR (j.status = 'running' AND j.lease_expires_at < now()))
     ORDER BY j.run_after, j.created_at
     LIMIT greatest(1, least(coalesce(p_limit, 1), 50))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.user_jobs j
     SET status = 'running',
         lease_owner = p_holder,
         lease_expires_at = now() + make_interval(secs => greatest(10, least(coalesce(p_lease_seconds, 120), 900))),
         heartbeat_at = now(),
         attempts = j.attempts + 1,
         started_at = coalesce(j.started_at, now())
    FROM picked
   WHERE j.id = picked.id
  RETURNING j.*;
END;
$$;

COMMENT ON FUNCTION public.user_jobs_claim(text, integer, integer, uuid) IS 'Claim due user jobs (queued, or running with an expired lease) for one runner; service_role only.';

-- ── Actor (permission re-check) ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_jobs_actor(p_user uuid, p_tenant uuid)
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
    SELECT jsonb_build_object(
      'member', p_user IS NOT NULL AND p_tenant IS NOT NULL AND (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user AND u.tenant_id = p_tenant)
        OR EXISTS (SELECT 1 FROM public.user_memberships m WHERE m.user_id = p_user AND m.tenant_id = p_tenant AND m.is_active)
      ),
      'permissions', coalesce((
        SELECT jsonb_agg(DISTINCT perm ORDER BY perm)
          FROM public.user_roles ur
          JOIN public.roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id
          CROSS JOIN LATERAL unnest(r.permissions) AS perm
         WHERE ur.user_id = p_user AND ur.tenant_id = p_tenant
      ), '[]'::jsonb)
    )
  $$;

COMMENT ON FUNCTION public.user_jobs_actor(uuid, uuid) IS 'Membership and live role permissions of a user in a tenant (what get_user_permissions returns for them); service_role only.';

REVOKE ALL ON FUNCTION public.user_jobs_claim(text, integer, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.user_jobs_actor(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_jobs_claim(text, integer, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.user_jobs_actor(uuid, uuid) TO service_role;

-- ── Notifications link ─────────────────────────────────────────────────────

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS job_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_job_id_fkey') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.user_jobs(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_notifications_job ON public.notifications (job_id) WHERE job_id IS NOT NULL;

-- ── Realtime ───────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_op text;
BEGIN
  IF to_regprocedure('app_realtime.notify_changes()') IS NOT NULL THEN
    FOREACH v_op IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.user_jobs', 'realtime_notify_' || lower(v_op));
      EXECUTE format(
        'CREATE TRIGGER %I AFTER %s ON public.user_jobs REFERENCING %s FOR EACH STATEMENT EXECUTE FUNCTION app_realtime.notify_changes(%L)',
        'realtime_notify_' || lower(v_op), v_op,
        CASE v_op
          WHEN 'INSERT' THEN 'NEW TABLE AS new_rows'
          WHEN 'DELETE' THEN 'OLD TABLE AS old_rows'
          ELSE 'NEW TABLE AS new_rows OLD TABLE AS old_rows'
        END,
        'user_id');
    END LOOP;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_jobs'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_jobs;
  END IF;
END $$;

-- ── Storage ────────────────────────────────────────────────────────────────

DO $storage$
BEGIN
  IF to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found; skipping the job-results bucket';
    RETURN;
  END IF;
  -- Private, no client policies: only the service role reads or writes.
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('job-results', 'job-results', false)
  ON CONFLICT (id) DO UPDATE SET public = false;
END $storage$;

RESET lock_timeout;
