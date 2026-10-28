-- Settings → Infrastructure: provider switches and settings changes from the UI.
--
-- instance_provider_switches (migration 20261107000000) becomes the job record
-- for switches started from the page, as well as the audit log of every
-- switch, rollback and provider settings change:
--
--  - kind 'settings': provider options changed without switching provider
--    (rollback restores them like any switch);
--  - status 'queued': a data-moving switch waiting for the background runner
--    (long-running app process or worker); 'cancelled': stopped on request
--    between two steps, before the provider setting changed;
--  - log: the run's output lines (the page shows them live, also for runs
--    of `usertasks-admin switch`);
--  - job: the queued switch's options for the runner (resumable after an
--    interruption). Secret values are stored encrypted with ENCRYPTION_KEY
--    and removed once the switch succeeds;
--  - cancel_requested_at: set by the page's Cancel button; the engine checks
--    it before every step.
--
-- One queued switch at a time (partial unique index). Running switches are
-- serialised by the engine's advisory lock (lib/admin/switch/log.ts).
-- Service-role only, as before: no grants for anon / authenticated.
-- Additive and idempotent: the CLI keeps working against a database without it.

ALTER TABLE public.instance_provider_switches DROP CONSTRAINT IF EXISTS instance_provider_switches_kind_check;
ALTER TABLE public.instance_provider_switches ADD CONSTRAINT instance_provider_switches_kind_check
  CHECK (kind IN ('switch', 'rollback', 'settings'));

ALTER TABLE public.instance_provider_switches DROP CONSTRAINT IF EXISTS instance_provider_switches_status_check;
ALTER TABLE public.instance_provider_switches ADD CONSTRAINT instance_provider_switches_status_check
  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'rolled_back'));

ALTER TABLE public.instance_provider_switches ADD COLUMN IF NOT EXISTS log jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.instance_provider_switches ADD COLUMN IF NOT EXISTS job jsonb;
ALTER TABLE public.instance_provider_switches ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS instance_provider_switches_one_queued
  ON public.instance_provider_switches ((true)) WHERE status = 'queued';

COMMENT ON COLUMN public.instance_provider_switches.job IS
  'Options of a switch queued from Settings → Infrastructure (secret values encrypted; removed when the switch succeeds).';
