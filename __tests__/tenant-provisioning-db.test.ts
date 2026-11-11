/**
 * provisionTenant (the /start beta signup, `usertasks-admin bootstrap`, the
 * instance admin API and the demo seed) against the local stack's database:
 * a new account gets exactly ONE workspace — the named one — as its owner,
 * home and current workspace. The account-creation hook (the Supabase
 * on_auth_user_created trigger, or onUserCreated for built-in / SSO
 * accounts) also gives every new account a personal workspace; before the
 * fix that "<name>'s Workspace" was left behind, empty, next to the named
 * one on every signup.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/tenant-provisioning-db.test.ts
 * The Supabase Auth case uses the stack's API (http://127.0.0.1:54321, demo keys).
 * Rows it creates are removed afterwards.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { dbCapabilities } from './helpers/db-capabilities'
import { provisionTenant, supabaseAuthAdmin } from '@/lib/tenant-provisioning'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const CAPS = await dbCapabilities()
const API_URL = process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const RUN = randomUUID().slice(0, 8)
const emailFor = (name: string) => `${name}-${RUN}@tenant-provisioning.test`

describe.skipIf(!DB_URL || !CAPS?.supabase)('provisionTenant creates one workspace (local stack)', () => {
  const pg = new Client({ connectionString: DB_URL })
  let sb: SupabaseClient
  const userIds: string[] = []
  const tenantIds: string[] = []

  beforeAll(async () => {
    await pg.connect()
    sb = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  })

  afterAll(async () => {
    for (const id of userIds) await sb.auth.admin.deleteUser(id).catch(() => undefined)
    if (userIds.length) {
      await pg.query('DELETE FROM public.user_roles WHERE user_id = ANY($1)', [userIds])
      await pg.query('DELETE FROM public.user_memberships WHERE user_id = ANY($1)', [userIds])
      await pg.query('DELETE FROM public.users WHERE id = ANY($1)', [userIds])
      await pg.query('DELETE FROM public.tenants WHERE slug = ANY($1)', [userIds.map((id) => `personal-${id.slice(0, 8)}`)])
    }
    for (const id of tenantIds) {
      for (const table of ['user_roles', 'user_memberships', 'roles', 'email_templates', 'workspace_themes']) {
        await pg.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [id]).catch(() => undefined)
      }
      await pg.query('DELETE FROM public.tenants WHERE id = $1', [id]).catch(() => undefined)
    }
    await pg.end()
  })

  /** Every workspace the account is tied to, by any link. */
  async function workspacesOf(userId: string) {
    const { rows } = await pg.query<{ id: string; name: string; slug: string }>(`
      SELECT DISTINCT t.id, t.name, t.slug FROM public.tenants t
       WHERE t.slug = $2
          OR t.id IN (SELECT tenant_id FROM public.user_memberships WHERE user_id = $1)
          OR t.id IN (SELECT tenant_id FROM public.user_roles WHERE user_id = $1)
          OR t.id IN (SELECT tenant_id FROM public.users WHERE id = $1)
          OR t.id IN (SELECT current_tenant_id FROM public.users WHERE id = $1)`,
    [userId, `personal-${userId.slice(0, 8)}`])
    return rows
  }

  async function expectSingleOwnedWorkspace(userId: string, tenantId: string, company: string) {
    expect(await workspacesOf(userId)).toEqual([expect.objectContaining({ id: tenantId, name: company })])
    const { rows: [user] } = await pg.query('SELECT tenant_id, current_tenant_id, role FROM public.users WHERE id = $1', [userId])
    expect(user).toEqual({ tenant_id: tenantId, current_tenant_id: tenantId, role: 'owner' })
    const { rows: memberships } = await pg.query('SELECT tenant_id, role, is_home, is_active FROM public.user_memberships WHERE user_id = $1', [userId])
    expect(memberships).toEqual([{ tenant_id: tenantId, role: 'owner', is_home: true, is_active: true }])
    const { rows: roles } = await pg.query(
      'SELECT r.slug FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND ur.tenant_id = $2', [userId, tenantId])
    expect(roles).toEqual([{ slug: 'owner' }])
  }

  it('Supabase Auth (on_auth_user_created trigger): only the named workspace, owned and home', async () => {
    const company = `Beta Inc ${RUN}`
    const result = await provisionTenant(sb, {
      fullName: 'Andy Signup', email: emailFor('supabase'), password: `pw-${randomUUID()}`, company,
      onboardingCompleted: true, userMetadata: { beta_signup: true },
    }, supabaseAuthAdmin(sb))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    userIds.push(result.userId)
    tenantIds.push(result.tenantId)
    await expectSingleOwnedWorkspace(result.userId, result.tenantId, company)
  })

  it('accounts provisioned by the app (built-in / SSO onUserCreated): only the named workspace', async () => {
    const company = `Builtin Co ${RUN}`
    const result = await provisionTenant(sb, {
      fullName: 'Built In', email: emailFor('builtin'), password: 'unused', company, onboardingCompleted: false,
    }, {
      // What the built-in provider's createUser does: provision_auth_user, then credentials.
      async createUser({ email }) {
        const id = randomUUID()
        await pg.query('SELECT public.provision_auth_user($1, $2, NULL, $3)', [id, email, 'email'])
        return { id }
      },
      async deleteUser(id) {
        await pg.query('DELETE FROM public.users WHERE id = $1', [id])
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    userIds.push(result.userId)
    tenantIds.push(result.tenantId)
    await expectSingleOwnedWorkspace(result.userId, result.tenantId, company)
  })

  it('a failed provisioning leaves no workspace behind', async () => {
    const id = randomUUID()
    userIds.push(id)
    // The owner-role grant fails after the named workspace exists: provisionTenant rolls back.
    const failing = new Proxy(sb, {
      get(target, prop) {
        if (prop !== 'from') return Reflect.get(target, prop)
        return (table: string) => {
          const builder = target.from(table)
          if (table !== 'user_roles') return builder
          return new Proxy(builder, {
            get(b, p) {
              if (p === 'insert') return async () => ({ data: null, error: { message: 'forced failure' } })
              const v = Reflect.get(b, p)
              return typeof v === 'function' ? v.bind(b) : v
            },
          })
        }
      },
    })
    const result = await provisionTenant(failing, {
      fullName: 'Fails', email: emailFor('fails'), password: 'unused', company: `Fails ${RUN}`, onboardingCompleted: true,
    }, {
      async createUser({ email }) {
        await pg.query('SELECT public.provision_auth_user($1, $2, NULL, $3)', [id, email, 'email'])
        return { id }
      },
      async deleteUser(userId) {
        await pg.query('DELETE FROM public.users WHERE id = $1', [userId])
      },
    })
    if (result.ok) tenantIds.push(result.tenantId)
    expect(result.ok).toBe(false)
    expect(await workspacesOf(id)).toEqual([])
  })

  it('invited accounts and SSO accounts still get their personal workspace (provision_auth_user unchanged)', async () => {
    const id = randomUUID()
    userIds.push(id)
    await pg.query('SELECT public.provision_auth_user($1, $2, NULL, $3)', [id, emailFor('invited'), 'email'])
    const spaces = await workspacesOf(id)
    expect(spaces).toEqual([expect.objectContaining({ slug: `personal-${id.slice(0, 8)}` })])
  })
})
