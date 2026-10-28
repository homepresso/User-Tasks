import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { assertCloudRoute, getDeploymentMode, isCloud, publicBaseUrl, publicCta } from '@/lib/deployment'
import robots from '@/app/robots'
import sitemap from '@/app/sitemap'
import { POST as contactPost } from '@/app/api/contact/route'
import { betaSignup } from '@/app/actions/beta-signup'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('deployment mode', () => {
  it('defaults to self_hosted when DEPLOYMENT_MODE is unset or unknown', () => {
    vi.stubEnv('DEPLOYMENT_MODE', '')
    expect(getDeploymentMode()).toBe('self_hosted')
    expect(isCloud()).toBe(false)
    vi.stubEnv('DEPLOYMENT_MODE', 'saas')
    expect(getDeploymentMode()).toBe('self_hosted')
  })

  it('recognises cloud case-insensitively', () => {
    vi.stubEnv('DEPLOYMENT_MODE', ' Cloud ')
    expect(getDeploymentMode()).toBe('cloud')
    expect(isCloud()).toBe(true)
  })

  it('derives the public base URL from NEXT_PUBLIC_APP_URL, falling back per mode', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://workflows.example.com/')
    expect(publicBaseUrl()).toBe('https://workflows.example.com')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    expect(publicBaseUrl()).toBe('https://usertasks.com')
    vi.stubEnv('DEPLOYMENT_MODE', 'self_hosted')
    expect(publicBaseUrl()).toBe('http://localhost:3000')
  })

  it('404s cloud-only routes when self-hosted', () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'self_hosted')
    expect(() => assertCloudRoute()).toThrow()
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    expect(() => assertCloudRoute()).not.toThrow()
  })

  it('points docs CTAs at sign-in on both editions', () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'self_hosted')
    expect(publicCta()).toEqual({ href: '/login', label: 'Sign in' })
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    expect(publicCta()).toEqual({ href: '/login', label: 'Sign in' })
  })
})

describe('self-hosted public surface', () => {
  it('disallows all crawling and publishes no sitemap', () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'self_hosted')
    const config = robots()
    expect(config.sitemap).toBeUndefined()
    const rules = Array.isArray(config.rules) ? config.rules : [config.rules]
    expect(rules).toEqual([{ userAgent: '*', disallow: '/' }])
    expect(sitemap()).toEqual([])
  })

  it('rejects contact submissions without contacting the delivery service', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'self_hosted')
    vi.stubEnv('CHIRPME_API_KEY', 'server-only-test-key')
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const response = await contactPost(new NextRequest('http://localhost:3000/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada', email: 'ada@example.com', company: 'Example', comments: 'Hello from a self-hosted deployment.' }),
    }))
    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('disables self-signup', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'self_hosted')
    const result = await betaSignup({ fullName: 'Ada', email: 'ada@example.com', password: 'long-enough', company: 'Example' })
    expect(result).toEqual({ ok: false, error: 'Self-signup is disabled on this deployment' })
  })
})
