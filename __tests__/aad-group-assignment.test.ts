/**
 * AAD (Entra ID) group assignment for User Tasks:
 *  - designer visibility (pure option list + static render), the warning
 *    when a saved AAD config outlives its Entra connection;
 *  - validation (group required, mode, workspace capability);
 *  - the Entra client's group search / member listing (Graph mocked) incl.
 *    nested toggle and 429 Retry-After;
 *  - capability read and member resolution (directory_links, email
 *    fallback, non-members skipped, cache) on an in-memory database;
 *  - the run-time plan (claim / everyone / single / unassigned / synced team
 *    fallback) and the queue's Claim action for candidates.
 * The engine end-to-end (task rows, candidates, claim) is in
 * aad-group-assignment-db.test.ts (local Supabase).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createEntraClient } from '@/lib/directory-sync/entra'
import { clearEntraGroupCaches, entraGroupCapabilities, resolveEntraGroupAssignees, searchEntraGroups } from '@/lib/directory-sync/entra-groups'
import { DirectoryApiError } from '@/lib/directory-sync/types'
import { aadGroupConfigOf, aadGroupValidationErrors, assignmentOptions, AAD_NOT_CONFIGURED_MESSAGE } from '@/lib/tasks/aad-group-assignment'
import { planAadGroupAssignment } from '@/lib/tasks/aad-group-runtime'
import { queueActionFor } from '@/lib/tasks/unified-list'
import { validateNode, validateWorkflow } from '@/lib/workflow-validation'
import { getNodeConfigSummary } from '@/lib/workflow-utils'
import { normalizeScaffoldWorkflow } from '@/lib/portability/normalize'
import { AadGroupAssignmentConfig, AssignmentSegments } from '@/components/automations/aad-group-assignment'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- loose rows and Graph payloads */

const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  clearEntraGroupCaches()
})
afterEach(() => vi.unstubAllGlobals())

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body }
}
const TOKEN = { access_token: 'graph-token', expires_in: 3600 }

const userTask = (config: Record<string, unknown>) => ({ id: 'n1', type: 'user_task', label: 'Approve', position: { x: 0, y: 0 }, config: { task_title: 'Approve', ...config } }) as any

const ENTRA_CONNECTOR = (overrides: Record<string, unknown> = {}) => ({
  id: 'conn-1', tenant_id: 'ta', connector_key: 'entra_directory', is_enabled: true,
  config: { provider: 'entra', sync_groups: false }, credentials: { tenant_id: 'tid', client_id: 'cid', client_secret: 'sec' },
  ...overrides,
})

describe('designer: AAD Group option visibility', () => {
  it('offers AAD Group only when Entra ID is configured', () => {
    expect(assignmentOptions({ entraGroups: true }, 'individual').map((o) => o.val)).toEqual(['individual', 'team', 'aad_group'])
    expect(assignmentOptions({ entraGroups: false }, 'individual').map((o) => o.val)).toEqual(['individual', 'team'])
    expect(assignmentOptions(null, 'team').map((o) => o.val)).toEqual(['individual', 'team'])
  })

  it('keeps a saved AAD Group visible after the connection is removed', () => {
    expect(assignmentOptions({ entraGroups: false }, 'aad_group').map((o) => o.val)).toContain('aad_group')
  })

  it('renders the segments without a "soon" placeholder', () => {
    const on = renderToStaticMarkup(createElement(AssignmentSegments, { value: 'individual', capabilities: { entraGroups: true }, onChange: () => {} }))
    const off = renderToStaticMarkup(createElement(AssignmentSegments, { value: 'individual', capabilities: { entraGroups: false }, onChange: () => {} }))
    expect(on).toContain('data-assignment-option="aad_group"')
    expect(on).toContain('AAD Group')
    expect(off).not.toContain('aad_group')
    expect(off).not.toContain('AAD Group')
    expect(on + off).not.toContain('soon')
  })

  it('shows the saved group with a warning when Entra ID is gone', () => {
    const html = renderToStaticMarkup(createElement(AadGroupAssignmentConfig, {
      config: { assignment_type: 'aad_group', aad_group_id: 'g-1', aad_group_name: 'Finance approvers' },
      capabilities: { entraGroups: false, syncedGroups: false }, onUpdate: () => {}, onBatchUpdate: () => {},
    }))
    expect(html).toContain('data-aad-group-warning')
    expect(html).toContain('Finance approvers')
    expect(html).toContain('Anyone in the group can claim it')
  })

  it('shows the picker and the modes when Entra ID is configured', () => {
    const client = new QueryClient()
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(AadGroupAssignmentConfig, {
        config: { assignment_type: 'aad_group', aad_group_id: 'g-1', aad_group_name: 'Finance approvers', aad_group_mode: 'everyone' },
        capabilities: { entraGroups: true, syncedGroups: false }, onUpdate: () => {}, onBatchUpdate: () => {},
      })))
    expect(html).not.toContain('data-aad-group-warning')
    expect(html).toContain('data-aad-group-selected')
    expect(html).toContain('Everyone in the group gets it')
    expect(html).toMatch(/data-aad-group-mode="everyone"[^>]*checked|checked[^>]*data-aad-group-mode="everyone"/)
  })
})

