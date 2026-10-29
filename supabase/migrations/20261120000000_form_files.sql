-- ============================================================================
-- 20261120000000_form_files.sql
--
-- Form attachments: files uploaded into an Attachments field (task forms,
-- reusable form pages, start forms, designer test runs).
--
-- 1. public.form_files: one row per uploaded file — where it is stored
--    (`storage_key` in the private `form-files` bucket,
--    `<tenant>/<context>-<id>/<uuid>/<name>`), what it is (sanitised name,
--    size, verified MIME type, SHA-256), who uploaded it, the upload context
--    (form / task / workflow start form / test run + field key) and its state:
--      uploading a direct-to-storage upload was started (the browser PUTs to a
--                signed URL); expires_at = the upload window; the server
--                verifies the object before it becomes pending
--      pending   uploaded, not submitted yet; expires_at = upload + 24 h
--      bound     part of a stored submission (`submission_id`), a task's
--                values (`task_id`) and / or the run a start form started
--                (`run_id`, context `start`)
--      orphaned  to be deleted by the cleanup job
--    Deleting a task or a submission sets its reference NULL; bound files
--    with neither left are deleted, with their stored objects, by the app's
--    `form-files-cleanup` job (lib/services/form-files.ts purgeFormFiles),
--    which also removes expired pending uploads.
--
-- 2. RLS enabled with no client grants: every read and write goes through
--    the server (service role) after its own checks; downloads are
--    authorised per request by /attachments/<id>.
--
-- 3. Storage: private `form-files` bucket (Supabase Storage only; other
--    providers create it on first write). Never served by /files.
--
-- Additive and idempotent; works on plain PostgreSQL (no storage schema).
-- ============================================================================

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.form_files (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  storage_key      text NOT NULL CHECK (char_length(storage_key) BETWEEN 1 AND 1024),
  name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  size             bigint NOT NULL CHECK (size >= 0),
  mime_type        text NOT NULL CHECK (char_length(mime_type) BETWEEN 1 AND 255),
  checksum_sha256  text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  context_kind     text NOT NULL,
  form_id          uuid REFERENCES public.forms(id) ON DELETE SET NULL,
  task_id          uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  workflow_id      uuid REFERENCES public.workflows(id) ON DELETE SET NULL,
  field_key        text NOT NULL CHECK (char_length(field_key) BETWEEN 1 AND 64),
  status           text NOT NULL DEFAULT 'pending',
  submission_id    uuid REFERENCES public.form_submissions(id) ON DELETE SET NULL,
  -- A workflow start form's files: the run they started (set by the engine).
  run_id           uuid,
  scan_status      text NOT NULL DEFAULT 'skipped' CHECK (scan_status IN ('skipped', 'clean', 'infected', 'error')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  bound_at         timestamptz,
  expires_at       timestamptz
);

ALTER TABLE public.form_files ADD COLUMN IF NOT EXISTS run_id uuid;
DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_files_run_id_fkey') THEN
    ALTER TABLE public.form_files ADD CONSTRAINT form_files_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.workflow_runs(id) ON DELETE SET NULL;
  END IF;
END $fk$;
ALTER TABLE public.form_files DROP CONSTRAINT IF EXISTS form_files_context_kind_check;
ALTER TABLE public.form_files ADD CONSTRAINT form_files_context_kind_check CHECK (context_kind IN ('form', 'task', 'start', 'test'));
ALTER TABLE public.form_files DROP CONSTRAINT IF EXISTS form_files_status_check;
ALTER TABLE public.form_files ADD CONSTRAINT form_files_status_check CHECK (status IN ('uploading', 'pending', 'bound', 'orphaned'));

COMMENT ON TABLE public.form_files IS 'Files uploaded into form Attachments fields (private form-files bucket). Written and served by lib/services/form-files.ts with the service role.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_form_files_storage_key ON public.form_files (storage_key);
CREATE INDEX IF NOT EXISTS idx_form_files_tenant ON public.form_files (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_files_task ON public.form_files (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_form_files_submission ON public.form_files (submission_id) WHERE submission_id IS NOT NULL;
DROP INDEX IF EXISTS public.idx_form_files_pending;
CREATE INDEX IF NOT EXISTS idx_form_files_expiring ON public.form_files (expires_at) WHERE status IN ('uploading', 'pending');
DROP INDEX IF EXISTS public.idx_form_files_uploader;
CREATE INDEX IF NOT EXISTS idx_form_files_uploads ON public.form_files (tenant_id, uploaded_by, created_at) WHERE status IN ('uploading', 'pending');
DROP INDEX IF EXISTS public.idx_form_files_unbound;
CREATE INDEX IF NOT EXISTS idx_form_files_unbound_v2 ON public.form_files (created_at)
  WHERE status = 'orphaned' OR (status = 'bound' AND task_id IS NULL AND submission_id IS NULL AND run_id IS NULL);
CREATE INDEX IF NOT EXISTS idx_form_files_run ON public.form_files (run_id) WHERE run_id IS NOT NULL;
-- FK lookups when forms / workflows / users are deleted.
CREATE INDEX IF NOT EXISTS idx_form_files_form ON public.form_files (form_id) WHERE form_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_form_files_workflow ON public.form_files (workflow_id) WHERE workflow_id IS NOT NULL;

ALTER TABLE public.form_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.form_files FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.form_files TO service_role;

-- ── Storage ────────────────────────────────────────────────────────────────

DO $storage$
BEGIN
  IF to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found; skipping the form-files bucket';
    RETURN;
  END IF;
  -- Private, no client policies: only the service role reads or writes.
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('form-files', 'form-files', false)
  ON CONFLICT (id) DO UPDATE SET public = false;
END $storage$;

RESET lock_timeout;
