-- Packages: author, version, sign, install and upgrade bundles of workspace
-- artifacts (a workflow and everything it needs) across environments.
--
-- * packages               — authored packages (root artifacts, selected
--                            items, per-table data mode) in a workspace
-- * package_versions       — built versions (manifest.json header + files
--                            of the .utpkg; the archive is rebuilt
--                            byte-identically from them on download)
-- * package_installs       — the package library of a workspace: installed
--                            packages (version, source, signer, status
--                            complete / incomplete, requirement status and the
--                            NON-secret requirement values to keep on upgrade)
-- * package_install_assets — package asset id ↔ local id per install
--                            (upgrade in place, uninstall, local-change
--                            detection via content_hash; data rows too)
-- * package_signing_keys   — the instance's ed25519 signing key (private key
--                            encrypted with ENCRYPTION_KEY; generated on
--                            first build). PACKAGE_SIGNING_KEY overrides it.
--
-- All five are service-role only (no client grants), like log_destinations:
-- lib/services/packages* checks permissions and pins every query to the
-- tenant.
--
-- Permissions packages.view / packages.manage / packages.install: System
-- Owner/Admin/Manager roles get all three (new tenants via
-- seed_tenant_roles, which mirrors SYSTEM_ROLES in lib/tenant-provisioning.ts;
-- existing tenants via the UPDATE below). Member/Viewer and custom roles opt
-- in. The first-party CLI client may request packages:read / packages:write.
--
-- Idempotent: safe to run more than once.

-- ── Tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.packages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  package_uid     uuid NOT NULL DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            text NOT NULL,
  description     text,
  author          text,
  icon            text,
  readme          text,
  roots           jsonb NOT NULL DEFAULT '[]'::jsonb,
  items           jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded        jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_modes      jsonb NOT NULL DEFAULT '{}'::jsonb,
  latest_version  text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT packages_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT packages_slug_check CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  CONSTRAINT packages_tenant_slug_key UNIQUE (tenant_id, slug),
  CONSTRAINT packages_tenant_uid_key UNIQUE (tenant_id, package_uid)
);

CREATE TABLE IF NOT EXISTS public.package_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  package_id      uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  version         text NOT NULL,
  manifest        jsonb NOT NULL,
  files           jsonb NOT NULL DEFAULT '[]'::jsonb,
  checksum        text NOT NULL,
  signed          boolean NOT NULL DEFAULT false,
  fingerprint     text,
  size_bytes      integer NOT NULL DEFAULT 0,
  asset_count     integer NOT NULL DEFAULT 0,
  notes           text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_versions_version_key UNIQUE (package_id, version)
);
CREATE INDEX IF NOT EXISTS idx_package_versions_tenant ON public.package_versions (tenant_id, package_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.package_installs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  package_uid         uuid NOT NULL,
  name                text NOT NULL,
  slug                text NOT NULL,
  version             text NOT NULL,
  previous_version    text,
  description         text,
  source              text NOT NULL DEFAULT 'file',
  source_label        text,
  checksum            text NOT NULL,
  signed              boolean NOT NULL DEFAULT false,
  signature_valid     boolean,
  fingerprint         text,
  status              text NOT NULL DEFAULT 'complete',
  requirements        jsonb NOT NULL DEFAULT '[]'::jsonb,
  requirement_values  jsonb NOT NULL DEFAULT '{}'::jsonb,
  manifest            jsonb NOT NULL DEFAULT '{}'::jsonb,
  installed_by        uuid,
  installed_at        timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_installs_status_check CHECK (status IN ('complete', 'incomplete')),
  CONSTRAINT package_installs_source_check CHECK (source IN ('file', 'library', 'api', 'cli', 'mcp')),
  CONSTRAINT package_installs_tenant_uid_key UNIQUE (tenant_id, package_uid)
);

