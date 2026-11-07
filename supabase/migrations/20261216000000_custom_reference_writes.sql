-- ============================================================================
-- 20261216000000_custom_reference_writes.sql
--
-- Idempotency ledger of custom reference writes (Create / Execute with an
-- idempotency key input) — lib/custom-references/idempotency.ts.
--
-- public.custom_reference_writes: one row per (tenant, reference, key hash).
-- The first call with a key claims it (state 'running'); when it succeeds
-- the row keeps its status and (truncated) result for 24 hours, and a retry
-- with the same key — a retried workflow step, a double-clicked button —
-- gets that result instead of writing again. A failed call deletes its
-- claim so a retry can run. Only a SHA-256 of the key is stored.
--
-- RLS on with no client grants: the server writes and reads with the
-- service role after its own checks. purge_custom_reference_writes()
-- deletes rows older than 7 days (expired rows are also taken over in
-- place, so the table stays small without it; schedule it with pg_cron if
-- wanted).
--
-- Additive and idempotent. Until it is applied, write references run
-- without the ledger (the key is still sent to the API as a header).
-- ============================================================================

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.custom_reference_writes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reference_id  uuid NOT NULL REFERENCES public.integration_references(id) ON DELETE CASCADE,
  key_hash      text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  state         text NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'succeeded')),
  status        integer,
  response      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_reference_writes_key ON public.custom_reference_writes (tenant_id, reference_id, key_hash);
CREATE INDEX IF NOT EXISTS idx_custom_reference_writes_created ON public.custom_reference_writes (created_at);

COMMENT ON TABLE public.custom_reference_writes IS 'Idempotency ledger of custom reference writes (Create / Execute with an idempotency key). Service role only; lib/custom-references/idempotency.ts.';

ALTER TABLE public.custom_reference_writes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.custom_reference_writes FROM anon, authenticated;
GRANT ALL ON TABLE public.custom_reference_writes TO service_role;

CREATE OR REPLACE FUNCTION public.purge_custom_reference_writes()
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH gone AS (
    DELETE FROM public.custom_reference_writes WHERE created_at < now() - interval '7 days' RETURNING 1
  )
  SELECT count(*)::integer FROM gone;
$$;

REVOKE ALL ON FUNCTION public.purge_custom_reference_writes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_custom_reference_writes() TO service_role;
