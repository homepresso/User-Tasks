/**
 * /api/health (liveness, no dependencies) and /api/ready (readiness: the
 * database answers). Before, the only probe was /api/config/public, which
 * answered 200 with Postgres stopped (instance settings errors are swallowed),
 * so Compose / Kubernetes kept routing traffic to replicas that failed every
 * request.
 */
import { describe, expect, it, vi } from 'vitest'
import { checkReadiness } from '@/lib/health'

describe('checkReadiness', () => {
  it('ready when the probe answers', async () => {
    expect(await checkReadiness(async () => ({ error: null }))).toEqual({ ready: true, checks: { database: 'ok' } })
  })

  it('unavailable on an error, a throw or a timeout; never echoes error text', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await checkReadiness(async () => ({ error: { message: 'connect ECONNREFUSED 10.0.0.5:5432' } }))).toEqual({ ready: false, checks: { database: 'unavailable' } })
    expect(await checkReadiness(async () => { throw new Error('boom') })).toEqual({ ready: false, checks: { database: 'unavailable' } })
    expect(await checkReadiness(() => new Promise(() => undefined), 20)).toEqual({ ready: false, checks: { database: 'unavailable' } })
  })

  it('not configured without a database client', async () => {
    expect(await checkReadiness(null)).toEqual({ ready: false, checks: { database: 'not_configured' } })
  })
})

describe('routes', () => {
  it('/api/health answers 200 without touching the database', async () => {
    const { GET } = await import('@/app/api/health/route')
    const res = GET()
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('ok')
  })

  it('/api/ready maps readiness to 200 / 503', async () => {
    vi.resetModules()
    vi.doMock('@/lib/health', () => ({ checkReadiness: async () => ({ ready: false, checks: { database: 'unavailable' } }) }))
    const { GET } = await import('@/app/api/ready/route')
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ status: 'unavailable', checks: { database: 'unavailable' } })
    vi.doUnmock('@/lib/health')
  })
})