describe('config, validation and round trip', () => {
  it('defaults: claim, nested groups included', () => {
    expect(aadGroupConfigOf({ aad_group_id: ' g ' })).toEqual({ groupId: 'g', groupName: '', mode: 'claim', includeNested: true })
    expect(aadGroupConfigOf({ aad_group_mode: 'everyone', aad_include_nested: false }).includeNested).toBe(false)
  })

  it('requires a group and a known mode', () => {
    expect(validateNode(userTask({ assignment_type: 'aad_group' }))).toContain('AAD group required')
    expect(validateNode(userTask({ assignment_type: 'aad_group', aad_group_id: 'g', aad_group_mode: 'random' }))).toContain('AAD group mode must be claim or everyone')
    expect(validateNode(userTask({ assignment_type: 'aad_group', aad_group_id: 'g' }))).toEqual([])
    // No "Assignee required" for an AAD group step.
    expect(validateNode(userTask({ assignment_type: 'aad_group', aad_group_id: 'g' }))).not.toContain('Assignee required')
  })

  it('errors when the workspace has no Entra ID connection (when known)', () => {
    const node = userTask({ assignment_type: 'aad_group', aad_group_id: 'g' })
    expect(validateWorkflow([node], 'manual', { entraGroups: false }).nodeErrors[0].errors).toContain(AAD_NOT_CONFIGURED_MESSAGE)
    expect(validateWorkflow([node], 'manual', { entraGroups: true }).valid).toBe(true)
    expect(validateWorkflow([node], 'manual').valid).toBe(true)
    // Other assignment types never depend on the capability.
    expect(aadGroupValidationErrors({ assignment_type: 'team', team_id: 't' }, { entraGroups: false })).toEqual([])
  })

  it('canvas summary and portable normalisation keep the keys', () => {
    expect(getNodeConfigSummary(userTask({ assignment_type: 'aad_group', aad_group_name: 'Finance', aad_group_mode: 'everyone' }))).toContain('→ AAD Finance (everyone)')
    const config = { task_title: 'Approve', assignment_type: 'aad_group', aad_group_id: 'g-1', aad_group_name: 'Finance', aad_group_mode: 'claim', aad_include_nested: false }
    const workflow = normalizeScaffoldWorkflow({ trigger_type: 'manual', nodes: [{ id: 'start', type: 'manual', config: {} }, { id: 'n1', type: 'user_task', label: 'Approve', config }], edges: [{ id: 'e', source: 'start', target: 'n1' }] })
    expect(workflow.nodes.find((n: any) => n.type === 'user_task')?.config).toMatchObject(config)
  })
})

