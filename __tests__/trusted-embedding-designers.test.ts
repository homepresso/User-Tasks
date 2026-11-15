/**
 * Embedded designers (lib/embed/designers.ts) on top of trusted embedding
 * (lib/embedding.ts): the return target is never an open redirect, the host
 * origin is an approved one, links map to /embed/ equivalents (or none), the
 * launch parameters travel with in-embed links, the escape guard's target,
 * and the CSRF analysis for designers in a frame — their same-origin server
 * actions, reads and fetches keep the session; cross-site requests to the
 * same endpoints still lose it; the designer routes get the approved
 * frame-ancestors from the proxy.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import {
  appPathForEmbed, embedHostOrigin, embedPathFor, isDesignerMessage, isHostMessage, isSafeAppPath, originApproved,
  parseEmbedReturn, parseLaunchOptions, withEmbedParams,
} from '@/lib/embed/designers'
import { escapeTarget } from '@/lib/embed/escape'
import { ensureRandomUUID, uuidV4 } from '@/lib/embed/secure-context'
import { webcrypto } from 'node:crypto'
import { isEmbedPath, sessionCookiesAllowed } from '@/lib/embedding'

const APPROVED = ['http://spsites', 'https://sp.contoso.com', 'https://*.intranet.example.com']
const WF = '3f2b9c1e-5d6a-4e7f-8a9b-0c1d2e3f4a5b'
const RUN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

describe('approved origins', () => {
  it('matches exact origins and CSP-style subdomain wildcards only', () => {
    expect(originApproved('http://spsites', APPROVED)).toBe(true)
    expect(originApproved('HTTPS://SP.contoso.com:443', APPROVED)).toBe(true)
    expect(originApproved('https://hr.intranet.example.com', APPROVED)).toBe(true)
    expect(originApproved('https://a.b.intranet.example.com', APPROVED)).toBe(true)
    for (const bad of ['https://spsites', 'http://spsites:8080', 'https://sp.contoso.com.evil.com', 'https://evilsp.contoso.com', 'https://intranet.example.com', 'http://hr.intranet.example.com', 'https://hr.intranet.example.com:8443', 'https://*.intranet.example.com', 'null', '', 'javascript:alert(1)']) {
      expect(originApproved(bad, APPROVED), bad).toBe(false)
    }
    expect(originApproved('http://spsites', [])).toBe(false)
  })
})

describe('return target', () => {
  it('accepts http(s) URLs on approved origins, with a label', () => {
    const ret = parseEmbedReturn('http://spsites/sites/ut-design/Lists/Expense%20Claims/AllItems.aspx', 'Expense Claims', APPROVED)
    expect(ret).toEqual({ url: 'http://spsites/sites/ut-design/Lists/Expense%20Claims/AllItems.aspx', origin: 'http://spsites', label: 'Back to Expense Claims' })
    expect(parseEmbedReturn('https://sp.contoso.com/sites/a', '', APPROVED)?.label).toBe('Back')
    expect(parseEmbedReturn('https://sp.contoso.com/x', 'A\u0000\nB'.padEnd(200, 'x'), APPROVED)?.label.length).toBeLessThanOrEqual(88)
  })

  it('refuses anything that would redirect elsewhere', () => {
    for (const bad of [
      'https://evil.example.com/', '//spsites/sites/a', '/automations', 'javascript:alert(1)', 'data:text/html,x',
      'http://user:pw@spsites/', 'https://spsites/', 'http://spsites:81/', 'http://spsites\\@evil.com/', ' http://spsites/a b',
      `http://spsites/${'a'.repeat(2100)}`, 'https://sp.contoso.com.evil.com/', null, 42,
    ]) {
      expect(parseEmbedReturn(bad, 'x', APPROVED), String(bad)).toBeNull()
    }
    expect(parseEmbedReturn('http://spsites/', 'x', [])).toBeNull()
  })

  it('host origin: the return origin, else an approved host_origin, else none', () => {
    const ret = parseEmbedReturn('http://spsites/sites/a', null, APPROVED)
    expect(embedHostOrigin(ret, 'https://sp.contoso.com', APPROVED)).toBe('http://spsites')
    expect(embedHostOrigin(null, 'https://sp.contoso.com/', APPROVED)).toBe('https://sp.contoso.com')
    expect(embedHostOrigin(null, 'https://evil.example.com', APPROVED)).toBeNull()
    expect(embedHostOrigin(null, 'https://*.intranet.example.com', APPROVED)).toBeNull()
    expect(embedHostOrigin(null, undefined, APPROVED)).toBeNull()
  })

  it('launch options drop invalid values before they travel on', () => {
    const ok = parseLaunchOptions({ return: 'http://spsites/sites/a', return_label: 'Claims', header: '0', other: 'x' }, APPROVED)
    expect(ok.ret?.url).toBe('http://spsites/sites/a')
    expect(ok.hostOrigin).toBe('http://spsites')
    expect(ok.header).toBe(false)
    expect(ok.carried).toEqual({ return: 'http://spsites/sites/a', return_label: 'Claims', header: '0' })
    const bad = parseLaunchOptions({ return: 'https://evil.example.com/', return_label: 'Claims', host_origin: 'https://evil.example.com' }, APPROVED)
    expect(bad.ret).toBeNull()
    expect(bad.hostOrigin).toBeNull()
    expect(bad.header).toBe(true)
    expect(bad.carried).toEqual({})
  })
})

describe('paths inside the embed', () => {
  it('maps designer areas to their /embed/ equivalents and nothing else', () => {
    expect(embedPathFor(`/automations/${WF}`)).toBe(`/embed/workflows/${WF}`)
    expect(embedPathFor(`/automations/${WF.toUpperCase()}?tab=x#n`)).toBe(`/embed/workflows/${WF}?tab=x#n`)
    expect(embedPathFor(`/automations/${WF}/runs`)).toBe(`/embed/workflows/${WF}/runs`)
    expect(embedPathFor(`/automations/runs/${RUN}?focus=a`)).toBe(`/embed/runs/${RUN}?focus=a`)
    expect(embedPathFor(`/automations/forms/${WF}`)).toBe(`/embed/forms/${WF}/design`)
    expect(embedPathFor(`/embed/forms/${WF}/design`)).toBe(`/embed/forms/${WF}/design`)
    for (const none of ['/automations', '/automations/forms', '/automations/forms/new', '/automations/queue', '/data/x', '/settings', '/home', '//evil.com', 'https://evil.com', `/automations/${WF}/edit`]) {
      expect(embedPathFor(none), none).toBeNull()
    }
  })

  it('maps back to the full app for "Open in UserTasks"', () => {
    expect(appPathForEmbed(`/embed/workflows/${WF}`)).toBe(`/automations/${WF}`)
    expect(appPathForEmbed(`/embed/workflows/${WF}/runs?x=1`)).toBe(`/automations/${WF}/runs`)
    expect(appPathForEmbed(`/embed/runs/${RUN}`)).toBe(`/automations/runs/${RUN}`)
    expect(appPathForEmbed(`/embed/forms/${WF}/design`)).toBe(`/automations/forms/${WF}`)
    expect(appPathForEmbed('/embed/x/sharepoint/launch')).toBeNull()
  })

  it('carries the launch parameters without overriding the link’s own', () => {
    const carried = { return: 'http://spsites/a', return_label: 'Claims', header: '0' }
    expect(withEmbedParams(`/embed/workflows/${WF}/runs`, carried)).toBe(`/embed/workflows/${WF}/runs?return=http%3A%2F%2Fspsites%2Fa&return_label=Claims&header=0`)
    expect(withEmbedParams(`/embed/runs/${RUN}?focus=n1&header=1#logs`, carried)).toBe(`/embed/runs/${RUN}?focus=n1&header=1&return=http%3A%2F%2Fspsites%2Fa&return_label=Claims#logs`)
    expect(withEmbedParams('/embed/x', { other: 'y' } as Record<string, string>)).toBe('/embed/x')
  })

  it('escape guard: an app page in a foreign frame goes to its embed equivalent or /embed/open', () => {
    expect(escapeTarget(`/automations/${WF}`, { return: 'http://spsites/a' })).toBe(`/embed/workflows/${WF}?return=http%3A%2F%2Fspsites%2Fa`)
    expect(escapeTarget('/automations?tab=all', {})).toBe('/embed/open?to=%2Fautomations%3Ftab%3Dall')
    expect(isSafeAppPath('/automations')).toBe(true)
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', '/a\nb', 42]) expect(isSafeAppPath(bad), String(bad)).toBe(false)
  })

  it('message shapes', () => {
    expect(isHostMessage({ type: 'usertasks:host', event: 'ack' })).toBe(true)
    expect(isHostMessage({ type: 'usertasks:host', event: 'navigate', url: 'x' })).toBe(false)
    expect(isDesignerMessage({ type: 'usertasks:designer', event: 'state', kind: 'form', id: WF, name: null, dirty: true })).toBe(true)
    expect(isDesignerMessage({ type: 'usertasks:designer', event: 'eval' })).toBe(false)
  })
})

/* ── CSRF: designers in a frame ─────────────────────────────────────── */

