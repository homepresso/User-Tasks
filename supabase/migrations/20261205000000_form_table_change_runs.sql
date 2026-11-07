-- ============================================================================
-- 20261205000000_form_table_change_runs.sql
--
-- "For each changed row" rules of Data table form fields
-- (lib/forms/table-changes.ts, lib/services/form-table-changes.ts).
--
-- public.form_table_change_runs: one row per run of an "Apply table changes"
-- action — a form submission's rule (idempotency key = the submission /
-- task + button + action) or an in-form Button click (a key the browser
-- generates once per click and reuses on retries). The unique key makes a
-- double submit / double click one run: the second request gets the first
-- run's summary instead of writing again. `summary` holds the per-row
-- results (status, error, written row id, API status) — the run log; an
-- audit entry is written on the form as well.
--
-- RLS: members read their own runs; people with forms.edit read every run
-- of the workspace. No client writes (the service writes with the service
-- role after its own checks).
--
-- Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.form_table_change_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  idempotency_key  text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  form_id          uuid,
  task_id          uuid,
  submission_id    uuid,
  field_key        text NOT NULL,
  origin           text NOT NULL DEFAULT 'submit' CHECK (origin IN ('submit', 'button')),
  status           text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  actor_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  summary          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_form_table_change_runs_key ON public.form_table_change_runs (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_form_table_change_runs_form ON public.form_table_change_runs (tenant_id, form_id, created_at DESC);

COMMENT ON TABLE public.form_table_change_runs IS 'Runs of Data table "Apply table changes" rules (idempotency + per-row results). Written by lib/services/form-table-changes.ts with the service role.';

ALTER TABLE public.form_table_change_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS form_table_change_runs_select ON public.form_table_change_runs;
CREATE POLICY form_table_change_runs_select ON public.form_table_change_runs FOR SELECT USING (
  tenant_id = (SELECT public.get_current_tenant_id())
  AND (
    actor_id = (SELECT auth.uid())
    OR (SELECT public.user_has_tenant_permission(tenant_id::text, 'forms.edit'))
  )
);
REVOKE ALL ON TABLE public.form_table_change_runs FROM anon, authenticated;
GRANT SELECT ON TABLE public.form_table_change_runs TO authenticated;
GRANT ALL ON TABLE public.form_table_change_runs TO service_role;
