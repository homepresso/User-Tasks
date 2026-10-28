import { OAUTH_SCOPES } from './scopes'

/**
 * The first-party UserTasks CLI client, seeded globally (tenant-less) by
 * migration 20261023000000_oauth_first_party_cli.sql and advertised as
 * `usertasks_cli_client_id` in the authorization-server metadata. It is a
 * public PKCE client with loopback redirect URIs (any port, RFC 8252).
 */
export const USERTASKS_CLI_CLIENT_ID = 'usertasks-cli'

/** Everything except `admin` and the `mcp` transport marker (the seed's allowed_scopes). */
export const USERTASKS_CLI_SCOPES: string[] = OAUTH_SCOPES.filter((scope) => scope !== 'admin' && scope !== 'mcp')
