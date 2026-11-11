/**
 * The getting-started guide on the server (lib/services/onboarding.ts) and
 * in-app feedback (lib/services/feedback.ts), with the database reads
 * mocked: each item's done detection, the state a person gets (permission
 * filtering, workspace setting), choices written to their own row only, the
 * admin setting, and feedback delivery with the workspace and person attached.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- loose mock client */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/services/assistants', () => ({ getAssistantAvailability: vi.fn(async () => ({ agent: false })) }))
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => undefined) }))
const rateLimit = vi.fn(async () => ({ ok: true }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...(a as [])) }))

import { detectItemDone, getOnboardingState, saveOnboardingChoice, setOnboardingSettings, type DoneFacts } from '@/lib/services/onboarding'
import { sendFeedback } from '@/lib/services/feedback'
import { getAssistantAvailability } from '@/lib/services/assistants'
import type { ServiceContext } from '@/lib/services/context'
import { expandPermissions } from '@/lib/permissions'
import { SYSTEM_ROLES } from '@/lib/tenant-provisioning'
import { KITCHEN_SINK_NAME } from '@/lib/kitchen-sink/build'

type Call = { table: string; ops: Array<[string, unknown[]]> }
type Responder = (call: Call) => { data?: unknown; count?: number | null; error?: unknown }

/** A PostgREST-ish chain: records every call, answers with the responder when awaited. */
function mockDb(respond: Responder) {
  const calls: Call[] = []
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] }
      calls.push(call)
      const chain: any = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === 'then') {
            const r = respond(call)
            return (ok: (v: unknown) => unknown) => Promise.resolve({ data: r.data ?? null, count: r.count ?? null, error: r.error ?? null }).then(ok)
          }
          return (...args: unknown[]) => { call.ops.push([prop, args]); return chain }
        },
      })
      return chain
    },
  }
  return { db, calls }
}
const has = (call: Call, op: string, ...args: unknown[]) => call.ops.some(([o, a]) => o === op && JSON.stringify(a.slice(0, args.length)) === JSON.stringify(args))

const T = 'tenant-1'
const ME = 'user-1'
const facts = (respond: Responder, over: Partial<DoneFacts> = {}): DoneFacts => ({ db: mockDb(respond).db as any, tenantId: T, userId: ME, agentAvailable: false, stored: {}, ...over })

function ctx(db: unknown, role = 'owner'): ServiceContext {
  return {
    db: db as any, supabase: db as any, tenantId: T, actorId: ME,
    permissions: new Set(expandPermissions(SYSTEM_ROLES.find((r) => r.slug === role)!.permissions)),
    authKind: 'api_key', source: 'api', keyType: 'user',
  }
}

