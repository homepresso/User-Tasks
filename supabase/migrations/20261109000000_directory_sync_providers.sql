-- Directory sync providers (providers phase 16): LDAP / Active Directory,
-- Google Workspace and inbound SCIM 2.0 next to Entra ID and Okta.
--
-- 1. directory_links / directory_sync_runs accept the new providers
--    ('ldap', 'google', 'scim'); runs record whether they were a full or a
--    delta (changed-since-cursor) sync.
--
-- 2. scim_tokens: per-workspace bearer tokens for the /scim/v2 endpoint. Only
--    the SHA-256 of a token is stored (the token itself is shown once), with
--    scopes (users:read, users:write, groups:read, groups:write), optional
--    expiry, revocation and the token it was rotated from.
--
-- 3. scim_resources / scim_group_members: what the identity provider pushed
--    (the SCIM representation: userName, externalId, the attributes as sent,
--    active, a version for ETags), linked to the local user or team the
--    reconciliation created or matched (lib/scim). directory_links rows with
--    provider 'scim' mirror the links, like every other directory.
--
-- All three are service-role only (RLS on, no policies, no grants for anon or
-- authenticated): the SCIM endpoint authenticates its own bearer tokens and
-- every query filters the token's workspace explicitly.
--
-- 4. cron_tick_probe(): LDAP and Google connectors count as configured
--    directories for the directory-sync job.

ALTER TABLE public.directory_links DROP CONSTRAINT IF EXISTS directory_links_provider_check;
ALTER TABLE public.directory_links ADD CONSTRAINT directory_links_provider_check
  CHECK (provider IN ('entra', 'okta', 'ldap', 'google', 'scim'));

ALTER TABLE public.directory_sync_runs DROP CONSTRAINT IF EXISTS directory_sync_runs_provider_check;
ALTER TABLE public.directory_sync_runs ADD CONSTRAINT directory_sync_runs_provider_check
  CHECK (provider IN ('entra', 'okta', 'ldap', 'google'));

ALTER TABLE public.directory_sync_runs ADD COLUMN IF NOT EXISTS mode text;
ALTER TABLE public.directory_sync_runs DROP CONSTRAINT IF EXISTS directory_sync_runs_mode_check;
ALTER TABLE public.directory_sync_runs ADD CONSTRAINT directory_sync_runs_mode_check
  CHECK (mode IS NULL OR mode IN ('full', 'delta'));

-- ── SCIM bearer tokens ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.scim_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  -- hex SHA-256 of the full token; the token is never stored.
  token_hash    text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  -- First characters of the token, to recognise it in the list.
  token_prefix  text NOT NULL,
  scopes        text[] NOT NULL DEFAULT ARRAY['users:read', 'users:write', 'groups:read', 'groups:write']
                CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['users:read', 'users:write', 'groups:read', 'groups:write']),
  created_by    uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  rotated_from  uuid REFERENCES public.scim_tokens (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS scim_tokens_tenant_idx ON public.scim_tokens (tenant_id, created_at DESC);

-- ── SCIM resources ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.scim_resources (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  resource_type  text NOT NULL CHECK (resource_type IN ('User', 'Group')),
  external_id    text,
  -- Users: userName (unique per workspace, case-insensitive). Groups: null.
  user_name      text,
  display_name   text,
  active         boolean NOT NULL DEFAULT true,
  -- The resource as the identity provider sent it (without id / meta / members).
  attributes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Local users.id / teams.id once reconciled (null: not linked, e.g. no email).
  local_id       uuid,
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((resource_type = 'User') = (user_name IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS scim_resources_user_name_key
  ON public.scim_resources (tenant_id, lower(user_name)) WHERE resource_type = 'User';
CREATE INDEX IF NOT EXISTS scim_resources_type_idx ON public.scim_resources (tenant_id, resource_type, created_at, id);
CREATE INDEX IF NOT EXISTS scim_resources_external_idx ON public.scim_resources (tenant_id, resource_type, external_id);
CREATE INDEX IF NOT EXISTS scim_resources_display_idx ON public.scim_resources (tenant_id, resource_type, lower(display_name));

CREATE TABLE IF NOT EXISTS public.scim_group_members (
  tenant_id  uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  group_id   uuid NOT NULL REFERENCES public.scim_resources (id) ON DELETE CASCADE,
  member_id  uuid NOT NULL REFERENCES public.scim_resources (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, member_id)
);

CREATE INDEX IF NOT EXISTS scim_group_members_member_idx ON public.scim_group_members (member_id);

DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['scim_tokens', 'scim_resources', 'scim_group_members'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END;
$do$;

COMMENT ON TABLE public.scim_tokens IS 'SCIM 2.0 bearer tokens per workspace (SHA-256 only). Service role only.';
COMMENT ON TABLE public.scim_resources IS 'SCIM 2.0 Users / Groups pushed by an identity provider, linked to local users / teams. Service role only.';
COMMENT ON TABLE public.scim_group_members IS 'SCIM 2.0 group membership (scim_resources ids). Service role only.';

-- ── Tick probe: LDAP and Google connectors count for the directory-sync job ──
--
-- cron_tick_probe() as in 20261103100000_cron_consolidation.sql, with the
-- new connector keys in the directory_sync check (grants are kept by
-- CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.cron_tick_probe()
  RETURNS jsonb
  LANGUAGE plpgsql STABLE
  SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  r jsonb := '{}'::jsonb;
  v boolean;
BEGIN
  BEGIN
    v := EXISTS (SELECT 1 FROM workflows WHERE trigger_type = 'schedule' AND is_active);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('schedules', v);

  -- Same predicate as claim_jobs (uses idx_queue_claim).
  BEGIN
    v := EXISTS (SELECT 1 FROM workflow_queue q
                  WHERE (q.status = 'pending' AND q.scheduled_for <= now())
                     OR (q.status = 'failed' AND q.attempts < q.max_attempts AND q.next_retry_at <= now()));
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('workflow_queue', v);

  -- 'processing' too: the agent worker resets jobs abandoned mid-run.
  BEGIN
    v := EXISTS (SELECT 1 FROM agent_queue
                  WHERE (status = 'pending' AND scheduled_for <= now()) OR status = 'processing');
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('agent_queue', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM tenant_connectors WHERE connector_key = 'github_sync' AND is_enabled)
      OR EXISTS (SELECT 1 FROM github_sync_runs WHERE status IN ('pending', 'running'));
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('github_sync', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM github_deployments WHERE status IN ('pending', 'running'));
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('github_deployments', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM log_destinations WHERE enabled);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('log_destinations', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM workflow_runs
                  WHERE status IN ('running', 'paused', 'waiting_for_event') AND sla_due_at IS NOT NULL);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('sla', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM task_reminders WHERE NOT is_sent);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('reminders', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM task_escalations WHERE NOT is_escalated);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('escalations', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM deletion_queue WHERE status = 'pending');
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('deletions', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM tenant_connectors
                  WHERE connector_key IN ('entra_directory', 'okta_directory', 'ldap_directory', 'google_directory') AND is_enabled)
      OR EXISTS (SELECT 1 FROM directory_sync_runs WHERE status IN ('pending', 'running'));
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('directory_sync', v);

  BEGIN
    v := EXISTS (SELECT 1 FROM tenant_connectors WHERE is_enabled AND (config->>'expires_at') IS NOT NULL);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v := true; END;
  r := r || jsonb_build_object('oauth_connectors', v);

  RETURN r;
END;
$$;
