-- KMS envelope encryption (providers phase 14).
--
-- 1. The `kms` provider area: `providers.kms` / `kms.<option>` keys in
--    instance_settings and `kms` in the provider switch log. Secret settings
--    may now hold `enc:v2:` ciphertext (a data key) as well as `enc:v1:`.
--
-- 2. app_kms.data_keys: data-encryption keys, stored only wrapped by the
--    configured KMS (env = ENCRYPTION_KEY, Vault Transit, AWS KMS, Azure Key
--    Vault / Managed HSM, Google Cloud KMS). `id` is the key id in `enc:v2:<id>:`
--    ciphertext and the wrap context; check_value is an HMAC of the key (not
--    the key) that proves an unwrap produced the right bytes. The newest key
--    whose activates_at has passed encrypts new values; every key decrypts.
--    Written only by `usertasks-admin kms rotate | rewrap-keys | prune` and
--    `switch kms`; read by the app at startup through app_kms_data_keys().
--    Without rows (the default) nothing changes: secrets stay enc:v1.
--
-- 3. app_kms.rewrap_runs: progress of `usertasks-admin kms rewrap` (one row
--    per run; a cursor per secret column, committed with each batch), so an
--    interrupted or failed run resumes where it stopped.
--
-- Both tables are unreachable for anon / authenticated / service_role (no
-- grants); only the function below exposes the wrapped keys, to service_role.
-- Idempotent (safe to re-run).

ALTER TABLE public.instance_settings DROP CONSTRAINT IF EXISTS instance_settings_key_check;
ALTER TABLE public.instance_settings ADD CONSTRAINT instance_settings_key_check CHECK (
  key ~ '^(providers\.(db|auth|storage|realtime|scheduler|email|secrets|cache|kms)|(db|auth|storage|realtime|scheduler|email|secrets|cache|kms|instance)\.[a-z][a-z0-9_]{0,62})$'
);

ALTER TABLE public.instance_settings DROP CONSTRAINT IF EXISTS instance_settings_secret_encrypted;
ALTER TABLE public.instance_settings ADD CONSTRAINT instance_settings_secret_encrypted CHECK (
  NOT secret OR (jsonb_typeof(value) = 'string' AND (value #>> '{}') ~ '^enc:v[0-9]+:')
);

ALTER TABLE public.instance_provider_switches DROP CONSTRAINT IF EXISTS instance_provider_switches_area_check;
ALTER TABLE public.instance_provider_switches ADD CONSTRAINT instance_provider_switches_area_check
  CHECK (area IN ('db', 'auth', 'storage', 'realtime', 'scheduler', 'email', 'secrets', 'cache', 'kms'));

CREATE SCHEMA IF NOT EXISTS app_kms;
REVOKE ALL ON SCHEMA app_kms FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA app_kms FROM anon, authenticated, service_role';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_kms.data_keys (
  id           integer PRIMARY KEY CHECK (id > 0),
  -- KMS provider id that wrapped the key, and the KEK it used (key id / ARN /
  -- versioned key URL / Transit key / ENCRYPTION_KEY check value).
  provider     text NOT NULL,
  kek_ref      text NOT NULL,
  wrapped_key  text NOT NULL,
  check_value  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  activates_at timestamptz NOT NULL DEFAULT now(),
  created_by   text,
  rewrapped_at timestamptz
);
REVOKE ALL ON app_kms.data_keys FROM PUBLIC;

CREATE TABLE IF NOT EXISTS app_kms.rewrap_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_key_id integer NOT NULL,
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  -- { "<table>.<column>": { "cursor": <last primary key>, "scanned": n, "rewrapped": n, "done": bool } }
  progress      jsonb NOT NULL DEFAULT '{}'::jsonb,
  error         text,
  actor         text,
  host          text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX IF NOT EXISTS rewrap_runs_started_idx ON app_kms.rewrap_runs (started_at DESC);
REVOKE ALL ON app_kms.rewrap_runs FROM PUBLIC;

COMMENT ON TABLE app_kms.data_keys IS
  'KMS-wrapped data-encryption keys (enc:v2 ciphertext). Never unwrapped in the database.';
COMMENT ON TABLE app_kms.rewrap_runs IS
  'usertasks-admin kms rewrap progress (resumable).';

-- The wrapped keys, for app startup (service role only).
CREATE OR REPLACE FUNCTION public.app_kms_data_keys()
  RETURNS TABLE (id integer, provider text, kek_ref text, wrapped_key text, check_value text, created_at timestamptz, activates_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'app_kms', 'pg_catalog'
AS $$
  SELECT k.id, k.provider, k.kek_ref, k.wrapped_key, k.check_value, k.created_at, k.activates_at
    FROM app_kms.data_keys k ORDER BY k.id;
$$;

REVOKE ALL ON FUNCTION public.app_kms_data_keys() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.app_kms_data_keys() FROM anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.app_kms_data_keys() TO service_role';
  END IF;
END $$;
