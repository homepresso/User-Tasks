-- Audit trail integrity: a signed-in person cannot write audit rows in
-- someone else's name.
--
-- object_audit_log, permission_audit_log and lifecycle_events let any member
-- of the current workspace INSERT (the app writes them with the caller's own
-- session), and the policies only checked tenant_id. So a member, even a
-- viewer, could call PostgREST directly and add a row such as "the owner
-- deleted API key X" with actor_id = the owner. Rows also flow into
-- event_stream and on to the customer's SIEM (log export).
--
-- * BEFORE INSERT trigger: when the statement runs as a session role
--   (authenticated / anon, i.e. through PostgREST or the built-in auth's
--   SET ROLE), actor_id is forced to auth.uid(). The service role, SECURITY
--   DEFINER functions and the migration owner are unchanged (workers,
--   instance-admin on-behalf actions, system rows keep their own actor).
--   Nothing is rejected, so an app write is never lost; a value the caller
--   supplied for someone else is simply replaced by the caller.
-- * No UPDATE / DELETE policies existed (RLS already refused both); the
--   privileges are revoked too, with TRUNCATE (which RLS does not cover), so
--   the history stays append-only for session roles even if a permissive
--   policy is added later by mistake.
--
-- Plain SQL; idempotent.

CREATE OR REPLACE FUNCTION public.fn_audit_actor_is_caller()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.actor_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_audit_actor_is_caller() FROM PUBLIC;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['object_audit_log', 'permission_audit_log', 'lifecycle_events'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_actor_is_caller ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_actor_is_caller BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_audit_actor_is_caller()',
      t
    );
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM anon', t);
    END IF;
  END LOOP;
END
$$;
