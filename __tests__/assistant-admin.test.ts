/**
 * Admin help: the admin tools are permission filtered, the hard exclusions
 * never exist (Owner included), every admin write is confirmed with a
 * before → after card, and the guards hold before any card: no granting
 * beyond your own permissions, no self role / team / manager changes, never
 * the Owner role, never the last owner. Deactivating a member is a red card
 * with typed text; the CSV org import previews (dry run) before writing;
 * writes are audited with `agent: true`. The LLM is mocked.
 */
import { describe, expect, it, vi } from 'vitest'
import { SYSTEM_ROLES } from '@/lib/tenant-provisioning'
import { requiredToolPermission, auditToolCall } from '@/lib/mcp/authz'
import { getMcpToolCatalog } from '@/lib/mcp/server'
import {
  ADMIN_HARD_EXCLUDED, ADMIN_MCP_READ_TOOLS, ADMIN_TOOL_PERMISSIONS, ADMIN_WRITE_TOOLS, allowedAdminToolNames,
} from '@/lib/assistants/admin-policy'
import { adminTools, leafDiff, navRequirement, permissionsNotHeld } from '@/lib/assistants/tools/admin'
import { allowedDesignerToolNames } from '@/lib/assistants/tools/designer'
import { normalizeAgentSettings, resolveAvailability } from '@/lib/assistants/config'
import { assistantInstructions } from '@/lib/assistants/prompts'
import { runAssistantTurn, type AssistantToolDef } from '@/lib/assistants/engine'
import { parseChatRequest, prepareAssistantTurn } from '@/lib/assistants/chat'
import { deactivateMember } from '@/lib/services/members'
import { audit } from '@/lib/services/_shared'
import type { AssistantEvent } from '@/lib/assistants/types'
import type { AssistantConnection } from '@/lib/assistants/settings'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any */

const perms = (slug: string) => new Set<string>(SYSTEM_ROLES.find((r) => r.slug === slug)!.permissions)
const OWNER = perms('owner')
const ADMIN = perms('admin')
const MANAGER = perms('manager')
const MEMBER = perms('member')

/* ── A tiny in-memory Supabase double (select / eq / in / maybeSingle / insert / update / delete) ── */
function memDb(tables: Record<string, any[]>) {
  const inserts: Array<{ table: string; row: any }> = []
  const from = (table: string) => {
    const filters: Array<(r: any) => boolean> = []
    let single = false
    let op: 'select' | 'update' | 'delete' = 'select'
    let patch: any = null
    const run = () => {
      const all = tables[table] ?? []
      const list = all.filter((r) => filters.every((f) => f(r)))
      if (op === 'update') for (const r of list) Object.assign(r, patch)
      if (op === 'delete') tables[table] = all.filter((r) => !list.includes(r))
      return { data: single ? list[0] ?? null : list, error: null, count: list.length }
    }
    const api: any = {
      select: () => api,
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return api },
      in: (c: string, v: any[]) => { filters.push((r) => v.includes(r[c])); return api },
      gte: () => api, is: () => api, order: () => api, limit: () => api, ilike: () => api, or: () => api,
      update: (p: any) => { op = 'update'; patch = p; return api },
      delete: () => { op = 'delete'; return api },
      insert: (row: any) => { inserts.push({ table, row }); (tables[table] ??= []).push(row); return { then: (res: any, rej: any) => Promise.resolve({ data: row, error: null }).then(res, rej), select: () => ({ single: async () => ({ data: row, error: null }) }) } },
      maybeSingle: () => { single = true; return Promise.resolve(run()) },
      single: () => { single = true; return Promise.resolve(run()) },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    }
    return api
  }
  return { client: { from } as any, inserts, tables }
}

const ROLES = [
  { id: 'r-owner', name: 'Owner', slug: 'owner', is_system: true, permissions: [...OWNER] },
  { id: 'r-admin', name: 'Admin', slug: 'admin', is_system: true, permissions: [...ADMIN] },
  { id: 'r-manager', name: 'Manager', slug: 'manager', is_system: true, permissions: [...MANAGER] },
  { id: 'r-member', name: 'Member', slug: 'member', is_system: true, permissions: [...MEMBER] },
  { id: 'r-fin', name: 'Finance reviewer', slug: 'finance_reviewer', is_system: false, permissions: ['reports.view', 'data.view'] },
]