describe('Entra client: groups', () => {
  it('searches groups with ConsistencyLevel and follows only Graph group cursors', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      calls.push({ url, headers: init?.headers ?? {} })
      if (url.includes('login.microsoftonline.com')) return jsonResponse(TOKEN)
      return jsonResponse({ value: [{ id: 'g1', displayName: 'Finance', description: 'AP team', mail: 'fin@acme.com' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/groups?$skiptoken=x' })
    })
    const client = createEntraClient({ tenantId: 'tid', clientId: 'cid', clientSecret: 'sec' })
    const page = await client.searchGroups({ search: 'Fin"ance', limit: 10 })
    expect(page.groups).toEqual([{ externalId: 'g1', displayName: 'Finance', description: 'AP team', mail: 'fin@acme.com' }])
    expect(page.next).toContain('skiptoken')
    const search = calls.find((c) => c.url.includes('/v1.0/groups'))!
    expect(search.headers.ConsistencyLevel).toBe('eventual')
    const params = new URL(search.url).searchParams
    expect(params.get('$search')).toBe('"displayName:Fin ance"')
    expect(params.get('$top')).toBe('10')
    await expect(client.searchGroups({ next: 'https://evil.example/v1.0/groups?x' })).rejects.toBeInstanceOf(DirectoryApiError)
  })

  it('lists transitive members by default, direct members when nested is off; users only', async () => {
    const urls: string[] = []
    fetchMock.mockImplementation(async (url: string) => {
      urls.push(url)
      if (url.includes('login.microsoftonline.com')) return jsonResponse(TOKEN)
      return jsonResponse({ value: [
        { '@odata.type': '#microsoft.graph.user', id: 'u1', mail: 'Ada@Acme.com' },
        { '@odata.type': '#microsoft.graph.user', id: 'u2', mail: null, userPrincipalName: 'bob@acme.com' },
        { '@odata.type': '#microsoft.graph.user', id: 'u3', mail: null, userPrincipalName: 'guest_x.com#EXT#@acme.onmicrosoft.com' },
        { '@odata.type': '#microsoft.graph.user', id: 'u4', mail: 'off@acme.com', accountEnabled: false },
        { '@odata.type': '#microsoft.graph.group', id: 'g-nested' },
        { '@odata.type': '#microsoft.graph.device', id: 'd1' },
        { '@odata.type': '#microsoft.graph.user', id: 'u1', mail: 'ada@acme.com' },
      ] })
    })
    const client = createEntraClient({ tenantId: 'tid', clientId: 'cid', clientSecret: 'sec' })
    const members = await client.listGroupUserMembers('g1')
    expect(members).toEqual([
      { externalId: 'u1', email: 'ada@acme.com' },
      { externalId: 'u2', email: 'bob@acme.com' },
      { externalId: 'u3', email: null },
    ])
    expect(urls.some((u) => u.includes('/groups/g1/transitiveMembers?'))).toBe(true)
    await client.listGroupUserMembers('g1', { transitive: false })
    expect(urls.some((u) => u.includes('/groups/g1/members?'))).toBe(true)
  })

  it('retries a 429 after Retry-After, then succeeds', async () => {
    let graphCalls = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('login.microsoftonline.com')) return jsonResponse(TOKEN)
      graphCalls++
      if (graphCalls === 1) return jsonResponse({ error: { message: 'throttled' } }, 429, { 'Retry-After': '0' })
      return jsonResponse({ value: [{ id: 'u1', mail: 'ada@acme.com' }] })
    })
    const client = createEntraClient({ tenantId: 'tid', clientId: 'cid', clientSecret: 'sec' })
    expect(await client.listGroupUserMembers('g1')).toEqual([{ externalId: 'u1', email: 'ada@acme.com' }])
    expect(graphCalls).toBe(2)
  })

  it('surfaces a persistent 429 after the retries', async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes('login.microsoftonline.com')
      ? jsonResponse(TOKEN)
      : jsonResponse({ error: { message: 'throttled' } }, 429, { 'Retry-After': '0' }))
    const client = createEntraClient({ tenantId: 'tid', clientId: 'cid', clientSecret: 'sec' })
    await expect(client.listGroupUserMembers('g1')).rejects.toMatchObject({ status: 429 })
  })
})