CREATE TABLE IF NOT EXISTS public.package_install_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  install_id      uuid NOT NULL REFERENCES public.package_installs(id) ON DELETE CASCADE,
  asset_type      text NOT NULL,
  section         text NOT NULL,
  source_id       text NOT NULL,
  local_id        uuid NOT NULL,
  name            text,
  content_hash    text,
  status          text NOT NULL DEFAULT 'ok',
  blocked_by      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_install_assets_status_check CHECK (status IN ('ok', 'needs_config', 'removed_upstream')),
  CONSTRAINT package_install_assets_key UNIQUE (install_id, asset_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_package_install_assets_local ON public.package_install_assets (tenant_id, asset_type, local_id);

CREATE TABLE IF NOT EXISTS public.package_signing_keys (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose                text NOT NULL DEFAULT 'packages',
  public_key             text NOT NULL,
  private_key_encrypted  text NOT NULL,
  fingerprint            text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_signing_keys_purpose_key UNIQUE (purpose)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['packages', 'package_versions', 'package_installs', 'package_install_assets', 'package_signing_keys'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS trg_packages_updated_at ON public.packages;
CREATE TRIGGER trg_packages_updated_at BEFORE UPDATE ON public.packages
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
DROP TRIGGER IF EXISTS trg_package_installs_updated_at ON public.package_installs;
CREATE TRIGGER trg_package_installs_updated_at BEFORE UPDATE ON public.package_installs
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
DROP TRIGGER IF EXISTS trg_package_install_assets_updated_at ON public.package_install_assets;
CREATE TRIGGER trg_package_install_assets_updated_at BEFORE UPDATE ON public.package_install_assets
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

COMMENT ON TABLE public.packages IS 'Authored packages: root artifacts, selected items and per-table data mode. Service-role only.';
COMMENT ON TABLE public.package_versions IS 'Built package versions (.utpkg manifest.json + files; rebuilt byte-identically on download). Never holds secrets. Service-role only.';
COMMENT ON TABLE public.package_installs IS 'Package library: installed packages, status (complete/incomplete), requirement status and non-secret requirement values. Service-role only.';
COMMENT ON TABLE public.package_install_assets IS 'Package asset id ↔ local id per install (upgrade in place, uninstall, local-change detection). Service-role only.';
COMMENT ON TABLE public.package_signing_keys IS 'Instance ed25519 package signing key (private key encrypted with ENCRYPTION_KEY). Service-role only.';

-- ── Permissions: packages.view / packages.manage / packages.install ──────

CREATE OR REPLACE FUNCTION public.seed_tenant_roles(p_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  v_all text[] := array[
    'tasks.create', 'tasks.view_own', 'tasks.view_all', 'tasks.assign',
    'tasks.complete', 'tasks.redirect', 'tasks.escalate', 'tasks.delete',
    'tasks.manage_queue', 'workflows.view', 'workflows.create',
    'workflows.edit', 'workflows.activate', 'workflows.delete',
    'workflows.view_runs', 'workflows.manage_runs', 'agents.view', 'agents.create', 'agents.edit',
    'agents.test', 'agents.delete', 'integrations.view',
    'integrations.create', 'integrations.edit', 'integrations.test',
    'integrations.delete', 'integrations.manage_references',
    'extensibility.view', 'extensibility.create', 'extensibility.edit',
    'extensibility.delete', 'data.view', 'data.create', 'data.edit_schema',
    'data.manage_rows', 'data.delete', 'reports.view', 'reports.create',
    'reports.edit_own', 'reports.share', 'reports.delete',
    'team.view_members', 'team.invite', 'team.remove', 'team.change_roles',
    'settings.view', 'settings.edit', 'settings.manage_api_keys',
    'settings.manage_webhooks', 'sync.view', 'sync.manage', 'sync.deploy',
    'observability.view', 'packages.view', 'packages.manage', 'packages.install'
  ];
  -- ALL minus settings.manage_*, settings.edit, team.change_roles, team.remove,
  -- observability.view
  v_manager text[] := array[
    'tasks.create', 'tasks.view_own', 'tasks.view_all', 'tasks.assign',
    'tasks.complete', 'tasks.redirect', 'tasks.escalate', 'tasks.delete',
    'tasks.manage_queue', 'workflows.view', 'workflows.create',
    'workflows.edit', 'workflows.activate', 'workflows.delete',
    'workflows.view_runs', 'workflows.manage_runs', 'agents.view', 'agents.create', 'agents.edit',
    'agents.test', 'agents.delete', 'integrations.view',
    'integrations.create', 'integrations.edit', 'integrations.test',
    'integrations.delete', 'integrations.manage_references',
    'extensibility.view', 'extensibility.create', 'extensibility.edit',
    'extensibility.delete', 'data.view', 'data.create', 'data.edit_schema',
    'data.manage_rows', 'data.delete', 'reports.view', 'reports.create',
    'reports.edit_own', 'reports.share', 'reports.delete',
    'team.view_members', 'team.invite', 'settings.view', 'sync.view',
    'sync.manage', 'sync.deploy', 'packages.view', 'packages.manage',
    'packages.install'
  ];
  v_viewer text[] := array[
    'tasks.view_own', 'tasks.complete', 'workflows.view', 'data.view',
    'reports.view', 'team.view_members'
  ];
  v_member text[] := v_viewer || array[
    'tasks.create', 'tasks.assign', 'data.manage_rows', 'reports.create',
    'reports.edit_own'
  ];
begin
  insert into roles (tenant_id, name, slug, description, permissions, is_system, base_role) values
    (p_tenant_id, 'Owner',   'owner',   'Full access to everything, including billing and API keys', v_all,     true, 'owner'),
    (p_tenant_id, 'Admin',   'admin',   'Full administrative access',                                v_all,     true, 'admin'),
    (p_tenant_id, 'Manager', 'manager', 'Builds and manages work; no org administration',            v_manager, true, 'manager'),
    (p_tenant_id, 'Member',  'member',  'Works tasks, data, and reports',                            v_member,  true, 'member'),
    (p_tenant_id, 'Viewer',  'viewer',  'Read-only access',                                          v_viewer,  true, 'viewer');
end;
$$;

DO $$
DECLARE p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['packages.view', 'packages.manage', 'packages.install'] LOOP
    UPDATE public.roles
    SET permissions = array_append(permissions, p)
    WHERE is_system
      AND slug IN ('owner', 'admin', 'manager')
      AND NOT (p = ANY (permissions));
  END LOOP;
END;
$$;

-- Scopes appended to the usertasks-cli seed (20261023000000_oauth_first_party_cli.sql).
UPDATE public.oauth_clients
SET allowed_scopes = array_append(allowed_scopes, 'packages:read')
WHERE client_id = 'usertasks-cli'
  AND is_first_party
  AND NOT ('packages:read' = ANY (allowed_scopes));

UPDATE public.oauth_clients
SET allowed_scopes = array_append(allowed_scopes, 'packages:write')
WHERE client_id = 'usertasks-cli'
  AND is_first_party
  AND NOT ('packages:write' = ANY (allowed_scopes));