function guard(method: string, path: string, headers: Record<string, string>) {
  const h = new Headers(headers)
  return sessionCookiesAllowed({ method, pathname: path, get: (name) => h.get(name) })
}

describe('session cookies for an embedded designer (framed sessions on)', () => {
  it('the framed GET navigation of a designer route keeps the session (the one thing trusted embedding adds)', () => {
    for (const path of [`/embed/workflows/${WF}`, `/embed/forms/${WF}/design`, `/embed/workflows/${WF}/runs`, `/embed/runs/${RUN}`]) {
      expect(isEmbedPath(path)).toBe(true)
      expect(guard('GET', path, { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' }), path).toBe(true)
    }
  })

  it('the designer’s own server actions, reads and fetches from inside the frame are same-origin and keep it', () => {
    // A server action (POST to the page URL, Next-Action header), serverRead, /api/… fetch and RSC navigation —
    // all initiated by the framed UserTasks document, so Fetch Metadata says same-origin whatever the top window is.
    expect(guard('POST', `/embed/workflows/${WF}`, { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', origin: 'https://ut.example.com', 'next-action': 'abc' })).toBe(true)
    expect(guard('POST', '/api/v1/workflows', { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' })).toBe(true)
    expect(guard('GET', `/embed/workflows/${WF}/runs`, { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', rsc: '1' })).toBe(true)
    expect(guard('GET', `/embed/runs/${RUN}`, { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' })).toBe(true)
  })

  it('the host page (or any other site) can’t use the session: cross-site POSTs, fetches and frames of app pages lose it', () => {
    expect(guard('POST', `/embed/workflows/${WF}`, { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe', origin: 'http://spsites' })).toBe(false)
    expect(guard('POST', `/embed/workflows/${WF}`, { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', origin: 'http://spsites', 'next-action': 'abc' })).toBe(false)
    expect(guard('GET', `/embed/workflows/${WF}`, { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' })).toBe(false)
    expect(guard('GET', `/automations/${WF}`, { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' })).toBe(false)
    // No Fetch Metadata: an unsafe method from another origin loses it.
    expect(guard('POST', `/embed/workflows/${WF}`, { origin: 'http://spsites', host: 'ut.example.com' })).toBe(false)
    expect(guard('POST', `/embed/workflows/${WF}`, { origin: 'https://ut.example.com', host: 'ut.example.com' })).toBe(true)
  })
})

describe('proxy: designer routes get the approved frame-ancestors', () => {
  const saved = { EMBED_FRAME_ANCESTORS: process.env.EMBED_FRAME_ANCESTORS, AUTH_COOKIE_SECURE: process.env.AUTH_COOKIE_SECURE }
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  })

  it('frame-ancestors on /embed/forms/…/design, DENY on the app designer page', async () => {
    process.env.EMBED_FRAME_ANCESTORS = 'http://spsites'
    const { proxy } = await import('@/proxy')
    const embedded = await proxy(new NextRequest(`https://ut.example.com/embed/forms/${WF}/design`))
    expect(embedded.headers.get('content-security-policy')).toMatch(/frame-ancestors 'self' http:\/\/spsites/)
    expect(embedded.headers.get('x-frame-options')).toBeNull()
    const app = await proxy(new NextRequest(`https://ut.example.com/automations/forms/${WF}`))
    expect(app.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/)
    expect(app.headers.get('x-frame-options')).toBe('DENY')
  })
})

describe('frames under a plain-http host page (not a secure context)', () => {
  it('get crypto.randomUUID from getRandomValues (v4 format); an existing one is kept', () => {
    const fake = { getRandomValues: (a: Uint8Array) => webcrypto.getRandomValues(a) } as unknown as Crypto
    ensureRandomUUID(fake)
    const ids = new Set(Array.from({ length: 50 }, () => fake.randomUUID()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const own = () => 'mine'
    const real = { randomUUID: own, getRandomValues: fake.getRandomValues } as unknown as Crypto
    ensureRandomUUID(real)
    expect(real.randomUUID).toBe(own)
    expect(uuidV4(() => new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000')
  })
})

describe('per-workspace trusted embedding token', () => {
  it('is carried (shape-checked only; the proxy verifies it) to every page of the embed', () => {
    const tok = 'eyJ2IjoxfQ.abc-DEF_123'
    expect(parseLaunchOptions({ return: 'http://spsites/sites/a', ut_ea: tok }, APPROVED).carried.ut_ea).toBe(tok)
    expect(parseLaunchOptions({ ut_ea: 'bad token<script>' }, APPROVED).carried.ut_ea).toBeUndefined()
    expect(withEmbedParams('/embed/runs/x', { ut_ea: tok })).toBe(`/embed/runs/x?ut_ea=${tok}`)
  })
})
