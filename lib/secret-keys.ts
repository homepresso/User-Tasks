/** Credential-shaped key names. Pure and client-safe (re-exported by lib/secret-fields). */

// A key is considered sensitive when it names a credential-ish value.
// Derived from the shapes built in app/actions/integrations.ts,
// app/actions/connectors.ts, lib/connectors/definitions/* and consumed by
// lib/reference-executor.ts, lib/db-connector.ts, lib/workflow-engine.ts.
export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase()
  return (
    k.includes('password') ||          // password, entra_password, db password
    k.includes('secret') ||            // secret, client_secret, app_secret, secret_access_key, secret_key, entra_client_secret
    k.includes('private_key') ||       // private_key (google service accounts)
    k.includes('account_key') ||       // account_key (azure blob)
    k.includes('service_account') ||   // service_account, service_account_json
    k === 'token' ||
    k.endsWith('_token') ||            // access_token, api_token, auth_token, bot_token, sas_token, refresh_token
    k === 'api_key' ||
    k.endsWith('_api_key') ||
    k === 'key_value' ||               // generic api-key auth value
    k === 'webhook_url' ||             // Teams/Slack/Workflows webhook URLs carry their signature
    k.includes('passphrase') ||        // private key passphrases
    k === 'connection_string'          // database URIs embed passwords
  )
}