describe('done detection', () => {
  it('Gallery: any package installed in this workspace', async () => {
    const seen: Call[] = []
    expect(await detectItemDone('gallery', facts((c) => { seen.push(c); return { count: 1 } }))).toBe(true)
    expect(seen[0].table).toBe('package_installs')
    expect(has(seen[0], 'eq', 'tenant_id', T)).toBe(true)
    expect(await detectItemDone('gallery', facts(() => ({ count: 0 })))).toBe(false)
  })

  it('Theme: a logo, or a theme someone saved (not the provisioned default)', async () => {
    const theme = (logo: string | null, themes: number) => facts((c) => c.table === 'tenants' ? { data: [{ branding: logo ? { logo_url: logo } : {} }] } : { count: themes })
    expect(await detectItemDone('theme', theme(null, 0))).toBe(false)
    expect(await detectItemDone('theme', theme('storage://logos/t/logo.png', 0))).toBe(true)
    expect(await detectItemDone('theme', theme(null, 1))).toBe(true)
    const seen: Call[] = []
    await detectItemDone('theme', facts((c) => { seen.push(c); return { count: 0, data: [] } }))
    expect(has(seen.find((c) => c.table === 'workspace_themes')!, 'or', 'version.gt.1,updated_by.not.is.null')).toBe(true)
  })

  it('Team: an invitation sent, or more than one member', async () => {
    const team = (invites: number, members: number) => facts((c) => ({ count: c.table === 'invitations' ? invites : members }))
    expect(await detectItemDone('team', team(0, 1))).toBe(false)
    expect(await detectItemDone('team', team(1, 1))).toBe(true)
    expect(await detectItemDone('team', team(0, 2))).toBe(true)
  })

  it('SSO: an enabled directory connection', async () => {
    const seen: Call[] = []
    expect(await detectItemDone('sso', facts((c) => { seen.push(c); return { count: 1 } }))).toBe(true)
    expect(seen[0].table).toBe('tenant_connectors')
    expect(has(seen[0], 'eq', 'is_enabled', true)).toBe(true)
    expect(await detectItemDone('sso', facts(() => ({ count: 0 })))).toBe(false)
  })

  it('Agent: available to the person', async () => {
    expect(await detectItemDone('agent', facts(() => ({}), { agentAvailable: true }))).toBe(true)
    expect(await detectItemDone('agent', facts(() => ({}), { agentAvailable: false }))).toBe(false)
  })

  it('Build: a form or workflow that is not from a package or the self-test', async () => {
    const build = (workflows: unknown[], forms: unknown[], packaged: unknown[]) => facts((c) => ({ data: c.table === 'workflows' ? workflows : c.table === 'forms' ? forms : packaged }))
    expect(await detectItemDone('build', build([], [], []))).toBe(false)
    expect(await detectItemDone('build', build([{ id: 'w1', name: 'Leave request' }], [], [{ local_id: 'w1' }]))).toBe(false)
    expect(await detectItemDone('build', build([{ id: 'w2', name: KITCHEN_SINK_NAME }], [{ id: 'f1', name: 'Kitchen sink human check' }], []))).toBe(false)
    expect(await detectItemDone('build', build([], [{ id: 'f2', name: 'Expense claim' }], []))).toBe(true)
  })

  it('Self-test: the kitchen sink workflow is installed', async () => {
    const seen: Call[] = []
    expect(await detectItemDone('selftest', facts((c) => { seen.push(c); return { count: 1 } }))).toBe(true)
    expect(has(seen[0], 'eq', 'name', KITCHEN_SINK_NAME)).toBe(true)
  })

  it('Fill in a form: the person submitted one here', async () => {
    const seen: Call[] = []
    expect(await detectItemDone('form', facts((c) => { seen.push(c); return { count: 2 } }))).toBe(true)
    expect(has(seen[0], 'eq', 'submitted_by', ME)).toBe(true)
  })

  it('visit items: done once visited', async () => {
    for (const id of ['tutorials', 'tasks', 'meet_agent', 'notifications'] as const) {
      expect(await detectItemDone(id, facts(() => ({}))), id).toBe(false)
      expect(await detectItemDone(id, facts(() => ({}), { stored: { visited: [id] } })), id).toBe(true)
    }
  })

  it('a failing read is "not done", never an error', async () => {
    expect(await detectItemDone('gallery', facts(() => ({ error: { message: 'boom' } })))).toBe(false)
  })
})

describe('the state a person gets', () => {
  beforeEach(() => vi.mocked(getAssistantAvailability).mockResolvedValue({ agent: false } as any))

  const state = (role: string, opts: { settings?: unknown; prefs?: unknown } = {}) => {
    const { db } = mockDb((c) => {
      if (c.table === 'tenants' && has(c, 'maybeSingle')) return { data: { created_at: '2026-11-10T00:00:00Z', settings: opts.settings ?? {} } }
      if (c.table === 'users') return { data: { preferences: opts.prefs ?? {}, created_at: '2026-11-10T00:00:00Z', tenant_id: T } }
      if (c.table === 'user_memberships') return { data: { joined_at: '2026-11-10T01:00:00Z' } }
      return { count: 0, data: [] }
    })
    return getOnboardingState(ctx(db, role))
  }

  it('an owner: the admin checklist, filtered by permission, Agent and Gallery first', async () => {
    const s = (await state('owner'))!
    expect(s.audience).toBe('admin')
    expect(s.items.map((i) => i.id)).toEqual(['agent', 'gallery', 'theme', 'team', 'sso', 'build', 'selftest', 'tutorials'])
    expect(s.items.every((i) => i.done === false)).toBe(true)
    expect(s.joined_at).toBe('2026-11-10T01:00:00Z')
    expect(s.settings.show_to_members).toBe(true)
  })

  it('a member: the member checklist; "Meet the Agent" only when available', async () => {
    expect((await state('member'))!.items.map((i) => i.id)).toEqual(['tasks', 'form', 'notifications'])
    vi.mocked(getAssistantAvailability).mockResolvedValue({ agent: true } as any)
    expect((await state('member'))!.items.map((i) => i.id)).toEqual(['tasks', 'form', 'meet_agent', 'notifications'])
  })

  it('reads the workspace setting and this workspace\'s stored choices', async () => {
    const s = (await state('member', { settings: { onboarding: { show_to_members: false } }, prefs: { onboarding: { [T]: { status: 'never', never_at: '2026-11-10T02:00:00Z' }, other: { status: 'snoozed' } } } }))!
    expect(s.settings.show_to_members).toBe(false)
    expect(s.stored.status).toBe('never')
  })
})