function world() {
  return memDb({
    tenants: [{ id: 't1', name: 'Hayes', slug: 'hayes' }],
    roles: ROLES.map((r) => ({ ...r, tenant_id: 't1' })),
    users: [
      { id: 'u-admin', display_name: 'Andy Admin', email: 'andy@example.com' },
      { id: 'u-owner', display_name: 'Olive Owner', email: 'olive@example.com' },
      { id: 'u-tom', display_name: 'Tom Lee', email: 'tom@example.com' },
      { id: 'u-priya', display_name: 'Priya Shah', email: 'priya@example.com' },
    ],
    user_memberships: ['u-admin', 'u-owner', 'u-tom', 'u-priya'].map((id) => ({ tenant_id: 't1', user_id: id, is_active: true })),
    user_roles: [
      { tenant_id: 't1', user_id: 'u-admin', role_id: 'r-admin' },
      { tenant_id: 't1', user_id: 'u-owner', role_id: 'r-owner' },
      { tenant_id: 't1', user_id: 'u-tom', role_id: 'r-member' },
      { tenant_id: 't1', user_id: 'u-priya', role_id: 'r-manager' },
    ],
    teams: [{ id: 'team-fin', name: 'Finance', tenant_id: 't1' }],
    user_teams: [{ team_id: 'team-fin', user_id: 'u-priya' }],
    object_permissions: [{ tenant_id: 't1', team_id: 'team-fin', object_type: 'workflow', object_id: 'w1' }, { tenant_id: 't1', team_id: 'team-fin', object_type: 'workflow', object_id: 'w2' }],
    permission_audit_log: [],
    object_audit_log: [],
  })
}

/** A fake MCP-bound server: records calls, answers like the MCP tools. */
function fakeServer(answers: Record<string, (args: any) => any> = {}) {
  const calls: Array<{ name: string; args: any }> = []
  const defaults: Record<string, (args: any) => any> = {
    roles_list: () => ({ roles: ROLES }),
    teams_list: () => ({ teams: [{ id: 'team-fin', name: 'Finance' }] }),
    users_manager_get: () => ({ manager: null }),
  }
  return {
    calls,
    server: {
      getHandler: (name: string) => async (args: any) => {
        calls.push({ name, args })
        const fn = answers[name] ?? defaults[name]
        return { content: [{ type: 'text', text: JSON.stringify(fn ? fn(args) : { ok: true }) }] }
      },
    } as any,
  }
}

function tools(permissions: Set<string>, actorId = 'u-admin', answers: Record<string, (a: any) => any> = {}, w = world()) {
  const f = fakeServer(answers)
  const svc: ServiceContext = { tenantId: 't1', actorId, permissions, supabase: w.client, authKind: 'mcp', source: 'mcp', via: 'agent' }
  const deactivate = vi.fn(async () => ({ deactivated: true }))
  const list = adminTools({ server: f.server, permissions, svc, deactivate })
  const get = (name: string) => { const t = list.find((x) => x.name === name); if (!t) throw new Error(`no tool ${name}`); return t }
  return { list, get, calls: f.calls, deactivate, w }
}
const env = () => { const events: AssistantEvent[] = []; return { events, env: { emit: (e: AssistantEvent) => events.push(e), toolCallId: 'c1' } } }

