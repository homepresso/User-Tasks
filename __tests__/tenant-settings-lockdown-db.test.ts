/**
 * 20261031000000_tenant_settings_lockdown.sql against a LOCAL Supabase stack,
 * through the real REST / Storage APIs with real signed-in users:
 *  - `tenants` can't be updated directly by any member (not even one holding
 *    settings.edit); the server path (lib/services/tenant-settings) works for
 *    settings.edit holders, merges `branding`, and refuses plain members.
 *  - users.tenant_id / current_tenant_id: no self-service join of another
 *    workspace; switch_tenant(), the unified view (NULL) and the home tenant
 *    keep working.
 *  - `logos` storage: writes need membership + settings.edit for the path's
 *    tenant folder; reads stay public.
 *  - `brand-fonts` storage (20261102000000): the same write rule, woff2 only
 *    up to 1 MB, public reads; the font upload service writes for editors.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/tenant-settings-lockdown-db.test.ts
 * API: LOCKDOWN_SUPABASE_URL / LOCKDOWN_ANON_KEY / LOCKDOWN_SERVICE_ROLE_KEY,
 * defaulting to the standard local stack and its public demo keys.
 * Rows, auth users and storage objects are committed and removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { dbCapabilities } from './helpers/db-capabilities'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { setWorkspaceLogo } from '@/lib/services/tenant-settings'
import { uploadWorkspaceThemeFont } from '@/lib/services/workspace-theme'
import type { ServiceContext } from '@/lib/services/context'
import { pinDefaultStorageProvider } from './fixtures/pin-storage'

// Supabase Storage path (mocked client / local stack buckets).
pinDefaultStorageProvider()

const DB_URL = process.env.EVENT_STREAM_DB_URL
const CAPS = await dbCapabilities()
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
// The well-known keys every `supabase start` stack ships with.
const ANON_KEY = process.env.LOCKDOWN_ANON_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const TENANT = '10c4d0e0-0000-4000-8000-00000000000a'
const OTHER = '10c4d0e0-0000-4000-8000-00000000000b'
const PASSWORD = 'lockdown-test-Passw0rd!'
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

// Signs in through Supabase Auth and uploads to Supabase Storage.
describe.skipIf(!DB_URL || !CAPS?.supabase)('tenant settings lockdown (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const ids = { editor: '', member: '' }
  const personalTenants: string[] = []
  let editor: SupabaseClient
  let member: SupabaseClient
  const prevEnv = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }

  async function cleanup() {
    await admin.storage.from('logos').remove([`${TENANT}/logo.png`, `${OTHER}/logo.png`]).catch(() => undefined)
    for (const folder of [TENANT, OTHER]) {
      const { data } = await admin.storage.from('brand-fonts').list(folder)
      if (data?.length) await admin.storage.from('brand-fonts').remove(data.map((o) => `${folder}/${o.name}`))
    }
    for (const id of Object.values(ids)) if (id) await admin.auth.admin.deleteUser(id).catch(() => undefined)
    for (const t of [TENANT, OTHER, ...personalTenants]) {
      for (const table of ['user_roles', 'user_memberships', 'object_audit_log']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      }
      await db.query('DELETE FROM public.users WHERE tenant_id = $1', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.tenants WHERE id = $1', [t]).catch(() => undefined)
    }
  }

  async function signIn(email: string) {
    const client = createClient(API_URL, ANON_KEY, opts)
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
    if (error) throw error
    return client
  }

  beforeAll(async () => {
    // The service's service-role client (lib/cron-auth) and logo URL check read these.
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    await db.connect()
    await db.query(`DELETE FROM auth.users WHERE email LIKE '%@lockdown.test'`)
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug, branding) VALUES ($1, 'Lockdown', 'lockdown-test', '{"primary_color":"#123456"}'::jsonb), ($2, 'Lockdown other', 'lockdown-other', '{}'::jsonb)`, [TENANT, OTHER])

    for (const [key, role] of [['editor', 'admin'], ['member', 'member']] as const) {
      const { data, error } = await admin.auth.admin.createUser({ email: `${key}@lockdown.test`, password: PASSWORD, email_confirm: true })
      if (error) throw error
      ids[key] = data.user!.id
      const { rows } = await db.query('SELECT tenant_id FROM public.users WHERE id = $1', [ids[key]])
      if (rows[0]?.tenant_id) personalTenants.push(rows[0].tenant_id)
      await db.query('UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1', [ids[key], TENANT])
      await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role, is_active) VALUES ($1, $2, 'member', true)`, [ids[key], TENANT])
      await db.query(
        `INSERT INTO public.user_roles (tenant_id, user_id, role_id) SELECT $2, $1, id FROM public.roles WHERE tenant_id = $2 AND slug = $3`,
        [ids[key], TENANT, role],
      )
    }
    // The editor also holds settings.edit in OTHER but isn't a member there.
    await db.query(`INSERT INTO public.user_roles (tenant_id, user_id, role_id) SELECT $2, $1, id FROM public.roles WHERE tenant_id = $2 AND slug = 'admin'`, [ids.editor, OTHER])

    editor = await signIn('editor@lockdown.test')
    member = await signIn('member@lockdown.test')
  }, 60_000)

  afterAll(async () => {
    await cleanup()
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prevEnv.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prevEnv.key
  })

  async function tenantRow() {
    const { rows } = await db.query('SELECT name, branding FROM public.tenants WHERE id = $1', [TENANT])
    return rows[0]
  }

  async function ctxFor(client: SupabaseClient, userId: string): Promise<ServiceContext> {
    const { data } = await client.rpc('get_user_permissions')
    return {
      supabase: client, tenantId: TENANT, actorId: userId,
      permissions: new Set((data as string[]) ?? []), authKind: 'session', source: 'ui',
    }
  }

  it('members cannot update the tenants row over REST (even with settings.edit)', async () => {
    for (const client of [member, editor]) {
      const { data, error } = await client.from('tenants').update({ name: 'Hijacked', branding: {} }).eq('id', TENANT).select('id')
      expect(error).toBeNull()
      expect(data).toEqual([])
    }
    expect(await tenantRow()).toMatchObject({ name: 'Lockdown', branding: { primary_color: '#123456' } })
    // Still readable.
    const { data } = await member.from('tenants').select('id, name').eq('id', TENANT).single()
    expect(data).toMatchObject({ id: TENANT, name: 'Lockdown' })
  })

  it('the server path writes for settings.edit holders (merging branding) and refuses plain members', async () => {
    const url = `${API_URL}/storage/v1/object/public/logos/${TENANT}/logo.png?t=1`
    const memberCtx = await ctxFor(member, ids.member)
    expect(memberCtx.permissions!.has('settings.edit')).toBe(false)
    await expect(setWorkspaceLogo(memberCtx, url)).rejects.toMatchObject({ code: 'forbidden' })

    const editorCtx = await ctxFor(editor, ids.editor)
    expect(editorCtx.permissions!.has('settings.edit')).toBe(true)
    // authKind 'session' → serviceRoleClient() swaps in the service-role client.
    await setWorkspaceLogo(editorCtx, url)
    expect((await tenantRow()).branding).toEqual({ primary_color: '#123456', logo_url: url })
    await setWorkspaceLogo(editorCtx, null)
    expect((await tenantRow()).branding).toEqual({ primary_color: '#123456' })
  })

  it('users cannot point tenant_id / current_tenant_id at a workspace they do not belong to', async () => {
    const patch = (values: Record<string, unknown>) => member.from('users').update(values).eq('id', ids.member).select('id')
    expect((await patch({ current_tenant_id: OTHER })).error?.code).toBe('42501')
    expect((await patch({ tenant_id: OTHER })).error?.code).toBe('42501')
    // Unified view, home tenant and ordinary columns still work.
    expect((await patch({ current_tenant_id: null })).data).toHaveLength(1)
    expect((await patch({ current_tenant_id: TENANT })).data).toHaveLength(1)
    expect((await patch({ display_name: 'Member' })).data).toHaveLength(1)
    // switch_tenant checks membership itself.
    expect((await member.rpc('switch_tenant', { p_tenant_id: OTHER })).error).not.toBeNull()
    expect((await member.rpc('switch_tenant', { p_tenant_id: null })).error).toBeNull()
    expect((await member.rpc('switch_tenant', { p_tenant_id: TENANT })).error).toBeNull()
    const { rows } = await db.query('SELECT tenant_id, current_tenant_id FROM public.users WHERE id = $1', [ids.member])
    expect(rows[0]).toEqual({ tenant_id: TENANT, current_tenant_id: TENANT })
  })

  it('logos: writes need membership + settings.edit in the path tenant; reads stay public', async () => {
    const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' })
    const upload = (client: SupabaseClient, path: string) => client.storage.from('logos').upload(path, png, { upsert: true, contentType: 'image/png' })

    expect((await upload(member, `${TENANT}/logo.png`)).error).not.toBeNull()
    // settings.edit role in OTHER, but no membership there.
    expect((await upload(editor, `${OTHER}/logo.png`)).error).not.toBeNull()
    expect((await upload(editor, `not-a-tenant/logo.png`)).error).not.toBeNull()
    expect((await upload(editor, `${TENANT}/logo.png`)).error).toBeNull()
    // Overwrite (upsert → update policy).
    expect((await upload(editor, `${TENANT}/logo.png`)).error).toBeNull()

    const publicUrl = admin.storage.from('logos').getPublicUrl(`${TENANT}/logo.png`).data.publicUrl
    expect((await fetch(publicUrl)).status).toBe(200)

    const exists = async () => (await admin.storage.from('logos').list(TENANT)).data?.some((o) => o.name === 'logo.png') ?? false
    await member.storage.from('logos').remove([`${TENANT}/logo.png`])
    expect(await exists()).toBe(true)
    await editor.storage.from('logos').remove([`${TENANT}/logo.png`])
    expect(await exists()).toBe(false)
  })

  it('brand-fonts: woff2 only, writes need membership + settings.edit, reads stay public', async () => {
    const woff2 = (size = 16, type = 'font/woff2') => {
      const bytes = new Uint8Array(size)
      bytes.set([0x77, 0x4f, 0x46, 0x32])
      return new Blob([bytes], { type })
    }
    const upload = (client: SupabaseClient, path: string, blob = woff2(), contentType = 'font/woff2') =>
      client.storage.from('brand-fonts').upload(path, blob, { upsert: true, contentType })

    expect((await upload(member, `${TENANT}/a.woff2`)).error).not.toBeNull()
    expect((await upload(editor, `${OTHER}/a.woff2`)).error).not.toBeNull()
    expect((await upload(editor, `${TENANT}/a.ttf`, woff2(16, 'font/ttf'), 'font/ttf')).error).not.toBeNull()
    expect((await upload(editor, `${TENANT}/big.woff2`, woff2(1024 * 1024 + 1))).error).not.toBeNull()
    expect((await upload(editor, `${TENANT}/a.woff2`)).error).toBeNull()
    const publicUrl = admin.storage.from('brand-fonts').getPublicUrl(`${TENANT}/a.woff2`).data.publicUrl
    expect((await fetch(publicUrl)).status).toBe(200)

    // The service path (settings.edit; service-role write into the tenant folder).
    const memberCtx = await ctxFor(member, ids.member)
    await expect(uploadWorkspaceThemeFont(memberCtx, { fileName: 'Brand.woff2', bytes: new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1]) })).rejects.toMatchObject({ code: 'forbidden' })
    const result = await uploadWorkspaceThemeFont(await ctxFor(editor, ids.editor), { fileName: 'Brand.woff2', bytes: new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1]) })
    expect(result.font.url).toBe(`${API_URL}/storage/v1/object/public/brand-fonts/${TENANT}/${result.path}`)
    expect((await fetch(result.font.url)).status).toBe(200)
  })
})
