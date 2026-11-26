-- Task tables: end users read, the server writes.
--
-- Until now every workspace member could INSERT / UPDATE / DELETE tasks,
-- task_assignees, task_dependencies, task_reminders and task_escalations of
-- their workspace through PostgREST with their own JWT (the policies are
-- tenant-wide; the finer task rules — who may assign, complete, redirect —
-- live in the app). A member could add themselves as a collaborator on any
-- task (task_assignees) or set themselves as its assignee and then complete,
-- say, an approval meant for someone else. They could also insert
-- notifications for any colleague.
--
-- The app now performs these writes with the service role after its own
-- checks (app/actions/tasks.ts, task-queue.ts, task-dependencies.ts,
-- lib/services/tasks.ts, task-effort.ts, workflow-runs.ts; everything else
-- already did), so end users lose the write grants. SELECT is unchanged.
-- notifications keeps UPDATE / DELETE of one's own rows (mark read, dismiss);
-- only INSERT goes.
--
-- Service-role writes made for a user carry that user in the
-- x-usertasks-actor request header (lib/providers/db ACTOR_HEADER).
-- public.request_actor_id() trusts it only from the service role, and the
-- tasks triggers use it where they used auth.uid(): lifecycle history keeps
-- the actor, and nobody is notified about their own change. Without the
-- header (workflow engine, jobs) nothing changes.
--
-- The audit tables (object_audit_log, permission_audit_log,
-- lifecycle_events) are handled by 20270130090000_audit_actor_integrity.
-- Idempotent. Apply after deploying the code that ships with it (before
-- that, the old code's session-client writes would be refused).

CREATE OR REPLACE FUNCTION public.request_actor_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RETURN auth.uid();
  END IF;
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RETURN NULL;
  END IF;
  v := nullif(current_setting('request.headers', true), '')::json ->> 'x-usertasks-actor';
  IF v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN v::uuid;
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.request_actor_id() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.request_actor_id() FROM anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.request_actor_id() TO service_role';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_log_lifecycle_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO lifecycle_events (tenant_id, task_id, event_type, actor_id, metadata)
    VALUES (
      NEW.tenant_id, NEW.id,
      CASE NEW.status
        WHEN 'in_progress' THEN 'started'::lifecycle_event_type
        WHEN 'completed'   THEN 'completed'::lifecycle_event_type
        WHEN 'cancelled'   THEN 'cancelled'::lifecycle_event_type
        WHEN 'blocked'     THEN 'blocked'::lifecycle_event_type
        ELSE 'created'::lifecycle_event_type
      END,
      public.request_actor_id(),
      jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status)
    );
  END IF;

  IF OLD.assignee_id IS DISTINCT FROM NEW.assignee_id
     AND OLD.assignee_id IS NOT NULL
  THEN
    INSERT INTO lifecycle_events (tenant_id, task_id, event_type, actor_id, metadata)
    VALUES (
      NEW.tenant_id, NEW.id, 'reassigned', public.request_actor_id(),
      jsonb_build_object('old_assignee', OLD.assignee_id, 'new_assignee', NEW.assignee_id)
    );
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_notify_on_task_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := public.request_actor_id();
BEGIN
  -- Notify on assignment (new assignee)
  IF OLD.assignee_id IS DISTINCT FROM NEW.assignee_id
    AND NEW.assignee_id IS NOT NULL
    AND NEW.assignee_id != v_actor
  THEN
    INSERT INTO notifications (user_id, tenant_id, type, title, body, task_id)
    VALUES (
      NEW.assignee_id, NEW.tenant_id, 'task_assigned',
      'Task assigned to you',
      'You''ve been assigned: ' || NEW.title,
      NEW.id
    );
  END IF;

  -- Notify assigner on completion
  IF NEW.status = 'completed' AND OLD.status != 'completed'
    AND NEW.assigner_id IS NOT NULL
    AND NEW.assigner_id != v_actor
  THEN
    INSERT INTO notifications (user_id, tenant_id, type, title, body, task_id)
    VALUES (
      NEW.assigner_id, NEW.tenant_id, 'task_completed',
      'Task completed',
      NEW.title || ' has been completed',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- End-user write grants (table level, and any column-level grants).
DO $$
DECLARE
  t text;
  r text;
  cols text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN CONTINUE; END IF;
    FOREACH t IN ARRAY ARRAY['tasks', 'task_assignees', 'task_dependencies', 'task_reminders', 'task_escalations'] LOOP
      IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM %I', t, r);
      SELECT string_agg(quote_ident(attname), ', ') INTO cols
        FROM pg_attribute WHERE attrelid = ('public.' || t)::regclass AND attnum > 0 AND NOT attisdropped;
      EXECUTE format('REVOKE INSERT (%s), UPDATE (%s) ON public.%I FROM %I', cols, cols, t, r);
    END LOOP;
    IF to_regclass('public.notifications') IS NOT NULL THEN
      EXECUTE format('REVOKE INSERT, TRUNCATE ON public.notifications FROM %I', r);
      SELECT string_agg(quote_ident(attname), ', ') INTO cols
        FROM pg_attribute WHERE attrelid = 'public.notifications'::regclass AND attnum > 0 AND NOT attisdropped;
      EXECUTE format('REVOKE INSERT (%s) ON public.notifications FROM %I', cols, r);
    END IF;
  END LOOP;
END $$;

-- The insert policy no longer applies to anyone without the grant; drop it
-- so a future GRANT can't silently re-open "notify any colleague".
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
