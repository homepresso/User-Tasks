-- Removes everything fixtures.sql (and the conformance write cases) created:
-- every public row of the fixture workspaces (shared + personal), then the
-- auth users. Loops because FK order between tables isn't known up front.
DO $$
DECLARE
  v_tenants uuid[];
  v_table text;
  v_pass int;
  v_left int;
BEGIN
  SELECT array_agg(DISTINCT t) INTO v_tenants FROM (
    SELECT 'c0f00000-0000-4000-8000-000000000001'::uuid AS t
    UNION SELECT tenant_id FROM public.users WHERE email LIKE '%@pgq.test'
    UNION SELECT tenant_id FROM public.user_memberships WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@pgq.test')
  ) x WHERE t IS NOT NULL;
  FOR v_pass IN 1..6 LOOP
    v_left := 0;
    FOR v_table IN
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT IN ('tenants', 'users')
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE tenant_id = ANY($1)', v_table) USING v_tenants;
      EXCEPTION WHEN foreign_key_violation THEN v_left := v_left + 1;
      END;
    END LOOP;
    EXIT WHEN v_left = 0;
  END LOOP;
  DELETE FROM public.users WHERE email LIKE '%@pgq.test' OR tenant_id = ANY(v_tenants);
  DELETE FROM public.tenants WHERE id = ANY(v_tenants);
  DELETE FROM auth.users WHERE email LIKE '%@pgq.test';
END $$;
