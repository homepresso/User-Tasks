-- ============================================================================
-- 20261015000004_strip_back.sql
--
-- Strip-back: UserTasks becomes a headless workflow engine. Drops every table,
-- column, function, trigger, type, CHECK value and permission key that
-- belonged to a retired feature: cases/case types, channels, messages,
-- pages/forms/templates/form themes/fonts/web components/component
-- templates, kanban, home dashboard, capacity, documents, apps/workspaces,
-- polls, unit metering (token ledger/balances).
--
-- Idempotent (IF EXISTS everywhere, guarded data fixes) and written to run on
-- both a fresh database (baseline + 0001-0003) and the production database,
-- which may carry live-only stragglers (dropped with IF EXISTS).
--
-- POINT OF NO RETURN for retired-feature data. Take a data backup first:
--   npx supabase db dump --linked --data-only --use-copy -f backups/<date>_data.sql
-- ============================================================================

-- DROP TABLE needs ACCESS EXCLUSIVE; app connections idling in a transaction
-- on these tables would make it queue forever. Fail fast instead, and clear
-- idle-in-transaction blockers first.
SET lock_timeout = '10s';

DO $$
DECLARE b record;
BEGIN
  FOR b IN
    SELECT DISTINCT l.pid
    FROM pg_locks l
    JOIN pg_class c ON c.oid = l.relation
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE c.relname IN (
        'tasks', 'notifications', 'lifecycle_events', 'object_audit_log',
        'cases', 'channels', 'apps', 'app_pages', 'form_templates',
        'kanban_boards', 'kanban_items', 'documents', 'document_folders',
        'message_conversations', 'messages', 'token_ledger', 'token_balances')
      AND l.pid <> pg_backend_pid()
      AND a.state IN ('idle in transaction', 'idle in transaction (aborted)')
  LOOP
    RAISE NOTICE 'strip_back: terminating idle-in-transaction backend % holding a lock', b.pid;
    PERFORM pg_terminate_backend(b.pid);
  END LOOP;
END $$;

-- ── 1. Triggers on KEEP tables that call retired code ──────────────────────
-- trg_debit_tokens wrote token_ledger on every task insert; it would fail
-- every insert once token_ledger is gone.
DROP TRIGGER IF EXISTS trg_debit_tokens ON public.tasks;

-- ── 2. Data fixes that must precede the schema changes ─────────────────────

-- lifecycle_events rows that belonged to cases (no task) go; task_id becomes
-- NOT NULL below.
DELETE FROM public.lifecycle_events WHERE task_id IS NULL;

-- Notifications about conversations/cases point at dropped rows.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'conversation_id') THEN
    EXECUTE 'DELETE FROM public.notifications WHERE conversation_id IS NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'case_id') THEN
    EXECUTE 'DELETE FROM public.notifications WHERE case_id IS NOT NULL';
  END IF;
END $$;

-- Object-level grants on retired object types.
DELETE FROM public.object_permissions
WHERE object_type NOT IN ('workflow', 'data_table', 'agent', 'integration', 'api_key', 'report');

-- Deletion-queue jobs for retired target types (any status — the tightened
-- CHECK must hold for every row).
DELETE FROM public.deletion_queue
WHERE target_type NOT IN (
  'workflow', 'report', 'data_table', 'data_row', 'integration',
  'decision_table', 'agent', 'workflow_activity', 'retention_policy');

-- Retention events for documents / folders.
DELETE FROM public.retention_review_events    WHERE target_type NOT IN ('data_table', 'data_row', 'role');
DELETE FROM public.retention_execution_events WHERE target_type NOT IN ('data_table', 'data_row', 'role');

-- Retention policies: forget the documents/folders scopes.
UPDATE public.retention_policies
SET applies_to = array_remove(array_remove(applies_to, 'documents'), 'folders')
WHERE applies_to && ARRAY['documents', 'folders'];

UPDATE public.retention_policies
SET applies_to = ARRAY['data_tables', 'data_rows', 'roles']
WHERE cardinality(applies_to) = 0;

-- ── 3. Retired tables ──────────────────────────────────────────────────────
-- CASCADE also removes their FKs from KEEP tables (tasks.template_id/app_id,
-- notifications.case_id/conversation_id, lifecycle_events.case_id,
-- object_audit_log.app_id), their triggers, policies and realtime membership.
-- case_comments, case_templates, poll_votes, polls and logos were never
-- applied to production; they are listed for databases that did get them.

