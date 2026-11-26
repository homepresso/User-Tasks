-- Instance admin overview: stored file bytes summed in the database
-- (QA perf pass 2026-11-24). The overview selected every form_files /
-- task_attachments size (.limit(50000)) and summed them in JS; PostgREST
-- max_rows (1,000) cut both lists, so storage_bytes stopped at ~1,000 files.
-- Service role only, like the other instance_admin_* functions. Additive.

CREATE OR REPLACE FUNCTION public.instance_admin_storage_bytes()
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT sum(size) FROM public.form_files), 0)::bigint
       + COALESCE((SELECT sum(size) FROM public.task_attachments WHERE deleted_at IS NULL), 0)::bigint
$$;

REVOKE ALL ON FUNCTION public.instance_admin_storage_bytes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.instance_admin_storage_bytes() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instance_admin_storage_bytes() TO service_role;

NOTIFY pgrst, 'reload schema';
