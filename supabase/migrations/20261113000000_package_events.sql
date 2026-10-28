-- Package history: one row per install / upgrade / reinstall / downgrade /
-- reconfigure (Complete setup) / uninstall of a package, including failed
-- attempts. package_installs only holds the current state (and its row is
-- deleted on uninstall), so the timeline lives here.
--
-- * when (created_at), who (actor_id), channel (ui / cli / api / mcp) and the
--   file origin (source: file / library / api / cli / mcp, source_label)
-- * version from → to, signature status (signed, signature_valid,
--   fingerprint, trust)
-- * counts (created / updated / unchanged / removed / skipped / errors /
--   rows), requirement changes (met / missing before → after), options
-- * plan: the full dry-run plan / diff that was applied (secrets masked —
--   never values), errors
--
-- install_id has no foreign key: events outlive the install they describe.
-- Service-role only (no client grants, RLS on with no policies), like the
-- other package tables: lib/services/package-events checks packages.view and
-- pins every query to the tenant.
--
-- Backfill: earlier installs, upgrades, setups and uninstalls from the
-- object_audit_log rows the package service wrote (object_type
-- 'package_install'), then one 'install' event for any current install with
-- no audit row. Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS public.package_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  install_id           uuid,
  package_uid          uuid,
  package_name         text NOT NULL,
  package_slug         text,
  action               text NOT NULL,
  status               text NOT NULL DEFAULT 'succeeded',
  from_version         text,
  to_version           text,
  channel              text NOT NULL DEFAULT 'ui',
  source               text,
  source_label         text,
  signed               boolean,
  signature_valid      boolean,
  fingerprint          text,
  trust                text,
  counts               jsonb NOT NULL DEFAULT '{}'::jsonb,
  requirement_changes  jsonb NOT NULL DEFAULT '[]'::jsonb,
  options              jsonb NOT NULL DEFAULT '{}'::jsonb,
  plan                 jsonb,
  errors               jsonb NOT NULL DEFAULT '[]'::jsonb,
  error                text,
  summary              text,
  actor_id             uuid,
  backfilled           boolean NOT NULL DEFAULT false,
  audit_id             uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_events_action_check CHECK (action IN ('install', 'upgrade', 'reinstall', 'downgrade', 'reconfigure', 'uninstall')),
  CONSTRAINT package_events_status_check CHECK (status IN ('succeeded', 'partial', 'failed')),
  CONSTRAINT package_events_channel_check CHECK (channel IN ('ui', 'cli', 'api', 'mcp'))
);
CREATE INDEX IF NOT EXISTS idx_package_events_tenant_created ON public.package_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_package_events_tenant_package ON public.package_events (tenant_id, package_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_package_events_tenant_install ON public.package_events (tenant_id, install_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_package_events_audit ON public.package_events (audit_id) WHERE audit_id IS NOT NULL;

ALTER TABLE public.package_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.package_events FROM PUBLIC;
REVOKE ALL ON public.package_events FROM anon, authenticated;
GRANT ALL ON public.package_events TO service_role;

COMMENT ON TABLE public.package_events IS 'Package history: install / upgrade / reconfigure / uninstall events incl. failed attempts, with the applied plan (secrets masked). Service-role only.';

-- ── Backfill from the audit log ──────────────────────────────────────────

INSERT INTO public.package_events (
  tenant_id, install_id, package_uid, package_name, package_slug, action, status,
  from_version, to_version, channel, source, source_label, signed, fingerprint,
  counts, options, summary, actor_id, backfilled, audit_id, created_at
)
SELECT
  a.tenant_id,
  CASE WHEN a.object_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN a.object_id::uuid END,
  i.package_uid,
  COALESCE(i.name, substring(a.summary FROM '"([^"]+)"'), 'Unknown package'),
  i.slug,
  CASE
    WHEN a.action = 'delete' THEN 'uninstall'
    WHEN a.summary LIKE 'Completed setup%' THEN 'reconfigure'
    WHEN a.metadata->>'mode' IN ('install', 'upgrade', 'reinstall', 'downgrade') THEN a.metadata->>'mode'
    WHEN a.action = 'create' THEN 'install'
    ELSE 'upgrade'
  END,
  CASE WHEN COALESCE((a.metadata->>'errors')::int, 0) > 0 THEN 'partial' ELSE 'succeeded' END,
  CASE
    WHEN a.metadata->>'mode' IN ('upgrade', 'downgrade') THEN substring(a.summary FROM 'graded ([^ ]+) →')
    WHEN a.action = 'delete' THEN substring(a.summary FROM '" ([^:]+):')
    WHEN a.summary LIKE 'Completed setup%' THEN substring(a.summary FROM '" ([^ (]+)')
  END,
  CASE
    WHEN a.action = 'delete' THEN NULL
    WHEN a.summary LIKE 'Completed setup%' THEN substring(a.summary FROM '" ([^ (]+)')
    ELSE a.metadata->>'version'
  END,
  CASE WHEN a.metadata->>'via' IN ('ui', 'api', 'mcp') THEN a.metadata->>'via' ELSE 'ui' END,
  i.source,
  i.source_label,
  (a.metadata->>'signed')::boolean,
  a.metadata->>'fingerprint',
  CASE WHEN a.action = 'delete' THEN jsonb_build_object(
    'removed', COALESCE((a.metadata->>'removed')::int, 0),
    'skipped', COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(a.metadata->'kept') = 'array' THEN a.metadata->'kept' END), 0),
    'errors', COALESCE((a.metadata->>'errors')::int, 0)
  ) ELSE '{}'::jsonb END,
  CASE WHEN a.action = 'delete' THEN jsonb_build_object('force', COALESCE((a.metadata->>'force')::boolean, false), 'delete_data', COALESCE((a.metadata->>'delete_data')::boolean, false)) ELSE '{}'::jsonb END,
  a.summary,
  a.actor_id,
  true,
  a.id,
  a.created_at
FROM public.object_audit_log a
LEFT JOIN public.package_installs i
  ON i.tenant_id = a.tenant_id AND i.id::text = a.object_id
WHERE a.object_type = 'package_install'
  AND NOT EXISTS (SELECT 1 FROM public.package_events e WHERE e.audit_id = a.id);

-- Current installs with no history at all (e.g. audit rows already purged).
INSERT INTO public.package_events (
  tenant_id, install_id, package_uid, package_name, package_slug, action, status,
  from_version, to_version, channel, source, source_label, signed, signature_valid, fingerprint, trust,
  summary, actor_id, backfilled, created_at
)
SELECT
  i.tenant_id, i.id, i.package_uid, i.name, i.slug,
  CASE WHEN i.previous_version IS NOT NULL THEN 'upgrade' ELSE 'install' END,
  'succeeded', i.previous_version, i.version,
  CASE WHEN i.source IN ('api', 'cli', 'mcp') THEN i.source ELSE 'ui' END,
  i.source, i.source_label, i.signed, i.signature_valid, i.fingerprint, i.manifest->>'trust',
  'Recorded from the package library (no earlier history)', i.installed_by, true, i.installed_at
FROM public.package_installs i
WHERE NOT EXISTS (SELECT 1 FROM public.package_events e WHERE e.tenant_id = i.tenant_id AND e.install_id = i.id);
