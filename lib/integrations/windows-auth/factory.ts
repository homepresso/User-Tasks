/**
 * The core `windows` connector transport (lib/integrations/transports.ts):
 * validates the connection's auth_config and returns its Windows-auth fetch.
 * A configuration problem fails the call (TransportUnavailableError); there is
 * never a fallback to an unauthenticated request. Server-only.
 */
import { TransportUnavailableError, type TransportContext } from '../transports'
import { validateWindowsAuthConfig } from './config'
import { createWindowsTransport } from './transport'

export async function windowsTransportFactory(ctx: TransportContext): Promise<typeof fetch> {
  const config = ctx.integrationConfig ?? {}
  const baseUrl = typeof config.base_url === 'string' ? config.base_url.trim() : ''
  if (!baseUrl) throw new TransportUnavailableError('Windows authentication needs the connection base URL')
  const checked = validateWindowsAuthConfig(config.auth_config)
  if (!checked.ok) throw new TransportUnavailableError(`Windows authentication is not configured: ${checked.errors.join('; ')}`)
  if (/^enc:v\d+:/.test(checked.config.password)) {
    throw new TransportUnavailableError('Windows authentication: the stored password could not be decrypted (check ENCRYPTION_KEY)')
  }
  return createWindowsTransport({ baseUrl, auth: checked.config })
}
