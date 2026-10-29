import { emailOption, loadEmailSdk, type EmailOptions, type EmailTransport } from './types'
import { buildMimeMessage } from './mime'

/**
 * Amazon SES (SESv2 API, @aws-sdk/client-sesv2, an optional dependency).
 * Credentials: ses_access_key_id / ses_secret_access_key, else the AWS
 * SDK's default chain (environment, instance / task role, IRSA). Region:
 * ses_region, else AWS_REGION.
 */

type SesModule = typeof import('@aws-sdk/client-sesv2')
type SesClient = InstanceType<SesModule['SESv2Client']>
const clients = new Map<string, { client: SesClient; mod: SesModule }>()

export function createSesTransport(options: EmailOptions): EmailTransport {
  const region = emailOption(options, 'ses_region') ?? process.env.AWS_REGION
  const accessKeyId = emailOption(options, 'ses_access_key_id')
  const secretAccessKey = emailOption(options, 'ses_secret_access_key')
  const configurationSet = emailOption(options, 'ses_configuration_set')
  return {
    id: 'ses',
    onPrem: false,
    async send(message) {
      const key = JSON.stringify([region, accessKeyId, secretAccessKey])
      let entry = clients.get(key)
      if (!entry) {
        const mod = await loadEmailSdk('@aws-sdk/client-sesv2', 'ses', () => import('@aws-sdk/client-sesv2'))
        const client = new mod.SESv2Client({
          ...(region ? { region } : {}),
          ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
        })
        entry = { client, mod }
        clients.set(key, entry)
      }
      const result = await entry.client.send(
        new entry.mod.SendEmailCommand({
          FromEmailAddress: message.from,
          Destination: { ToAddresses: message.to },
          ...(message.replyTo ? { ReplyToAddresses: [message.replyTo] } : {}),
          ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
          Content: message.attachments?.length ? {
            // Attachments need a raw MIME message.
            Raw: { Data: new TextEncoder().encode(buildMimeMessage(message)) },
          } : {
            Simple: {
              Subject: { Data: message.subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: message.html, Charset: 'UTF-8' },
                ...(message.text ? { Text: { Data: message.text, Charset: 'UTF-8' } } : {}),
              },
            },
          },
        }),
      )
      return { id: result.MessageId }
    },
  }
}
