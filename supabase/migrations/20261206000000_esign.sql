-- ============================================================================
-- 20261206000000_esign.sql
--
-- E-signature connectors (DocuSign, Adobe Acrobat Sign, Dropbox Sign,
-- PandaDoc, SignNow, BoldSign — lib/esign):
--
--  esign_envelopes  the send ledger: one row per (integration, client
--                   reference). A retried "Send for signature" finds its row
--                   and returns the envelope it already sent instead of
--                   sending a duplicate.
--  esign_waits      "Wait for signature" steps: the paused run's event, the
--                   envelope it waits on, the next poll (polling fallback when
--                   webhooks are not configured, and a slow safety net when
--                   they are) and the deadline. claim_due_esign_waits() claims
--                   due rows with SKIP LOCKED for the `esign-poll` tick job.
--  esign_events     verified webhook deliveries and polled transitions by
--                   (integration, dedupe key): a replayed delivery is refused,
--                   and an event seen by both a webhook and a poll fires the
--                   "E-signature event" trigger once.
--
-- RLS on, no client grants: only the server (service role) reads and writes.
-- Adds objects only; idempotent (re-runnable).
-- ============================================================================

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.esign_envelopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  client_reference text NOT NULL,
  envelope_id text,
  -- sending (claimed, provider call in flight) | sent | failed
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  subject text,
  -- Compact normalized envelope as sent (no document bytes).
  envelope jsonb,
  error text,
  run_id uuid,
  node_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, integration_id, client_reference)
);

CREATE INDEX IF NOT EXISTS esign_envelopes_envelope_idx ON public.esign_envelopes (integration_id, envelope_id);

CREATE TABLE IF NOT EXISTS public.esign_waits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  envelope_id text NOT NULL,
  run_id uuid REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  workflow_id uuid,
  node_id text NOT NULL,
  node_label text,
  -- The event the paused run waits on ('esignwait_…', unique).
  event_id text NOT NULL UNIQUE,
  -- Step settings: download on completion, file name, output prefix, poll interval.
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'processing', 'resumed', 'cancelled', 'failed')),
  next_poll_at timestamptz NOT NULL DEFAULT now(),
  poll_count integer NOT NULL DEFAULT 0,
  last_status text,
  deadline_at timestamptz,
  locked_by text,
  locked_at timestamptz,
  outcome text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS esign_waits_due_idx ON public.esign_waits (next_poll_at) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS esign_waits_envelope_idx ON public.esign_waits (integration_id, envelope_id) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS esign_waits_run_idx ON public.esign_waits (run_id);

CREATE TABLE IF NOT EXISTS public.esign_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  dedupe_key text NOT NULL,
  envelope_id text,
  event_type text,
  source text NOT NULL DEFAULT 'webhook' CHECK (source IN ('webhook', 'poll')),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS esign_events_received_idx ON public.esign_events (received_at);

ALTER TABLE public.esign_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esign_waits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esign_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.esign_envelopes, public.esign_waits, public.esign_events FROM anon, authenticated;
GRANT ALL ON public.esign_envelopes, public.esign_waits, public.esign_events TO service_role;

-- Claim up to p_limit due waits (oldest first), marking them processing.
-- A wait whose worker died (processing for over 10 minutes) is claimable again.
CREATE OR REPLACE FUNCTION public.claim_due_esign_waits(p_worker_id text, p_limit integer DEFAULT 10)
  RETURNS SETOF public.esign_waits
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.esign_waits w
     SET status = 'processing', locked_by = p_worker_id, locked_at = now(), updated_at = now()
   WHERE w.id IN (
     SELECT id FROM public.esign_waits
      WHERE (status = 'waiting' AND next_poll_at <= now())
         OR (status = 'processing' AND locked_at < now() - interval '10 minutes')
      ORDER BY next_poll_at
      LIMIT GREATEST(1, LEAST(p_limit, 50))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING w.*;
END
$$;

REVOKE ALL ON FUNCTION public.claim_due_esign_waits(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_esign_waits(text, integer) TO service_role;

-- The tick probe gains `esign_waits` (due or processing waits) so the
-- every-minute `esign-poll` job is skipped when nothing is due. Same function
-- as 20261126000000 plus that key (CREATE OR REPLACE keeps grants).
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

  -- 'processing' too: a poll worker that died leaves rows to reclaim.
  BEGIN
    v := EXISTS (SELECT 1 FROM esign_waits
                  WHERE (status = 'waiting' AND next_poll_at <= now()) OR status = 'processing');
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('esign_waits', v);

  RETURN r;
END;
$$;
