/**
 * Server-action adapters added in providers phase 2: the { ok, error } result
 * mapping (runAction / unwrapAction), the task actions acting in the task's
 * own workspace, and the FormData upload actions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const session = vi.hoisted(() => ({ db: null as any, user: { id: 'user-1' } as { id: string } | null }))
vi.mock('@/lib/providers/db/session', () => ({
  getSessionDb: async () => session.db,
  getSessionDbWithUser: async () => ({ supabase: session.db, user: session.user }),
}))
vi.mock('@/lib/permissions-server', () => ({ getUserPermissions: async () => new Set(['data.manage_rows', 'settings.edit']), requirePermission: async () => {} }))
const storage = vi.hoisted(() => ({ put: vi.fn(async () => {}), publicUrl: vi.fn((b: string, p: string) => `http://s/${b}/${p}`) }))
vi.mock('@/lib/providers/storage', () => ({ getStorageProvider: async () => storage }))

import { runAction } from '@/lib/actions/run-action'
import { unwrapAction } from '@/lib/action-result'
import { ServiceError } from '@/lib/services/context'
import { logManualEffort } from '@/app/actions/task-effort'
import { addTaskComment, reopenTask } from '@/app/actions/tasks'
import { uploadDataTableFile, uploadWorkspaceLogo } from '@/app/actions/uploads'
import { createMemorySupabase } from './fixtures/supabase-memory'

function sessionDb(perms: Record<string, string[]>, memberOf = Object.keys(perms)) {
  const db = createMemorySupabase({
    tasks: [
      { id: 'task-a', tenant_id: 'tenant-a', title: 'A', status: 'completed', actual_effort: 0, deleted_at: null },
      { id: 'task-b', tenant_id: 'tenant-b', title: 'B', status: 'completed', actual_effort: 0, deleted_at: null },
    ],
    users: [{ id: 'user-1', current_tenant_id: 'tenant-a', tenant_id: 'tenant-a' }],
    custom_tables: [{ id: 'tbl-a', tenant_id: 'tenant-a' }],
    effort_records: [],
    lifecycle_events: [],
  }) as any
  db.rpc = vi.fn(async (name: string, args?: any) => {
    if (name === 'get_user_tenant_ids') return { data: memberOf, error: null }
    if (name === 'get_user_permissions') return { data: perms[args?.p_tenant_id] ?? [], error: null }
    return { data: null, error: { message: `unexpected rpc ${name}` } }
  })
  return db
}

beforeEach(() => {
  session.user = { id: 'user-1' }
  storage.put.mockClear()
})

describe('runAction / unwrapAction', () => {
  it('maps service errors, plain errors and unknown throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await runAction('t', 'fallback', async () => 1)).toEqual({ ok: true, data: 1 })
    expect(await runAction('t', 'fallback', async () => { throw ServiceError.forbidden('nope') })).toEqual({ ok: false, error: 'nope' })
    expect(await runAction('t', 'fallback', async () => { throw new Error('db said no') })).toEqual({ ok: false, error: 'db said no' })
    expect(await runAction('t', 'fallback', async () => { throw 'x' })).toEqual({ ok: false, error: 'fallback' })
    expect(unwrapAction({ ok: true, data: 'v' })).toBe('v')
    expect(() => unwrapAction({ ok: false, error: 'bad' })).toThrow('bad')
  })
})

describe('task actions', () => {
  it('act in the task\'s workspace with the permissions held there', async () => {
    session.db = sessionDb({ 'tenant-a': [], 'tenant-b': ['tasks.complete'] })
    expect(await reopenTask('task-b')).toEqual({ ok: true, data: { status: 'todo' } })
    expect(session.db.tables.tasks.find((t: any) => t.id === 'task-b').status).toBe('todo')
    expect(await reopenTask('task-a')).toEqual({ ok: false, error: "Forbidden: you lack the 'tasks.complete' permission" })
  })

  it('refuse workspaces the user does not belong to and unknown tasks', async () => {
    session.db = sessionDb({ 'tenant-a': ['tasks.complete'] })
    expect(await addTaskComment('task-b', 'hi')).toEqual({ ok: false, error: 'Forbidden: you are not a member of that workspace' })
    expect(await logManualEffort('missing', { minutes: 5 })).toEqual({ ok: false, error: 'Task not found' })
    expect(session.db.tables.lifecycle_events).toEqual([])
  })

  it('log effort end to end', async () => {
    session.db = sessionDb({ 'tenant-a': ['tasks.complete'] })
    const result = await logManualEffort('task-a', { hours: 1, minutes: 0 })
    expect(result).toEqual({ ok: true, data: { minutes: 60, actual_effort: 60 } })
    expect(session.db.tables.effort_records).toHaveLength(1)
  })
})

describe('upload actions (FormData)', () => {
  it('store a data-table file and return its cell value', async () => {
    session.db = sessionDb({ 'tenant-a': ['data.manage_rows'] })
    const body = new FormData()
    body.set('file', new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    body.set('table_id', 'tbl-a')
    const result = await uploadDataTableFile(body)
    expect(result).toMatchObject({ ok: true, data: { name: 'notes.txt', size: 5 } })
    expect(storage.put).toHaveBeenCalledTimes(1)
  })

  it('refuse a missing file', async () => {
    session.db = sessionDb({ 'tenant-a': ['data.manage_rows'] })
    const body = new FormData()
    body.set('table_id', 'tbl-a')
    expect(await uploadDataTableFile(body)).toEqual({ ok: false, error: 'No file was uploaded' })
  })

  it('logos go to the given workspace only with settings.edit there', async () => {
    session.db = sessionDb({ 'tenant-a': ['settings.edit'], 'tenant-b': [] })
    const body = new FormData()
    body.set('file', new File(['png'], 'logo.png', { type: 'image/png' }))
    body.set('variant', 'logo')
    body.set('tenant_id', 'tenant-b')
    expect(await uploadWorkspaceLogo(body)).toEqual({ ok: false, error: "Forbidden: you lack the 'settings.edit' permission" })
    body.set('tenant_id', 'tenant-a')
    expect(await uploadWorkspaceLogo(body)).toMatchObject({ ok: true, data: { path: 'tenant-a/logo.png' } })
    body.set('tenant_id', 'tenant-z')
    expect(await uploadWorkspaceLogo(body)).toEqual({ ok: false, error: 'Forbidden: you are not a member of that workspace' })
  })
})
