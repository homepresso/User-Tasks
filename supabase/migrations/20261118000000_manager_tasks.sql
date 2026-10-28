-- ============================================================================
-- 20261118000000_manager_tasks.sql
--
-- Assignee-only workflow tasks, reporting lines and the manager view.
--
-- 1. Reporting lines per workspace: user_memberships.manager_user_id (the
--    member's manager in that tenant), manager_source ('manual' |
--    'directory') and manager_updated_at. A manager must be an active member
--    of the same tenant, nobody manages themselves and no loop is allowed
--    (checked on write, walking the chain with a depth cap). Indexed by
--    (tenant_id, manager_user_id) for "my reports" reads. RLS is unchanged:
--    members already read their workspace's memberships; there is no client
--    write policy (the service writes after the team.change_roles check).
--
-- 2. tasks.actioned_on_behalf_of: set when a manager (or break-glass
--    tasks.complete_any holder) completes a task for its assignee;
--    actioned_by stays the person who clicked. task_responses.actioned_by
--    records who submitted a response counted for user_id.
--
-- 3. Workflow-task guard: an end-user database caller (PostgREST with an
--    anon/authenticated JWT) can no longer complete a workflow task, set its
--    outcome / actioned_* columns or its form values, or write
--    task_responses directly — those go through the app's completion
--    service (assignee / manager-on-behalf rule, lib/task-authz.ts), which
--    writes with the service role. Nested trigger writes (parent progress)
--    and trusted callers are not affected.
--
-- 4. Permission tasks.complete_any (break-glass: act on any workflow task
--    on behalf of its assignee, audited): Owner only by default.
--
-- 5. Queue functions: EXECUTE on enqueue_workflow / enqueue_workflow_batch
--    revoked from PUBLIC, anon and authenticated — the app enqueues with the
--    service role after its own permission checks (manual runs need
--    workflows.activate). fn_enqueue_task_workflows (the tasks trigger) is
--    now SECURITY DEFINER so task writes by signed-in users still queue
--    their task_* workflows. reassign_task / escalate_task (SECURITY
--    DEFINER, no app callers, no assignee check) are revoked from
--    authenticated too.
--
-- 6. Event stream: task lifecycle events carry on_behalf_of / acted_as /
--    via so on-behalf actions are visible in the stream and log export.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

-- ── 1. Reporting lines ──────────────────────────────────────────────────────

