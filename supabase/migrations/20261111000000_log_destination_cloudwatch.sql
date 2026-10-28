-- Log destinations: Amazon CloudWatch Logs (aws_cloudwatch_logs, PutLogEvents
-- with SigV4), next to the existing types. Only the type check changes;
-- config / credentials are validated by lib/api-schemas/log-destinations.
-- Idempotent.

ALTER TABLE public.log_destinations DROP CONSTRAINT IF EXISTS log_destinations_type_check;
ALTER TABLE public.log_destinations ADD CONSTRAINT log_destinations_type_check CHECK (
  type IN ('splunk_hec', 'datadog', 'otlp_http', 'webhook', 'syslog', 'azure_monitor', 'azure_event_hubs', 'gcp_logging', 'gcp_pubsub', 'aws_cloudwatch_logs')
);
