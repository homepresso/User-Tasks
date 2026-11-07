/**
 * task_attachments RLS (20261222000000_task_attachments.sql), against a LOCAL
 * Supabase stack (EVENT_STREAM_DB_URL). End users are simulated the way
 * PostgREST does it (SET ROLE authenticated + request.jwt.claims); everything
 * runs in one transaction that is rolled back.
 *
 *   viewer reads · a non-editor can't add · uploader / admin soft-delete ·
 *   other users can't · cross-tenant blocked · forged storage keys refused ·
 *   legal hold blocks deletes · hard deletes queue the stored object.
 */
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL

function uid(key: string): string {
  const h = createHash('md5').update(`task-attach-rls:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const A = uid('tenant:A')
const B = uid('tenant:B')
const USERS = {
  assignee: { tenant: A, perms: ['tasks.view_own', 'tasks.complete'] },
  viewer: { tenant: A, perms: ['tasks.view_own', 'tasks.view_all'] },
  outsider: { tenant: A, perms: ['tasks.view_own', 'tasks.complete'] },
  admin: { tenant: A, perms: ['tasks.view_own', 'tasks.view_all', 'tasks.complete', 'tasks.delete'] },
  manager: { tenant: A, perms: ['tasks.view_own', 'tasks.complete'] },
  other: { tenant: B, perms: ['tasks.view_own', 'tasks.view_all', 'tasks.complete', 'tasks.delete', 'tasks.complete_any'] },
} as const
type UserKey = keyof typeof USERS
const U = Object.fromEntries(Object.keys(USERS).map((k) => [k, uid(`user:${k}`)])) as Record<UserKey, string>
const TASK = uid('task:A')
const CLOSED = uid('task:A:closed')
const TASK_B = uid('task:B')
const FORM = uid('form:A')

const key = (tenant: string, task: string, id: string) => `${tenant}/attachment-${task}/${id}/f.txt`

describe.skipIf(!DB_URL)('task_attachments RLS', () => {
  const db = new Client({ connectionString: DB_URL })

  async function as<T>(user: UserKey | null, fn: () => Promise<T>): Promise<T> {
    await db.query('SAVEPOINT probe')
    try {
      await db.query(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`)
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(user ? { sub: U[user], role: 'authenticated', aud: 'authenticated' } : { role: 'anon' })])
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

  const visible = (user: UserKey | null) => as(user, async () => (await db.query('SELECT id FROM public.task_attachments WHERE task_id = ANY($1) ORDER BY name', [[TASK, CLOSED, TASK_B]])).rows.map((r) => r.id as string))
  const insert = (user: UserKey, task: string, tenant: string, id = uid(`new:${user}:${task}`), status?: string) => as(user, () => run(
    `INSERT INTO public.task_attachments (id, task_id, name, storage_key, file_name, size, uploaded_by${status ? ', status' : ''}) VALUES ($1, $2, 'new', $3, 'f.txt', 1, $4${status ? ", 'ready'" : ''})`,
    [id, task, key(tenant, task, id), U[user]],
  ))
  const softDelete = (user: UserKey, id: string) => as(user, () => run('UPDATE public.task_attachments SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [id, U[user]]))

  const ATT = { byAssignee: uid('att:assignee'), byOutsider: uid('att:outsider'), uploading: uid('att:uploading'), closed: uid('att:closed'), b: uid('att:b') }

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    for (const [t, slug] of [[A, 'ta-rls-a'], [B, 'ta-rls-b']]) await db.query('INSERT INTO public.tenants (id, name, slug) VALUES ($1, $2, $2)', [t, slug])
    const ids = Object.values(U)
    for (const id of ids) {
      await db.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [id, `${id}@ta-rls.test`])
    }
    await db.query('DELETE FROM public.user_memberships WHERE user_id = ANY($1)', [ids])
    for (const [k, user] of Object.entries(USERS) as Array<[UserKey, (typeof USERS)[UserKey]]>) {
      await db.query('UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1', [U[k], user.tenant])
      await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role, is_active, manager_user_id) VALUES ($1, $2, 'member', true, NULL)`, [U[k], user.tenant])
      const role = uid(`role:${k}`)
      await db.query(`INSERT INTO public.roles (id, tenant_id, name, slug, permissions) VALUES ($1, $2, $3, $3, $4)`, [role, user.tenant, `ta-${k}`, user.perms])
      await db.query('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [user.tenant, U[k], role])
    }
    await db.query('UPDATE public.user_memberships SET manager_user_id = $2 WHERE user_id = $1 AND tenant_id = $3', [U.assignee, U.manager, A])
    await db.query(`INSERT INTO public.forms (id, tenant_id, name) VALUES ($1, $2, 'Held form')`, [FORM, A])
    await db.query(`INSERT INTO public.tasks (id, tenant_id, title, assignee_id, metadata) VALUES ($1, $2, 'open', $3, $4)`, [TASK, A, U.assignee, { form_ref: { form_id: FORM } }])
    await db.query(`INSERT INTO public.tasks (id, tenant_id, title, assignee_id, status) VALUES ($1, $2, 'closed', $3, 'completed')`, [CLOSED, A, U.assignee])
    await db.query(`INSERT INTO public.tasks (id, tenant_id, title, assignee_id) VALUES ($1, $2, 'b', $3)`, [TASK_B, B, U.other])
    const add = (id: string, task: string, tenant: string, by: string, name: string, status = 'ready') => db.query(
      `INSERT INTO public.task_attachments (id, tenant_id, task_id, name, storage_key, file_name, size, uploaded_by, status) VALUES ($1, $2, $3, $4, $5, 'f.txt', 1, $6, $7)`,
      [id, tenant, task, name, key(tenant, task, id), by, status],
    )
    await add(ATT.byAssignee, TASK, A, U.assignee, 'a1')
    await add(ATT.byOutsider, TASK, A, U.outsider, 'a2')
    await add(ATT.uploading, TASK, A, U.assignee, 'a3', 'uploading')
    await add(ATT.closed, CLOSED, A, U.assignee, 'a4')
    await add(ATT.b, TASK_B, B, U.other, 'b1')
  }, 60_000)

  afterAll(async () => {
    await db.query('ROLLBACK').catch(() => {})
    await db.end()
  })

  it('tenant_id and form_id follow the task', async () => {
    const { rows } = await db.query('SELECT tenant_id, form_id FROM public.task_attachments WHERE id = $1', [ATT.byAssignee])
    expect(rows[0]).toEqual({ tenant_id: A, form_id: FORM })
  })

  it('people who can see the task read its ready attachments; uploaders see their own', async () => {
    expect(await visible('assignee')).toEqual([ATT.byAssignee, ATT.byOutsider, ATT.uploading, ATT.closed])
    expect(await visible('viewer')).toEqual([ATT.byAssignee, ATT.byOutsider, ATT.closed])
    expect(await visible('manager')).toEqual([ATT.byAssignee, ATT.byOutsider, ATT.closed])
    expect(await visible('admin')).toEqual([ATT.byAssignee, ATT.byOutsider, ATT.closed])
    // Not related to the task, no view_all: only what they uploaded.
    expect(await visible('outsider')).toEqual([ATT.byOutsider])
    await expect(visible(null)).rejects.toMatchObject({ code: '42501' })
  })

  it('cross-tenant rows are invisible and untouchable', async () => {
    expect(await visible('other')).toEqual([ATT.b])
    expect(await softDelete('other', ATT.byAssignee)).toBe('ok:0')
    expect(await insert('other', TASK, A)).toBe('err:42501')
    expect(await softDelete('admin', ATT.b)).toBe('ok:0')
  })

  it('adding needs work access on an open task, as yourself, status uploading', async () => {
    expect(await insert('assignee', TASK, A)).toBe('ok:1')
    expect(await insert('manager', TASK, A)).toBe('ok:1')
    expect(await insert('viewer', TASK, A)).toBe('err:42501')
    expect(await insert('outsider', TASK, A)).toBe('err:42501')
    expect(await insert('assignee', CLOSED, A)).toBe('err:42501')
    // Only the server marks a verified file ready (status is not even insertable).
    expect(await insert('assignee', TASK, A, uid('ready'), 'ready')).toBe('err:42501')
    expect(await as(null, () => run(`INSERT INTO public.task_attachments (task_id, name, storage_key, file_name, size) VALUES ($1, 'x', 'x', 'x', 1)`, [TASK]))).toBe('err:42501')
  })

  it('a storage key that names another object is refused (forged ref)', async () => {
    const id = uid('forged')
    expect(await as('assignee', () => run(
      `INSERT INTO public.task_attachments (id, task_id, name, storage_key, file_name, size, uploaded_by) VALUES ($1, $2, 'x', $3, 'f.txt', 1, $4)`,
      [id, TASK, key(A, TASK, ATT.byOutsider), U.assignee],
    ))).toBe('err:23514')
    expect(await as('assignee', () => run(
      `INSERT INTO public.task_attachments (id, task_id, name, storage_key, file_name, size, uploaded_by) VALUES ($1, $2, 'x', $3, 'f.txt', 1, $4)`,
      [id, TASK, `${A}/form-x/${id}/f.txt`, U.assignee],
    ))).toBe('err:23514')
  })

  it('soft delete: the uploader or tasks.delete, nobody else; other columns are not writable', async () => {
    expect(await softDelete('assignee', ATT.byAssignee)).toBe('ok:1')
    expect(await softDelete('assignee', ATT.byOutsider)).toBe('ok:0')
    expect(await softDelete('viewer', ATT.byAssignee)).toBe('ok:0')
    expect(await softDelete('admin', ATT.byOutsider)).toBe('ok:1')
    expect(await softDelete('admin', ATT.closed)).toBe('ok:1')
    expect(await as('assignee', () => run(`UPDATE public.task_attachments SET name = 'renamed' WHERE id = $1`, [ATT.byAssignee]))).toBe('err:42501')
    expect(await as('assignee', () => run(`UPDATE public.task_attachments SET status = 'ready' WHERE id = $1`, [ATT.uploading]))).toBe('err:42501')
    expect(await as('admin', () => run('DELETE FROM public.task_attachments WHERE id = $1', [ATT.byOutsider]))).toBe('err:42501')
  })

  it('legal hold on the task\'s form blocks deletes (any writer)', async () => {
    await db.query('SAVEPOINT hold')
    try {
      await db.query('UPDATE public.forms SET legal_hold = true WHERE id = $1', [FORM])
      expect(await softDelete('admin', ATT.byOutsider)).toBe('err:55006')
      expect(await run('UPDATE public.task_attachments SET deleted_at = now() WHERE id = $1', [ATT.byOutsider])).toBe('err:55006')
      // The closed task has no form: not held.
      expect(await softDelete('admin', ATT.closed)).toBe('ok:1')
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT hold')
    }
  })

  it('deleting the task cascades and queues the stored objects for the cleanup job', async () => {
    await db.query('SAVEPOINT cascade')
    try {
      await db.query('DELETE FROM public.tasks WHERE id = $1', [CLOSED])
      const { rows } = await db.query('SELECT storage_key FROM public.task_attachment_purges WHERE storage_key = $1', [key(A, CLOSED, ATT.closed)])
      expect(rows).toHaveLength(1)
      expect(await as('admin', () => run('SELECT * FROM public.task_attachment_purges'))).toBe('err:42501')
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT cascade')
    }
  })
})
