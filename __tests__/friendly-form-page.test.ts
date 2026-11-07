/**
 * /form/<system name> access rules (app/form/[name]/page.tsx):
 *  - a member opens the form exactly like /f/<id> (MemberFormPage: the form
 *    alone, no dashboard shell — the same rendering path);
 *  - an earlier name redirects to the current one;
 *  - a visitor who isn't signed in gets the /p/<token> rendering ONLY when the
 *    form takes anonymous responses AND opted in to the friendly public link;
 *    every other case (off, not opted in, unknown name) sends them to the
 *    form sign-in page (/form-login), so names can't be probed;
 *  - a signed-in non-member: the public rendering when allowed, else no access;
 *  - tenant isolation: the name is resolved in the address's workspace only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

class Redirect extends Error { constructor(public url: string) { super(`redirect ${url}`) } }
class NotFound extends Error { constructor() { super('not found') } }
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Redirect(url) },
  permanentRedirect: (url: string) => { throw new Redirect(url) },
  notFound: () => { throw new NotFound() },
}))

const state = vi.hoisted(() => ({
  host: { kind: 'none' } as Record<string, unknown>,
  embed: false,
  user: null as { id: string } | null,
  forms: new Map<string, unknown>(),
  friendly: new Map<string, string>(),
  resolvedTokens: new Map<string, { formId: string; tenantId: string }>(),
  lookups: [] as string[],
}))

vi.mock('@/lib/forms/form-link-visitor', () => ({
  formLinkVisitor: async () => ({ host: state.host, frame: 'top', embed: state.embed, path: '/form/requested' }),
  formLinkUser: async (v: { host: { kind: string } }) => (v.host.kind === 'signed_out' ? null : state.user),
}))
vi.mock('@/lib/services/form-links', () => ({
  resolveFormLink: async (tenantId: string, name: string) => { state.lookups.push(`${tenantId}:${name}`); return state.forms.get(`${tenantId}:${name}`) ?? null },
  friendlyAnonymousToken: async (tenantId: string, formId: string) => state.friendly.get(`${tenantId}:${formId}`) ?? null,
}))
vi.mock('@/lib/services/anonymous-forms', () => ({
  resolveAnonymousForm: async (token: string) => state.resolvedTokens.get(token) ?? null,
  getAnonymousFormPage: async (r: { formId: string }) => ({ form: { id: r.formId, name: 'Contact us', description: null }, options: { allow_indexing: false } }),
}))
vi.mock('@/lib/supabase/server', () => ({ getCachedUser: async () => state.user }))
vi.mock('@/lib/services/workspace-address', () => ({ storedWorkspaceOf: async () => ({ current: 'tenant-a', home: 'tenant-a' }) }))

const Public = vi.hoisted(() => function PublicLayoutStub({ children }: { children: ReactNode }) { return children })
const Standalone = vi.hoisted(() => function MemberFormPageStub() { return null })
const Layout = vi.hoisted(() => function FormLinkLayoutStub({ children }: { children: ReactNode }) { return children })
const AnonView = vi.hoisted(() => function AnonymousFormViewStub() { return null })
const Missing = vi.hoisted(() => function FormLinkNoticeStub() { return null })
vi.mock('@/app/p/layout', () => ({ default: Public }))
vi.mock('@/components/forms/form-link-page', () => ({ MemberFormPage: Standalone, FormLinkLayout: Layout, FormLinkNotice: Missing }))
vi.mock('@/components/forms/anonymous-form-view', () => ({ AnonymousFormView: AnonView }))

import FriendlyFormPage from '@/app/form/[name]/page'

const LOGIN = '/form-login?redirect=%2Fform%2Frequested'
const A = { id: 'tenant-a', name: 'Acme', slug: 'acme', subdomain: 'acme' }

async function open(name: string, query: Record<string, string> = {}): Promise<ReactElement | Redirect | NotFound> {
  try {
    return (await FriendlyFormPage({ params: Promise.resolve({ name }), searchParams: Promise.resolve(query) })) as ReactElement
  } catch (e) {
    if (e instanceof Redirect || e instanceof NotFound) return e
    throw e
  }
}

/** The first element of `type` in the tree. */
function find(node: unknown, type: unknown): ReactElement | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) { for (const n of node) { const f = find(n, type); if (f) return f } return null }
  const el = node as ReactElement<{ children?: unknown }>
  if (el.type === type) return el
  return find(el.props?.children, type)
}

beforeEach(() => {
  state.host = { kind: 'none' }
  state.embed = false
  state.user = null
  state.forms = new Map<string, unknown>([
    ['tenant-a:employee-onboarding', { kind: 'form', id: 'form-a1', name: 'Employee onboarding', system_name: 'employee-onboarding' }],
    ['tenant-a:onboarding', { kind: 'moved', id: 'form-a1', system_name: 'employee-onboarding' }],
    ['tenant-a:contact-us', { kind: 'form', id: 'form-a2', name: 'Contact us', system_name: 'contact-us' }],
    ['tenant-b:contact-us', { kind: 'form', id: 'form-b2', name: 'Contact B', system_name: 'contact-us' }],
  ])
  state.friendly = new Map()
  state.resolvedTokens = new Map()
  state.lookups = []
})

