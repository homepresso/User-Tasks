-- ============================================================================
-- Nav count badges + per-person form drafts.
--
-- 1. public.nav_task_counts(p_tenant_id, p_user_id) → jsonb
--      { my_tasks, queue, tracker }: the side menu's badges in one read.
--      my_tasks and queue use exactly the rules of home_task_metrics
--      ('open' and 'queue'), so a badge always equals its Home card.
--      tracker: Task Tracker's default view ("Assigned by me") — top-level
--      tasks I assigned to someone else that are still open (not completed,
--      cancelled or draft).
--
-- 2. public.form_drafts (tenant_id, user_id, form_id, version, values,
--      params, created_at, updated_at): one saved draft per person per
--      reusable form (/f/<id> pages and forms a workflow starts from).
--      A person reads and writes only their own rows in their member
--      workspaces; INSERT / UPDATE also need the form to be one they can
--      open (can_open_form). tenant_id always follows the form (trigger).
--      Values hold file references, never bytes; the row is bounded
--      (256 KB of values + params).
--
-- SECURITY INVOKER reads; a signed-in caller can only ask for their own
-- counts (p_user_id must be auth.uid()). Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

/* ── 1. nav_task_counts ───────────────────────────────────────────────── */

CREATE OR REPLACE FUNCTION public.nav_task_counts(p_tenant_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  WITH guard AS (
    SELECT (p_tenant_id IS NOT NULL AND p_user_id IS NOT NULL AND (auth.uid() IS NULL OR auth.uid() = p_user_id)) AS ok
  ),
  teams AS (
    SELECT ut.team_id FROM public.user_teams ut JOIN public.teams tm ON tm.id = ut.team_id AND tm.tenant_id = p_tenant_id
     WHERE ut.user_id = p_user_id
  )
  SELECT jsonb_build_object(
    -- = home_task_metrics.open
    'my_tasks', (SELECT count(*) FROM public.tasks t, guard
        WHERE guard.ok AND t.tenant_id = p_tenant_id AND t.assignee_id = p_user_id
          AND t.deleted_at IS NULL AND t.parent_task_id IS NULL
          AND t.status NOT IN ('completed', 'cancelled', 'draft')
          AND t.acceptance_status <> 'pending'),
    -- = home_task_metrics.queue
    'queue', (SELECT count(*) FROM public.tasks t, guard
        WHERE guard.ok AND t.tenant_id = p_tenant_id AND t.deleted_at IS NULL AND t.parent_task_id IS NULL
          AND (
            (t.assignee_id = p_user_id AND t.acceptance_status = 'pending' AND t.status NOT IN ('completed', 'cancelled'))
            OR (t.assignee_id IS NULL AND t.assigned_team_id IN (SELECT team_id FROM teams) AND t.status IN ('todo', 'in_progress'))
          )),
    -- Task Tracker's default view (Assigned by me), open only.
    'tracker', (SELECT count(*) FROM public.tasks t, guard
        WHERE guard.ok AND t.tenant_id = p_tenant_id AND t.assigner_id = p_user_id
          AND t.assignee_id IS NOT NULL AND t.assignee_id <> p_user_id
          AND t.deleted_at IS NULL AND t.parent_task_id IS NULL
          AND t.status NOT IN ('completed', 'cancelled', 'draft'))
  )
$$;

COMMENT ON FUNCTION public.nav_task_counts(uuid, uuid) IS
  'Side menu badges: my_tasks (= home_task_metrics.open), queue (= home_task_metrics.queue), tracker (open tasks I assigned to others).';

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_assigner_open
  ON public.tasks (tenant_id, assigner_id)
  WHERE deleted_at IS NULL AND parent_task_id IS NULL AND status NOT IN ('completed', 'cancelled');

REVOKE ALL ON FUNCTION public.nav_task_counts(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nav_task_counts(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.nav_task_counts(uuid, uuid) TO authenticated, service_role;

/* ── 2. form_drafts ───────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.form_drafts (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  version integer,
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
  params jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, form_id),
  CONSTRAINT form_drafts_values_object CHECK (jsonb_typeof(values) = 'object'),
  CONSTRAINT form_drafts_params_object CHECK (params IS NULL OR jsonb_typeof(params) = 'object'),
  CONSTRAINT form_drafts_size CHECK (octet_length(values::text) + coalesce(octet_length(params::text), 0) <= 262144)
);

COMMENT ON TABLE public.form_drafts IS
  'A person''s saved, unsent answers to a reusable form (the form''s Save draft icon); one per person per form, deleted when they submit. File fields hold references, never bytes.';

CREATE INDEX IF NOT EXISTS idx_form_drafts_user ON public.form_drafts (tenant_id, user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_drafts_form ON public.form_drafts (form_id);

CREATE OR REPLACE FUNCTION public.form_drafts_set_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  SELECT f.tenant_id INTO NEW.tenant_id FROM public.forms f WHERE f.id = NEW.form_id;
  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Form not found' USING ERRCODE = '23503';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_form_drafts_tenant ON public.form_drafts;
CREATE TRIGGER trg_form_drafts_tenant
  BEFORE INSERT OR UPDATE ON public.form_drafts
  FOR EACH ROW EXECUTE FUNCTION public.form_drafts_set_tenant();

ALTER TABLE public.form_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS form_drafts_select ON public.form_drafts;
CREATE POLICY form_drafts_select ON public.form_drafts FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

DROP POLICY IF EXISTS form_drafts_insert ON public.form_drafts;
CREATE POLICY form_drafts_insert ON public.form_drafts FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])
    AND public.can_open_form(form_id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS form_drafts_update ON public.form_drafts;
CREATE POLICY form_drafts_update ON public.form_drafts FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])
    AND public.can_open_form(form_id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS form_drafts_delete ON public.form_drafts;
CREATE POLICY form_drafts_delete ON public.form_drafts FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

REVOKE ALL ON public.form_drafts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.form_drafts TO authenticated;
GRANT ALL ON public.form_drafts TO service_role;
