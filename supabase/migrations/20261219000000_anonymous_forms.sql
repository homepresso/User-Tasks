-- ============================================================================
-- 20261219000000_anonymous_forms.sql
--
-- Anonymous forms: a reusable form can be filled in by visitors who are not
-- signed in, through an unguessable public link (/p/<token>).
--
-- 1. public.form_anonymous_access (one row per form that ever had a public
--    link): the random link token, whether anonymous responses are on, and
--    the form's anonymous options (rate limits, uploads, indexing, minimum
--    fill time). Not versioned (a setting, like available_in_menu).
--    Service role only: RLS on, no policies, no grants to anon /
--    authenticated — the token is never readable through PostgREST, not
--    even by members of the workspace; lib/services/anonymous-forms.ts
--    reads and writes it (forms.edit to change, forms.view to see the link).
--    Regenerating the token replaces it (old links stop working at once);
--    deleting the form deletes the row.
--
-- 2. public.form_submissions:
--      - source allows 'anonymous' (submitted_by stays NULL);
--      - anonymous_meta jsonb: privacy-friendly abuse-review data of an
--        anonymous submission ({ ip_hash, user_agent }): the IP is an HMAC
--        (server secret) truncated to 16 hex chars, the user agent cut to
--        120 characters. NULL for every other source.
--      - a partial index for the per-form daily cap (anonymous rows by form
--        and time).
--
-- 3. public.form_files.upload_session: an anonymous visitor's uploads are
--    tied to a per-visit upload key (sha256 hex of a random key the browser
--    holds) instead of a user (uploaded_by stays NULL). Only that key can
--    complete, remove or submit them.
--
-- The workspace switch ("Allow anonymous forms") and the optional bot
-- protection keys live in tenants.settings.forms.anonymous (JSON, like the
-- form accessibility settings): tenants has no end-user UPDATE policy since
-- 20261031000000_tenant_settings_lockdown.sql, so only the server writes it
-- (settings.edit); the captcha secret is stored encrypted (lib/secret-crypto).
--
-- No new grants to anon: the public pages and endpoints run on the server
-- (service role, explicit tenant filters, an allowlist per operation).
--
-- Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.form_anonymous_access (
  form_id          uuid PRIMARY KEY REFERENCES public.forms(id) ON DELETE CASCADE,
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  token            text NOT NULL CHECK (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  enabled          boolean NOT NULL DEFAULT false,
  settings         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  created_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  token_rotated_at timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.form_anonymous_access IS
  'Anonymous forms: the public link token (/p/<token>), on/off and options of a form. Service role only (lib/services/anonymous-forms.ts); never exposed to clients.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_form_anonymous_access_token ON public.form_anonymous_access (token);
CREATE INDEX IF NOT EXISTS idx_form_anonymous_access_tenant ON public.form_anonymous_access (tenant_id);

ALTER TABLE public.form_anonymous_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.form_anonymous_access FROM anon, authenticated;
GRANT ALL ON public.form_anonymous_access TO service_role;

-- form_submissions: the 'anonymous' source and the abuse-review metadata.
ALTER TABLE public.form_submissions ADD COLUMN IF NOT EXISTS anonymous_meta jsonb;
COMMENT ON COLUMN public.form_submissions.anonymous_meta IS
  'Anonymous submissions only: { ip_hash (HMAC, 16 hex), user_agent (<= 120 chars) } for abuse review. NULL otherwise.';

DO $$
DECLARE
  v_name text;
BEGIN
  -- The inline CHECK of 20261116000000 (source IN standalone, task, api), whatever it was named.
  FOR v_name IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.form_submissions'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%source%'
  LOOP
    EXECUTE format('ALTER TABLE public.form_submissions DROP CONSTRAINT %I', v_name);
  END LOOP;
  ALTER TABLE public.form_submissions ADD CONSTRAINT form_submissions_source_check
    CHECK (source IN ('standalone', 'task', 'api', 'anonymous'));
END $$;

CREATE INDEX IF NOT EXISTS idx_form_submissions_anonymous
  ON public.form_submissions (form_id, created_at DESC) WHERE source = 'anonymous';

-- form_files: anonymous uploads belong to a per-visit upload key.
ALTER TABLE public.form_files ADD COLUMN IF NOT EXISTS upload_session text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_files_upload_session_check') THEN
    ALTER TABLE public.form_files ADD CONSTRAINT form_files_upload_session_check
      CHECK (upload_session IS NULL OR upload_session ~ '^[0-9a-f]{64}$');
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_form_files_upload_session ON public.form_files (upload_session) WHERE upload_session IS NOT NULL;
COMMENT ON COLUMN public.form_files.upload_session IS
  'Anonymous form uploads: sha256 (hex) of the visitor''s per-visit upload key; uploaded_by is NULL for these.';
