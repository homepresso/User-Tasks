/**
 * Email provider options (`email.<option>` instance settings, or the
 * environment variables below, which win). Any option can also be a secret
 * reference (`secret://<name>`, resolved by lib/config from the secret store).
 *
 * All providers:   from, reply_to
 * resend:          resend_api_key
 * smtp:            smtp_host, smtp_port (587; 465 with smtp_secure),
 *                  smtp_secure (implicit TLS), smtp_starttls (required |
 *                  opportunistic (default) | off), smtp_user, smtp_password,
 *                  smtp_tls_reject_unauthorized (default true),
 *                  smtp_tls_servername, smtp_name (EHLO host)
 * ses:             ses_region, ses_access_key_id, ses_secret_access_key,
 *                  ses_configuration_set (default AWS credential chain)
 * azure_communication: acs_connection_string, or acs_endpoint with Entra ID
 *                  (managed identity / workload identity via DefaultAzureCredential)
 * microsoft_graph: graph_tenant_id, graph_client_id, graph_client_secret
 *                  (client credentials) or none of them (managed identity);
 *                  graph_sender (mailbox to send as; default the from address),
 *                  graph_endpoint (national clouds)
 * gmail:           gmail_service_account_json (key JSON; default Application
 *                  Default Credentials), gmail_sender (Workspace user to
 *                  impersonate via domain-wide delegation; default the from address)
 * console:         console_dir (write each message as an .eml file)
 */

export const EMAIL_OPTION_ENV: Record<string, string> = {
  from: 'EMAIL_FROM',
  reply_to: 'EMAIL_REPLY_TO',
  resend_api_key: 'RESEND_API_KEY',
  smtp_host: 'SMTP_HOST',
  smtp_port: 'SMTP_PORT',
  smtp_secure: 'SMTP_SECURE',
  smtp_starttls: 'SMTP_STARTTLS',
  smtp_user: 'SMTP_USER',
  smtp_password: 'SMTP_PASSWORD',
  smtp_tls_reject_unauthorized: 'SMTP_TLS_REJECT_UNAUTHORIZED',
  smtp_tls_servername: 'SMTP_TLS_SERVERNAME',
  smtp_name: 'SMTP_NAME',
  ses_region: 'SES_REGION',
  ses_access_key_id: 'SES_ACCESS_KEY_ID',
  ses_secret_access_key: 'SES_SECRET_ACCESS_KEY',
  ses_configuration_set: 'SES_CONFIGURATION_SET',
  acs_connection_string: 'ACS_EMAIL_CONNECTION_STRING',
  acs_endpoint: 'ACS_EMAIL_ENDPOINT',
  graph_tenant_id: 'GRAPH_TENANT_ID',
  graph_client_id: 'GRAPH_CLIENT_ID',
  graph_client_secret: 'GRAPH_CLIENT_SECRET',
  graph_sender: 'GRAPH_SENDER',
  graph_endpoint: 'GRAPH_ENDPOINT',
  gmail_service_account_json: 'GMAIL_SERVICE_ACCOUNT_JSON',
  gmail_sender: 'GMAIL_SENDER',
  console_dir: 'EMAIL_CONSOLE_DIR',
}

/** Options that are credentials: instance settings must store them encrypted (or as secret:// refs). */
export const EMAIL_SECRET_OPTIONS = new Set([
  'resend_api_key', 'smtp_password', 'ses_secret_access_key', 'acs_connection_string', 'graph_client_secret', 'gmail_service_account_json',
])
