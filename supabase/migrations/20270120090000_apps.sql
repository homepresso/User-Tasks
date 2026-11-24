-- App builder (Phase 1): apps, their pages, audience and editors.
--
-- An app is a named container (name, subtitle, icon, colour, slug, description) with
-- ordered pages built from widgets (app_pages.layout), its own menu
-- (apps.menu) and an audience of users, teams and roles. Builders are the
-- people holding apps.manage in the workspace plus the app's named editors.
-- Written by lib/services/apps.ts with the service role after its own
-- permission checks; the browser and the session client only read.
--
-- 1. Tables: apps, app_pages, app_audience, app_editors (tenant-scoped; child
--    rows take tenant_id from their app in a trigger, so a child can never
--    point across workspaces).
-- 2. public.app_access(app_id) → 'edit' | 'view' | NULL for the caller
--    (auth.uid()): 'edit' for apps.manage in the app's workspace or a named
--    editor; 'view' for apps.view plus an audience entry naming them, a team
--    they are in (user_teams or the legacy users.team_id) or a role they hold.
--    Only in a workspace they are a member of. Audience entries carry an app
--    role (viewer / contributor) that lib/services/apps.ts applies when it
--    shows a page: an app never grants access to the objects it shows.
-- 3. RLS: SELECT on every table = visible workspace (current one, or all in
--    the unified view) AND app_access(app) IS NOT NULL. No INSERT / UPDATE /
--    DELETE grant to authenticated (writes go through the service).
-- 4. Permissions apps.view ("Use apps") and apps.manage ("Build apps"):
--    seed_tenant_roles gives apps.view to every system role and apps.manage
--    to Owner, Admin and Manager. Existing workspaces: apps.manage on those
--    SYSTEM roles; apps.view on EVERY role (system and custom) — it only opens
--    apps whose audience already names the person, and without it nobody on
--    a custom role would see an app shared with them. Admins can remove it.
--
-- Additive and idempotent. Old public.apps / app_pages from the pre-strip-back
-- baseline were dropped in 20261015000004_strip_back.sql; these are new.

SET lock_timeout = '5s';

-- ── 1. Tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  subtitle text CHECK (subtitle IS NULL OR char_length(subtitle) <= 160),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  icon text CHECK (icon IS NULL OR char_length(icon) <= 60),
  color text CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
  menu jsonb NOT NULL DEFAULT '[]'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT apps_tenant_slug_key UNIQUE (tenant_id, slug)
);
COMMENT ON TABLE public.apps IS 'App builder apps (lib/services/apps.ts). Pages in app_pages; who sees it in app_audience; who edits it in app_editors (plus apps.manage).';

