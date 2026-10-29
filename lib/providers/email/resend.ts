import { Resend } from 'resend'
import { EmailConfigError, emailOption, type EmailOptions, type EmailTransport } from './types'

/** Resend (the default): the HTTP API, as before. */

const clients = new Map<string, Resend>()

export function createResendTransport(options: EmailOptions): EmailTransport {
  const apiKey = emailOption(options, 'resend_api_key')
  return {
    id: 'resend',
    onPrem: false,
    async send(message) {
      if (!apiKey) throw new EmailConfigError('Email service not configured. Set RESEND_API_KEY in .env.local')
      let client = clients.get(apiKey)
      if (!client) {
        client = new Resend(apiKey)
        clients.set(apiKey, client)
      }
      const { data, error } = await client.emails.send({
        from: message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        ...(message.text ? { text: message.text } : {}),
        replyTo: message.replyTo || undefined,
        ...(message.attachments?.length
          ? { attachments: message.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })) }
          : {}),
      })
      if (error) throw new Error(error.message)
      return { id: data?.id }
    },
  }
}
