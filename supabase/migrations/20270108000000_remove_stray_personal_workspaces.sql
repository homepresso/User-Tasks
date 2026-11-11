-- Signup used to leave an empty "<name>'s Workspace" next to the workspace a
-- person named (fixed in lib/tenant-provisioning.ts). Soft-delete those empty
-- personal workspaces: slug personal-<id prefix>, no members, no roles, no
-- user pointing at them, no invitations and no content. Reversible: clear
-- tenants.deleted_at to restore one.
--
-- Also: the avatar menu no longer has a workspace switcher, so anyone left
-- in the "All organizations" view (current_tenant_id NULL) is moved to their
-- home workspace.

update public.tenants t
   set deleted_at = now()
 where t.deleted_at is null
   and t.slug like 'personal-%'
   and not exists (select 1 from public.user_memberships m where m.tenant_id = t.id)
   and not exists (select 1 from public.user_roles r where r.tenant_id = t.id)
   and not exists (select 1 from public.users u where u.tenant_id = t.id or u.current_tenant_id = t.id)
   and not exists (select 1 from public.invitations i where i.tenant_id = t.id)
   and not exists (select 1 from public.forms f where f.tenant_id = t.id)
   and not exists (select 1 from public.workflows w where w.tenant_id = t.id)
   and not exists (select 1 from public.tasks k where k.tenant_id = t.id)
   and not exists (select 1 from public.form_submissions s where s.tenant_id = t.id)
   and not exists (select 1 from public.custom_tables c where c.tenant_id = t.id)
   and not exists (select 1 from public.reports p where p.tenant_id = t.id)
   and not exists (select 1 from public.api_keys a where a.tenant_id = t.id);

update public.users u
   set current_tenant_id = u.tenant_id
 where u.current_tenant_id is null
   and u.tenant_id is not null
   and exists (select 1 from public.tenants t where t.id = u.tenant_id and t.deleted_at is null);
