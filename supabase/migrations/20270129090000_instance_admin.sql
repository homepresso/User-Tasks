-- Instance admin ("cloud admin") operations: lib/services/instance-admin.
--
--  * instance_admin_audit: the instance-level trail of every read-scope
--    change and every on-behalf action an instance admin takes (who, which
--    workspace / person, the action, the reason, the outcome). Service role
--    only: no workspace member, owner included, can read it. Rows outlive
--    deleted workspaces and people (no foreign keys).
--  * instance_admin_daily_counts(): per-day, per-workspace operational counts
--    (runs, tasks, agent runs, AI requests, signups, people) for the cloud
--    admin charts, so they never scan raw rows. Counts and sums only.
--  * instance_admin_workspace_stats(): per-workspace operational counts for a
--    page of workspaces (members, invitations, assets, runs, failures, AI
--    cost, storage bytes). Counts and sums only: no content.
--
-- Additive and idempotent. Before it is applied, reads fall back to plain
-- queries (slower, capped) and every on-behalf ACTION is refused with a
-- "migration pending" error, because an action must be audited.

CREATE TABLE IF NOT EXISTS public.instance_admin_audit (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- The instance admin (no FK: the trail outlives the person).
  admin_user_id    uuid NOT NULL,
  admin_email      text NOT NULL CHECK (length(admin_email) <= 320),
  action           text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.]{0,63}$'),
  -- The workspace and person acted on (no FK: the trail outlives them).
  target_tenant_id uuid,
  target_user_id   uuid,
  target_type      text CHECK (target_type IS NULL OR length(target_type) <= 40),
  target_id        text CHECK (target_id IS NULL OR length(target_id) <= 200),
  target_label     text CHECK (target_label IS NULL OR length(target_label) <= 320),
  reason           text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  outcome          text NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok', 'noop', 'refused', 'error')),
  -- What changed (role names, dates, counts) — never workspace content.
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  via              text NOT NULL DEFAULT 'api' CHECK (via IN ('api', 'app', 'workflow', 'cli', 'mcp', 'ui')),
  ip               text CHECK (ip IS NULL OR length(ip) <= 64),
  -- Client idempotency key (a replay returns the first result).
  idempotency_key  text CHECK (idempotency_key IS NULL OR length(idempotency_key) <= 200)
);

