import { ClientSecretCredential, DefaultAzureCredential, type TokenCredential } from '@azure/identity'
import { emailOption, parseAddress, type EmailOptions, type EmailTransport } from './types'

/**
 * Microsoft 365 / Exchange Online via Microsoft Graph `sendMail`
 * (POST /users/{sender}/sendMail). App-only auth: client credentials
 * (graph_tenant_id + graph_client_id + graph_client_secret) or, without a
 * secret, managed identity / workload identity via DefaultAzureCredential.
 * The app needs the Mail.Send application permission; restrict it to the
 * sending mailbox with an Exchange application access policy (RBAC for
 * Applications). The sender mailbox is graph_sender, else the from address.
 */

const credentials = new Map<string, TokenCredential>()

export function createMicrosoftGraphTransport(options: EmailOptions, fetchImpl: typeof fetch = fetch): EmailTransport {
  const tenantId = emailOption(options, 'graph_tenant_id')
  const clientId = emailOption(options, 'graph_client_id')
  const clientSecret = emailOption(options, 'graph_client_secret')
  const endpoint = (emailOption(options, 'graph_endpoint') ?? 'https://graph.microsoft.com').replace(/\/+$/, '')
  const credential = (): TokenCredential => {
    const key = JSON.stringify([tenantId, clientId, clientSecret])
    let found = credentials.get(key)
    if (!found) {
      found = tenantId && clientId && clientSecret
        ? new ClientSecretCredential(tenantId, clientId, clientSecret)
        : new DefaultAzureCredential(clientId ? { managedIdentityClientId: clientId } : undefined)
      credentials.set(key, found)
    }
    return found
  }
  const recipient = (value: string) => {
    const { name, address } = parseAddress(value)
    return { emailAddress: { address, ...(name ? { name } : {}) } }
  }
  return {
    id: 'microsoft_graph',
    onPrem: false,
    async send(message) {
      const sender = emailOption(options, 'graph_sender') ?? parseAddress(message.from).address
      const token = await credential().getToken(`${endpoint}/.default`)
      if (!token?.token) throw new Error('Microsoft Graph: no access token')
      const res = await fetchImpl(`${endpoint}/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject: message.subject,
            body: { contentType: 'HTML', content: message.html },
            toRecipients: message.to.map(recipient),
            ...(message.replyTo ? { replyTo: [recipient(message.replyTo)] } : {}),
            ...(parseAddress(message.from).address.toLowerCase() !== sender.toLowerCase() ? { from: recipient(message.from) } : {}),
          },
          saveToSentItems: false,
        }),
      })
      if (res.status !== 202 && !res.ok) {
        const detail = await res.json().catch(() => null) as { error?: { code?: string; message?: string } } | null
        throw new Error(`Microsoft Graph sendMail failed (${res.status}${detail?.error?.code ? ` ${detail.error.code}` : ''})${detail?.error?.message ? `: ${detail.error.message}` : ''}`)
      }
      return { id: res.headers.get('request-id') ?? undefined }
    },
  }
}
