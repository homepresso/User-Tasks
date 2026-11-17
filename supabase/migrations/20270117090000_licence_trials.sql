-- Self-serve trial licences issued by usertasks.com (lib/licensing/trial-service.ts,
-- POST /api/public/trials/sharepoint). Cloud (usertasks.com) only: self-hosted
-- installations never write here.
--
--  * One row per trial issued. The signed licence is kept so a repeat request
--    for the same farm gets the same licence back (and so support can re-send
--    it); it holds no secret — it is bound to one farm and signed with the
--    trial-only key.
--  * One trial per farm and one per company email domain, per SKU (unique
--    indexes; the service returns the existing trial instead of a new one).
--  * Service role only: no policies for anon / authenticated. Instance admins
--    read it through the server (Settings → Licence → Trials issued).
--
-- Additive and idempotent. Until it is applied the trial endpoint answers
-- "Trials aren't available yet" (it cannot record the one-per-farm rule).

CREATE TABLE IF NOT EXISTS public.licence_trials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  licence_id        text NOT NULL UNIQUE CHECK (length(licence_id) BETWEEN 1 AND 200),
  sku               text NOT NULL CHECK (sku ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  farm_id           text NOT NULL CHECK (farm_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  instance_id       text CHECK (instance_id IS NULL OR length(instance_id) <= 64),
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  email             text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  email_domain      text NOT NULL CHECK (length(email_domain) BETWEEN 3 AND 253),
  company           text NOT NULL CHECK (length(company) BETWEEN 1 AND 120),
  -- website (usertasks.com/sharepoint/trial) or product (an installation asking online)
  source            text NOT NULL DEFAULT 'website' CHECK (source IN ('website', 'product')),
  issued_at         timestamptz NOT NULL,
  expires_at        timestamptz NOT NULL,
  licence           jsonb NOT NULL CHECK (jsonb_typeof(licence) = 'object'),
  terms_accepted_at timestamptz NOT NULL,
  -- sha256 of the requester's IP with a server-side salt (abuse review); never the IP itself.
  ip_hash           text CHECK (ip_hash IS NULL OR length(ip_hash) <= 128),
  emailed_at        timestamptz,
  resent_count      integer NOT NULL DEFAULT 0 CHECK (resent_count >= 0),
  last_resent_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT licence_trials_dates CHECK (issued_at < expires_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS licence_trials_sku_farm_key ON public.licence_trials (sku, farm_id);
CREATE UNIQUE INDEX IF NOT EXISTS licence_trials_sku_domain_key ON public.licence_trials (sku, email_domain);
CREATE INDEX IF NOT EXISTS idx_licence_trials_created ON public.licence_trials (created_at DESC);

ALTER TABLE public.licence_trials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.licence_trials FROM PUBLIC;
REVOKE ALL ON public.licence_trials FROM anon, authenticated;
GRANT ALL ON public.licence_trials TO service_role;

COMMENT ON TABLE public.licence_trials IS
  'Self-serve trial licences issued by usertasks.com (one per farm and per email domain, per SKU). Service role only.';
