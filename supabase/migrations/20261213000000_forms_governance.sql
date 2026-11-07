-- ============================================================================
-- 20261213000000_forms_governance.sql
--
-- Forms in the governance framework: retention policies and legal hold.
--
-- 1. public.forms
--    - retention_policy_id / retention_applied_at: the retention policy
--      assigned to the form (Settings → Governance, the form's Details,
--      POST /retention-policies/assign with target_type 'form'). A form's
--      policy governs its submissions: purge modes delete submissions (and
--      their stored attachments) as they come due, review modes open a
--      review of the form. The form itself is never purged by retention.
--      While a policy is assigned it replaces the form's own "Keep
--      submissions" setting (submission_retention_days).
--    - legal_hold, legal_hold_reason, legal_hold_at, legal_hold_by: a form
--      on legal hold keeps every submission and file — retention purges and
--      the submission_retention_days cleanup skip it — and cannot be
--      deleted until the hold is released.
--
-- 2. retention_policies.applies_to allows 'forms'; retention_review_events
--    and retention_execution_events allow target_type 'form'. The allowed
--    values are read from each live constraint and added to, so values
--    other migrations allowed are kept.
--
-- No new tables or policies: the columns follow the forms table's existing
-- RLS (members read their workspace's forms; writes go through the service
-- role).
--
-- Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS retention_policy_id uuid;
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS retention_applied_at timestamptz;
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false;
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS legal_hold_reason text;
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS legal_hold_at timestamptz;
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS legal_hold_by uuid;

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forms_retention_policy_id_fkey') THEN
    ALTER TABLE public.forms ADD CONSTRAINT forms_retention_policy_id_fkey
      FOREIGN KEY (retention_policy_id) REFERENCES public.retention_policies(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forms_legal_hold_by_fkey') THEN
    ALTER TABLE public.forms ADD CONSTRAINT forms_legal_hold_by_fkey
      FOREIGN KEY (legal_hold_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forms_legal_hold_reason_check') THEN
    ALTER TABLE public.forms ADD CONSTRAINT forms_legal_hold_reason_check
      CHECK (legal_hold_reason IS NULL OR char_length(legal_hold_reason) <= 500);
  END IF;
END $fk$;

COMMENT ON COLUMN public.forms.retention_policy_id IS
  'Retention policy governing the form''s submissions (purge modes delete due submissions and their files; review modes open a review). Replaces submission_retention_days while set.';
COMMENT ON COLUMN public.forms.legal_hold IS
  'Legal hold: no submission or file of the form is purged (retention or submission_retention_days) and the form cannot be deleted.';

CREATE INDEX IF NOT EXISTS idx_forms_retention_policy
  ON public.forms (tenant_id, retention_policy_id) WHERE retention_policy_id IS NOT NULL;

-- Add one value to a CHECK constraint whose allowed values are quoted
-- literals (`x IN (...)` / `= ANY (ARRAY[...])` / `<@ ARRAY[...]`), keeping
-- the values already allowed. `p_template` is the CHECK body with %s for the
-- quoted, comma-separated list.
CREATE OR REPLACE FUNCTION pg_temp.add_check_value(p_table regclass, p_name text, p_value text, p_template text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_def text;
  v_values text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conrelid = p_table AND conname = p_name;
  -- No constraint (every value allowed) or the value is already allowed: nothing to do.
  IF v_def IS NULL OR v_def LIKE '%''' || p_value || '''%' THEN
    RETURN;
  END IF;
  SELECT coalesce(array_agg(DISTINCT m[1]), '{}') INTO v_values
    FROM regexp_matches(v_def, '''([a-z_]+)''', 'g') AS m;
  v_values := array_append(v_values, p_value);
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', p_table, p_name);
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (' || p_template || ')', p_table, p_name,
    (SELECT string_agg(quote_literal(v), ', ' ORDER BY v) FROM unnest(v_values) AS v));
END;
$$;

DO $checks$
BEGIN
  PERFORM pg_temp.add_check_value('public.retention_policies'::regclass, 'retention_policies_applies_to_check', 'forms', 'applies_to <@ ARRAY[%s]::text[]');
  PERFORM pg_temp.add_check_value('public.retention_review_events'::regclass, 'retention_review_events_target_type_check', 'form', 'target_type IN (%s)');
  PERFORM pg_temp.add_check_value('public.retention_execution_events'::regclass, 'retention_execution_events_target_type_check', 'form', 'target_type IN (%s)');
END $checks$;

RESET lock_timeout;

-- PostgREST: the new foreign key (forms → retention_policies embeds).
NOTIFY pgrst, 'reload schema';
