-- ============================================================================
-- 20261230000000_ai_assistants.sql
--
-- AI assistants: an optional chat assistant that helps people fill forms,
-- action tasks and build workflows / forms / data / decision tables / form
-- plugins (lib/assistants, Settings → AI assistants, /api/assistants/chat).
--
-- 1. Permission assistants.manage ("Manage AI assistants"): seed_tenant_roles
--    gives it to Owner and Admin; existing workspaces get it on those SYSTEM
--    roles (custom roles are never touched).
-- 2. public.assistant_settings: one row per workspace — the provider, the
--    model, the key (encrypted by the app, enc:v… ciphertext; or a pointer to
--    an existing Integrations connection), which capabilities are on and who
--    may use them, and the optional limits. RLS: admins (assistants.manage)
--    of the current workspace read it; the key column is not granted to
--    `authenticated` at all. Writes go through the service (service role).
-- 3. public.assistant_usage: one row per assistant request (tokens, cost at
--    the agent price table, capability, user) for the per-person daily
--    message limit, the monthly cost cap and the usage shown in Settings.
--    RLS: people read their own rows; admins read the workspace's. Service
--    role writes.
--
-- Tenant policies resolve the current workspace with get_current_tenant_id()
-- (COALESCE(current_tenant_id, tenant_id)). Additive and idempotent: safe to
-- run more than once. Until it is applied no assistant shows anywhere.
-- ============================================================================

SET lock_timeout = '5s';

/* ── 1. assistants.manage ──────────────────────────────────────────────── */

