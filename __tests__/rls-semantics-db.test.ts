/**
 * RLS semantics snapshot: for a fixed fixture (two tenants, users in
 * different membership / current-tenant states, anon), records which fixture
 * rows each caller can SELECT, INSERT, UPDATE (in place and moved to the other
 * tenant) and DELETE on every RLS-enabled table in `public`, and compares the
 * result with __snapshots__/rls-semantics.json.
 *
 * The snapshot was recorded before 20261027000000_rls_initplan.sql and must
 * stay identical after it (policy rewrites are performance-only). The only
 * changes that migration made to the file are its two intended fixes:
 * workflow_logs INSERT is no longer open to every caller (anon included), and
 * user_memberships reads no longer fail with 42P17 (self-referencing policy).
 * 20261028000000_perf_api_reports.sql changed one more entry, on purpose:
 * tag_definitions INSERT of a tenant-less (global) row is denied for anon and
 * for callers without a tenant.
 * 20261031000000_tenant_settings_lockdown.sql changed two more, on purpose:
 * tenants UPDATE is no longer open to members (the tenant_update policy is
 * gone — workspace settings are written server-side behind settings.edit, so
 * every caller's update matches 0 rows), and users "move" (a user setting
 * their own tenant_id to another workspace) now fails with 42501 (trigger
 * trg_users_guard_tenant_columns; current_tenant_id gets the same guard).
 * 20261101000000_workspace_themes.sql added workspace_themes (members read
 * their workspace's row; no end-user writes — INSERT/UPDATE/DELETE are not
 * granted, so every caller gets 42501). Its tenant-insert trigger seeds a row
 * per tenant; the fixture replaces those with its own rows.
 * 20261103200000_notification_and_queue_delete.sql added notifications
 * DELETE: a user can delete their own notifications in member workspaces
 * (each caller's delete results now match their update results).
 * 20261114000000_user_jobs.sql added user_jobs (own jobs, or every job of a
 * workspace where the caller has settings.edit; SELECT only).
 * 20261115000000_forms.sql added forms, form_versions and form_themes
 * (members read their current workspace's rows; no end-user writes —
 * INSERT/UPDATE/DELETE are not granted, so every caller gets 42501).
 *
 * 20261116000000_form_submissions.sql added form_submissions (a caller reads
 * the rows they submitted in their current workspace, or all of them with
 * forms.edit; no end-user writes — every caller gets 42501).
 *
 * 20261117000000_community_gallery.sql added the community gallery tables:
 * community_packages / community_package_versions (everyone, anon included,
 * reads listed rows only), gallery_submissions (a user reads their own) and
 * gallery_abuse_reports (nobody); no end-user writes — every caller gets 42501.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/rls-semantics-db.test.ts
 * End users are simulated the way PostgREST does it: SET ROLE + request.jwt.claims.
 * Everything runs in one transaction that is rolled back.
 */
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL

type K = 'A' | 'B'
type Values = Record<string, unknown>

