-- First-party OAuth client for the UserTasks CLI (browser login).
--
-- * oauth_clients.is_first_party marks clients shipped by UserTasks itself.
--   Only this migration sets it; app code (DCR, the OAuth Apps settings page)
--   never does. First-party clients may hold first-party-only scopes
--   (keys:write) and get a "verified" badge on the consent screen.
-- * First-party clients are global (tenant_id NULL) like DCR clients: consent
--   binds the code and tokens to the consenting user's current workspace.
-- * usertasks-cli is a public PKCE client. Its loopback redirect URIs match
--   any port at /api/oauth/authorize (RFC 8252 §7.3).
--
-- Idempotent: safe to run more than once. Re-running refreshes the seeded
-- client's settings but keeps revoked_at, so an operator's revoke sticks.

ALTER TABLE public.oauth_clients
  ADD COLUMN IF NOT EXISTS is_first_party boolean NOT NULL DEFAULT false;

ALTER TABLE public.oauth_clients DROP CONSTRAINT IF EXISTS oauth_clients_tenant_bound;
ALTER TABLE public.oauth_clients
  ADD CONSTRAINT oauth_clients_tenant_bound
  CHECK (is_dynamic OR is_first_party OR tenant_id IS NOT NULL);

INSERT INTO public.oauth_clients (
  tenant_id, client_id, client_secret_hash, name, client_type,
  grant_types, redirect_uris, allowed_scopes, is_dynamic, is_first_party
) VALUES (
  NULL,
  'usertasks-cli',
  NULL,
  'UserTasks CLI',
  'public',
  ARRAY['authorization_code', 'refresh_token'],
  ARRAY['http://127.0.0.1/callback', 'http://[::1]/callback'],
  -- Every scope except admin and the mcp marker (lib/oauth/first-party.ts).
  ARRAY[
    'tasks:read', 'tasks:write', 'workflows:read', 'workflows:write',
    'data:read', 'data:write', 'reports:read', 'reports:write',
    'agents:read', 'agents:write', 'integrations:read', 'integrations:write',
    'extensibility:read', 'extensibility:write', 'settings:read', 'settings:write',
    'team:read', 'team:write', 'sync:read', 'sync:write', 'workflows:run',
    'config:read', 'config:write', 'keys:write'
  ],
  false,
  true
)
ON CONFLICT (client_id) DO UPDATE SET
  name = EXCLUDED.name,
  client_type = EXCLUDED.client_type,
  client_secret_hash = NULL,
  grant_types = EXCLUDED.grant_types,
  redirect_uris = EXCLUDED.redirect_uris,
  allowed_scopes = EXCLUDED.allowed_scopes
WHERE public.oauth_clients.is_first_party;