describe('the tool list follows permissions', () => {
  it('a Manager without Manage roles gets no role tools (but can invite and read)', () => {
    const names = allowedAdminToolNames(MANAGER)
    expect(MANAGER.has('team.change_roles')).toBe(false)
    for (const t of ['assign_role', 'remove_role', 'create_role', 'update_role', 'set_manager', 'audit_log_query', 'forms_legal_hold', 'deactivate_member', 'remove_team_member']) expect(names).not.toContain(t)
    expect(names).toEqual(expect.arrayContaining(['invite_member', 'add_team_member', 'explain_access', 'roles_list']))
  })

  it('a Member gets no admin help at all (no admin permission)', () => {
    const settings = { provider: 'openai' as const, usable: true, agent: normalizeAgentSettings({ version: 2, enabled: true }) }
    expect(resolveAvailability(settings, { permissions: MEMBER, roleIds: [], teamIds: [] }).admin).toBe(false)
    expect(resolveAvailability(settings, { permissions: ADMIN, roleIds: [], teamIds: [] }).admin).toBe(true)
    const off = { ...settings, agent: normalizeAgentSettings({ version: 2, enabled: true, tools: { admin: false } }) }
    expect(resolveAvailability(off, { permissions: OWNER, roleIds: [], teamIds: [] }).admin).toBe(false)
  })

  it('Admin help is on by default; first-release rows follow building help', () => {
    expect(normalizeAgentSettings({ version: 2, enabled: true }).tools.admin).toBe(true)
    expect(normalizeAgentSettings({ designer: { enabled: true } }).tools.admin).toBe(true)
    expect(normalizeAgentSettings({ form: { enabled: true }, designer: { enabled: false } }).tools.admin).toBe(false)
  })

  it('the MCP read tools keep the MCP tool\'s own permission', () => {
    for (const name of ADMIN_MCP_READ_TOOLS) expect(ADMIN_TOOL_PERMISSIONS[name], name).toBe(requiredToolPermission(name))
    const catalog = new Set(getMcpToolCatalog().tools.map((t) => t.name))
    for (const name of ADMIN_MCP_READ_TOOLS) expect(catalog.has(name), name).toBe(true)
  })
})

describe('hard exclusions: absent for everyone, the Owner included', () => {
  const SECRETISH = /api_key|secret|token|webhook|sso|oauth|scim|signing|certificate|workspace_address|dns|billing|instance|ownership|assistant_settings|model_rule|document_ocr|cost_settings/i

  it('never in the admin tool names for the Owner', () => {
    const names = allowedAdminToolNames(OWNER)
    for (const ex of ADMIN_HARD_EXCLUDED) expect(names).not.toContain(ex)
    expect(names.filter((n) => SECRETISH.test(n))).toEqual([])
  })

  it('never in the whole tool list a turn offers the Owner (building + admin)', async () => {
    const w = world()
    w.tables.assistant_settings = [{ tenant_id: 't1', provider: 'ollama', key_source: 'key', api_key: null, base_url: null, model: 'llama3.1', capabilities: { version: 2, enabled: true }, limits: {} }]
    const ctx: ServiceContext = { tenantId: 't1', actorId: 'u-owner', permissions: OWNER, supabase: {} as any, authKind: 'session', source: 'ui' }
    const p = await prepareAssistantTurn(ctx, parseChatRequest({ messages: [{ role: 'user', content: 'hi' }], context: { admin: { area: 'team' } } }), { serviceDb: w.client, skipBurst: true })
    const names = p.tools.map((t) => t.name)
    expect(names).toContain('invite_member')
    for (const ex of ADMIN_HARD_EXCLUDED) expect(names).not.toContain(ex)
    expect(names.filter((n) => SECRETISH.test(n))).toEqual([])
    expect(new Set(names).size).toBe(names.length)
    expect(JSON.stringify(p.context)).toContain('"page":"team"')
    expect(p.instructions).toContain('Admin help')
    expect(p.instructions).toContain('Never available')
    // The building tools never include a secret / settings tool either.
    expect(allowedDesignerToolNames(OWNER).filter((n) => SECRETISH.test(n) || (ADMIN_HARD_EXCLUDED as readonly string[]).includes(n))).toEqual([])
  })

  it('a Member\'s turn has no admin tools', async () => {
    const w = world()
    w.tables.assistant_settings = [{ tenant_id: 't1', provider: 'ollama', key_source: 'key', api_key: null, base_url: null, model: 'llama3.1', capabilities: { version: 2, enabled: true }, limits: {} }]
    const ctx: ServiceContext = { tenantId: 't1', actorId: 'u-tom', permissions: MEMBER, supabase: {} as any, authKind: 'session', source: 'ui' }
    const p = await prepareAssistantTurn(ctx, parseChatRequest({ messages: [{ role: 'user', content: 'hi' }] }), { serviceDb: w.client, skipBurst: true })
    expect(p.tools.map((t) => t.name).filter((n) => Object.keys(ADMIN_TOOL_PERMISSIONS).includes(n) && !['org_person_get', 'org_manager_chain', 'org_subordinates'].includes(n))).toEqual([])
    expect(p.instructions).not.toContain('Admin help: you help administer')
  })
})