/** Deterministic uuid per fixture key. */
function uid(key: string): string {
  const h = createHash('md5').update(`rls-semantics:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const TENANT: Record<K | 'C', string> = { A: uid('tenant:A'), B: uid('tenant:B'), C: uid('tenant:C') }
const OTHER: Record<K, K> = { A: 'B', B: 'A' }

/**
 * Users: home tenant (users.tenant_id), current tenant (NULL = the "All
 * organizations" unified view) and memberships (active unless marked).
 */
const USERS = {
  a: { home: 'A', current: 'A', member: { A: true } },
  b: { home: 'B', current: 'B', member: { B: true } },
  ab_cur_a: { home: 'A', current: 'A', member: { A: true, B: true } },
  ab_cur_b: { home: 'A', current: 'B', member: { A: true, B: true } },
  ab_unified: { home: 'A', current: null, member: { A: true, B: true } },
  b_inactive: { home: 'A', current: 'A', member: { A: true, B: false } },
} as const satisfies Record<string, { home: K; current: K | null; member: Partial<Record<K, boolean>> }>
type UserKey = keyof typeof USERS
const U = Object.fromEntries(Object.keys(USERS).map((k) => [k, uid(`user:${k}`)])) as Record<UserKey, string>
/** Auth user whose public.users row (and memberships) are gone. */
const GHOST = uid('user:ghost')
/** Auth users without a public.users row, used as INSERT targets for `users`. */
const SPARE: Record<K, string> = { A: uid('user:spare:A'), B: uid('user:spare:B') }
const OWNER: Record<K, string> = { A: U.a, B: U.b }

const CALLERS: Array<{ name: string; role: 'anon' | 'authenticated'; sub?: string }> = [
  { name: 'anon', role: 'anon' },
  { name: 'ghost', role: 'authenticated', sub: GHOST },
  ...(Object.keys(USERS) as UserKey[]).map((k) => ({ name: k, role: 'authenticated' as const, sub: U[k] })),
]

/** Fixture id of `table`'s row `v` in tenant `k`. */
const id = (table: string, k: K, v = 'row') => uid(`${table}:${k}:${v}`)
const future = '2099-01-01T00:00:00Z'

interface Spec {
  table: string
  /** Column values for variant `v` in tenant `k` (`id` is added for uuid-id tables). */
  make: (k: K, v: string) => Values
  /** Fixture variants per tenant (default ['row']). */
  variants?: string[]
  /** Variant used for the INSERT probe (default 'new'). */
  insertVariant?: string
  /** "Move to the other tenant" probe: SET clause for row `k` (default tenant_id). */
  move?: ((k: K) => Values) | null
  /** No-op UPDATE column (default tenant_id). */
  touch?: string
}

const SPECS: Spec[] = [
  { table: 'workspace_themes', variants: ['row'], insertVariant: 'row', make: (k) => ({ tenant_id: TENANT[k], theme: { base_preset: 'basecamp' } }) },
  { table: 'workflow_sources', make: (k, v) => ({ tenant_id: TENANT[k], engine_type: 'native', display_name: `src ${v}` }) },
  { table: 'teams', make: (k, v) => ({ tenant_id: TENANT[k], name: `team ${v}` }) },
  { table: 'tasks', variants: ['row', 'dep'], make: (k, v) => ({ tenant_id: TENANT[k], title: `task ${v}` }) },
  { table: 'workflows', make: (k, v) => ({ tenant_id: TENANT[k], name: `wf ${v}` }) },
  {
    table: 'workflow_versions',
    make: (k, v) => ({ workflow_id: id('workflows', k), tenant_id: TENANT[k], version_number: v === 'row' ? 1 : 2, trigger_type: 'manual' }),
  },
  { table: 'workflow_runs', make: (k) => ({ workflow_id: id('workflows', k), tenant_id: TENANT[k] }) },
  {
    table: 'workflow_logs',
    make: (k, v) => ({ workflow_id: id('workflows', k), run_id: id('workflow_runs', k), tenant_id: TENANT[k], message: `log ${v}` }),
  },
  { table: 'workflow_queue', make: (k) => ({ workflow_id: id('workflows', k), tenant_id: TENANT[k], trigger_type: 'manual' }) },
  {
    table: 'workflow_webhooks',
    make: (k, v) => ({ workflow_id: id('workflows', k), tenant_id: TENANT[k], slug: `rls-${k}-${v}`, api_key_hash: `h-${k}-${v}`, api_key_prefix: 'p' }),
  },
  { table: 'integrations', make: (k, v) => ({ tenant_id: TENANT[k], name: `int ${v}`, type: 'http' }) },
  { table: 'integration_references', make: (k, v) => ({ integration_id: id('integrations', k), tenant_id: TENANT[k], name: `ref ${v}` }) },
  { table: 'integration_call_logs', make: (k) => ({ tenant_id: TENANT[k], integration_id: id('integrations', k) }) },
  { table: 'agents', make: (k, v) => ({ tenant_id: TENANT[k], name: `agent ${v}` }) },
  { table: 'agent_queue', make: (k, v) => ({ tenant_id: TENANT[k], agent_id: id('agents', k), input_message: `msg ${v}` }) },
  { table: 'agent_runs', make: (k) => ({ tenant_id: TENANT[k], agent_id: id('agents', k) }) },
  { table: 'retention_policies', make: (k, v) => ({ tenant_id: TENANT[k], name: `rp ${v}`, policy_mode: 'keep_forever' }) },
  { table: 'custom_tables', make: (k, v) => ({ tenant_id: TENANT[k], name: `table ${v}`, slug: `rls-${v}` }) },
  { table: 'custom_table_rows', make: (k) => ({ tenant_id: TENANT[k], table_id: id('custom_tables', k) }) },
  { table: 'custom_workflow_activities', make: (k, v) => ({ tenant_id: TENANT[k], name: `act ${v}`, key: `rls-${v}`, source_code: 'x' }) },
  { table: 'dead_letter_events', make: (k) => ({ tenant_id: TENANT[k], event_type: 'x', payload: '{}', target_url: 'http://x' }) },
  { table: 'decision_tables', make: (k, v) => ({ tenant_id: TENANT[k], name: `dt ${v}` }) },
  { table: 'deletion_queue', make: (k) => ({ tenant_id: TENANT[k], target_type: 'workflow', target_id: id('workflows', k) }) },
  {
    table: 'directory_links',
    make: (k, v) => ({ tenant_id: TENANT[k], provider: 'entra', object_type: 'user', external_id: `ext-${v}`, local_id: OWNER[k] }),
  },
  { table: 'directory_sync_runs', make: (k) => ({ tenant_id: TENANT[k], provider: 'entra' }) },
  {
    table: 'effort_records',
    make: (k) => ({ tenant_id: TENANT[k], task_id: id('tasks', k), user_id: OWNER[k], record_type: 'actual', minutes: 5 }),
  },
  { table: 'email_templates', make: (k, v) => ({ tenant_id: TENANT[k], name: `tpl ${v}` }) },
  {
    table: 'event_stream',
    make: (k, v) => ({ tenant_id: TENANT[k], type: 'rls.test', category: 'system', message: `ev ${v}`, source_table: 'rls' }),
  },
  { table: 'event_stream_purge_marks', make: (k) => ({ tenant_id: TENANT[k] }), move: null },
  // Instance-wide (no tenant): service role only (20261104000000).
  { table: 'instance_settings', make: (k, v) => ({ key: `email.rls_${k.toLowerCase()}_${v}`, value: '"x"' }), move: null, touch: 'value' },
  // Provider switch log (20261107000000): service role only, like instance_settings.
  { table: 'instance_provider_switches', make: (k, v) => ({ area: 'email', to_provider: `rls_${k}_${v}` }), move: null, touch: 'error' },
  { table: 'github_deployments', make: (k) => ({ tenant_id: TENANT[k], source: '{}' }) },
  {
    table: 'github_sync_asset_map',
    make: (k, v) => ({ tenant_id: TENANT[k], asset_type: 'workflow', source_id: uid(`gsam-src:${k}:${v}`), local_id: uid(`gsam-local:${k}:${v}`) }),
  },
  { table: 'github_sync_queue', make: (k) => ({ tenant_id: TENANT[k], asset_type: 'workflow', asset_id: id('workflows', k), action: 'save' }) },
  { table: 'github_sync_templates', make: (k, v) => ({ tenant_id: TENANT[k], name: `gst ${v}` }) },
  { table: 'github_sync_runs', make: (k) => ({ tenant_id: TENANT[k] }) },
  { table: 'integration_objects', make: (k, v) => ({ tenant_id: TENANT[k], name: `obj ${v}` }) },
  {
    table: 'integration_object_sources',
    make: (k, v) => ({ object_id: id('integration_objects', k), source_type: 'table', table_id: id('custom_tables', k), alias: `al_${v}` }),
    move: (k) => ({ object_id: id('integration_objects', OTHER[k]) }),
    touch: 'object_id',
  },
  { table: 'invitations', make: (k, v) => ({ tenant_id: TENANT[k], email: `${v}@rls.test`, invited_by: OWNER[k] }) },
  { table: 'lifecycle_events', make: (k) => ({ tenant_id: TENANT[k], task_id: id('tasks', k), event_type: 'created' }) },
  { table: 'log_destinations', make: (k, v) => ({ tenant_id: TENANT[k], name: `dest ${v}`, type: 'webhook' }) },
  // Reusable task forms (20261115000000): members SELECT, writes service role only.
  { table: 'forms', make: (k, v) => ({ tenant_id: TENANT[k], name: `form ${v}` }) },
  { table: 'form_versions', make: (k, v) => ({ tenant_id: TENANT[k], form_id: id('forms', k), version: v === 'row' ? 1 : 2, name: `form ${v}` }) },
  { table: 'form_themes', make: (k, v) => ({ tenant_id: TENANT[k], name: `theme ${v}` }) },
  // Form submissions (20261116000000): own rows, or every row with forms.edit; writes service role only.
  { table: 'form_submissions', variants: ['row', 'other'], make: (k, v) => ({ tenant_id: TENANT[k], form_id: id('forms', k), form_name: `form ${v}`, submitted_by: v === 'other' ? null : OWNER[k] }) },
  // Community gallery (20261117000000): anyone reads LISTED packages and their versions, a user reads their own
  // submissions, abuse reports are moderators-only; no end-user writes at all.
  {
    table: 'community_packages', variants: ['row', 'unlisted'],
    make: (k, v) => ({ package_uid: uid(`cp-uid:${k}:${v}`), slug: `rls-${k.toLowerCase()}-${v}`, owner_id: OWNER[k], title: `community ${v}`, summary: 's', description: 'd', category: 'workplace', author_name: 'Author', current_version: '1.0.0', status: v === 'unlisted' ? 'unlisted' : 'listed' }),
    move: null, touch: 'title',
  },
  {
    table: 'community_package_versions', variants: ['row', 'unlisted'],
    make: (k, v) => ({ package_id: id('community_packages', k, v === 'unlisted' ? 'unlisted' : 'row'), version: v === 'new' ? '1.0.1' : '1.0.0', file_path: 'p', file_name: 'f.utpkg', size_bytes: 1, sha256: 'x', checksum: 'sha256:x' }),
    move: null, touch: 'notes',
  },
  {
    table: 'gallery_submissions', variants: ['row', 'other'],
    make: (k, v) => ({ submitter_id: v === 'other' ? null : OWNER[k], tenant_id: TENANT[k], package_uid: uid(`gs-uid:${k}:${v}`), slug: `rls-${k.toLowerCase()}-${v}`, version: '1.0.0', title: `submission ${v}`, summary: 's', description: 'd', category: 'workplace', author_name: 'Author', file_path: 'p', file_name: 'f.utpkg', size_bytes: 1, sha256: 'x', checksum: 'sha256:x' }),
    move: null, touch: 'title',
  },
  { table: 'gallery_abuse_reports', make: (k) => ({ package_id: id('community_packages', k), reason: 'spam', reporter_id: OWNER[k] }), move: null, touch: 'details' },
  // SCIM (20261109000000): service role only.
  { table: 'scim_tokens', make: (k, v) => ({ tenant_id: TENANT[k], name: `scim ${v}`, token_hash: createHash('sha256').update(`rls-${k}-${v}`).digest('hex'), token_prefix: 'utscim_x' }) },
  { table: 'scim_resources', variants: ['row', 'member'], make: (k, v) => ({ tenant_id: TENANT[k], resource_type: 'User', user_name: `rls-${k}-${v}@scim.test` }) },
  {
    table: 'scim_group_members',
    make: (k, v) => ({ tenant_id: TENANT[k], group_id: id('scim_resources', k), member_id: id('scim_resources', k, v === 'row' ? 'member' : 'row') }),
  },
  // Packages (service role only: every end-user caller sees and changes nothing).
  { table: 'packages', make: (k, v) => ({ tenant_id: TENANT[k], name: `pkg ${v}`, slug: `pkg-${k.toLowerCase()}-${v}` }) },
  { table: 'package_versions', make: (k, v) => ({ tenant_id: TENANT[k], package_id: id('packages', k), version: `1.0.${v === 'row' ? 0 : 1}`, manifest: {}, checksum: 'sha256:x' }) },
  { table: 'package_installs', make: (k, v) => ({ tenant_id: TENANT[k], package_uid: uid(`pkg-uid:${k}:${v}`), name: `pkg ${v}`, slug: `pkg-${v}`, version: '1.0.0', checksum: 'sha256:x' }) },
  {
    table: 'package_install_assets',
    make: (k, v) => ({ tenant_id: TENANT[k], install_id: id('package_installs', k), asset_type: 'workflow', section: 'workflows', source_id: `src-${v}`, local_id: id('workflows', k) }),
  },
  { table: 'package_events', make: (k, v) => ({ tenant_id: TENANT[k], package_name: `pkg ${v}`, action: 'install', status: 'succeeded', channel: 'ui' }) },
  { table: 'mcp_servers', make: (k, v) => ({ tenant_id: TENANT[k], name: `mcp ${v}`, url: 'http://x' }) },
  { table: 'node_favorites', make: (k, v) => ({ tenant_id: TENANT[k], node_type: `rls_${v}` }) },
  {
    table: 'notifications',
    variants: ['row', 'multi'],
    // 'multi' belongs to a multi-tenant user: ab_cur_b in B, ab_unified in A.
    make: (k, v) => ({ user_id: v === 'multi' ? (k === 'A' ? U.ab_unified : U.ab_cur_b) : OWNER[k], tenant_id: TENANT[k], type: 'info', title: `n ${v}` }),
  },
  {
    // 20261114000000_user_jobs.sql: users read their own jobs, workspace
    // admins (settings.edit) every job of the workspace; no client writes.
    table: 'user_jobs',
    variants: ['row', 'multi'],
    make: (k, v) => ({ user_id: v === 'multi' ? (k === 'A' ? U.ab_unified : U.ab_cur_b) : OWNER[k], tenant_id: TENANT[k], kind: 'config.export', title: `job ${v}` }),
  },
  { table: 'oauth_clients', make: (k, v) => ({ tenant_id: TENANT[k], client_id: `rls-${k}-${v}`, name: 'c', client_type: 'public' }) },
  {
    table: 'oauth_authorization_codes',
    make: (k, v) => ({
      tenant_id: TENANT[k], code_hash: `rls-${k}-${v}`, client_id: `rls-${k}-row`, user_id: OWNER[k],
      redirect_uri: 'http://x', code_challenge: 'x', expires_at: future,
    }),
  },
  { table: 'oauth_connect_states', make: (k, v) => ({ tenant_id: TENANT[k], kind: 'connector_authorize', state_hash: `rls-${k}-${v}`, expires_at: future }) },
  {
    table: 'oauth_tokens',
    make: (k, v) => ({
      tenant_id: TENANT[k], token_type: 'access', token_hash: `rls-${k}-${v}`, token_prefix: 'p', client_id: `rls-${k}-row`,
      grant_type: 'authorization_code', expires_at: future,
    }),
  },
  { table: 'object_audit_log', make: (k) => ({ tenant_id: TENANT[k], object_type: 'workflow', object_id: 'x', action: 'update' }) },
  { table: 'object_permissions', make: (k, v) => ({ tenant_id: TENANT[k], object_type: 'workflow', object_id: uid(`op:${k}:${v}`), user_id: OWNER[k] }) },
  { table: 'permission_audit_log', make: (k) => ({ tenant_id: TENANT[k], actor_id: OWNER[k], action: 'x' }) },
  {
    table: 'reports',
    variants: ['own', 'shared', 'private'],
    insertVariant: 'own-new',
    make: (k, v) => ({ tenant_id: TENANT[k], name: `report ${v}`, created_by: v.startsWith('own') ? OWNER[k] : U.ab_unified, is_shared: v === 'shared' }),
  },
  {
    table: 'retention_execution_events',
    make: (k, v) => ({
      tenant_id: TENANT[k], retention_policy_id: id('retention_policies', k), action_type: 'purge', target_type: 'data_table',
      target_id: uid(`ree:${k}:${v}`), executed_at: future,
    }),
  },
  {
    table: 'retention_review_events',
    make: (k, v) => ({
      tenant_id: TENANT[k], retention_policy_id: id('retention_policies', k), target_type: 'data_table',
      target_id: uid(`rre:${k}:${v}`), review_date: '2099-01-01',
    }),
  },
  { table: 'roles', make: (k, v) => ({ tenant_id: TENANT[k], name: `role ${v}`, slug: `rls-${v}` }) },
  {
    table: 'user_roles',
    make: (k, v) => ({ tenant_id: TENANT[k], user_id: v === 'row' ? OWNER[k] : U.ab_unified, role_id: id('roles', k) }),
  },
  { table: 'user_teams', make: (k, v) => ({ user_id: v === 'row' ? OWNER[k] : U.ab_unified, team_id: id('teams', k) }), move: (k) => ({ team_id: id('teams', OTHER[k]) }), touch: 'team_id' },
  { table: 'tag_definitions', make: (k, v) => ({ tenant_id: TENANT[k], name: `tag ${v}` }) },
  { table: 'task_assignees', make: (k, v) => ({ tenant_id: TENANT[k], task_id: id('tasks', k, v === 'row' ? 'row' : 'dep'), user_id: OWNER[k] }) },
  {
    table: 'task_dependencies',
    make: (k, v) => ({ tenant_id: TENANT[k], task_id: id('tasks', k, v === 'row' ? 'row' : 'dep'), depends_on_task_id: id('tasks', k, v === 'row' ? 'dep' : 'row') }),
  },
  { table: 'task_escalations', make: (k) => ({ tenant_id: TENANT[k], task_id: id('tasks', k) }) },
  { table: 'task_reminders', make: (k) => ({ tenant_id: TENANT[k], task_id: id('tasks', k), offset_minutes: 5 }) },
  {
    table: 'task_responses',
    make: (k, v) => ({ tenant_id: TENANT[k], task_id: id('tasks', k, v === 'row' ? 'row' : 'dep'), user_id: OWNER[k], outcome: 'approved' }),
  },
  { table: 'tenant_connectors', make: (k, v) => ({ tenant_id: TENANT[k], connector_key: `rls_${v}` }) },
  { table: 'api_keys', make: (k, v) => ({ tenant_id: TENANT[k], name: `key ${v}`, key_prefix: 'p', key_hash: `rls-${k}-${v}` }) },
]

/** Tables seeded by the fixture setup itself rather than SPECS. */
// package_signing_keys is instance-wide (no tenant_id) and service-role only.
const SPECIAL = ['tenants', 'users', 'user_memberships', 'package_signing_keys']

interface TableInfo { pk: string[]; idIdentity: boolean; hasTenant: boolean }
interface FixtureRow { label: string; key: Record<string, unknown> }

describe.skipIf(!DB_URL)('RLS semantics snapshot (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })
  const info = new Map<string, TableInfo>()
  const rows = new Map<string, FixtureRow[]>()

  async function insert(table: string, values: Values, label: string) {
    const t = info.get(table)!
    const cols = Object.keys(values)
    const { rows: [key] } = await db.query(
      `INSERT INTO public.${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING ${t.pk.join(', ')}`,
      Object.values(values),
    )
    rows.set(table, [...(rows.get(table) ?? []), { label, key }])
  }

  /** Column values plus the deterministic id for uuid-id tables. */
  function withId(table: string, values: Values, key: string): Values {
    const t = info.get(table)!
    return t.pk.length === 1 && t.pk[0] === 'id' && !t.idIdentity && !('id' in values) ? { id: uid(`${table}:${key}`), ...values } : values
  }

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    const { rows: tables } = await db.query<{ table: string; pk: string[]; identity: boolean; has_tenant: boolean }>(`
      SELECT c.relname AS table,
             array(SELECT a.attname::text FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                    WHERE i.indrelid = c.oid AND i.indisprimary ORDER BY a.attnum) AS pk,
             EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'id' AND a.attidentity <> '') AS identity,
             EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS has_tenant
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND c.relrowsecurity
       ORDER BY 1`)
    for (const t of tables) info.set(t.table, { pk: t.pk, idIdentity: t.identity, hasTenant: t.has_tenant })

    // Tenants (C: nobody is a member).
    for (const k of ['A', 'B', 'C'] as const) {
      await insert('tenants', { id: TENANT[k], name: `RLS ${k}`, slug: `rls-semantics-${k.toLowerCase()}` }, k)
    }
    // Rows the workspace-theme trigger created; SPECS inserts its own.
    await db.query('DELETE FROM public.workspace_themes WHERE tenant_id = ANY($1)', [Object.values(TENANT)])
    // Auth users; the auth trigger gives each a personal tenant, users row and
    // membership, which are replaced by the fixture's own.
    const authIds = [...Object.values(U), GHOST, ...Object.values(SPARE)]
    for (const u of authIds) {
      await db.query(
        `INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [u, `${u}@rls.test`],
      )
    }
    await db.query(`DELETE FROM public.user_memberships WHERE user_id = ANY($1)`, [authIds])
    await db.query(`DELETE FROM public.users WHERE id = ANY($1)`, [[GHOST, ...Object.values(SPARE)]])
    for (const [k, user] of Object.entries(USERS) as Array<[UserKey, (typeof USERS)[UserKey]]>) {
      await db.query(`UPDATE public.users SET tenant_id = $2, current_tenant_id = $3 WHERE id = $1`, [U[k], TENANT[user.home], user.current ? TENANT[user.current] : null])
      rows.set('users', [...(rows.get('users') ?? []), { label: k, key: { id: U[k] } }])
      for (const [t, active] of Object.entries(user.member) as Array<[K, boolean]>) {
        await insert('user_memberships', { id: uid(`m:${k}@${t}`), user_id: U[k], tenant_id: TENANT[t], role: 'member', is_active: active }, `${k}@${t}`)
      }
    }

    for (const spec of SPECS) {
      for (const k of ['A', 'B'] as const) {
        for (const v of spec.variants ?? ['row']) {
          await insert(spec.table, withId(spec.table, spec.make(k, v), `${k}:${v}`), v === 'row' ? k : `${k}:${v}`)
        }
      }
    }
    // A tenant-less (global) tag.
    await insert('tag_definitions', { id: uid('tag_definitions:global'), tenant_id: null, name: 'tag global' }, 'global')
  }, 60_000)

  afterAll(async () => {
    await db.query('ROLLBACK')
    await db.end()
  })

  it('every RLS-enabled public table is covered by the fixture', () => {
    const covered = new Set([...SPECIAL, ...SPECS.map((s) => s.table)])
    expect([...info.keys()].filter((t) => !covered.has(t))).toEqual([])
  })

  it('caller × table access matches the snapshot', async () => {
    const where = (key: Record<string, unknown>, offset = 0) => ({
      sql: Object.keys(key).map((c, i) => `${c} = $${i + 1 + offset}`).join(' AND '),
      params: Object.values(key),
    })

    /** Run one statement in a savepoint; 'ok:<rowCount>' or the SQLSTATE. */
    async function probe(sql: string, params: unknown[]): Promise<string> {
      await db.query('SAVEPOINT probe')
      try {
        const res = await db.query(sql, params)
        return `ok:${res.rowCount}`
      } catch (e) {
        return `err:${(e as { code?: string }).code ?? 'unknown'}`
      } finally {
        await db.query('ROLLBACK TO SAVEPOINT probe')
      }
    }

    // Probes per table: SELECT (visible labels), INSERT of a new row per tenant,
    // and per fixture row a no-op UPDATE, a move to the other tenant and a DELETE.
    const tableProbes = [...info.keys()].sort().map((table) => {
      const t = info.get(table)!
      const spec = SPECS.find((s) => s.table === table)
      const fixture = rows.get(table) ?? []
      const inserts: Array<[string, Values]> = []
      if (spec) {
        for (const k of ['A', 'B'] as const) {
          const v = spec.insertVariant ?? 'new'
          inserts.push([k, withId(table, spec.make(k, v), `${k}:${v}`)])
        }
        if (table === 'tag_definitions') inserts.push(['global', { id: uid('tag_definitions:global-new'), tenant_id: null, name: 'tag global new' }])
      } else if (table === 'tenants') {
        inserts.push(['new', { id: uid('tenant:new'), name: 'RLS new', slug: 'rls-semantics-new' }])
      } else if (table === 'users') {
        for (const k of ['A', 'B'] as const) inserts.push([k, { id: SPARE[k], tenant_id: TENANT[k], email: `spare-${k}@rls.test`, display_name: 'spare' }])
      } else if (table === 'user_memberships') {
        for (const k of ['A', 'B'] as const) inserts.push([k, { id: uid(`m:new@${k}`), user_id: OWNER[OTHER[k]], tenant_id: TENANT[k], role: 'member' }])
      }
      const touch = spec?.touch ?? (t.hasTenant ? 'tenant_id' : table === 'tenants' ? 'name' : t.pk[0])
      const move = (label: string): Values | null => {
        const k = label.split(/[:@]/)[0] as K
        if (spec?.move === null) return null
        if (spec?.move) return spec.move(k)
        if (table === 'user_memberships') return { tenant_id: TENANT[OTHER[label.split('@')[1] as K]] }
        if (table === 'users') return { tenant_id: TENANT[OTHER[USERS[label as UserKey].home]] }
        if (!t.hasTenant || !(k in OTHER)) return null
        return { tenant_id: TENANT[OTHER[k]] }
      }
      return { table, t, fixture, inserts, touch, move }
    })

    const result: Record<string, Record<string, unknown>> = {}
    for (const caller of CALLERS) {
      await db.query(`SET LOCAL ROLE ${caller.role}`)
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(caller.sub ? { sub: caller.sub, role: caller.role, aud: 'authenticated' } : { role: caller.role }),
      ])
      for (const { table, t, fixture, inserts, touch, move } of tableProbes) {
        const entry: Record<string, unknown> = {}
        // SELECT: which fixture rows are visible.
        const keyCols = t.pk
        await db.query('SAVEPOINT probe')
        try {
          const params = fixture.flatMap((f) => keyCols.map((c) => f.key[c]))
          const tuples = fixture.map((_, i) => `(${keyCols.map((__, j) => `$${i * keyCols.length + j + 1}`).join(', ')})`)
          const { rows: visible } = await db.query(
            `SELECT ${keyCols.join(', ')} FROM public.${table} WHERE (${keyCols.join(', ')}) IN (${tuples.join(', ')})`,
            params,
          )
          const seen = new Set(visible.map((r) => keyCols.map((c) => String(r[c])).join('|')))
          entry.select = fixture.filter((f) => seen.has(keyCols.map((c) => String(f.key[c])).join('|'))).map((f) => f.label)
        } catch (e) {
          entry.select = `err:${(e as { code?: string }).code}`
        } finally {
          await db.query('ROLLBACK TO SAVEPOINT probe')
        }
        const insert: Record<string, string> = {}
        for (const [label, values] of inserts) {
          const cols = Object.keys(values)
          insert[label] = await probe(
            `INSERT INTO public.${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
            Object.values(values),
          )
        }
        entry.insert = insert
        const update: Record<string, string> = {}
        const moved: Record<string, string> = {}
        const del: Record<string, string> = {}
        for (const f of fixture) {
          const w = where(f.key)
          update[f.label] = await probe(`UPDATE public.${table} SET ${touch} = ${touch} WHERE ${w.sql}`, w.params)
          const m = move(f.label)
          if (m) {
            const set = Object.keys(m).map((c, i) => `${c} = $${i + 1}`).join(', ')
            const w2 = where(f.key, Object.keys(m).length)
            moved[f.label] = await probe(`UPDATE public.${table} SET ${set} WHERE ${w2.sql}`, [...Object.values(m), ...w2.params])
          }
          del[f.label] = await probe(`DELETE FROM public.${table} WHERE ${w.sql}`, w.params)
        }
        entry.update = update
        if (Object.keys(moved).length) entry.move = moved
        entry.delete = del
        ;(result[table] ??= {})[caller.name] = entry
      }
      await db.query('RESET ROLE')
    }

    await expect(JSON.stringify(result, null, 1) + '\n').toMatchFileSnapshot('./__snapshots__/rls-semantics.json')
  }, 300_000)
})
