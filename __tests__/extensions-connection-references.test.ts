/**
 * Extension-provided connection references (ServerExtension.connectionReferences):
 * ids, rows for the References list, listing gated on the licence and never
 * breaking the page, and running from the Test dialog — the connector check,
 * write confirmation, the destructive `confirm` input, the caller's
 * permissions reaching the extension, and error mapping.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000 })

const state = vi.hoisted(() => ({ usable: true, provider: null as any }))
vi.mock('@/lib/extensions/server-registry', () => ({
  getServerExtension: (id: string) => (id === 'acme' ? { id: 'acme', connectionReferences: state.provider } : undefined),
}))
vi.mock('@/lib/extensions/state', () => ({
  extensionAccess: async () => (state.usable ? { usable: true, status: 200 } : { usable: false, status: 402, code: 'extension_unlicensed', reason: 'Not licensed' }),
}))
vi.mock('@/lib/extensions/host', () => ({ createExtensionContext: (o: any) => ({ tenantId: o.tenantId, can: (p: string) => o.permissions == null || o.permissions.has(p) }) }))

import { ExtensionError } from '@/lib/extensions/sdk'
import { extensionOfIntegrationType, extensionReferenceId, extensionReferencesFor, methodAsReference, parseExtensionReferenceId, runExtensionReference } from '@/lib/extensions/connection-references'

const caller = { tenantId: 't1', actorId: 'u1', db: {}, permissions: new Set(['integrations.test', 'ext.acme.read']) }
const integration = { id: 'i1', type: 'ext.acme.server' }
const methods = [
  { id: 'list-1/items.get', name: 'Requests · Get item', group: 'Requests · Items', method: 'GET' as const, path: '/lists/1/items/{item_id}', inputs: [{ name: 'item_id', type: 'integer', required: true, default_value: '3' }], writes: false },
  { id: 'list-1/items.create', name: 'Requests · Create item', method: 'POST' as const, path: '/lists/1/items', inputs: [{ name: 'fields', type: 'object', default_value: '{"Title":"x"}' }], writes: true },
  { id: 'list-1/recycle_bin.empty', name: 'Requests · Empty bin', method: 'POST' as const, path: '/lists/1/recycle-bin/empty', inputs: [{ name: 'confirm', type: 'boolean', required: true }], writes: true, destructive: true, access: 'manage' as const },
]

beforeEach(() => {
  state.usable = true
  state.provider = {
    feature: 'connector',
    list: vi.fn(async ({ connectionId }: any) => (connectionId === 'i1' ? methods : [])),
    run: vi.fn(async ({ methodId, inputs, ctx }: any) => {
      if (methodId.endsWith('items.get') && inputs.item_id === '404') throw new ExtensionError('not_found', 'Item 404 not found', 404)
      return { methodId, inputs, canManage: ctx.can('ext.acme.manage') }
    }),
  }
})

describe('ids and rows', () => {
  it('round-trips ids and finds the extension of a connector type', () => {
    expect(parseExtensionReferenceId(extensionReferenceId('acme', 'list-1/items.get'))).toEqual({ extensionId: 'acme', methodId: 'list-1/items.get' })
    expect(parseExtensionReferenceId('ext:acme')).toBeNull()
    expect(parseExtensionReferenceId('3f2b…')).toBeNull()
    expect(extensionOfIntegrationType('ext.acme.server')).toBe('acme')
    expect(extensionOfIntegrationType('rest')).toBeNull()
  })

  it('renders a method as a read-only reference row', () => {
    expect(methodAsReference('acme', 'i1', methods[2])).toMatchObject({
      id: 'ext:acme:list-1/recycle_bin.empty', integration_id: 'i1', readonly: true, outputs: [],
      inputs: [{ name: 'confirm', type: 'boolean', required: true, default_value: '' }],
      request_config: { source: 'extension', method: 'POST', path_template: '/lists/1/recycle-bin/empty', writes: true, destructive: true, access: 'manage' },
    })
  })
})

describe('listing', () => {
  it('lists the extension methods of its own connections only; unlicensed or failing → none', async () => {
    expect((await extensionReferencesFor(caller, integration)).map((r) => r.id)).toEqual(methods.map((m) => `ext:acme:${m.id}`))
    expect(await extensionReferencesFor(caller, { id: 'i1', type: 'rest' })).toEqual([])
    expect(await extensionReferencesFor(caller, { id: 'i1', type: 'ext.other.x' })).toEqual([])
    state.usable = false
    expect(await extensionReferencesFor(caller, integration)).toEqual([])
    state.usable = true
    state.provider.list = async () => { throw new Error('farm down') }
    expect(await extensionReferencesFor(caller, integration)).toEqual([])
  })
})

describe('running from the Test dialog', () => {
  const run = (id: string, inputs: Record<string, unknown> = {}, confirmWrite?: boolean, perms = caller.permissions) =>
    runExtensionReference({ ...caller, permissions: perms }, { referenceId: `ext:acme:${id}`, integration, inputs, confirmWrite })

  it('runs a read as the caller', async () => {
    expect(await run('list-1/items.get', { item_id: '3' })).toEqual({ status: 200, data: { methodId: 'list-1/items.get', inputs: { item_id: '3' }, canManage: false } })
  })

  it('needs confirm_write for writes and confirm: true for destructive methods', async () => {
    await expect(run('list-1/items.create', {})).rejects.toMatchObject({ status: 409, code: 'confirm_write' })
    expect((await run('list-1/items.create', {}, true)).status).toBe(200)
    await expect(run('list-1/recycle_bin.empty', {}, true)).rejects.toMatchObject({ status: 409, code: 'confirmation_required' })
    await expect(run('list-1/recycle_bin.empty', { confirm: 'false' }, true)).rejects.toMatchObject({ code: 'confirmation_required' })
    const ok = await run('list-1/recycle_bin.empty', { confirm: 'true' }, true, new Set([...caller.permissions, 'ext.acme.manage']))
    expect(ok.data).toMatchObject({ canManage: true })
  })

  it('maps extension errors; refuses foreign connections, unknown methods and unlicensed use', async () => {
    await expect(run('list-1/items.get', { item_id: '404' })).rejects.toMatchObject({ status: 404, code: 'not_found', message: 'Item 404 not found' })
    await expect(run('list-9/items.get')).rejects.toMatchObject({ status: 404 })
    await expect(runExtensionReference(caller, { referenceId: 'ext:acme:list-1/items.get', integration: { id: 'i1', type: 'ext.other.server' }, inputs: {} })).rejects.toMatchObject({ status: 404 })
    state.usable = false
    await expect(run('list-1/items.get')).rejects.toMatchObject({ status: 402, code: 'extension_unlicensed' })
  })
})
