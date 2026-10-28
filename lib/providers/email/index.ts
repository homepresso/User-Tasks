import { getProviderConfig } from '@/lib/config'
import { DEFAULT_PROVIDERS, type ProviderId } from '@/lib/config/schema'
import { pickProvider } from '../registry'
import { createAzureCommunicationTransport } from './azure-communication'
import { createConsoleTransport } from './console'
import { createGmailTransport } from './gmail'
import { createMicrosoftGraphTransport } from './microsoft-graph'
import { createResendTransport } from './resend'
import { createSesTransport } from './ses'
import { createSmtpTransport } from './smtp'
import type { EmailOptions, EmailTransport } from './types'

/**
 * EmailProvider: outbound mail. Every app email (invitations, the workflow
 * send_email node, notifications) goes through lib/email.ts → the configured
 * provider:
 *
 *  - resend (default)       Resend HTTP API, as before
 *  - smtp                   any SMTP relay (Exchange, Postfix, Microsoft 365,
 *                           Workspace SMTP relay, SES SMTP, Mailpit …)
 *  - ses                    Amazon SES (SESv2 API)
 *  - azure_communication    Azure Communication Services Email
 *  - microsoft_graph        Microsoft 365 / Exchange Online via Graph sendMail
 *  - gmail                  Gmail API with domain-wide delegation
 *  - console                log + .eml files (development, tests)
 *
 * Selected by EMAIL_PROVIDER or the `providers.email` instance setting;
 * options in ./options. SDKs (nodemailer, AWS, ACS) are optional
 * dependencies loaded on first send.
 */

export type EmailProvider = EmailTransport & { readonly id: ProviderId<'email'> }
export type { EmailMessage, EmailOptions } from './types'

export function resolveEmailProvider(id: ProviderId<'email'> = DEFAULT_PROVIDERS.email, options: EmailOptions = {}): EmailProvider {
  return pickProvider<'email', EmailTransport>('email', id, {
    resend: () => createResendTransport(options),
    smtp: () => createSmtpTransport(options),
    ses: () => createSesTransport(options),
    azure_communication: () => createAzureCommunicationTransport(options),
    microsoft_graph: () => createMicrosoftGraphTransport(options),
    gmail: () => createGmailTransport(options),
    console: () => createConsoleTransport(options),
  }) as EmailProvider
}

// One instance per configuration (SDK clients are reused across sends).
let cached: { signature: string; provider: EmailProvider; options: EmailOptions } | null = null

/** The configured provider and its (secret-resolved) options. */
export async function getEmailProviderWithOptions(): Promise<{ provider: EmailProvider; options: EmailOptions }> {
  const config = await getProviderConfig('email')
  const signature = JSON.stringify([config.id, config.options])
  if (cached?.signature !== signature) {
    cached = { signature, provider: resolveEmailProvider(config.id, config.options), options: config.options }
  }
  return { provider: cached.provider, options: cached.options }
}

export async function getEmailProvider(): Promise<EmailProvider> {
  return (await getEmailProviderWithOptions()).provider
}
