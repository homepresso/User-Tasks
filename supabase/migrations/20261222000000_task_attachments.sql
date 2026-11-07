-- ============================================================================
-- 20261222000000_task_attachments.sql
--
-- Task attachments: files people (or workflow steps) attach to any task, with
-- a name, a type (free text with suggestions, e.g. Contract / Invoice /
-- Receipt / Evidence / Image / Other) and a description. Shown on the task's
-- Attachments tab, exposed to workflows as `attachments` (User Task outputs)
-- and `{{task.attachments}}`.
--
-- 1. public.task_attachments: one row per file. The bytes live in the private
--    `form-files` bucket at `<tenant>/attachment-<task>/<id>/<ascii name>`
--    (the CHECK ties the key to the row, so no row can point at another
--    file). `status` uploading = a direct-to-storage upload was started (the
--    server verifies the object before it becomes ready; expires_at = the
--    upload window); ready = verified and listed. Soft delete: deleted_at /
--    deleted_by; the cleanup job removes the row and the object later.
--    tenant_id and form_id always follow the task (trigger): form_id is the
--    reusable form the task was created from (metadata.form_ref.form_id) —
--    its retention policy and legal hold govern the attachments.
--
-- 2. RLS (direct PostgREST access; the app itself reads and writes with the
--    service role after the same checks in lib/services/task-attachments.ts):
--      SELECT  members of the task's workspace who can see the task
--              (assignee, collaborator, team member, a manager of an
--              assignee, the assigner, tasks.view_all / tasks.manage_queue)
--              — ready rows, not deleted; uploaders also see their own rows
--              (a deleted row only by whoever deleted it).
--      INSERT  people who can work on the open task (tasks.complete and the
--              task-action rule: assignee, collaborator, team member, a
--              manager of an assignee, tasks.complete_any, tasks.manage_queue
--              on a non-workflow task), as themselves, status uploading only
--              (only the server marks a verified file ready).
--      UPDATE  soft delete only (deleted_at, deleted_by): the uploader while
--              they can see the task, or tasks.delete in the workspace.
--      DELETE  not granted (the cleanup job hard-deletes).
--    A file whose form is on legal hold cannot be soft-deleted (trigger).
--
-- 3. public.task_attachment_purges: stored objects of hard-deleted rows (task
--    deleted → cascade, retention purge) waiting for the cleanup job to
--    delete them from storage. No client grants.
--
-- 4. lifecycle_event_type gains attachment_added / attachment_deleted (the
--    task timeline; the event stream emits task.attachment_added /
--    task.attachment_deleted).
--
-- Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

ALTER TYPE public.lifecycle_event_type ADD VALUE IF NOT EXISTS 'attachment_added';
ALTER TYPE public.lifecycle_event_type ADD VALUE IF NOT EXISTS 'attachment_deleted';

CREATE TABLE IF NOT EXISTS public.task_attachments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  task_id          uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  form_id          uuid REFERENCES public.forms(id) ON DELETE SET NULL,
  name             text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  type             text NOT NULL DEFAULT 'Other' CHECK (char_length(btrim(type)) BETWEEN 1 AND 60),
  description      text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  storage_key      text NOT NULL CHECK (char_length(storage_key) BETWEEN 1 AND 1024),
  file_name        text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  mime_type        text NOT NULL DEFAULT 'application/octet-stream' CHECK (char_length(mime_type) BETWEEN 1 AND 255),
  size             bigint NOT NULL CHECK (size >= 0),
  checksum_sha256  text NOT NULL DEFAULT repeat('0', 64) CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  status           text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready')),
  scan_status      text NOT NULL DEFAULT 'skipped' CHECK (scan_status IN ('skipped', 'clean', 'infected', 'error')),
  uploaded_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- A workflow step attached it: the run (no uploader).
  run_id           uuid REFERENCES public.workflow_runs(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz DEFAULT (now() + interval '15 minutes'),
  deleted_at       timestamptz,
  deleted_by       uuid REFERENCES public.users(id) ON DELETE SET NULL
);

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_attachments_storage_key_owner') THEN
    -- The object belongs to this row: <tenant>/attachment-<task>/<id>/<name>.
    ALTER TABLE public.task_attachments ADD CONSTRAINT task_attachments_storage_key_owner
      CHECK (storage_key LIKE tenant_id::text || '/attachment-' || task_id::text || '/' || id::text || '/%');
  END IF;
END $chk$;

