-- Field-change audit trail for data tables (opt-in per table).
--
-- custom_tables.audit_changes turns it on. Every UPDATE of a row of an audited
-- table then records one custom_table_row_changes row per field whose value
-- changed (old and new value as jsonb), with who and when:
--   changed_by = the signed-in person (auth.uid()), else updated_by when the
--   write changed it (service writes that name their actor), else NULL — an
--   automation (workflow / schedule) write.
-- Changes belong to their row: deleting the row (by hand, a workflow or the
-- row's retention policy) deletes its history (ON DELETE CASCADE), so
-- retention covers the audit trail too.
-- Readers see the changes of rows they can read (the rows' own RLS decides).
-- Only the trigger writes them (SECURITY DEFINER); nobody edits history.
-- The app code works before this is applied: the history reads return
-- nothing and the setting explains that the migration is pending.

ALTER TABLE public.custom_tables
  ADD COLUMN IF NOT EXISTS audit_changes boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.custom_table_row_changes (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.custom_tables(id) ON DELETE CASCADE,
  row_id uuid NOT NULL REFERENCES public.custom_table_rows(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS custom_table_row_changes_row_idx ON public.custom_table_row_changes (row_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS custom_table_row_changes_table_idx ON public.custom_table_row_changes (table_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS custom_table_row_changes_changed_by_idx ON public.custom_table_row_changes (changed_by) WHERE changed_by IS NOT NULL;

ALTER TABLE public.custom_table_row_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_table_row_changes_select ON public.custom_table_row_changes;
CREATE POLICY custom_table_row_changes_select ON public.custom_table_row_changes FOR SELECT TO authenticated
  USING (
    tenant_id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[])
    AND EXISTS (SELECT 1 FROM public.custom_table_rows r WHERE r.id = custom_table_row_changes.row_id)
  );

REVOKE ALL ON public.custom_table_row_changes FROM anon, authenticated;
GRANT SELECT ON public.custom_table_row_changes TO authenticated;
GRANT ALL ON public.custom_table_row_changes TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.custom_table_row_changes_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.fn_audit_custom_row_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  k text;
BEGIN
  IF NEW.data IS NOT DISTINCT FROM OLD.data THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.custom_tables t WHERE t.id = NEW.table_id AND t.audit_changes) THEN
    RETURN NEW;
  END IF;
  actor := COALESCE(auth.uid(), CASE WHEN NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN NEW.updated_by END);
  IF actor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = actor) THEN
    actor := NULL;
  END IF;
  FOR k IN
    SELECT key FROM jsonb_object_keys(COALESCE(OLD.data, '{}'::jsonb)) AS key
    UNION
    SELECT key FROM jsonb_object_keys(COALESCE(NEW.data, '{}'::jsonb)) AS key
  LOOP
    IF (OLD.data -> k) IS DISTINCT FROM (NEW.data -> k) THEN
      INSERT INTO public.custom_table_row_changes (tenant_id, table_id, row_id, field, old_value, new_value, changed_by)
      VALUES (NEW.tenant_id, NEW.table_id, NEW.id, left(k, 200), OLD.data -> k, NEW.data -> k, actor);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_audit_custom_row_changes() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_custom_rows_audit ON public.custom_table_rows;
CREATE TRIGGER trg_custom_rows_audit
  AFTER UPDATE OF data ON public.custom_table_rows
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_custom_row_changes();
