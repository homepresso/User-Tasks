-- ============================================================================
-- 20270116000000_team_origin.sql
--
-- Where a team comes from, for the source badge on every team (assignee
-- pickers, Teams page, /api/v1/teams, MCP, CLI): lib/teams/origin.ts.
--
-- 1. public.teams.origin — 'internal' (created in UserTasks, the default) or
--    the directory that keeps the team: 'active_directory' (LDAP sync with
--    the Active Directory flavour), 'ldap', 'entra', 'okta', 'google',
--    'scim', 'sharepoint' (a SharePoint group from the SharePoint
--    extension's directory source) or 'extension' (another extension
--    directory source).
--    public.teams.external_id — the group's id in that directory (the same
--    value as directory_links.external_id), null for internal teams.
--
-- 2. Backfill from what is recorded today: teams kept by an extension
--    directory source (teams.source = ext.<id>.<key>) and teams the built-in
--    directory sync created (directory_links rows with object_type 'group').
--    Everything else stays 'internal'.
--
-- teams.source / source_label (20270113100000) keep their meaning: a team
-- with a source is read-only in UserTasks. origin is descriptive only — an
-- Entra ID team stays editable as before. RLS is unchanged (the columns are
-- read under the existing teams policies).
--
-- Additive and idempotent: ADD COLUMN with a constant default (no table
-- rewrite), backfill UPDATEs only touch rows still 'internal'.
-- ============================================================================

SET lock_timeout = '5s';

/* ── 1. columns ─────────────────────────────────────────────────────── */

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'internal';
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS external_id text;

ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_origin_check;
ALTER TABLE public.teams ADD CONSTRAINT teams_origin_check
  CHECK (origin ~ '^[a-z][a-z0-9_]{0,39}$');
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_external_id_check;
ALTER TABLE public.teams ADD CONSTRAINT teams_external_id_check
  CHECK (external_id IS NULL OR char_length(external_id) BETWEEN 1 AND 500);

COMMENT ON COLUMN public.teams.origin IS
  'Where the team comes from: internal (created in UserTasks) or the directory that keeps it (active_directory, ldap, entra, okta, google, scim, sharepoint, extension). Descriptive; read-only-ness is teams.source.';
COMMENT ON COLUMN public.teams.external_id IS
  'The group''s id in the directory that keeps the team (directory_links.external_id); null for internal teams.';

-- Picker filter chips and ?origin= read (tenant, origin).
CREATE INDEX IF NOT EXISTS teams_tenant_origin_idx ON public.teams (tenant_id, origin);

/* ── 2. backfill ────────────────────────────────────────────────────── */

-- 2a. Teams kept by an extension directory source.
UPDATE public.teams t
   SET origin = CASE
         WHEN t.source ~* 'sharepoint' OR coalesce(t.source_label, '') ~* 'share ?point' THEN 'sharepoint'
         WHEN coalesce(t.source_label, '') ~* 'active directory' THEN 'active_directory'
         ELSE 'extension'
       END,
       external_id = coalesce(t.external_id, (
         SELECT l.external_id FROM public.directory_links l
          WHERE l.tenant_id = t.tenant_id AND l.provider = t.source AND l.object_type = 'group' AND l.local_id = t.id
          ORDER BY l.created_at NULLS LAST LIMIT 1))
 WHERE t.source IS NOT NULL
   AND t.origin = 'internal';

-- 2b. Teams the built-in directory sync (Entra ID, Okta, LDAP / AD, Google, SCIM) created.
UPDATE public.teams t
   SET origin = CASE l.provider
         WHEN 'entra'  THEN 'entra'
         WHEN 'okta'   THEN 'okta'
         WHEN 'google' THEN 'google'
         WHEN 'scim'   THEN 'scim'
         WHEN 'ldap'   THEN CASE WHEN EXISTS (
                SELECT 1 FROM public.tenant_connectors c
                 WHERE c.tenant_id = t.tenant_id
                   AND c.connector_key = 'ldap_directory'
                   AND c.config -> 'settings' ->> 'flavor' = 'active_directory')
              THEN 'active_directory' ELSE 'ldap' END
       END,
       external_id = coalesce(t.external_id, l.external_id)
  FROM (
    SELECT DISTINCT ON (local_id) local_id, tenant_id, provider, external_id
      FROM public.directory_links
     WHERE object_type = 'group'
       AND provider IN ('entra', 'okta', 'google', 'scim', 'ldap')
     ORDER BY local_id, created_at NULLS LAST
  ) l
 WHERE l.local_id = t.id
   AND l.tenant_id = t.tenant_id
   AND t.source IS NULL
   AND t.origin = 'internal';