-- cases / case types
DROP TABLE IF EXISTS public.case_comments CASCADE;
DROP TABLE IF EXISTS public.case_participants CASCADE;
DROP TABLE IF EXISTS public.case_tasks CASCADE;
DROP TABLE IF EXISTS public.cases CASCADE;
DROP TABLE IF EXISTS public.case_counters CASCADE;
DROP TABLE IF EXISTS public.case_templates CASCADE;
DROP TABLE IF EXISTS public.case_types CASCADE;
-- channels
DROP TABLE IF EXISTS public.channel_members CASCADE;
DROP TABLE IF EXISTS public.channel_screens CASCADE;
DROP TABLE IF EXISTS public.channels CASCADE;
-- messages
DROP TABLE IF EXISTS public.message_participants CASCADE;
DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.message_conversations CASCADE;
-- kanban
DROP TABLE IF EXISTS public.kanban_item_tasks CASCADE;
DROP TABLE IF EXISTS public.kanban_subscriptions CASCADE;
DROP TABLE IF EXISTS public.kanban_items CASCADE;
DROP TABLE IF EXISTS public.kanban_columns CASCADE;
DROP TABLE IF EXISTS public.kanban_boards CASCADE;
-- pages / forms / templates / themes / fonts / web components / polls
DROP TABLE IF EXISTS public.app_page_versions CASCADE;
DROP TABLE IF EXISTS public.app_pages CASCADE;
DROP TABLE IF EXISTS public.form_events CASCADE;
DROP TABLE IF EXISTS public.form_submissions CASCADE;
DROP TABLE IF EXISTS public.form_template_versions CASCADE;
DROP TABLE IF EXISTS public.form_templates CASCADE;
DROP TABLE IF EXISTS public.form_themes CASCADE;
DROP TABLE IF EXISTS public.component_templates CASCADE;
DROP TABLE IF EXISTS public.custom_web_components CASCADE;
DROP TABLE IF EXISTS public.tenant_fonts CASCADE;
DROP TABLE IF EXISTS public.poll_votes CASCADE;
DROP TABLE IF EXISTS public.polls CASCADE;
-- documents
DROP TABLE IF EXISTS public.document_versions CASCADE;
DROP TABLE IF EXISTS public.documents CASCADE;
DROP TABLE IF EXISTS public.document_folders CASCADE;
DROP TABLE IF EXISTS public.document_metadata_templates CASCADE;
-- apps / workspaces
DROP TABLE IF EXISTS public.app_teams CASCADE;
DROP TABLE IF EXISTS public.app_assets CASCADE;
DROP TABLE IF EXISTS public.apps CASCADE;
-- home dashboard, legacy logos table (branding lives in tenants.branding +
-- the `logos` storage bucket, both kept)
DROP TABLE IF EXISTS public.dashboard_configs CASCADE;
DROP TABLE IF EXISTS public.logos CASCADE;
-- unit metering
DROP TABLE IF EXISTS public.token_ledger CASCADE;
DROP TABLE IF EXISTS public.token_balances CASCADE;

-- ── 4. Retired columns on KEEP tables ──────────────────────────────────────
ALTER TABLE public.tasks DROP COLUMN IF EXISTS template_id;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS app_id;
ALTER TABLE public.object_audit_log DROP COLUMN IF EXISTS app_id;
ALTER TABLE public.notifications DROP COLUMN IF EXISTS conversation_id;
ALTER TABLE public.notifications DROP COLUMN IF EXISTS case_id;
ALTER TABLE public.lifecycle_events DROP CONSTRAINT IF EXISTS lifecycle_events_target_check;
ALTER TABLE public.lifecycle_events DROP COLUMN IF EXISTS case_id;
ALTER TABLE public.lifecycle_events ALTER COLUMN task_id SET NOT NULL;
-- users.available_hours_week stays: still a user preference and report column.

-- ── 4b. Schema drift repair (KEEP features) ────────────────────────────────
-- Columns from archived migrations (20260413_custom_table_rows_retention,
-- 20260705_agents_and_queue) that never reached production although the
-- code writes them: agent runs failed to persist (outputs), async agent
-- execution failed to enqueue (created_by), data-row retention could not be
-- assigned, and cleanup-logs could not read its tenant setting.
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS outputs jsonb;
ALTER TABLE public.agent_queue ADD COLUMN IF NOT EXISTS created_by uuid
  REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS agent_run_retention_days integer;
ALTER TABLE public.custom_table_rows ADD COLUMN IF NOT EXISTS retention_policy_id uuid
  REFERENCES public.retention_policies(id) ON DELETE SET NULL;
ALTER TABLE public.custom_table_rows ADD COLUMN IF NOT EXISTS retention_applied_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_custom_table_rows_retention_policy
  ON public.custom_table_rows (tenant_id, retention_policy_id);

