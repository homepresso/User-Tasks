/**
 * EmailProvider implementations (lib/providers/email) and lib/email.ts
 * routing. SMTP runs against an in-test SMTP server (smtp-server: plain,
 * AUTH, STARTTLS and implicit TLS with its built-in self-signed cert); the
 * cloud providers run against mocked SDKs / fetch.
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SMTPServer } from 'smtp-server'

const sesSend = vi.fn()
vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class { send = sesSend },
  SendEmailCommand: class { constructor(public input: unknown) {} },
}))
const acsBeginSend = vi.fn()
const acsCtor = vi.fn()
vi.mock('@azure/communication-email', () => ({
  EmailClient: class {
    constructor(...args: unknown[]) { acsCtor(...args) }
    beginSend = acsBeginSend
  },
}))
const resendSend = vi.fn()
vi.mock('resend', () => ({ Resend: class { emails = { send: resendSend } } }))

import { createSmtpTransport, closeSmtpTransports, smtpTransportOptions } from '@/lib/providers/email/smtp'
import { createSesTransport } from '@/lib/providers/email/ses'
import { createAzureCommunicationTransport } from '@/lib/providers/email/azure-communication'
import { createMicrosoftGraphTransport } from '@/lib/providers/email/microsoft-graph'
import { createGmailTransport } from '@/lib/providers/email/gmail'
import { createConsoleTransport } from '@/lib/providers/email/console'
import { createResendTransport } from '@/lib/providers/email/resend'
import { buildMimeMessage, encodeHeader } from '@/lib/providers/email/mime'
import { htmlToText, loadEmailSdk, parseAddress, type EmailMessage } from '@/lib/providers/email/types'
import { resolveEmailProvider } from '@/lib/providers/email'
import { ProviderNotAvailableError } from '@/lib/providers/registry'

const MESSAGE: EmailMessage = {
  from: 'UserTasks <noreply@example.com>',
  to: ['ada@example.com', 'Bob <bob@example.com>'],
  subject: 'Héllo — invite',
  html: '<p>Hello <b>there</b></p><a href="https://x.test/a">link</a>',
  replyTo: 'support@example.com',
}

describe('helpers', () => {
  it('parses display addresses and renders text from HTML', () => {
    expect(parseAddress('UserTasks <noreply@example.com>')).toEqual({ name: 'UserTasks', address: 'noreply@example.com' })
    expect(parseAddress('"A, B" <ab@example.com>')).toEqual({ name: 'A, B', address: 'ab@example.com' })
    expect(parseAddress('plain@example.com')).toEqual({ address: 'plain@example.com' })
    expect(htmlToText('<p>Hi</p><a href="https://u">go</a><script>x()</script>')).toBe('Hi\ngo (https://u)')
  })

  it('builds a MIME message with encoded headers and no header injection', () => {
    expect(encodeHeader('plain')).toBe('plain')
    expect(encodeHeader('Héllo')).toBe(`=?UTF-8?B?${Buffer.from('Héllo').toString('base64')}?=`)
    const mime = buildMimeMessage({ ...MESSAGE, subject: 'Hi\r\nBcc: evil@example.com' })
    expect(mime).toContain('Subject: Hi Bcc: evil@example.com\r\n')
    expect(mime).not.toMatch(/^Bcc:/m)
    expect(mime).toContain('To: ada@example.com, "Bob" <bob@example.com>')
    expect(mime).toContain('Reply-To: support@example.com')
    expect(mime).toContain('Content-Type: multipart/alternative')
    expect(() => buildMimeMessage({ ...MESSAGE, to: ['a@example.com>\r\nBcc: x@y'] })).toThrow()
  })

  it('turns a missing optional SDK into an install hint', async () => {
    await expect(loadEmailSdk('nodemailer', 'smtp', async () => { throw new Error("Cannot find module 'nodemailer'") }))
      .rejects.toThrow(/npm install nodemailer@\^10\.2\.1`, then rebuild .*optional-drivers/)
  })

  it('resolves every provider id and refuses unknown ones', () => {
    for (const id of ['resend', 'smtp', 'ses', 'azure_communication', 'microsoft_graph', 'gmail', 'console'] as const) {
      expect(resolveEmailProvider(id).id).toBe(id)
    }
    expect(resolveEmailProvider('smtp').onPrem).toBe(true)
    expect(resolveEmailProvider('console').onPrem).toBe(true)
    expect(() => resolveEmailProvider('nope' as never)).toThrow(ProviderNotAvailableError)
  })
})

// ── SMTP against a local server ──────────────────────────────────────────────

type Received = { from?: string; to: string[]; raw: string; user?: string; secure: boolean }

async function startSmtp(opts: { secure?: boolean; auth?: boolean; disableStartTls?: boolean } = {}) {
  const received: Received[] = []
  const server = new SMTPServer({
    secure: opts.secure ?? false,
    authOptional: !opts.auth,
    disabledCommands: [...(opts.auth ? [] : ['AUTH']), ...(opts.disableStartTls ? ['STARTTLS'] : [])],
    allowInsecureAuth: true,
    logger: false,
    onAuth(auth, _session, cb) {
      if (auth.username === 'relay-user' && auth.password === 'relay-pass') return cb(null, { user: auth.username })
      cb(new Error('Invalid username or password'))
    },
    onData(stream, session, cb) {
      let raw = ''
      stream.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')))
      stream.on('end', () => {
        received.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : undefined, to: session.envelope.rcptTo.map((r) => r.address), raw, user: session.user as string | undefined, secure: session.secure })
        cb()
      })
    },
  })
  // Clients that reject the self-signed certificate drop the socket mid-handshake.
  server.on('error', () => undefined)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.server.address() as AddressInfo).port
  return { server, port, received, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('smtp provider', () => {
  afterEach(() => closeSmtpTransports())

  it('maps options to nodemailer settings (TLS modes, auth, validation)', () => {
    expect(smtpTransportOptions({ smtp_host: 'mail.corp', smtp_starttls: 'required', smtp_user: 'u', smtp_password: 'p' })).toMatchObject({
      host: 'mail.corp', port: 587, secure: false, requireTLS: true, ignoreTLS: false, auth: { user: 'u', pass: 'p' }, tls: { rejectUnauthorized: true },
    })
    expect(smtpTransportOptions({ smtp_host: 'mail.corp', smtp_secure: 'true' })).toMatchObject({ port: 465, secure: true, requireTLS: false })
    expect(smtpTransportOptions({ smtp_host: 'relay', smtp_port: '25', smtp_starttls: 'off' })).toMatchObject({ port: 25, ignoreTLS: true })
    expect(() => smtpTransportOptions({})).toThrow(/SMTP_HOST/)
    expect(() => smtpTransportOptions({ smtp_host: 'x', smtp_starttls: 'maybe' })).toThrow(/SMTP_STARTTLS/)
    expect(() => smtpTransportOptions({ smtp_host: 'x', smtp_port: '99999' })).toThrow(/port/)
  })

  it('delivers to a plain relay (on-prem Postfix / Exchange receive connector)', async () => {
    const smtp = await startSmtp({ disableStartTls: true })
    try {
      const result = await createSmtpTransport({ smtp_host: '127.0.0.1', smtp_port: String(smtp.port), smtp_starttls: 'off' }).send(MESSAGE)
      expect(result.id).toMatch(/@/)
      expect(smtp.received).toHaveLength(1)
      const [mail] = smtp.received
      expect(mail.from).toBe('noreply@example.com')
      expect(mail.to).toEqual(['ada@example.com', 'bob@example.com'])
      expect(mail.raw).toMatch(/Subject: =\?UTF-8\?/)
      expect(mail.raw).toMatch(/Reply-To: support@example.com/)
    } finally {
      await smtp.close()
    }
  })

  it('authenticates over STARTTLS and rejects bad credentials', async () => {
    const smtp = await startSmtp({ auth: true })
    try {
      const base = { smtp_host: '127.0.0.1', smtp_port: String(smtp.port), smtp_starttls: 'required', smtp_tls_reject_unauthorized: 'false', smtp_user: 'relay-user' }
      await createSmtpTransport({ ...base, smtp_password: 'relay-pass' }).send(MESSAGE)
      expect(smtp.received[0]).toMatchObject({ user: 'relay-user', secure: true })
      await expect(createSmtpTransport({ ...base, smtp_password: 'wrong' }).send(MESSAGE)).rejects.toThrow(/Invalid/)
    } finally {
      await smtp.close()
    }
  })

  it('refuses to send in clear text when STARTTLS is required but not offered', async () => {
    const smtp = await startSmtp({ disableStartTls: true })
    try {
      await expect(createSmtpTransport({ smtp_host: '127.0.0.1', smtp_port: String(smtp.port), smtp_starttls: 'required' }).send(MESSAGE)).rejects.toThrow()
      expect(smtp.received).toHaveLength(0)
    } finally {
      await smtp.close()
    }
  })

  it('implicit TLS verifies the certificate unless told not to', async () => {
    const smtp = await startSmtp({ secure: true })
    try {
      const base = { smtp_host: '127.0.0.1', smtp_port: String(smtp.port), smtp_secure: 'true' }
      await expect(createSmtpTransport(base).send(MESSAGE)).rejects.toThrow(/certificate/i)
      await createSmtpTransport({ ...base, smtp_tls_reject_unauthorized: 'false' }).send(MESSAGE)
      expect(smtp.received[0].secure).toBe(true)
    } finally {
      await smtp.close()
    }
  })
})

// ── Cloud providers (mocked) ─────────────────────────────────────────────────

describe('ses provider', () => {
  it('sends a SESv2 Simple message', async () => {
    sesSend.mockResolvedValueOnce({ MessageId: 'ses-1' })
    const result = await createSesTransport({ ses_region: 'eu-west-1', ses_configuration_set: 'tracking' }).send(MESSAGE)
    expect(result.id).toBe('ses-1')
    expect(sesSend.mock.calls[0][0].input).toEqual({
      FromEmailAddress: MESSAGE.from,
      Destination: { ToAddresses: MESSAGE.to },
      ReplyToAddresses: ['support@example.com'],
      ConfigurationSetName: 'tracking',
      Content: { Simple: { Subject: { Data: MESSAGE.subject, Charset: 'UTF-8' }, Body: { Html: { Data: MESSAGE.html, Charset: 'UTF-8' } } } },
    })
  })
})

describe('azure_communication provider', () => {
  it('sends with a connection string and bare addresses', async () => {
    acsBeginSend.mockResolvedValueOnce({ pollUntilDone: async () => ({ id: 'acs-1', status: 'Succeeded' }) })
    const result = await createAzureCommunicationTransport({ acs_connection_string: 'endpoint=https://x.communication.azure.com/;accesskey=abc' }).send(MESSAGE)
    expect(result.id).toBe('acs-1')
    expect(acsCtor).toHaveBeenCalledWith('endpoint=https://x.communication.azure.com/;accesskey=abc')
    expect(acsBeginSend.mock.calls[0][0]).toMatchObject({
      senderAddress: 'noreply@example.com',
      recipients: { to: [{ address: 'ada@example.com' }, { address: 'bob@example.com', displayName: 'Bob' }] },
      replyTo: [{ address: 'support@example.com' }],
    })
  })

  it('uses Entra ID with only an endpoint, and reports failures', async () => {
    acsBeginSend.mockResolvedValueOnce({ pollUntilDone: async () => ({ id: 'acs-2', status: 'Failed', error: { message: 'Domain not verified' } }) })
    await expect(createAzureCommunicationTransport({ acs_endpoint: 'https://mi.communication.azure.com' }).send(MESSAGE)).rejects.toThrow(/Domain not verified/)
    expect(acsCtor.mock.calls.at(-1)?.[0]).toBe('https://mi.communication.azure.com')
    expect(acsCtor.mock.calls.at(-1)?.[1]).toBeDefined() // a TokenCredential
    await expect(createAzureCommunicationTransport({}).send(MESSAGE)).rejects.toThrow(/ACS_EMAIL_CONNECTION_STRING/)
  })
})

describe('microsoft_graph provider', () => {
  it('posts sendMail as the sender mailbox with an app token', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202, headers: { 'request-id': 'graph-1' } }))
    const transport = createMicrosoftGraphTransport({ graph_tenant_id: 't', graph_client_id: 'c', graph_client_secret: 's', graph_sender: 'mailer@corp.example' }, fetchMock as unknown as typeof fetch)
    const { ClientSecretCredential } = await import('@azure/identity')
    const tokenSpy = vi.spyOn(ClientSecretCredential.prototype, 'getToken').mockResolvedValue({ token: 'graph-token', expiresOnTimestamp: Date.now() + 3600_000 })
    expect((await transport.send(MESSAGE)).id).toBe('graph-1')
    expect(tokenSpy).toHaveBeenCalledWith('https://graph.microsoft.com/.default')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://graph.microsoft.com/v1.0/users/mailer%40corp.example/sendMail')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer graph-token')
    const body = JSON.parse(String(init.body))
    expect(body.saveToSentItems).toBe(false)
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: 'ada@example.com' } }, { emailAddress: { address: 'bob@example.com', name: 'Bob' } }])
    expect(body.message.from).toEqual({ emailAddress: { address: 'noreply@example.com', name: 'UserTasks' } })
    tokenSpy.mockRestore()
  })

  it('surfaces Graph errors', async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } }, { status: 403 }))
    const { ClientSecretCredential } = await import('@azure/identity')
    const tokenSpy = vi.spyOn(ClientSecretCredential.prototype, 'getToken').mockResolvedValue({ token: 't', expiresOnTimestamp: Date.now() + 3600_000 })
    await expect(createMicrosoftGraphTransport({ graph_tenant_id: 't', graph_client_id: 'c', graph_client_secret: 's2' }, fetchMock as unknown as typeof fetch).send(MESSAGE))
      .rejects.toThrow(/403 ErrorAccessDenied/)
    tokenSpy.mockRestore()
  })
})

describe('gmail provider', () => {
  it('impersonates the sender with a service-account key and sends a raw MIME message', async () => {
    const { JWT } = await import('google-auth-library')
    const tokenSpy = vi.spyOn(JWT.prototype, 'getAccessToken').mockResolvedValue({ token: 'gmail-token' } as never)
    const fetchMock = vi.fn(async () => Response.json({ id: 'gmail-1' }))
    const key = JSON.stringify({ client_email: 'mailer@proj.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n' })
    const result = await createGmailTransport({ gmail_service_account_json: key, gmail_sender: 'noreply@corp.example' }, fetchMock as unknown as typeof fetch).send(MESSAGE)
    expect(result.id).toBe('gmail-1')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/noreply%40corp.example/messages/send')
    const raw = Buffer.from(JSON.parse(String(init.body)).raw, 'base64url').toString('utf8')
    expect(raw).toContain('To: ada@example.com, "Bob" <bob@example.com>')
    expect(raw).toContain('Subject: =?UTF-8?B?')
    tokenSpy.mockRestore()
    await expect(createGmailTransport({ gmail_service_account_json: '{nope' }).send(MESSAGE)).rejects.toThrow(/not valid JSON/)
  })
})

describe('resend provider', () => {
  it('sends through the Resend API and keeps the old "not configured" message', async () => {
    resendSend.mockResolvedValueOnce({ data: { id: 're_1' }, error: null })
    expect((await createResendTransport({ resend_api_key: 're_key' }).send(MESSAGE)).id).toBe('re_1')
    expect(resendSend.mock.calls[0][0]).toMatchObject({ from: MESSAGE.from, to: MESSAGE.to, html: MESSAGE.html, replyTo: 'support@example.com' })
    await expect(createResendTransport({}).send(MESSAGE)).rejects.toThrow('Email service not configured. Set RESEND_API_KEY in .env.local')
  })
})

describe('console provider', () => {
  let dir: string
  beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), 'ut-email-')) })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

  it('logs recipients and subject only, and writes an .eml file', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await createConsoleTransport({ console_dir: dir }).send(MESSAGE)
    const files = await readdir(dir)
    expect(files).toHaveLength(1)
    const eml = await readFile(path.join(dir, files[0]), 'utf8')
    expect(eml).toContain('From: "UserTasks" <noreply@example.com>')
    expect(eml).toContain(Buffer.from(MESSAGE.html).toString('base64').slice(0, 40))
    expect(JSON.stringify(log.mock.calls)).not.toContain('Hello')
    log.mockRestore()
  })
})

// ── lib/email.ts routing ─────────────────────────────────────────────────────

describe('sendEmail routes every message through the configured provider', () => {
  const ORIGINAL = { ...process.env }
  let dir: string
  beforeEach(async () => {
    vi.resetModules()
    dir = await mkdtemp(path.join(tmpdir(), 'ut-email-route-'))
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'EMAIL_FROM', 'EMAIL_REPLY_TO', 'RESEND_API_KEY', 'EMAIL_PROVIDER']) delete process.env[key]
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(async () => {
    process.env = { ...ORIGINAL }
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  it('applies EMAIL_FROM / EMAIL_REPLY_TO defaults; explicit values win', async () => {
    process.env.EMAIL_PROVIDER = 'console'
    process.env.EMAIL_CONSOLE_DIR = dir
    process.env.EMAIL_FROM = 'Acme Tasks <tasks@acme.example>'
    process.env.EMAIL_REPLY_TO = 'help@acme.example'
    const { sendEmail } = await import('@/lib/email')
    expect(await sendEmail({ to: 'a@example.com', subject: 'One', body: '<p>1</p>' })).toMatchObject({ success: true })
    expect(await sendEmail({ to: ['b@example.com'], subject: 'Two', body: '<p>2</p>', from: 'Other <o@example.com>', replyTo: 'r@example.com' })).toMatchObject({ success: true })
    const emls = await Promise.all((await readdir(dir)).sort().map((f) => readFile(path.join(dir, f), 'utf8')))
    const one = emls.find((e) => e.includes('Subject: One'))!
    const two = emls.find((e) => e.includes('Subject: Two'))!
    expect(one).toContain('From: "Acme Tasks" <tasks@acme.example>')
    expect(one).toContain('Reply-To: help@acme.example')
    expect(two).toContain('From: "Other" <o@example.com>')
    expect(two).toContain('Reply-To: r@example.com')
  })

  it('invitations go through the provider', async () => {
    process.env.EMAIL_PROVIDER = 'console'
    process.env.EMAIL_CONSOLE_DIR = dir
    const { sendInvitationEmail } = await import('@/lib/invitations')
    const result = await sendInvitationEmail({ to: 'new@example.com', tenantName: 'Acme', tenantSlug: 'acme', inviterName: 'Ada', role: 'member', token: 'tok123' })
    expect(result.success).toBe(true)
    const [file] = await readdir(dir)
    expect(await readFile(path.join(dir, file), 'utf8')).toContain('To: new@example.com')
  })

  it('reports misconfiguration instead of throwing', async () => {
    process.env.EMAIL_PROVIDER = 'smtp'
    process.env.SMTP_HOST = '127.0.0.1'
    const { sendEmail } = await import('@/lib/email')
    expect(await sendEmail({ to: 'a@example.com', subject: 's', body: 'b' })).toEqual({
      success: false, error: 'Email service not configured. Set EMAIL_FROM for the smtp email provider',
    })
    delete process.env.EMAIL_PROVIDER
    expect(await sendEmail({ to: 'a@example.com', subject: 's', body: 'b' })).toEqual({
      success: false, error: 'Email service not configured. Set RESEND_API_KEY in .env.local',
    })
  })

  it('resolves secret:// references in email options (SMTP password from the secret store)', async () => {
    const smtp = await startSmtp({ auth: true })
    try {
      Object.assign(process.env, {
        EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'n@example.com', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port),
        SMTP_STARTTLS: 'required', SMTP_TLS_REJECT_UNAUTHORIZED: 'false', SMTP_USER: 'relay-user',
        SMTP_PASSWORD: 'secret://relay_password', RELAY_PASSWORD: 'relay-pass',
      })
      const { sendEmail } = await import('@/lib/email')
      expect(await sendEmail({ to: 'a@example.com', subject: 'via ref', body: 'b' })).toMatchObject({ success: true })
      expect(smtp.received[0].user).toBe('relay-user')
    } finally {
      const { closeSmtpTransports: close } = await import('@/lib/providers/email/smtp')
      close()
      await smtp.close()
    }
  })
})

// ── Attachments (workflow Send Email) ────────────────────────────────────────

describe('attachments', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7\nhello\n%%EOF')
  const WITH_FILES: EmailMessage = {
    ...MESSAGE,
    attachments: [
      { filename: 'taxi receipt.pdf', contentType: 'application/pdf', content: pdf },
      { filename: 'Résumé "v2".png', contentType: 'image/png', content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
    ],
  }

  it('MIME: multipart/mixed around the alternative, base64 parts, RFC 2231 names, no header injection', () => {
    const raw = buildMimeMessage({ ...WITH_FILES, attachments: [...WITH_FILES.attachments!, { filename: 'x.txt\r\nBcc: evil@x', contentType: 'text/plain\r\nX: y', content: new Uint8Array([65]) }] })
    expect(raw).toMatch(/^Content-Type: multipart\/mixed; boundary="=_ut_mixed_/m)
    expect(raw).toMatch(/Content-Type: multipart\/alternative; boundary=/)
    expect(raw).toContain('Content-Disposition: attachment; filename="taxi receipt.pdf"')
    expect(raw).toContain(`filename*=UTF-8''${encodeURIComponent('Résumé _v2_.png')}`)
    expect(raw).toContain(Buffer.from(pdf).toString('base64'))
    expect(raw).not.toMatch(/^Bcc:/m)
    expect(raw).not.toMatch(/^X: y/m)
    // Without attachments the message is unchanged (multipart/alternative only).
    expect(buildMimeMessage(MESSAGE)).not.toMatch(/multipart\/mixed/)
  })

  it('each provider sends the files', async () => {
    resendSend.mockResolvedValueOnce({ data: { id: 'r1' }, error: null })
    await createResendTransport({ resend_api_key: 're_test' }).send(WITH_FILES)
    expect(resendSend.mock.calls.at(-1)?.[0].attachments).toEqual([
      { filename: 'taxi receipt.pdf', content: Buffer.from(pdf), contentType: 'application/pdf' },
      expect.objectContaining({ filename: 'Résumé "v2".png', contentType: 'image/png' }),
    ])

    sesSend.mockResolvedValueOnce({ MessageId: 'ses-2' })
    await createSesTransport({ ses_region: 'eu-west-1' }).send(WITH_FILES)
    const raw = new TextDecoder().decode(sesSend.mock.calls.at(-1)?.[0].input.Content.Raw.Data)
    expect(raw).toContain('filename="taxi receipt.pdf"')

    acsBeginSend.mockResolvedValueOnce({ pollUntilDone: async () => ({ id: 'acs-2', status: 'Succeeded' }) })
    await createAzureCommunicationTransport({ acs_connection_string: 'endpoint=https://x;accesskey=y' }).send(WITH_FILES)
    expect(acsBeginSend.mock.calls.at(-1)?.[0].attachments[0]).toEqual({ name: 'taxi receipt.pdf', contentType: 'application/pdf', contentInBase64: Buffer.from(pdf).toString('base64') })

    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
    const { ClientSecretCredential } = await import('@azure/identity')
    const tokenSpy = vi.spyOn(ClientSecretCredential.prototype, 'getToken').mockResolvedValue({ token: 't', expiresOnTimestamp: Date.now() + 3600_000 })
    await createMicrosoftGraphTransport({ graph_tenant_id: 't', graph_client_id: 'c', graph_client_secret: 's3' }, fetchMock as unknown as typeof fetch).send(WITH_FILES)
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body.message.attachments[0]).toEqual({ '@odata.type': '#microsoft.graph.fileAttachment', name: 'taxi receipt.pdf', contentType: 'application/pdf', contentBytes: Buffer.from(pdf).toString('base64') })
    tokenSpy.mockRestore()
  })

  it('SMTP delivers the files', async () => {
    const smtp = await startSmtp({ disableStartTls: true })
    try {
      await createSmtpTransport({ smtp_host: '127.0.0.1', smtp_port: String(smtp.port), smtp_starttls: 'off' }).send(WITH_FILES)
      expect(smtp.received[0].raw).toMatch(/filename="?taxi receipt\.pdf"?/)
      expect(smtp.received[0].raw.replace(/\r?\n/g, '')).toContain(Buffer.from(pdf).toString('base64'))
    } finally {
      await smtp.close()
      closeSmtpTransports()
    }
  })
})
