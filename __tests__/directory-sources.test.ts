/**
 * Directory sources contributed by extensions (lib/directory-sync/sources.ts):
 * manifest + server checks, snapshot normalisation, reconciliation (linking
 * active members, pending entries, read-only source teams, nested groups of
 * a directory connected in core, removals), first sign-in claims (seat
 * limit), queueing, lookups (ctx.directory) and read-only source teams in
 * the teams service.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/lib/providers/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/db')>()),
  getServiceDb: () => db.current,
}))
vi.mock('@/lib/directory-sync/kick', () => ({ kickDirectorySyncWorker: vi.fn() }))
vi.mock('@/lib/api-auth-cache', () => ({ invalidateCredentialCache: vi.fn(async () => {}) }))
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { defineExtension, defineServerExtension, type DirectorySourceSnapshot } from '@user-tasks/extension-sdk'
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'
import { setEntitlementPort } from '@/lib/extensions/entitlement-port'
import { createExtensionContext } from '@/lib/extensions/host'
import { extensionProblems } from '@/lib/extensions/server-registry'
import { parseExtensionManifest } from '@/lib/extensions/manifest'
import { unregisterUsageCounter, usageFor } from '@/lib/licensing/limits'
import {
  claimDirectoryEntries,
  hasPendingDirectoryEntry,
  listDirectorySources,
  normaliseSnapshot,
  requestDirectorySourceSync,
  runExtensionDirectorySync,
} from '@/lib/directory-sync/sources'
import { executeDirectorySyncRun } from '@/lib/directory-sync/sync'
import { addTeamMember, deleteTeam, removeTeamMember, updateTeam } from '@/lib/services/teams'
import { createMemorySupabase } from './fixtures/supabase-memory'

const T = '0e000000-0000-4000-8000-00000000d001'
const OTHER = '0e000000-0000-4000-8000-00000000d002'
const ROLE = '0e000000-0000-4000-8000-00000000d0r1'
const ANA = '0e000000-0000-4000-8000-00000000d0a1'
const OUTSIDER = '0e000000-0000-4000-8000-00000000d0a2'
const NEWBIE = '0e000000-0000-4000-8000-00000000d0a3'
const LDAP_TEAM = '0e000000-0000-4000-8000-00000000d0t1'
const SOURCE = 'ext.acmedir.people'

const manifest = {
  manifest_version: 1, id: 'acmedir', name: 'Acme Directory', version: '1.0.0', publisher: { id: 'acme', name: 'Acme' },
  engines: { usertasks: '>=0.1.0 <2.0.0', extension_sdk: '^1.0.0' },
  licence: { tier: 'paid', sku: 'acme-dir', features: ['directory'] },
  deployments: ['cloud', 'self_hosted'],
  contributes: { directorySources: [{ key: 'people', label: 'Acme', feature: 'directory', seatLimit: 'acmedir.users' }] },
}

let snapshot: DirectorySourceSnapshot
const server = defineServerExtension({
  id: 'acmedir',
  directorySources: { people: { sync: async () => snapshot, enabled: async () => true } },
})

let decision: any
function baseSnapshot(): DirectorySourceSnapshot {
  return {
    users: [
      { externalId: 'ana@contoso.local', displayName: 'Ana', email: 'AnaB@contoso.local', claims: ['i:0#.w|contoso\\anab', 'i:0e.t|trusted|anab@contoso.local'] },
      { externalId: 'jit@contoso.local', displayName: 'Jit', email: 'ut-jit@contoso.local', aliases: ['jit.alias@contoso.local'], claims: ['i:0e.t|trusted|ut-jit@contoso.local'] },
      { externalId: 'out@contoso.local', displayName: 'Outsider', email: 'out@contoso.local' },
      { externalId: 'nested@contoso.local', displayName: 'Nested', email: 'nested@contoso.local' },
    ],
    groups: [
      { externalId: 'site:8', displayName: 'Approvers', label: 'Acme · Lab', members: ['ana@contoso.local', 'jit@contoso.local'] },
      { externalId: 'site:9', displayName: 'Reviewers', label: 'Acme · Lab', members: ['out@contoso.local'], nested: [{ directory: 'ldap', name: 'CONTOSO\\ut-users', members: ['nested@contoso.local', 'ana@contoso.local'] }] },
    ],
  }
}

beforeEach(() => {
  decision = { allowed: true, state: 'licensed', limits: {} }
  snapshot = baseSnapshot()
  db.current = createMemorySupabase({
    tenant_extensions: [{ tenant_id: T, extension_id: 'acmedir', enabled: true, config: {}, secrets: {}, config_version: 1 }],
    roles: [{ id: ROLE, tenant_id: T, slug: 'member', is_system: true }],
    users: [
      { id: ANA, email: 'anab@contoso.local', display_name: 'Ana B', tenant_id: T },
      { id: OUTSIDER, email: 'out@contoso.local', display_name: 'Out', tenant_id: OTHER },
      { id: NEWBIE, email: 'ut-jit@contoso.local', display_name: 'Jit', tenant_id: OTHER },
    ],
    user_memberships: [
      { user_id: ANA, tenant_id: T, is_active: true },
      { user_id: OUTSIDER, tenant_id: OTHER, is_active: true },
    ],
    user_roles: [], user_teams: [], teams: [], directory_links: [], directory_entries: [], directory_sources: [], directory_sync_runs: [], tenant_connectors: [],
  }, { uuids: true })
  registerExtensionsForTest({ definitions: [defineExtension({ manifest })], servers: [server] })
  setEntitlementPort({ async check() { return decision } })
})
afterEach(() => {
  resetExtensionsForTest()
  unregisterUsageCounter('acmedir.users')
})

const tables = () => db.current.tables as Record<string, any[]>
const sync = (mode: 'full' | 'auto' = 'full') => runExtensionDirectorySync(db.current, T, SOURCE, { mode })
const entry = (externalId: string) => tables().directory_entries.find((e) => e.external_id === externalId)
const teamByName = (name: string) => tables().teams.find((t) => t.name === name)
const members = (teamId: string) => tables().user_teams.filter((m) => m.team_id === teamId).map((m) => m.user_id).sort()

describe('manifest and server module', () => {
  it('validates directory sources (feature declared, seat limit namespaced, unique keys)', () => {
    expect(parseExtensionManifest(manifest).contributes.directorySources[0]).toMatchObject({ key: 'people', intervalMinutes: 60 })
    expect(() => parseExtensionManifest({ ...manifest, contributes: { directorySources: [{ key: 'people', label: 'Acme', feature: 'nope' }] } })).toThrow(/feature "nope" is not declared/)
    expect(() => parseExtensionManifest({ ...manifest, contributes: { directorySources: [{ key: 'people', label: 'Acme', seatLimit: 'other.users' }] } })).toThrow(/seatLimit must be named "acmedir/)
    expect(() => parseExtensionManifest({ ...manifest, contributes: { directorySources: [{ key: 'a', label: 'A' }, { key: 'a', label: 'B' }] } })).toThrow(/duplicate directory source/)
  })

  it('needs a sync handler for every declared source, and no undeclared ones', () => {
    registerExtensionsForTest({ definitions: [defineExtension({ manifest })], servers: [defineServerExtension({ id: 'acmedir', directorySources: { other: { sync: async () => snapshot } } })] })
    const problems = extensionProblems().join('\n')
    expect(problems).toMatch(/directory source "other" that the manifest does not declare/)
    expect(problems).toMatch(/directory source "people" has no sync handler/)
  })

  it('lists the registered sources', () => {
    expect(listDirectorySources().map((s) => s.id)).toEqual([SOURCE])
  })
})

describe('normaliseSnapshot', () => {
  it('lower-cases keys and claims, merges duplicate people, drops non-addresses', () => {
    const n = normaliseSnapshot({
      users: [
        { externalId: 'x', displayName: '', email: 'A@X.org', aliases: ['not an address', 'b@x.org'], claims: ['I:0#.W|X\\A'] },
        { externalId: 'x', displayName: 'dup', email: 'c@x.org' },
      ],
      groups: [{ externalId: 'g', displayName: 'G', members: ['x', 'x'] }],
    })
    expect(n.users).toHaveLength(1)
    expect(n.users[0]).toMatchObject({ email: 'a@x.org', displayName: 'a@x.org', keys: ['a@x.org', 'b@x.org', 'c@x.org'], claims: ['i:0#.w|x\\a'] })
    expect(n.groups[0].members).toEqual(['x'])
    expect(n.complete).toBe(true)
    expect(() => normaliseSnapshot({ users: [{ externalId: '' } as any], groups: [] })).toThrow(/invalid snapshot/)
  })
})

describe('sync', () => {
  it('links active members, keeps everyone else pending, and builds read-only teams', async () => {
    const stats = await sync()
    expect(stats).toMatchObject({ users_linked: 1, entries_linked: 1, entries_pending: 3, groups_created: 2 })
    // Ana is a member of the workspace: linked. Out and Jit have accounts elsewhere only: pending (no membership, no seat).
    expect(entry('ana@contoso.local')).toMatchObject({ local_user_id: ANA, claims: ['i:0#.w|contoso\\anab', 'i:0e.t|trusted|anab@contoso.local'] })
    expect(entry('out@contoso.local').local_user_id).toBeNull()
    expect(entry('jit@contoso.local')).toMatchObject({ local_user_id: null, match_keys: ['ut-jit@contoso.local', 'jit.alias@contoso.local'], group_ids: ['site:8'] })
    expect(entry('nested@contoso.local').group_ids).toEqual(['site:9'])
    expect(tables().user_memberships.filter((m) => m.tenant_id === T)).toHaveLength(1)
    const approvers = teamByName('Approvers')
    expect(approvers).toMatchObject({ source: SOURCE, source_label: 'Acme · Lab', tenant_id: T })
    expect(members(approvers.id)).toEqual([ANA])
    // No LDAP connection: the source's own expansion of the nested AD group counts (Ana).
    expect(members(teamByName('Reviewers').id)).toEqual([ANA])
    expect(tables().directory_sources[0]).toMatchObject({ tenant_id: T, source: SOURCE, last_error: null })
    expect(tables().directory_sources[0].last_full_sync_at).toBeTruthy()
  })

  it('a second sync with nothing new changes nothing', async () => {
    await sync()
    const stats = await sync()
    expect(stats).toMatchObject({ users_linked: 0, groups_created: 0, groups_updated: 0, memberships_added: 0, memberships_removed: 0 })
  })

  it('uses the members of a nested group kept by LDAP sync when LDAP is connected', async () => {
    tables().tenant_connectors.push({ id: 'c1', tenant_id: T, connector_key: 'ldap_directory', is_enabled: true, config: { sync_groups: true }, credentials: {} })
    tables().teams.push({ id: LDAP_TEAM, tenant_id: T, name: 'UT-Users' })
    tables().directory_links.push({ id: 'l1', tenant_id: T, provider: 'ldap', object_type: 'group', external_id: 'guid-1', local_id: LDAP_TEAM, display_name: 'UT-Users' })
    tables().user_teams.push({ team_id: LDAP_TEAM, user_id: OUTSIDER })
    await sync()
    // LDAP's members (Outsider), not the fallback (Ana); Out is pending so not a direct member.
    expect(members(teamByName('Reviewers').id)).toEqual([OUTSIDER])
  })

  it('removes members the source no longer lists, and empties groups it dropped', async () => {
    await sync()
    snapshot.groups[0].members = ['jit@contoso.local']
    snapshot.groups = [snapshot.groups[0]]
    const stats = await sync()
    expect(members(teamByName('Approvers').id)).toEqual([])
    expect(members(teamByName('Reviewers').id)).toEqual([])
    expect(stats.memberships_removed).toBe(2)
    expect(teamByName('Reviewers')).toBeTruthy()
  })

  it('records a failed handler on the source state', async () => {
    registerExtensionsForTest({ definitions: [defineExtension({ manifest })], servers: [defineServerExtension({ id: 'acmedir', directorySources: { people: { sync: async () => { throw new Error('farm unreachable') } } } })] })
    await expect(sync()).rejects.toThrow('farm unreachable')
    expect(tables().directory_sources[0].last_error).toBe('farm unreachable')
  })

  it('refuses when the extension is not licensed for the source feature', async () => {
    decision = { allowed: false, state: 'unlicensed', reason: 'No licence for directory' }
    await expect(sync()).rejects.toThrow(/No licence/)
  })

  it('runs through directory_sync_runs (worker)', async () => {
    tables().directory_sync_runs.push({ id: 'run1', tenant_id: T, provider: SOURCE, status: 'running', mode: 'full' })
    await executeDirectorySyncRun(db.current, tables().directory_sync_runs[0])
    expect(tables().directory_sync_runs[0]).toMatchObject({ status: 'completed' })
    expect(tables().directory_sync_runs[0].stats.entries_pending).toBe(3)
  })
})

describe('first sign-in', () => {
  it('turns a pending entry into membership, role, link and groups', async () => {
    await sync()
    expect(await hasPendingDirectoryEntry(db.current, ['UT-JIT@contoso.local'])).toBe(true)
    const result = await claimDirectoryEntries(db.current, { userId: NEWBIE, keys: ['ut-jit@contoso.local'] })
    expect(result).toEqual({ tenants: [T], refused: 0 })
    expect(tables().user_memberships.find((m) => m.user_id === NEWBIE && m.tenant_id === T)).toMatchObject({ is_active: true })
    expect(tables().user_roles.find((r) => r.user_id === NEWBIE)).toMatchObject({ tenant_id: T, role_id: ROLE })
    expect(entry('jit@contoso.local')).toMatchObject({ local_user_id: NEWBIE, granted_access: true })
    expect(members(teamByName('Approvers').id)).toEqual([ANA, NEWBIE].sort())
    expect(await hasPendingDirectoryEntry(db.current, ['ut-jit@contoso.local'])).toBe(false)
    // The next sync keeps the link (no duplicate, still a member).
    await sync()
    expect(tables().directory_links.filter((l) => l.provider === SOURCE && l.object_type === 'user' && l.local_id === NEWBIE)).toHaveLength(1)
    expect(members(teamByName('Approvers').id)).toEqual([ANA, NEWBIE].sort())
  })

  it('matches on an alias too', async () => {
    await sync()
    expect((await claimDirectoryEntries(db.current, { userId: NEWBIE, keys: ['jit.alias@contoso.local'] })).tenants).toEqual([T])
  })

  it('leaves the entry pending when the seat limit is reached', async () => {
    await sync()
    decision = { allowed: true, state: 'licensed', limits: { 'acmedir.users': 1 } } // Ana already counts
    expect(await usageFor(['acmedir.users'], null)).toEqual({ 'acmedir.users': 1 })
    const result = await claimDirectoryEntries(db.current, { userId: NEWBIE, keys: ['ut-jit@contoso.local'] })
    expect(result).toEqual({ tenants: [], refused: 1 })
    expect(entry('jit@contoso.local').local_user_id).toBeNull()
    expect(tables().user_memberships.find((m) => m.user_id === NEWBIE && m.tenant_id === T)).toBeUndefined()
  })

  it('a person removed from the source loses the access the source gave, and is pending again', async () => {
    await sync()
    await claimDirectoryEntries(db.current, { userId: NEWBIE, keys: ['ut-jit@contoso.local'] })
    snapshot.users = snapshot.users.filter((u) => u.externalId !== 'jit@contoso.local')
    snapshot.groups[0].members = ['ana@contoso.local']
    const stats = await sync()
    expect(stats.users_deactivated).toBe(1)
    expect(tables().user_memberships.find((m) => m.user_id === NEWBIE && m.tenant_id === T)).toMatchObject({ is_active: false })
    expect(tables().user_roles.filter((r) => r.user_id === NEWBIE && r.tenant_id === T)).toHaveLength(0)
    expect(members(teamByName('Approvers').id)).toEqual([ANA])
    expect(entry('jit@contoso.local')).toMatchObject({ active: false, local_user_id: null, granted_access: false })
    // Ana (a member before the source) is never deprovisioned by it.
    snapshot.users = snapshot.users.filter((u) => u.externalId !== 'ana@contoso.local')
    await sync()
    expect(tables().user_memberships.find((m) => m.user_id === ANA && m.tenant_id === T)).toMatchObject({ is_active: true })
  })

  it('ignores entries of a workspace where the extension is disabled', async () => {
    await sync()
    tables().tenant_extensions[0].enabled = false
    const { invalidateTenantExtensions } = await import('@/lib/extensions/state')
    invalidateTenantExtensions()
    expect(await hasPendingDirectoryEntry(db.current, ['ut-jit@contoso.local'])).toBe(false)
  })
})

describe('queueing and ctx.directory', () => {
  it('queues one run at a time, and only when due', async () => {
    const first = await requestDirectorySourceSync(db.current, T, SOURCE, { full: true })
    expect(first).toMatchObject({ queued: true })
    expect(tables().directory_sync_runs[0]).toMatchObject({ provider: SOURCE, mode: 'full', tenant_id: T })
    tables().directory_sync_runs[0].status = 'pending'
    expect(await requestDirectorySourceSync(db.current, T, SOURCE)).toMatchObject({ queued: false, reason: 'already_running' })
    tables().directory_sync_runs[0].status = 'completed'
    tables().directory_sync_runs[0].created_at = new Date().toISOString()
    expect(await requestDirectorySourceSync(db.current, T, SOURCE, { ifDue: true })).toMatchObject({ queued: false, reason: 'not_due' })
    tables().directory_sync_runs[0].created_at = new Date(Date.now() - 2 * 3600_000).toISOString()
    expect(await requestDirectorySourceSync(db.current, T, SOURCE, { ifDue: true })).toMatchObject({ queued: true })
    expect(await requestDirectorySourceSync(db.current, T, 'ext.acmedir.unknown')).toMatchObject({ queued: false, reason: 'unknown_source' })
  })

  it('ctx.directory: status, lookups by account / claim / external id, only own sources', async () => {
    await sync()
    const ctx = createExtensionContext({ extensionId: 'acmedir', tenantId: T })
    const status = await ctx.directory.status('people')
    expect(status.counts).toEqual({ linked: 1, pending: 3, groups: 2 })
    const byUser = await ctx.directory.lookupUsers({ userIds: [ANA] })
    expect(byUser).toEqual([expect.objectContaining({ userId: ANA, externalId: 'ana@contoso.local', claims: expect.arrayContaining(['i:0#.w|contoso\\anab']) })])
    const byClaim = await ctx.directory.lookupUsers({ claims: ['I:0E.T|trusted|ut-jit@contoso.local'] })
    expect(byClaim).toEqual([expect.objectContaining({ userId: null, pending: true, externalId: 'jit@contoso.local' })])
    // An account that is not a member of this workspace is never returned as a user.
    const outsider = await ctx.directory.lookupUsers({ userIds: [OUTSIDER] })
    expect(outsider).toEqual([])
    const groups = await ctx.directory.lookupGroups({ externalIds: ['site:8'] })
    expect(groups).toEqual([expect.objectContaining({ externalId: 'site:8', name: 'Approvers', label: 'Acme · Lab' })])
    await expect(ctx.directory.status('other')).rejects.toThrow(/not declared/)
  })
})

describe('read-only source teams', () => {
  const svc = () => ({ supabase: db.current, db: db.current, tenantId: T, actorId: ANA, permissions: new Set(['team.invite', 'team.remove', 'team.view_members']), authKind: 'session', source: 'ui' }) as any

  it('refuses renames, deletes and member changes; other attributes stay editable', async () => {
    await sync()
    const team = teamByName('Approvers')
    await expect(updateTeam(svc(), team.id, { name: 'Renamed' })).rejects.toMatchObject({ code: 'conflict', details: { code: 'source_managed' } })
    await expect(deleteTeam(svc(), team.id)).rejects.toMatchObject({ code: 'conflict' })
    await expect(addTeamMember(svc(), team.id, ANA)).rejects.toMatchObject({ code: 'conflict' })
    await expect(removeTeamMember(svc(), team.id, ANA)).rejects.toMatchObject({ code: 'conflict' })
    const updated = await updateTeam(svc(), team.id, { name: 'Approvers', colour: '#3366ff' })
    expect(updated).toMatchObject({ name: 'Approvers', colour: '#3366FF' })
  })
})
