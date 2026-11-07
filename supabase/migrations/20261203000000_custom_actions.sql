-- ============================================================================
-- 20261203000000_custom_actions.sql
--
-- Custom workflow actions (Extensibility → Workflow actions) become
-- production-grade: sandboxed execution, a kill switch, administrator
-- grants, immutable versions with checksums and signatures, and secrets
-- the code can only read by declared name.
--
-- 1. public.custom_workflow_activities gains:
--      enabled         kill switch (off = steps using it fail fast; hidden
--                      from the designer palette)
--      runtime         'module' (manifest v1 ES module, the new contract) or
--                      'legacy' (the old script body; also sandboxed now)
--      approved_hosts  HTTP hosts an administrator approved (a subset of
--                      the manifest's capabilities.http.hosts)
--      data_grants     [{ table_id, name, access: read | write }] data tables
--                      an administrator granted
--      sha256          SHA-256 of source_code (hex)
--      signature       signature record (ed25519; key fingerprint; verified;
--                      via 'package' for signed gallery packages)
--      origin          editor | upload | import | package
--
-- 2. public.custom_workflow_activity_versions: immutable versions (semver,
--    unique per action): manifest, module snapshot, SHA-256, size, origin,
--    signature. The activity row carries the current version.
--
-- 3. public.custom_workflow_activity_secrets: values for the secrets an
--    action declares, encrypted by the app (enc:v… ciphertext). No client
--    access at all — only the service role reads them, at run time.
--
-- 4. RLS: members read their current workspace's actions and versions; no
--    client writes (they used to be writable by any member through the
--    tenant_isolation policy) — lib/services/workflow-activities.ts writes
--    with the service role after its permission checks.
--
-- Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

ALTER TABLE public.custom_workflow_activities
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS runtime text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS approved_hosts text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS data_grants jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sha256 text,
  ADD COLUMN IF NOT EXISTS signature jsonb,
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'editor';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_workflow_activities_runtime_check') THEN
    ALTER TABLE public.custom_workflow_activities
      ADD CONSTRAINT custom_workflow_activities_runtime_check CHECK (runtime IN ('legacy', 'module'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_workflow_activities_origin_check') THEN
    ALTER TABLE public.custom_workflow_activities
      ADD CONSTRAINT custom_workflow_activities_origin_check CHECK (origin IN ('editor', 'upload', 'import', 'package'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_workflow_activities_sha256_check') THEN
    ALTER TABLE public.custom_workflow_activities
      ADD CONSTRAINT custom_workflow_activities_sha256_check CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_workflow_activities_data_grants_check') THEN
    ALTER TABLE public.custom_workflow_activities
      ADD CONSTRAINT custom_workflow_activities_data_grants_check CHECK (jsonb_typeof(data_grants) = 'array');
  END IF;
END $$;

UPDATE public.custom_workflow_activities
   SET sha256 = encode(extensions.digest(convert_to(source_code, 'UTF8'), 'sha256'), 'hex')
 WHERE sha256 IS NULL;

CREATE TABLE IF NOT EXISTS public.custom_workflow_activity_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  activity_id  uuid NOT NULL REFERENCES public.custom_workflow_activities(id) ON DELETE CASCADE,
  version      text NOT NULL CHECK (char_length(version) BETWEEN 1 AND 64),
  runtime      text NOT NULL DEFAULT 'module' CHECK (runtime IN ('legacy', 'module')),
  manifest     jsonb NOT NULL,
  source_code  text NOT NULL CHECK (octet_length(source_code) <= 1048576),
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes   integer NOT NULL CHECK (size_bytes >= 0),
  origin       text NOT NULL DEFAULT 'upload' CHECK (origin IN ('editor', 'upload', 'import', 'package')),
  signature    jsonb,
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_id, version)
);

CREATE INDEX IF NOT EXISTS idx_custom_workflow_activity_versions_tenant
  ON public.custom_workflow_activity_versions (tenant_id, activity_id);

CREATE TABLE IF NOT EXISTS public.custom_workflow_activity_secrets (
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  activity_id  uuid NOT NULL REFERENCES public.custom_workflow_activities(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{1,62}$'),
  value        text NOT NULL CHECK (char_length(value) <= 20000),
  updated_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, name)
);

CREATE INDEX IF NOT EXISTS idx_custom_workflow_activity_secrets_tenant
  ON public.custom_workflow_activity_secrets (tenant_id);

COMMENT ON TABLE public.custom_workflow_activity_versions IS 'Immutable custom workflow action versions: manifest, module snapshot, SHA-256, signature. Written by lib/services/workflow-activities.ts with the service role.';
COMMENT ON TABLE public.custom_workflow_activity_secrets IS 'Encrypted values of the secrets a custom workflow action declares. Service role only (read at run time, never returned).';

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.custom_workflow_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_workflow_activity_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_workflow_activity_secrets ENABLE ROW LEVEL SECURITY;

-- Activities and versions: read the current workspace's rows; writes are service role only.
DROP POLICY IF EXISTS tenant_isolation ON public.custom_workflow_activities;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['custom_workflow_activities', 'custom_workflow_activity_versions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (tenant_id = (SELECT public.get_current_tenant_id()))',
      t || '_select', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

-- Secrets: no client access (no policies; no grants).
REVOKE ALL ON TABLE public.custom_workflow_activity_secrets FROM anon, authenticated;
GRANT ALL ON TABLE public.custom_workflow_activity_secrets TO service_role;
