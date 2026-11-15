import { afterEach, describe, expect, it, vi } from 'vitest'

describe('egress guard for the setup wizard and infrastructure tests', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

  it('blocks loopback, private and metadata hosts with the allowlist entry that would allow them', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'self_hosted')
    vi.stubEnv('EGRESS_PRIVATE_ALLOW', '')
    vi.stubEnv('ALLOW_PRIVATE_EGRESS', '')
    const { checkHostsAllowed, blockedMessage, withAllowEntry } = await import('@/lib/install/egress-server')
    const loop = await checkHostsAllowed(['127.0.0.1'])
    expect(loop).toMatchObject({ ok: false, host: '127.0.0.1', allowEntry: '127.0.0.1/32' })
    const priv = await checkHostsAllowed(['10.1.2.3'])
    expect(priv).toMatchObject({ ok: false, allowEntry: '10.1.2.3' })
    const meta = await checkHostsAllowed(['169.254.169.254'])
    expect(meta).toMatchObject({ ok: false, allowEntry: null })
    if (!loop.ok) expect(blockedMessage(loop)).toMatch(/usertasks-admin egress allow-private 127\.0\.0\.1\/32/)
    expect(await checkHostsAllowed(['93.184.216.34'])).toEqual({ ok: true })
    expect(withAllowEntry(['mail.internal'], '127.0.0.1/32')).toEqual(['mail.internal', '127.0.0.1/32'])
  })

  it('an allowlisted CIDR lets the host through; ::1 is suggested separately when it is the refused address', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'self_hosted')
    vi.stubEnv('EGRESS_PRIVATE_ALLOW', '127.0.0.1/32')
    const { checkHostsAllowed } = await import('@/lib/install/egress-server')
    expect(await checkHostsAllowed(['127.0.0.1'])).toEqual({ ok: true })
    const v6 = await checkHostsAllowed(['::1'])
    expect(v6).toMatchObject({ ok: false, allowEntry: '::1/128' })
  })

  it('cloud edition: nothing private is allowable', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    const { checkHostsAllowed } = await import('@/lib/install/egress-server')
    expect(await checkHostsAllowed(['10.0.0.1'])).toMatchObject({ ok: false, allowEntry: null })
  })
})