ALTER TABLE public.user_memberships
  ADD COLUMN IF NOT EXISTS manager_user_id uuid,
  ADD COLUMN IF NOT EXISTS manager_source text,
  ADD COLUMN IF NOT EXISTS manager_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_memberships_manager_user_id_fkey') THEN
    ALTER TABLE public.user_memberships
      ADD CONSTRAINT user_memberships_manager_user_id_fkey
      FOREIGN KEY (manager_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_memberships_manager_not_self') THEN
    ALTER TABLE public.user_memberships
      ADD CONSTRAINT user_memberships_manager_not_self CHECK (manager_user_id IS NULL OR manager_user_id <> user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_memberships_manager_source_check') THEN
    ALTER TABLE public.user_memberships
      ADD CONSTRAINT user_memberships_manager_source_check CHECK (manager_source IS NULL OR manager_source IN ('manual', 'directory'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_membership_tenant_manager
  ON public.user_memberships (tenant_id, manager_user_id)
  WHERE manager_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_check_membership_manager() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_current uuid;
  v_depth integer := 0;
BEGIN
  IF NEW.manager_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.manager_user_id IS NOT DISTINCT FROM OLD.manager_user_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_memberships m
    WHERE m.tenant_id = NEW.tenant_id AND m.user_id = NEW.manager_user_id AND m.is_active
  ) THEN
    RAISE EXCEPTION 'manager_not_member: the manager must be an active member of this workspace' USING ERRCODE = '23514';
  END IF;
  -- Walk up from the new manager; reaching NEW.user_id would close a loop.
  v_current := NEW.manager_user_id;
  WHILE v_current IS NOT NULL AND v_depth < 64 LOOP
    IF v_current = NEW.user_id THEN
      RAISE EXCEPTION 'manager_cycle: that manager reports to this member' USING ERRCODE = '23514';
    END IF;
    SELECT m.manager_user_id INTO v_current
    FROM public.user_memberships m
    WHERE m.tenant_id = NEW.tenant_id AND m.user_id = v_current;
    v_depth := v_depth + 1;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_check_membership_manager() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_membership_manager_check ON public.user_memberships;
CREATE TRIGGER trg_membership_manager_check
  BEFORE INSERT OR UPDATE OF manager_user_id ON public.user_memberships
  FOR EACH ROW EXECUTE FUNCTION public.fn_check_membership_manager();

-- A member who leaves (row deleted or deactivated) stops managing anyone there.
CREATE OR REPLACE FUNCTION public.fn_clear_departed_manager() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.is_active AND NOT coalesce(NEW.is_active, false)) THEN
    UPDATE public.user_memberships
    SET manager_user_id = NULL, manager_updated_at = now()
    WHERE tenant_id = OLD.tenant_id AND manager_user_id = OLD.user_id;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_clear_departed_manager() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_membership_manager_departed ON public.user_memberships;
CREATE TRIGGER trg_membership_manager_departed
  AFTER DELETE OR UPDATE OF is_active ON public.user_memberships
  FOR EACH ROW EXECUTE FUNCTION public.fn_clear_departed_manager();

-- ── 2. On-behalf columns ────────────────────────────────────────────────────

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS actioned_on_behalf_of uuid;
ALTER TABLE public.task_responses ADD COLUMN IF NOT EXISTS actioned_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_actioned_on_behalf_of_fkey') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_actioned_on_behalf_of_fkey
      FOREIGN KEY (actioned_on_behalf_of) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_responses_actioned_by_fkey') THEN
    ALTER TABLE public.task_responses
      ADD CONSTRAINT task_responses_actioned_by_fkey
      FOREIGN KEY (actioned_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- Open tasks of a set of assignees (the manager view), newest due first.
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_assignee_open
  ON public.tasks (tenant_id, assignee_id, due_date)
  WHERE deleted_at IS NULL AND status NOT IN ('completed', 'cancelled');

-- ── 3. Workflow-task guard ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_guard_workflow_task_completion() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  -- Trusted callers (service role, direct DB sessions) and nested trigger
  -- writes (parent progress roll-ups) are not end-user writes.
  IF pg_trigger_depth() > 1 OR public.is_trusted_db_caller() THEN
    RETURN NEW;
  END IF;
  IF NOT coalesce(OLD.is_workflow_task, false) OR OLD.event_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF (NEW.status::text = 'completed' AND OLD.status::text IS DISTINCT FROM 'completed')
     OR NEW.outcome IS DISTINCT FROM OLD.outcome
     OR NEW.actioned_by IS DISTINCT FROM OLD.actioned_by
     OR NEW.actioned_at IS DISTINCT FROM OLD.actioned_at
     OR NEW.actioned_on_behalf_of IS DISTINCT FROM OLD.actioned_on_behalf_of
     OR (NEW.metadata -> 'template_values') IS DISTINCT FROM (OLD.metadata -> 'template_values') THEN
    RAISE EXCEPTION 'workflow_task_completion: complete workflow tasks through the task (assignee or manager on behalf)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guard_workflow_task_completion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_workflow_task_guard ON public.tasks;
CREATE TRIGGER trg_workflow_task_guard
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_workflow_task_completion();

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.task_responses FROM anon, authenticated;

-- ── 4. Permission tasks.complete_any (Owner only) ───────────────────────────

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
  -- Break-glass completion of anyone's workflow task: Owner only.
  v_owner text[] := v_all || array['tasks.complete_any'];
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
    (p_tenant_id, 'Owner',   'owner',   'Full access to everything, including billing and API keys', v_owner,   true, 'owner'),
    (p_tenant_id, 'Admin',   'admin',   'Full administrative access',                                v_all,     true, 'admin'),
    (p_tenant_id, 'Manager', 'manager', 'Builds and manages work; no org administration',            v_manager, true, 'manager'),
    (p_tenant_id, 'Member',  'member',  'Works tasks, data, and reports',                            v_member,  true, 'member'),
    (p_tenant_id, 'Viewer',  'viewer',  'Read-only access',                                          v_viewer,  true, 'viewer');
end;
$$;

UPDATE public.roles
SET permissions = array_append(permissions, 'tasks.complete_any')
WHERE is_system
  AND slug = 'owner'
  AND NOT ('tasks.complete_any' = ANY (permissions));

-- ── 5. Queue functions: service role only ───────────────────────────────────

-- The tasks trigger reads the tenant's active task_* workflows and queues
-- them for a row that already passed the tasks RLS policies (or that a
-- SECURITY DEFINER function wrote): definer rights, fixed search_path.
CREATE OR REPLACE FUNCTION public.fn_enqueue_task_workflows() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_workflow RECORD;
  v_trigger_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_trigger_type := 'task_created';
  ELSIF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status != 'completed') THEN
    v_trigger_type := 'task_completed';
  ELSIF TG_OP = 'UPDATE' AND NEW.acceptance_status = 'rejected' AND (OLD.acceptance_status IS NULL OR OLD.acceptance_status != 'rejected') THEN
    v_trigger_type := 'task_rejected';
  ELSIF TG_OP = 'UPDATE' AND NEW.acceptance_status = 'pending' AND (OLD.acceptance_status IS NULL OR OLD.acceptance_status != 'pending') THEN
    v_trigger_type := 'task_received';
  ELSIF TG_OP = 'UPDATE' AND NEW.acceptance_status = 'accepted' AND (OLD.acceptance_status IS NULL OR OLD.acceptance_status != 'accepted') THEN
    v_trigger_type := 'task_submitted';
  ELSIF TG_OP = 'UPDATE' THEN
    v_trigger_type := 'task_updated';
  ELSE
    RETURN NEW;
  END IF;

  FOR v_workflow IN
    SELECT id FROM public.workflows
    WHERE tenant_id = NEW.tenant_id
      AND is_active = true
      AND trigger_type = v_trigger_type
  LOOP
    PERFORM public.enqueue_workflow(
      v_workflow.id,
      NEW.tenant_id,
      NEW.id,
      v_trigger_type,
      jsonb_build_object(
        'task_id', NEW.id,
        'status', NEW.status,
        'old_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
        'priority', NEW.priority,
        'assignee_id', NEW.assignee_id,
        'acceptance_status', NEW.acceptance_status,
        'acceptance_comment', NEW.acceptance_comment
      ),
      0, 0
    );
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_enqueue_task_workflows() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.enqueue_workflow(uuid, uuid, uuid, text, jsonb, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_workflow(uuid, uuid, uuid, text, jsonb, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_workflow_batch(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_workflow_batch(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.reassign_task(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_task(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.escalate_task(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.escalate_task(uuid, uuid, text) TO service_role;

-- ── 6. Event stream: on-behalf fields on task events ────────────────────────

CREATE OR REPLACE FUNCTION app_events.tg_lifecycle_events() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_event text;
  v_meta jsonb;
BEGIN
  BEGIN
    v_event := NEW.event_type::text;
    v_meta := CASE WHEN jsonb_typeof(NEW.metadata) = 'object' THEN NEW.metadata ELSE '{}'::jsonb END;
    PERFORM app_events.emit(
      NEW.tenant_id, 'task.' || app_events.seg(v_event), 'task',
      CASE WHEN v_event IN ('escalated', 'task_escalated', 'blocked', 'task_rejected', 'task_unanimous_failed') THEN 'warn' ELSE 'info' END,
      'Task ' || replace(regexp_replace(v_event, '^task_', ''), '_', ' ')
        || CASE WHEN v_meta ? 'old_status' OR v_meta ? 'new_status'
                THEN ' (' || coalesce(v_meta ->> 'old_status', '?') || ' → ' || coalesce(v_meta ->> 'new_status', '?') || ')'
                ELSE '' END
        || CASE WHEN coalesce(v_meta ->> 'on_behalf_of', '') <> '' THEN ' on behalf of the assignee' ELSE '' END,
      'lifecycle_events', NEW.id::text, NULL, NULL, NULL, NEW.task_id, NEW.actor_id,
      jsonb_build_object(
        'event_type', v_event,
        'old_status', v_meta ->> 'old_status',
        'new_status', v_meta ->> 'new_status',
        'old_assignee', v_meta ->> 'old_assignee',
        'new_assignee', v_meta ->> 'new_assignee'
      ) || jsonb_strip_nulls(jsonb_build_object(
        'outcome', app_events.clip(v_meta ->> 'outcome', 120),
        'via', app_events.clip(v_meta ->> 'via', 40),
        'acted_as', app_events.clip(v_meta ->> 'acted_as', 40),
        'on_behalf_of', v_meta ->> 'on_behalf_of',
        'on_behalf_note', app_events.clip(v_meta ->> 'on_behalf_note', 500)
      )),
      NEW.created_at
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_events.tg_lifecycle_events failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION app_events.tg_lifecycle_events() FROM PUBLIC, anon, authenticated;