describe('capability read', () => {
  it('is true only for an enabled Entra connection with credentials', async () => {
    expect(await entraGroupCapabilities(createMemorySupabase({ tenant_connectors: [ENTRA_CONNECTOR()] }) as any, 'ta')).toEqual({ entraGroups: true, syncedGroups: false })
    expect(await entraGroupCapabilities(createMemorySupabase({ tenant_connectors: [ENTRA_CONNECTOR({ config: { sync_groups: true } })] }) as any, 'ta')).toEqual({ entraGroups: true, syncedGroups: true })
    expect(await entraGroupCapabilities(createMemorySupabase({ tenant_connectors: [ENTRA_CONNECTOR({ is_enabled: false })] }) as any, 'ta')).toEqual({ entraGroups: false, syncedGroups: false })
    // Disconnected: credentials removed.
    expect((await entraGroupCapabilities(createMemorySupabase({ tenant_connectors: [ENTRA_CONNECTOR({ credentials: {} })] }) as any, 'ta')).entraGroups).toBe(false)
    expect((await entraGroupCapabilities(createMemorySupabase({}) as any, 'ta')).entraGroups).toBe(false)
    // Another workspace's connection doesn't count; Okta doesn't either.
    expect((await entraGroupCapabilities(createMemorySupabase({ tenant_connectors: [ENTRA_CONNECTOR({ tenant_id: 'tb' })] }) as any, 'ta')).entraGroups).toBe(false)
    expect((await entraGroupCapabilities(createMemorySupabase({ tenant_connectors: [ENTRA_CONNECTOR({ connector_key: 'okta_directory' })] }) as any, 'ta')).entraGroups).toBe(false)
  })
})

