/**
 * Okta directory sync: the org URL is tenant-supplied (any workspace admin, in
 * the cloud any self-signup owner), so the client must not become an SSRF
 * primitive: https only, egress guard on every request, no redirects, and
 * paging links (rel="next", chosen by the remote server) stay on the org URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOktaClient } from '@/lib/directory-sync/okta'

const fetchMock = vi.fn()
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset() })
afterEach(() => vi.unstubAllGlobals())

const res = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body })

describe('Okta client egress', () => {
  it('refuses a plain-http org URL before any request', async () => {
    await expect(createOktaClient({ orgUrl: 'http://acme.okta.com', apiToken: 't' }).verify()).rejects.toThrow(/https/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses internal / metadata addresses (egress guard)', async () => {
    for (const orgUrl of ['https://169.254.169.254', 'https://127.0.0.1:8080', 'https://10.0.0.5']) {
      await expect(createOktaClient({ orgUrl, apiToken: 't' }).verify()).rejects.toThrow()
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not follow a paging link to another origin', async () => {
    const client = createOktaClient({ orgUrl: 'https://8.8.8.8', apiToken: 't' })
    fetchMock.mockResolvedValueOnce(res([{ id: 'u1', profile: { email: 'a@x.test' } }], 200, { link: '<http://10.0.0.5:8080/admin.json>; rel="next"' }))
    await expect(client.listUsers()).rejects.toThrow(/left the org URL/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not follow redirects', async () => {
    const client = createOktaClient({ orgUrl: 'https://8.8.8.8', apiToken: 't' })
    fetchMock.mockResolvedValueOnce(res(null, 302, { location: 'http://169.254.169.254/latest/meta-data/' }))
    await expect(client.verify()).rejects.toThrow(/redirect/)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })
})
