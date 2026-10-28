import { GoogleAuth, JWT } from 'google-auth-library'
import { buildMimeMessage } from './mime'
import { EmailConfigError, emailOption, parseAddress, type EmailOptions, type EmailTransport } from './types'

/**
 * Gmail API (users.messages.send) for Google Workspace: a service account
 * with domain-wide delegation for the gmail.send scope impersonates the
 * sending user (gmail_sender, else the from address). Credentials:
 * gmail_service_account_json (the key JSON), else Application Default
 * Credentials (GOOGLE_APPLICATION_CREDENTIALS; keyless workload identity
 * cannot impersonate users, so a key or IAM signJwt-capable ADC is needed).
 * The Workspace SMTP relay is the alternative: EMAIL_PROVIDER=smtp with
 * smtp-relay.gmail.com.
 */

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send'

type TokenClient = { getAccessToken(): Promise<{ token?: string | null }> }
const clients = new Map<string, TokenClient>()

export function createGmailTransport(options: EmailOptions, fetchImpl: typeof fetch = fetch): EmailTransport {
  const keyJson = emailOption(options, 'gmail_service_account_json')
  const client = async (subject: string): Promise<TokenClient> => {
    const cacheKey = JSON.stringify([keyJson, subject])
    let found = clients.get(cacheKey)
    if (found) return found
    if (keyJson) {
      let key: { client_email?: string; private_key?: string }
      try {
        key = JSON.parse(keyJson)
      } catch {
        throw new EmailConfigError('GMAIL_SERVICE_ACCOUNT_JSON is not valid JSON')
      }
      if (!key.client_email || !key.private_key) throw new EmailConfigError('GMAIL_SERVICE_ACCOUNT_JSON must be a service-account key (client_email, private_key)')
      found = new JWT({ email: key.client_email, key: key.private_key, scopes: [GMAIL_SCOPE], subject })
    } else {
      found = (await new GoogleAuth({ scopes: [GMAIL_SCOPE], clientOptions: { subject } }).getClient()) as unknown as TokenClient
    }
    clients.set(cacheKey, found)
    return found
  }
  return {
    id: 'gmail',
    onPrem: false,
    async send(message) {
      const sender = emailOption(options, 'gmail_sender') ?? parseAddress(message.from).address
      const { token } = await (await client(sender)).getAccessToken()
      if (!token) throw new Error('Gmail: no access token')
      const raw = Buffer.from(buildMimeMessage(message), 'utf8').toString('base64url')
      const res = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(sender)}/messages/send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ raw }),
      })
      const body = await res.json().catch(() => null) as { id?: string; error?: { message?: string } } | null
      if (!res.ok) throw new Error(`Gmail send failed (${res.status})${body?.error?.message ? `: ${body.error.message}` : ''}`)
      return { id: body?.id }
    },
  }
}
