-- ============================================================================
-- 20261223000000_workspace_subdomains.sql
--
-- Workspace addresses (acme.usertasks.com) and friendly form links
-- (acme.usertasks.com/form/employee-onboarding).
--
-- 1. public.tenants.subdomain: the workspace's address, unique among live
--    workspaces. Lowercase a–z, 0–9 and hyphens, 3–40 characters, no
--    leading, trailing or double hyphen (CHECK), not a reserved name
--    (public.subdomain_is_reserved(): the list matches RESERVED_SUBDOMAINS in
--    lib/workspace-address.ts; a test keeps them equal). Kept apart from
--    tenants.slug, which stays the sign-in "organisation" identifier (it can
--    be longer, and renaming the address must not change how people sign in).
--    Backfilled from the slug where the slug is a valid, unreserved address;
--    new workspaces get one the same way (BEFORE INSERT trigger). NULL = no
--    address yet (Settings → Workspace sets one).
--
-- 2. public.tenant_subdomain_history: retired addresses (an AFTER UPDATE
--    trigger records the old value on every change), so links to an old
--    address redirect to the new one for a year, and nobody else can take
--    it in that time (lib/services/workspace-address.ts). Service role only.
--
-- 3. public.forms.system_name: a form's friendly link name, unique per
--    workspace (same character rules, 3–60). Defaulted from the form name on
--    insert ("Employee onboarding" → employee-onboarding, then -2, -3, …;
--    names still redirecting are skipped) and backfilled for existing forms.
--
-- 4. public.form_system_name_history: a form's earlier system names (AFTER
--    UPDATE trigger), so shared /form/<old-name> links redirect to the
--    current name. A name taken by another form of the workspace stops
--    redirecting (the current name wins; its history row is removed).
--    Service role only.
--
-- No new client grants: the subdomain and system_name columns are read
-- through the existing tenants / forms policies (members of the workspace);
-- every write goes through the server (tenants has no end-user UPDATE policy
-- since 20261031000000; forms writes are service role).
--
-- Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

