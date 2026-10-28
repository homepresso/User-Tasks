import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/contact/route'

beforeEach(() => {
  vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('public contact delivery', () => {
  it('delivers a validated, escaped ChirpMe notification server-side', async () => {
    vi.stubEnv('CHIRPME_API_KEY', 'server-only-test-key')
    vi.stubEnv('CHIRPME_CHANNEL_ID', 'test-channel-id')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const request = new NextRequest('https://usertasks.com/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.41' },
      body: JSON.stringify({ name: 'Ada <Admin>', email: 'ada@example.com', company: 'Example & Co', comments: 'We need an on-premises workflow assessment.', website: '' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://chirpme.app/api/send')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer server-only-test-key')
    const payload = JSON.parse(String(init?.body))
    expect(payload.channelId).toBe('test-channel-id')
    expect(payload.detail).toContain('Ada &lt;Admin&gt;')
    expect(payload.detail).toContain('Example &amp; Co')
    expect(payload.detail).not.toContain('Ada <Admin>')
  })

  it('rejects honeypot and incomplete submissions before contacting ChirpMe', async () => {
    vi.stubEnv('CHIRPME_API_KEY', 'server-only-test-key')
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const request = new NextRequest('https://usertasks.com/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.42' },
      body: JSON.stringify({ name: 'Bot User', email: 'bot@example.com', company: 'Bots Inc', comments: 'This should not be delivered.', website: 'spam.example' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is unavailable without a configured ChirpMe channel', async () => {
    vi.stubEnv('CHIRPME_API_KEY', 'server-only-test-key')
    vi.stubEnv('CHIRPME_CHANNEL_ID', '')
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const request = new NextRequest('https://usertasks.com/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.43' },
      body: JSON.stringify({ name: 'Ada', email: 'ada@example.com', company: 'Example', comments: 'Please get in touch about pricing.', website: '' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
