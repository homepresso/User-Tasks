-- ============================================================================
-- 20270113100000_directory_sources.sql
--
-- Directory sources contributed by extensions (lib/directory-sync/sources.ts):
-- an extension supplies people and groups (with memberships and external
-- login names) under a source id `ext.<extension id>.<key>`, and core
-- reconciles them through the directory-sync pipeline — the same
-- directory_links, directory_sync_runs, teams and user_teams as Entra ID,
-- Okta, LDAP, Google Workspace and SCIM.
--
-- 1. directory_links / directory_sync_runs accept extension source ids
--    (`ext.<id>.<key>`) next to the built-in providers.
-- 2. public.directory_sources — per-workspace state of one extension source:
--    cursor, last (full) sync, stats, last error. Service role only.
-- 3. public.directory_entries — every person a directory source lists, with
--    the keys they are matched on (lower-case e-mail addresses / UPNs), their
--    external login names (claims), the source groups they belong to, and
--    the local account once there is one. An entry without an account is a
--    PENDING directory entry: no account, no workspace membership and no
--    licence seat until the person first signs in (SSO / LDAP bind), when
--    core creates or links the account and grants the workspace and its
--    groups. Service role only.
-- 4. public.teams.source / source_label — a team kept by a directory source
--    is read-only in UserTasks (name, description and members come from the
--    source); source_label says where it comes from ("SharePoint · Sales").
--
-- Additive and idempotent. Until it is applied, extension sources cannot
-- sync (the run fails with a message naming this migration); nothing else
-- changes.
-- ============================================================================

SET lock_timeout = '5s';

/* ── 1. provider checks ─────────────────────────────────────────────── */

ALTER TABLE public.directory_links DROP CONSTRAINT IF EXISTS directory_links_provider_check;
ALTER TABLE public.directory_links ADD CONSTRAINT directory_links_provider_check
  CHECK (provider IN ('entra', 'okta', 'ldap', 'google', 'scim') OR provider ~ '^ext\.[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$');

ALTER TABLE public.directory_sync_runs DROP CONSTRAINT IF EXISTS directory_sync_runs_provider_check;
ALTER TABLE public.directory_sync_runs ADD CONSTRAINT directory_sync_runs_provider_check
  CHECK (provider IN ('entra', 'okta', 'ldap', 'google') OR provider ~ '^ext\.[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$');

/* ── 2. directory_sources ───────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.directory_sources (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  source             text NOT NULL CHECK (source ~ '^ext\.[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$'),
  cursor             text,
  last_sync_at       timestamptz,
  last_full_sync_at  timestamptz,
  last_sync_stats    jsonb,
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source)
);

COMMENT ON TABLE public.directory_sources IS
  'Per-workspace sync state of directory sources contributed by extensions (ext.<id>.<key>). Service role only.';

/* ── 3. directory_entries ───────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.directory_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  source         text NOT NULL CHECK (source ~ '^ext\.[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$'),
  external_id    text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 500),
  display_name   text,
  email          text,
  -- Lower-case e-mail addresses / UPNs the person is matched on (sign-in and linking).
  match_keys     text[] NOT NULL DEFAULT '{}',
  -- External login names, e.g. SharePoint claims (i:0#.w|contoso\jdoe, i:0e.t|trusted|jdoe@contoso.com).
  claims         text[] NOT NULL DEFAULT '{}',
  -- External ids of the source groups the person belongs to (directly or through nested groups).
  group_ids      text[] NOT NULL DEFAULT '{}',
  attributes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  active         boolean NOT NULL DEFAULT true,
  local_user_id  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  -- Set when the person's first sign-in turned the pending entry into an account / membership.
  claimed_at     timestamptz,
  -- The workspace membership was granted by this source (at that sign-in), not held before.
  granted_access boolean NOT NULL DEFAULT false,
  last_seen_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS directory_entries_keys_idx ON public.directory_entries USING gin (match_keys);
CREATE INDEX IF NOT EXISTS directory_entries_user_idx ON public.directory_entries (local_user_id) WHERE local_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS directory_entries_list_idx ON public.directory_entries (tenant_id, source, lower(display_name));

COMMENT ON TABLE public.directory_entries IS
  'People listed by extension directory sources; entries without local_user_id are pending until first sign-in. Service role only.';

DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['directory_sources', 'directory_entries'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END;
$do$;

/* ── 4. teams kept by a directory source ────────────────────────────── */

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS source_label text;
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_source_check;
ALTER TABLE public.teams ADD CONSTRAINT teams_source_check
  CHECK (source IS NULL OR source ~ '^ext\.[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$');
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_source_label_check;
ALTER TABLE public.teams ADD CONSTRAINT teams_source_label_check
  CHECK (source_label IS NULL OR char_length(source_label) <= 200);

COMMENT ON COLUMN public.teams.source IS
  'Directory source that keeps this team (ext.<id>.<key>); null for teams managed in UserTasks. Source teams are read-only in UserTasks.';
COMMENT ON COLUMN public.teams.source_label IS 'Where a source team comes from, e.g. "SharePoint · Sales".';
