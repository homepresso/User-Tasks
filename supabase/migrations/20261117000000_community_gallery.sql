-- ============================================================================
-- 20261117000000_community_gallery.sql
--
-- Community gallery: solutions shared by UserTasks users, moderated before
-- anything is public (lib/services/gallery-community.ts).
--
-- 1. public.gallery_submissions: the moderation queue. One row per uploaded
--    .utpkg version with its listing (title, summary, description, category,
--    tags, licence, author display name / link), the stored file and
--    screenshots (storage paths in the private `gallery-community` bucket),
--    the automatic validation report and the headless verification result.
--    status: pending → approved | rejected (with a reason) | withdrawn.
--
-- 2. public.community_packages: what the gallery lists (one row per package
--    id; the owner is the user whose first version was approved — only they
--    can publish later versions), with a download count and listed /
--    unlisted (a moderator can unlist after an abuse report).
--
-- 3. public.community_package_versions: the version history of each
--    listed package (file, checksum, signature, notes, downloads).
--
-- 4. public.gallery_abuse_reports: "Report abuse" from a package page.
--
-- RLS: everyone (anon included) reads LISTED community packages and their
-- versions; a signed-in user reads their own submissions; nobody else
-- reads anything. No client writes at all — the service writes with the
-- service role after the instance-admin / rate-limit checks.
--
-- 5. public.gallery_record_download(): atomic download counter (service role).
-- 6. Storage: private bucket `gallery-community` (service role only).
--
-- Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.community_packages (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_uid            uuid NOT NULL UNIQUE,
  slug                   text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 60),
  owner_id               uuid REFERENCES public.users(id) ON DELETE SET NULL,
  title                  text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  summary                text NOT NULL CHECK (char_length(summary) <= 200),
  description            text NOT NULL CHECK (char_length(description) <= 6000),
  category               text NOT NULL,
  tags                   text[] NOT NULL DEFAULT '{}',
  licence                text NOT NULL DEFAULT 'Apache-2.0',
  author_name            text NOT NULL CHECK (char_length(author_name) BETWEEN 2 AND 60),
  author_url             text CHECK (author_url IS NULL OR author_url ~ '^https?://'),
  trigger                text NOT NULL DEFAULT 'api' CHECK (trigger IN ('form', 'api', 'schedule', 'event')),
  native                 boolean NOT NULL DEFAULT false,
  current_version        text NOT NULL,
  current_submission_id  uuid,
  screenshots            jsonb NOT NULL DEFAULT '[]'::jsonb,
  downloads              bigint NOT NULL DEFAULT 0,
  status                 text NOT NULL DEFAULT 'listed' CHECK (status IN ('listed', 'unlisted')),
  unlisted_reason        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gallery_submissions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submitter_id           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  submitter_email        text,
  tenant_id              uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  package_uid            uuid NOT NULL,
  slug                   text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 60),
  version                text NOT NULL CHECK (char_length(version) <= 40),
  title                  text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  summary                text NOT NULL CHECK (char_length(summary) <= 200),
  description            text NOT NULL CHECK (char_length(description) <= 6000),
  category               text NOT NULL,
  tags                   text[] NOT NULL DEFAULT '{}',
  licence                text NOT NULL DEFAULT 'Apache-2.0',
  author_name            text NOT NULL CHECK (char_length(author_name) BETWEEN 2 AND 60),
  author_url             text CHECK (author_url IS NULL OR author_url ~ '^https?://'),
  notes                  text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  sample_input           jsonb,
  expect                 text CHECK (expect IS NULL OR expect IN ('waiting', 'completed')),
  file_path              text NOT NULL,
  file_name              text NOT NULL,
  size_bytes             integer NOT NULL CHECK (size_bytes > 0),
  sha256                 text NOT NULL,
  checksum               text NOT NULL,
  signed                 boolean NOT NULL DEFAULT false,
  fingerprint            text,
  screenshots            jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation             jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification           jsonb NOT NULL DEFAULT '{"status": "not_run"}'::jsonb,
  status                 text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  decision_reason        text CHECK (decision_reason IS NULL OR char_length(decision_reason) <= 2000),
  reviewed_by            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at            timestamptz,
  community_package_id   uuid REFERENCES public.community_packages(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gallery_submissions_status ON public.gallery_submissions (status, created_at);
CREATE INDEX IF NOT EXISTS idx_gallery_submissions_submitter ON public.gallery_submissions (submitter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gallery_submissions_package ON public.gallery_submissions (package_uid, created_at DESC);
-- One pending submission per package version at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gallery_submissions_pending ON public.gallery_submissions (package_uid, version) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.community_package_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id     uuid NOT NULL REFERENCES public.community_packages(id) ON DELETE CASCADE,
  submission_id  uuid REFERENCES public.gallery_submissions(id) ON DELETE SET NULL,
  version        text NOT NULL,
  file_path      text NOT NULL,
  file_name      text NOT NULL,
  size_bytes     integer NOT NULL,
  sha256         text NOT NULL,
  checksum       text NOT NULL,
  signed         boolean NOT NULL DEFAULT false,
  fingerprint    text,
  notes          text,
  requirement_count integer NOT NULL DEFAULT 0,
  asset_count    integer NOT NULL DEFAULT 0,
  downloads      bigint NOT NULL DEFAULT 0,
  released_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, version)
);

