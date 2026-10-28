import { getEmailProviderWithOptions } from '@/lib/providers/email'
import { emailOption } from '@/lib/providers/email/types'

/**
 * Sends one email through the configured EmailProvider (lib/providers/email:
 * Resend by default; SMTP, SES, Azure Communication Services, Microsoft
 * Graph, Gmail API or the console sink). Every app email goes through here.
 *
 * Sender: params.from, else EMAIL_FROM (`email.from`), else Resend's
 * onboarding sender on Resend (as before) — other providers need EMAIL_FROM.
 * Reply-To: params.replyTo, else EMAIL_REPLY_TO (`email.reply_to`).
 *
 * Never throws: failures (including misconfiguration) come back as
 * `{ success: false, error }`. Logs recipients and subject, never bodies or
 * credentials.
 */

export interface SendEmailParams {
  to: string | string[]
  subject: string
  body: string
  from?: string
  replyTo?: string
}

const RESEND_SANDBOX_FROM = 'UserTasks <onboarding@resend.dev>'
const CONSOLE_FROM = 'UserTasks <noreply@usertasks.local>'

export async function sendEmail(params: SendEmailParams): Promise<{ success: boolean; id?: string; error?: string }> {
  let providerId = 'email'
  try {
    const { provider, options } = await getEmailProviderWithOptions()
    providerId = provider.id
    const fallbackFrom = provider.id === 'resend' ? RESEND_SANDBOX_FROM : provider.id === 'console' ? CONSOLE_FROM : undefined
    const fromAddress = params.from || emailOption(options, 'from') || fallbackFrom
    if (!fromAddress) {
      console.error(`[email] EMAIL_FROM is not configured (required by the ${provider.id} provider)`)
      return { success: false, error: `Email service not configured. Set EMAIL_FROM for the ${provider.id} email provider` }
    }
    const toAddresses = (Array.isArray(params.to) ? params.to : [params.to]).map((to) => to.trim()).filter(Boolean)
    const replyTo = params.replyTo || emailOption(options, 'reply_to') || undefined

    console.log(`[email] Sending via ${provider.id} to ${toAddresses.join(', ')} from ${fromAddress} — subject: ${params.subject}`)
    const result = await provider.send({ from: fromAddress, to: toAddresses, subject: params.subject, html: params.body, replyTo })
    console.log(`[email] Sent successfully — id: ${result.id}`)
    return { success: true, id: result.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[email] ${providerId} error:`, message)
    return { success: false, error: message }
  }
}
