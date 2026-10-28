-- ============================================================================
-- 20261116000000_form_submissions.sql
--
-- Form buttons, headers, standalone submissions and the "Form submitted"
-- trigger.
--
-- 1. public.forms / public.form_versions: `buttons` (the button bar and its
--    behaviours, lib/forms/buttons.ts; NULL = the defaults Submit / Cancel),
--    `header` (image, title, subtitle, lib/forms/header.ts; NULL = none) and,
--    on forms, `submission_retention_days` (NULL = keep; the daily
--    cleanup-logs job deletes older submissions of the form).
--
-- 2. public.form_submissions: one row per submission of a reusable form —
--    from its standalone page (/f/<id>, source 'standalone'), the REST / MCP
--    submit endpoints ('api') or as a task form ('task', with task_id).
--    Values are the validated, typed values (lookups' `<key>_item`
--    included); `result` is what the button did (runs started, the effects
--    shown). `idempotency_key` makes a double-click one submission.
--
-- 3. RLS: members read their workspace's rows they submitted themselves;
--    people with forms.edit read every submission. No client writes — the
--    service (lib/services/form-submissions.ts) inserts with the service
--    role after checking forms.submit.
--
-- 4. Event stream: an AFTER INSERT trigger emits `form.submitted`
--    (category task; form id / name / version, button, source — never the
--    values), so log export destinations (webhook, Splunk, Datadog, OTLP…)
--    receive it like other events.
--
-- 5. Permission forms.submit for every system role (Owner, Admin, Manager,
--    Member, Viewer) and seed_tenant_roles.
--
-- Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS buttons jsonb;
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS header jsonb;
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS submission_retention_days integer
  CHECK (submission_retention_days IS NULL OR submission_retention_days BETWEEN 1 AND 3650);
ALTER TABLE public.form_versions ADD COLUMN IF NOT EXISTS buttons jsonb;
ALTER TABLE public.form_versions ADD COLUMN IF NOT EXISTS header jsonb;

CREATE TABLE IF NOT EXISTS public.form_submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  form_id          uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  form_version     integer,
  form_name        text NOT NULL,
  source           text NOT NULL DEFAULT 'standalone' CHECK (source IN ('standalone', 'task', 'api')),
  task_id          uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  button_id        text,
  outcome          text,
  submitted_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  values           jsonb NOT NULL DEFAULT '{}'::jsonb,
  result           jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key  text CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 100),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON public.form_submissions (tenant_id, form_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_submissions_submitter ON public.form_submissions (tenant_id, submitted_by, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_form_submissions_idempotency ON public.form_submissions (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

COMMENT ON TABLE public.form_submissions IS 'Submissions of reusable forms (standalone page, API, task forms). Written by lib/services/form-submissions.ts with the service role.';

ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS form_submissions_select ON public.form_submissions;
CREATE POLICY form_submissions_select ON public.form_submissions FOR SELECT USING (
  tenant_id = (SELECT public.get_current_tenant_id())
  AND (
    submitted_by = (SELECT auth.uid())
    OR (SELECT public.user_has_tenant_permission(tenant_id::text, 'forms.edit'))
  )
);
REVOKE ALL ON TABLE public.form_submissions FROM anon, authenticated;
GRANT SELECT ON TABLE public.form_submissions TO authenticated;
GRANT ALL ON TABLE public.form_submissions TO service_role;

-- ── Event stream: form.submitted ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_events.tg_form_submissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    PERFORM app_events.emit(
      NEW.tenant_id, 'form.submitted', 'task', 'info',
      'Form "' || app_events.clip(NEW.form_name, 120) || '" submitted'
        || CASE WHEN NEW.button_id IS NOT NULL THEN ' (' || app_events.clip(NEW.button_id, 40) || ')' ELSE '' END,
      'form_submissions', NEW.id::text, NULL, NULL, NULL, NEW.task_id, NEW.submitted_by,
      jsonb_build_object(
        'form_id', NEW.form_id,
        'form_name', app_events.clip(NEW.form_name, 120),
        'form_version', NEW.form_version,
        'source', NEW.source,
        'button_id', NEW.button_id,
        'outcome', app_events.clip(NEW.outcome, 120)
      ),
      NEW.created_at
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_events.tg_form_submissions failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION app_events.tg_form_submissions() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_event_stream_ins ON public.form_submissions;
CREATE TRIGGER trg_event_stream_ins AFTER INSERT ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION app_events.tg_form_submissions();

-- ── Permission forms.submit ───────────────────────────────────────────────

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
    'forms.delete', 'forms.submit', 'agents.view', 'agents.create', 'agents.edit',
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
    'tasks.view_own', 'tasks.complete', 'workflows.view', 'forms.view', 'forms.submit', 'data.view',
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
BEGIN
  UPDATE public.roles
  SET permissions = array_append(permissions, 'forms.submit')
  WHERE is_system
    AND slug IN ('owner', 'admin', 'manager', 'member', 'viewer')
    AND NOT ('forms.submit' = ANY (permissions));
END;
$$;
