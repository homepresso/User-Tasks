import { EmailConfigError, emailBool, emailOption, loadEmailSdk, requireEmailOption, type EmailOptions, type EmailTransport } from './types'

/**
 * SMTP (nodemailer, an optional dependency): any relay — Microsoft Exchange /
 * Microsoft 365, Postfix, Sendmail, hMailServer, Google Workspace SMTP relay,
 * Amazon SES SMTP, Mailpit / MailHog for development.
 *
 * TLS: `smtp_secure=true` is implicit TLS (port 465). Otherwise the
 * connection starts in plain text and upgrades with STARTTLS:
 * `smtp_starttls=required` refuses to send without it, `opportunistic`
 * (default) upgrades when offered, `off` never upgrades (internal relays
 * on a trusted network only). Certificates are verified unless
 * `smtp_tls_reject_unauthorized=false`; for a private CA set
 * NODE_EXTRA_CA_CERTS instead.
 */

type Transporter = { sendMail(mail: Record<string, unknown>): Promise<{ messageId?: string }>; close(): void }
const transports = new Map<string, Transporter>()

export function smtpTransportOptions(options: EmailOptions): Record<string, unknown> {
  const host = requireEmailOption(options, 'smtp_host', 'SMTP_HOST', 'smtp')
  const secure = emailBool(options, 'smtp_secure') ?? false
  const port = Number(emailOption(options, 'smtp_port') ?? (secure ? 465 : 587))
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new EmailConfigError('SMTP_PORT must be a port number')
  const starttls = (emailOption(options, 'smtp_starttls') ?? 'opportunistic').toLowerCase()
  if (!['required', 'opportunistic', 'off'].includes(starttls)) throw new EmailConfigError('SMTP_STARTTLS must be required, opportunistic or off')
  const user = emailOption(options, 'smtp_user')
  const pass = emailOption(options, 'smtp_password')
  const servername = emailOption(options, 'smtp_tls_servername')
  const name = emailOption(options, 'smtp_name')
  return {
    host,
    port,
    secure,
    requireTLS: !secure && starttls === 'required',
    ignoreTLS: !secure && starttls === 'off',
    ...(user ? { auth: { user, pass: pass ?? '' } } : {}),
    tls: {
      rejectUnauthorized: emailBool(options, 'smtp_tls_reject_unauthorized') ?? true,
      ...(servername ? { servername } : {}),
    },
    ...(name ? { name } : {}),
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  }
}

export function createSmtpTransport(options: EmailOptions): EmailTransport {
  return {
    id: 'smtp',
    onPrem: true,
    async send(message) {
      const config = smtpTransportOptions(options)
      const key = JSON.stringify(config)
      let transport = transports.get(key)
      if (!transport) {
        const nodemailer = await loadEmailSdk('nodemailer', 'smtp', () => import('nodemailer'))
        transport = (nodemailer.default ?? nodemailer).createTransport(config) as unknown as Transporter
        transports.set(key, transport)
      }
      const info = await transport.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        ...(message.text ? { text: message.text } : {}),
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      })
      return { id: info.messageId }
    },
  }
}

/** Closes pooled connections (tests). */
export function closeSmtpTransports(): void {
  for (const transport of transports.values()) transport.close()
  transports.clear()
}
