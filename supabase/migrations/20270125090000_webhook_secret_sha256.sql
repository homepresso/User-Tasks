-- Inbound webhook secrets: a SHA-256 at rest (lib/webhook-secret.ts).
--
-- /api/webhooks/inbound used to bcrypt-compare the presented secret on every
-- request (~90 ms of CPU on an M1, ~0.3 s on a Raspberry Pi 5, blocking the
-- event loop). Secrets are 256-bit random values, so — like OAuth tokens — a
-- SHA-256 compared in constant time is enough. New and rotated secrets get it
-- at once; existing rows keep their bcrypt hash, verify once with it and are
-- upgraded by the inbound route (lazy migration). api_key_hash stays (NOT
-- NULL, still written) so an older release keeps verifying after a rollback.
--
-- No index: the row is found by slug (already unique) and the hash compared.
-- Additive and idempotent; plain PostgreSQL (Supabase or 14+). Apply before or
-- after the code: until it is applied the code reads and writes without the
-- column (every request bcrypt-verifies, with a short in-process cache).

ALTER TABLE public.workflow_webhooks
  ADD COLUMN IF NOT EXISTS api_key_sha256 text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workflow_webhooks_api_key_sha256_format'
      AND conrelid = 'public.workflow_webhooks'::regclass
  ) THEN
    ALTER TABLE public.workflow_webhooks
      ADD CONSTRAINT workflow_webhooks_api_key_sha256_format
      CHECK (api_key_sha256 IS NULL OR api_key_sha256 ~ '^[0-9a-f]{64}$');
  END IF;
END
$$;

COMMENT ON COLUMN public.workflow_webhooks.api_key_sha256 IS
  'Hex SHA-256 of the inbound webhook secret (checked in constant time). NULL = legacy row, verified by api_key_hash (bcrypt) and upgraded on first use.';
