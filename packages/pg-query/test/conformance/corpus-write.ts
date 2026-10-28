import { ALICE, BOB, id, T, type Case } from './harness'

/**
 * Writes. Each case resets its rows before the PostgREST run, before the
 * pg-query run and afterwards, and compares the returned result plus the
 * resulting table state (`after`).
 */

const N1 = id(0xe01)
const N2 = id(0xe02)
const N3 = id(0xe03)
const notif = (nid: string, extra: Record<string, unknown> = {}) => ({ id: nid, user_id: ALICE, tenant_id: T, type: 'test', title: 'Conformance', created_at: '2026-03-01T00:00:00Z', ...extra })
const resetNotifs = `DELETE FROM public.notifications WHERE id IN ('${N1}', '${N2}', '${N3}')`
const seedN1 = `${resetNotifs}; INSERT INTO public.notifications (id, user_id, tenant_id, type, title, body, created_at) VALUES ('${N1}', '${ALICE}', '${T}', 'test', 'Seeded', 'b', '2026-03-01T00:00:00Z')`
const notifState = `SELECT id, user_id, type, title, body, is_read FROM public.notifications WHERE id IN ('${N1}', '${N2}', '${N3}') ORDER BY id`

const TK = id(0xe11)
const resetTasks = `DELETE FROM public.tasks WHERE id IN ('${TK}', '${id(0xe12)}')`
const taskState = `SELECT id, title, status, priority, assignee_id, metadata, tags FROM public.tasks WHERE id IN ('${TK}', '${id(0xe12)}') ORDER BY id`
const seedTask = `${resetTasks}; INSERT INTO public.tasks (id, tenant_id, title, status, priority, assignee_id, metadata, created_at) VALUES ('${TK}', '${T}', 'Seeded task', 'todo', 'low', '${BOB}', '{"k":1}', '2026-03-02T00:00:00Z')`

const ROW = id(0x812)
const resetRow = `UPDATE public.custom_table_rows SET data = '{"serial":"B-2","cost":80.5}', updated_by = NULL WHERE id = '${ROW}'`
const rowState = `SELECT id, data, updated_by FROM public.custom_table_rows WHERE id = '${ROW}'`

const UT = id(0xe21)
const resetUserTeams = `DELETE FROM public.user_teams WHERE id = '${UT}' OR (user_id = '${BOB}' AND team_id = '${id(0x102)}')`
const userTeamState = `SELECT id, user_id, team_id, role FROM public.user_teams WHERE user_id = '${BOB}' ORDER BY team_id`