describe('members', () => {
  it('open the form like /f/<id>, on its own page (no dashboard shell), on the workspace address', async () => {
    state.host = { kind: 'member', tenant: A, userId: 'u1' }
    state.user = { id: 'u1' }
    const page = await open('employee-onboarding', { customer: 'ALFKI' }) as ReactElement
    expect(page.type).toBe(Standalone)
    expect(page.props).toMatchObject({ formId: 'form-a1', query: { customer: 'ALFKI' }, embed: false, userId: 'u1' })
  })

  it('?embed=1 asks for the embedded look', async () => {
    state.host = { kind: 'member', tenant: A, userId: 'u1' }
    state.user = { id: 'u1' }
    state.embed = true
    const page = await open('employee-onboarding', { embed: '1' }) as ReactElement
    expect(page.props).toMatchObject({ embed: true })
  })

  it('an earlier name redirects to the current one (query kept)', async () => {
    state.host = { kind: 'member', tenant: A, userId: 'u1' }
    state.user = { id: 'u1' }
    expect(((await open('onboarding', { a: '1' })) as Redirect).url).toBe('/form/employee-onboarding?a=1')
  })

  it('an unknown name shows "not available" on the bare page', async () => {
    state.host = { kind: 'member', tenant: A, userId: 'u1' }
    state.user = { id: 'u1' }
    const page = await open('nope-nope') as ReactElement
    expect(find(page, Missing)).not.toBeNull()
    expect(find(page, Standalone)).toBeNull()
  })

  it('on the apex the name resolves in the current workspace', async () => {
    state.user = { id: 'u1' }
    const page = await open('contact-us') as ReactElement
    expect(find(page, Standalone)?.props).toMatchObject({ formId: 'form-a2' })
  })
})

describe('visitors who are not signed in', () => {
  beforeEach(() => { state.host = { kind: 'signed_out', tenant: A } })

  it('the form sign-in page keeps the embedded look', async () => {
    state.embed = true
    expect(((await open('contact-us')) as Redirect).url).toBe(`${LOGIN}&embed=1`)
  })

  it('sign in when the form has no friendly public link (anonymous off or not opted in)', async () => {
    expect(((await open('contact-us')) as Redirect).url).toBe(LOGIN)
  })

  it('sign in for an unknown name too (names cannot be probed)', async () => {
    expect(((await open('does-not-exist')) as Redirect).url).toBe(LOGIN)
    expect(((await open('Bad_Name')) as Redirect).url).toBe(LOGIN)
  })

  it('get the anonymous /p/ rendering when anonymous responses are on and the friendly link is allowed', async () => {
    state.friendly.set('tenant-a:form-a2', 'tok-a2')
    state.resolvedTokens.set('tok-a2', { formId: 'form-a2', tenantId: 'tenant-a' })
    const page = await open('contact-us') as ReactElement
    expect(page.type).toBe(Public)
    expect(find(page, AnonView)?.props).toMatchObject({ token: 'tok-a2', page: { form: { id: 'form-a2' } } })
    expect(find(page, Standalone)).toBeNull()
  })

  it('the /p/ rules still apply: a token that no longer resolves (workspace switch off, rotated) → sign in', async () => {
    state.friendly.set('tenant-a:form-a2', 'tok-a2')
    expect(((await open('contact-us')) as Redirect).url).toBe(LOGIN)
  })

  it('a renamed public form redirects to its current name', async () => {
    state.friendly.set('tenant-a:form-a1', 'tok-a1')
    state.resolvedTokens.set('tok-a1', { formId: 'form-a1', tenantId: 'tenant-a' })
    expect(((await open('onboarding')) as Redirect).url).toBe('/form/employee-onboarding')
  })
})

describe('signed-in non-members', () => {
  beforeEach(() => { state.host = { kind: 'non_member', tenant: A, userId: 'u9' }; state.user = { id: 'u9' } })

  it('no access unless the form is public under its friendly link', async () => {
    expect(((await open('contact-us')) as Redirect).url).toBe('/no-access')
    state.friendly.set('tenant-a:form-a2', 'tok-a2')
    state.resolvedTokens.set('tok-a2', { formId: 'form-a2', tenantId: 'tenant-a' })
    expect(find(await open('contact-us'), AnonView)).not.toBeNull()
  })
})

describe('tenant isolation', () => {
  it('workspace A’s address never serves workspace B’s form', async () => {
    state.host = { kind: 'member', tenant: A, userId: 'u1' }
    state.user = { id: 'u1' }
    const page = await open('contact-us') as ReactElement
    expect(find(page, Standalone)?.props).toMatchObject({ formId: 'form-a2' })
    expect(state.lookups).toEqual(['tenant-a:contact-us'])
  })

  it('a public token of another workspace is refused', async () => {
    state.host = { kind: 'signed_out', tenant: A }
    state.friendly.set('tenant-a:form-a2', 'tok-x')
    state.resolvedTokens.set('tok-x', { formId: 'form-b2', tenantId: 'tenant-b' })
    expect(((await open('contact-us')) as Redirect).url).toBe(LOGIN)
  })
})
