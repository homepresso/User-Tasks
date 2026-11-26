/**
 * /x/<id>/… for an instance-wide extension (the Infrastructure add-on):
 * licensed per deployment and never enabled per workspace, its
 * instance-admin page opens without a workspace enablement while the
 * instance-wide licence allows it — and stays not found for everyone else,
 * without the licence, or for any other extension.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'

const state = vi.hoisted(() => ({ instanceAdmin: true, workspaceUsable: false }))

vi.mock('next/navigation', () => ({ unstable_rethrow: () => undefined }))
vi.mock('@/lib/services/context', () => ({ fromSession: async () => ({ tenantId: 't-1', actorId: 'u-1', permissions: [], supabase: {} }) }))
vi.mock('@/lib/extensions/host', () => ({ createExtensionContext: () => ({}) }))
vi.mock('@/lib/extensions/state', () => ({ extensionAccess: async () => ({ usable: state.workspaceUsable }) }))
vi.mock('@/lib/extensions/ui-server', () => ({
  extensionUiEntries: async () => (state.workspaceUsable ? [{ id: 'infrastructure', name: 'Infrastructure', version: '0.1.0', licence: 'licensed', features: [], config: {} }] : []),
  isInstanceAdminSession: async () => state.instanceAdmin,
}))
const manifest = (id: string, when?: Record<string, unknown>) => ({ id, name: id, version: '0.1.0', contributes: { ui: { pages: [{ path: '', title: 'Page', ...(when ? { when } : {}) }] } } })
vi.mock('@/lib/extensions/registry', () => ({
  hasExtensions: () => true,
  getExtensionManifest: (id: string) => (id === 'infrastructure' ? manifest(id, { instanceAdmin: true }) : id === 'other' ? manifest(id, { instanceAdmin: true }) : null),
}))
vi.mock('@/lib/extensions/pages', () => ({ extensionPage: () => function Page() { return createElement('p', null, 'the page') } }))

const { renderExtensionPageResult } = await import('@/lib/extensions/page-host')
const { __setInfrastructureAddonForTests } = await import('@/lib/infrastructure/provider')

const READY = { state: 'ready' as const, warning: null, resolved: { extensionId: 'infrastructure', provider: { feature: 'infrastructure-separation', href: '/x/infrastructure', actions: {} }, ctx: {} as never } }

describe('instance-wide extension pages', () => {
  beforeEach(() => { state.instanceAdmin = true; state.workspaceUsable = false })
  afterEach(() => __setInfrastructureAddonForTests(undefined))

  it('the licensed add-on page opens for an instance admin without a workspace enablement', async () => {
    __setInfrastructureAddonForTests(READY)
    expect((await renderExtensionPageResult('infrastructure', [], {})).kind).toBe('page')
  })

  it('not found for someone who is not an instance admin', async () => {
    __setInfrastructureAddonForTests(READY)
    state.instanceAdmin = false
    expect((await renderExtensionPageResult('infrastructure', [], {})).kind).toBe('not_found')
  })

  it('not found without a usable licence', async () => {
    __setInfrastructureAddonForTests({ state: 'unlicensed', extensionId: 'infrastructure', href: '/x/infrastructure', reason: 'not licensed' })
    expect((await renderExtensionPageResult('infrastructure', [], {})).kind).toBe('not_found')
    __setInfrastructureAddonForTests({ state: 'missing', reason: 'missing' })
    expect((await renderExtensionPageResult('infrastructure', [], {})).kind).toBe('not_found')
  })

  it('other extensions still need the workspace enablement', async () => {
    __setInfrastructureAddonForTests(READY)
    expect((await renderExtensionPageResult('other', [], {})).kind).toBe('not_found')
  })
})
