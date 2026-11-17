-- Edition download access log (usertasks.com): one row per request to
-- POST /api/public/extensions/<edition>/pull-token (lib/editions/pull-service.ts),
-- issued or refused. Cloud (usertasks.com) only: self-hosted installations
-- never write here.
--
--  * Never holds a credential: no pull token (only its id, `token_id`), no
--    licence document, no IP address (a salted sha256, `ip_hash`).
--  * Service role only: no policies for anon / authenticated.
--  * No pg_cron job of its own (one scheduler tick, 20261103100000): prune
--    old rows by hand, e.g. DELETE … WHERE created_at < now() - interval '400 days'.
--
-- Additive and idempotent. Until it is applied, the endpoint works and logs a
-- warning once per process instead of a row.

CREATE TABLE IF NOT EXISTS public.edition_pull_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  edition           text NOT NULL CHECK (edition ~ '^[a-z][a-z0-9-]{0,40}$'),
  -- issued: a token was returned; denied: the licence was refused;
  -- not_found: no build for the requested version; error: upstream problem
  outcome           text NOT NULL CHECK (outcome IN ('issued', 'denied', 'not_found', 'error')),
  code              text CHECK (code IS NULL OR length(code) <= 64),
  licence_id        text CHECK (licence_id IS NULL OR length(licence_id) <= 200),
  trial             boolean,
  -- install | upgrade | bundle | switch (as the client said)
  purpose           text CHECK (purpose IS NULL OR purpose IN ('install', 'upgrade', 'bundle', 'switch')),
  requested_version text CHECK (requested_version IS NULL OR length(requested_version) <= 64),
  edition_version   text CHECK (edition_version IS NULL OR length(edition_version) <= 130),
  -- the token's jti (not the token)
  token_id          text CHECK (token_id IS NULL OR length(token_id) <= 64),
  token_expires_at  timestamptz,
  ip_hash           text CHECK (ip_hash IS NULL OR length(ip_hash) <= 128),
  user_agent        text CHECK (user_agent IS NULL OR length(user_agent) <= 200),
  instance_id       text CHECK (instance_id IS NULL OR length(instance_id) <= 64)
);

CREATE INDEX IF NOT EXISTS idx_edition_pull_log_created ON public.edition_pull_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edition_pull_log_licence ON public.edition_pull_log (licence_id, created_at DESC) WHERE licence_id IS NOT NULL;

ALTER TABLE public.edition_pull_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.edition_pull_log FROM PUBLIC;
REVOKE ALL ON public.edition_pull_log FROM anon, authenticated;
GRANT ALL ON public.edition_pull_log TO service_role;

COMMENT ON TABLE public.edition_pull_log IS
  'Edition download (pull-token) requests on usertasks.com, issued or refused. No credentials, no licence bodies, hashed IPs. Service role only.';