COMMENT ON TABLE public.task_attachments IS 'Files attached to tasks (Attachments tab; private form-files bucket). Written and served by lib/services/task-attachments.ts with the service role; RLS mirrors its rules for direct access.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_attachments_storage_key ON public.task_attachments (storage_key);
CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON public.task_attachments (task_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_attachments_tenant ON public.task_attachments (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_attachments_form ON public.task_attachments (form_id, created_at) WHERE form_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_attachments_uploading ON public.task_attachments (expires_at) WHERE status = 'uploading';
CREATE INDEX IF NOT EXISTS idx_task_attachments_deleted ON public.task_attachments (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_attachments_uploader ON public.task_attachments (uploaded_by) WHERE uploaded_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_attachments_run ON public.task_attachments (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_attachments_deleted_by ON public.task_attachments (deleted_by) WHERE deleted_by IS NOT NULL;

-- Objects to delete from storage (no tenant FK: the tenant may be going too).
CREATE TABLE IF NOT EXISTS public.task_attachment_purges (
  storage_key text PRIMARY KEY,
  queued_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.task_attachment_purges IS 'Stored objects of deleted task_attachments rows, removed from the form-files bucket by the form-files-cleanup job.';
ALTER TABLE public.task_attachment_purges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.task_attachment_purges FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.task_attachment_purges TO service_role;

-- ── Access helper ───────────────────────────────────────────────────────────

-- The signed-in caller's access to a task's attachments: 'work' (may add),
-- 'view' (may read) or 'none'. Mirrors lib/task-authz.ts (loadTaskActorFacts,
-- canUserSeeTask) and lib/services/task-attachments.ts.
CREATE OR REPLACE FUNCTION public.task_attachment_access(p_task_id uuid)
  RETURNS text
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  v_uid uuid := auth.uid();
  t record;
  v_perms text[];
  v_assignee boolean;
  v_team boolean := false;
  v_manager boolean := false;
BEGIN
  IF v_uid IS NULL OR p_task_id IS NULL THEN RETURN 'none'; END IF;
  SELECT id, tenant_id, assignee_id, assigner_id, assigned_team_id, status, is_workflow_task
    INTO t FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN 'none'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_memberships m WHERE m.user_id = v_uid AND m.tenant_id = t.tenant_id AND m.is_active) THEN
    RETURN 'none';
  END IF;
  v_perms := public.get_user_permissions(t.tenant_id);
  v_assignee := t.assignee_id = v_uid
    OR EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = t.id AND a.tenant_id = t.tenant_id AND a.user_id = v_uid);
  IF NOT v_assignee AND t.assigned_team_id IS NOT NULL AND t.assignee_id IS NULL THEN
    v_team := EXISTS (SELECT 1 FROM public.user_teams ut WHERE ut.team_id = t.assigned_team_id AND ut.user_id = v_uid);
  END IF;
  IF NOT v_assignee AND NOT v_team THEN
    WITH RECURSIVE chain(user_id, depth) AS (
      SELECT x.user_id, 0 FROM (
        SELECT t.assignee_id AS user_id WHERE t.assignee_id IS NOT NULL
        UNION SELECT a.user_id FROM public.task_assignees a WHERE a.task_id = t.id AND a.tenant_id = t.tenant_id
      ) x
      UNION
      SELECT m.manager_user_id, c.depth + 1
        FROM chain c
        JOIN public.user_memberships m ON m.user_id = c.user_id AND m.tenant_id = t.tenant_id AND m.is_active
       WHERE c.depth < 10 AND m.manager_user_id IS NOT NULL
    )
    SELECT EXISTS (SELECT 1 FROM chain WHERE user_id = v_uid AND depth > 0) INTO v_manager;
  END IF;

  IF t.status NOT IN ('completed', 'cancelled') AND 'tasks.complete' = ANY (v_perms) AND (
       v_assignee OR v_team OR v_manager OR 'tasks.complete_any' = ANY (v_perms)
       OR (NOT COALESCE(t.is_workflow_task, false) AND 'tasks.manage_queue' = ANY (v_perms))
     ) THEN
    RETURN 'work';
  END IF;
  IF v_assignee OR v_team OR v_manager OR t.assigner_id = v_uid
     OR 'tasks.view_all' = ANY (v_perms) OR 'tasks.manage_queue' = ANY (v_perms) THEN
    RETURN 'view';
  END IF;
  RETURN 'none';
END;
$$;

REVOKE ALL ON FUNCTION public.task_attachment_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_attachment_access(uuid) TO authenticated, service_role;

-- ── Triggers ────────────────────────────────────────────────────────────────

-- tenant_id and form_id follow the task.
CREATE OR REPLACE FUNCTION public.tg_task_attachments_follow_task()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  v_tenant uuid;
  v_form text;
BEGIN
  SELECT t.tenant_id, t.metadata #>> '{form_ref,form_id}' INTO v_tenant, v_form FROM public.tasks t WHERE t.id = NEW.task_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'task % not found', NEW.task_id USING ERRCODE = '23503'; END IF;
  NEW.tenant_id := v_tenant;
  IF TG_OP = 'INSERT' THEN
    NEW.form_id := CASE
      WHEN v_form ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND EXISTS (SELECT 1 FROM public.forms f WHERE f.id = v_form::uuid AND f.tenant_id = v_tenant) THEN v_form::uuid
      ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_attachments_follow_task ON public.task_attachments;
CREATE TRIGGER trg_task_attachments_follow_task
  BEFORE INSERT OR UPDATE OF tenant_id, task_id ON public.task_attachments
  FOR EACH ROW EXECUTE FUNCTION public.tg_task_attachments_follow_task();

-- Legal hold: a held file can't be soft-deleted (the service checks first;
-- this keeps any other writer honest).
CREATE OR REPLACE FUNCTION public.tg_task_attachments_hold()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND NEW.form_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.forms f WHERE f.id = NEW.form_id AND f.legal_hold) THEN
    RAISE EXCEPTION 'This attachment is on legal hold' USING ERRCODE = '55006';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_attachments_hold ON public.task_attachments;
CREATE TRIGGER trg_task_attachments_hold
  BEFORE UPDATE OF deleted_at ON public.task_attachments
  FOR EACH ROW EXECUTE FUNCTION public.tg_task_attachments_hold();

-- Hard-deleted rows (cascade from the task, purges): queue the stored object.
CREATE OR REPLACE FUNCTION public.tg_task_attachments_queue_purge()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  INSERT INTO public.task_attachment_purges (storage_key) VALUES (OLD.storage_key) ON CONFLICT (storage_key) DO NOTHING;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_attachments_queue_purge ON public.task_attachments;
CREATE TRIGGER trg_task_attachments_queue_purge
  AFTER DELETE ON public.task_attachments
  FOR EACH ROW EXECUTE FUNCTION public.tg_task_attachments_queue_purge();

REVOKE ALL ON FUNCTION public.tg_task_attachments_follow_task() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_task_attachments_hold() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_task_attachments_queue_purge() FROM PUBLIC, anon, authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.task_attachments FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.task_attachments TO service_role;
GRANT SELECT ON TABLE public.task_attachments TO authenticated;
GRANT INSERT (id, task_id, name, type, description, storage_key, file_name, mime_type, size, uploaded_by) ON TABLE public.task_attachments TO authenticated;
GRANT UPDATE (deleted_at, deleted_by) ON TABLE public.task_attachments TO authenticated;

DROP POLICY IF EXISTS task_attachments_select ON public.task_attachments;
CREATE POLICY task_attachments_select ON public.task_attachments FOR SELECT TO authenticated
  USING (
    tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])
    -- Deleted rows: only whoever deleted them (Postgres checks the SELECT
    -- policy on the new row of the soft-delete UPDATE too).
    AND (deleted_at IS NULL OR deleted_by = (SELECT auth.uid()))
    AND (
      uploaded_by = (SELECT auth.uid())
      OR (status = 'ready' AND public.task_attachment_access(task_id) IN ('view', 'work'))
    )
  );

DROP POLICY IF EXISTS task_attachments_insert ON public.task_attachments;
CREATE POLICY task_attachments_insert ON public.task_attachments FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])
    AND uploaded_by = (SELECT auth.uid())
    AND status = 'uploading'
    AND deleted_at IS NULL
    AND public.task_attachment_access(task_id) = 'work'
  );

DROP POLICY IF EXISTS task_attachments_soft_delete ON public.task_attachments;
CREATE POLICY task_attachments_soft_delete ON public.task_attachments FOR UPDATE TO authenticated
  USING (
    tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])
    AND deleted_at IS NULL
    AND (
      (uploaded_by = (SELECT auth.uid()) AND public.task_attachment_access(task_id) IN ('view', 'work'))
      OR 'tasks.delete' = ANY (public.get_user_permissions(tenant_id))
    )
  )
  WITH CHECK (
    tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])
    AND (deleted_by IS NULL OR deleted_by = (SELECT auth.uid()))
  );

-- ── Storage ────────────────────────────────────────────────────────────────

DO $storage$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found; skipping the form-files bucket';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('form-files', 'form-files', false)
  ON CONFLICT (id) DO UPDATE SET public = false;
END $storage$;

RESET lock_timeout;