CREATE OR REPLACE FUNCTION public.seed_tenant_roles(p_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  v_all text[] := array[
    'tasks.create', 'tasks.view_own', 'tasks.view_all', 'tasks.assign',
    'tasks.complete', 'tasks.redirect', 'tasks.escalate', 'tasks.delete',
    'tasks.manage_queue', 'workflows.view', 'workflows.create',
    'workflows.edit', 'workflows.activate', 'workflows.delete',
    'workflows.view_runs', 'workflows.view_queue', 'workflows.manage_runs', 'forms.view', 'forms.edit',
    'forms.delete', 'forms.submit', 'forms.wizard', 'agents.view', 'agents.create', 'agents.edit',
    'agents.test', 'agents.delete', 'integrations.view',
    'integrations.create', 'integrations.edit', 'integrations.test',
    'integrations.delete', 'integrations.manage_references',
    'extensibility.view', 'extensibility.create', 'extensibility.edit',
    'extensibility.delete', 'data.view', 'data.create', 'data.edit_schema',
    'data.manage_rows', 'data.delete', 'reports.view', 'reports.create',
    'reports.edit_own', 'reports.share', 'reports.delete',
    'team.view_members', 'team.invite', 'team.remove', 'team.change_roles',
    'org.view', 'org.manage', 'projects.view', 'projects.manage',
    'settings.view', 'settings.edit', 'settings.manage_api_keys',
    'settings.manage_webhooks', 'sync.view', 'sync.manage', 'sync.deploy',
    'observability.view', 'packages.view', 'packages.manage', 'packages.install',
    'assistants.manage'
  ];
  -- Completing anyone's workflow task on their behalf: Owner and Admin.
  v_owner text[] := v_all || array['tasks.complete_any'];
  -- ALL minus settings.manage_*, settings.edit, team.change_roles, team.remove,
  -- org.manage, observability.view, assistants.manage
  v_manager text[] := array[
    'tasks.create', 'tasks.view_own', 'tasks.view_all', 'tasks.assign',
    'tasks.complete', 'tasks.redirect', 'tasks.escalate', 'tasks.delete',
    'tasks.manage_queue', 'workflows.view', 'workflows.create',
    'workflows.edit', 'workflows.activate', 'workflows.delete',
    'workflows.view_runs', 'workflows.view_queue', 'workflows.manage_runs', 'forms.view', 'forms.edit',
    'forms.delete', 'forms.submit', 'forms.wizard', 'agents.view', 'agents.create', 'agents.edit',
    'agents.test', 'agents.delete', 'integrations.view',
    'integrations.create', 'integrations.edit', 'integrations.test',
    'integrations.delete', 'integrations.manage_references',
    'extensibility.view', 'extensibility.create', 'extensibility.edit',
    'extensibility.delete', 'data.view', 'data.create', 'data.edit_schema',
    'data.manage_rows', 'data.delete', 'reports.view', 'reports.create',
    'reports.edit_own', 'reports.share', 'reports.delete',
    'team.view_members', 'team.invite', 'org.view', 'projects.view',
    'projects.manage', 'settings.view', 'sync.view',
    'sync.manage', 'sync.deploy', 'packages.view', 'packages.manage',
    'packages.install'
  ];
  -- Read-only consumer: own tasks, forms they are given, data, reports, people.
  v_viewer text[] := array[
    'tasks.view_own', 'tasks.complete', 'forms.submit', 'data.view',
    'reports.view', 'team.view_members', 'org.view', 'projects.view'
  ];
  v_member text[] := v_viewer || array[
    'tasks.create', 'tasks.assign', 'data.manage_rows', 'reports.create',
    'reports.edit_own', 'workflows.view_queue', 'forms.wizard'
  ];
begin
  insert into roles (tenant_id, name, slug, description, permissions, is_system, base_role) values
    (p_tenant_id, 'Owner',   'owner',   'Full access to everything, including billing and API keys', v_owner,   true, 'owner'),
    (p_tenant_id, 'Admin',   'admin',   'Full administrative access',                                v_owner,   true, 'admin'),
    (p_tenant_id, 'Manager', 'manager', 'Builds and manages work; no org administration',            v_manager, true, 'manager'),
    (p_tenant_id, 'Member',  'member',  'Works tasks, data, and reports',                            v_member,  true, 'member'),
    (p_tenant_id, 'Viewer',  'viewer',  'Read-only access',                                          v_viewer,  true, 'viewer');
end;
$$;

UPDATE public.roles
   SET permissions = permissions || ARRAY['assistants.manage']
 WHERE is_system AND slug IN ('owner', 'admin')
   AND NOT ('assistants.manage' = ANY (permissions));

/* ── 2. assistant_settings ─────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.assistant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'openai'
    CHECK (provider IN ('openai', 'anthropic', 'xai', 'gemini', 'azure_openai', 'mistral', 'groq', 'ollama', 'other')),
  key_source text NOT NULL DEFAULT 'key' CHECK (key_source IN ('key', 'integration')),
  integration_id uuid REFERENCES public.integrations(id) ON DELETE SET NULL,
  base_url text CHECK (base_url IS NULL OR char_length(base_url) <= 500),
  model text NOT NULL DEFAULT '' CHECK (char_length(model) <= 200),
  -- Encrypted by the app (lib/secret-crypto: enc:v… ciphertext). Never granted to authenticated.
  api_key text CHECK (api_key IS NULL OR char_length(api_key) <= 4000),
  key_last4 text CHECK (key_last4 IS NULL OR char_length(key_last4) <= 4),
  -- { form: { enabled, roles[], teams[], all_forms }, task: {…}, designer: {…} }
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(capabilities) <= 65536),
  -- { messages_per_user_per_day, monthly_cost_cap, cost_currency }
  limits jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(limits) <= 8192),
  last_test_status text CHECK (last_test_status IS NULL OR last_test_status IN ('ok', 'failed')),
  last_test_message text CHECK (last_test_message IS NULL OR char_length(last_test_message) <= 1000),
  last_tested_at timestamptz,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_assistant_settings_updated_at ON public.assistant_settings;
CREATE TRIGGER trg_assistant_settings_updated_at BEFORE UPDATE ON public.assistant_settings
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

ALTER TABLE public.assistant_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assistant_settings_select ON public.assistant_settings;
CREATE POLICY assistant_settings_select ON public.assistant_settings FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.get_current_tenant_id())
    AND 'assistants.manage' = ANY (public.get_user_permissions(tenant_id))
  );

REVOKE ALL ON public.assistant_settings FROM PUBLIC, anon, authenticated;
-- Every column but the key.
GRANT SELECT (tenant_id, provider, key_source, integration_id, base_url, model, key_last4, capabilities, limits,
  last_test_status, last_test_message, last_tested_at, updated_by, created_at, updated_at)
  ON public.assistant_settings TO authenticated;
GRANT ALL ON public.assistant_settings TO service_role;

/* ── 3. assistant_usage ────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.assistant_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  capability text NOT NULL CHECK (capability IN ('form', 'task', 'designer')),
  provider text,
  model text,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'awaiting_confirmation', 'failed', 'cancelled')),
  llm_calls integer NOT NULL DEFAULT 0,
  tool_calls integer NOT NULL DEFAULT 0,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  cost_amount numeric(14, 6),
  cost_currency text,
  cost_status text NOT NULL DEFAULT 'unknown' CHECK (cost_status IN ('priced', 'unknown')),
  error text CHECK (error IS NULL OR char_length(error) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_usage_tenant_created_idx ON public.assistant_usage (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assistant_usage_user_created_idx ON public.assistant_usage (tenant_id, user_id, created_at DESC);

ALTER TABLE public.assistant_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assistant_usage_select ON public.assistant_usage;
CREATE POLICY assistant_usage_select ON public.assistant_usage FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.get_current_tenant_id())
    AND (
      user_id = (SELECT auth.uid())
      OR 'assistants.manage' = ANY (public.get_user_permissions(tenant_id))
    )
  );

REVOKE ALL ON public.assistant_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.assistant_usage TO authenticated;
GRANT ALL ON public.assistant_usage TO service_role;
