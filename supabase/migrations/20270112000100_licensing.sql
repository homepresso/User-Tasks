-- Licensing and entitlements for paid extensions (lib/licensing).
--
--  * tenant_entitlements: cloud entitlements — which workspace may use which
--    paid extension, with features, numeric limits (e.g. {"sharepoint.farms": 2})
--    and dates. Admin-managed now (Settings / API / usertasks-admin); a billing
--    webhook can upsert rows later with source 'stripe'. Writes: service role
--    only (the server, after its instance-admin checks). Members may read their
--    current workspace's rows (tenant resolution via get_current_tenant_id(),
--    i.e. COALESCE(current_tenant_id, tenant_id)).
--  * licence_events: instance-level licence audit trail (install, replace,
--    remove, expiry notices, denials, entitlement changes). Service role only.
--  * instance.id: the stable instance id licences can be bound to, seeded once
--    here (the app and the admin CLI also create it on first use if missing).
--
-- Installed licence files are stored in instance_settings (`instance.licences`,
-- already allowed by the instance.* key check) — no table needed.
--
-- Additive and idempotent. Safe before or after the code: until it is applied
-- the app treats every workspace as having no cloud entitlements and keeps
-- licence events in the server log only.

CREATE TABLE IF NOT EXISTS public.tenant_entitlements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  extension_id text NOT NULL CHECK (extension_id ~ '^[a-z][a-z0-9-]{0,62}$'),
  edition      text CHECK (edition IS NULL OR length(edition) <= 100),
  features     text[] NOT NULL DEFAULT '{}',
  limits       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(limits) = 'object'),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  source       text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'trial', 'stripe', 'licence')),
  starts_at    timestamptz,
  -- The extension stops 24 hours after ends_at (no grace period).
  ends_at      timestamptz,
  notes        text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Actor id (a user, or NULL for the API / admin CLI). No FK: users are provider-managed.
  updated_by   uuid,
  CONSTRAINT tenant_entitlements_tenant_extension_key UNIQUE (tenant_id, extension_id),
  CONSTRAINT tenant_entitlements_dates CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);

CREATE INDEX IF NOT EXISTS idx_tenant_entitlements_extension ON public.tenant_entitlements (extension_id);

ALTER TABLE public.tenant_entitlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_entitlements_select ON public.tenant_entitlements;
CREATE POLICY tenant_entitlements_select ON public.tenant_entitlements FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_current_tenant_id()));

REVOKE ALL ON public.tenant_entitlements FROM PUBLIC;
REVOKE ALL ON public.tenant_entitlements FROM anon, authenticated;
GRANT SELECT ON public.tenant_entitlements TO authenticated;
GRANT ALL ON public.tenant_entitlements TO service_role;

COMMENT ON TABLE public.tenant_entitlements IS
  'Workspace entitlements to paid extensions (features, limits, dates). Service-role writes; members read their workspace''s rows.';

CREATE TABLE IF NOT EXISTS public.licence_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  event        text NOT NULL CHECK (event IN ('installed', 'replaced', 'removed', 'expiring', 'expired', 'denied', 'entitlement_granted', 'entitlement_revoked')),
  licence_id   text,
  extension_id text,
  -- No FK: events outlive deleted workspaces.
  tenant_id    uuid,
  actor_id     uuid,
  actor        text,
  summary      text NOT NULL,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_licence_events_occurred ON public.licence_events (occurred_at DESC);

ALTER TABLE public.licence_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.licence_events FROM PUBLIC;
REVOKE ALL ON public.licence_events FROM anon, authenticated;
GRANT ALL ON public.licence_events TO service_role;

COMMENT ON TABLE public.licence_events IS
  'Instance-level licence audit trail (lib/licensing/audit.ts). Service role only.';

-- The instance id (never overwritten once set).
INSERT INTO public.instance_settings (key, value, secret, updated_at)
VALUES ('instance.id', to_jsonb('inst_' || replace(gen_random_uuid()::text, '-', '')), false, now())
ON CONFLICT (key) DO NOTHING;
