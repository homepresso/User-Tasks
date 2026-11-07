-- Users are visible to a workspace through an active membership, not through
-- the legacy users.tenant_id column.
--
-- users.tenant_id is the account's home workspace. Early beta sign-ups
-- (April 2026) were created with tenant_id pointing at another workspace and
-- then given their own personal workspace (membership is_home = true there),
-- so the stale tenant_id made them appear in that other workspace's people
-- pickers and assignment lists although they were never members of it.
--
-- 1. Repair: an account whose tenant_id names a workspace it has no active
--    membership in is pointed at its home membership's workspace.
-- 2. users_select: the caller's own row, or users with an active membership
--    in a workspace the caller can see (rls_visible_tenant_ids: the current
--    workspace, or all member workspaces in the unified view). A stale
--    tenant_id can no longer expose an account.
--
-- Idempotent: the repair only touches mismatched rows; the policy is replaced.

-- 1. Repair stale home-workspace links.
UPDATE public.users u
   SET tenant_id = home.tenant_id
  FROM public.user_memberships home
 WHERE home.user_id = u.id
   AND home.is_home = true
   AND home.is_active = true
   AND u.tenant_id IS DISTINCT FROM home.tenant_id
   AND NOT EXISTS (
     SELECT 1 FROM public.user_memberships m
      WHERE m.user_id = u.id AND m.tenant_id = u.tenant_id AND m.is_active = true
   )
   -- (email, tenant_id) is unique: never collide with another row in the home workspace.
   AND NOT EXISTS (
     SELECT 1 FROM public.users other
      WHERE other.id <> u.id AND other.tenant_id = home.tenant_id AND other.email = u.email
   );

-- The workspace an account last switched to must be one it belongs to.
UPDATE public.users u
   SET current_tenant_id = u.tenant_id
 WHERE u.current_tenant_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.user_memberships m
      WHERE m.user_id = u.id AND m.tenant_id = u.current_tenant_id AND m.is_active = true
   );

-- 2. Membership-based visibility.
DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users FOR SELECT
  USING (
    id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_memberships m
       WHERE m.user_id = users.id
         AND m.is_active = true
         AND m.tenant_id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[])
    )
  );