CREATE TABLE IF NOT EXISTS public.app_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  icon text CHECK (icon IS NULL OR char_length(icon) <= 60),
  position integer NOT NULL DEFAULT 0,
  layout jsonb NOT NULL DEFAULT '{"widgets": []}'::jsonb,
  filters jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_pages_app_slug_key UNIQUE (app_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_app_pages_app ON public.app_pages (app_id, position);
COMMENT ON TABLE public.app_pages IS 'Pages of an app: widget layout (layout.widgets) and page filters (filters).';

CREATE TABLE IF NOT EXISTS public.app_audience (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  principal_type text NOT NULL CHECK (principal_type IN ('user', 'team', 'role')),
  principal_id uuid NOT NULL,
  -- viewer: read-only (pages, lists, charts; no buttons that submit / start / claim);
  -- contributor: may use the app's action buttons. Either is still limited by the
  -- viewer's own permissions on each object: the app role only narrows.
  app_role text NOT NULL DEFAULT 'viewer' CHECK (app_role IN ('viewer', 'contributor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_audience_key UNIQUE (app_id, principal_type, principal_id)
);
CREATE INDEX IF NOT EXISTS idx_app_audience_principal ON public.app_audience (tenant_id, principal_type, principal_id);
COMMENT ON TABLE public.app_audience IS 'Who may open an app: users, teams (user_teams) and roles (user_roles), each as viewer (read-only) or contributor (may use action buttons). Also needs apps.view.';

CREATE TABLE IF NOT EXISTS public.app_editors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_editors_key UNIQUE (app_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_app_editors_user ON public.app_editors (tenant_id, user_id);
COMMENT ON TABLE public.app_editors IS 'People who may edit one app (its settings, pages, audience) without apps.manage.';

DROP TRIGGER IF EXISTS trg_apps_updated_at ON public.apps;
CREATE TRIGGER trg_apps_updated_at BEFORE UPDATE ON public.apps
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
DROP TRIGGER IF EXISTS trg_app_pages_updated_at ON public.app_pages;
CREATE TRIGGER trg_app_pages_updated_at BEFORE UPDATE ON public.app_pages
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- Child rows always carry their app's workspace.
CREATE OR REPLACE FUNCTION public.app_child_set_tenant() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT a.tenant_id INTO v_tenant FROM public.apps a WHERE a.id = NEW.app_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'app % not found', NEW.app_id USING ERRCODE = '23503';
  END IF;
  NEW.tenant_id := v_tenant;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.app_child_set_tenant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_app_pages_tenant ON public.app_pages;
CREATE TRIGGER trg_app_pages_tenant BEFORE INSERT OR UPDATE OF app_id, tenant_id ON public.app_pages
  FOR EACH ROW EXECUTE FUNCTION public.app_child_set_tenant();
DROP TRIGGER IF EXISTS trg_app_audience_tenant ON public.app_audience;
CREATE TRIGGER trg_app_audience_tenant BEFORE INSERT OR UPDATE OF app_id, tenant_id ON public.app_audience
  FOR EACH ROW EXECUTE FUNCTION public.app_child_set_tenant();
DROP TRIGGER IF EXISTS trg_app_editors_tenant ON public.app_editors;
CREATE TRIGGER trg_app_editors_tenant BEFORE INSERT OR UPDATE OF app_id, tenant_id ON public.app_editors
  FOR EACH ROW EXECUTE FUNCTION public.app_child_set_tenant();

-- ── 2. Access ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.app_access(p_app_id uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
    WITH me AS (SELECT auth.uid() AS uid),
    app AS (
      SELECT a.id, a.tenant_id FROM public.apps a, me
       WHERE a.id = p_app_id AND me.uid IS NOT NULL
         AND a.tenant_id IN (SELECT public.get_user_tenant_ids())
    ),
    perms AS (SELECT public.get_user_permissions(app.tenant_id) AS p FROM app)
    SELECT CASE
      WHEN NOT EXISTS (SELECT 1 FROM app) THEN NULL
      WHEN EXISTS (SELECT 1 FROM perms WHERE 'apps.manage' = ANY (perms.p))
        OR EXISTS (SELECT 1 FROM public.app_editors e, me WHERE e.app_id = p_app_id AND e.user_id = me.uid)
        THEN 'edit'
      WHEN EXISTS (SELECT 1 FROM perms WHERE 'apps.view' = ANY (perms.p)) AND EXISTS (
        SELECT 1 FROM public.app_audience au, me, app
         WHERE au.app_id = p_app_id AND (
           (au.principal_type = 'user' AND au.principal_id = me.uid)
           OR (au.principal_type = 'team' AND (
                au.principal_id IN (SELECT ut.team_id FROM public.user_teams ut WHERE ut.user_id = me.uid)
                OR au.principal_id = (SELECT u.team_id FROM public.users u WHERE u.id = me.uid)))
           OR (au.principal_type = 'role' AND au.principal_id IN (
                SELECT ur.role_id FROM public.user_roles ur WHERE ur.user_id = me.uid AND ur.tenant_id = app.tenant_id))
         ))
        THEN 'view'
      ELSE NULL
    END
  $$;
REVOKE ALL ON FUNCTION public.app_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_access(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.app_access(uuid) IS
  'App builder: the caller''s access to an app — edit (apps.manage or named editor), view (apps.view + audience by user, team or role) or NULL. Mirrors appAccessLevel in lib/apps/access.ts.';

-- ── 3. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE public.apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_audience ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_editors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS apps_select ON public.apps;
CREATE POLICY apps_select ON public.apps FOR SELECT TO authenticated
  USING (tenant_id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[]) AND public.app_access(id) IS NOT NULL);

DROP POLICY IF EXISTS app_pages_select ON public.app_pages;
CREATE POLICY app_pages_select ON public.app_pages FOR SELECT TO authenticated
  USING (tenant_id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[]) AND public.app_access(app_id) IS NOT NULL);

-- Audience and editor lists: only the app's builders read them (viewers never
-- learn who else an app is shared with).
DROP POLICY IF EXISTS app_audience_select ON public.app_audience;
CREATE POLICY app_audience_select ON public.app_audience FOR SELECT TO authenticated
  USING (tenant_id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[]) AND public.app_access(app_id) = 'edit');

DROP POLICY IF EXISTS app_editors_select ON public.app_editors;
CREATE POLICY app_editors_select ON public.app_editors FOR SELECT TO authenticated
  USING (tenant_id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[]) AND public.app_access(app_id) = 'edit');

REVOKE ALL ON public.apps, public.app_pages, public.app_audience, public.app_editors FROM anon, authenticated;
GRANT SELECT ON public.apps, public.app_pages, public.app_audience, public.app_editors TO authenticated;
GRANT ALL ON public.apps, public.app_pages, public.app_audience, public.app_editors TO service_role;

-- ── 4. Permissions ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.seed_tenant_roles(p_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  v_all text[] := array[
    'tasks.create', 'tasks.view_own', 'tasks.view_all', 'tasks.assign',
    'tasks.complete', 'tasks.redirect', 'tasks.escalate', 'tasks.delete',
    'tasks.manage_queue', 'workflows.view', 'workflows.create',
    'workflows.edit', 'workflows.activate', 'workflows.delete',
    'workflows.view_runs', 'workflows.view_queue', 'workflows.manage_runs', 'forms.view', 'forms.edit',
    'forms.delete', 'forms.submit', 'forms.wizard', 'agents.view', 'agents.create', 'agents.edit',
    'agents.test', 'agents.delete', 'integrations.view',
    'integrations.create', 'integrations.edit', 'integrations.test',
    'integrations.delete', 'integrations.manage_references',
    'extensibility.view', 'extensibility.create', 'extensibility.edit',
    'extensibility.delete', 'data.view', 'data.create', 'data.edit_schema',
    'data.manage_rows', 'data.delete', 'reports.view', 'reports.create',
    'reports.edit_own', 'reports.share', 'reports.delete',
    'apps.view', 'apps.manage',
    'team.view_members', 'team.invite', 'team.remove', 'team.change_roles',
    'org.view', 'org.manage', 'projects.view', 'projects.manage',
    'settings.view', 'settings.edit', 'settings.manage_api_keys',
    'settings.manage_webhooks', 'sync.view', 'sync.manage', 'sync.deploy',
    'observability.view', 'packages.view', 'packages.manage', 'packages.install',
    'assistants.manage'
  ];
  -- Completing anyone's workflow task on their behalf: Owner and Admin.
  v_owner text[] := v_all || array['tasks.complete_any'];
  -- ALL minus settings.manage_*, settings.edit, team.change_roles, team.remove,
  -- org.manage, observability.view, assistants.manage
  v_manager text[] := array[
    'tasks.create', 'tasks.view_own', 'tasks.view_all', 'tasks.assign',
    'tasks.complete', 'tasks.redirect', 'tasks.escalate', 'tasks.delete',
    'tasks.manage_queue', 'workflows.view', 'workflows.create',
    'workflows.edit', 'workflows.activate', 'workflows.delete',
    'workflows.view_runs', 'workflows.view_queue', 'workflows.manage_runs', 'forms.view', 'forms.edit',
    'forms.delete', 'forms.submit', 'forms.wizard', 'agents.view', 'agents.create', 'agents.edit',
    'agents.test', 'agents.delete', 'integrations.view',
    'integrations.create', 'integrations.edit', 'integrations.test',
    'integrations.delete', 'integrations.manage_references',
    'extensibility.view', 'extensibility.create', 'extensibility.edit',
    'extensibility.delete', 'data.view', 'data.create', 'data.edit_schema',
    'data.manage_rows', 'data.delete', 'reports.view', 'reports.create',
    'reports.edit_own', 'reports.share', 'reports.delete',
    'apps.view', 'apps.manage',
    'team.view_members', 'team.invite', 'org.view', 'projects.view',
    'projects.manage', 'settings.view', 'sync.view',
    'sync.manage', 'sync.deploy', 'packages.view', 'packages.manage',
    'packages.install'
  ];
  -- Read-only consumer: own tasks, forms they are given, data, reports, apps shared with them, people.
  v_viewer text[] := array[
    'tasks.view_own', 'tasks.complete', 'forms.submit', 'data.view',
    'reports.view', 'apps.view', 'team.view_members', 'org.view', 'projects.view'
  ];
  v_member text[] := v_viewer || array[
    'tasks.create', 'tasks.assign', 'data.manage_rows', 'reports.create',
    'reports.edit_own', 'workflows.view_queue', 'forms.wizard'
  ];
begin
  insert into roles (tenant_id, name, slug, description, permissions, is_system, base_role) values
    (p_tenant_id, 'Owner',   'owner',   'Full access to everything, including billing and API keys', v_owner,   true, 'owner'),
    (p_tenant_id, 'Admin',   'admin',   'Full administrative access',                                v_owner,   true, 'admin'),
    (p_tenant_id, 'Manager', 'manager', 'Builds and manages work; no org administration',            v_manager, true, 'manager'),
    (p_tenant_id, 'Member',  'member',  'Works tasks, data, and reports',                            v_member,  true, 'member'),
    (p_tenant_id, 'Viewer',  'viewer',  'Read-only access',                                          v_viewer,  true, 'viewer');
end;
$$;

UPDATE public.roles
   SET permissions = permissions || ARRAY['apps.manage']
 WHERE is_system AND slug IN ('owner', 'admin', 'manager')
   AND NOT ('apps.manage' = ANY (permissions));

UPDATE public.roles
   SET permissions = permissions || ARRAY['apps.view']
 WHERE NOT ('apps.view' = ANY (permissions));

-- Scopes appended to the usertasks-cli seed (20261023000000_oauth_first_party_cli.sql).
UPDATE public.oauth_clients
SET allowed_scopes = array_append(allowed_scopes, 'apps:read')
WHERE client_id = 'usertasks-cli'
  AND is_first_party
  AND NOT ('apps:read' = ANY (allowed_scopes));

UPDATE public.oauth_clients
SET allowed_scopes = array_append(allowed_scopes, 'apps:write')
WHERE client_id = 'usertasks-cli'
  AND is_first_party
  AND NOT ('apps:write' = ANY (allowed_scopes));
