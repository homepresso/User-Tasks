import { afterEach, describe, expect, it, vi } from 'vitest'
import { betaSignupChirp, notifyBetaSignup } from '@/lib/contact/beta-signup-chirp'
import { readFileSync } from 'node:fs'

describe('beta signup ChirpMe notification', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it('names the person and company, escapes values and leaves out empty fields', () => {
    const m = betaSignupChirp({ fullName: 'Ana <b>', email: 'ana@example.com', company: 'Acme & Co', useCase: 'Expense approvals\nin USD', slug: 'acme' }, 'https://usertasks.com')
    expect(m.title).toBe('New beta signup — Acme & Co')
    expect(m.body).toContain('ana@example.com')
    expect(m.detail).toContain('Ana &lt;b&gt;')
    expect(m.detail).toContain('Acme &amp; Co')
    expect(m.detail).toContain('Expense approvals<br>in USD')
    expect(m.detail).not.toContain('Company size')
    expect(m.url).toBe('https://usertasks.com/start')
    expect(m.subTab).toBe('Signups')
  })

  it('sends nothing when ChirpMe is not configured', async () => {
    vi.stubEnv('CHIRPME_API_KEY', '')
    vi.stubEnv('CHIRPME_CHANNEL_ID', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await notifyBetaSignup({ fullName: 'A', email: 'a@example.com', company: 'B' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts to ChirpMe when configured, and never throws on failure', async () => {
    vi.stubEnv('CHIRPME_API_KEY', 'k')
    vi.stubEnv('CHIRPME_CHANNEL_ID', 'c')
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'))
    vi.stubGlobal('fetch', fetchMock)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(notifyBetaSignup({ fullName: 'A', email: 'a@example.com', company: 'B' })).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.title).toBe('New beta signup — B')
    expect(JSON.stringify(body)).not.toMatch(/password/i)
    err.mockRestore()
  })

  it('the signup action notifies only after a successful signup, via after()', () => {
    const src = readFileSync('app/actions/beta-signup.ts', 'utf8')
    expect(src).toMatch(/if \(result\.ok\) \{\s*\/\/[^\n]*\n\s*after\(\(\) => notifyBetaSignup\(/)
    expect(src).not.toMatch(/notifyBetaSignup\([^)]*password/)
  })
})
