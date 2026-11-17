/**
 * Team requests: notifyTeam (lib/contact/team-requests) keeps a row per
 * request and sends the ChirpMe notification; the service behind Settings →
 * Requests (lib/services/team-requests) is instance-admin only, filters /
 * searches / pages with a keyset cursor and audits status changes; the page
 * 404s for everyone else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call = [string, unknown[]]
interface Query { table: string; calls: Call[] }

const state = vi.hoisted(() => ({
  hasDb: true,
  queries: [] as Query[],
  respond: (_q: Query): { data?: unknown; error?: unknown } => ({ data: null, error: null }),
}))

/** A chainable supabase-js stand-in: records every call, answers through state.respond when awaited. */
function fakeClient() {
  return {
    from(table: string) {
      const q: Query = { table, calls: [] }
      state.queries.push(q)
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'insert', 'update', 'eq', 'in', 'or', 'order', 'limit', 'single', 'maybeSingle']) {
        builder[m] = (...args: unknown[]) => { q.calls.push([m, args]); return builder }
      }
      builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        try { return Promise.resolve(state.respond(q)).then(resolve, reject) } catch (e) { return Promise.reject(e).then(resolve, reject) }
      }
      return builder
    },
  }
}

vi.mock('@/lib/providers/db', () => ({
  hasServiceDb: () => state.hasDb,
  getServiceDb: () => fakeClient(),
}))

const sendEmail = vi.fn()
vi.mock('@/lib/email', () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }))

const admin = vi.hoisted(() => ({ allowed: true }))
vi.mock('@/lib/admin/infrastructure', () => ({ viewerCanSeeInfrastructure: async () => admin.allowed }))

import { cleanFacts, notifyTeam, teamNotifyAvailable, teamRequestsEnabled } from '@/lib/contact/team-requests'
import {
  decodeCursor, encodeCursor, getTeamRequest, listTeamRequests, updateTeamRequest,
} from '@/lib/services/team-requests'

const message = {
  title: 'New UserTasks contact — Jordan Ellis',
  body: 'Jordan Ellis from Northwind Traders (jordan@northwind.example) sent a website enquiry.',
  url: 'https://usertasks.com/contact',
  detail: '<h2>New website enquiry</h2><p><strong>Name:</strong> Jordan Ellis</p>',
  replyTo: 'jordan@northwind.example',
}
const ROW_ID = '11111111-1111-4111-8111-111111111111'
const call = (q: Query | undefined, method: string) => q?.calls.find(([m]) => m === method)?.[1]
const inserts = (table: string) => state.queries.filter((q) => q.table === table && call(q, 'insert'))
const updates = (table: string) => state.queries.filter((q) => q.table === table && call(q, 'update'))