-- ── 5. Retired functions ───────────────────────────────────────────────────
-- Every overload of each name is dropped, so live-only signatures go too.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'next_case_number', 'assign_case_number', 'set_cases_updated_at',
        'set_channels_updated_at', 'set_kanban_updated_at',
        'set_app_pages_updated_at', 'kanban_move_item',
        'calculate_user_capacity', 'is_conversation_participant',
        'delete_empty_conversation', 'publish_page', 'grid_group_aggregate',
        'grid_distinct_values', 'fn_debit_tokens_on_task')
  LOOP
    RAISE NOTICE 'strip_back: dropping function %', f.sig;
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', f.sig);
  END LOOP;
END $$;

-- Types only the dropped tables/functions used.
DROP TYPE IF EXISTS public.page_kind;
DROP TYPE IF EXISTS public.token_action_type;

-- ── 6. KEEP functions recreated without retired references ─────────────────

-- New auth user → personal tenant + users row + home membership. The token
-- allowance insert is gone.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tenant_id uuid;
  v_display_name text;
BEGIN
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  INSERT INTO public.tenants (name, slug, plan, auth_provider)
  VALUES (
    v_display_name || '''s Workspace',
    'personal-' || substr(NEW.id::text, 1, 8),
    'personal_free',
    CASE
      WHEN NEW.raw_app_meta_data->>'provider' = 'google'
      THEN 'google'::public.auth_provider
      ELSE 'email'::public.auth_provider
    END
  ) RETURNING id INTO v_tenant_id;

  INSERT INTO public.users (id, tenant_id, email, display_name, role, current_tenant_id)
  VALUES (NEW.id, v_tenant_id, NEW.email, v_display_name, 'owner', v_tenant_id);

  INSERT INTO public.user_memberships (user_id, tenant_id, role, is_home)
  VALUES (NEW.id, v_tenant_id, 'owner', true);

  RETURN NEW;
END;
$$;

-- Task → workflow trigger payload no longer carries the retired template_id.
CREATE OR REPLACE FUNCTION public.fn_enqueue_task_workflows() RETURNS trigger
    LANGUAGE plpgsql
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
    SELECT id FROM workflows
    WHERE tenant_id = NEW.tenant_id
      AND is_active = true
      AND trigger_type = v_trigger_type
  LOOP
    PERFORM enqueue_workflow(
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

-- escalate_task / reassign_task: same behaviour minus the metering debit.
CREATE OR REPLACE FUNCTION public.escalate_task(p_task_id uuid, p_target_user_id uuid, p_notes text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM tasks WHERE id = p_task_id;

  INSERT INTO lifecycle_events (tenant_id, task_id, event_type, actor_id, metadata)
  VALUES (
    v_tenant_id, p_task_id, 'escalated', auth.uid(),
    jsonb_build_object('target_user', p_target_user_id, 'notes', p_notes)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reassign_task(p_task_id uuid, p_new_assignee_id uuid, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE tasks SET assignee_id = p_new_assignee_id WHERE id = p_task_id;
END;
$$;

-- System roles seeded on tenant insert (trg_seed_tenant_roles →
-- trigger_seed_tenant_roles → seed_tenant_roles). Mirrors SYSTEM_ROLES in
-- lib/tenant-provisioning.ts; keep the two in sync.
CREATE OR REPLACE FUNCTION public.seed_tenant_roles(p_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  v_all text[] := array[
    'tasks.create', 'tasks.view_own', 'tasks.view_all', 'tasks.assign',
    'tasks.complete', 'tasks.redirect', 'tasks.escalate', 'tasks.delete',
    'tasks.manage_queue', 'workflows.view', 'workflows.create',
    'workflows.edit', 'workflows.activate', 'workflows.delete',
    'workflows.view_runs', 'agents.view', 'agents.create', 'agents.edit',
    'agents.test', 'agents.delete', 'integrations.view',
    'integrations.create', 'integrations.edit', 'integrations.test',
    'integrations.delete', 'integrations.manage_references',
    'extensibility.view', 'extensibility.create', 'extensibility.edit',
    'extensibility.delete', 'data.view', 'data.create', 'data.edit_schema',
    'data.manage_rows', 'data.delete', 'reports.view', 'reports.create',
    'reports.edit_own', 'reports.share', 'reports.delete',
    'team.view_members', 'team.invite', 'team.remove', 'team.change_roles',
    'settings.view', 'settings.edit', 'settings.manage_api_keys',
    'settings.manage_webhooks', 'sync.view', 'sync.manage', 'sync.deploy'
  ];
  -- ALL minus settings.manage_*, settings.edit, team.change_roles, team.remove
  v_manager text[] := array[
    'tasks.create', 'tasks.view_own', 'tasks.view_all', 'tasks.assign',
    'tasks.complete', 'tasks.redirect', 'tasks.escalate', 'tasks.delete',
    'tasks.manage_queue', 'workflows.view', 'workflows.create',
    'workflows.edit', 'workflows.activate', 'workflows.delete',
    'workflows.view_runs', 'agents.view', 'agents.create', 'agents.edit',
    'agents.test', 'agents.delete', 'integrations.view',
    'integrations.create', 'integrations.edit', 'integrations.test',
    'integrations.delete', 'integrations.manage_references',
    'extensibility.view', 'extensibility.create', 'extensibility.edit',
    'extensibility.delete', 'data.view', 'data.create', 'data.edit_schema',
    'data.manage_rows', 'data.delete', 'reports.view', 'reports.create',
    'reports.edit_own', 'reports.share', 'reports.delete',
    'team.view_members', 'team.invite', 'settings.view', 'sync.view',
    'sync.manage', 'sync.deploy'
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

-- ── 7. CHECK constraints narrowed to KEEP values ───────────────────────────
ALTER TABLE public.object_permissions DROP CONSTRAINT IF EXISTS object_permissions_object_type_check;
ALTER TABLE public.object_permissions
  ADD CONSTRAINT object_permissions_object_type_check
  CHECK (object_type IN ('workflow', 'data_table', 'agent', 'integration', 'api_key', 'report'));

ALTER TABLE public.deletion_queue DROP CONSTRAINT IF EXISTS deletion_queue_target_type_check;
ALTER TABLE public.deletion_queue
  ADD CONSTRAINT deletion_queue_target_type_check
  CHECK (target_type IN (
    'workflow', 'report', 'data_table', 'data_row', 'integration',
    'decision_table', 'agent', 'workflow_activity', 'retention_policy'));

ALTER TABLE public.retention_policies DROP CONSTRAINT IF EXISTS retention_policies_applies_to_check;
ALTER TABLE public.retention_policies
  ADD CONSTRAINT retention_policies_applies_to_check
  CHECK (applies_to <@ ARRAY['data_tables', 'data_rows', 'roles']);
ALTER TABLE public.retention_policies
  ALTER COLUMN applies_to SET DEFAULT ARRAY['data_tables', 'data_rows', 'roles'];

ALTER TABLE public.retention_review_events DROP CONSTRAINT IF EXISTS retention_review_events_target_type_check;
ALTER TABLE public.retention_review_events
  ADD CONSTRAINT retention_review_events_target_type_check
  CHECK (target_type IN ('data_table', 'data_row', 'role'));

ALTER TABLE public.retention_execution_events DROP CONSTRAINT IF EXISTS retention_execution_events_target_type_check;
ALTER TABLE public.retention_execution_events
  ADD CONSTRAINT retention_execution_events_target_type_check
  CHECK (target_type IN ('data_table', 'data_row', 'role'));

-- ── 8. Retired permission keys ─────────────────────────────────────────────
UPDATE public.roles
SET permissions = COALESCE((
  SELECT array_agg(p ORDER BY ord)
  FROM unnest(permissions) WITH ORDINALITY AS u(p, ord)
  WHERE p !~ '^(templates|pages|channels|kanban|documents|apps|cases|capacity)\.'
    AND p <> 'settings.manage_tokens'
), '{}')
WHERE permissions IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(permissions) AS p
    WHERE p ~ '^(templates|pages|channels|kanban|documents|apps|cases|capacity)\.'
       OR p = 'settings.manage_tokens');

-- ── 9. Lifecycle event for the basic task screen's field save ──────────────
ALTER TYPE public.lifecycle_event_type ADD VALUE IF NOT EXISTS 'task_data_saved';

-- ── 10. Storage ────────────────────────────────────────────────────────────
-- Documents-feature objects lived in bucket task-files under documents/…
-- (engine Office files use workflow-files/…, kept). This removes the object
-- rows; the bytes in the storage backend are not touched by SQL — empty the
-- documents/ folder from the dashboard or Storage API to reclaim the space.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    -- Newer storage versions block direct DELETEs unless this is set.
    PERFORM set_config('storage.allow_delete_query', 'true', true);
    DELETE FROM storage.objects WHERE bucket_id = 'task-files' AND name LIKE 'documents/%';
  END IF;
END $$;

-- task-files writes were open to anon; scope them to signed-in users (the
-- server uses the service role, which bypasses RLS). Same as 0003.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "task_files_upload" ON storage.objects;
    CREATE POLICY "task_files_upload" ON storage.objects
      FOR INSERT TO authenticated WITH CHECK (bucket_id = 'task-files');
    DROP POLICY IF EXISTS "task_files_delete" ON storage.objects;
    CREATE POLICY "task_files_delete" ON storage.objects
      FOR DELETE TO authenticated USING (bucket_id = 'task-files');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