describe('every admin write is confirmed first', () => {
  it('each write tool is mode write with a confirmation card', () => {
    const { list } = tools(OWNER, 'u-owner')
    const writes = list.filter((t) => ADMIN_WRITE_TOOLS.includes(t.name))
    expect(writes.length).toBe(ADMIN_WRITE_TOOLS.length)
    for (const t of writes) { expect(t.mode, t.name).toBe('write'); expect(typeof t.confirm, t.name).toBe('function') }
  })

  it('the engine shows the card and runs nothing until the person confirms (mocked LLM)', async () => {
    const { get, calls } = tools(ADMIN)
    const invite = get('invite_member')
    const run = vi.spyOn(invite, 'run')
    const bodies: any[] = []
    const fetchImpl = vi.fn(async (_u: any, init: any) => {
      bodies.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'invite_member', arguments: JSON.stringify({ email: 'sam@example.com', role: 'member' }) } }] }, finish_reason: 'tool_calls' }], usage: { total_tokens: 2 } }), { status: 200 })
    }) as unknown as typeof fetch
    const conn: AssistantConnection = { provider: 'openai', model: 'm', url: 'https://llm.test/v1/chat/completions', headers: {}, baseUrl: 'https://llm.test' }
    const events: AssistantEvent[] = []
    const r = await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [{ role: 'user', content: 'invite sam' }], tools: [invite], onEvent: (e) => events.push(e), fetchImpl })
    expect(r.status).toBe('awaiting_confirmation')
    expect(run).not.toHaveBeenCalled()
    expect(calls.some((c) => c.name === 'invitations_send')).toBe(false)
    const card = (events.find((e) => e.type === 'confirm') as any).card
    expect(card.title).toBe('Invite sam@example.com as Member')
    // Confirmed: now it runs, through the MCP tool.
    const r2 = await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [{ role: 'user', content: 'invite sam' }, ...r.newMessages], tools: [invite], decision: { tool_call_id: 'c1', approved: true }, onEvent: () => {}, fetchImpl: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Invited.' }, finish_reason: 'stop' }] }), { status: 200 })) as unknown as typeof fetch })
    expect(r2.status).toBe('completed')
    expect(calls.find((c) => c.name === 'invitations_send')?.args).toEqual({ email: 'sam@example.com', role: 'member' })
  })
})

