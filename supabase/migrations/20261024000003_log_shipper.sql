-- Log export phase 4: the shipper.
--
-- * claim_next_log_destination(worker_id, lock_seconds): lease one due
--   destination (enabled, next_attempt_at reached, not leased or lease
--   expired) with FOR UPDATE SKIP LOCKED so overlapping /api/cron/ship-events
--   invocations never send the same batch twice. Returns the row as jsonb
--   (plus the tenant's purged_through mark) or NULL. service_role only.
-- * event_stream_purge_marks: per tenant, the highest event id the retention
--   purge has deleted. A destination whose cursor is below it has lost
--   events (status lagging_data_lost). purge_event_stream() now records it.
-- * log_destinations.updated_at only moves on configuration changes, not on
--   every lease/release by the shipper.
-- * pg_cron job usertasks-ship-events (every minute) → /api/cron/ship-events.
-- * Security fix: the queue worker RPCs (claim/complete/fail for workflow,
--   agent and deletion jobs) were executable by anon and authenticated;
--   several are SECURITY DEFINER, so any signed-in user (or the public anon
--   key) could claim, complete or fail other tenants' jobs. Every caller in
--   the app uses a service-role client, so they are now service_role only.
--
-- Idempotent: safe to run more than once.

-- ── Purge marks ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.event_stream_purge_marks (
  tenant_id      uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  purged_through bigint NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_stream_purge_marks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_stream_purge_marks FROM PUBLIC;
REVOKE ALL ON public.event_stream_purge_marks FROM anon, authenticated;
GRANT ALL ON public.event_stream_purge_marks TO service_role;

COMMENT ON TABLE public.event_stream_purge_marks IS
  'Highest event_stream.id deleted by the retention purge, per tenant. Log destinations with a cursor below it lost events.';

/**
 * Same as 20261024000000_event_stream.sql, plus the purge mark.
 */
CREATE OR REPLACE FUNCTION public.purge_event_stream(
  p_tenant_id uuid,
  p_before timestamptz,
  p_batch_size integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_max_id bigint;
  v_deleted integer;
BEGIN
  SELECT max(id) INTO v_max_id FROM (
    SELECT id FROM public.event_stream
    WHERE tenant_id = p_tenant_id AND occurred_at < p_before
    ORDER BY occurred_at
    LIMIT greatest(1, least(coalesce(p_batch_size, 5000), 50000))
  ) batch;
  IF v_max_id IS NULL THEN RETURN 0; END IF;

  DELETE FROM public.event_stream
  WHERE tenant_id = p_tenant_id AND id <= v_max_id AND occurred_at < p_before;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 THEN
    INSERT INTO public.event_stream_purge_marks AS m (tenant_id, purged_through, updated_at)
    VALUES (p_tenant_id, v_max_id, now())
    ON CONFLICT (tenant_id) DO UPDATE
      SET purged_through = greatest(m.purged_through, EXCLUDED.purged_through), updated_at = now();
  END IF;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_event_stream(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_event_stream(uuid, timestamptz, integer) TO service_role;

-- ── updated_at: configuration changes only ─────────────────────────────────

DROP TRIGGER IF EXISTS trg_log_destinations_updated_at ON public.log_destinations;
CREATE TRIGGER trg_log_destinations_updated_at
  BEFORE UPDATE ON public.log_destinations
  FOR EACH ROW
  WHEN ((OLD.name, OLD.config, OLD.credentials, OLD.filters, OLD.enabled)
        IS DISTINCT FROM (NEW.name, NEW.config, NEW.credentials, NEW.filters, NEW.enabled))
  EXECUTE FUNCTION public.fn_set_updated_at();

-- ── Claim ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_next_log_destination(
  p_worker_id text,
  p_lock_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_row public.log_destinations;
  v_purged bigint;
BEGIN
  IF coalesce(btrim(p_worker_id), '') = '' THEN
    RAISE EXCEPTION 'claim_next_log_destination: worker id is required';
  END IF;

  SELECT d.id INTO v_id
  FROM public.log_destinations d
  WHERE d.enabled
    AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now())
    AND (d.locked_by IS NULL OR d.locked_at IS NULL
         OR d.locked_at < now() - make_interval(secs => greatest(coalesce(p_lock_seconds, 120), 1)))
  ORDER BY d.next_attempt_at NULLS FIRST, d.id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.log_destinations
  SET locked_by = p_worker_id, locked_at = now()
  WHERE id = v_id
  RETURNING * INTO v_row;

  SELECT m.purged_through INTO v_purged
  FROM public.event_stream_purge_marks m
  WHERE m.tenant_id = v_row.tenant_id;

  RETURN to_jsonb(v_row) || jsonb_build_object('purged_through', coalesce(v_purged, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_log_destination(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_log_destination(text, integer) TO service_role;

-- ── Security fix: queue worker RPCs are service_role only ──────────────────

DO $do$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.claim_next_job(text)',
    'public.complete_job(uuid, jsonb)',
    'public.fail_job(uuid, text)',
    'public.claim_next_agent_job(text)',
    'public.complete_agent_job(uuid, jsonb, uuid)',
    'public.fail_agent_job(uuid, text)',
    'public.claim_next_deletion_job(text)',
    'public.complete_deletion_job(uuid)',
    'public.fail_deletion_job(uuid, text)',
    'public.claim_next_directory_sync_run(text)',
    'public.claim_next_github_deployment(text)',
    'public.claim_next_github_sync_run(text)',
    'public.claim_scheduled_sync(uuid, text, text, text)'
  ] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END IF;
  END LOOP;
END;
$do$;

-- ── pg_cron: ship events every minute ──────────────────────────────────────
-- Same pattern as 20261015000002_cron_jobs.sql (app_cron.invoke_endpoint,
-- Vault secrets app_base_url / cron_secret). Each invocation runs ~50 s and
-- leases destinations, so overlapping runs are safe.

DO $do$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed; skipping usertasks-ship-events';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'usertasks-ship-events') THEN
    PERFORM cron.unschedule('usertasks-ship-events');
  END IF;
  PERFORM cron.schedule('usertasks-ship-events', '* * * * *',
    $$select app_cron.invoke_endpoint('/api/cron/ship-events')$$);
END;
$do$;
