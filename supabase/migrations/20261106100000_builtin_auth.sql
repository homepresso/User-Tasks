-- Built-in auth store (providers phase 9b–9d).
--
-- Used when AUTH_PROVIDER is builtin, oidc or saml (lib/providers/auth/builtin).
-- With the default Supabase Auth provider these tables stay empty.
--
-- Schema app_auth is private: no grants to PUBLIC / anon / authenticated, not
-- exposed by PostgREST, not covered by RLS policies. The app reaches it over
-- DATABASE_URL as the connection's own role. public.users stays the profile
-- table; app_auth.credentials.user_id is the same id (FK, cascade on delete).
--
--   credentials   one row per account: email (unique, case-insensitive),
--                 bcrypt hash ($2a$/$2b$/$2y$, cost 10 — Supabase's hashes
--                 copy over as-is; NULL for SSO-only accounts), confirmation,
--                 lockout counters
--   sessions      opaque session tokens (only the SHA-256 is stored), rolling
--                 idle expiry + absolute expiry, revocation
--   tokens        one-time email-confirmation / password-reset tokens (SHA-256
--                 stored, expiry, single use)
--   identities    external identities linked to an account (OIDC issuer+sub,
--                 SAML IdP+NameID, migrated Supabase identities)
--   flow_states   short-lived SSO round-trip state (OIDC state/nonce/PKCE
--                 verifier, SAML AuthnRequest ids)
--   replay_cache  consumed SAML assertion ids until they expire
--
-- Idempotent.

CREATE SCHEMA IF NOT EXISTS app_auth;
REVOKE ALL ON SCHEMA app_auth FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA app_auth FROM anon, authenticated';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_auth.credentials (
  user_id             uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  email               text NOT NULL,
  password_hash       text,
  email_confirmed_at  timestamptz,
  failed_attempts     integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  password_changed_at timestamptz,
  last_sign_in_at     timestamptz,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  migrated_from       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credentials_email_not_blank CHECK (btrim(email) <> ''),
  CONSTRAINT credentials_hash_format CHECK (password_hash IS NULL OR password_hash ~ '^\$2[aby]\$[0-9]{2}\$')
);
CREATE UNIQUE INDEX IF NOT EXISTS credentials_email_key ON app_auth.credentials (lower(email));

CREATE TABLE IF NOT EXISTS app_auth.sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES app_auth.credentials(user_id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,
  method          text NOT NULL DEFAULT 'password',
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  ip              text,
  user_agent      text
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON app_auth.sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON app_auth.sessions (expires_at);

CREATE TABLE IF NOT EXISTS app_auth.tokens (
  token_hash  text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('email_confirmation', 'password_reset')),
  user_id     uuid NOT NULL REFERENCES app_auth.credentials(user_id) ON DELETE CASCADE,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX IF NOT EXISTS tokens_user_id_idx ON app_auth.tokens (user_id, kind);

CREATE TABLE IF NOT EXISTS app_auth.identities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES app_auth.credentials(user_id) ON DELETE CASCADE,
  provider        text NOT NULL,
  subject         text NOT NULL,
  email           text,
  claims          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at timestamptz,
  CONSTRAINT identities_provider_subject_key UNIQUE (provider, subject)
);
CREATE INDEX IF NOT EXISTS identities_user_id_idx ON app_auth.identities (user_id);

CREATE TABLE IF NOT EXISTS app_auth.flow_states (
  id          text PRIMARY KEY,
  kind        text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS flow_states_expires_at_idx ON app_auth.flow_states (expires_at);

CREATE TABLE IF NOT EXISTS app_auth.replay_cache (
  key         text PRIMARY KEY,
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS replay_cache_expires_at_idx ON app_auth.replay_cache (expires_at);

-- Nothing in app_auth is reachable by API roles even if a grant slips in later.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['credentials', 'sessions', 'tokens', 'identities', 'flow_states', 'replay_cache'] LOOP
    EXECUTE format('REVOKE ALL ON app_auth.%I FROM PUBLIC', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON app_auth.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;

-- Housekeeping: expired sessions, tokens, flow states and replay entries.
CREATE OR REPLACE FUNCTION app_auth.purge_expired() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'app_auth'
    AS $$
DECLARE
  n integer := 0;
  c integer;
BEGIN
  DELETE FROM app_auth.sessions WHERE expires_at < now() - interval '1 day' OR revoked_at < now() - interval '1 day';
  GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  DELETE FROM app_auth.tokens WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  DELETE FROM app_auth.flow_states WHERE expires_at < now();
  GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  DELETE FROM app_auth.replay_cache WHERE expires_at < now();
  GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION app_auth.purge_expired() FROM PUBLIC;
