-- ============================================================================
-- Custom form controls: modules up to 2 MB (was 1 MB).
--
-- The official gallery's PDF viewer bundles pdf.js with its worker inlined
-- (a sandboxed control frame may not start workers), about 1.5 MB. The app
-- enforces the same limit (PACKAGE_LIMITS.moduleBytes in
-- lib/forms/custom-controls/contract.ts) before anything is stored.
--
-- Additive and idempotent: only the CHECK on form_control_versions.bundle
-- is widened. Safe to run before or after the app deploy (the app refuses
-- modules over 2 MB either way; until this runs, 1-2 MB modules fail with a
-- clear database error).
-- ============================================================================

DO $$
DECLARE
  c record;
BEGIN
  IF to_regclass('public.form_control_versions') IS NULL THEN
    RETURN;
  END IF;
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.form_control_versions'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%octet_length(bundle)%'
  LOOP
    EXECUTE format('ALTER TABLE public.form_control_versions DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.form_control_versions
    ADD CONSTRAINT form_control_versions_bundle_size CHECK (octet_length(bundle) <= 2097152);
END $$;
