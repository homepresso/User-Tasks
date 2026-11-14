import { InlineNotice } from '@/components/ui/inline-notice'

/**
 * Warns when a connection would send reusable credentials (Basic, Bearer, API
 * key) over plain http:// to a non-loopback host. Plain http:// is only
 * accepted for hosts an administrator listed in EGRESS_HTTP_ALLOW; Windows
 * authentication (NTLM / Kerberos challenge-response) is not flagged.
 */

const CLEAR_TEXT_AUTH = new Set(['basic', 'bearer', 'api_key'])
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

export function sendsCredentialsInClear(baseUrl: string, authType: string): boolean {
  if (!CLEAR_TEXT_AUTH.has(authType)) return false
  try {
    const url = new URL(baseUrl.trim())
    return url.protocol === 'http:' && !LOOPBACK.has(url.hostname)
  } catch {
    return false
  }
}

export function HttpCredentialsWarning({ baseUrl, authType }: { baseUrl: string; authType: string }) {
  if (!sendsCredentialsInClear(baseUrl, authType)) return null
  return (
    <InlineNotice
      tone="warning"
      title="Credentials over plain HTTP"
      message="This connection sends its credentials unencrypted, readable by anyone on the network path. Use https:// (add your internal CA on the connection if needed), or Windows authentication, which never sends the password. Plain http:// is accepted only for hosts listed in EGRESS_HTTP_ALLOW."
    />
  )
}
