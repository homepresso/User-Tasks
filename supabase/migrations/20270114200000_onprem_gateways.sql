-- ============================================================================
-- 20270114200000_onprem_gateways.sql
--
-- On-premises gateways (lib/gateway, packages/gateway): a small service a
-- customer runs inside their network that dials OUT to UserTasks over HTTPS,
-- long-polls for work and runs connector requests against the systems it is
-- allowed to reach (its local allowlist of targets). Lets the cloud edition
-- (serverless, multi-tenant) reach systems behind a firewall — e.g. an
-- on-premises SharePoint farm — without any inbound connection.
--
-- 1. public.gateways — one per gateway (cluster) of a workspace: name, state
--    (active / revoked), what it advertised (targets, relay address,
--    version) and when any of its instances was last seen.
-- 2. public.gateway_keys — one per gateway INSTANCE: its Ed25519 public key
--    (the private key never leaves the customer's machine), registration
--    token hash (one-time, expiring), state (pending / active / rotated /
--    revoked), version, host, last seen. Several active keys = several
--    instances (high availability).
-- 3. public.gateway_jobs — the request queue: one row per connector request
--    (target id + path, never a URL), claimed by one instance under a lease
--    (claim_gateway_jobs, FOR UPDATE SKIP LOCKED), with the outcome and
--    timings. Kept 30 days as the gateway audit trail (bodies are not kept).
-- 4. public.gateway_job_parts — large request / response bodies in parts
--    (deleted once read).
-- 5. public.gateway_nonces — replay protection for signed gateway requests.
-- 6. public.gateway_events — security and lifecycle events (bad signatures,
--    replays, allowlist refusals reported by the gateway, revocations).
--
-- All tables: service role only (no client grants) — every read and write
-- goes through lib/gateway / lib/services/gateways after permission checks.
--
-- Additive and idempotent (nothing is dropped or deleted at upgrade time).
-- Until it is applied, gateways cannot be created (the API answers with a
-- message naming this migration); nothing else changes.
-- ============================================================================

SET lock_timeout = '5s';

/* ── 1. gateways ────────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.gateways (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  description      text CHECK (description IS NULL OR char_length(description) <= 500),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  -- What the instances advertised on their last poll: [{ id, origin }].
  targets          jsonb NOT NULL DEFAULT '[]'::jsonb,
  relay_url        text,
  version          text,
  last_seen_at     timestamptz,
  created_by       uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  revoked_by       uuid REFERENCES public.users (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS gateways_tenant_name_active
  ON public.gateways (tenant_id, lower(name)) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS gateways_tenant ON public.gateways (tenant_id);

COMMENT ON TABLE public.gateways IS
  'On-premises gateways of a workspace (lib/gateway). Service role only.';

/* ── 2. gateway_keys (instances) ────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.gateway_keys (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id              uuid NOT NULL REFERENCES public.gateways (id) ON DELETE CASCADE,
  tenant_id               uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  label                   text CHECK (label IS NULL OR char_length(label) <= 100),
  status                  text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rotated', 'revoked')),
  -- Ed25519 raw public key, base64url (43 chars); null until registered.
  public_key              text CHECK (public_key IS NULL OR public_key ~ '^[A-Za-z0-9_-]{43}$'),
  fingerprint             text,
  -- SHA-256 (hex) of the one-time registration token; cleared once used.
  registration_token_hash text,
  token_expires_at        timestamptz,
  instance_name           text CHECK (instance_name IS NULL OR char_length(instance_name) <= 200),
  hostname                text CHECK (hostname IS NULL OR char_length(hostname) <= 255),
  platform                text CHECK (platform IS NULL OR char_length(platform) <= 100),
  version                 text CHECK (version IS NULL OR char_length(version) <= 50),
  status_report           jsonb,
  registered_at           timestamptz,
  last_seen_at            timestamptz,
  rotated_from            uuid REFERENCES public.gateway_keys (id) ON DELETE SET NULL,
  created_by              uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  revoked_at              timestamptz,
  revoked_reason          text
);

CREATE UNIQUE INDEX IF NOT EXISTS gateway_keys_token
  ON public.gateway_keys (registration_token_hash) WHERE registration_token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS gateway_keys_public_key
  ON public.gateway_keys (public_key) WHERE public_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS gateway_keys_gateway ON public.gateway_keys (gateway_id);

COMMENT ON TABLE public.gateway_keys IS
  'One row per gateway instance key (Ed25519 public key only). Service role only.';

/* ── 3. gateway_jobs ────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.gateway_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  gateway_id        uuid NOT NULL REFERENCES public.gateways (id) ON DELETE CASCADE,
  kind              text NOT NULL DEFAULT 'http' CHECK (kind IN ('http')),
  -- The request: { headers, anonymous, body (inline base64 or parts) }.
  target            text NOT NULL,
  method            text NOT NULL,
  path              text NOT NULL,
  request           jsonb NOT NULL,
  request_bytes     integer NOT NULL DEFAULT 0,
  -- Who asked (audit): the integration and the caller kind.
  integration_id    uuid,
  source            text,
  status            text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('staging', 'queued', 'claimed', 'done', 'failed', 'expired', 'cancelled')),
  replayable        boolean NOT NULL DEFAULT false,
  attempts          integer NOT NULL DEFAULT 0,
  claimed_by        uuid REFERENCES public.gateway_keys (id) ON DELETE SET NULL,
  claimed_at        timestamptz,
  lease_until       timestamptz,
  response          jsonb,
  response_status   integer,
  response_bytes    integer,
  error_code        text,
  error_message     text,
  gateway_ms        integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  completed_at      timestamptz
);

CREATE INDEX IF NOT EXISTS gateway_jobs_queue
  ON public.gateway_jobs (gateway_id, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS gateway_jobs_lease
  ON public.gateway_jobs (lease_until) WHERE status = 'claimed';
CREATE INDEX IF NOT EXISTS gateway_jobs_claimed_by
  ON public.gateway_jobs (claimed_by) WHERE status = 'claimed';
CREATE INDEX IF NOT EXISTS gateway_jobs_tenant_created
  ON public.gateway_jobs (tenant_id, gateway_id, created_at DESC);

COMMENT ON TABLE public.gateway_jobs IS
  'Connector requests queued for on-premises gateways (target id + path, never a URL); the audit trail of every call. Service role only.';

/* ── 4. gateway_job_parts ───────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.gateway_job_parts (
  job_id      uuid NOT NULL REFERENCES public.gateway_jobs (id) ON DELETE CASCADE,
  direction   text NOT NULL CHECK (direction IN ('request', 'response')),
  seq         integer NOT NULL CHECK (seq >= 0 AND seq < 64),
  data        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, direction, seq)
);

COMMENT ON TABLE public.gateway_job_parts IS
  'Large gateway request / response bodies in base64 parts (transient). Service role only.';

/* ── 5. gateway_nonces ──────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.gateway_nonces (
  key_id      uuid NOT NULL,
  nonce       text NOT NULL,
  expires_at  timestamptz NOT NULL,
  PRIMARY KEY (key_id, nonce)
);
CREATE INDEX IF NOT EXISTS gateway_nonces_expiry ON public.gateway_nonces (expires_at);

COMMENT ON TABLE public.gateway_nonces IS
  'Nonces of signed gateway requests (replay protection), purged after expiry. Service role only.';

/* ── 6. gateway_events ──────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.gateway_events (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid REFERENCES public.tenants (id) ON DELETE CASCADE,
  gateway_id  uuid REFERENCES public.gateways (id) ON DELETE CASCADE,
  key_id      uuid,
  type        text NOT NULL CHECK (char_length(type) <= 60),
  severity    text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'error')),
  message     text NOT NULL CHECK (char_length(message) <= 1000),
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gateway_events_gateway ON public.gateway_events (gateway_id, created_at DESC);

COMMENT ON TABLE public.gateway_events IS
  'Security and lifecycle events of on-premises gateways. Service role only.';

/* ── grants: service role only ──────────────────────────────────────── */

ALTER TABLE public.gateways ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_job_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.gateways, public.gateway_keys, public.gateway_jobs, public.gateway_job_parts,
  public.gateway_nonces, public.gateway_events FROM anon, authenticated;
GRANT ALL ON public.gateways, public.gateway_keys, public.gateway_jobs, public.gateway_job_parts,
  public.gateway_nonces, public.gateway_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.gateway_events_id_seq TO service_role;

/* ── claim: one instance takes up to p_max queued jobs ──────────────── */

-- Leases are short: the instance renews them itself (each poll it starts,
-- and a heartbeat every 5 s while it runs jobs). Jobs whose lease ran out
-- (the instance vanished) are handled first: replayable ones (GET / HEAD /
-- OPTIONS) go back to the queue once; the others fail with
-- gateway_instance_lost (never sent twice). Expired queued jobs are marked.
CREATE OR REPLACE FUNCTION public.claim_gateway_jobs(p_gateway_id uuid, p_key_id uuid, p_max integer, p_lease_ms integer)
RETURNS SETOF public.gateway_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.gateway_jobs
     SET status = CASE WHEN replayable AND attempts < 2 AND expires_at > now() THEN 'queued' ELSE 'failed' END,
         error_code = CASE WHEN replayable AND attempts < 2 AND expires_at > now() THEN NULL ELSE 'gateway_instance_lost' END,
         error_message = CASE WHEN replayable AND attempts < 2 AND expires_at > now() THEN NULL
                              ELSE 'The gateway instance running this request stopped answering' END,
         completed_at = CASE WHEN replayable AND attempts < 2 AND expires_at > now() THEN NULL ELSE now() END,
         claimed_by = NULL, lease_until = NULL
   WHERE gateway_id = p_gateway_id AND status = 'claimed' AND lease_until < now();

  UPDATE public.gateway_jobs
     SET status = 'expired', completed_at = now(), error_code = 'gateway_timeout',
         error_message = 'No gateway instance took the request in time'
   WHERE gateway_id = p_gateway_id AND status = 'queued' AND expires_at <= now();

  RETURN QUERY
  UPDATE public.gateway_jobs j
     SET status = 'claimed', claimed_by = p_key_id, claimed_at = now(), attempts = j.attempts + 1,
         lease_until = now() + make_interval(secs => GREATEST(p_lease_ms, 1000) / 1000.0)
   WHERE j.id IN (
     SELECT q.id FROM public.gateway_jobs q
      WHERE q.gateway_id = p_gateway_id AND q.status = 'queued' AND q.expires_at > now()
      ORDER BY q.created_at
      LIMIT GREATEST(LEAST(p_max, 64), 0)
      FOR UPDATE SKIP LOCKED)
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_gateway_jobs(uuid, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_gateway_jobs(uuid, uuid, integer, integer) TO service_role;

/* ── wake-ups: NOTIFY when a job becomes claimable or finishes ──────── */

-- lib/gateway/notify.ts LISTENs on a session-level connection (where one is
-- configured) so idle long polls claim once instead of polling the table.
-- Payloads carry ids only: 'q:<gateway id>' (claimable), 'j:<job id>' (done).
CREATE OR REPLACE FUNCTION public.gateway_jobs_notify()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'queued' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM pg_notify('usertasks_gateway', 'q:' || NEW.gateway_id::text);
  ELSIF NEW.status IN ('done', 'failed', 'expired', 'cancelled') AND TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM pg_notify('usertasks_gateway', 'j:' || NEW.id::text);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_jobs_notify() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS gateway_jobs_notify ON public.gateway_jobs;
CREATE TRIGGER gateway_jobs_notify
  AFTER INSERT OR UPDATE OF status ON public.gateway_jobs
  FOR EACH ROW EXECUTE FUNCTION public.gateway_jobs_notify();
