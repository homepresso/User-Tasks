import { ALICE, id, T, type Case } from './harness'

/** RPCs used by server code: scalar, array, enum, jsonb, composite, SETOF, TABLE, void. */

const resetQueue = `DELETE FROM public.workflow_queue WHERE tenant_id = '${T}'`

export const RPC_CASES: Case[] = [
  { name: 'rpc get_user_permissions (text[])', from: 'lib/permissions.ts', as: ['alice', 'bob', 'carol'], run: (db) => db.rpc('get_user_permissions') },
  { name: 'rpc get_user_permissions for tenant', from: 'lib/permissions.ts', as: ['alice', 'bob'], run: (db) => db.rpc('get_user_permissions', { p_tenant_id: T }) },
  { name: 'rpc get_user_tenant_ids (SETOF uuid)', from: 'lib/tenant.ts', as: ['alice', 'carol', 'service'], run: (db) => db.rpc('get_user_tenant_ids') },
  { name: 'rpc get_user_tenant_ids with count', as: ['alice'], run: (db) => db.rpc('get_user_tenant_ids', {}, { count: 'exact' }) },
  { name: 'rpc get_user_role_in_tenant (enum)', as: ['alice', 'bob'], run: (db) => db.rpc('get_user_role_in_tenant', { p_tenant_id: T }) },
  { name: 'rpc get_task_tree (jsonb)', from: 'lib/services/tasks.ts', as: ['alice', 'carol'], run: (db) => db.rpc('get_task_tree', { p_task_id: id(0x301) }) },
  { name: 'rpc search_custom_table_rows (TABLE)', from: 'lib/services/search.ts', as: ['alice'], run: (db) => db.rpc('search_custom_table_rows', { q: 'A-1', lim: 5 }) },
  { name: 'rpc search_custom_table_rows select/order/limit', as: ['alice'], ordered: true,
    run: (db) => db.rpc('search_custom_table_rows', { q: '-' }).select('id, table_name').order('id').limit(2) },
  { name: 'rpc TABLE result filtered', as: ['alice'], run: (db) => db.rpc('search_custom_table_rows', { q: '-' }).eq('id', id(0x812)) },
  { name: 'rpc TABLE single()', as: ['alice'], run: (db) => db.rpc('search_custom_table_rows', { q: 'C-3' }).single() },
  { name: 'rpc workflow_live_instance_counts', from: 'lib/services/workflow-versions.ts', as: ['alice', 'service'], run: (db) => db.rpc('workflow_live_instance_counts', { p_tenant_id: T, p_workflow_id: id(0x201) }) },
  { name: 'rpc via GET', as: ['alice'], run: (db) => db.rpc('get_user_permissions', { p_tenant_id: T }, { get: true }) },
  { name: 'rpc HEAD with count', as: ['alice'], run: (db) => db.rpc('get_user_tenant_ids', {}, { head: true, count: 'exact' }) },
  { name: 'rpc unknown function (PGRST202)', as: ['alice'], run: (db) => db.rpc('no_such_function', { a: 1 }) },
  { name: 'rpc wrong argument names (PGRST202)', as: ['alice'], run: (db) => db.rpc('get_task_tree', { task: id(0x301) }) },
  { name: 'rpc missing required argument (PGRST202)', as: ['alice'], run: (db) => db.rpc('add_task_dependency', { p_task: id(0x301) }) },
  { name: 'rpc invalid argument value (22P02)', as: ['alice'], run: (db) => db.rpc('get_task_tree', { p_task_id: 'nope' }) },
  { name: 'rpc claim_next_job on empty queue (composite of nulls)', as: ['service'], reset: resetQueue, run: (db) => db.rpc('claim_next_job', { p_worker_id: 'conformance' }) },
  { name: 'rpc claim_jobs SETOF table', as: ['service'], reset: resetQueue, run: (db) => db.rpc('claim_jobs', { p_worker_id: 'conformance', p_limit: 3 }) },
  { name: 'rpc release_jobs (uuid[] arg)', as: ['service'], run: (db) => db.rpc('release_jobs', { p_job_ids: [id(0xe99)], p_worker_id: 'conformance' }) },
  { name: 'rpc enqueue_workflow then queue state', from: 'lib/workflow-queue.ts', as: ['service'], reset: resetQueue, volatile: ['id', 'created_at', 'scheduled_for', 'trace_id'],
    run: async (db) => {
      const r = await db.rpc('enqueue_workflow', { p_workflow_id: id(0x201), p_tenant_id: T, p_trigger_type: 'manual', p_trigger_data: { a: 1 } })
      return { ...r, data: typeof r.data === 'string' ? 'uuid' : r.data }
    },
    after: `SELECT workflow_id, tenant_id, trigger_type, trigger_data, priority, status FROM public.workflow_queue WHERE tenant_id = '${T}'` },
  { name: 'rpc record_workflow_run (void)', from: 'lib/workflow-engine.ts', as: ['service'],
    reset: `UPDATE public.workflows SET run_count = 3, last_run_at = '2026-01-01T00:00:00Z' WHERE id = '${id(0x202)}'`,
    run: (db) => db.rpc('record_workflow_run', { p_workflow_id: id(0x202) }),
    after: `SELECT run_count FROM public.workflows WHERE id = '${id(0x202)}'` },
  { name: 'rpc create_task_with_subtasks (volatile, jsonb arg)', from: 'lib/services/tasks.ts', as: ['alice'],
    reset: `DELETE FROM public.tasks WHERE tenant_id = '${T}' AND title LIKE 'RPC %'`,
    volatile: ['id', 'task_id', 'parent_task_id', 'created_at', 'updated_at'],
    run: (db) => db.rpc('create_task_with_subtasks', { p_title: 'RPC parent', p_priority: 'high', p_subtasks: [{ title: 'RPC child' }] }),
    after: `SELECT title, priority, status, (parent_task_id IS NOT NULL) AS is_child FROM public.tasks WHERE tenant_id = '${T}' AND title LIKE 'RPC %' ORDER BY title` },
  { name: 'rpc add_task_dependency raising (P0001/23505)', as: ['alice'], run: (db) => db.rpc('add_task_dependency', { p_task: id(0x303), p_depends_on: id(0x302) }) },
  { name: 'rpc switch_tenant to a workspace you are not in', as: ['carol'], run: (db) => db.rpc('switch_tenant', { p_tenant_id: T }) },
  { name: 'rpc switch_tenant to own workspace', as: ['alice'],
    reset: `UPDATE public.users SET current_tenant_id = '${T}' WHERE id = '${ALICE}'`,
    run: (db) => db.rpc('switch_tenant', { p_tenant_id: T }),
    after: `SELECT current_tenant_id FROM public.users WHERE id = '${ALICE}'` },
]
