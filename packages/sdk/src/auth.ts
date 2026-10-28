/**
 * Supplies the bearer credential for each request.
 *
 * API keys are static. OAuth providers (`oauthAuth`, src/oauth.ts) return the
 * current access token from getToken(), refreshing it first when it is about
 * to expire, and implement invalidate() so the client can recover once from a
 * 401 caused by a token revoked or expired server-side.
 */
export interface TokenProvider {
  /** Kind of credential, for diagnostics. */
  readonly kind: 'api_key' | 'oauth' | (string & {})
  /** Bearer token to send with the next request. */
  getToken(): Promise<string>
  /**
   * Called after a 401 response carrying `rejectedToken`. Return true when a
   * different token is now available and the request should be retried once.
   */
  invalidate?(rejectedToken: string): Promise<boolean>
}

/** Static API key (or any long-lived bearer token). */
export function apiKeyAuth(key: string): TokenProvider {
  const token = key.trim()
  if (!token) throw new Error('apiKeyAuth: key is empty')
  return {
    kind: 'api_key',
    getToken: async () => token,
  }
}
