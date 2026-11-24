-- ============================================================================
-- 20270127090000_tenant_delete_fk_actions.sql
--
-- Deleting a workspace (DELETE FROM public.tenants) failed: a handful of
-- tenant foreign keys still had the default NO ACTION from the baseline
-- dump, so the workspace's own rows blocked the delete
--   agent_queue / agent_runs / agents, task_assignees / task_escalations /
--   task_reminders / task_responses, workflow_logs, workflow_versions
-- (which, in turn, held up its tasks, runs and run versions), and any member
-- of ANOTHER workspace whose users.current_tenant_id pointed at it.
--
-- Every other tenant_id foreign key already cascades. This migration makes
-- these match, and nothing else:
--   * <table>.tenant_id → tenants(id) ON DELETE CASCADE — the row belongs to
--     the workspace being deleted (it is unreadable without it: every RLS
--     policy on these tables is scoped to its tenant_id);
--   * users.current_tenant_id → tenants(id) ON DELETE SET NULL — the person
--     belongs to (and is kept by) another workspace; NULL is the existing
--     "no current workspace" value the RLS helpers already fall back from
--     (COALESCE(current_tenant_id, tenant_id)).
-- gallery_submissions.tenant_id (SET NULL) is left as it is.
--
-- Not changed (deliberately): users.tenant_id stays ON DELETE CASCADE as
-- before, and foreign keys between rows (created_by, user_id, version_id …)
-- keep NO ACTION: inside one workspace they are all removed by the same
-- statement, and a reference from another workspace's rows to a person
-- homed in the deleted workspace still stops the delete, as it should.
--
-- Safe to run more than once. Each key is found by its column (whatever it
-- is named), replaced NOT VALID, then validated (the existing rows already
-- satisfy it; VALIDATE only takes a SHARE UPDATE EXCLUSIVE lock). No data is
-- changed, and RLS policies are untouched (referential actions are not
-- subject to RLS). Rollback: re-add the keys without an ON DELETE clause.
-- ============================================================================

DO $do$
DECLARE
  spec record;
  fk record;
  cname text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('agent_queue',      'tenant_id',         'CASCADE'),
      ('agent_runs',       'tenant_id',         'CASCADE'),
      ('agents',           'tenant_id',         'CASCADE'),
      ('task_assignees',   'tenant_id',         'CASCADE'),
      ('task_escalations', 'tenant_id',         'CASCADE'),
      ('task_reminders',   'tenant_id',         'CASCADE'),
      ('task_responses',   'tenant_id',         'CASCADE'),
      ('workflow_logs',    'tenant_id',         'CASCADE'),
      ('workflow_versions','tenant_id',         'CASCADE'),
      ('users',            'current_tenant_id', 'SET NULL')
    ) AS s(tbl, col, action)
  LOOP
    -- A table / column missing on this database: nothing to do.
    IF to_regclass(format('public.%I', spec.tbl)) IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = to_regclass(format('public.%I', spec.tbl)) AND attname = spec.col AND NOT attisdropped
    ) THEN
      RAISE NOTICE 'tenant_delete_fk_actions: public.%.% not found, skipped', spec.tbl, spec.col;
      CONTINUE;
    END IF;

    cname := format('%s_%s_fkey', spec.tbl, spec.col);

    -- Drop every single-column key on this column that points at tenants(id) (any name).
    FOR fk IN
      SELECT c.conname
      FROM pg_constraint c
      WHERE c.contype = 'f'
        AND c.conrelid = to_regclass(format('public.%I', spec.tbl))
        AND c.confrelid = 'public.tenants'::regclass
        AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = spec.col)]::smallint[]
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', spec.tbl, fk.conname);
    END LOOP;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.tenants(id) ON DELETE %s NOT VALID',
      spec.tbl, cname, spec.col, spec.action
    );
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', spec.tbl, cname);
  END LOOP;
END
$do$;
