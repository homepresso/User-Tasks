-- ============================================================================
-- 20261115000000_forms.sql
--
-- Reusable task forms and form themes (the form designer's library).
--
-- 1. public.forms: a reusable form — name, description, tags, fields (the
--    User Task field list, lib/task-field-schema.ts), layout (the grid,
--    lib/forms/layout.ts), theme (a mini-theme reference,
--    lib/forms/form-theme.ts) and the current version number. A User Task
--    node or task trigger links a form by id; published workflow versions
--    pin the version they were published with, drafts follow the latest.
--
-- 2. public.form_versions: one immutable snapshot per version (written by
--    the service on create and on every content change). A pinned workflow
--    version reads its snapshot; deleting a form deletes its versions.
--
-- 3. public.form_themes: reusable mini themes (overrides only).
--
-- 4. RLS: members read their current workspace's rows; no client writes —
--    the service (lib/services/forms.ts) writes with the service role after
--    its permission checks (forms.view / forms.edit / forms.delete).
--
-- 5. Permissions forms.view / forms.edit / forms.delete: Owner, Admin and
--    Manager get all three; Member and Viewer get forms.view. Appended to the
--    existing system roles and to seed_tenant_roles for new workspaces.
--
-- Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.forms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description  text CHECK (description IS NULL OR char_length(description) <= 2000),
  tags         text[] NOT NULL DEFAULT '{}',
  fields       jsonb NOT NULL DEFAULT '[]'::jsonb,
  layout       jsonb,
  theme        jsonb NOT NULL DEFAULT '{"source":"workspace"}'::jsonb,
  version      integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forms_tenant_updated ON public.forms (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.form_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  form_id      uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  version      integer NOT NULL CHECK (version >= 1),
  name         text NOT NULL,
  fields       jsonb NOT NULL DEFAULT '[]'::jsonb,
  layout       jsonb,
  theme        jsonb NOT NULL DEFAULT '{"source":"workspace"}'::jsonb,
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, version)
);

CREATE INDEX IF NOT EXISTS idx_form_versions_tenant ON public.form_versions (tenant_id, form_id, version DESC);

CREATE TABLE IF NOT EXISTS public.form_themes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description  text CHECK (description IS NULL OR char_length(description) <= 2000),
  overrides    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_themes_tenant_updated ON public.form_themes (tenant_id, updated_at DESC);

COMMENT ON TABLE public.forms IS 'Reusable task forms (fields + grid layout + mini theme). Written by lib/services/forms.ts with the service role.';
COMMENT ON TABLE public.form_versions IS 'Immutable form snapshots; published workflow versions pin one.';
COMMENT ON TABLE public.form_themes IS 'Reusable form mini themes (overrides on the workspace theme).';

DROP TRIGGER IF EXISTS trg_forms_updated_at ON public.forms;
CREATE TRIGGER trg_forms_updated_at BEFORE UPDATE ON public.forms
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
DROP TRIGGER IF EXISTS trg_form_themes_updated_at ON public.form_themes;
CREATE TRIGGER trg_form_themes_updated_at BEFORE UPDATE ON public.form_themes
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ── RLS: read the current workspace's rows; writes are service role only ──

ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_themes ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['forms', 'form_versions', 'form_themes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (tenant_id = (SELECT public.get_current_tenant_id()))',
      t || '_select', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

-- ── Permissions: forms.view / forms.edit / forms.delete ───────────────────

CREATE OR REPLACE FUNCTION public.seed_tenant_roles(p_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  v_all text[] := array[
    'tasks.create', 'tasks.view_own', 'tasks.view_all', 'tasks.assign',
    'tasks.complete', 'tasks.redirect', 'tasks.escalate', 'tasks.delete',
    'tasks.manage_queue', 'workflows.view', 'workflows.create',
    'workflows.edit', 'workflows.activate', 'workflows.delete',
    'workflows.view_runs', 'workflows.manage_runs', 'forms.view', 'forms.edit',
    'forms.delete', 'agents.view', 'agents.create', 'agents.edit',
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
    'workflows.view_runs', 'workflows.manage_runs', 'forms.view', 'forms.edit',
    'forms.delete', 'agents.view', 'agents.create', 'agents.edit',
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
    'tasks.view_own', 'tasks.complete', 'workflows.view', 'forms.view', 'data.view',
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
  FOREACH p IN ARRAY ARRAY['forms.view', 'forms.edit', 'forms.delete'] LOOP
    UPDATE public.roles
    SET permissions = array_append(permissions, p)
    WHERE is_system
      AND slug IN ('owner', 'admin', 'manager')
      AND NOT (p = ANY (permissions));
  END LOOP;
  UPDATE public.roles
  SET permissions = array_append(permissions, 'forms.view')
  WHERE is_system
    AND slug IN ('member', 'viewer')
    AND NOT ('forms.view' = ANY (permissions));
END;
$$;