describe('guards: never beyond your own permissions', () => {
  it('permissionsNotHeld counts implied permissions as held', () => {
    expect(permissionsNotHeld(new Set(['workflows.view_runs']), ['workflows.view_queue', 'team.remove'])).toEqual(['team.remove'])
  })

  it('a Manager can\'t invite an Admin; nobody invites an Owner through the Agent', async () => {
    const m = tools(MANAGER, 'u-priya')
    await expect(m.get('invite_member').confirm!({ email: 'x@example.com', role: 'admin' })).rejects.toThrow(/permissions you don't hold/)
    await expect(m.get('invite_member').confirm!({ email: 'x@example.com', role: 'member' })).resolves.toMatchObject({ title: 'Invite x@example.com as Member' })
    const o = tools(OWNER, 'u-owner')
    await expect(o.get('invite_member').confirm!({ email: 'x@example.com', role: 'owner' })).rejects.toThrow(/can't invite owners/)
  })

  it('create / update role: refused when adding a permission you don\'t hold', async () => {
    const limited = new Set(['team.change_roles', 'team.view_members', 'reports.view', 'data.view'])
    const { get } = tools(limited)
    await expect(get('create_role').confirm!({ name: 'Ops', permissions: ['reports.view', 'settings.edit'] })).rejects.toThrow(/settings.edit/)
    const ok = await get('create_role').confirm!({ name: 'Ops', permissions: ['reports.view'] })
    expect(ok.lines[0]).toContain('View reports')
    await expect(get('update_role').confirm!({ role: 'Finance reviewer', add_permissions: ['settings.edit'] })).rejects.toThrow(/don't hold: settings.edit/)
  })

  it('assign role: never one with more than your permissions, never Owner', async () => {
    const limited = new Set(['team.change_roles', 'team.view_members', ...MEMBER])
    const { get } = tools(limited)
    await expect(get('assign_role').confirm!({ person: 'tom@example.com', role: 'Admin' })).rejects.toThrow(/permissions you don't hold/)
    const o = tools(OWNER, 'u-owner')
    await expect(o.get('assign_role').confirm!({ person: 'tom@example.com', role: 'Owner' })).rejects.toThrow(/never assigns the Owner role/)
    const card = await o.get('assign_role').confirm!({ person: 'Tom', role: 'Finance reviewer' })
    expect(card.lines[0]).toBe('Roles: Member → Member, Finance reviewer')
  })

  it('the Owner role is never edited', async () => {
    const { get } = tools(OWNER, 'u-admin')
    await expect(get('update_role').confirm!({ role: 'owner', remove_permissions: ['billing.view'] })).rejects.toThrow(/Owner role can't be edited/)
  })

  it('an Admin can\'t change an Owner\'s access (they outrank them)', async () => {
    const { get } = tools(ADMIN, 'u-admin')
    await expect(get('remove_role').confirm!({ person: 'olive@example.com', role: 'Owner' })).rejects.toThrow(/last owner|Only an owner/)
  })
})

describe('guards: never yourself', () => {
  it('no self role change, no role you hold, no own team / manager / deactivation', async () => {
    const { get } = tools(ADMIN, 'u-admin')
    await expect(get('assign_role').confirm!({ person: 'andy@example.com', role: 'Finance reviewer' })).rejects.toThrow(/your own roles/)
    await expect(get('remove_role').confirm!({ person: 'Andy Admin', role: 'Admin' })).rejects.toThrow(/your own roles/)
    await expect(get('update_role').confirm!({ role: 'Admin', remove_permissions: ['team.remove'] })).rejects.toThrow(/You hold “Admin” yourself/)
    await expect(get('add_team_member').confirm!({ team: 'Finance', person: 'andy@example.com' })).rejects.toThrow(/your own teams/)
    await expect(get('set_manager').confirm!({ person: 'andy@example.com', manager: 'priya@example.com' })).rejects.toThrow(/your own reporting line/)
    await expect(get('set_manager').confirm!({ person: 'tom@example.com', manager: 'andy@example.com' })).rejects.toThrow(/make you someone's manager/)
    await expect(get('deactivate_member').confirm!({ person: 'andy@example.com' })).rejects.toThrow(/your own membership/)
  })
})

describe('last-owner protection', () => {
  it('the Agent refuses to remove the last owner\'s Owner role or deactivate them', async () => {
    const { get } = tools(OWNER, 'u-owner')
    await expect(get('remove_role').confirm!({ person: 'Andy Admin', role: 'Admin' })).resolves.toBeTruthy()
    const w = world()
    w.tables.user_roles.push({ tenant_id: 't1', user_id: 'u-admin', role_id: 'r-owner' })
    const two = tools(OWNER, 'u-admin', {}, w)
    // Two owners: an owner may remove another's Owner role…
    await expect(two.get('remove_role').confirm!({ person: 'olive@example.com', role: 'Owner' })).resolves.toMatchObject({ title: 'Remove the Owner role from Olive Owner' })
    // …but with one owner left it is refused.
    const one = tools(OWNER, 'u-admin')
    await expect(one.get('remove_role').confirm!({ person: 'olive@example.com', role: 'Owner' })).rejects.toThrow(/last owner/)
    await expect(one.get('deactivate_member').confirm!({ person: 'olive@example.com' })).rejects.toThrow(/last owner/)
  })

  it('the service refuses too (deactivating the last owner)', async () => {
    const w = world()
    const ctx: ServiceContext = { tenantId: 't1', actorId: 'u-admin', permissions: OWNER, supabase: w.client, authKind: 'mcp', source: 'mcp', via: 'agent' }
    await expect(deactivateMember(ctx, 'u-owner')).rejects.toThrow(/last owner/)
    await expect(deactivateMember(ctx, 'u-admin')).rejects.toThrow(/yourself/)
  })
})

describe('destructive member removal', () => {
  it('a red card with typed confirmation, the impact listed, and it runs only on confirm', async () => {
    const { get, deactivate } = tools(ADMIN, 'u-admin')
    const card = await get('deactivate_member').confirm!({ person: 'priya@example.com' })
    expect(card.danger).toBe(true)
    expect(card.typed_confirm).toBe('deactivate priya@example.com')
    expect(card.confirm_label).toBe('Deactivate Priya Shah')
    expect(card.lines.join(' ')).toContain('Roles removed: “Manager”')
    expect(card.warnings.join(' ')).toContain('2 workflows')
    expect(deactivate).not.toHaveBeenCalled()
    const e = env()
    await get('deactivate_member').run({ person: 'priya@example.com' }, e.env)
    expect(deactivate).toHaveBeenCalledWith(expect.anything(), 'u-priya')
    expect(e.events[0]).toMatchObject({ type: 'changed', kind: 'member', href: '/team' })
  })

  it('removing from a team says what access goes with it', async () => {
    const { get } = tools(ADMIN, 'u-admin')
    const card = await get('remove_team_member').confirm!({ team: 'Finance', person: 'Priya' })
    expect(card.warnings[0]).toBe('This removes their access to what is shared with the team: 2 workflows')
  })
})

describe('audit', () => {
  it('deactivating writes the governance log and an audit row marked as made via the Agent', async () => {
    const w = world()
    const ctx: ServiceContext = { tenantId: 't1', actorId: 'u-owner', permissions: OWNER, supabase: w.client, authKind: 'mcp', source: 'mcp', via: 'agent' }
    const r = await deactivateMember(ctx, 'u-tom')
    expect(r).toMatchObject({ deactivated: true, roles_removed: ['Member'] })
    expect(w.tables.user_memberships.find((m: any) => m.user_id === 'u-tom').is_active).toBe(false)
    expect(w.tables.user_roles.some((m: any) => m.user_id === 'u-tom')).toBe(false)
    expect(w.inserts.find((i) => i.table === 'permission_audit_log')?.row).toMatchObject({ action: 'member_deactivated', target_user_id: 'u-tom', actor_id: 'u-owner' })
    expect(w.inserts.find((i) => i.table === 'object_audit_log')?.row).toMatchObject({ object_type: 'member', object_id: 'u-tom', action: 'revoke', metadata: { via: 'mcp', agent: true } })
  })

  it('service audit rows and MCP audit rows carry agent: true for the Agent\'s calls only', async () => {
    const w = world()
    await audit({ tenantId: 't1', actorId: 'u1', permissions: null, supabase: w.client, authKind: 'mcp', source: 'mcp', via: 'agent' }, { objectType: 'role', objectId: 'r1', action: 'grant' })
    await audit({ tenantId: 't1', actorId: 'u1', permissions: null, supabase: w.client, authKind: 'mcp', source: 'mcp' }, { objectType: 'role', objectId: 'r2', action: 'grant' })
    const rows = w.inserts.filter((i) => i.table === 'object_audit_log').map((i) => i.row)
    expect(rows[0].metadata).toMatchObject({ via: 'mcp', agent: true })
    expect(rows[1].metadata.agent).toBeUndefined()
    auditToolCall({ tenantId: 't1', supabase: w.client, actingUserId: 'u1', keyType: 'user', permissions: [...OWNER], via: 'agent' }, 'retention_policies_create', { name: 'x' }, { content: [{ type: 'text', text: '{"retention_policy":{"id":"p1"}}' }] })
    await new Promise((r) => setTimeout(r, 0))
    expect(w.inserts.filter((i) => i.table === 'object_audit_log').at(-1)?.row.metadata).toMatchObject({ tool: 'retention_policies_create', agent: true })
  })
})

describe('CSV org import previews before writing', () => {
  const CSV = 'email,manager_email,department\ntom@example.com,priya@example.com,Finance\n'
  const plan = { dry_run: true, summary: { total: 1, create: 0, update: 1, unchanged: 0, errors: 0 }, rows: [{ row: 2, email: 'tom@example.com', user_id: 'u-tom', action: 'update', changes: { manager_email: { before: null, after: 'priya@example.com' }, department: { before: null, after: 'Finance' } }, errors: [] }], org_units: { create: ['Finance'], existing: [] }, teams: { create: [], existing: [] }, cycles: [] }

  it('the card is the dry run; nothing is applied until confirmed', async () => {
    const { get, calls } = tools(ADMIN, 'u-admin', { org_import: (a) => (a.dry_run === false ? { applied: true, people_updated: 1 } : plan) })
    const card = await get('org_import_csv').confirm!({ csv: CSV })
    expect(calls.filter((c) => c.name === 'org_import').map((c) => c.args.dry_run)).toEqual([true])
    expect(card.preview?.caption).toMatch(/nothing is written until you confirm/)
    expect(card.preview?.rows[0]).toEqual(['2', 'tom@example.com', 'update', expect.stringContaining('manager_email: — → priya@example.com')])
    expect(card.lines.join(' ')).toContain('New org units: “Finance”')
    await get('org_import_csv').run({ csv: CSV }, env().env)
    expect(calls.filter((c) => c.name === 'org_import').map((c) => c.args.dry_run)).toEqual([true, true, false])
  })

  it('rows that would make you a manager are refused', async () => {
    const mine = { ...plan, rows: [{ ...plan.rows[0], changes: { manager_email: { before: null, after: 'andy@example.com' } } }] }
    const { get } = tools(ADMIN, 'u-admin', { org_import: () => mine })
    await expect(get('org_import_csv').confirm!({ csv: CSV })).rejects.toThrow(/never changes your own access/)
  })
})

describe('explaining access (read-only)', () => {
  it('why can\'t Tom see the Build menu: what is missing and which roles give it', async () => {
    const { get, calls } = tools(ADMIN, 'u-admin')
    const r: any = (await get('explain_access').run({ person: 'Tom', area: 'Build menu' }, env().env)).result
    expect(r.area.kind).toBe('menu')
    expect(r.area.can_see).toBe(false)
    expect(r.area.missing.map((m: any) => m.permission)).toContain('workflows.view')
    expect(r.area.missing.find((m: any) => m.permission === 'workflows.view').roles_that_give_it).toEqual(expect.arrayContaining(['Manager', 'Admin']))
    expect(calls.every((c) => !/_(create|update|delete|set|manage|send|add|remove)/.test(c.name))).toBe(true)
  })

  it('nav requirements and leaf diffs', () => {
    expect(navRequirement('Reports')).toMatchObject({ kind: 'page', needs_any_of: [{ permission: 'reports.view' }] })
    expect(navRequirement('nonsense')).toBeNull()
    expect(leafDiff({ colors: { light: { primary: '#111' } }, x: 1 }, { colors: { light: { primary: '#222' } }, x: 1 })).toEqual([{ path: 'colors.light.primary', before: '#111', after: '#222' }])
  })

  it('instructions: least privilege, preview, impact, refusals', () => {
    const i = assistantInstructions({ groups: [], admin: { canChange: true } })
    expect(i).toContain('Least privilege')
    expect(i).toContain('Always preview')
    expect(i).toContain('impact')
    expect(i).not.toContain('no form, task or building tools')
    expect(assistantInstructions({ groups: [], admin: { canChange: false } })).toContain('read-only admin help')
  })
})

/* Keep the type import used. */
export type _T = AssistantToolDef