CREATE TABLE IF NOT EXISTS public.gallery_abuse_reports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id     uuid NOT NULL REFERENCES public.community_packages(id) ON DELETE CASCADE,
  version        text,
  reporter_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reporter_hash  text,
  reason         text NOT NULL CHECK (reason IN ('malicious', 'credentials', 'copyright', 'spam', 'broken', 'other')),
  details        text CHECK (details IS NULL OR char_length(details) <= 2000),
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gallery_abuse_reports_open ON public.gallery_abuse_reports (status, created_at);

COMMENT ON TABLE public.gallery_submissions IS 'Community gallery moderation queue. Written by lib/services/gallery-community.ts with the service role.';
COMMENT ON TABLE public.community_packages IS 'Approved community gallery packages (listed publicly when status = listed).';
COMMENT ON TABLE public.community_package_versions IS 'Version history of community gallery packages.';
COMMENT ON TABLE public.gallery_abuse_reports IS 'Abuse reports on community gallery packages (moderators only).';

-- ── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.community_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_package_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery_abuse_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS community_packages_select ON public.community_packages;
CREATE POLICY community_packages_select ON public.community_packages FOR SELECT USING (status = 'listed');

DROP POLICY IF EXISTS community_package_versions_select ON public.community_package_versions;
CREATE POLICY community_package_versions_select ON public.community_package_versions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.community_packages p WHERE p.id = package_id AND p.status = 'listed')
);

DROP POLICY IF EXISTS gallery_submissions_select_own ON public.gallery_submissions;
CREATE POLICY gallery_submissions_select_own ON public.gallery_submissions FOR SELECT TO authenticated USING (
  submitter_id = (SELECT auth.uid())
);

REVOKE ALL ON TABLE public.community_packages, public.community_package_versions, public.gallery_submissions, public.gallery_abuse_reports FROM anon, authenticated;
GRANT SELECT ON TABLE public.community_packages, public.community_package_versions TO anon, authenticated;
GRANT SELECT ON TABLE public.gallery_submissions TO authenticated;
GRANT ALL ON TABLE public.community_packages, public.community_package_versions, public.gallery_submissions, public.gallery_abuse_reports TO service_role;

-- ── Download counter ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.gallery_record_download(p_package_id uuid, p_version text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total bigint;
BEGIN
  UPDATE public.community_packages SET downloads = downloads + 1 WHERE id = p_package_id RETURNING downloads INTO v_total;
  UPDATE public.community_package_versions SET downloads = downloads + 1 WHERE package_id = p_package_id AND version = p_version;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.gallery_record_download(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gallery_record_download(uuid, text) TO service_role;

-- ── Storage ────────────────────────────────────────────────────────────────

DO $storage$
BEGIN
  IF to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found; skipping the gallery-community bucket';
    RETURN;
  END IF;
  -- Private, no client policies: only the service role reads or writes.
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('gallery-community', 'gallery-community', false)
  ON CONFLICT (id) DO UPDATE SET public = false;
END $storage$;

RESET lock_timeout;
