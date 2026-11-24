-- Repair cloud workspaces created by the beta self-signup between July and
-- 11 Nov 2026 (fixed on 12 Nov):
--   1. the founder was granted 'member' on their own workspace instead of
--      'owner' (their users.role already says owner), so nobody could manage
--      it. Promote that single founder to owner.
--   2. each of those signups also left an empty personal workspace behind.
--      Delete those leftovers.
-- Targets are named explicitly AND guarded on their current state, so this is
-- a no-op on any other install (self-hosted) and safe to re-run.

-- 1. Founder becomes owner: only where the workspace has exactly one active
--    membership, no owner at all, the member's home workspace is this one and
--    their users.role is already 'owner'.
UPDATE public.user_memberships m
SET role = 'owner'
FROM public.tenants t, public.users u
WHERE m.tenant_id = t.id
  AND u.id = m.user_id
  AND t.slug IN ('hobbihopp', 'test', 'easydocgen', 'vesaac-pharmacy', 'xen-family-office', 'jryder', 'beta-inc', 'walkme')
  AND m.role::text = 'member'
  AND m.is_active
  AND u.tenant_id = t.id
  AND u.role::text = 'owner'
  AND (SELECT count(*) FROM public.user_memberships m2 WHERE m2.tenant_id = t.id) = 1
  AND NOT EXISTS (SELECT 1 FROM public.user_memberships m3 WHERE m3.tenant_id = t.id AND m3.role::text = 'owner');

-- 2. Empty leftover personal workspaces from those signups: only while they
--    still have no memberships, no user calls them home or current, and they
--    hold no forms or workflows. (Automated-test workspaces are not listed.)
-- migration-safety: reviewed — deletes only the 8 named workspaces, and only while they have no members, no users, no forms and no workflows (verified empty on 2026-11-23); no user data is lost
DELETE FROM public.tenants t
WHERE t.slug IN ('personal-f5371fec', 'personal-6fc417fa', 'personal-d6e98376', 'personal-64367115',
                 'personal-4aff6e8e', 'personal-d1666812', 'personal-d9c5a6b5', 'personal-df9ca8dd')
  AND NOT EXISTS (SELECT 1 FROM public.user_memberships m WHERE m.tenant_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.tenant_id = t.id OR u.current_tenant_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.forms f WHERE f.tenant_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.workflows w WHERE w.tenant_id = t.id);
