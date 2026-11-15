/**
 * ctx.grants (lib/extensions/grants-host.ts): an extension lists, sets and
 * removes explicit grants ONLY on its own workflows and bound forms, through
 * the object-permissions service (team.change_roles, audited), and lists the
 * workspace's roles and teams to pick from.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/lib/providers/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/db')>()),
  getServiceDb: () => db.current,
}))

import { defineExtension, defineServerExtension } from '@user-tasks/extension-sdk'
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'
import { createExtensionContext } from '@/lib/extensions/host'
import { createMemorySupabase } from './fixtures/supabase-memory'

const TENANT = '0e000000-0000-4000-8000-0000000e0001'
const ANA = '0e000000-0000-4000-8000-0000000e0101'
const W1 = '0e000000-0000-4000-8000-0000000e0201'
const PLAIN = '0e000000-0000-4000-8000-0000000e0202'
const F1 = '0e000000-0000-4000-8000-0000000e0301'
const F2 = '0e000000-0000-4000-8000-0000000e0302'
const ROLE = '0e000000-0000-4000-8000-0000000e0401'
const TEAM = '0e000000-0000-4000-8000-0000000e0501'
const G_OTHER = '0e000000-0000-4000-8000-0000000e0601'

const manifest = {
  manifest_version: 1, id: 'acme', name: 'Acme', version: '1.0.0', publisher: { id: 'acme', name: 'Acme' },
  engines: { usertasks: '>=0.1.0 <2.0.0', extension_sdk: '^1.0.0' },
  licence: { tier: 'free' }, deployments: ['cloud', 'self_hosted'],
  contributes: { triggers: [{ key: 'changed', label: 'Changed', description: 'x', config: [], variables: [] }] },
}

function seed() {
  db.current = createMemorySupabase({
    workflows: [
      { id: W1, tenant_id: TENANT, name: 'Approve claims', trigger_type: 'ext.acme.changed', nodes: [] },
      { id: PLAIN, tenant_id: TENANT, name: 'Plain', trigger_type: 'manual', nodes: [] },
    ],
    forms: [
      { id: F1, tenant_id: TENANT, name: 'Claims — New', layout: { data_target: { extension: 'acme', key: 'list', config: {} } }, tags: [] },
      { id: F2, tenant_id: TENANT, name: 'Other', layout: {}, tags: [] },
    ],
    roles: [{ id: ROLE, tenant_id: TENANT, name: 'Finance editors', permissions: ['workflows.edit', 'forms.edit'] }],
    teams: [{ id: TEAM, tenant_id: TENANT, name: 'Finance' }],
    users: [{ id: ANA, email: 'ana@contoso.local', display_name: 'Ana B', tenant_id: TENANT }],
    user_roles: [{ id: 'ur1', tenant_id: TENANT, user_id: ANA, role_id: ROLE }],
    object_permissions: [{ id: G_OTHER, tenant_id: TENANT, object_type: 'workflow', object_id: PLAIN, team_id: TEAM, can_view: true, can_edit: true, can_delete: false, can_execute: false }],
    object_audit_log: [],
  }, { uuids: true }) as any
  return db.current
}

describe('ctx.grants', () => {
  beforeEach(() => registerExtensionsForTest({ definitions: [defineExtension({ manifest })], servers: [defineServerExtension({ id: 'acme', triggers: { changed: { matches: () => true } } })] }))
  afterEach(() => resetExtensionsForTest())

  it('sets, lists and removes grants on its own workflow and form, audited on the object', async () => {
    const mem = seed()
    const ctx = createExtensionContext({ extensionId: 'acme', tenantId: TENANT, actorId: ANA, permissions: ['team.change_roles'] })
    const g = await ctx.grants.set('workflow', W1, { team: TEAM, view: true, edit: true, execute: true })
    expect(g).toMatchObject({ who: { kind: 'team', id: TEAM, name: 'Finance' }, view: true, edit: true, execute: true, delete: false })
    await ctx.grants.set('form', F1, { person: ANA, execute: true, edit: true })
    const formGrants = await ctx.grants.list('form', F1)
    expect(formGrants).toHaveLength(1)
    expect(formGrants[0]).toMatchObject({ who: { kind: 'person', name: 'Ana B' }, view: true, execute: true, edit: false })
    expect(mem.tables.object_audit_log.map((a: any) => a.action)).toEqual(['grant', 'grant'])
    await ctx.grants.remove('workflow', W1, g.id)
    expect(await ctx.grants.list('workflow', W1)).toEqual([])
    expect(mem.tables.object_audit_log.at(-1)).toMatchObject({ action: 'revoke', object_id: W1 })
  })

  it('refuses other objects and other objects\' grants (404), and people without team.change_roles (403)', async () => {
    seed()
    const ctx = createExtensionContext({ extensionId: 'acme', tenantId: TENANT, actorId: ANA, permissions: ['team.change_roles'] })
    await expect(ctx.grants.list('workflow', PLAIN)).rejects.toMatchObject({ status: 404 })
    await expect(ctx.grants.set('form', F2, { team: TEAM })).rejects.toMatchObject({ status: 404 })
    await expect(ctx.grants.remove('workflow', W1, G_OTHER)).rejects.toMatchObject({ status: 404 })
    const member = createExtensionContext({ extensionId: 'acme', tenantId: TENANT, actorId: ANA, permissions: ['workflows.view'] })
    await expect(member.grants.set('workflow', W1, { team: TEAM })).rejects.toMatchObject({ status: 403 })
    await expect(member.grants.principals()).rejects.toMatchObject({ status: 403 })
    // Elevated (an extension-authorised action): allowed.
    expect((await member.elevate('via test').grants.set('workflow', W1, { role: ROLE, edit: true })).who.name).toBe('Finance editors')
  })

  it('revokeDesign takes back only a self-given design grant (elevated), audited; grants list marks it', async () => {
    const mem = seed()
    const member = createExtensionContext({ extensionId: 'acme', tenantId: TENANT, actorId: ANA, permissions: ['workflows.view'] })
    const up = member.elevate('via test')
    expect(await up.workflows.grantDesign(W1)).toEqual({ granted: true })
    const admin = createExtensionContext({ extensionId: 'acme', tenantId: TENANT, actorId: ANA, permissions: ['team.change_roles'] })
    expect((await admin.grants.list('workflow', W1))[0]).toMatchObject({ who: { kind: 'person', id: ANA }, edit: true, selfGranted: true })
    await expect(member.workflows.revokeDesign(W1)).rejects.toMatchObject({ status: 403 })
    await expect(up.workflows.revokeDesign(PLAIN, ANA)).rejects.toMatchObject({ status: 404 })
    expect(await up.workflows.revokeDesign(W1, ANA)).toEqual({ revoked: true })
    expect(mem.tables.object_permissions.filter((g: any) => g.object_id === W1)).toEqual([])
    expect(mem.tables.object_audit_log.at(-1)).toMatchObject({ action: 'revoke', object_id: W1 })
    expect(await up.workflows.revokeDesign(W1, ANA)).toEqual({ revoked: false })
    // A grant an admin gave is never taken back.
    const other = createExtensionContext({ extensionId: 'acme', tenantId: TENANT, actorId: '0e000000-0000-4000-8000-0000000e0102', permissions: ['team.change_roles'] })
    await other.grants.set('form', F1, { person: ANA, edit: true, execute: true })
    expect((await admin.grants.list('form', F1))[0].selfGranted).toBe(false)
    expect(await up.forms.revokeDesign(F1, ANA)).toEqual({ revoked: false })
  })

  it('lists roles (with their permissions) and teams to pick from', async () => {
    seed()
    const ctx = createExtensionContext({ extensionId: 'acme', tenantId: TENANT, actorId: ANA, permissions: ['team.change_roles'] })
    expect(await ctx.grants.principals()).toEqual({ roles: [{ id: ROLE, name: 'Finance editors', permissions: ['workflows.edit', 'forms.edit'] }], teams: [{ id: TEAM, name: 'Finance' }] })
  })
})