export const WRITE_CASES: Case[] = [
  // ── insert ──
  { name: 'insert object, minimal', as: ['service'], reset: resetNotifs, after: notifState, run: (db) => db.from('notifications').insert(notif(N1)) },
  { name: 'insert object, select single', from: 'lib/services/notifications.ts', as: ['service'], reset: resetNotifs, after: notifState,
    run: (db) => db.from('notifications').insert(notif(N1)).select('id, title, is_read').single() },
  { name: 'insert array (columns param), select *', as: ['service'], reset: resetNotifs, after: notifState,
    run: (db) => db.from('notifications').insert([notif(N1), notif(N2, { body: 'second' })]).select() },
  { name: 'insert array with differing keys (null fill)', as: ['service'], reset: resetNotifs, after: notifState,
    run: (db) => db.from('notifications').insert([notif(N1, { body: 'x' }), notif(N2)]).select('id, body') },
  { name: 'insert array, defaultToNull false (missing=default)', as: ['service'], reset: resetNotifs, after: notifState,
    run: (db) => db.from('notifications').insert([notif(N1, { is_read: true }), notif(N2)], { defaultToNull: false }).select('id, is_read') },
  { name: 'insert empty array', as: ['service'], run: (db) => db.from('notifications').insert([]).select() },
  { name: 'insert with count exact', as: ['service'], reset: resetNotifs, run: (db) => db.from('notifications').insert([notif(N1), notif(N2)], { count: 'exact' }) },
  { name: 'insert returning embed', as: ['service'], reset: resetNotifs,
    run: (db) => db.from('notifications').insert(notif(N1, { task_id: id(0x301) })).select('id, task:tasks(title), user:users(display_name)').single() },
  { name: 'insert duplicate key (23505)', as: ['service'], reset: seedN1, after: notifState, run: (db) => db.from('notifications').insert(notif(N1)).select() },
  { name: 'insert FK violation (23503)', as: ['service'], reset: resetNotifs, run: (db) => db.from('notifications').insert(notif(N1, { task_id: id(0x3ff) })) },
  { name: 'insert not-null violation (23502)', as: ['service'], reset: resetNotifs, run: (db) => db.from('notifications').insert({ id: N1, user_id: ALICE, tenant_id: T, type: 'x', created_at: '2026-03-01T00:00:00Z' }) },
  { name: 'insert check violation (23514)', as: ['service'],
    reset: `DELETE FROM public.retention_policies WHERE id = '${id(0xe31)}'`,
    run: (db) => db.from('retention_policies').insert({ id: id(0xe31), tenant_id: T, name: 'bad', policy_mode: 'review', created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' }) },
  { name: 'insert unknown column (PGRST204)', as: ['service'], run: (db) => db.from('notifications').insert({ ...notif(N1), nope: 1 }) },
  { name: 'insert invalid enum (22P02)', as: ['service'], reset: resetTasks, run: (db) => db.from('tasks').insert({ id: TK, tenant_id: T, title: 'x', status: 'bogus' }) },
  { name: 'insert task as member (RLS allowed)', from: 'lib/services/tasks.ts', as: ['alice'], reset: resetTasks, after: taskState, volatile: ['created_at', 'updated_at'],
    run: (db) => db.from('tasks').insert({ id: TK, tenant_id: T, title: 'Member task', priority: 'high', assigner_id: ALICE, metadata: { via: 'conformance' }, tags: ['a', 'b'] }).select('id, title, status, priority').single() },
  { name: 'insert task into another workspace (RLS denied)', as: ['carol'], reset: resetTasks, after: taskState,
    run: (db) => db.from('tasks').insert({ id: TK, tenant_id: T, title: 'Intruder' }).select() },
  { name: 'insert as anon (denied)', as: ['anon'], reset: resetNotifs, run: (db) => db.from('notifications').insert(notif(N1)) },
  { name: 'insert invalid JSON type for column (22P02)', as: ['service'], reset: resetNotifs, run: (db) => db.from('notifications').insert({ ...notif(N1), is_read: 'maybe' }) },

  // ── upsert ──
  { name: 'upsert merge on existing row (200)', from: 'lib/services/tenant-connectors.ts', as: ['service'], reset: seedN1, after: notifState,
    run: (db) => db.from('notifications').upsert(notif(N1, { title: 'Upserted' }), { onConflict: 'id' }).select('id, title') },
  { name: 'upsert merge on new row (201)', as: ['service'], reset: resetNotifs, after: notifState,
    run: (db) => db.from('notifications').upsert(notif(N1, { title: 'Fresh' })).select('id, title') },
  { name: 'upsert merge mixed array', as: ['service'], reset: seedN1, after: notifState,
    run: (db) => db.from('notifications').upsert([notif(N1, { title: 'Again' }), notif(N2, { title: 'New' })], { onConflict: 'id' }).select('id, title') },
  { name: 'upsert ignoreDuplicates', as: ['service'], reset: seedN1, after: notifState,
    run: (db) => db.from('notifications').upsert([notif(N1, { title: 'Ignored' }), notif(N3)], { onConflict: 'id', ignoreDuplicates: true }).select('id, title') },
  { name: 'upsert minimal', as: ['service'], reset: seedN1, after: notifState, run: (db) => db.from('notifications').upsert(notif(N1, { title: 'Quiet' })) },
  { name: 'upsert on composite unique key', from: 'lib/services/roles.ts', as: ['service'],
    reset: `DELETE FROM public.user_roles WHERE user_id = '${BOB}' AND tenant_id = '${T}' AND role_id IN (SELECT id FROM public.roles WHERE tenant_id = '${T}' AND slug = 'viewer')`,
    after: `SELECT r.slug FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = '${BOB}' AND ur.tenant_id = '${T}' ORDER BY r.slug`,
    run: async (db) => {
      const role = await db.from('roles').select('id').eq('tenant_id', T).eq('slug', 'viewer').single()
      const r = await db.from('user_roles').upsert({ tenant_id: T, user_id: BOB, role_id: (role.data as { id: string }).id }, { onConflict: 'tenant_id,user_id,role_id', ignoreDuplicates: true }).select('tenant_id, user_id')
      return r
    } },
  { name: 'upsert onConflict non-unique column (42P10)', as: ['service'], reset: resetNotifs, run: (db) => db.from('notifications').upsert(notif(N1), { onConflict: 'title' }) },
  { name: 'upsert user_teams with explicit id', as: ['service'], reset: resetUserTeams, after: userTeamState,
    run: (db) => db.from('user_teams').upsert({ id: UT, user_id: BOB, team_id: id(0x102), role: 'member' }).select('user_id, team_id, role') },

  // ── update ──
  { name: 'update by id, select single', from: 'lib/services/tasks.ts', as: ['service', 'alice'], reset: seedTask, after: taskState, volatile: ['updated_at', 'started_at'],
    run: (db) => db.from('tasks').update({ status: 'in_progress', priority: 'high' }).eq('id', TK).eq('tenant_id', T).select('*').single() },
  { name: 'update minimal', from: 'lib/services/tasks.ts', as: ['service'], reset: seedTask, after: taskState,
    run: (db) => db.from('tasks').update({ status: 'completed' }).eq('id', TK).eq('tenant_id', T).is('deleted_at', null) },
  { name: 'update count exact', as: ['service'], reset: seedTask, after: taskState, run: (db) => db.from('tasks').update({ title: 'Counted' }, { count: 'exact' }).eq('id', TK) },
  { name: 'update no match select', as: ['service'], reset: seedTask, after: taskState, run: (db) => db.from('tasks').update({ title: 'Nope' }).eq('id', id(0x3ff)).select('id') },
  { name: 'update no match single (PGRST116, rolled back)', as: ['service'], reset: seedTask, after: taskState, run: (db) => db.from('tasks').update({ title: 'Nope' }).eq('tenant_id', T).eq('title', 'missing').select('id').single() },
  { name: 'update many rows single (PGRST116, rolled back)', as: ['service'],
    reset: `${seedTask}; INSERT INTO public.tasks (id, tenant_id, title, created_at) VALUES ('${id(0xe12)}', '${T}', 'Seeded task', '2026-03-02T00:00:00Z')`,
    after: taskState, run: (db) => db.from('tasks').update({ title: 'Both' }).eq('title', 'Seeded task').select('id').single() },
  { name: 'update maybeSingle', as: ['service'], reset: seedTask, after: taskState, run: (db) => db.from('tasks').update({ title: 'Maybe' }).eq('id', TK).select('title').maybeSingle() },
  { name: 'update jsonb and array columns', as: ['service'], reset: seedTask, after: taskState,
    run: (db) => db.from('tasks').update({ metadata: { k: 2, nested: { a: [1, 2] } }, tags: ['x', 'y'] }).eq('id', TK).select('metadata, tags') },
  { name: 'update set null', as: ['service'], reset: seedTask, after: taskState, run: (db) => db.from('tasks').update({ assignee_id: null }).eq('id', TK).select('assignee_id') },
  { name: 'update empty object', as: ['service'], reset: seedTask, after: taskState, run: (db) => db.from('tasks').update({}).eq('id', TK).select('id') },
  { name: 'update data row json + updated_by', from: 'lib/services/data-tables.ts', as: ['service', 'alice'], reset: resetRow, after: rowState,
    run: (db) => db.from('custom_table_rows').update({ data: { serial: 'B-2', cost: 99 }, updated_by: ALICE }).eq('id', ROW).eq('table_id', id(0x801)).eq('tenant_id', T).select('id, data').single() },
  { name: 'update with in() and or()', as: ['service'], reset: seedTask, after: taskState,
    run: (db) => db.from('tasks').update({ priority: 'none' }).in('id', [TK, id(0x3ff)]).or('status.eq.todo,status.eq.blocked').select('id, priority') },
  { name: 'update returning embed', as: ['service'], reset: seedTask, after: taskState,
    run: (db) => db.from('tasks').update({ assignee_id: ALICE }).eq('id', TK).select('id, assignee:users!tasks_assignee_id_fkey(display_name)').single() },
  { name: 'update tenants as member (lockdown: no rows)', from: '__tests__/tenant-settings-lockdown-db.test.ts', as: ['alice', 'bob'],
    after: `SELECT name FROM public.tenants WHERE id = '${T}'`,
    run: (db) => db.from('tenants').update({ name: 'Hijacked' }).eq('id', T).select('id') },
  { name: 'update other user row (RLS: no rows)', as: ['bob'], reset: seedTask, after: `SELECT display_name FROM public.users WHERE id = '${ALICE}'`,
    run: (db) => db.from('users').update({ display_name: 'Mallory' }).eq('id', ALICE).select('id') },
  { name: 'update unknown column (PGRST204)', as: ['service'], run: (db) => db.from('tasks').update({ nope: 1 }).eq('id', TK) },
  { name: 'update without filters (safeupdate 21000)', as: ['service'], reset: seedTask, after: taskState, run: (db) => db.from('tasks').update({ title: 'Everything' }) },
  { name: 'update without filters, unknown column (PGRST204 first)', as: ['service'], run: (db) => db.from('tasks').update({ nope: 1 }) },
  { name: 'update without filters, empty body (no-op)', as: ['service'], run: (db) => db.from('tasks').update({}).select('id') },

  // ── delete ──
  { name: 'delete by id, minimal', from: 'lib/services/notifications.ts', as: ['service'], reset: seedN1, after: notifState, run: (db) => db.from('notifications').delete().eq('id', N1) },
  { name: 'delete returning', as: ['service'], reset: seedN1, after: notifState, run: (db) => db.from('notifications').delete().eq('id', N1).select('id, title') },
  { name: 'delete count exact', as: ['service'], reset: seedN1, after: notifState, run: (db) => db.from('notifications').delete({ count: 'exact' }).in('id', [N1, N2]) },
  { name: 'delete own notification as member', as: ['alice', 'bob'], reset: seedN1, after: notifState, run: (db) => db.from('notifications').delete().eq('id', N1).select('id') },
  { name: 'delete no match single (PGRST116)', as: ['service'], reset: seedN1, after: notifState, run: (db) => db.from('notifications').delete().eq('id', N2).select('id').single() },
  { name: 'delete without filters (safeupdate 21000)', as: ['service'], reset: seedN1, after: notifState, run: (db) => db.from('notifications').delete().select('id') },
  { name: 'delete FK restrict (23503)', as: ['service'], after: `SELECT count(*)::int AS n FROM public.users WHERE id = '${ALICE}'`,
    run: (db) => db.from('users').delete().eq('id', ALICE) },
  { name: 'delete with not-null filter and embed select', as: ['service'], reset: seedTask, after: taskState,
    run: (db) => db.from('tasks').delete().eq('id', TK).not('assignee_id', 'is', null).select('id, assignee:users!tasks_assignee_id_fkey(display_name)') },
]
