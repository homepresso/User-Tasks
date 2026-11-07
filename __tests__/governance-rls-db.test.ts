/**
 * Governance RLS (20261226100000_governance_audit.sql) against a LOCAL
 * Supabase stack (EVENT_STREAM_DB_URL). End users are simulated the way
 * PostgREST does it (SET ROLE authenticated + request.jwt.claims); everything
 * runs in one transaction that is rolled back.
 *
 * A Viewer (the system role's permission set) can no longer write governance,
 * credential or build tables straight through PostgREST; an Admin of the same
 * workspace still can; an Admin of another workspace can't reach this one.
 * New workspaces are seeded with the least-privilege system roles.
 */
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { SYSTEM_ROLES } from '@/lib/tenant-provisioning'

const DB_URL = process.env.EVENT_STREAM_DB_URL

function uid(key: string): string {
  const h = createHash('md5').update(`governance-rls:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const permsOf = (slug: string) => SYSTEM_ROLES.find((r) => r.slug === slug)!.permissions as string[]
const A = uid('tenant:A')
const B = uid('tenant:B')
const USERS = {
  viewer: { tenant: A, perms: permsOf('viewer') },
  member: { tenant: A, perms: permsOf('member') },
  admin: { tenant: A, perms: permsOf('admin') },
  otherAdmin: { tenant: B, perms: permsOf('admin') },
} as const
type UserKey = keyof typeof USERS
const U = Object.fromEntries(Object.keys(USERS).map((k) => [k, uid(`user:${k}`)])) as Record<UserKey, string>
const ADMIN_ROLE = uid('role:admin')
const WORKFLOW = uid('workflow:A')
const KEY = uid('api-key:A')

describe.skipIf(!DB_URL)('governance RLS', () => {
  const db = new Client({ connectionString: DB_URL })

  async function as<T>(user: UserKey, fn: () => Promise<T>): Promise<T> {
    await db.query('SAVEPOINT probe')
    try {
      await db.query('SET LOCAL ROLE authenticated')
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U[user], role: 'authenticated', aud: 'authenticated' })])
      return await fn()
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT probe')
    }
  }

  /** 'ok:<rows>' or 'err:<sqlstate>'. */
  async function run(sql: string, params: unknown[] = []): Promise<string> {
    await db.query('SAVEPOINT inner_probe')
    try {
      const res = await db.query(sql, params)
      await db.query('RELEASE SAVEPOINT inner_probe')
      return `ok:${res.rowCount}`
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT inner_probe')
      return `err:${(e as { code?: string }).code}`
    }
  }

  /** Every write probe, as one user, against tenant `t`. */
  async function probes(user: UserKey, t: string) {
    const me = U[user]
    return as(user, async () => ({
      grantSelfAdmin: await run('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [t, me, ADMIN_ROLE]),
      createRole: await run(`INSERT INTO public.roles (tenant_id, name, slug, permissions) VALUES ($1, 'Escalate', $2, '{team.change_roles}')`, [t, `esc-${user}`]),
      editRole: await run(`UPDATE public.roles SET permissions = permissions WHERE id = $1`, [ADMIN_ROLE]),
      mintKey: await run(`INSERT INTO public.api_keys (tenant_id, name, key_prefix, key_hash, key_type) VALUES ($1, 'k', 'ut_xxxx', 'x', 'tenant')`, [t]),
      readKeys: await run('SELECT id FROM public.api_keys WHERE tenant_id = $1', [t]),
      inviteOwner: await run(`INSERT INTO public.invitations (tenant_id, email, invited_by, role) VALUES ($1, $2, $3, 'owner')`, [t, `${user}@evil.test`, me]),
      readInvites: await run('SELECT id FROM public.invitations WHERE tenant_id = $1', [t]),
      grantObject: await run(`INSERT INTO public.object_permissions (tenant_id, object_type, object_id, user_id, can_view, can_edit, can_delete, can_execute) VALUES ($1, 'workflow', $2, $3, true, true, true, true)`, [t, WORKFLOW, me]),
      createWorkflow: await run(`INSERT INTO public.workflows (tenant_id, name) VALUES ($1, 'wf')`, [t]),
      editWorkflow: await run(`UPDATE public.workflows SET name = name WHERE id = $1`, [WORKFLOW]),
      createTable: await run(`INSERT INTO public.custom_tables (tenant_id, name, slug) VALUES ($1, 't', $2)`, [t, `t-${user}`]),
      createIntegration: await run(`INSERT INTO public.integrations (tenant_id, name, type) VALUES ($1, 'i', 'rest')`, [t]),
      writeConnector: await run(`INSERT INTO public.tenant_connectors (tenant_id, connector_key) VALUES ($1, $2)`, [t, `gov-${user}`]),
      eraseAudit: await run('DELETE FROM public.object_audit_log WHERE tenant_id = $1', [t]),
      readOAuthTokens: await run('SELECT 1 FROM public.oauth_tokens LIMIT 1'),
    }))
  }

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    for (const [t, slug] of [[A, 'gov-rls-a'], [B, 'gov-rls-b']]) await db.query('INSERT INTO public.tenants (id, name, slug) VALUES ($1, $2, $2)', [t, slug])
    const ids = Object.values(U)
    for (const id of ids) {
      await db.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [id, `${id}@gov-rls.test`])
    }
    await db.query('DELETE FROM public.user_memberships WHERE user_id = ANY($1)', [ids])
    for (const [k, user] of Object.entries(USERS) as Array<[UserKey, (typeof USERS)[UserKey]]>) {
      await db.query('UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1', [U[k], user.tenant])
      await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role, is_active) VALUES ($1, $2, 'member', true)`, [U[k], user.tenant])
      const role = k === 'admin' ? ADMIN_ROLE : uid(`role:${k}`)
      await db.query(`INSERT INTO public.roles (id, tenant_id, name, slug, permissions) VALUES ($1, $2, $3, $3, $4)`, [role, user.tenant, `gov-${k}`, user.perms])
      await db.query('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [user.tenant, U[k], role])
    }
    await db.query(`INSERT INTO public.workflows (id, tenant_id, name) VALUES ($1, $2, 'Existing')`, [WORKFLOW, A])
    await db.query(`INSERT INTO public.api_keys (id, tenant_id, name, key_prefix, key_hash, key_type, created_by) VALUES ($1, $2, 'admin key', 'ut_aaaa', 'h', 'tenant', $3)`, [KEY, A, U.admin])
    await db.query(`INSERT INTO public.invitations (tenant_id, email, invited_by, role) VALUES ($1, 'pending@gov.test', $2, 'member')`, [A, U.admin])
    await db.query(`INSERT INTO public.object_audit_log (tenant_id, object_type, object_id, action) VALUES ($1, 'workflow', $2, 'update')`, [A, WORKFLOW])
  }, 60_000)

  afterAll(async () => {
    await db.query('ROLLBACK').catch(() => {})
    await db.end()
  })

  it('a Viewer cannot escalate, mint credentials, invite or change build objects through PostgREST', async () => {
    expect(await probes('viewer', A)).toEqual({
      grantSelfAdmin: 'err:42501',
      createRole: 'err:42501',
      editRole: 'ok:0',
      mintKey: 'err:42501',
      readKeys: 'ok:0',
      inviteOwner: 'err:42501',
      readInvites: 'ok:0',
      grantObject: 'err:42501',
      createWorkflow: 'err:42501',
      editWorkflow: 'ok:0',
      createTable: 'err:42501',
      createIntegration: 'err:42501',
      writeConnector: 'err:42501',
      eraseAudit: 'ok:0',
      readOAuthTokens: 'err:42501',
    })
  })

  it('a Member is refused the same governance and build writes', async () => {
    const r = await probes('member', A)
    for (const k of ['grantSelfAdmin', 'createRole', 'mintKey', 'inviteOwner', 'grantObject', 'createWorkflow', 'createTable', 'createIntegration', 'writeConnector'] as const) {
      expect(r[k], k).toBe('err:42501')
    }
    expect(r.readKeys).toBe('ok:0')
    expect(r.eraseAudit).toBe('ok:0')
  })

  it('an Admin of the workspace still can (permission-gated, not revoked); audit rows stay append-only', async () => {
    expect(await probes('admin', A)).toEqual({
      grantSelfAdmin: 'ok:0', // already holds it (ON CONFLICT DO NOTHING) — the policy allowed the insert
      createRole: 'ok:1',
      editRole: 'ok:1',
      mintKey: 'ok:1',
      readKeys: 'ok:2', // the existing key and the one just minted
      inviteOwner: 'ok:1',
      readInvites: 'ok:2',
      grantObject: 'ok:1',
      createWorkflow: 'ok:1',
      editWorkflow: 'ok:1',
      createTable: 'ok:1',
      createIntegration: 'ok:1',
      writeConnector: 'ok:1',
      eraseAudit: 'ok:0',
      readOAuthTokens: 'err:42501',
    })
  })

  it("an Admin of another workspace can't write this one", async () => {
    const r = await probes('otherAdmin', A)
    for (const k of ['createRole', 'mintKey', 'inviteOwner', 'grantObject', 'createWorkflow', 'createTable', 'createIntegration', 'writeConnector'] as const) {
      expect(r[k], k).toBe('err:42501')
    }
    expect(r.readKeys).toBe('ok:0')
    expect(r.readInvites).toBe('ok:0')
  })

  it('a user still reads their own API keys', async () => {
    await db.query(`INSERT INTO public.api_keys (tenant_id, name, key_prefix, key_hash, key_type, user_id, created_by) VALUES ($1, 'mine', 'ut_mine', 'h', 'user', $2, $3)`, [A, U.viewer, U.admin])
    const rows = await as('viewer', async () => (await db.query('SELECT name FROM public.api_keys WHERE tenant_id = $1', [A])).rows.map((r) => r.name))
    expect(rows).toEqual(['mine'])
  })

  it('rls_perm_tenant_ids answers per workspace and permission', async () => {
    const ids = (user: UserKey, perm: string) => as(user, async () => (await db.query('SELECT public.rls_perm_tenant_ids($1::text[]) AS t', [[perm]])).rows[0].t as string[])
    expect(await ids('admin', 'team.change_roles')).toEqual([A])
    expect(await ids('viewer', 'team.change_roles')).toEqual([])
    expect(await ids('viewer', 'tasks.complete')).toEqual([A])
    expect(await ids('otherAdmin', 'team.change_roles')).toEqual([B])
  })

  it('new workspaces get the least-privilege system roles (seed_tenant_roles matches lib/tenant-provisioning)', async () => {
    const t = uid('tenant:seeded')
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Seeded', 'gov-rls-seeded')`, [t])
    const { rows: existing } = await db.query('SELECT 1 FROM public.roles WHERE tenant_id = $1', [t])
    if (!existing.length) await db.query('SELECT public.seed_tenant_roles($1)', [t])
    const { rows } = await db.query('SELECT slug, permissions FROM public.roles WHERE tenant_id = $1 AND is_system', [t])
    const bySlug = Object.fromEntries(rows.map((r) => [r.slug, [...r.permissions].sort()]))
    for (const role of SYSTEM_ROLES) expect(bySlug[role.slug], role.slug).toEqual([...role.permissions].sort())
    expect(bySlug.viewer).not.toContain('workflows.view')
    expect(bySlug.viewer).not.toContain('forms.view')
  })

  it('anon cannot call get_user_permissions', async () => {
    await db.query('SAVEPOINT anon')
    try {
      await db.query('SET LOCAL ROLE anon')
      expect(await run('SELECT public.get_user_permissions()')).toBe('err:42501')
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT anon')
    }
  })
})