beforeEach(() => {
  state.hasDb = true
  state.queries = []
  state.respond = (q) => (call(q, 'insert') && q.table === 'team_requests' ? { data: { id: ROW_ID }, error: null } : { data: null, error: null })
  sendEmail.mockReset()
  admin.allowed = true
  vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
  vi.stubEnv('CHIRPME_API_KEY', 'test-key')
  vi.stubEnv('CHIRPME_CHANNEL_ID', 'test-channel')
  vi.stubEnv('TEAM_NOTIFY_EMAIL', '')
  vi.stubEnv('TEAM_REQUESTS_ENABLED', '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('notifyTeam', () => {
  it('writes the row first, sends ChirpMe, then records the delivery', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await notifyTeam({ kind: 'contact', message, name: 'Jordan Ellis', email: 'jordan@northwind.example', company: 'Northwind Traders', facts: { message: 'Hello' } })

    expect(result).toMatchObject({ ok: true, id: ROW_ID, stored: true, delivered: { ok: true }, delivery: { chirp: 'ok', email: 'unconfigured' } })
    const [insert] = inserts('team_requests')
    expect(state.queries.indexOf(insert)).toBe(0)
    expect(call(insert, 'insert')?.[0]).toMatchObject({
      kind: 'contact', title: message.title, summary: message.body, name: 'Jordan Ellis', email: 'jordan@northwind.example',
      company: 'Northwind Traders', reply_to: 'jordan@northwind.example', url: message.url, facts: { message: 'Hello' }, detail_html: message.detail,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(payload.title).toBe(message.title)
    // The notification links to the request; the stored detail is the original.
    expect(payload.detail).toContain(`/settings/requests?id=${ROW_ID}`)
    const [update] = updates('team_requests')
    expect(call(update, 'update')?.[0]).toMatchObject({ delivery: { chirp: 'ok', email: 'unconfigured' } })
    expect(call(update, 'eq')).toEqual(['id', ROW_ID])
  })

  it('keeps the row when ChirpMe fails, and still reports ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
    const result = await notifyTeam({ kind: 'feedback', message })
    expect(result).toMatchObject({ ok: true, stored: true, delivered: { ok: false, reason: 'failed' } })
    expect(call(updates('team_requests')[0], 'update')?.[0]).toMatchObject({ delivery: { chirp: 'failed', chirp_status: 503 } })
  })

  it('keeps the row when ChirpMe throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const result = await notifyTeam({ kind: 'feedback', message })
    expect(result).toMatchObject({ ok: true, stored: true, delivery: { chirp: 'failed' } })
  })

  it('sends ChirpMe when the insert fails (error or throw), and logs it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    state.respond = (q) => (call(q, 'insert') ? { data: null, error: { message: 'relation "team_requests" does not exist', code: '42P01' } } : { data: null, error: null })
    const result = await notifyTeam({ kind: 'contact', message })
    expect(result).toMatchObject({ ok: true, id: null, stored: false, delivered: { ok: true } })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).detail).toBe(message.detail)
    expect(updates('team_requests')).toHaveLength(0)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('team request insert failed'))

    state.respond = () => { throw new Error('boom') }
    expect(await notifyTeam({ kind: 'contact', message })).toMatchObject({ ok: true, stored: false })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fails only when the row AND every channel failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })))
    state.respond = (q) => (call(q, 'insert') ? { data: null, error: { message: 'down' } } : { data: null, error: null })
    expect(await notifyTeam({ kind: 'contact', message })).toMatchObject({ ok: false, stored: false, delivered: { ok: false, reason: 'failed' } })
  })

  it('never throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('x')))
    state.respond = () => { throw new Error('db exploded') }
    await expect(notifyTeam({ kind: 'trial', message })).resolves.toMatchObject({ ok: false })
  })

  it('self-hosted: no row unless TEAM_REQUESTS_ENABLED=true; nothing at all without ChirpMe', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'self_hosted')
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(teamRequestsEnabled()).toBe(false)
    expect(await notifyTeam({ kind: 'feedback', message })).toMatchObject({ ok: true, stored: false })
    expect(inserts('team_requests')).toHaveLength(0)

    vi.stubEnv('CHIRPME_API_KEY', '')
    expect(teamNotifyAvailable()).toBe(false)
    fetchMock.mockClear()
    expect(await notifyTeam({ kind: 'feedback', message })).toMatchObject({ ok: false, delivered: { reason: 'unconfigured' } })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(inserts('team_requests')).toHaveLength(0)

    vi.stubEnv('TEAM_REQUESTS_ENABLED', 'true')
    expect(teamNotifyAvailable()).toBe(true)
    expect(await notifyTeam({ kind: 'feedback', message })).toMatchObject({ ok: true, stored: true, delivery: { chirp: 'unconfigured' } })
    expect(inserts('team_requests')).toHaveLength(1)
  })

  it('cloud records by default, but not without a service database', async () => {
    expect(teamRequestsEnabled()).toBe(true)
    vi.stubEnv('TEAM_REQUESTS_ENABLED', 'false')
    expect(teamRequestsEnabled()).toBe(false)
    vi.stubEnv('TEAM_REQUESTS_ENABLED', '')
    state.hasDb = false
    vi.stubEnv('CHIRPME_API_KEY', '')
    expect(teamNotifyAvailable()).toBe(false)
  })

  it('stores bounded, JSON-safe facts and clipped fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    expect(cleanFacts({ farm_id: 'f-1', rating: 4, ok: true, empty: '', none: null, list: ['a', 1], nan: Number.NaN })).toEqual({ farm_id: 'f-1', rating: 4, ok: true, list: ['a', 1] })
    await notifyTeam({ kind: 'nonsense' as never, message: { ...message, title: 'x'.repeat(900) }, name: '  ' })
    const values = call(inserts('team_requests')[0], 'insert')?.[0] as Record<string, unknown>
    expect(values.kind).toBe('other')
    expect(String(values.title)).toHaveLength(500)
    expect(values.name).toBeNull()
  })
})

