-- Bring older workspaces' Viewer and Member system roles onto the current defaults.
--
-- Workspaces created before 20261216 were seeded with an older Viewer set
-- (tasks.view_all, workflows.view_runs, agents.view, integrations.view,
-- sometimes extensibility.view — and WITHOUT tasks.complete, so viewers could
-- not complete tasks assigned to them) and an older Member set (tasks.escalate,
-- no tasks.assign / reports.create). 20261226100000_governance_audit removed
-- only workflows.view / forms.view, to keep owner edits.
--
-- Only roles whose permission set is EXACTLY one of those old seeded sets are
-- changed (a role an owner edited is left alone). Custom roles are never
-- touched. Idempotent: the new sets don't match the old ones.

DO $$
DECLARE
  v_viewer text[] := ARRAY['data.view','forms.submit','org.view','projects.view','reports.view',
                           'tasks.complete','tasks.view_own','team.view_members'];
  v_member text[] := ARRAY['data.manage_rows','data.view','forms.submit','org.view','projects.view',
                           'reports.create','reports.edit_own','reports.view','tasks.assign',
                           'tasks.complete','tasks.create','tasks.view_own','team.view_members',
                           'workflows.view_queue'];
  old_viewer_a text[] := ARRAY['agents.view','data.view','forms.submit','integrations.view','org.view',
                               'projects.view','reports.view','tasks.view_all','tasks.view_own',
                               'team.view_members','workflows.view_runs'];
  old_viewer_b text[] := old_viewer_a || ARRAY['extensibility.view'];
  old_member_a text[] := ARRAY['data.manage_rows','data.view','forms.submit','org.view','projects.view',
                               'reports.edit_own','reports.view','tasks.complete','tasks.create',
                               'tasks.escalate','tasks.view_own','team.view_members','workflows.view_queue'];
  old_member_b text[] := old_member_a || ARRAY['extensibility.view'];
BEGIN
  UPDATE public.roles r
     SET permissions = v_viewer
   WHERE r.is_system AND r.slug = 'viewer'
     AND (r.permissions @> old_viewer_a AND r.permissions <@ old_viewer_a
       OR r.permissions @> old_viewer_b AND r.permissions <@ old_viewer_b);

  UPDATE public.roles r
     SET permissions = v_member
   WHERE r.is_system AND r.slug = 'member'
     AND (r.permissions @> old_member_a AND r.permissions <@ old_member_a
       OR r.permissions @> old_member_b AND r.permissions <@ old_member_b);
END $$;
