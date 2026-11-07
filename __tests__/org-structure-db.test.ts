/**
 * SQL-level checks for supabase/migrations/20261224000000_org_structure.sql:
 *  - RLS: members read their workspace's org units / projects only; writes
 *    need org.manage / projects.manage in the row's workspace;
 *  - org units: parent in the same workspace, no loops, head must be a member;
 *  - teams: parent loops refused;
 *  - member tables: tenant_id follows the parent, non-members refused,
 *    project_teams only with a team of the same workspace;
 *  - a departing member leaves units / projects and stops heading / leading;
 *  - permissions seeded on system roles and the seed function.
 *
 * Runs only against a LOCAL Supabase stack (EVENT_STREAM_DB_URL). Every test
 * runs in a transaction that is rolled back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL

const TENANT = '0f000000-0000-4000-8000-00000000000a'
const OTHER = '0f000000-0000-4000-8000-00000000000b'
const ADMIN = '0f0a0000-0000-4000-8000-000000000001'
const MEMBER = '0f0b0000-0000-4000-8000-000000000002'
const OUTSIDER = '0f0c0000-0000-4000-8000-000000000003'
const ROLE = '0f000000-0000-4000-8000-0000000000a1'
const UNIT_A = '0f000000-0000-4000-8000-0000000000b1'
const UNIT_B = '0f000000-0000-4000-8000-0000000000b2'
const UNIT_OTHER = '0f000000-0000-4000-8000-0000000000b3'
const TEAM_A = '0f000000-0000-4000-8000-0000000000c1'
const TEAM_B = '0f000000-0000-4000-8000-0000000000c2'
const TEAM_OTHER = '0f000000-0000-4000-8000-0000000000c3'
const PROJECT = '0f000000-0000-4000-8000-0000000000d1'

describe.skipIf(!DB_URL)('org structure migration (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })
  beforeAll(async () => { await db.connect() })
  afterAll(async () => { await db.end() })

  beforeEach(async () => {
    await db.query('BEGIN')
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Org A', 'org-db-a'), ($2, 'Org B', 'org-db-b')`, [TENANT, OTHER])
    for (const [id, email] of [[ADMIN, 'admin'], [MEMBER, 'member'], [OUTSIDER, 'outsider']]) {
      await db.query(
        `INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [id, `${email}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@org.test`],
      )
    }
    await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $3, 'member'), ($2, $3, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [ADMIN, MEMBER, TENANT])
    await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [OUTSIDER, OTHER])
    await db.query(`UPDATE public.users SET current_tenant_id = $2 WHERE id IN ($1, $3)`, [ADMIN, TENANT, MEMBER])
    await db.query(`UPDATE public.users SET current_tenant_id = $2 WHERE id = $1`, [OUTSIDER, OTHER])
    await db.query(`INSERT INTO public.roles (id, tenant_id, name, slug, permissions) VALUES ($1, $2, 'Org admin', 'org-admin-test', ARRAY['org.view','org.manage','projects.view','projects.manage'])`, [ROLE, TENANT])
    await db.query(`INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`, [TENANT, ADMIN, ROLE])
    await db.query(`INSERT INTO public.org_units (id, tenant_id, name, kind) VALUES ($1, $3, 'Company', 'company'), ($2, $3, 'Engineering', 'department')`, [UNIT_A, UNIT_B, TENANT])
    await db.query(`UPDATE public.org_units SET parent_id = $1 WHERE id = $2`, [UNIT_A, UNIT_B])
    await db.query(`INSERT INTO public.org_units (id, tenant_id, name) VALUES ($1, $2, 'Elsewhere')`, [UNIT_OTHER, OTHER])
    await db.query(`INSERT INTO public.teams (id, tenant_id, name) VALUES ($1, $3, 'Platform'), ($2, $3, 'Infra')`, [TEAM_A, TEAM_B, TENANT])
    await db.query(`INSERT INTO public.teams (id, tenant_id, name) VALUES ($1, $2, 'Theirs')`, [TEAM_OTHER, OTHER])
    await db.query(`INSERT INTO public.projects (id, tenant_id, name, key) VALUES ($1, $2, 'Apollo', 'APO')`, [PROJECT, TENANT])
  })
  afterEach(async () => { await db.query('ROLLBACK') })

  async function as(user: string, sql: string, params: unknown[] = []) {
    await db.query('SAVEPOINT caller')
    try {
      await db.query('SET LOCAL ROLE authenticated')
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated' })])
      const { rows, rowCount } = await db.query(sql, params)
      await db.query('RELEASE SAVEPOINT caller')
      return { rows, rowCount, error: null as null | { code?: string; message: string } }
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT caller')
      const err = e as { code?: string; message: string }
      return { rows: [], rowCount: 0, error: { code: err.code, message: err.message } }
    } finally {
      await db.query('RESET ROLE')
      await db.query(`SELECT set_config('request.jwt.claims', '', true)`)
    }
  }

  async function sqlError(sql: string, params: unknown[] = []) {
    await db.query('SAVEPOINT s')
    try {
      await db.query(sql, params)
      await db.query('RELEASE SAVEPOINT s')
      return null
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT s')
      return (e as Error).message
    }
  }

  it('members read their own workspace only', async () => {
    const mine = await as(MEMBER, `SELECT id FROM public.org_units ORDER BY name`)
    expect(mine.rows.map((r) => r.id).sort()).toEqual([UNIT_A, UNIT_B].sort())
    const theirs = await as(OUTSIDER, `SELECT id FROM public.org_units`)
    expect(theirs.rows.map((r) => r.id)).toEqual([UNIT_OTHER])
    expect((await as(OUTSIDER, `SELECT id FROM public.projects`)).rows).toEqual([])
  })

  it('writes need org.manage / projects.manage', async () => {
    const denied = await as(MEMBER, `INSERT INTO public.org_units (tenant_id, name) VALUES ($1, 'Rogue')`, [TENANT])
    expect(denied.error?.code).toBe('42501')
    const noUpdate = await as(MEMBER, `UPDATE public.org_units SET name = 'Hacked' WHERE id = $1`, [UNIT_A])
    expect(noUpdate.rowCount).toBe(0)
    expect((await as(MEMBER, `DELETE FROM public.projects WHERE id = $1`, [PROJECT])).rowCount).toBe(0)

    const ok = await as(ADMIN, `INSERT INTO public.org_units (tenant_id, name) VALUES ($1, 'Finance') RETURNING id`, [TENANT])
    expect(ok.error).toBeNull()
    expect((await as(ADMIN, `UPDATE public.projects SET status = 'on_hold' WHERE id = $1`, [PROJECT])).rowCount).toBe(1)
    // The admin role is for TENANT only: nothing in OTHER.
    const cross = await as(ADMIN, `INSERT INTO public.org_units (tenant_id, name) VALUES ($1, 'Cross')`, [OTHER])
    expect(cross.error?.code).toBe('42501')
    expect((await as(ADMIN, `UPDATE public.org_units SET name = 'x' WHERE id = $1`, [UNIT_OTHER])).rowCount).toBe(0)
  })

  it('refuses org unit loops, cross-workspace parents and non-member heads', async () => {
    expect(await sqlError(`UPDATE public.org_units SET parent_id = $1 WHERE id = $2`, [UNIT_B, UNIT_A])).toMatch(/org_unit_cycle/)
    expect(await sqlError(`UPDATE public.org_units SET parent_id = id WHERE id = $1`, [UNIT_A])).toMatch(/org_units_not_own_parent|org_unit_cycle/)
    expect(await sqlError(`UPDATE public.org_units SET parent_id = $1 WHERE id = $2`, [UNIT_OTHER, UNIT_B])).toMatch(/org_unit_parent_tenant/)
    expect(await sqlError(`UPDATE public.org_units SET head_user_id = $1 WHERE id = $2`, [OUTSIDER, UNIT_A])).toMatch(/org_unit_head_not_member/)
    expect(await sqlError(`UPDATE public.org_units SET head_user_id = $1 WHERE id = $2`, [MEMBER, UNIT_A])).toBeNull()
  })

  it('refuses team loops and cross-workspace org units', async () => {
    await db.query(`UPDATE public.teams SET parent_id = $1 WHERE id = $2`, [TEAM_A, TEAM_B])
    expect(await sqlError(`UPDATE public.teams SET parent_id = $1 WHERE id = $2`, [TEAM_B, TEAM_A])).toMatch(/team_cycle/)
    expect(await sqlError(`UPDATE public.teams SET parent_id = $1 WHERE id = $2`, [TEAM_OTHER, TEAM_A])).toMatch(/team_parent_tenant/)
    expect(await sqlError(`UPDATE public.teams SET org_unit_id = $1 WHERE id = $2`, [UNIT_OTHER, TEAM_A])).toMatch(/team_org_unit_tenant/)
    expect(await sqlError(`UPDATE public.teams SET org_unit_id = $1, lead_user_id = $2, colour = '#112233', kind = 'squad' WHERE id = $3`, [UNIT_B, MEMBER, TEAM_A])).toBeNull()
  })

  it('member tables follow the parent tenant and refuse outsiders', async () => {
    await db.query(`INSERT INTO public.org_unit_members (tenant_id, org_unit_id, user_id) VALUES ($1, $2, $3)`, [OTHER, UNIT_B, MEMBER])
    const { rows } = await db.query(`SELECT tenant_id FROM public.org_unit_members WHERE org_unit_id = $1`, [UNIT_B])
    expect(rows[0].tenant_id).toBe(TENANT)
    expect(await sqlError(`INSERT INTO public.org_unit_members (tenant_id, org_unit_id, user_id) VALUES ($1, $2, $3)`, [TENANT, UNIT_B, OUTSIDER])).toMatch(/org_member_not_member/)
    expect(await sqlError(`INSERT INTO public.project_members (tenant_id, project_id, user_id) VALUES ($1, $2, $3)`, [TENANT, PROJECT, OUTSIDER])).toMatch(/org_member_not_member/)
    expect(await sqlError(`INSERT INTO public.project_teams (tenant_id, project_id, team_id) VALUES ($1, $2, $3)`, [TENANT, PROJECT, TEAM_OTHER])).toMatch(/project_team_tenant/)
    expect(await sqlError(`INSERT INTO public.project_teams (tenant_id, project_id, team_id) VALUES ($1, $2, $3)`, [TENANT, PROJECT, TEAM_A])).toBeNull()
    expect(await sqlError(`UPDATE public.projects SET team_id = $1 WHERE id = $2`, [TEAM_OTHER, PROJECT])).toMatch(/project_team_tenant/)
    // One primary unit per person.
    await db.query(`UPDATE public.org_unit_members SET is_primary = true WHERE org_unit_id = $1 AND user_id = $2`, [UNIT_B, MEMBER])
    expect(await sqlError(`INSERT INTO public.org_unit_members (tenant_id, org_unit_id, user_id, is_primary) VALUES ($1, $2, $3, true)`, [TENANT, UNIT_A, MEMBER])).toMatch(/uq_org_unit_members_primary/)
  })

  it('a departing member leaves units and projects and stops heading / leading', async () => {
    await db.query(`INSERT INTO public.org_unit_members (tenant_id, org_unit_id, user_id) VALUES ($1, $2, $3)`, [TENANT, UNIT_B, MEMBER])
    await db.query(`INSERT INTO public.project_members (tenant_id, project_id, user_id) VALUES ($1, $2, $3)`, [TENANT, PROJECT, MEMBER])
    await db.query(`UPDATE public.org_units SET head_user_id = $1 WHERE id = $2`, [MEMBER, UNIT_A])
    await db.query(`UPDATE public.teams SET lead_user_id = $1 WHERE id = $2`, [MEMBER, TEAM_A])
    await db.query(`UPDATE public.user_memberships SET is_active = false WHERE tenant_id = $1 AND user_id = $2`, [TENANT, MEMBER])
    const counts = await db.query(`SELECT
      (SELECT count(*)::int FROM public.org_unit_members WHERE user_id = $1) AS units,
      (SELECT count(*)::int FROM public.project_members WHERE user_id = $1) AS projects,
      (SELECT count(*)::int FROM public.org_units WHERE head_user_id = $1) AS heads,
      (SELECT count(*)::int FROM public.teams WHERE lead_user_id = $1) AS leads`, [MEMBER])
    expect(counts.rows[0]).toEqual({ units: 0, projects: 0, heads: 0, leads: 0 })
  })

  it('unique (source, external_id) per workspace and project key per workspace', async () => {
    await db.query(`INSERT INTO public.org_units (tenant_id, name, source, external_id) VALUES ($1, 'Dept', 'okta', 'department:dept')`, [TENANT])
    expect(await sqlError(`INSERT INTO public.org_units (tenant_id, name, source, external_id) VALUES ($1, 'Dept 2', 'okta', 'department:dept')`, [TENANT])).toMatch(/uq_org_units_source_external/)
    expect(await sqlError(`INSERT INTO public.org_units (tenant_id, name, source, external_id) VALUES ($1, 'Dept', 'entra', 'department:dept')`, [TENANT])).toBeNull()
    expect(await sqlError(`INSERT INTO public.projects (tenant_id, name, key) VALUES ($1, 'Other', 'apo')`, [TENANT])).toMatch(/uq_projects_tenant_key/)
    expect(await sqlError(`INSERT INTO public.projects (tenant_id, name, key) VALUES ($1, 'Other', 'APO')`, [OTHER])).toBeNull()
    expect(await sqlError(`INSERT INTO public.projects (tenant_id, name, key, start_date, end_date) VALUES ($1, 'Bad', 'BAD', '2027-02-01', '2027-01-01')`, [TENANT])).toMatch(/projects_dates_check/)
  })

  it('seeds the org / project permissions', async () => {
    // The tenant insert seeded OTHER's system roles through seed_tenant_roles.
    const { rows } = await db.query(`SELECT slug, permissions FROM public.roles WHERE tenant_id = $1 AND is_system`, [OTHER])
    const perms = Object.fromEntries(rows.map((r) => [r.slug, new Set(r.permissions as string[])]))
    for (const slug of ['owner', 'admin', 'manager', 'member', 'viewer']) {
      expect(perms[slug].has('org.view')).toBe(true)
      expect(perms[slug].has('projects.view')).toBe(true)
    }
    expect(['owner', 'admin'].every((s) => perms[s].has('org.manage'))).toBe(true)
    expect(['manager', 'member', 'viewer'].some((s) => perms[s].has('org.manage'))).toBe(false)
    expect(['owner', 'admin', 'manager'].every((s) => perms[s].has('projects.manage'))).toBe(true)
    expect(['member', 'viewer'].some((s) => perms[s].has('projects.manage'))).toBe(false)
  })
})