describe('team requests service: instance admins only', () => {
  const viewer = { id: '22222222-2222-4222-8222-222222222222', email: 'ops@usertasks.com' }

  it('refuses signed-out callers and non-admins before touching the table', async () => {
    await expect(listTeamRequests(null)).rejects.toMatchObject({ code: 'unauthorized' })
    admin.allowed = false
    await expect(listTeamRequests(viewer)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(getTeamRequest(viewer, ROW_ID)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(updateTeamRequest(viewer, ROW_ID, { status: 'handled' })).rejects.toMatchObject({ code: 'forbidden' })
    // An injected check wins too.
    admin.allowed = true
    await expect(listTeamRequests(viewer, {}, { check: async () => false })).rejects.toMatchObject({ code: 'forbidden' })
    expect(state.queries).toHaveLength(0)
  })

  it('lists Open (new + in progress) by default, newest first, one extra row to know about a next page', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `0000000${i}-0000-4000-8000-000000000000`, created_at: `2026-11-1${6 - i}T10:00:00.000000+00:00`, kind: 'contact', title: `t${i}`, status: 'new' }))
    state.respond = () => ({ data: rows, error: null })
    const page = await listTeamRequests(viewer, { limit: 2 })
    const q = state.queries[0]
    expect(q.table).toBe('team_requests')
    expect(call(q, 'select')?.[0]).not.toContain('detail_html')
    expect(call(q, 'in')).toEqual(['status', ['new', 'in_progress']])
    expect(q.calls.filter(([m]) => m === 'order').map(([, a]) => a)).toEqual([['created_at', { ascending: false }], ['id', { ascending: false }]])
    expect(call(q, 'limit')).toEqual([3])
    expect(page.items).toHaveLength(2)
    expect(decodeCursor(page.nextCursor!)).toEqual({ createdAt: rows[1].created_at, id: rows[1].id })
  })

  it('filters by kind and status, searches name / email / company / title safely', async () => {
    state.respond = () => ({ data: [], error: null })
    const page = await listTeamRequests(viewer, { kind: 'beta_signup', status: 'handled', q: 'acme, (inc)%' })
    const q = state.queries[0]
    expect(call(q, 'eq')).toEqual(['status', 'handled'])
    expect(q.calls.filter(([m]) => m === 'eq').map(([, a]) => a)).toContainEqual(['kind', 'beta_signup'])
    expect(call(q, 'in')).toBeUndefined()
    const search = String(call(q, 'or')?.[0])
    expect(search).toBe('name.ilike.%acme   inc \\%%,email.ilike.%acme   inc \\%%,company.ilike.%acme   inc \\%%,title.ilike.%acme   inc \\%%')
    expect(page).toEqual({ items: [], nextCursor: null })

    state.queries = []
    await listTeamRequests(viewer, { status: 'all', kind: 'all' })
    expect(call(state.queries[0], 'in')).toBeUndefined()
    expect(call(state.queries[0], 'eq')).toBeUndefined()
  })

  it('pages with the keyset cursor and refuses a forged one', async () => {
    state.respond = () => ({ data: [], error: null })
    const cursor = encodeCursor({ created_at: '2026-11-16T10:00:00.5+00:00', id: ROW_ID })
    await listTeamRequests(viewer, { cursor, q: 'jordan' })
    const ors = state.queries[0].calls.filter(([m]) => m === 'or').map(([, a]) => a[0])
    expect(ors).toContain(`created_at.lt."2026-11-16T10:00:00.5+00:00",and(created_at.eq."2026-11-16T10:00:00.5+00:00",id.lt.${ROW_ID})`)
    expect(ors).toHaveLength(2)
    await expect(listTeamRequests(viewer, { cursor: Buffer.from(JSON.stringify(['x', 'id),or(1.eq.1'])).toString('base64url') })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(listTeamRequests(viewer, { kind: 'bogus' as never })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('explains a missing migration', async () => {
    state.respond = () => ({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } })
    await expect(listTeamRequests(viewer)).rejects.toThrow(/20270116120000_team_requests/)
  })

  it('a status change is written, closes the request and is audited (request history + workspace audit log)', async () => {
    const before = { id: ROW_ID, kind: 'contact', status: 'new', note: null }
    state.respond = (q) => {
      if (q.table === 'team_requests' && call(q, 'select')?.[0] === 'id, kind, status, note') return { data: before, error: null }
      if (q.table === 'team_requests' && call(q, 'select')?.[0] === '*') return { data: { ...before, status: 'handled', facts: {}, delivery: {} }, error: null }
      if (q.table === 'users') return { data: { tenant_id: 'tenant-home', current_tenant_id: 'tenant-current' }, error: null }
      return { data: [], error: null }
    }
    const detail = await updateTeamRequest(viewer, ROW_ID, { status: 'handled', note: '  Replied with pricing  ' })
    expect(detail.status).toBe('handled')

    const patch = call(updates('team_requests')[0], 'update')?.[0] as Record<string, unknown>
    expect(patch).toMatchObject({ status: 'handled', handled_by: viewer.id, note: 'Replied with pricing' })
    expect(typeof patch.handled_at).toBe('string')

    expect(call(inserts('team_request_events')[0], 'insert')?.[0]).toMatchObject({
      request_id: ROW_ID, actor_id: viewer.id, actor_email: viewer.email, from_status: 'new', to_status: 'handled', note: 'Replied with pricing',
    })
    const audit = call(inserts('object_audit_log')[0], 'insert')?.[0] as Record<string, unknown>
    expect(audit).toMatchObject({ tenant_id: 'tenant-current', actor_id: viewer.id, object_type: 'team_request', object_id: ROW_ID, action: 'update', diff: { status: { before: 'new', after: 'handled' } } })
    // No personal details in the workspace audit row.
    expect(JSON.stringify(audit)).not.toContain('Replied with pricing')
    expect(String(audit.summary)).toBe('Team request (Contact) marked Handled')
  })

  it('reopening clears handled_by / handled_at; an unchanged save writes nothing', async () => {
    const before = { id: ROW_ID, kind: 'feedback', status: 'handled', note: 'n' }
    state.respond = (q) => (q.table === 'team_requests' && call(q, 'select') ? { data: { ...before, facts: {}, delivery: {} }, error: null } : { data: [], error: null })
    await updateTeamRequest(viewer, ROW_ID, { status: 'in_progress' })
    expect(call(updates('team_requests')[0], 'update')?.[0]).toMatchObject({ status: 'in_progress', handled_by: null, handled_at: null })

    state.queries = []
    await updateTeamRequest(viewer, ROW_ID, { status: 'handled', note: 'n' })
    expect(updates('team_requests')).toHaveLength(0)
    expect(inserts('team_request_events')).toHaveLength(0)
    await expect(updateTeamRequest(viewer, ROW_ID, {})).rejects.toMatchObject({ code: 'validation_error' })
    await expect(updateTeamRequest(viewer, ROW_ID, { status: 'closed' as never })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(updateTeamRequest(viewer, 'not-a-uuid', { status: 'handled' })).rejects.toMatchObject({ code: 'not_found' })
  })
})