CREATE INDEX IF NOT EXISTS idx_instance_admin_audit_created ON public.instance_admin_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_instance_admin_audit_tenant ON public.instance_admin_audit (target_tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_instance_admin_audit_user ON public.instance_admin_audit (target_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_instance_admin_audit_idem
  ON public.instance_admin_audit (admin_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.instance_admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instance_admin_audit FROM PUBLIC;
REVOKE ALL ON public.instance_admin_audit FROM anon, authenticated;
GRANT ALL ON public.instance_admin_audit TO service_role;

COMMENT ON TABLE public.instance_admin_audit IS
  'Instance admin (cloud admin) trail: every on-behalf action with who, target, reason and outcome (lib/services/instance-admin). Service role only.';

-- Per-day, per-workspace counts. p_kind: runs | tasks | agent_runs | ai_requests | signups | people.
-- status: the run / task / agent-run status, the AI cost status, or NULL. amount: AI cost (USD as stored).
CREATE OR REPLACE FUNCTION public.instance_admin_daily_counts(p_kind text, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (day date, tenant_id uuid, status text, n bigint, amount numeric)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT (r.started_at AT TIME ZONE 'UTC')::date, r.tenant_id, r.status, count(*)::bigint, NULL::numeric
    FROM public.workflow_runs r
   WHERE p_kind = 'runs' AND r.started_at >= p_from AND r.started_at < p_to
   GROUP BY 1, 2, 3
  UNION ALL
  SELECT (t.created_at AT TIME ZONE 'UTC')::date, t.tenant_id, t.status::text, count(*)::bigint, NULL::numeric
    FROM public.tasks t
   WHERE p_kind = 'tasks' AND t.created_at >= p_from AND t.created_at < p_to AND t.deleted_at IS NULL
   GROUP BY 1, 2, 3
  UNION ALL
  SELECT (a.started_at AT TIME ZONE 'UTC')::date, a.tenant_id, a.status, count(*)::bigint, sum(COALESCE(a.cost_amount, 0))
    FROM public.agent_runs a
   WHERE p_kind IN ('agent_runs', 'ai_requests') AND a.started_at >= p_from AND a.started_at < p_to
   GROUP BY 1, 2, 3
  UNION ALL
  SELECT (u.created_at AT TIME ZONE 'UTC')::date, u.tenant_id, u.status, count(*)::bigint, sum(COALESCE(u.cost_amount, 0))
    FROM public.assistant_usage u
   WHERE p_kind = 'ai_requests' AND u.created_at >= p_from AND u.created_at < p_to
   GROUP BY 1, 2, 3
  UNION ALL
  SELECT (w.created_at AT TIME ZONE 'UTC')::date, w.id, w.plan::text, count(*)::bigint, NULL::numeric
    FROM public.tenants w
   WHERE p_kind = 'signups' AND w.created_at >= p_from AND w.created_at < p_to AND w.deleted_at IS NULL
   GROUP BY 1, 2, 3
  UNION ALL
  SELECT (p.created_at AT TIME ZONE 'UTC')::date, p.tenant_id, NULL::text, count(*)::bigint, NULL::numeric
    FROM public.users p
   WHERE p_kind = 'people' AND p.created_at >= p_from AND p.created_at < p_to AND p.deleted_at IS NULL
   GROUP BY 1, 2, 3
$$;

REVOKE ALL ON FUNCTION public.instance_admin_daily_counts(text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.instance_admin_daily_counts(text, timestamptz, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instance_admin_daily_counts(text, timestamptz, timestamptz) TO service_role;

-- Operational counts for a page of workspaces (at most 200 ids).
CREATE OR REPLACE FUNCTION public.instance_admin_workspace_stats(p_tenant_ids uuid[])
RETURNS TABLE (
  tenant_id uuid, members bigint, active_members bigint, active_7d bigint, active_30d bigint,
  pending_invitations bigint, forms bigint, workflows bigint, active_workflows bigint, apps bigint,
  data_tables bigint, reports bigint, agents bigint, runs_30d bigint, failed_runs_7d bigint,
  open_tasks bigint, ai_requests_30d bigint, ai_cost_30d numeric, storage_bytes bigint,
  queue_pending bigint, queue_dead bigint, last_activity_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT t.id,
    (SELECT count(*) FROM public.user_memberships m WHERE m.tenant_id = t.id),
    (SELECT count(*) FROM public.user_memberships m WHERE m.tenant_id = t.id AND m.is_active),
    (SELECT count(*) FROM public.user_memberships m JOIN public.users u ON u.id = m.user_id
      WHERE m.tenant_id = t.id AND m.is_active AND u.last_seen_at >= now() - interval '7 days'),
    (SELECT count(*) FROM public.user_memberships m JOIN public.users u ON u.id = m.user_id
      WHERE m.tenant_id = t.id AND m.is_active AND u.last_seen_at >= now() - interval '30 days'),
    (SELECT count(*) FROM public.invitations i WHERE i.tenant_id = t.id AND i.accepted_at IS NULL AND i.expires_at > now()),
    (SELECT count(*) FROM public.forms f WHERE f.tenant_id = t.id),
    (SELECT count(*) FROM public.workflows w WHERE w.tenant_id = t.id),
    (SELECT count(*) FROM public.workflows w WHERE w.tenant_id = t.id AND w.is_active),
    (SELECT count(*) FROM public.apps a WHERE a.tenant_id = t.id),
    (SELECT count(*) FROM public.custom_tables c WHERE c.tenant_id = t.id),
    (SELECT count(*) FROM public.reports r WHERE r.tenant_id = t.id),
    (SELECT count(*) FROM public.agents g WHERE g.tenant_id = t.id),
    (SELECT count(*) FROM public.workflow_runs r WHERE r.tenant_id = t.id AND r.started_at >= now() - interval '30 days'),
    (SELECT count(*) FROM public.workflow_runs r WHERE r.tenant_id = t.id AND r.status = 'failed' AND r.started_at >= now() - interval '7 days'),
    (SELECT count(*) FROM public.tasks k WHERE k.tenant_id = t.id AND k.deleted_at IS NULL AND k.status IN ('draft', 'todo', 'in_progress', 'blocked')),
    (SELECT count(*) FROM public.agent_runs a WHERE a.tenant_id = t.id AND a.started_at >= now() - interval '30 days')
      + (SELECT count(*) FROM public.assistant_usage u WHERE u.tenant_id = t.id AND u.created_at >= now() - interval '30 days'),
    COALESCE((SELECT sum(a.cost_amount) FROM public.agent_runs a WHERE a.tenant_id = t.id AND a.started_at >= now() - interval '30 days'), 0)
      + COALESCE((SELECT sum(u.cost_amount) FROM public.assistant_usage u WHERE u.tenant_id = t.id AND u.created_at >= now() - interval '30 days'), 0),
    COALESCE((SELECT sum(f.size) FROM public.form_files f WHERE f.tenant_id = t.id), 0)::bigint
      + COALESCE((SELECT sum(a.size) FROM public.task_attachments a WHERE a.tenant_id = t.id AND a.deleted_at IS NULL), 0)::bigint,
    (SELECT count(*) FROM public.workflow_queue q WHERE q.tenant_id = t.id AND q.status IN ('pending', 'processing')),
    (SELECT count(*) FROM public.workflow_queue q WHERE q.tenant_id = t.id AND q.status = 'dead' AND q.created_at >= now() - interval '7 days'),
    (SELECT max(u.last_seen_at) FROM public.user_memberships m JOIN public.users u ON u.id = m.user_id WHERE m.tenant_id = t.id)
  FROM public.tenants t
  WHERE t.id = ANY (p_tenant_ids[1:200])
$$;

REVOKE ALL ON FUNCTION public.instance_admin_workspace_stats(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.instance_admin_workspace_stats(uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instance_admin_workspace_stats(uuid[]) TO service_role;

-- Supabase Auth only (auth.* exists): sign-in state of accounts for the
-- instance admin views — last sign-in, ban, confirmation, open sessions,
-- verified MFA factors and linked sign-in providers. No secrets, no tokens.
-- Elsewhere (built-in auth, plain PostgreSQL) it returns no rows; the app
-- reads app_auth instead.
CREATE OR REPLACE FUNCTION public.instance_admin_auth_state(p_user_ids uuid[])
RETURNS TABLE (user_id uuid, last_sign_in_at timestamptz, banned_until timestamptz, email_confirmed_at timestamptz,
               open_sessions integer, mfa_factors integer, providers text[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF to_regclass('auth.users') IS NULL OR to_regclass('auth.sessions') IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY EXECUTE $q$
    SELECT u.id, u.last_sign_in_at, u.banned_until, u.email_confirmed_at,
      (SELECT count(*)::int FROM auth.sessions s WHERE s.user_id = u.id),
      CASE WHEN to_regclass('auth.mfa_factors') IS NULL THEN 0
           ELSE (SELECT count(*)::int FROM auth.mfa_factors f WHERE f.user_id = u.id AND f.status::text = 'verified') END,
      COALESCE((SELECT array_agg(DISTINCT i.provider) FROM auth.identities i WHERE i.user_id = u.id), '{}')
    FROM auth.users u WHERE u.id = ANY ($1[1:500])
  $q$ USING p_user_ids;
END
$$;

REVOKE ALL ON FUNCTION public.instance_admin_auth_state(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.instance_admin_auth_state(uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instance_admin_auth_state(uuid[]) TO service_role;

-- Supabase Auth only: end every session (refresh token) of one account —
-- the instance admin "Sign out everywhere". Access tokens already issued
-- stay valid until they expire (the JWT lifetime, 1 hour by default).
CREATE OR REPLACE FUNCTION public.instance_admin_revoke_sessions(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  n integer := 0;
BEGIN
  IF p_user_id IS NULL OR to_regclass('auth.sessions') IS NULL THEN
    RETURN 0;
  END IF;
  EXECUTE 'DELETE FROM auth.sessions WHERE user_id = $1' USING p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

REVOKE ALL ON FUNCTION public.instance_admin_revoke_sessions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.instance_admin_revoke_sessions(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instance_admin_revoke_sessions(uuid) TO service_role;

-- Supabase Auth only: accounts suspended right now (banned_until in the future), newest first.
CREATE OR REPLACE FUNCTION public.instance_admin_locked_users(p_limit integer DEFAULT 500)
RETURNS TABLE (user_id uuid, banned_until timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY EXECUTE
    'SELECT u.id, u.banned_until FROM auth.users u WHERE u.banned_until > now() ORDER BY u.banned_until DESC LIMIT $1'
    USING LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
END
$$;

REVOKE ALL ON FUNCTION public.instance_admin_locked_users(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.instance_admin_locked_users(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instance_admin_locked_users(integer) TO service_role;
