-- ============================================================================
-- 20270112000000_extension_framework.sql
--
-- Platform extension framework (extensibility plan §3.4). Extensions are
-- compiled into the build (USERTASKS_EXTENSIONS); these tables hold their
-- per-instance and per-workspace state. The public build registers no
-- extension and never reads them, so until this migration is applied
-- nothing changes (Settings → Extensions says it is missing).
--
-- 1. public.instance_extensions — one row per extension this instance has
--    seen: installed version, previous version, instance-level settings
--    (config) and encrypted secrets. Service role only.
-- 2. public.tenant_extensions — per-workspace enable / disable, settings
--    (config, config_version) and encrypted secret / certificate values
--    (secrets: enc:v1/v2 ciphertext from lib/secret-crypto, never granted to
--    clients). Disabling keeps config and the extension's data. Members read
--    their current workspace's enabled flag and config through RLS
--    (tenant_id = get_current_tenant_id(), which COALESCEs the current
--    workspace with the home one); every write goes through
--    lib/services/extensions.ts on the service-role client.
-- 3. public.extension_trigger_dedupe — dedupe keys of extension trigger
--    events (generic trigger API): one start per (workspace, trigger type,
--    key). Service role only; rows older than 30 days are purged by the
--    extension events job.
-- 4. public.extension_event_cursors — how far each in-process event
--    subscription has read the event_stream outbox. Service role only.
-- 5. public.notifications.href — an app path a notification opens
--    (extension notification types: ext.<id>.<key>; the bell follows it).
-- 6. supabase_migrations.usertasks_extension_migrations — the extension
--    migration history (lib/admin/ops/extension-migrations.ts, same lock and
--    per-file transaction as the core runner). Created here and by the runner.
--
-- Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

/* ── 1. instance_extensions ─────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.instance_extensions (
  extension_id text PRIMARY KEY CHECK (extension_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' AND char_length(extension_id) <= 41),
  installed_version text NOT NULL,
  previous_version text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secrets jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_version integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.instance_extensions IS
  'Extensions this instance has run: installed version and instance-level settings (secrets encrypted). Written by lib/services/extensions.ts (service role).';

ALTER TABLE public.instance_extensions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instance_extensions FROM anon, authenticated;
GRANT ALL ON public.instance_extensions TO service_role;

/* ── 2. tenant_extensions ───────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.tenant_extensions (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  extension_id text NOT NULL CHECK (extension_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' AND char_length(extension_id) <= 41),
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secrets jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_version integer NOT NULL DEFAULT 0,
  enabled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  enabled_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  PRIMARY KEY (tenant_id, extension_id)
);

COMMENT ON TABLE public.tenant_extensions IS
  'Per-workspace extension state: enabled, settings (config, config_version) and encrypted secrets. Disabling keeps settings and data. Written by lib/services/extensions.ts (service role); members read their workspace''s enabled flag and config.';

CREATE INDEX IF NOT EXISTS idx_tenant_extensions_enabled
  ON public.tenant_extensions (extension_id) WHERE enabled;

ALTER TABLE public.tenant_extensions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_extensions_select ON public.tenant_extensions;
CREATE POLICY tenant_extensions_select ON public.tenant_extensions FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_current_tenant_id()));

REVOKE ALL ON public.tenant_extensions FROM anon, authenticated;
-- Column grant: secrets (ciphertext) is never readable by clients.
GRANT SELECT (tenant_id, extension_id, enabled, config, config_version, enabled_at, disabled_at, updated_at)
  ON public.tenant_extensions TO authenticated;
GRANT ALL ON public.tenant_extensions TO service_role;

/* ── 3. extension_trigger_dedupe ────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.extension_trigger_dedupe (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trigger_type text NOT NULL CHECK (trigger_type ~ '^ext\.[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$'),
  dedupe_key text NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 500),
  started integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, trigger_type, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_extension_trigger_dedupe_created
  ON public.extension_trigger_dedupe (created_at);

COMMENT ON TABLE public.extension_trigger_dedupe IS
  'Extension trigger dedupe keys (lib/extensions/triggers.ts): an event with a key already seen for the workspace and trigger starts nothing. Purged after 30 days.';

ALTER TABLE public.extension_trigger_dedupe ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.extension_trigger_dedupe FROM anon, authenticated;
GRANT ALL ON public.extension_trigger_dedupe TO service_role;

/* ── 4. extension_event_cursors ─────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.extension_event_cursors (
  subscriber text PRIMARY KEY CHECK (char_length(subscriber) <= 200),
  last_event_id bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.extension_event_cursors IS
  'Read position of each extension event subscription in event_stream (lib/extensions/events.ts).';

ALTER TABLE public.extension_event_cursors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.extension_event_cursors FROM anon, authenticated;
GRANT ALL ON public.extension_event_cursors TO service_role;

/* ── 5. notifications.href ──────────────────────────────────────────── */

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS href text
  CHECK (href IS NULL OR (href ~ '^/[^/]' AND char_length(href) <= 2000));

/* ── 6. extension migration history ─────────────────────────────────── */

CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.usertasks_extension_migrations (
  extension_id text NOT NULL,
  version text NOT NULL,
  name text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT current_user,
  PRIMARY KEY (extension_id, version)
);
