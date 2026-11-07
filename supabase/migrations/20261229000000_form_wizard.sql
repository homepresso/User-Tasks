-- ============================================================================
-- 20261229000000_form_wizard.sql
--
-- The form wizard: people build a form, survey or questionnaire step by step
-- and the server creates a reusable form, a data table for the responses, an
-- optional review / approval workflow and a results page, linked together.
--
-- 1. Permission forms.wizard ("Create forms with the wizard"): seed_tenant_roles
--    gives it to Owner, Admin, Manager and Member (not Viewer); existing
--    workspaces get it on those SYSTEM roles (custom roles are never touched).
--    With it the server creates exactly the wizard's objects, owned by the
--    person (lib/services/form-wizard.ts) — no general build access.
-- 2. public.form_wizard_projects: one row per wizard form (a draft while the
--    person is still in the wizard, then the manifest of what it created:
--    form, data table, workflow, reports, column map), so "Edit with the
--    wizard" reopens and updates the same objects; `draft` is the autosaved
--    working copy (resumable). RLS: a person reads their
--    own rows in their member workspaces; no end-user writes (service role
--    only, like forms) — every write goes through the service.
--
-- Additive and idempotent. Until it is applied the wizard pages report a
-- database error and members lack forms.wizard; nothing else changes.
-- ============================================================================

SET lock_timeout = '5s';

/* ── 1. forms.wizard ─────────────────────────────────────────────────── */

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
    'team.view_members', 'team.invite', 'team.remove', 'team.change_roles',
    'org.view', 'org.manage', 'projects.view', 'projects.manage',
    'settings.view', 'settings.edit', 'settings.manage_api_keys',
    'settings.manage_webhooks', 'sync.view', 'sync.manage', 'sync.deploy',
    'observability.view', 'packages.view', 'packages.manage', 'packages.install'
  ];
  -- Completing anyone's workflow task on their behalf: Owner and Admin.
  v_owner text[] := v_all || array['tasks.complete_any'];
  -- ALL minus settings.manage_*, settings.edit, team.change_roles, team.remove,
  -- org.manage, observability.view
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
    'team.view_members', 'team.invite', 'org.view', 'projects.view',
    'projects.manage', 'settings.view', 'sync.view',
    'sync.manage', 'sync.deploy', 'packages.view', 'packages.manage',
    'packages.install'
  ];
  -- Read-only consumer: own tasks, forms they are given, data, reports, people.
  v_viewer text[] := array[
    'tasks.view_own', 'tasks.complete', 'forms.submit', 'data.view',
    'reports.view', 'team.view_members', 'org.view', 'projects.view'
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
   SET permissions = permissions || ARRAY['forms.wizard']
 WHERE is_system AND slug IN ('owner', 'admin', 'manager', 'member')
   AND NOT ('forms.wizard' = ANY (permissions));

/* ── 2. form_wizard_projects ─────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.form_wizard_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'created')),
  -- The wizard's answers (lib/forms/wizard/spec.ts WizardSpec), at most 256 KB.
  spec jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(spec) <= 262144),
  -- What was created: { form_id, table_id, workflow_id, report_ids, columns }.
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The autosaved working copy while the person is in the wizard (resume later); NULL = none.
  draft jsonb CHECK (draft IS NULL OR pg_column_size(draft) <= 262144),
  form_id uuid REFERENCES public.forms(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS form_wizard_projects_owner_idx
  ON public.form_wizard_projects (tenant_id, owner_id, updated_at DESC);
-- One wizard project per form (the response policy lookup on submit).
CREATE UNIQUE INDEX IF NOT EXISTS form_wizard_projects_form_idx
  ON public.form_wizard_projects (form_id) WHERE form_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_form_wizard_projects_updated_at ON public.form_wizard_projects;
CREATE TRIGGER trg_form_wizard_projects_updated_at BEFORE UPDATE ON public.form_wizard_projects
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

ALTER TABLE public.form_wizard_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS form_wizard_projects_select ON public.form_wizard_projects;
CREATE POLICY form_wizard_projects_select ON public.form_wizard_projects FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

REVOKE ALL ON public.form_wizard_projects FROM anon, authenticated;
GRANT SELECT ON public.form_wizard_projects TO authenticated;
GRANT ALL ON public.form_wizard_projects TO service_role;