-- ── Reserved names ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.subdomain_is_reserved(p_value text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
  SELECT p_value = ANY (ARRAY[
    'about', 'account', 'accounts', 'admin', 'administrator', 'api', 'app', 'apps', 'assets', 'auth', 'autoconfig', 'autodiscover',
    'beta', 'billing', 'blog', 'cdn', 'cli', 'cloud', 'community', 'console', 'contact', 'dashboard', 'demo', 'dev', 'developer',
    'developers', 'dns', 'doc', 'docs', 'download', 'downloads', 'edge', 'email', 'events', 'files', 'form', 'forms', 'ftp',
    'gallery', 'git', 'health', 'help', 'imap', 'img', 'internal', 'legal', 'localhost', 'login', 'logout', 'mail', 'mcp', 'media',
    'metrics', 'mx', 'news', 'ns1', 'ns2', 'oauth', 'origin', 'pop', 'portal', 'preview', 'privacy', 'proxy', 'public', 'realtime',
    'root', 'saml', 'scim', 'sdk', 'security', 'signin', 'signup', 'smtp', 'sso', 'stage', 'staging', 'static', 'status', 'storage',
    'support', 'system', 'terms', 'test', 'usertasks', 'webhook', 'webhooks', 'webmail', 'wpad', 'www',
    'f', 'p', 'ws'
  ]::text[])
$$;

-- ── 1. tenants.subdomain ────────────────────────────────────────────────────
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS subdomain text;
COMMENT ON COLUMN public.tenants.subdomain IS
  'Workspace address (<subdomain>.<base domain>): a-z 0-9 and hyphens, 3-40, unique among live workspaces. NULL = none. Written by the server only (lib/services/workspace-address.ts).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_subdomain_format') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_subdomain_format
      CHECK (subdomain IS NULL OR (subdomain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' AND length(subdomain) BETWEEN 3 AND 40 AND position('--' IN subdomain) = 0));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_subdomain_live ON public.tenants (subdomain)
  WHERE subdomain IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.tenant_subdomain_candidate(p_slug text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_slug IS NOT NULL
     AND p_slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
     AND length(p_slug) BETWEEN 3 AND 40
     AND position('--' IN p_slug) = 0
     AND NOT public.subdomain_is_reserved(p_slug)
    THEN p_slug
  END
$$;

-- Backfill from the slug (slugs are unique among live workspaces already).
UPDATE public.tenants t
   SET subdomain = public.tenant_subdomain_candidate(t.slug)
 WHERE t.subdomain IS NULL
   AND t.deleted_at IS NULL
   AND public.tenant_subdomain_candidate(t.slug) IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.tenants o
      WHERE o.id <> t.id AND o.deleted_at IS NULL AND o.subdomain = public.tenant_subdomain_candidate(t.slug)
   );

-- ── 2. tenant_subdomain_history ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_subdomain_history (
  subdomain  text PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  retired_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.tenant_subdomain_history IS
  'Retired workspace addresses: redirect to the workspace''s current address for a year; reserved for that workspace meanwhile. Service role only.';
CREATE INDEX IF NOT EXISTS idx_tenant_subdomain_history_tenant ON public.tenant_subdomain_history (tenant_id);
ALTER TABLE public.tenant_subdomain_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_subdomain_history FROM anon, authenticated;
GRANT ALL ON public.tenant_subdomain_history TO service_role;

-- New workspaces: the address follows the slug when it can.
CREATE OR REPLACE FUNCTION public.tenants_default_subdomain()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_candidate text;
BEGIN
  IF NEW.subdomain IS NULL THEN
    v_candidate := public.tenant_subdomain_candidate(NEW.slug);
    IF v_candidate IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE subdomain = v_candidate AND deleted_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.tenant_subdomain_history WHERE subdomain = v_candidate AND retired_at > now() - interval '365 days')
    THEN
      NEW.subdomain := v_candidate;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenants_default_subdomain ON public.tenants;
CREATE TRIGGER trg_tenants_default_subdomain BEFORE INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tenants_default_subdomain();

-- A changed address: the old one redirects (history); taking back an old one removes it from history.
CREATE OR REPLACE FUNCTION public.tenants_subdomain_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.subdomain IS NOT NULL THEN
    DELETE FROM public.tenant_subdomain_history WHERE subdomain = NEW.subdomain;
  END IF;
  IF OLD.subdomain IS NOT NULL AND OLD.subdomain IS DISTINCT FROM NEW.subdomain THEN
    INSERT INTO public.tenant_subdomain_history (subdomain, tenant_id, retired_at)
    VALUES (OLD.subdomain, NEW.id, now())
    ON CONFLICT (subdomain) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, retired_at = EXCLUDED.retired_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tenants_subdomain_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tenants_subdomain_history ON public.tenants;
CREATE TRIGGER trg_tenants_subdomain_history AFTER UPDATE OF subdomain ON public.tenants
  FOR EACH ROW WHEN (OLD.subdomain IS DISTINCT FROM NEW.subdomain)
  EXECUTE FUNCTION public.tenants_subdomain_history();

-- ── 3. forms.system_name ────────────────────────────────────────────────────
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS system_name text;
COMMENT ON COLUMN public.forms.system_name IS
  'Friendly link name (/form/<system_name> on the workspace address): a-z 0-9 and hyphens, 3-60, unique per workspace. Defaulted from the name.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forms_system_name_format') THEN
    ALTER TABLE public.forms ADD CONSTRAINT forms_system_name_format
      CHECK (system_name IS NULL OR (system_name ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' AND length(system_name) BETWEEN 3 AND 60 AND position('--' IN system_name) = 0));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_forms_tenant_system_name ON public.forms (tenant_id, system_name) WHERE system_name IS NOT NULL;

-- ── 4. form_system_name_history ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.form_system_name_history (
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  system_name text NOT NULL,
  form_id     uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  retired_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, system_name)
);
COMMENT ON TABLE public.form_system_name_history IS
  'Earlier system names of forms: /form/<old-name> redirects to the form''s current name. Service role only.';
CREATE INDEX IF NOT EXISTS idx_form_system_name_history_form ON public.form_system_name_history (form_id);
ALTER TABLE public.form_system_name_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.form_system_name_history FROM anon, authenticated;
GRANT ALL ON public.form_system_name_history TO service_role;

-- "Employee onboarding!" → employee-onboarding (lib/forms/system-name.ts suggestSystemName).
CREATE OR REPLACE FUNCTION public.form_system_name_base(p_name text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  v text;
BEGIN
  v := lower(translate(coalesce(p_name, ''),
    'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝýÿÑñÇç',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuYyyNnCc'));
  v := regexp_replace(v, '[^a-z0-9]+', '-', 'g');
  v := regexp_replace(v, '^-+|-+$', '', 'g');
  v := regexp_replace(left(v, 60), '-+$', '');
  IF v = '' THEN v := 'form'; END IF;
  IF length(v) < 3 THEN v := 'form-' || v; END IF;
  RETURN v;
END;
$$;

-- The first free name in the workspace: base, base-2, base-3, … (names still redirecting are skipped).
CREATE OR REPLACE FUNCTION public.form_system_name_free(p_tenant_id uuid, p_base text, p_form_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_candidate text := p_base;
  v_n int := 1;
  v_suffix text;
BEGIN
  LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.forms WHERE tenant_id = p_tenant_id AND system_name = v_candidate AND id IS DISTINCT FROM p_form_id)
          AND NOT EXISTS (SELECT 1 FROM public.form_system_name_history WHERE tenant_id = p_tenant_id AND system_name = v_candidate AND form_id IS DISTINCT FROM p_form_id);
    v_n := v_n + 1;
    v_suffix := '-' || v_n;
    v_candidate := regexp_replace(left(p_base, 60 - length(v_suffix)), '-+$', '') || v_suffix;
    IF v_n > 10000 THEN
      RETURN left(p_base, 51) || '-' || substr(md5(random()::text), 1, 8);
    END IF;
  END LOOP;
  RETURN v_candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.forms_default_system_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.system_name IS NULL THEN
    NEW.system_name := public.form_system_name_free(NEW.tenant_id, public.form_system_name_base(NEW.name), NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_forms_default_system_name ON public.forms;
CREATE TRIGGER trg_forms_default_system_name BEFORE INSERT ON public.forms
  FOR EACH ROW EXECUTE FUNCTION public.forms_default_system_name();

CREATE OR REPLACE FUNCTION public.forms_system_name_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.system_name IS NOT NULL THEN
    DELETE FROM public.form_system_name_history WHERE tenant_id = NEW.tenant_id AND system_name = NEW.system_name;
  END IF;
  IF OLD.system_name IS NOT NULL AND OLD.system_name IS DISTINCT FROM NEW.system_name THEN
    INSERT INTO public.form_system_name_history (tenant_id, system_name, form_id, retired_at)
    VALUES (NEW.tenant_id, OLD.system_name, NEW.id, now())
    ON CONFLICT (tenant_id, system_name) DO UPDATE SET form_id = EXCLUDED.form_id, retired_at = EXCLUDED.retired_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.forms_system_name_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_forms_system_name_history ON public.forms;
CREATE TRIGGER trg_forms_system_name_history AFTER UPDATE OF system_name ON public.forms
  FOR EACH ROW WHEN (OLD.system_name IS DISTINCT FROM NEW.system_name)
  EXECUTE FUNCTION public.forms_system_name_history();

-- A new form taking a name that still redirects: the current name wins.
CREATE OR REPLACE FUNCTION public.forms_claim_system_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.system_name IS NOT NULL THEN
    DELETE FROM public.form_system_name_history WHERE tenant_id = NEW.tenant_id AND system_name = NEW.system_name;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.forms_claim_system_name() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_forms_claim_system_name ON public.forms;
CREATE TRIGGER trg_forms_claim_system_name AFTER INSERT ON public.forms
  FOR EACH ROW EXECUTE FUNCTION public.forms_claim_system_name();

-- Backfill existing forms, oldest first (the oldest keeps the plain name);
-- updated_at is left alone (the name is new metadata, not an edit).
ALTER TABLE public.forms DISABLE TRIGGER trg_forms_updated_at;
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id, tenant_id, name FROM public.forms WHERE system_name IS NULL ORDER BY created_at, id LOOP
    UPDATE public.forms
       SET system_name = public.form_system_name_free(r.tenant_id, public.form_system_name_base(r.name), r.id)
     WHERE id = r.id;
  END LOOP;
END $$;
ALTER TABLE public.forms ENABLE TRIGGER trg_forms_updated_at;

