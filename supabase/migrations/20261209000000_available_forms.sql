-- ============================================================================
-- 20261209000000_available_forms.sql
--
-- "Available forms": a reusable form can be listed in the sidebar's Forms
-- menu for the people who were given access to it.
--
-- 1. public.forms.available_in_menu (boolean, default false): the form's
--    "Available forms" setting. A form setting like name and description —
--    it does not create a form version, and every version change keeps it.
--
-- 2. public.list_available_forms(p_tenant_id, p_user_id): the forms in a
--    person's menu, in one round trip, sorted by name. A form is listed when
--      - it belongs to p_tenant_id and has available_in_menu = true;
--      - the person holds forms.submit in that workspace (a role of theirs
--        there grants it — they can open and submit form pages);
--      - an EXPLICIT grant on the form (object_permissions, object_type
--        'form', with View or Submit/Execute) names the person directly, a
--        team they belong to, or a role they hold in the workspace.
--    Workspace-wide rights alone (Owner / Admin, forms.view, being the
--    form's creator) never list a form: only explicit grants do.
--
--    SECURITY INVOKER: called with a signed-in user's client, RLS applies
--    (forms, object_permissions, user_roles, user_teams and roles all scope
--    to the caller's workspaces), and a signed-in caller can only ask for
--    their own menu (p_user_id must be auth.uid()). The service (service
--    role, API callers acting as a user) passes the tenant and user
--    explicitly; every table is also filtered by p_tenant_id here.
--
-- 3. object_permissions: object_type allows 'form' again (grants on forms),
--    and an object can hold several grants (the baseline's NULLS NOT
--    DISTINCT unique constraints allowed one grant row per object; now one
--    per grantee).
--
-- 4. Indexes: a partial index on available forms per workspace; the grant
--    lookups use the existing object_permissions, user_roles and user_teams
--    indexes.
--
-- Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS available_in_menu boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.forms.available_in_menu IS
  'Available forms: list this form in the sidebar Forms menu of people with an explicit grant on it (object_permissions, object_type form). Not versioned.';

-- Grants on forms: 'form' back in object_permissions.object_type (the
-- strip-back narrowed the list before reusable forms existed). The allowed
-- values are read from the live constraint and 'form' is added, so types
-- other migrations allowed are kept.
DO $$
DECLARE
  v_def text;
  v_types text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.object_permissions'::regclass AND conname = 'object_permissions_object_type_check';
  -- No constraint (every type allowed) or 'form' already allowed: nothing to do.
  IF v_def IS NULL OR v_def LIKE '%''form''%' THEN
    RETURN;
  END IF;
  SELECT coalesce(array_agg(DISTINCT m[1]), '{}') INTO v_types
    FROM regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') AS m;
  v_types := array_append(v_types, 'form');
  ALTER TABLE public.object_permissions DROP CONSTRAINT IF EXISTS object_permissions_object_type_check;
  -- An IN list: Postgres stores it as ANY (ARRAY['a'::text, ...]), one quoted value each, so a re-run reads it back.
  EXECUTE format(
    'ALTER TABLE public.object_permissions ADD CONSTRAINT object_permissions_object_type_check CHECK (object_type IN (%s))',
    (SELECT string_agg(quote_literal(t), ', ' ORDER BY t) FROM unnest(v_types) AS t));
END $$;

-- One grant per grantee, not one grant per object: the baseline's
-- UNIQUE NULLS NOT DISTINCT (…, role_id) / (…, team_id) / (…, user_id)
-- constraints treated the NULL columns of every other kind of grant as equal,
-- so an object could hold a single grant row in all (a second person, team or
-- role failed with 23505). Partial unique indexes keep each grantee unique
-- per object and let an object be shared with several.
CREATE UNIQUE INDEX IF NOT EXISTS uq_obj_perm_user_grant ON public.object_permissions (tenant_id, object_type, object_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_obj_perm_team_grant ON public.object_permissions (tenant_id, object_type, object_id, team_id) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_obj_perm_role_grant ON public.object_permissions (tenant_id, object_type, object_id, role_id) WHERE role_id IS NOT NULL;
ALTER TABLE public.object_permissions DROP CONSTRAINT IF EXISTS unique_user_object;
ALTER TABLE public.object_permissions DROP CONSTRAINT IF EXISTS unique_team_object;
ALTER TABLE public.object_permissions DROP CONSTRAINT IF EXISTS unique_role_object;

CREATE INDEX IF NOT EXISTS idx_forms_available_in_menu
  ON public.forms (tenant_id, lower(name))
  WHERE available_in_menu;

CREATE OR REPLACE FUNCTION public.list_available_forms(p_tenant_id uuid, p_user_id uuid)
RETURNS TABLE (id uuid, name text, description text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  SELECT f.id, f.name, f.description
    FROM public.forms f
   WHERE p_tenant_id IS NOT NULL
     AND p_user_id IS NOT NULL
     -- A signed-in caller only ever reads their own menu.
     AND (auth.uid() IS NULL OR auth.uid() = p_user_id)
     AND f.tenant_id = p_tenant_id
     AND f.available_in_menu
     -- The person can open and submit form pages in this workspace.
     AND EXISTS (
       SELECT 1
         FROM public.user_roles ur
         JOIN public.roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id
        WHERE ur.user_id = p_user_id
          AND ur.tenant_id = p_tenant_id
          AND 'forms.submit' = ANY (r.permissions)
     )
     -- An explicit grant on this form: the person, one of their teams or one of their roles.
     AND EXISTS (
       SELECT 1
         FROM public.object_permissions op
        WHERE op.tenant_id = p_tenant_id
          AND op.object_type = 'form'
          AND op.object_id = f.id
          AND (op.can_view OR op.can_execute)
          AND (
            op.user_id = p_user_id
            OR op.team_id IN (
              SELECT ut.team_id
                FROM public.user_teams ut
                JOIN public.teams t ON t.id = ut.team_id AND t.tenant_id = p_tenant_id
               WHERE ut.user_id = p_user_id
            )
            OR op.role_id IN (
              SELECT ur.role_id FROM public.user_roles ur
               WHERE ur.user_id = p_user_id AND ur.tenant_id = p_tenant_id
            )
          )
     )
   ORDER BY lower(f.name), f.name, f.id
$$;

COMMENT ON FUNCTION public.list_available_forms(uuid, uuid) IS
  'The sidebar Forms menu: available_in_menu forms of the workspace the user holds forms.submit in and has an explicit grant on (direct, team or role). Sorted by name.';

REVOKE ALL ON FUNCTION public.list_available_forms(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_available_forms(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_available_forms(uuid, uuid) TO authenticated, service_role;
