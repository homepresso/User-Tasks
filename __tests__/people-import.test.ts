/**
 * Organization → Import people (lib/services/people-import.ts): directory
 * preview mode, invite (one-off, with roles) and keep-in-sync (group scope),
 * with server-side permission checks and audit. Directory clients are
 * mocked: no real directory is ever called.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirectoryClient, DirectoryGroup, DirectoryUser } from '@/lib/directory-sync/types'

const state = vi.hoisted(() => ({
  connections: {} as Record<string, { isEnabled: boolean; settings: Record<string, unknown>; orgName: string | null; syncGroups: boolean; autoProvision: boolean; lastSyncAt: string | null }>,
  users: [] as Array<{ id: string; email: string }>,
  memberships: [] as string[],
  invitations: [] as string[],
  audits: [] as Array<Record<string, any>>,
}))

vi.mock('@/lib/directory-sync/connection', async (orig) => ({
  ...(await orig() as object),
  getDirectoryConnection: async (_db: unknown, _tenant: string, provider: string) => state.connections[provider] ?? null,
}))
vi.mock('@/lib/services/_shared', async (orig) => ({
  ...(await orig() as object),
  serviceRoleClient: async () => fakeDb,
  audit: async (_ctx: unknown, entry: Record<string, any>) => { state.audits.push(entry) },
}))

// A tiny PostgREST stand-in for the three reads the service makes.
const fakeDb = {
  from(table: string) {
    const filters: Record<string, unknown> = {}
    const q: any = {
      select: () => q,
      eq: (col: string, v: unknown) => { filters[col] = v; return q },
      is: () => q,
      in: (col: string, v: unknown[]) => { filters[`in:${col}`] = v; return q },
      ilikeAnyOf: (_col: string, patterns: string[]) => { filters.like = patterns.map((p) => p.replace(/\\(.)/g, '$1').toLowerCase()); return q },
      then: (resolve: (v: unknown) => void) => {
        if (table === 'users') resolve({ data: state.users.filter((u) => (filters.like as string[]).includes(u.email)) })
        else if (table === 'user_memberships') resolve({ data: (filters['in:user_id'] as string[]).filter((id) => state.memberships.includes(id)).map((user_id) => ({ user_id })) })
        else if (table === 'invitations') resolve({ data: (filters['in:email'] as string[]).filter((e) => state.invitations.includes(e)).map((email) => ({ email })) })
        else resolve({ data: [] })
      },
    }
    return q
  },
}

const svc = await import('@/lib/services/people-import')
const { previewDirectory } = await import('@/lib/directory-sync/preview')
const { scopeFilter, scopeGroupIds } = await import('@/lib/directory-sync/scope')

const user = (id: string, email: string | null, active = true, name = id): DirectoryUser => ({ externalId: id, displayName: name, email, active })
const group = (id: string, name = id): DirectoryGroup => ({ externalId: id, displayName: name, description: null })

function mockClient(users: DirectoryUser[], groups: DirectoryGroup[], members: Record<string, string[]>): DirectoryClient & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    verify: async () => ({ orgName: 'Acme' }),
    listUsers: async () => { calls.push('listUsers'); return users },
    listGroups: async () => { calls.push('listGroups'); return groups },
    listGroupMemberIds: async (id: string) => { calls.push(`members:${id}`); return members[id] ?? [] },
    close: async () => { calls.push('close') },
  }
}

const ctx = (perms: string[]) => ({ supabase: fakeDb, tenantId: 'tenant-a', actorId: 'admin-1', permissions: new Set(perms), authKind: 'session', source: 'ui' }) as never

const USERS = [user('u1', 'Ada@Acme.test', true, 'Ada'), user('u2', 'bob@acme.test', true, 'Bob'), user('u3', 'cy@acme.test', false, 'Cy'), user('u4', null, true, 'Dee'), user('u5', 'eve@acme.test', true, 'Eve')]
const GROUPS = [group('g-fin', 'Finance'), group('g-eng', 'Engineering')]
const MEMBERS = { 'g-fin': ['u1', 'u2'], 'g-eng': ['u4', 'u5'] }
let client: ReturnType<typeof mockClient>
const invite = vi.fn()
const updateConnection = vi.fn()
const startSync = vi.fn()

beforeEach(() => {
  state.connections = { entra: { isEnabled: true, settings: {}, orgName: 'Acme', syncGroups: false, autoProvision: false, lastSyncAt: null } }
  state.users = [{ id: 'local-bob', email: 'bob@acme.test' }]
  state.memberships = ['local-bob']
  state.invitations = ['eve@acme.test']
  state.audits = []
  client = mockClient(USERS, GROUPS, MEMBERS)
  svc.peopleImportDeps.clientFor = async () => client
  svc.peopleImportDeps.db = async () => fakeDb as never
  invite.mockReset().mockImplementation(async (_ctx: unknown, input: { email: string; role: string }) => ({ invitation: { email: input.email }, email_sent: true }))
  updateConnection.mockReset().mockResolvedValue({ connection: {}, changed: true })
  startSync.mockReset().mockResolvedValue({ run_id: 'run-1', already_running: false })
  svc.peopleImportDeps.invite = invite as never
  svc.peopleImportDeps.updateConnection = updateConnection as never
  svc.peopleImportDeps.startSync = startSync as never
})

describe('directory preview mode (read only, any client)', () => {
  it('lists everyone, deduplicated and sorted, with the groups', async () => {
    const p = await previewDirectory(mockClient([...USERS, user('u1', 'ada@acme.test')], GROUPS, MEMBERS))
    expect(p.users.map((u) => u.displayName)).toEqual(['Ada', 'Bob', 'Cy', 'Dee', 'Eve'])
    expect(p.users[0].email).toBe('ada@acme.test')
    expect(p.groups.map((g) => g.displayName)).toEqual(['Engineering', 'Finance'])
    expect(p.truncated).toBe(false)
  })

  it('narrows to the members of the selected groups (unknown groups ignored) and caps the list', async () => {
    const p = await previewDirectory(client, { groupIds: ['g-fin', 'nope'] })
    expect(p.users.map((u) => [u.externalId, u.groupIds])).toEqual([['u1', ['g-fin']], ['u2', ['g-fin']]])
    expect(client.calls).not.toContain('members:nope')
    const capped = await previewDirectory(client, { maxUsers: 2 })
    expect(capped).toMatchObject({ totalUsers: 5, truncated: true })
    expect(capped.users).toHaveLength(2)
  })
})

describe('the connection’s group scope (used by the sync engine)', () => {
  it('no scope keeps everyone; a scope keeps only its groups’ members and its groups', async () => {
    const none = await scopeFilter(client, {})
    expect(none.userInScope({ externalId: 'u5' })).toBe(true)
    const scoped = await scopeFilter(client, { scope_group_ids: ['g-fin', 'g-fin', ' '] })
    expect(scoped.scope).toEqual(['g-fin'])
    expect(scoped.userInScope({ externalId: 'u1' })).toBe(true)
    expect(scoped.userInScope({ externalId: 'u5' })).toBe(false)
    expect(scoped.groupInScope({ externalId: 'g-eng' })).toBe(false)
    expect(scopeGroupIds({ scope_group_ids: 'g-fin' })).toEqual([])
  })

  it('the sync engine applies it to users and groups, and every pull provider accepts the setting', () => {
    const sync = readFileSync(join(process.cwd(), 'lib/directory-sync/sync.ts'), 'utf8')
    expect(sync).toMatch(/await scopeFilter\(client, connection\.settings\)/)
    expect(sync).toMatch(/directoryUsers\.filter\(\(u\) => u\.active && u\.email && inScope\(u\)\)/)
    expect(sync).toMatch(/\(await client\.listGroups\(\)\)\.filter\(groupInScope\)/)
    const settings = readFileSync(join(process.cwd(), 'lib/services/directory-sync.ts'), 'utf8')
    for (const p of ['entra', 'okta', 'ldap', 'google']) expect(settings).toMatch(new RegExp(`${p}: [^\\n]*scopeGroupIdsSetting`))
  })
})

describe('sources and preview', () => {
  it('needs team.invite or settings.edit', async () => {
    await expect(svc.listImportSources(ctx(['settings.view']))).rejects.toThrow()
    expect((await svc.listImportSources(ctx(['team.invite']))).sources.map((s) => s.provider)).toEqual(['entra'])
    expect((await svc.listImportSources(ctx(['settings.edit']))).sources).toHaveLength(1)
  })

  it('tags each person with their status in this workspace, writing nothing', async () => {
    const p = await svc.previewPeopleImport(ctx(['team.invite']), { provider: 'entra' })
    expect(Object.fromEntries(p.users.map((u) => [u.externalId, u.status]))).toEqual({ u1: 'new', u2: 'member', u3: 'inactive', u4: 'no_email', u5: 'invited' })
    expect(invite).not.toHaveBeenCalled()
    expect(updateConnection).not.toHaveBeenCalled()
    expect(client.calls).toContain('close')
  })

  it('refuses an unknown or unconnected provider', async () => {
    await expect(svc.previewPeopleImport(ctx(['team.invite']), { provider: 'scim' })).rejects.toThrow(/provider/)
    await expect(svc.previewPeopleImport(ctx(['team.invite']), { provider: 'okta' })).rejects.toThrow(/not connected/)
  })
})

describe('invite', () => {
  it('needs team.invite; Admin also needs team.change_roles; owner is never offered', async () => {
    await expect(svc.invitePeopleFromDirectory(ctx(['settings.edit']), { provider: 'entra', external_ids: ['u1'] })).rejects.toThrow()
    await expect(svc.invitePeopleFromDirectory(ctx(['team.invite']), { provider: 'entra', external_ids: ['u1'], role: 'admin' })).rejects.toThrow()
    await expect(svc.invitePeopleFromDirectory(ctx(['team.invite']), { provider: 'entra', external_ids: ['u1'], role: 'owner' })).rejects.toThrow(/role/)
    await svc.invitePeopleFromDirectory(ctx(['team.invite', 'team.change_roles']), { provider: 'entra', external_ids: ['u1'], role: 'admin' })
    expect(invite).toHaveBeenCalledWith(expect.anything(), { email: 'ada@acme.test', role: 'admin' })
  })

  it('invites with the directory’s emails (re-read on the server) and skips the rest with reasons; audited', async () => {
    const r = await svc.invitePeopleFromDirectory(ctx(['team.invite']), { provider: 'entra', external_ids: ['u1', 'u2', 'u3', 'u4', 'u5', 'ghost', 'u1'], role: 'viewer' })
    expect(r.invited).toEqual(['ada@acme.test'])
    expect(invite).toHaveBeenCalledTimes(1)
    expect(Object.fromEntries(r.skipped.map((s) => [s.external_id, s.reason]))).toEqual({
      u2: 'Already a member', u3: 'Inactive in the directory', u4: 'No email address in the directory', u5: 'Already invited', ghost: 'Not found in the directory',
    })
    expect(state.audits).toEqual([expect.objectContaining({ objectType: 'directory_sync', action: 'import_invite', metadata: expect.objectContaining({ provider: 'entra', role: 'viewer', invited: 1, skipped: 5 }) })])
  })

  it('caps one import and reports invitation emails that failed', async () => {
    await expect(svc.invitePeopleFromDirectory(ctx(['team.invite']), { provider: 'entra', external_ids: Array.from({ length: svc.MAX_INVITES_PER_IMPORT + 1 }, (_, i) => `x${i}`) })).rejects.toThrow(/At most/)
    await expect(svc.invitePeopleFromDirectory(ctx(['team.invite']), { provider: 'entra', external_ids: [] })).rejects.toThrow(/Select/)
    invite.mockResolvedValueOnce({ invitation: {}, email_sent: false })
    expect((await svc.invitePeopleFromDirectory(ctx(['team.invite']), { provider: 'entra', external_ids: ['u1'] })).email_failures).toBe(1)
  })

  it('an invitation the invitation service refuses is a skip, not a failure of the batch', async () => {
    client = mockClient([...USERS, user('u6', 'fay@acme.test')], GROUPS, MEMBERS)
    invite.mockRejectedValueOnce(new Error('This email has already been invited'))
    const r = await svc.invitePeopleFromDirectory(ctx(['team.invite']), { provider: 'entra', external_ids: ['u1', 'u6'] })
    expect(r.invited).toEqual(['fay@acme.test'])
    expect(r.skipped).toEqual([{ external_id: 'u1', email: 'ada@acme.test', reason: 'This email has already been invited' }])
  })
})

describe('keep in sync', () => {
  it('needs settings.edit (the directory admin permission)', async () => {
    await expect(svc.keepPeopleInSync(ctx(['team.invite']), { provider: 'entra', group_ids: ['g-fin'] })).rejects.toThrow()
    expect(updateConnection).not.toHaveBeenCalled()
  })

  it('saves the groups as the scope, turns on group sync and provisioning, starts a full sync; audited', async () => {
    const r = await svc.keepPeopleInSync(ctx(['settings.edit']), { provider: 'entra', group_ids: ['g-fin'] })
    expect(updateConnection).toHaveBeenCalledWith(expect.anything(), 'entra', { settings: { scope_group_ids: ['g-fin'] }, sync_groups: true, auto_provision: true })
    expect(startSync).toHaveBeenCalledWith(expect.anything(), 'entra', { full: true })
    expect(r).toEqual({ run_id: 'run-1', already_running: false, scope_group_ids: ['g-fin'] })
    expect(state.audits).toEqual([expect.objectContaining({ action: 'import_sync', metadata: expect.objectContaining({ scope_group_ids: ['g-fin'], run_id: 'run-1' }) })])
  })

  it('no groups clears the scope (everyone); unknown groups are refused before anything changes', async () => {
    await svc.keepPeopleInSync(ctx(['settings.edit']), { provider: 'entra', group_ids: [] })
    expect(updateConnection).toHaveBeenLastCalledWith(expect.anything(), 'entra', expect.objectContaining({ settings: { scope_group_ids: null } }))
    updateConnection.mockClear()
    await expect(svc.keepPeopleInSync(ctx(['settings.edit']), { provider: 'entra', group_ids: ['g-typo'] })).rejects.toThrow(/Unknown directory group/)
    expect(updateConnection).not.toHaveBeenCalled()
    expect(startSync).toHaveBeenCalledTimes(1)
  })
})

describe('the wizard', () => {
  it('Organization → Manage → Import people offers the directories and CSV, invite with roles and keep in sync', () => {
    const page = readFileSync(join(process.cwd(), 'components/org/manage/org-manage-page.tsx'), 'utf8')
    expect(page).toMatch(/\{tab === 'import' && <ImportPeopleWizard canManage=\{canOrg\} \/>\}/)
    const wizard = readFileSync(join(process.cwd(), 'components/org/import-people-wizard.tsx'), 'utf8')
    expect(wizard).toMatch(/listPeopleImportSources\(\)/)
    expect(wizard).toMatch(/data-import-source="csv"/)
    expect(wizard).toMatch(/<OrgImportPanel canManage=\{canManage\} \/>/)
    expect(wizard).toMatch(/invitePeopleFromDirectory\(\{ provider: source\.provider, external_ids: \[\.\.\.selected\], role \}\)/)
    expect(wizard).toMatch(/keepPeopleInSync\(\{ provider: source\.provider, group_ids: groupIds \}\)/)
    expect(wizard).not.toMatch(/value="owner"/)
  })
})
