import { DefaultAzureCredential } from '@azure/identity'
import { attachmentBase64, EmailConfigError, emailOption, loadEmailSdk, parseAddress, type EmailOptions, type EmailTransport } from './types'

/**
 * Azure Communication Services Email (@azure/communication-email, an
 * optional dependency). Auth: acs_connection_string, or acs_endpoint
 * (https://<resource>.communication.azure.com) with Microsoft Entra ID —
 * managed identity / workload identity / AZURE_* service principal through
 * DefaultAzureCredential. The sender must be a verified MailFrom address of
 * a domain connected to the resource; ACS ignores a display name in `from`
 * (it uses the domain's configured sender name).
 */

type AcsClient = { beginSend(message: unknown): Promise<{ pollUntilDone(): Promise<{ id?: string; status?: string; error?: { message?: string } }> }> }
const clients = new Map<string, AcsClient>()

export function createAzureCommunicationTransport(options: EmailOptions): EmailTransport {
  const connectionString = emailOption(options, 'acs_connection_string')
  const endpoint = emailOption(options, 'acs_endpoint')
  return {
    id: 'azure_communication',
    onPrem: false,
    async send(message) {
      if (!connectionString && !endpoint) {
        throw new EmailConfigError('EMAIL_PROVIDER=azure_communication requires ACS_EMAIL_CONNECTION_STRING or ACS_EMAIL_ENDPOINT')
      }
      const key = connectionString ?? endpoint!
      let client = clients.get(key)
      if (!client) {
        const { EmailClient } = await loadEmailSdk('@azure/communication-email', 'azure_communication', () => import('@azure/communication-email'))
        client = (connectionString ? new EmailClient(connectionString) : new EmailClient(endpoint!, new DefaultAzureCredential())) as unknown as AcsClient
        clients.set(key, client)
      }
      const poller = await client.beginSend({
        senderAddress: parseAddress(message.from).address,
        content: { subject: message.subject, html: message.html, ...(message.text ? { plainText: message.text } : {}) },
        recipients: { to: message.to.map((to) => ({ address: parseAddress(to).address, ...(parseAddress(to).name ? { displayName: parseAddress(to).name } : {}) })) },
        ...(message.replyTo ? { replyTo: [{ address: parseAddress(message.replyTo).address }] } : {}),
        ...(message.attachments?.length
          ? { attachments: message.attachments.map((a) => ({ name: a.filename, contentType: a.contentType, contentInBase64: attachmentBase64(a) })) }
          : {}),
      })
      const result = await poller.pollUntilDone()
      if (result.status && result.status !== 'Succeeded') throw new Error(result.error?.message ?? `ACS email ${result.status}`)
      return { id: result.id }
    },
  }
}
