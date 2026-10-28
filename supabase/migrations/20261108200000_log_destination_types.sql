-- Log destinations (providers phase 15): syslog (RFC 5424 over TLS / TCP /
-- UDP), Azure Monitor Logs Ingestion, Azure Event Hubs, Google Cloud Logging
-- and Google Cloud Pub/Sub, next to Splunk HEC, Datadog, OTLP/HTTP and
-- webhooks. Only the type check changes; config / credentials are validated
-- by lib/api-schemas/log-destinations. Idempotent.

ALTER TABLE public.log_destinations DROP CONSTRAINT IF EXISTS log_destinations_type_check;
ALTER TABLE public.log_destinations ADD CONSTRAINT log_destinations_type_check CHECK (
  type IN ('splunk_hec', 'datadog', 'otlp_http', 'webhook', 'syslog', 'azure_monitor', 'azure_event_hubs', 'gcp_logging', 'gcp_pubsub')
);
