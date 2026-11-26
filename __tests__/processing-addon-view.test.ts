/**
 * processingAddonView (Settings → Infrastructure → Processing, the setup
 * wizard): the Processing add-on is missing from a build without it,
 * "unlicensed" (with the licensing layer's reason) when installed without a
 * usable licence — including 24 hours after expiry — and "ready" with the
 * expiry warning while an expired licence is still inside those 24 hours.
 * The licence is instance-wide (tenantId null) for the provider's feature.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineExtension, defineServerExtension } from '@/lib/extensions/sdk'
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'
import { setEntitlementPort } from '@/lib/extensions/entitlement-port'
import { processingAddonView } from '@/lib/processing/addon'

const manifest = {
  manifest_version: 1, id: 'processing', name: 'Processing workers', version: '0.1.0',
  publisher: { id: 'usertasks', name: 'UserTasks' },
  engines: { usertasks: '>=0.1.0 <9.0.0', extension_sdk: '^1.3.0' },
  licence: { tier: 'paid', sku: 'processing-tier', features: ['processing'] },
  deployments: ['self_hosted'],
} as const

function register() {
  registerExtensionsForTest({
    definitions: [defineExtension({ manifest: manifest as any })],
    servers: [defineServerExtension({ id: 'processing', processing: { feature: 'processing', handoff: async () => 'queue' } })],
  })
}

const saved = process.env.DEPLOYMENT_MODE
afterEach(() => {
  resetExtensionsForTest()
  if (saved === undefined) delete process.env.DEPLOYMENT_MODE
  else process.env.DEPLOYMENT_MODE = saved
})

describe('processingAddonView', () => {
  it('missing without the extension in the build', async () => {
    registerExtensionsForTest({ definitions: [] })
    expect(await processingAddonView()).toMatchObject({ state: 'missing', extensionId: null })
  })

  it('unlicensed (with the reason) when installed without a usable licence, asked instance-wide for the feature', async () => {
    process.env.DEPLOYMENT_MODE = 'self_hosted'
    register()
    const check = vi.fn(async () => ({ allowed: false, state: 'expired' as const, reason: 'The licence for processing expired and the extension stopped 24 hours after expiry.' }))
    setEntitlementPort({ check })
    expect(await processingAddonView()).toEqual({ state: 'unlicensed', extensionId: 'processing', reason: expect.stringContaining('24 hours after expiry') })
    expect(check).toHaveBeenCalledWith({ tenantId: null, extensionId: 'processing', feature: 'processing' })
  })

  it('ready, with the warning while an expired licence is inside its 24 hours', async () => {
    process.env.DEPLOYMENT_MODE = 'self_hosted'
    register()
    setEntitlementPort({ check: async () => ({ allowed: true, state: 'licensed' as const }) })
    expect(await processingAddonView()).toEqual({ state: 'ready', extensionId: 'processing', reason: null })
    setEntitlementPort({ check: async () => ({ allowed: true, state: 'licensed' as const, reason: 'The licence for processing expired at 2026-11-20; the extension stops at 2026-11-21 (24 hours after expiry). Renew the licence now.' }) })
    expect(await processingAddonView()).toMatchObject({ state: 'ready', reason: expect.stringContaining('stops at') })
  })
})
