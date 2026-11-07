-- ============================================================================
-- 20261201000000_form_controls.sql
--
-- Custom form controls (web components) for the form designer.
--
-- 1. public.form_controls: one row per control in a workspace, keyed by its
--    custom element tag (unique per workspace). `enabled` offers it in the
--    designer palette and lets its frames load (off = a kill switch);
--    `trusted` (set by instance admins only) renders it inline in the page
--    instead of a sandboxed iframe; `approved_hosts` are the network hosts
--    an admin allowed, a subset of what the manifest asks for.
--
-- 2. public.form_control_versions: immutable versions (semver, unique per
--    control): the validated manifest, the ES module snapshot (never a
--    third-party URL at runtime), its SHA-256, size, where it came from
--    (upload, URL import, config import, package) and an optional
--    signature record.
--
-- 3. RLS: members read their current workspace's rows; no client writes —
--    lib/services/form-controls.ts writes with the service role after its
--    permission checks (extensibility.view / create / edit / delete).
--
-- Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.form_controls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tag             text NOT NULL CHECK (char_length(tag) BETWEEN 3 AND 100 AND tag ~ '^[a-z][a-z0-9._]*-[a-z0-9._-]*$'),
  name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description     text CHECK (description IS NULL OR char_length(description) <= 2000),
  icon            text CHECK (icon IS NULL OR char_length(icon) <= 8192),
  latest_version  text NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  trusted         boolean NOT NULL DEFAULT false,
  approved_hosts  text[] NOT NULL DEFAULT '{}',
  created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_form_controls_tenant_updated ON public.form_controls (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.form_control_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  control_id   uuid NOT NULL REFERENCES public.form_controls(id) ON DELETE CASCADE,
  version      text NOT NULL CHECK (char_length(version) BETWEEN 5 AND 64),
  manifest     jsonb NOT NULL,
  bundle       text NOT NULL CHECK (octet_length(bundle) <= 1048576),
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes   integer NOT NULL CHECK (size_bytes >= 0),
  source       text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'url', 'import', 'package')),
  source_url   text CHECK (source_url IS NULL OR char_length(source_url) <= 2000),
  signature    jsonb,
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (control_id, version)
);

CREATE INDEX IF NOT EXISTS idx_form_control_versions_tenant ON public.form_control_versions (tenant_id, control_id);

COMMENT ON TABLE public.form_controls IS 'Custom form controls (web components) in a workspace library. Written by lib/services/form-controls.ts with the service role.';
COMMENT ON TABLE public.form_control_versions IS 'Immutable custom form control versions: manifest, ES module snapshot, SHA-256, signature.';

DROP TRIGGER IF EXISTS trg_form_controls_updated_at ON public.form_controls;
CREATE TRIGGER trg_form_controls_updated_at BEFORE UPDATE ON public.form_controls
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ── RLS: read the current workspace's rows; writes are service role only ──

ALTER TABLE public.form_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_control_versions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['form_controls', 'form_control_versions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (tenant_id = (SELECT public.get_current_tenant_id()))',
      t || '_select', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;
