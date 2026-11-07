/**
 * Directory sync → org structure against the local stack's real tables
 * (migration 20261224000000_org_structure.sql): syncDirectoryOrg writes
 * member attributes and builds org units / memberships through
 * lib/org/import-units.ts. Checks: first import, idempotent re-sync (no
 * duplicates, no changes), casing renames, department moves, detached units
 * and manual attributes / memberships left alone, primary flag.
 *
 * Runs only against a LOCAL Supabase stack (EVENT_STREAM_DB_URL). Rows are
 * committed (PostgREST can't join a test transaction) and removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'
import { syncDirectoryOrg } from '@/lib/directory-sync/profiles'
import type { DirectoryUser } from '@/lib/directory-sync/types'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const TENANT = 'd0d0a000-0000-4000-8000-0000000000a1'
// Personal workspaces get the first 8 characters of the user id as slug: keep them distinct.
const uid = (n: number) => `d0${n.toString(16).padStart(6, '0')}-0000-4000-8000-0000000000d0`
const ADA = uid(1)
const BOB = uid(2)
const CY = uid(3)
const USERS = [ADA, BOB, CY]

describe.skipIf(!DB_URL)('directory sync → org structure (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as any[]
  const both = { importOrgUnits: true, importProfiles: true }

  const user = (externalId: string, profile: DirectoryUser['profile']): DirectoryUser =>
    ({ externalId, displayName: externalId, email: null, active: true, profile })

  async function cleanup() {
    const personal = (await q('SELECT tenant_id FROM public.users WHERE id = ANY($1::uuid[])', [USERS])).map((r) => r.tenant_id)
    await db.query('DELETE FROM public.tenants WHERE id = $1', [TENANT])
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [USERS])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [personal.filter(Boolean)])
  }

  const units = () => q(`SELECT name, kind, external_id, parent_id, detached FROM public.org_units WHERE tenant_id = $1 ORDER BY external_id`, [TENANT])
  const memberships = () => q(`SELECT u.external_id, m.user_id, m.source, m.is_primary FROM public.org_unit_members m JOIN public.org_units u ON u.id = m.org_unit_id WHERE m.tenant_id = $1 ORDER BY m.user_id, u.external_id`, [TENANT])
  const profile = async (userId: string) => (await q(`SELECT job_title, department, location, profile_source FROM public.user_memberships WHERE tenant_id = $1 AND user_id = $2`, [TENANT, userId]))[0]

  beforeAll(async () => {
    await db.connect()
    await cleanup()
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Dir Org', 'dir-org-test')`, [TENANT])
    for (const [i, id] of USERS.entries()) {
      await q(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [id, `dirorg${i}@dirorg.test`])
      await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [id, TENANT])
      await q(`INSERT INTO public.directory_links (tenant_id, provider, object_type, external_id, local_id) VALUES ($1, 'okta', 'user', $2, $3)`, [TENANT, `ext-${i}`, id])
    }
  }, 60_000)

  afterAll(async () => {
    await cleanup()
    await db.end()
  })

  it('first sync: attributes and the company → division → department tree', async () => {
    const stats = await syncDirectoryOrg(admin, TENANT, 'okta', [
      user('ext-0', { job_title: 'CFO', company: 'Acme', division: 'Corporate', department: 'Finance', location: 'HQ' }),
      user('ext-1', { job_title: 'Analyst', company: 'Acme', division: 'Corporate', department: 'Finance' }),
      user('ext-2', { job_title: 'Engineer', company: 'Acme', department: 'Engineering' }),
    ], both)
    expect(stats).toEqual({ profiles_updated: 3, org_units_created: 4, org_units_updated: 0, org_unit_memberships_changed: 3 })
    expect(await profile(ADA)).toEqual({ job_title: 'CFO', department: 'Finance', location: 'HQ', profile_source: 'directory' })
    const tree = await units()
    expect(tree.map((u) => u.external_id)).toEqual(['company:acme', 'company:acme/department:engineering', 'company:acme/division:corporate', 'company:acme/division:corporate/department:finance'])
    const byKey = new Map((await q(`SELECT id, external_id FROM public.org_units WHERE tenant_id = $1`, [TENANT])).map((r) => [r.external_id, r.id]))
    expect(tree.find((u) => u.external_id === 'company:acme/division:corporate/department:finance')?.parent_id).toBe(byKey.get('company:acme/division:corporate'))
    expect((await memberships()).every((m) => m.source === 'okta' && m.is_primary)).toBe(true)
  })

  it('a re-sync with the same data changes nothing', async () => {
    const before = { units: await units(), members: await memberships() }
    const stats = await syncDirectoryOrg(admin, TENANT, 'okta', [
      user('ext-0', { job_title: 'CFO', company: 'Acme', division: 'Corporate', department: 'Finance', location: 'HQ' }),
      user('ext-1', { job_title: 'Analyst', company: 'Acme', division: 'Corporate', department: 'Finance' }),
      user('ext-2', { job_title: 'Engineer', company: 'Acme', department: 'Engineering' }),
    ], both)
    expect(stats).toEqual({ profiles_updated: 0, org_units_created: 0, org_units_updated: 0, org_unit_memberships_changed: 0 })
    expect(await units()).toEqual(before.units)
    expect(await memberships()).toEqual(before.members)
  })

  it('casing renames update the unit; a department move swaps the membership; manual memberships stay', async () => {
    const eng = (await q(`SELECT id FROM public.org_units WHERE tenant_id = $1 AND external_id = 'company:acme/department:engineering'`, [TENANT]))[0].id
    // Bob is also in Engineering by hand (not primary).
    await q(`INSERT INTO public.org_unit_members (tenant_id, org_unit_id, user_id, source, is_primary) VALUES ($1, $2, $3, 'manual', false)`, [TENANT, eng, BOB])
    const stats = await syncDirectoryOrg(admin, TENANT, 'okta', [
      user('ext-1', { job_title: 'Analyst', company: 'Acme', department: 'ENGINEERING' }),
    ], both)
    expect(stats.org_units_updated).toBe(1)
    expect((await q(`SELECT name FROM public.org_units WHERE id = $1`, [eng]))[0].name).toBe('ENGINEERING')
    const bob = (await memberships()).filter((m) => m.user_id === BOB)
    // The manual Engineering row is kept as it was; the okta Finance row is gone.
    expect(bob).toEqual([{ external_id: 'company:acme/department:engineering', user_id: BOB, source: 'manual', is_primary: false }])
    // Bob's department attribute followed.
    expect((await profile(BOB)).department).toBe('ENGINEERING')
  })

  it('detached units and manual attributes are left alone', async () => {
    await q(`UPDATE public.org_units SET detached = true, name = 'Money' WHERE tenant_id = $1 AND external_id = 'company:acme/division:corporate/department:finance'`, [TENANT])
    await q(`UPDATE public.user_memberships SET job_title = 'Chief Financial Officer', profile_source = 'manual' WHERE tenant_id = $1 AND user_id = $2`, [TENANT, ADA])
    const stats = await syncDirectoryOrg(admin, TENANT, 'okta', [
      user('ext-0', { job_title: 'CFO', company: 'Acme', division: 'Corporate', department: 'finance', location: 'HQ' }),
    ], both)
    expect(stats).toEqual({ profiles_updated: 0, org_units_created: 0, org_units_updated: 0, org_unit_memberships_changed: 0 })
    expect((await q(`SELECT name FROM public.org_units WHERE tenant_id = $1 AND external_id = 'company:acme/division:corporate/department:finance'`, [TENANT]))[0].name).toBe('Money')
    expect((await profile(ADA)).job_title).toBe('Chief Financial Officer')
  })

  it('toggles: profiles only does not touch org units', async () => {
    const stats = await syncDirectoryOrg(admin, TENANT, 'okta', [user('ext-2', { job_title: 'Staff Engineer', company: 'Acme', department: 'Research' })], { importOrgUnits: false, importProfiles: true })
    expect(stats).toEqual({ profiles_updated: 1, org_units_created: 0, org_units_updated: 0, org_unit_memberships_changed: 0 })
    expect((await units()).some((u) => /research/.test(u.external_id))).toBe(false)
  })
})
