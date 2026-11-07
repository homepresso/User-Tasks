-- ============================================================================
-- 20261224000000_org_structure.sql
--
-- Organization structure: people attributes, org units, projects and team
-- details. Read by the Organization page, /api/v1/org/* and /api/v1/projects/*,
-- the MCP org_* / projects_* tools and the CLI; imported by directory sync
-- (Okta, Entra ID, Google Workspace, LDAP / AD, SCIM) and CSV.
--
-- 1. People attributes per workspace membership (user_memberships):
--    job_title, department, location, employee_id, cost_center, with
--    profile_source ('manual' | 'directory') and profile_updated_at.
--    Directory-owned values (profile_source 'directory') are refreshed by
--    sync and read-only in the editor until detached (profile_source
--    'manual'), after which sync leaves them alone. There is still no client
--    write policy on user_memberships: the app writes after its checks.
--
-- 2. org_units: a tree of company / division / department / unit (or any
--    custom kind) per workspace, with a head, a source ('manual' | 'okta' |
--    'entra' | 'google' | 'ldap' | 'scim' | 'csv') and the source's
--    external_id (unique per workspace and source, so re-syncs update rather
--    than duplicate). `detached` marks an imported unit that sync no longer
--    updates. A unit's parent must be in the same workspace and loops are
--    refused (trigger, depth-capped walk).
--    org_unit_members: who belongs to a unit (role, is_primary — at most one
--    primary unit per person — and source, so sync only removes the
--    memberships it created).
--
-- 3. projects (+ project_members with role / allocation, project_teams to
--    attach whole teams). A project's owning team and org unit must be in
--    its workspace.
--
-- 4. teams: lead_user_id, org_unit_id, colour, kind ('team' | 'squad' |
--    'guild' | custom). Team parent loops are refused from now on.
--
-- 5. RLS: members read their workspace's rows (the current workspace, or
--    all of them in the unified view); writes need org.manage (org units,
--    their members) or projects.manage (projects, their members and teams)
--    in the row's workspace. The member tables' tenant_id always follows the
--    parent row (trigger), so a "move" keeps the row in its workspace.
--
-- 6. Permissions org.view, org.manage, projects.view, projects.manage:
--    seed function and existing roles. org.view / projects.view go to every
--    system role and to every custom role that can view members;
--    org.manage to Owner / Admin; projects.manage to Owner / Admin / Manager.
--
-- Additive and idempotent: safe to run more than once.
-- ============================================================================

SET lock_timeout = '5s';

-- ── 1. People attributes ────────────────────────────────────────────────────

ALTER TABLE public.user_memberships
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS employee_id text,
  ADD COLUMN IF NOT EXISTS cost_center text,
  ADD COLUMN IF NOT EXISTS profile_source text,
  ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_memberships_profile_source_check') THEN
    ALTER TABLE public.user_memberships
      ADD CONSTRAINT user_memberships_profile_source_check CHECK (profile_source IS NULL OR profile_source IN ('manual', 'directory'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_memberships_profile_lengths') THEN
    ALTER TABLE public.user_memberships
      ADD CONSTRAINT user_memberships_profile_lengths CHECK (
        coalesce(length(job_title), 0) <= 200 AND coalesce(length(department), 0) <= 200
        AND coalesce(length(location), 0) <= 200 AND coalesce(length(employee_id), 0) <= 100
        AND coalesce(length(cost_center), 0) <= 100
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_membership_tenant_department
  ON public.user_memberships (tenant_id, department)
  WHERE department IS NOT NULL;

-- ── 2. Org units ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.org_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'unit',
  parent_id uuid REFERENCES public.org_units(id) ON DELETE SET NULL,
  head_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  description text,
  source text NOT NULL DEFAULT 'manual',
  external_id text,
  detached boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_units_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT org_units_kind_check CHECK (length(btrim(kind)) BETWEEN 1 AND 50),
  CONSTRAINT org_units_source_check CHECK (source IN ('manual', 'okta', 'entra', 'google', 'ldap', 'scim', 'csv')),
  CONSTRAINT org_units_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT org_units_description_check CHECK (description IS NULL OR length(description) <= 2000),
  CONSTRAINT org_units_external_id_check CHECK (external_id IS NULL OR length(external_id) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_org_units_tenant_parent ON public.org_units (tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_org_units_head ON public.org_units (head_user_id) WHERE head_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_units_source_external
  ON public.org_units (tenant_id, source, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.org_unit_members (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  org_unit_id uuid NOT NULL REFERENCES public.org_units(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text,
  is_primary boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_unit_id, user_id),
  CONSTRAINT org_unit_members_role_check CHECK (role IS NULL OR length(role) <= 100),
  CONSTRAINT org_unit_members_source_check CHECK (source IN ('manual', 'okta', 'entra', 'google', 'ldap', 'scim', 'csv'))
);

CREATE INDEX IF NOT EXISTS idx_org_unit_members_tenant_user ON public.org_unit_members (tenant_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_unit_members_primary
  ON public.org_unit_members (tenant_id, user_id)
  WHERE is_primary;

-- Parent in the same workspace, no loops (walk up from the new parent).
CREATE OR REPLACE FUNCTION public.fn_check_org_unit_parent() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_current uuid;
  v_depth integer := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id AND NEW.tenant_id = OLD.tenant_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_units u WHERE u.id = NEW.parent_id AND u.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'org_unit_parent_tenant: the parent unit must be in the same workspace' USING ERRCODE = '23514';
  END IF;
  v_current := NEW.parent_id;
  WHILE v_current IS NOT NULL AND v_depth < 64 LOOP
    IF v_current = NEW.id THEN
      RAISE EXCEPTION 'org_unit_cycle: that unit is inside this one' USING ERRCODE = '23514';
    END IF;
    SELECT u.parent_id INTO v_current FROM public.org_units u WHERE u.id = v_current;
    v_depth := v_depth + 1;
  END LOOP;
  IF v_depth >= 64 THEN
    RAISE EXCEPTION 'org_unit_depth: org units nest at most 64 levels' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_check_org_unit_parent() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_org_units_parent_check ON public.org_units;
CREATE TRIGGER trg_org_units_parent_check
  BEFORE INSERT OR UPDATE OF parent_id, tenant_id ON public.org_units
  FOR EACH ROW EXECUTE FUNCTION public.fn_check_org_unit_parent();

DROP TRIGGER IF EXISTS trg_org_units_updated_at ON public.org_units;
CREATE TRIGGER trg_org_units_updated_at
  BEFORE UPDATE ON public.org_units
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- A unit's head must be a member of its workspace.
CREATE OR REPLACE FUNCTION public.fn_check_org_unit_head() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.head_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.head_user_id IS NOT DISTINCT FROM OLD.head_user_id AND NEW.tenant_id = OLD.tenant_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_memberships m
    WHERE m.tenant_id = NEW.tenant_id AND m.user_id = NEW.head_user_id AND coalesce(m.is_active, true)
  ) THEN
    RAISE EXCEPTION 'org_unit_head_not_member: the head must be a member of this workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_check_org_unit_head() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_org_units_head_check ON public.org_units;
CREATE TRIGGER trg_org_units_head_check
  BEFORE INSERT OR UPDATE OF head_user_id, tenant_id ON public.org_units
  FOR EACH ROW EXECUTE FUNCTION public.fn_check_org_unit_head();

-- ── 3. Projects ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  key text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sponsor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  org_unit_id uuid REFERENCES public.org_units(id) ON DELETE SET NULL,
  start_date date,
  end_date date,
  colour text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT projects_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT projects_key_check CHECK (key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$'),
  CONSTRAINT projects_status_check CHECK (status IN ('active', 'on_hold', 'completed', 'archived')),
  CONSTRAINT projects_dates_check CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  CONSTRAINT projects_colour_check CHECK (colour IS NULL OR colour ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT projects_description_check CHECK (description IS NULL OR length(description) <= 5000)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_tenant_key ON public.projects (tenant_id, lower(key));
CREATE INDEX IF NOT EXISTS idx_projects_tenant_status ON public.projects (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_team ON public.projects (team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_org_unit ON public.projects (org_unit_id) WHERE org_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_owner ON public.projects (tenant_id, owner_user_id) WHERE owner_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.project_members (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'Member',
  allocation_percent integer,
  added_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id),
  CONSTRAINT project_members_role_check CHECK (length(btrim(role)) BETWEEN 1 AND 100),
  CONSTRAINT project_members_allocation_check CHECK (allocation_percent IS NULL OR allocation_percent BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_project_members_tenant_user ON public.project_members (tenant_id, user_id);

CREATE TABLE IF NOT EXISTS public.project_teams (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  added_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_project_teams_team ON public.project_teams (team_id);
CREATE INDEX IF NOT EXISTS idx_project_teams_tenant ON public.project_teams (tenant_id);

DROP TRIGGER IF EXISTS trg_projects_updated_at ON public.projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- A project's owning team / org unit must be in its workspace.
CREATE OR REPLACE FUNCTION public.fn_check_project_refs() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = NEW.team_id AND t.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'project_team_tenant: the team must be in the same workspace' USING ERRCODE = '23514';
  END IF;
  IF NEW.org_unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.org_units u WHERE u.id = NEW.org_unit_id AND u.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'project_org_unit_tenant: the org unit must be in the same workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_check_project_refs() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_projects_refs_check ON public.projects;
CREATE TRIGGER trg_projects_refs_check
  BEFORE INSERT OR UPDATE OF team_id, org_unit_id, tenant_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.fn_check_project_refs();

-- ── Member tables: tenant_id follows the parent row ─────────────────────────

CREATE OR REPLACE FUNCTION public.fn_org_child_tenant() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF TG_TABLE_NAME = 'org_unit_members' THEN
    SELECT u.tenant_id INTO v_tenant FROM public.org_units u WHERE u.id = NEW.org_unit_id;
  ELSE
    SELECT p.tenant_id INTO v_tenant FROM public.projects p WHERE p.id = NEW.project_id;
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'org_parent_missing: % parent not found', TG_TABLE_NAME USING ERRCODE = '23503';
  END IF;
  NEW.tenant_id := v_tenant;
  -- Nested IFs: PL/pgSQL does not short-circuit, and NEW has no team_id /
  -- user_id on the other tables.
  IF TG_TABLE_NAME = 'project_teams' THEN
    IF NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = NEW.team_id AND t.tenant_id = v_tenant) THEN
      RAISE EXCEPTION 'project_team_tenant: the team must be in the same workspace' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.user_memberships m WHERE m.tenant_id = v_tenant AND m.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'org_member_not_member: the person must be a member of this workspace' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_org_child_tenant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_org_unit_members_tenant ON public.org_unit_members;
CREATE TRIGGER trg_org_unit_members_tenant
  BEFORE INSERT OR UPDATE ON public.org_unit_members
  FOR EACH ROW EXECUTE FUNCTION public.fn_org_child_tenant();

DROP TRIGGER IF EXISTS trg_project_members_tenant ON public.project_members;
CREATE TRIGGER trg_project_members_tenant
  BEFORE INSERT OR UPDATE ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION public.fn_org_child_tenant();

DROP TRIGGER IF EXISTS trg_project_teams_tenant ON public.project_teams;
CREATE TRIGGER trg_project_teams_tenant
  BEFORE INSERT OR UPDATE ON public.project_teams
  FOR EACH ROW EXECUTE FUNCTION public.fn_org_child_tenant();

-- A member who leaves the workspace leaves its units and projects.
CREATE OR REPLACE FUNCTION public.fn_clear_departed_org_member() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.is_active AND NOT coalesce(NEW.is_active, false)) THEN
    DELETE FROM public.org_unit_members WHERE tenant_id = OLD.tenant_id AND user_id = OLD.user_id;
    DELETE FROM public.project_members WHERE tenant_id = OLD.tenant_id AND user_id = OLD.user_id;
    UPDATE public.org_units SET head_user_id = NULL WHERE tenant_id = OLD.tenant_id AND head_user_id = OLD.user_id;
    UPDATE public.teams SET lead_user_id = NULL WHERE tenant_id = OLD.tenant_id AND lead_user_id = OLD.user_id;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_clear_departed_org_member() FROM PUBLIC, anon, authenticated;

-- ── 4. Teams ────────────────────────────────────────────────────────────────

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS lead_user_id uuid,
  ADD COLUMN IF NOT EXISTS org_unit_id uuid,
  ADD COLUMN IF NOT EXISTS colour text,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'team';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_lead_user_id_fkey') THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_lead_user_id_fkey FOREIGN KEY (lead_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_org_unit_id_fkey') THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_org_unit_id_fkey FOREIGN KEY (org_unit_id) REFERENCES public.org_units(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_colour_check') THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_colour_check CHECK (colour IS NULL OR colour ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_kind_check') THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_kind_check CHECK (length(btrim(kind)) BETWEEN 1 AND 50);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_teams_tenant_parent ON public.teams (tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_teams_org_unit ON public.teams (org_unit_id) WHERE org_unit_id IS NOT NULL;

-- Team parent in the same workspace, no loops; org unit in the same workspace.
CREATE OR REPLACE FUNCTION public.fn_check_team_structure() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_current uuid;
  v_depth integer := 0;
BEGIN
  IF NEW.org_unit_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.org_unit_id IS DISTINCT FROM OLD.org_unit_id OR NEW.tenant_id <> OLD.tenant_id)
     AND NOT EXISTS (SELECT 1 FROM public.org_units u WHERE u.id = NEW.org_unit_id AND u.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'team_org_unit_tenant: the org unit must be in the same workspace' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id AND NEW.tenant_id = OLD.tenant_id) THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'team_cycle: a team cannot be its own parent' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = NEW.parent_id AND t.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'team_parent_tenant: the parent team must be in the same workspace' USING ERRCODE = '23514';
  END IF;
  v_current := NEW.parent_id;
  WHILE v_current IS NOT NULL AND v_depth < 64 LOOP
    IF v_current = NEW.id THEN
      RAISE EXCEPTION 'team_cycle: that team is inside this one' USING ERRCODE = '23514';
    END IF;
    SELECT t.parent_id INTO v_current FROM public.teams t WHERE t.id = v_current;
    v_depth := v_depth + 1;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_check_team_structure() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_teams_structure_check ON public.teams;
CREATE TRIGGER trg_teams_structure_check
  BEFORE INSERT OR UPDATE OF parent_id, org_unit_id, tenant_id ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.fn_check_team_structure();

DROP TRIGGER IF EXISTS trg_membership_org_departed ON public.user_memberships;
CREATE TRIGGER trg_membership_org_departed
  AFTER DELETE OR UPDATE OF is_active ON public.user_memberships
  FOR EACH ROW EXECUTE FUNCTION public.fn_clear_departed_org_member();

-- ── 5. RLS ──────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r record;
  v_read constant text := 'tenant_id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[])';
  v_member constant text := 'tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('org_units', 'org.manage'),
    ('org_unit_members', 'org.manage'),
    ('projects', 'projects.manage'),
    ('project_members', 'projects.manage'),
    ('project_teams', 'projects.manage')
  ) AS v(tbl, perm) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', r.tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', r.tbl);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', r.tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_select', r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)', r.tbl || '_select', r.tbl, v_read);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_insert', r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s AND %L = ANY (public.get_user_permissions(tenant_id)))',
      r.tbl || '_insert', r.tbl, v_member, r.perm);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_update', r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s AND %L = ANY (public.get_user_permissions(tenant_id))) WITH CHECK (%s AND %L = ANY (public.get_user_permissions(tenant_id)))',
      r.tbl || '_update', r.tbl, v_member, r.perm, v_member, r.perm);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_delete', r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s AND %L = ANY (public.get_user_permissions(tenant_id)))',
      r.tbl || '_delete', r.tbl, v_member, r.perm);
  END LOOP;
END $$;

-- ── 6. Permissions ──────────────────────────────────────────────────────────

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
    'forms.delete', 'forms.submit', 'agents.view', 'agents.create', 'agents.edit',
    'agents.test', 'agents.delete', 'integrations.view',
    'integrations.create', 'integrations.edit', 'integrations.test',
    'integrations.delete', 'integrations.manage_references',
    'extensibility.view', 'extensibility.create', 'extensibility.edit',
    'extensibility.delete', 'data.view', 'data.create', 'data.edit_schema',
    'data.manage_rows', 'data.delete', 'reports.view', 'reports.create',
    'reports.edit_own', 'reports.share', 'reports.delete',
    'team.view_members', 'team.invite', 'team.remove', 'team.change_roles',
    'org.view', 'org.manage', 'projects.view', 'projects.manage',
    'settings.view', 'settings.edit', 'settings.manage_api_keys',
    'settings.manage_webhooks', 'sync.view', 'sync.manage', 'sync.deploy',
    'observability.view', 'packages.view', 'packages.manage', 'packages.install'
  ];
  -- Break-glass completion of anyone's workflow task: Owner only.
  v_owner text[] := v_all || array['tasks.complete_any'];
  -- ALL minus settings.manage_*, settings.edit, team.change_roles, team.remove,
  -- org.manage, observability.view
  v_manager text[] := array[
    'tasks.create', 'tasks.view_own', 'tasks.view_all', 'tasks.assign',
    'tasks.complete', 'tasks.redirect', 'tasks.escalate', 'tasks.delete',
    'tasks.manage_queue', 'workflows.view', 'workflows.create',
    'workflows.edit', 'workflows.activate', 'workflows.delete',
    'workflows.view_runs', 'workflows.manage_runs', 'forms.view', 'forms.edit',
    'forms.delete', 'forms.submit', 'agents.view', 'agents.create', 'agents.edit',
    'agents.test', 'agents.delete', 'integrations.view',
    'integrations.create', 'integrations.edit', 'integrations.test',
    'integrations.delete', 'integrations.manage_references',
    'extensibility.view', 'extensibility.create', 'extensibility.edit',
    'extensibility.delete', 'data.view', 'data.create', 'data.edit_schema',
    'data.manage_rows', 'data.delete', 'reports.view', 'reports.create',
    'reports.edit_own', 'reports.share', 'reports.delete',
    'team.view_members', 'team.invite', 'org.view', 'projects.view',
    'projects.manage', 'settings.view', 'sync.view',
    'sync.manage', 'sync.deploy', 'packages.view', 'packages.manage',
    'packages.install'
  ];
  v_viewer text[] := array[
    'tasks.view_own', 'tasks.complete', 'workflows.view', 'forms.view', 'forms.submit', 'data.view',
    'reports.view', 'team.view_members', 'org.view', 'projects.view'
  ];
  v_member text[] := v_viewer || array[
    'tasks.create', 'tasks.assign', 'data.manage_rows', 'reports.create',
    'reports.edit_own'
  ];
begin
  insert into roles (tenant_id, name, slug, description, permissions, is_system, base_role) values
    (p_tenant_id, 'Owner',   'owner',   'Full access to everything, including billing and API keys', v_owner,   true, 'owner'),
    (p_tenant_id, 'Admin',   'admin',   'Full administrative access',                                v_all,     true, 'admin'),
    (p_tenant_id, 'Manager', 'manager', 'Builds and manages work; no org administration',            v_manager, true, 'manager'),
    (p_tenant_id, 'Member',  'member',  'Works tasks, data, and reports',                            v_member,  true, 'member'),
    (p_tenant_id, 'Viewer',  'viewer',  'Read-only access',                                          v_viewer,  true, 'viewer');
end;
$$;

-- Read access: every system role, and custom roles that can see the member list.
UPDATE public.roles
SET permissions = array_append(permissions, 'org.view')
WHERE (is_system OR 'team.view_members' = ANY (permissions))
  AND NOT ('org.view' = ANY (permissions));

UPDATE public.roles
SET permissions = array_append(permissions, 'projects.view')
WHERE (is_system OR 'team.view_members' = ANY (permissions))
  AND NOT ('projects.view' = ANY (permissions));

UPDATE public.roles
SET permissions = array_append(permissions, 'org.manage')
WHERE is_system AND slug IN ('owner', 'admin')
  AND NOT ('org.manage' = ANY (permissions));

UPDATE public.roles
SET permissions = array_append(permissions, 'projects.manage')
WHERE is_system AND slug IN ('owner', 'admin', 'manager')
  AND NOT ('projects.manage' = ANY (permissions));