describe('group search', () => {
  it('lists synced groups when the connection syncs groups', async () => {
    const db = createMemorySupabase({
      tenant_connectors: [ENTRA_CONNECTOR({ config: { sync_groups: true } })],
      directory_links: [
        { tenant_id: 'ta', provider: 'entra', object_type: 'group', external_id: 'g2', local_id: 'team-2', display_name: 'Payroll' },
        { tenant_id: 'ta', provider: 'entra', object_type: 'group', external_id: 'g1', local_id: 'team-1', display_name: 'Finance' },
        { tenant_id: 'tb', provider: 'entra', object_type: 'group', external_id: 'gx', local_id: 'team-x', display_name: 'Finance B' },
      ],
    })
    const result = await searchEntraGroups(db as any, 'ta', { search: 'fin' })
    expect(result).toEqual({ groups: [{ id: 'g1', name: 'Finance', description: null, team_id: 'team-1' }], next_cursor: null, source: 'synced' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('searches Graph live when groups are not synced, and caches the page', async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes('login.microsoftonline.com')
      ? jsonResponse(TOKEN)
      : jsonResponse({ value: [{ id: 'g1', displayName: 'Finance', description: null }] }))
    const db = createMemorySupabase({ tenant_connectors: [ENTRA_CONNECTOR()] })
    const first = await searchEntraGroups(db as any, 'ta', { search: 'Fin' })
    expect(first).toEqual({ groups: [{ id: 'g1', name: 'Finance', description: null, team_id: null }], next_cursor: null, source: 'graph' })
    await searchEntraGroups(db as any, 'ta', { search: 'Fin' })
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/v1.0/groups')).length).toBe(1)
  })

  it('refuses when Entra ID is not configured', async () => {
    await expect(searchEntraGroups(createMemorySupabase({}) as any, 'ta', {})).rejects.toThrow(/not configured/)
  })
})

describe('member resolution', () => {
  const seed = () => createMemorySupabase({
    tenant_connectors: [ENTRA_CONNECTOR()],
    directory_links: [
      { tenant_id: 'ta', provider: 'entra', object_type: 'user', external_id: 'u1', local_id: 'alice' },
      { tenant_id: 'tb', provider: 'entra', object_type: 'user', external_id: 'u2', local_id: 'wrong' },
    ],
    users: [
      { id: 'alice', email: 'alice@acme.com' },
      { id: 'bob', email: 'Bob@Acme.com' },
      { id: 'carol', email: 'carol@acme.com' },
      { id: 'dave', email: 'dave@acme.com' },
    ],
    user_memberships: [
      { tenant_id: 'ta', user_id: 'alice', is_active: true },
      { tenant_id: 'ta', user_id: 'bob', is_active: true },
      { tenant_id: 'tb', user_id: 'carol', is_active: true },
      { tenant_id: 'ta', user_id: 'dave', is_active: false },
    ],
  })

  function graphMembers(byUrl: (url: string) => any[]) {
    fetchMock.mockImplementation(async (url: string) => url.includes('login.microsoftonline.com') ? jsonResponse(TOKEN) : jsonResponse({ value: byUrl(url) }))
  }

  it('maps directory links, then emails; skips people outside the workspace', async () => {
    graphMembers(() => [
      { id: 'u1', mail: 'alice-other@acme.com' }, // linked → alice
      { id: 'u2', mail: 'bob@acme.com' }, // link is another workspace's → email → bob
      { id: 'u3', mail: 'carol@acme.com' }, // account, but member of another workspace
      { id: 'u4', mail: 'dave@acme.com' }, // inactive membership
      { id: 'u5', mail: 'nobody@acme.com' }, // no account
      { id: 'u6', userPrincipalName: 'x_y.com#EXT#@acme.onmicrosoft.com' }, // no usable email
    ])
    const result = await resolveEntraGroupAssignees(seed() as any, 'ta', 'g1')
    expect(result).toMatchObject({ userIds: ['alice', 'bob'], memberCount: 6, skippedNoAccount: 2, skippedNotMember: 2, skippedOverLimit: 0, cached: false })
  })

  it('honours the nested toggle and caches per group + nesting', async () => {
    graphMembers((url) => url.includes('transitiveMembers') ? [{ id: 'u1' }, { id: 'u2', mail: 'bob@acme.com' }] : [{ id: 'u1' }])
    const db = seed()
    expect((await resolveEntraGroupAssignees(db as any, 'ta', 'g1')).userIds).toEqual(['alice', 'bob'])
    expect((await resolveEntraGroupAssignees(db as any, 'ta', 'g1', { includeNested: false })).userIds).toEqual(['alice'])
    const again = await resolveEntraGroupAssignees(db as any, 'ta', 'g1')
    expect(again.cached).toBe(true)
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/groups/g1/')).length).toBe(2)
  })

  it('caps the assignees', async () => {
    graphMembers(() => [{ id: 'u1' }, { id: 'u2', mail: 'bob@acme.com' }])
    expect(await resolveEntraGroupAssignees(seed() as any, 'ta', 'g1', { max: 1 })).toMatchObject({ userIds: ['alice'], skippedOverLimit: 1 })
  })
})

describe('run-time plan', () => {
  const resolved = (userIds: string[], extra: Record<string, number> = {}) => vi.fn(async () => ({ userIds, memberCount: userIds.length + (extra.skipped ?? 0), skippedNoAccount: extra.skipped ?? 0, skippedNotMember: 0, skippedOverLimit: 0, cached: false }))
  const configured = () => createMemorySupabase({ tenant_connectors: [ENTRA_CONNECTOR()] })
  const config = (extra: Record<string, unknown> = {}) => ({ assignment_type: 'aad_group', aad_group_id: 'g1', aad_group_name: 'Finance', ...extra })

  it('claim: every member is a candidate; skipped members are logged', async () => {
    const result = await planAadGroupAssignment(configured() as any, 'ta', config(), { resolve: resolved(['alice', 'bob'], { skipped: 3 }) })
    expect(result.plan).toEqual({ kind: 'claim', userIds: ['alice', 'bob'] })
    expect(result.metadata).toMatchObject({ group_id: 'g1', mode: 'claim', assigned_count: 2, skipped_count: 3, include_nested: true })
    expect(result.logs.find((l) => l.level === 'warn')?.message).toMatch(/skipped 3 of 5 members \(3 without a UserTasks account\)/)
  })

  it('everyone: a collaborative plan; the nested toggle is passed through', async () => {
    const resolve = resolved(['alice', 'bob'])
    const result = await planAadGroupAssignment(configured() as any, 'ta', config({ aad_group_mode: 'everyone', aad_include_nested: false }), { resolve })
    expect(result.plan).toEqual({ kind: 'everyone', userIds: ['alice', 'bob'] })
    expect(resolve).toHaveBeenCalledWith(expect.anything(), 'ta', 'g1', { includeNested: false })
  })

  it('one member: assigned directly', async () => {
    expect((await planAadGroupAssignment(configured() as any, 'ta', config(), { resolve: resolved(['alice']) })).plan).toEqual({ kind: 'single', userId: 'alice' })
  })

  it('nobody resolved: unassigned, with a clear log line', async () => {
    const result = await planAadGroupAssignment(configured() as any, 'ta', config(), { resolve: resolved([]) })
    expect(result.plan).toEqual({ kind: 'unassigned' })
    expect(result.logs.at(-1)?.message).toMatch(/no member of AAD group "Finance" has an active membership.*created unassigned/)
  })

  it('AAD removed later: unassigned without calling Graph', async () => {
    const resolve = resolved(['alice'])
    const result = await planAadGroupAssignment(createMemorySupabase({ tenant_connectors: [ENTRA_CONNECTOR({ is_enabled: false, credentials: {} })] }) as any, 'ta', config(), { resolve })
    expect(result.plan).toEqual({ kind: 'unassigned' })
    expect(result.metadata.fallback).toBe('unassigned')
    expect(result.logs[0]).toMatchObject({ level: 'warn', message: expect.stringMatching(/Entra ID is not configured/) })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('Graph failure: the synced team takes the task (claim) or its members (everyone)', async () => {
    const failing = vi.fn(async () => { throw new DirectoryApiError(503, 'Microsoft Graph 503') })
    const db = createMemorySupabase({
      tenant_connectors: [ENTRA_CONNECTOR()],
      directory_links: [{ tenant_id: 'ta', provider: 'entra', object_type: 'group', external_id: 'g1', local_id: 'team-1' }],
      user_teams: [{ team_id: 'team-1', user_id: 'alice' }, { team_id: 'team-1', user_id: 'bob' }, { team_id: 'team-1', user_id: 'gone' }],
      user_memberships: [{ tenant_id: 'ta', user_id: 'alice', is_active: true }, { tenant_id: 'ta', user_id: 'bob', is_active: true }],
    })
    const claim = await planAadGroupAssignment(db as any, 'ta', config(), { resolve: failing })
    expect(claim.plan).toEqual({ kind: 'team', teamId: 'team-1' })
    expect(claim.logs[0].message).toMatch(/Graph failed .*synced team/)
    const everyone = await planAadGroupAssignment(db as any, 'ta', config({ aad_group_mode: 'everyone' }), { resolve: failing })
    expect(everyone.plan).toEqual({ kind: 'everyone', userIds: ['alice', 'bob'] })
    // No synced team: unassigned.
    const none = await planAadGroupAssignment(configured() as any, 'ta', config(), { resolve: failing })
    expect(none.plan).toEqual({ kind: 'unassigned' })
  })
})

describe('queue: candidates claim', () => {
  const scope = { userId: 'alice', teamIds: new Set<string>(), collabPendingIds: new Set(['t1', 't2']), claimCandidateIds: new Set(['t1']) }
  it('a candidate row means Claim while unassigned; a collaborator row means Accept', () => {
    expect(queueActionFor({ id: 't1', status: 'todo', assignee_id: null }, scope)).toBe('claim')
    expect(queueActionFor({ id: 't2', status: 'todo', assignee_id: 'bob' }, scope)).toBe('accept')
    expect(queueActionFor({ id: 't1', status: 'completed', assignee_id: null }, scope)).toBeNull()
  })
})
