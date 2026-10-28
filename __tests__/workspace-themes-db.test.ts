/**
 * 20261101000000_workspace_themes.sql against a LOCAL Supabase stack, through
 * the real REST API with real signed-in users:
 *  - every new tenant gets a theme row (trigger), and the migration's seed
 *    statement maps settings.theme_policy.default_theme_id to a preset stub;
 *  - members read their workspace's row (expanded by the app) but not other
 *    workspaces'; nobody writes the table over REST;
 *  - the service writes for settings.edit holders (version bump) and refuses
 *    plain members; deleting a tenant removes its row.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/workspace-themes-db.test.ts
 * API: LOCKDOWN_SUPABASE_URL / LOCKDOWN_ANON_KEY / LOCKDOWN_SERVICE_ROLE_KEY,
 * defaulting to the standard local stack and its public demo keys.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { dbCapabilities } from './helpers/db-capabilities'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { readWorkspaceTheme, updateWorkspaceTheme } from '@/lib/services/workspace-theme'
import { presetToWorkspaceTheme } from '@/lib/theme/presets'
import type { ServiceContext } from '@/lib/services/context'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const CAPS = await dbCapabilities()
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY = process.env.LOCKDOWN_ANON_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const TENANT = '7e3e0000-0000-4000-8000-00000000000a'
const OTHER = '7e3e0000-0000-4000-8000-00000000000b'
const POLICY = '7e3e0000-0000-4000-8000-00000000000c'
const BAD_POLICY = '7e3e0000-0000-4000-8000-00000000000d'
const PASSWORD = 'themes-test-Passw0rd!'
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

// Signs in through Supabase Auth and uploads to Supabase Storage.
describe.skipIf(!DB_URL || !CAPS?.supabase)('workspace themes (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const ids = { editor: '', member: '' }
  const personalTenants: string[] = []
  let editor: SupabaseClient
  let member: SupabaseClient
  const prevEnv = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }

  async function cleanup() {
    for (const id of Object.values(ids)) if (id) await admin.auth.admin.deleteUser(id).catch(() => undefined)
    for (const t of [TENANT, OTHER, POLICY, BAD_POLICY, ...personalTenants]) {
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

  async function ctxFor(client: SupabaseClient, userId: string): Promise<ServiceContext> {
    const { data } = await client.rpc('get_user_permissions')
    return { supabase: client, tenantId: TENANT, actorId: userId, permissions: new Set((data as string[]) ?? []), authKind: 'session', source: 'ui' }
  }

  const themeRow = async (tenantId: string) =>
    (await db.query('SELECT theme, version, updated_by FROM public.workspace_themes WHERE tenant_id = $1', [tenantId])).rows[0]

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    await db.connect()
    await db.query(`DELETE FROM auth.users WHERE email LIKE '%@themes.test'`)
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Themes', 'themes-test'), ($2, 'Themes other', 'themes-other')`, [TENANT, OTHER])

    for (const [key, role] of [['editor', 'admin'], ['member', 'member']] as const) {
      const { data, error } = await admin.auth.admin.createUser({ email: `${key}@themes.test`, password: PASSWORD, email_confirm: true })
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
    editor = await signIn('editor@themes.test')
    member = await signIn('member@themes.test')
  }, 60_000)

  afterAll(async () => {
    await cleanup()
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prevEnv.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prevEnv.key
  })

  it('new tenants get the platform default theme stub', async () => {
    expect(await themeRow(TENANT)).toMatchObject({ theme: { base_preset: 'basecamp' }, version: 1, updated_by: null })
    expect(await themeRow(OTHER)).toMatchObject({ theme: { base_preset: 'basecamp' } })
  })

  it("the migration's seed maps theme_policy.default_theme_id (unsafe ids → basecamp)", async () => {
    await db.query(
      `INSERT INTO public.tenants (id, name, slug, settings) VALUES
         ($1, 'Policy', 'themes-policy', '{"theme_policy":{"default_theme_id":"night-drive","allow_user_override":false}}'::jsonb),
         ($2, 'Bad policy', 'themes-bad-policy', '{"theme_policy":{"default_theme_id":"x\\"}; drop"}}'::jsonb)`,
      [POLICY, BAD_POLICY],
    )
    await db.query('DELETE FROM public.workspace_themes WHERE tenant_id = ANY($1)', [[POLICY, BAD_POLICY]])
    const sql = readFileSync(path.join(process.cwd(), 'supabase/migrations/20261101000000_workspace_themes.sql'), 'utf8')
    const seed = sql.slice(sql.lastIndexOf('INSERT INTO public.workspace_themes (tenant_id, theme)\nSELECT'))
    await db.query(seed)
    expect(await themeRow(POLICY)).toMatchObject({ theme: { base_preset: 'night-drive' } })
    expect(await themeRow(BAD_POLICY)).toMatchObject({ theme: { base_preset: 'basecamp' } })
    // Existing rows are left alone.
    expect(await themeRow(TENANT)).toMatchObject({ version: 1 })
  })

  it('members read their own workspace theme, not other workspaces', async () => {
    const own = await member.from('workspace_themes').select('tenant_id, theme').eq('tenant_id', TENANT)
    expect(own.error).toBeNull()
    expect(own.data).toHaveLength(1)
    const other = await member.from('workspace_themes').select('tenant_id').eq('tenant_id', OTHER)
    expect(other.data).toEqual([])
    const anon = await createClient(API_URL, ANON_KEY, opts).from('workspace_themes').select('tenant_id')
    expect(anon.data ?? []).toEqual([])
    expect((await readWorkspaceTheme(member, TENANT)).theme.meta.basePreset).toBe('basecamp')
  })

  it('nobody writes the table over REST, not even settings.edit holders', async () => {
    for (const client of [member, editor]) {
      const upd = await client.from('workspace_themes').update({ theme: { base_preset: 'sage' } }).eq('tenant_id', TENANT).select('tenant_id')
      expect(upd.data ?? []).toEqual([])
      const ins = await client.from('workspace_themes').insert({ tenant_id: OTHER, theme: { base_preset: 'sage' } })
      expect(ins.error).not.toBeNull()
      await client.from('workspace_themes').delete().eq('tenant_id', TENANT)
    }
    expect(await themeRow(TENANT)).toMatchObject({ theme: { base_preset: 'basecamp' }, version: 1 })
  })

  it('the service writes for settings.edit holders and refuses plain members', async () => {
    const theme = presetToWorkspaceTheme('lagoon')!
    await expect(updateWorkspaceTheme(await ctxFor(member, ids.member), theme)).rejects.toMatchObject({ code: 'forbidden' })
    const result = await updateWorkspaceTheme(await ctxFor(editor, ids.editor), theme, { expectedVersion: 1 })
    expect(result.version).toBe(2)
    const stored = await themeRow(TENANT)
    expect(stored).toMatchObject({ version: 2, updated_by: ids.editor })
    expect(stored.theme.meta.basePreset).toBe('lagoon')
    expect((await readWorkspaceTheme(member, TENANT)).theme.meta.name).toBe('Lagoon')
    await expect(updateWorkspaceTheme(await ctxFor(editor, ids.editor), theme, { expectedVersion: 1 })).rejects.toMatchObject({ code: 'conflict' })
  })

  it('deleting a tenant removes its theme', async () => {
    await db.query('DELETE FROM public.tenants WHERE id = $1', [OTHER])
    expect(await themeRow(OTHER)).toBeUndefined()
  })
})
