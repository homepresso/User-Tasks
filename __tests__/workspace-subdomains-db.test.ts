/**
 * Workspace addresses and friendly form links against a LOCAL Supabase stack
 * (migration 20261223000000_workspace_subdomains.sql):
 *  - schema: the subdomain / system_name CHECKs, unique live subdomains,
 *    unique names per workspace, no client grants on the history tables;
 *  - new workspaces get their slug as address when it is valid and free;
 *    new forms get a system name from their name (-2, -3 … on clashes);
 *  - changing the address: availability (format, reserved, taken), the old
 *    address redirects (resolveSubdomain → moved) and stays reserved for its
 *    workspace; the owner can take it back;
 *  - renaming a form: the old name redirects; another form taking the old
 *    name wins; duplicates are refused;
 *  - tenant isolation: the same name in two workspaces resolves to each one's
 *    own form, never the other's;
 *  - the friendly public link: only with anonymous responses on AND
 *    allow_friendly_link.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/workspace-subdomains-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'
import type { ServiceContext } from '@/lib/services/context'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `a0a0a23a-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const A = id(0xa)
const B = id(0xb)
const C = id(0xc)
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

describe.skipIf(!DB_URL)('workspace addresses and friendly form links (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const staff = (tenantId: string): ServiceContext => ({ supabase: admin, db: admin, tenantId, actorId: null, permissions: new Set(['forms.view', 'forms.edit', 'forms.submit', 'settings.edit', 'settings.view']), authKind: 'api_key', source: 'api' })
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, app: process.env.APP_URL, mode: process.env.DEPLOYMENT_MODE, base: process.env.APP_BASE_DOMAIN }
  const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0]
  let address: typeof import('@/lib/services/workspace-address')
  let links: typeof import('@/lib/services/form-links')

  async function cleanup() {
    for (const t of [A, B, C]) {
      for (const table of ['form_system_name_history', 'form_anonymous_access', 'form_versions', 'forms', 'tenant_subdomain_history']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      }
      await db.query('DELETE FROM public.tenants WHERE id = $1', [t])
    }
    await db.query(`DELETE FROM public.tenant_subdomain_history WHERE subdomain LIKE 'wsdb-%'`)
  }

  const form = async (tenantId: string, n: number, name: string, systemName?: string) =>
    one(`INSERT INTO public.forms (id, tenant_id, name, fields, version${systemName ? ', system_name' : ''}) VALUES ($1, $2, $3, '[]', 1${systemName ? ', $4' : ''}) RETURNING system_name`,
      systemName ? [id(n), tenantId, name, systemName] : [id(n), tenantId, name])

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    process.env.APP_URL = 'https://usertasks.test'
    process.env.DEPLOYMENT_MODE = 'cloud'
    delete process.env.APP_BASE_DOMAIN
    address = await import('@/lib/services/workspace-address')
    links = await import('@/lib/services/form-links')
    address.addressDeps.serviceClient = async () => admin
    links.formLinkDeps.serviceClient = async () => admin
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'WS A', 'wsdb-alpha'), ($2, 'WS B', 'wsdb-beta'), ($3, 'WS C', 'www')`, [A, B, C])
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    for (const [k, v] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: prev.url, SUPABASE_SERVICE_ROLE_KEY: prev.key, APP_URL: prev.app, DEPLOYMENT_MODE: prev.mode, APP_BASE_DOMAIN: prev.base })) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v
    }
  })

  it('schema: CHECKs, unique live subdomains, no client grants on the history tables', async () => {
    for (const bad of ['ab', 'Acme', '-acme', 'acme-', 'ac--me', 'ac_me', 'x'.repeat(41)]) {
      await expect(db.query('UPDATE public.tenants SET subdomain = $1 WHERE id = $2', [bad, A]), bad).rejects.toThrow(/tenants_subdomain_format/)
    }
    await expect(db.query('UPDATE public.tenants SET subdomain = $1 WHERE id = $2', ['wsdb-alpha', B])).rejects.toThrow(/uq_tenants_subdomain_live/)
    await expect(db.query(`INSERT INTO public.forms (tenant_id, name, fields, system_name) VALUES ($1, 'x', '[]', 'Bad Name')`, [A])).rejects.toThrow(/forms_system_name_format/)
    expect((await one(`SELECT public.subdomain_is_reserved('www') AS r`)).r).toBe(true)
    expect((await one(`SELECT public.subdomain_is_reserved('acme') AS r`)).r).toBe(false)
    for (const table of ['tenant_subdomain_history', 'form_system_name_history']) {
      for (const role of ['anon', 'authenticated']) {
        const r = await one(`SELECT has_table_privilege($1, $2, 'SELECT') AS s, has_table_privilege($1, $2, 'INSERT') AS i`, [role, `public.${table}`])
        expect(r, `${role} ${table}`).toEqual({ s: false, i: false })
      }
    }
  })

  it('new workspaces take their slug as address when valid and not reserved', async () => {
    expect((await one('SELECT subdomain FROM public.tenants WHERE id = $1', [A])).subdomain).toBe('wsdb-alpha')
    expect((await one('SELECT subdomain FROM public.tenants WHERE id = $1', [B])).subdomain).toBe('wsdb-beta')
    expect((await one('SELECT subdomain FROM public.tenants WHERE id = $1', [C])).subdomain).toBeNull()
  })

  it('reads, checks and changes the address; the old one redirects and stays reserved', async () => {
    const before = await address.getWorkspaceAddress(staff(A))
    expect(before).toEqual({ enabled: true, base_domain: 'usertasks.test', subdomain: 'wsdb-alpha', url: 'https://wsdb-alpha.usertasks.test' })
    expect(await address.checkSubdomain(staff(A), 'api')).toMatchObject({ available: false, reason: '"api" is reserved.' })
    expect(await address.checkSubdomain(staff(A), 'wsdb-beta')).toMatchObject({ available: false, reason: 'That address is taken.' })
    expect(await address.checkSubdomain(staff(A), 'wsdb-alpha')).toMatchObject({ available: true })
    await expect(address.setWorkspaceSubdomain(staff(A), 'wsdb-beta')).rejects.toMatchObject({ code: 'conflict' })
    await expect(address.setWorkspaceSubdomain(staff(A), 'Bad!')).rejects.toMatchObject({ code: 'validation_error' })
    await expect(address.setWorkspaceSubdomain({ ...staff(A), permissions: new Set(['settings.view']) }, 'wsdb-new')).rejects.toMatchObject({ code: 'forbidden' })

    const after = await address.setWorkspaceSubdomain(staff(A), 'wsdb-alpha-two')
    expect(after.url).toBe('https://wsdb-alpha-two.usertasks.test')
    address.clearResolvedSubdomains()
    expect(await address.resolveSubdomain('wsdb-alpha-two')).toMatchObject({ kind: 'workspace', tenant: { id: A, slug: 'wsdb-alpha', subdomain: 'wsdb-alpha-two' } })
    expect(await address.resolveSubdomain('wsdb-alpha')).toEqual({ kind: 'moved', subdomain: 'wsdb-alpha-two' })
    expect(await address.resolveSubdomain('wsdb-nobody')).toEqual({ kind: 'unknown' })
    // Reserved for its old workspace: nobody else can take it.
    expect(await address.checkSubdomain(staff(B), 'wsdb-alpha')).toMatchObject({ available: false, reason: 'That address is taken.' })
    await expect(address.setWorkspaceSubdomain(staff(B), 'wsdb-alpha')).rejects.toMatchObject({ code: 'conflict' })
    // The owner takes it back: no history row, no redirect.
    await address.setWorkspaceSubdomain(staff(A), 'wsdb-alpha')
    address.clearResolvedSubdomains()
    expect(await address.resolveSubdomain('wsdb-alpha')).toMatchObject({ kind: 'workspace', tenant: { id: A } })
    expect(await address.resolveSubdomain('wsdb-alpha-two')).toEqual({ kind: 'moved', subdomain: 'wsdb-alpha' })
    expect((await one(`SELECT count(*)::int AS n FROM public.tenant_subdomain_history WHERE subdomain = 'wsdb-alpha'`)).n).toBe(0)
  })

  it('new forms get a system name from their name, de-duplicated per workspace', async () => {
    expect((await form(A, 0x10, 'Employee onboarding')).system_name).toBe('employee-onboarding')
    expect((await form(A, 0x11, 'Employee Onboarding!')).system_name).toBe('employee-onboarding-2')
    expect((await form(B, 0x20, 'Employee onboarding')).system_name).toBe('employee-onboarding')
    expect((await form(A, 0x12, 'HR')).system_name).toBe('form-hr')
    expect((await form(A, 0x13, 'Contact us', 'contact-us')).system_name).toBe('contact-us')
    expect((await form(B, 0x23, 'Contact B', 'contact-us')).system_name).toBe('contact-us')
    await expect(form(A, 0x14, 'Dupe', 'contact-us')).rejects.toThrow(/uq_forms_tenant_system_name/)
  })

  it('renames keep the old name as a redirect; another form taking the old name wins', async () => {
    const db2 = admin as any
    expect(await links.resolveFormLink(A, 'employee-onboarding')).toMatchObject({ kind: 'form', id: id(0x10) })
    await db.query(`UPDATE public.forms SET system_name = 'onboarding' WHERE id = $1`, [id(0x10)])
    expect(await links.resolveFormLink(A, 'employee-onboarding')).toEqual({ kind: 'moved', id: id(0x10), system_name: 'onboarding' })
    expect(await links.resolveFormLink(A, 'onboarding')).toMatchObject({ kind: 'form', id: id(0x10) })
    // A new form would not be given a name that still redirects.
    expect((await form(A, 0x15, 'Employee onboarding')).system_name).toBe('employee-onboarding-3')
    // The check warns, then taking it explicitly moves the old links to the new form.
    expect(await links.checkFormSystemName(staff(A), id(0x11), 'employee-onboarding')).toMatchObject({ available: true, redirects_from_form: id(0x10) })
    expect(await links.checkFormSystemName(staff(A), id(0x11), 'onboarding')).toMatchObject({ available: false })
    const name = await links.assertSystemName(db2, A, id(0x11), 'employee-onboarding')
    await db.query('UPDATE public.forms SET system_name = $1 WHERE id = $2', [name, id(0x11)])
    expect(await links.resolveFormLink(A, 'employee-onboarding')).toMatchObject({ kind: 'form', id: id(0x11) })
    await expect(links.assertSystemName(db2, A, id(0x12), 'onboarding')).rejects.toMatchObject({ code: 'conflict' })
    await expect(links.assertSystemName(db2, A, id(0x12), 'No Way')).rejects.toMatchObject({ code: 'validation_error' })
    expect(await links.suggestFormSystemName(staff(A), 'Employee onboarding', null)).toBe('employee-onboarding-4')
  })

  it('tenant isolation: the same name resolves to each workspace’s own form', async () => {
    expect(await links.resolveFormLink(A, 'contact-us')).toMatchObject({ id: id(0x13) })
    expect(await links.resolveFormLink(B, 'contact-us')).toMatchObject({ id: id(0x23) })
    // A's renamed name never redirects in B.
    expect(await links.resolveFormLink(B, 'onboarding')).toBeNull()
    expect(await links.resolveFormLink(B, 'form-hr')).toBeNull()
  })

  it('friendly links of a form: the address URL with the system name', async () => {
    expect(await links.getFormFriendlyLink(staff(A), id(0x13))).toEqual({ friendly_url: 'https://wsdb-alpha.usertasks.test/form/contact-us', system_name: 'contact-us', workspace_url: 'https://wsdb-alpha.usertasks.test' })
    await expect(links.getFormFriendlyLink(staff(B), id(0x13))).rejects.toMatchObject({ code: 'not_found' })
    expect((await links.getFormFriendlyLink(staff(C), id(0x13)).catch((e) => e)).code).toBe('not_found')
  })

  it('the friendly public link needs anonymous responses on AND allow_friendly_link', async () => {
    const token = 'w'.repeat(43)
    expect(await links.friendlyAnonymousToken(A, id(0x13))).toBeNull()
    await db.query(`INSERT INTO public.form_anonymous_access (form_id, tenant_id, token, enabled, settings) VALUES ($1, $2, $3, true, '{}')`, [id(0x13), A, token])
    expect(await links.friendlyAnonymousToken(A, id(0x13))).toBeNull()
    await db.query(`UPDATE public.form_anonymous_access SET settings = '{"allow_friendly_link": true}' WHERE form_id = $1`, [id(0x13)])
    expect(await links.friendlyAnonymousToken(A, id(0x13))).toBe(token)
    expect(await links.friendlyAnonymousToken(B, id(0x13))).toBeNull()
    await db.query('UPDATE public.form_anonymous_access SET enabled = false WHERE form_id = $1', [id(0x13)])
    expect(await links.friendlyAnonymousToken(A, id(0x13))).toBeNull()
  })
})
