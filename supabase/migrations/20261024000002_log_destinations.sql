-- Log export destinations (log export phase 3: data model only; the shipper
-- arrives in phase 4).
--
-- * One row per configured destination: Splunk HEC, Datadog Logs,
--   OpenTelemetry (OTLP/HTTP) or a generic HTTPS webhook.
-- * config: non-secret, type-specific settings (URL, index, site, tags…).
--   credentials: tokens / API keys / header values / signing secret, each
--   string encrypted at rest by lib/secret-crypto (enc:v1:) when
--   ENCRYPTION_KEY is set, never returned by the API (masked '__SECRET__').
--   filters: { categories[], types[] (globs), min_severity, workflow_ids[] }.
-- * cursor: last shipped public.event_stream.id. Shipper bookkeeping:
--   status, next_attempt_at, locked_by/locked_at (claim lease), delivery
--   stats (events_sent, last_success_at, last_error, consecutive_failures).
-- * No client access at all (credentials must not be readable by members):
--   RLS on with no policies and privileges revoked from anon/authenticated.
--   The API, MCP and the settings UI go through lib/services/log-destinations
--   with a service-role client.
--
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS public.log_destinations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  type                 text NOT NULL,
  config               jsonb NOT NULL DEFAULT '{}'::jsonb,
  credentials          jsonb NOT NULL DEFAULT '{}'::jsonb,
  filters              jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled              boolean NOT NULL DEFAULT true,
  cursor               bigint NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'healthy',
  next_attempt_at      timestamptz,
  locked_by            text,
  locked_at            timestamptz,
  events_sent          bigint NOT NULL DEFAULT 0,
  last_success_at      timestamptz,
  last_error           text,
  last_error_at        timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT log_destinations_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT log_destinations_type_check CHECK (type IN ('splunk_hec', 'datadog', 'otlp_http', 'webhook')),
  CONSTRAINT log_destinations_status_check CHECK (status IN ('healthy', 'retrying', 'failing', 'disabled', 'lagging_data_lost')),
  CONSTRAINT log_destinations_cursor_check CHECK (cursor >= 0),
  CONSTRAINT log_destinations_tenant_name_key UNIQUE (tenant_id, name)
);

-- The shipper claims enabled destinations that are due.
CREATE INDEX IF NOT EXISTS idx_log_destinations_due
  ON public.log_destinations (next_attempt_at)
  WHERE enabled;

ALTER TABLE public.log_destinations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.log_destinations FROM PUBLIC;
REVOKE ALL ON public.log_destinations FROM anon, authenticated;
GRANT ALL ON public.log_destinations TO service_role;

DROP TRIGGER IF EXISTS trg_log_destinations_updated_at ON public.log_destinations;
CREATE TRIGGER trg_log_destinations_updated_at
  BEFORE UPDATE ON public.log_destinations
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

COMMENT ON TABLE public.log_destinations IS
  'Log export destinations (Splunk HEC, Datadog, OTLP/HTTP, webhook). Credentials encrypted, service-role access only; cursor = last shipped event_stream.id.';