describe('choices', () => {
  it('writes only the caller\'s own row, merged into their preferences for this workspace', async () => {
    const { db, calls } = mockDb((c) => c.table === 'users' && has(c, 'select') ? { data: { preferences: { queue_rules: { v: 2 }, onboarding: { other: { status: 'never' } } } } } : {})
    const now = new Date('2026-11-11T00:00:00Z')
    const stored = await saveOnboardingChoice(ctx(db, 'viewer'), { kind: 'never' }, now)
    expect(stored).toMatchObject({ status: 'never', never_at: now.toISOString() })
    const update = calls.find((c) => c.ops.some(([o]) => o === 'update'))!
    expect(has(update, 'eq', 'id', ME)).toBe(true)
    const written = update.ops.find(([o]) => o === 'update')![1][0] as any
    expect(written.preferences.queue_rules).toEqual({ v: 2 })
    expect(written.preferences.onboarding.other).toEqual({ status: 'never' })
    expect(written.preferences.onboarding[T].status).toBe('never')
  })

  it('rejects unknown choices', async () => {
    const { db } = mockDb(() => ({ data: { preferences: {} } }))
    await expect(saveOnboardingChoice(ctx(db), { kind: 'drop_table' })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(saveOnboardingChoice(ctx(db), { kind: 'visit', item: 'not-an-item' })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('the member setting needs settings.edit', async () => {
    const { db, calls } = mockDb((c) => c.table === 'tenants' && has(c, 'select') ? { data: { id: T, settings: { tasks: { a: 1 } } } } : {})
    await expect(setOnboardingSettings(ctx(db, 'member'), { show_to_members: false })).rejects.toMatchObject({ code: 'forbidden' })
    const result = await setOnboardingSettings(ctx(db, 'admin'), { show_to_members: false })
    expect(result).toEqual({ show_to_members: false })
    const written = calls.find((c) => c.ops.some(([o]) => o === 'update'))!.ops.find(([o]) => o === 'update')![1][0] as any
    expect(written.settings).toEqual({ tasks: { a: 1 }, onboarding: { show_to_members: false } })
  })
})

describe('feedback', () => {
  const env = { ...process.env }
  afterEach(() => { process.env = { ...env }; vi.restoreAllMocks(); rateLimit.mockClear() })
  const db = () => mockDb((c) => c.table === 'users'
    ? { data: { email: 'ada@example.com', display_name: 'Ada <Owner>' } }
    : { data: { name: 'Acme & Co', slug: 'acme' } }).db

  it('goes through the contact pipeline with the workspace and person attached server-side', async () => {
    process.env.CHIRPME_API_KEY = 'k'; process.env.CHIRPME_CHANNEL_ID = 'c'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    await sendFeedback(ctx(db(), 'member'), { message: 'The checklist is great. More HR solutions please.', category: 'idea', rating: 4, page: '/home' })
    expect(rateLimit).toHaveBeenCalledWith(`feedback:${ME}`, expect.objectContaining({ max: 5 }))
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(payload.detail).toContain('ada@example.com')
    expect(payload.detail).toContain('Ada &lt;Owner&gt;')
    expect(payload.detail).toContain('Acme &amp; Co')
    expect(payload.detail).toContain(T)
    expect(payload.detail).toContain('★★★★☆')
    expect(payload.title).toContain('idea')
  })

  it('is rate limited, validated, and unavailable without a configured pipeline', async () => {
    process.env.CHIRPME_API_KEY = 'k'; process.env.CHIRPME_CHANNEL_ID = 'c'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    rateLimit.mockResolvedValueOnce({ ok: false })
    await expect(sendFeedback(ctx(db()), { message: 'Hello there team' })).rejects.toMatchObject({ status: 429 })
    await expect(sendFeedback(ctx(db()), { message: 'hi' })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(sendFeedback(ctx(db()), { message: 'Hello there team', page: 'https://evil.example' })).rejects.toMatchObject({ code: 'validation_error' })
    process.env.CHIRPME_CHANNEL_ID = ''
    await expect(sendFeedback(ctx(db()), { message: 'Hello there team' })).rejects.toMatchObject({ status: 503 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
