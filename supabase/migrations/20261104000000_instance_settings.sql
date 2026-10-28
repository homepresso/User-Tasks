-- Instance-wide runtime settings (lib/config/instance-settings.ts).
--
-- Holds provider choices (`providers.<area>`) and provider options
-- (`<area>.<option>`) that can change without a redeploy. Bootstrap values
-- (Supabase URL/keys, DATABASE_URL, ENCRYPTION_KEY) never live here: they are
-- needed to reach this table. Environment variables override every row.
--
-- Secret rows store `value` as a JSON string holding the lib/secret-crypto
-- ciphertext ("enc:v1:…") of the JSON value; the CHECK below refuses a secret
-- row that isn't encrypted, so plaintext secrets can't be written by mistake.
--
-- Service role only: RLS on with no policies and no grants for anon or
-- authenticated. Instance configuration is not workspace data — no member,
-- however privileged in their workspace, can read or change it.

CREATE TABLE IF NOT EXISTS public.instance_settings (
  key        text PRIMARY KEY
             CHECK (key ~ '^(providers\.(db|auth|storage|realtime|scheduler|email|secrets)|(db|auth|storage|realtime|scheduler|email|secrets)\.[a-z][a-z0-9_]{0,62})$'),
  value      jsonb NOT NULL,
  secret     boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Actor id (a user, or NULL for the admin CLI / migrations). No FK: the
  -- auth provider (and its users table) is itself configurable.
  updated_by uuid,
  CONSTRAINT instance_settings_secret_encrypted CHECK (
    NOT secret OR (jsonb_typeof(value) = 'string' AND (value #>> '{}') LIKE 'enc:v1:%')
  )
);

ALTER TABLE public.instance_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instance_settings FROM PUBLIC;
REVOKE ALL ON public.instance_settings FROM anon, authenticated;
GRANT ALL ON public.instance_settings TO service_role;

COMMENT ON TABLE public.instance_settings IS
  'Instance-wide runtime settings (provider ids and options). Service role only; secrets encrypted with ENCRYPTION_KEY.';
