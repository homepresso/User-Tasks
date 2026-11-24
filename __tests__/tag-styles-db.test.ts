/**
 * Tag colours against the real schema and RLS (migration
 * 20270121150000_tag_styles, applied inside this test's transaction and
 * rolled back):
 *
 *  - tag_styles RLS: members read their workspace's styles and never
 *    another workspace's; insert / update / delete need tags.manage in the
 *    current workspace (a member without it, and anon, are refused; a
 *    manager can't write into another workspace);
 *  - name_key: case-insensitive, whitespace-collapsed, unique per workspace;
 *    colours outside the palette are refused by the CHECK;
 *  - the legacy tag_definitions copy maps hex to tokens;
 *  - tag_usage / tag_objects (SECURITY INVOKER) count and list only what
 *    the caller's RLS shows them — nothing of another workspace;
 *  - rename_tag / remove_tag are service-role only;
 *  - rename_tag renames across objects, de-duplicates, merges styles and
 *    leaves other workspaces alone; remove_tag removes in one workspace;
 *  - seed_tenant_roles gives tags.manage to Owner, Admin and Manager only.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/tag-styles-db.test.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20270121150000_tag_styles.sql'), 'utf8')

function uid(key: string): string {
  const h = createHash('md5').update(`tag-styles-db:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const TENANT = { A: uid('tenant:A'), B: uid('tenant:B') }
const U = { manager: uid('u:manager'), member: uid('u:member'), other: uid('u:other') }
const ROLE = { manage: uid('role:manage'), member: uid('role:member'), bManage: uid('role:b') }

describe.skipIf(!DB_URL)('tag styles (local DB, RLS)', () => {
  const db = new Client({ connectionString: DB_URL })

  /** Run one statement as a user (or anon) inside a savepoint; errors come back instead of aborting the transaction. */
  async function as(user: string | null, sql: string, params: unknown[] = []): Promise<{ rows: any[]; error: string | null }> {
    await db.query('SAVEPOINT q')
    try {
      if (user) {
        await db.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)`, [JSON.stringify({ sub: user, role: 'authenticated', aud: 'authenticated' })])
        await db.query('SET LOCAL ROLE authenticated')
      } else {
        await db.query(`SELECT set_config('request.jwt.claims', '{"role":"anon"}', true)`)
        await db.query('SET LOCAL ROLE anon')
      }
      const { rows } = await db.query(sql, params)
      await db.query('RESET ROLE')
      await db.query('RELEASE SAVEPOINT q')
      return { rows, error: null }
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT q')
      await db.query('RELEASE SAVEPOINT q')
      await db.query('RESET ROLE')
      return { rows: [], error: (error as Error).message }
    }
  }

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    // Legacy definitions copied by the migration (run again below; it is idempotent).
    for (const k of ['A', 'B'] as const) {
      await db.query('INSERT INTO public.tenants (id, name, slug) VALUES ($1, $2, $3)', [TENANT[k], `tags ${k}`, `tag-styles-db-${k.toLowerCase()}`])
    }
    await db.query(`INSERT INTO public.tag_definitions (tenant_id, name, color) VALUES ($1, 'Legacy', '#EF4444'), ($1, 'legacy', '#3B82F6'), ($1, 'Custom', '#3a80f0'), ($2, 'B only', '#22C55E')`, [TENANT.A, TENANT.B])
    await db.query(MIGRATION)
    const people: Array<[string, 'A' | 'B']> = [[U.manager, 'A'], [U.member, 'A'], [U.other, 'B']]
    for (const [user, k] of people) {
      await db.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [user, `${user.slice(0, 8)}@tag-styles-db.test`])
      await db.query('DELETE FROM public.user_memberships WHERE user_id = $1', [user])
      await db.query('DELETE FROM public.user_roles WHERE user_id = $1', [user])
      await db.query('UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1', [user, TENANT[k]])
      await db.query('INSERT INTO public.user_memberships (user_id, tenant_id, role, is_home) VALUES ($1, $2, $3, true)', [user, TENANT[k], 'member'])
    }
    await db.query('INSERT INTO public.roles (id, tenant_id, name, slug, permissions) VALUES ($1, $2, $3, $4, $5), ($6, $2, $7, $8, $9), ($10, $11, $12, $13, $5)', [
      ROLE.manage, TENANT.A, 'Taggers', 'tag-styles-db-manage', ['tags.manage', 'tasks.view_all'],
      ROLE.member, 'Members', 'tag-styles-db-member', ['tasks.view_own'],
      ROLE.bManage, TENANT.B, 'B taggers', 'tag-styles-db-b',
    ])
    await db.query('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3), ($1, $4, $5), ($6, $7, $8)', [
      TENANT.A, U.manager, ROLE.manage, U.member, ROLE.member, TENANT.B, U.other, ROLE.bManage,
    ])
    await db.query(`INSERT INTO public.tasks (tenant_id, title, tags) VALUES ($1, 'T1', ARRAY['Finance','urgent']), ($1, 'T2', ARRAY['finance ']), ($1, 'T3', ARRAY['fin','Finance']), ($2, 'B1', ARRAY['finance','fin'])`, [TENANT.A, TENANT.B])
    await db.query(`INSERT INTO public.workflows (tenant_id, name, tags) VALUES ($1, 'W1', ARRAY['fin']), ($2, 'WB', ARRAY['fin'])`, [TENANT.A, TENANT.B])
  })

  afterAll(async () => {
    await db.query('ROLLBACK').catch(() => {})
    await db.end()
  })

  it('copied the legacy tag definitions, one per case-insensitive name, hex mapped to tokens', async () => {
    const { rows } = await db.query('SELECT tenant_id, name, name_key, color FROM public.tag_styles WHERE tenant_id = ANY($1) ORDER BY name_key', [[TENANT.A, TENANT.B]])
    const a = rows.filter((r) => r.tenant_id === TENANT.A)
    expect(a.map((r) => [r.name_key, r.color])).toEqual([['custom', 'blue'], ['legacy', 'red']])
    expect(rows.find((r) => r.tenant_id === TENANT.B)).toMatchObject({ name_key: 'b only', color: 'green' })
  })

  it('members read their own workspace\'s styles and never another workspace\'s', async () => {
    const mine = await as(U.member, 'SELECT name_key FROM public.tag_styles ORDER BY name_key')
    expect(mine.error).toBeNull()
    expect(mine.rows.map((r) => r.name_key)).toEqual(['custom', 'legacy'])
    const theirs = await as(U.other, 'SELECT name_key, tenant_id FROM public.tag_styles')
    expect(theirs.rows.every((r) => r.tenant_id === TENANT.B)).toBe(true)
    const anon = await as(null, 'SELECT * FROM public.tag_styles')
    expect(anon.rows).toEqual([])
  })

  it('writes need tags.manage in the current workspace', async () => {
    const denied = await as(U.member, `INSERT INTO public.tag_styles (tenant_id, name, color) VALUES ($1, 'ops', 'teal')`, [TENANT.A])
    expect(denied.error).toMatch(/row-level security/)
    const memberUpdate = await as(U.member, `UPDATE public.tag_styles SET color = 'pink' WHERE name_key = 'legacy' RETURNING id`)
    expect(memberUpdate.rows).toEqual([])
    const memberDelete = await as(U.member, `DELETE FROM public.tag_styles WHERE name_key = 'legacy' RETURNING id`)
    expect(memberDelete.rows).toEqual([])
    const anon = await as(null, `INSERT INTO public.tag_styles (tenant_id, name) VALUES ($1, 'x')`, [TENANT.A])
    expect(anon.error).not.toBeNull()

    const ok = await as(U.manager, `INSERT INTO public.tag_styles (tenant_id, name, color) VALUES ($1, 'Ops', 'teal') RETURNING name_key`, [TENANT.A])
    expect(ok.error).toBeNull()
    expect(ok.rows[0].name_key).toBe('ops')
    const upd = await as(U.manager, `UPDATE public.tag_styles SET color = 'pink' WHERE name_key = 'legacy' RETURNING color`)
    expect(upd.rows).toEqual([{ color: 'pink' }])
    // Not into another workspace, and not another workspace's rows.
    const cross = await as(U.manager, `INSERT INTO public.tag_styles (tenant_id, name, color) VALUES ($1, 'sneaky', 'red')`, [TENANT.B])
    expect(cross.error).toMatch(/row-level security/)
    const crossUpdate = await as(U.manager, `UPDATE public.tag_styles SET color = 'rose' WHERE tenant_id = $1 RETURNING id`, [TENANT.B])
    expect(crossUpdate.rows).toEqual([])
  })

  it('name_key is unique case-insensitively per workspace; colours must be palette tokens', async () => {
    const dup = await as(U.manager, `INSERT INTO public.tag_styles (tenant_id, name) VALUES ($1, '  OPS ')`, [TENANT.A])
    expect(dup.error).toMatch(/duplicate key|tag_styles_tenant_name_key/)
    const hex = await as(U.manager, `INSERT INTO public.tag_styles (tenant_id, name, color) VALUES ($1, 'hexy', '#ff0000')`, [TENANT.A])
    expect(hex.error).toMatch(/check constraint/)
    // Same name in another workspace is fine.
    await db.query(`INSERT INTO public.tag_styles (tenant_id, name, color) VALUES ($1, 'ops', 'red')`, [TENANT.B])
  })

  it('tag_usage counts one workspace\'s tags per object type; members count only rows RLS shows them', async () => {
    const { rows } = await db.query('SELECT name_key, object_type, uses::int AS uses FROM public.tag_usage($1) ORDER BY name_key, object_type', [TENANT.A])
    expect(rows).toEqual([
      { name_key: 'fin', object_type: 'tasks', uses: 1 },
      { name_key: 'fin', object_type: 'workflows', uses: 1 },
      { name_key: 'finance', object_type: 'tasks', uses: 3 },
      { name_key: 'urgent', object_type: 'tasks', uses: 1 },
    ])
    // Another workspace's member asking about A sees nothing (SECURITY INVOKER + RLS).
    const other = await as(U.other, 'SELECT * FROM public.tag_usage($1)', [TENANT.A])
    expect(other.error).toBeNull()
    expect(other.rows).toEqual([])
    // tasks RLS is workspace-wide, so a member of A counts A's tasks here; the
    // service shows task counts only with tasks.view_all (TAG_OBJECT_TYPES).
    const member = await as(U.member, `SELECT object_type FROM public.tag_usage($1) WHERE object_type = 'tasks'`, [TENANT.A])
    expect(member.error).toBeNull()
    const anon = await as(null, 'SELECT * FROM public.tag_usage($1)', [TENANT.A])
    expect(anon.error).toMatch(/permission denied/)
    const rename = await as(U.manager, `SELECT public.rename_tag($1, 'fin', 'x')`, [TENANT.A])
    expect(rename.error).toMatch(/permission denied/)
    const remove = await as(U.manager, `SELECT public.remove_tag($1, 'fin')`, [TENANT.A])
    expect(remove.error).toMatch(/permission denied/)
  })

  it('tag_objects pages a type\'s objects by name, case-insensitively, and shows only what RLS allows', async () => {
    const { rows } = await db.query(`SELECT name, total::int AS total FROM public.tag_objects($1, 'FINANCE', 'tasks', 2, 0)`, [TENANT.A])
    expect(rows).toEqual([{ name: 'T1', total: 3 }, { name: 'T2', total: 3 }])
    const page2 = await db.query(`SELECT name FROM public.tag_objects($1, 'finance', 'tasks', 2, 2)`, [TENANT.A])
    expect(page2.rows).toEqual([{ name: 'T3' }])
    const manager = await as(U.manager, `SELECT name FROM public.tag_objects($1, 'finance', 'tasks', 10, 0)`, [TENANT.A])
    expect(manager.rows.map((r) => r.name)).toEqual(['T1', 'T2', 'T3'])
    const other = await as(U.other, `SELECT name FROM public.tag_objects($1, 'finance', 'tasks', 10, 0)`, [TENANT.A])
    expect(other.rows).toEqual([])
  })

  it('rename_tag merges across objects, de-duplicates, moves the style and leaves other workspaces alone', async () => {
    await db.query(`INSERT INTO public.tag_styles (tenant_id, name, color, description) VALUES ($1, 'fin', 'amber', 'Old name')`, [TENANT.A])
    await db.query(`INSERT INTO public.tag_styles (tenant_id, name, color) VALUES ($1, 'Finance', NULL)`, [TENANT.A])
    const { rows: [{ result }] } = await db.query(`SELECT public.rename_tag($1, ' FIN ', 'Finance', $2) AS result`, [TENANT.A, U.manager])
    expect(result).toMatchObject({ merged: true, name: 'Finance', objects: { tasks: 1, workflows: 1 } })
    const { rows: tasks } = await db.query('SELECT title, tags FROM public.tasks WHERE tenant_id = $1 ORDER BY title', [TENANT.A])
    expect(tasks.find((t) => t.title === 'T3').tags).toEqual(['Finance'])
    expect(tasks.find((t) => t.title === 'T1').tags).toEqual(['Finance', 'urgent'])
    const { rows: wf } = await db.query('SELECT tags FROM public.workflows WHERE tenant_id = $1', [TENANT.A])
    expect(wf[0].tags).toEqual(['Finance'])
    // The target kept its style, taking the source's colour / description where it had none.
    const { rows: styles } = await db.query(`SELECT name_key, color, description FROM public.tag_styles WHERE tenant_id = $1 AND name_key IN ('fin', 'finance')`, [TENANT.A])
    expect(styles).toEqual([{ name_key: 'finance', color: 'amber', description: 'Old name' }])
    // Workspace B untouched.
    const { rows: b } = await db.query('SELECT tags FROM public.tasks WHERE tenant_id = $1', [TENANT.B])
    expect(b[0].tags).toEqual(['finance', 'fin'])
  })

  it('a plain rename moves the style row', async () => {
    const { rows: [{ result }] } = await db.query(`SELECT public.rename_tag($1, 'ops', 'Operations') AS result`, [TENANT.A])
    expect(result.merged).toBe(false)
    const { rows } = await db.query(`SELECT name, name_key, color FROM public.tag_styles WHERE tenant_id = $1 AND name_key IN ('ops', 'operations')`, [TENANT.A])
    expect(rows).toEqual([{ name: 'Operations', name_key: 'operations', color: 'teal' }])
  })

  it('remove_tag takes the tag off every object of one workspace (any case) and drops its style', async () => {
    await db.query(`INSERT INTO public.tag_styles (tenant_id, name, color) VALUES ($1, 'Urgent', 'red') ON CONFLICT DO NOTHING`, [TENANT.A])
    await db.query(`INSERT INTO public.tasks (tenant_id, title, tags) VALUES ($1, 'BU', ARRAY['urgent'])`, [TENANT.B])
    const { rows: [{ result }] } = await db.query(`SELECT public.remove_tag($1, 'URGENT') AS result`, [TENANT.A])
    expect(result.objects.tasks).toBe(1)
    const { rows } = await db.query(`SELECT tags FROM public.tasks WHERE tenant_id = $1 AND title = 'T1'`, [TENANT.A])
    expect(rows[0].tags).toEqual(['Finance'])
    const { rows: styles } = await db.query(`SELECT 1 FROM public.tag_styles WHERE tenant_id = $1 AND name_key = 'urgent'`, [TENANT.A])
    expect(styles).toEqual([])
    const { rows: b } = await db.query(`SELECT tags FROM public.tasks WHERE tenant_id = $1 AND title = 'BU'`, [TENANT.B])
    expect(b[0].tags).toEqual(['urgent'])
  })

  it('seed_tenant_roles: tags.manage for Owner, Admin and Manager only; existing system roles updated', async () => {
    const seeded = uid('tenant:seeded')
    await db.query('INSERT INTO public.tenants (id, name, slug) VALUES ($1, $2, $3)', [seeded, 'seeded', 'tag-styles-db-seeded'])
    await db.query('DELETE FROM public.roles WHERE tenant_id = $1', [seeded])
    await db.query('SELECT public.seed_tenant_roles($1)', [seeded])
    const { rows } = await db.query(`SELECT slug, 'tags.manage' = ANY (permissions) AS has FROM public.roles WHERE tenant_id = $1 ORDER BY slug`, [seeded])
    expect(Object.fromEntries(rows.map((r) => [r.slug, r.has]))).toEqual({ admin: true, manager: true, member: false, owner: true, viewer: false })
    const { rows: missing } = await db.query(`SELECT count(*)::int AS n FROM public.roles WHERE is_system AND slug IN ('owner', 'admin', 'manager') AND tenant_id <> $1 AND NOT ('tags.manage' = ANY (permissions))`, [seeded])
    expect(missing[0].n).toBe(0)
  })
})
