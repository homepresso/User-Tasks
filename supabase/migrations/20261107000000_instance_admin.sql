-- Admin CLI + Infrastructure page (providers phase 11).
--
-- 1. `instance.<option>` keys in instance_settings: instance-wide options
--    that aren't a provider's, starting with `instance.admin_emails` — the
--    instance administrators (who may open Settings → Infrastructure) in
--    addition to the INSTANCE_ADMIN_EMAILS environment variable.
--
-- 2. instance_provider_switches: one row per `usertasks-admin switch` /
--    `rollback` run — the instance-level audit log of provider changes, with
--    the step log, the config snapshot taken before the change (what
--    `rollback <id>` restores) and the environment changes the operator was
--    told to make. Dry runs are not recorded.
--
-- Both are service-role only (RLS on, no policies, no grants for anon or
-- authenticated), like instance_settings: instance infrastructure is not
-- workspace data, and no workspace role — however privileged — reaches it.

ALTER TABLE public.instance_settings DROP CONSTRAINT IF EXISTS instance_settings_key_check;
ALTER TABLE public.instance_settings ADD CONSTRAINT instance_settings_key_check CHECK (
  key ~ '^(providers\.(db|auth|storage|realtime|scheduler|email|secrets)|(db|auth|storage|realtime|scheduler|email|secrets|instance)\.[a-z][a-z0-9_]{0,62})$'
);

CREATE TABLE IF NOT EXISTS public.instance_provider_switches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL DEFAULT 'switch' CHECK (kind IN ('switch', 'rollback')),
  area          text NOT NULL CHECK (area IN ('db', 'auth', 'storage', 'realtime', 'scheduler', 'email', 'secrets')),
  from_provider text,
  to_provider   text NOT NULL,
  -- running → succeeded | failed; a switch that was rolled back → rolled_back.
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed', 'rolled_back')),
  -- For kind = 'rollback': the switch it undid.
  rollback_of   uuid REFERENCES public.instance_provider_switches (id) ON DELETE SET NULL,
  -- [{ id, title, status, detail, started_at, finished_at }]
  steps         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- instance_settings rows before / after (secret rows stay ciphertext), env provider variables.
  config_before jsonb,
  config_after  jsonb,
  -- Environment changes to make by hand (env-managed areas, DATABASE_URL); secrets masked.
  env_changes   jsonb NOT NULL DEFAULT '{}'::jsonb,
  backup_dir    text,
  -- Operator (OS user or --actor) and host the CLI ran on.
  actor         text,
  host          text,
  error         text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

CREATE INDEX IF NOT EXISTS instance_provider_switches_started_idx ON public.instance_provider_switches (started_at DESC);

ALTER TABLE public.instance_provider_switches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instance_provider_switches FROM PUBLIC;
REVOKE ALL ON public.instance_provider_switches FROM anon, authenticated;
GRANT ALL ON public.instance_provider_switches TO service_role;

COMMENT ON TABLE public.instance_provider_switches IS
  'usertasks-admin switch / rollback log (instance-level audit of provider changes). Service role only.';
