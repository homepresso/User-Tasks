-- ROLLBACK ONLY: undoes the grant changes of
-- supabase/migrations/20270130140000_task_tables_service_writes.sql.
-- This file lives outside supabase/migrations on purpose: it must never be
-- applied automatically. Run it by hand ONLY after the previous deployment
-- (code from before 20270130140000, which writes the task tables with the
-- signed-in user's session) has been promoted again. See "Rolling back the
-- hotfix" in docs/migrations.md.
--
-- What it restores (copied from the migrations that defined them):
--  * 20261015000000_baseline.sql: GRANT ALL ON TABLE tasks, task_assignees,
--    task_dependencies, task_reminders, task_escalations, notifications TO
--    anon, authenticated (table level; no column-level grants existed).
--    140000 revoked INSERT, UPDATE, DELETE, TRUNCATE on the five task tables
--    and INSERT, TRUNCATE on notifications from both roles; exactly those are
--    granted back. anon is included because the pre-140000 RLS semantics
--    depend on it (its UPDATE / DELETE found 0 rows rather than failing with
--    42501); RLS still refuses every anon write, as before.
--  * 20261027000000_rls_initplan.sql: the notifications_insert policy.
--
-- Deliberately NOT restored:
--  * public.request_actor_id() and the tasks trigger bodies 140000 changed:
--    with a signed-in session request_actor_id() returns auth.uid(), exactly
--    what the old triggers used, so old code behaves as before.
--
-- Idempotent (GRANT is a no-op when held; the policy is dropped and
-- recreated). Plain SQL; roles are checked so it also runs on plain
-- PostgreSQL installs.

DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN CONTINUE; END IF;
    FOREACH t IN ARRAY ARRAY['tasks', 'task_assignees', 'task_dependencies', 'task_reminders', 'task_escalations'] LOOP
      IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
      EXECUTE format('GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.%I TO %I', t, r);
    END LOOP;
    IF to_regclass('public.notifications') IS NOT NULL THEN
      EXECUTE format('GRANT INSERT, TRUNCATE ON TABLE public.notifications TO %I', r);
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS notifications_insert ON public.notifications;
CREATE POLICY notifications_insert ON public.notifications FOR INSERT
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND tenant_id = (SELECT public.get_current_tenant_id()));
