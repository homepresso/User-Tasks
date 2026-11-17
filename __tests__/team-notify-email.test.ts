import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendEmail = vi.fn()
vi.mock('@/lib/email', () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }))

import { contactDeliveryConfigured, deliverChirp, teamEmailBody, teamNotifyEmails } from '@/lib/contact/chirpme'

const message = {
  title: 'New UserTasks contact — Jordan Ellis',
  body: 'Jordan Ellis from Northwind Traders (jordan@northwind.example) sent a website enquiry.',
  url: 'https://usertasks.com/contact',
  detail: '<h2>New website enquiry</h2><p><strong>Name:</strong> Jordan Ellis</p>',
  replyTo: 'jordan@northwind.example',
}

beforeEach(() => {
  sendEmail.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('team notifications: ChirpMe and the team inbox', () => {
  it('sends to ChirpMe and emails TEAM_NOTIFY_EMAIL with the sender as Reply-To', async () => {
    vi.stubEnv('CHIRPME_API_KEY', 'test-key')
    vi.stubEnv('CHIRPME_CHANNEL_ID', 'test-channel')
    vi.stubEnv('TEAM_NOTIFY_EMAIL', 'support@usertasks.com')
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    sendEmail.mockResolvedValue({ success: true, id: 'e1' })

    expect(await deliverChirp(message)).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(sendEmail).toHaveBeenCalledOnce()
    const params = sendEmail.mock.calls[0][0]
    expect(params.to).toEqual(['support@usertasks.com'])
    expect(params.subject).toBe(message.title)
    expect(params.replyTo).toBe('jordan@northwind.example')
    expect(params.body).toContain('<h2>New website enquiry</h2>')
  })

  it('counts as delivered when only one channel works', async () => {
    vi.stubEnv('CHIRPME_API_KEY', 'test-key')
    vi.stubEnv('CHIRPME_CHANNEL_ID', 'test-channel')
    vi.stubEnv('TEAM_NOTIFY_EMAIL', 'support@usertasks.com')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })))
    sendEmail.mockResolvedValue({ success: true })
    expect(await deliverChirp(message)).toEqual({ ok: true })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    sendEmail.mockResolvedValue({ success: false, error: 'down' })
    expect(await deliverChirp(message)).toEqual({ ok: true })
  })

  it('fails only when every configured channel fails', async () => {
    vi.stubEnv('CHIRPME_API_KEY', 'test-key')
    vi.stubEnv('CHIRPME_CHANNEL_ID', 'test-channel')
    vi.stubEnv('TEAM_NOTIFY_EMAIL', 'support@usertasks.com')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 502 })))
    sendEmail.mockResolvedValue({ success: false, error: 'down' })
    expect(await deliverChirp(message)).toMatchObject({ ok: false, reason: 'failed' })
  })

  it('works with email alone, and with neither reports unconfigured', async () => {
    vi.stubEnv('CHIRPME_API_KEY', '')
    vi.stubEnv('CHIRPME_CHANNEL_ID', '')
    vi.stubEnv('TEAM_NOTIFY_EMAIL', 'support@usertasks.com, ops@usertasks.com')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    sendEmail.mockResolvedValue({ success: true })
    expect(contactDeliveryConfigured()).toBe(true)
    expect(teamNotifyEmails()).toEqual(['support@usertasks.com', 'ops@usertasks.com'])
    expect(await deliverChirp(message)).toEqual({ ok: true })
    expect(fetchMock).not.toHaveBeenCalled()

    vi.stubEnv('TEAM_NOTIFY_EMAIL', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(contactDeliveryConfigured()).toBe(false)
    expect(await deliverChirp(message)).toEqual({ ok: false, reason: 'unconfigured' })
  })

  it('does not email when TEAM_NOTIFY_EMAIL is unset (self-hosted default)', async () => {
    vi.stubEnv('CHIRPME_API_KEY', 'test-key')
    vi.stubEnv('CHIRPME_CHANNEL_ID', 'test-channel')
    vi.stubEnv('TEAM_NOTIFY_EMAIL', '')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    expect(await deliverChirp(message)).toEqual({ ok: true })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('escapes the summary line and link in the email body', () => {
    const html = teamEmailBody({ ...message, body: 'A <b>bold</b> claim', url: 'https://usertasks.com/x?a=1&b="2"' })
    expect(html).toContain('A &lt;b&gt;bold&lt;/b&gt; claim')
    expect(html).toContain('a=1&amp;b=&quot;2&quot;')
  })
})
