/**
 * Every team request goes through notifyTeam with its kind and structured
 * facts: the contact form, docs feedback, in-app feedback and beta signups.
 * The contact form and in-app feedback fail only when notifyTeam reports that
 * neither the row nor any channel worked. Settings → Requests 404s for
 * anyone who isn't an instance admin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const team = vi.hoisted(() => ({
  available: true,
  result: { ok: true } as { ok: boolean },
  calls: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
}))
vi.mock('@/lib/contact/team-requests', () => ({
  teamNotifyAvailable: () => team.available,
  notifyTeam: async (input: Record<string, unknown>) => { team.calls.push(input); return team.result },
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }))

class NotFound extends Error { constructor() { super('NEXT_NOT_FOUND') } }
vi.mock('next/navigation', () => ({ notFound: () => { throw new NotFound() } }))
const session = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }))
vi.mock('@/lib/providers/db/session', () => ({ getSessionDbWithUser: async () => ({ user: session.user }) }))
const admin = vi.hoisted(() => ({ allowed: false, listed: 0 }))
vi.mock('@/lib/admin/infrastructure', () => ({ viewerCanSeeInfrastructure: async () => admin.allowed }))
vi.mock('@/lib/providers/db', () => ({
  hasServiceDb: () => true,
  getServiceDb: () => { admin.listed++; throw new Error('not used') },
}))
vi.mock('@/components/settings/team-requests', () => ({ TeamRequestsView: () => null }))

import { POST as contactPOST } from '@/app/api/contact/route'
import { POST as docsPOST } from '@/app/api/docs-feedback/route'
import { sendFeedback } from '@/lib/services/feedback'
import { notifyBetaSignup } from '@/lib/contact/beta-signup-chirp'
import TeamRequestsPage from '@/app/(dashboard)/settings/requests/page'
import type { ServiceContext } from '@/lib/services/context'

const json = (url: string, body: unknown) => new NextRequest(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
  body: JSON.stringify(body),
})

beforeEach(() => {
  team.available = true
  team.result = { ok: true }
  team.calls = []
  vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('callers', () => {
  it('contact form: kind contact, the person, the message as a fact, Reply-To the sender', async () => {
    const res = await contactPOST(json('https://usertasks.com/api/contact', { name: 'Jordan Ellis', email: 'jordan@northwind.example', company: 'Northwind Traders', comments: 'We would like a demo for 40 people.', website: '' }))
    expect(res.status).toBe(200)
    const [input] = team.calls
    expect(input).toMatchObject({ kind: 'contact', name: 'Jordan Ellis', email: 'jordan@northwind.example', company: 'Northwind Traders', facts: { message: 'We would like a demo for 40 people.' } })
    expect(input.message).toMatchObject({ title: 'New UserTasks contact — Jordan Ellis', replyTo: 'jordan@northwind.example' })
    expect(input.message.detail).toContain('<h2>New website enquiry</h2>')
  })

  it('contact form: 502 only when notifyTeam kept nothing and delivered nothing; 503 when nothing is set up', async () => {
    team.result = { ok: false }
    const body = { name: 'Jordan Ellis', email: 'jordan@northwind.example', company: 'Northwind', comments: 'Please call me back soon.', website: '' }
    expect((await contactPOST(json('https://usertasks.com/api/contact', body))).status).toBe(502)
    team.available = false
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await contactPOST(json('https://usertasks.com/api/contact', body))).status).toBe(503)
    expect(team.calls).toHaveLength(1)
  })

  it('docs feedback: kind docs_feedback with the page, the vote and the comment; no person', async () => {
    const res = await docsPOST(json('https://usertasks.com/api/docs-feedback', { path: '/docs', helpful: false, comment: 'Missing an example' }))
    expect(await res.json()).toEqual({ ok: true, delivered: true })
    const [input] = team.calls
    expect(input).toMatchObject({ kind: 'docs_feedback', facts: { page: '/docs', helpful: false, comment: 'Missing an example' } })
    expect(input.name).toBeUndefined()
    expect(input.email).toBeUndefined()
  })

  it('in-app feedback: kind feedback with the person, workspace, rating, category and page from the session', async () => {
    const db = {
      from(table: string) {
        const chain: Record<string, unknown> = {}
        for (const m of ['select', 'eq']) chain[m] = () => chain
        chain.maybeSingle = async () => (table === 'users'
          ? { data: { email: 'ada@acme.example', display_name: 'Ada' }, error: null }
          : { data: { name: 'Acme', slug: 'acme' }, error: null })
        return chain
      },
    }
    const ctx = { db, supabase: db, tenantId: 'tenant-1', actorId: 'user-1', permissions: null, authKind: 'api_key', source: 'api' } as unknown as ServiceContext
    await sendFeedback(ctx, { message: 'Love the new designer', category: 'praise', rating: 5, page: '/automations' })
    const [input] = team.calls
    expect(input).toMatchObject({
      kind: 'feedback', name: 'Ada', email: 'ada@acme.example', company: 'Acme',
      facts: { message: 'Love the new designer', category: 'praise', rating: 5, page: '/automations', workspace: 'Acme', workspace_slug: 'acme', workspace_id: 'tenant-1', user_id: 'user-1' },
    })
    expect(input.message.replyTo).toBe('ada@acme.example')

    team.result = { ok: false }
    await expect(sendFeedback(ctx, { message: 'Another one here' })).rejects.toMatchObject({ status: 502 })
  })

  it('beta signup: kind beta_signup with company size, workspace and use case; never the password', async () => {
    await notifyBetaSignup({ fullName: 'Sam Lee', email: 'sam@globex.example', company: 'Globex', companySize: '51-200', useCase: 'Purchase approvals in USD', slug: 'globex' })
    const [input] = team.calls
    expect(input).toMatchObject({ kind: 'beta_signup', name: 'Sam Lee', email: 'sam@globex.example', company: 'Globex', facts: { company_size: '51-200', workspace: 'globex', use_case: 'Purchase approvals in USD' } })
    expect(JSON.stringify(input)).not.toMatch(/password/i)

    team.available = false
    await notifyBetaSignup({ fullName: 'A', email: 'a@example.com', company: 'B' })
    expect(team.calls).toHaveLength(1)
  })
})

describe('Settings → Requests page', () => {
  const props = { searchParams: Promise.resolve({}) }

  it('404s for signed-out people and for non-admins, without reading the table', async () => {
    session.user = null
    await expect(TeamRequestsPage(props)).rejects.toBeInstanceOf(NotFound)
    session.user = { id: 'u1', email: 'owner@acme.example' }
    admin.allowed = false
    await expect(TeamRequestsPage(props)).rejects.toBeInstanceOf(NotFound)
    expect(admin.listed).toBe(0)
  })

  it('renders for an instance admin', async () => {
    session.user = { id: 'u1', email: 'ops@usertasks.com' }
    admin.allowed = true
    const element = await TeamRequestsPage({ searchParams: Promise.resolve({ status: 'all', kind: 'trial', q: 'farm' }) }) as { props: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(element.props.filters).toEqual({ kind: 'trial', status: 'all', q: 'farm' })
    // The (mocked) service client threw: the page shows the error instead of crashing.
    expect(element.props.error).toBeTruthy()
  })
})
