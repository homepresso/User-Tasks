/**
 * Forms in the governance framework against a LOCAL Supabase stack
 * (migration 20261213000000_forms_governance.sql):
 *
 *  - retention: a forms-scoped purge policy assigned to a form purges the
 *    submissions that are due, with the stored files only they hold (rows and
 *    storage objects); newer submissions and files a task also uses stay; the
 *    purge is recorded (retention_execution_events, audit row) and a re-run
 *    does nothing more;
 *  - legal hold: a held form is skipped by the retention job and the Keep
 *    submissions cleanup, cannot be deleted, and placing / releasing the
 *    hold is audited;
 *  - audit rows for create, availability toggle, grant changes (Submit
 *    wording), grant removal, retention assignment, purge and delete;
 *  - deletion: refused while a workflow uses the form; then removes its
 *    versions, submissions, stored files and grants;
 *  - the governance overview lists forms; another workspace can't touch them.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/forms-governance-db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

const storageDeletes = vi.hoisted(() => [] as Array<{ bucket: string; keys: string[] }>)
vi.mock('@/lib/providers/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/storage')>()),
  getStorageProvider: async () => ({
    ensureBucket: async () => {},
    delete: async (bucket: string, keys: string[]) => { storageDeletes.push({ bucket, keys: [...keys] }) },
  }),
}))

import * as forms from '@/lib/services/forms'
import { purgeFormSubmissions, setFormLegalHold } from '@/lib/services/form-governance'
import { assignRetentionPolicy } from '@/lib/services/retention'
import { removeObjectPermission, setObjectPermission } from '@/lib/services/object-permissions'
import { listDueFormSubmissionPurges } from '@/lib/retention-review'
import { processFormSubmissionPurges } from '@/lib/jobs/retention'
import { runUiRead } from '@/lib/services/ui-reads'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are loose JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `f09f0000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const A = id(0xa)
const B = id(0xb)
const TEAM = id(0x201)
const WORKFLOW = id(0x301)
const POLICY = id(0x401)
const TABLES_POLICY = id(0x402)
const FIELDS = [{ key: 'note', label: 'Note', type: 'text' }]
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const sha = 'a'.repeat(64)
const DAY = 24 * 60 * 60 * 1000

describe.skipIf(!DB_URL)('forms governance (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const ctx = (tenantId: string, permissions: string[] | null = null): ServiceContext =>
    ({ supabase: admin, tenantId, actorId: null, permissions: permissions ? new Set(permissions) : null, authKind: 'api_key', source: 'api' })
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as any[]
  const audits = async (formId: string) => q(`SELECT action, summary, metadata FROM public.object_audit_log WHERE tenant_id = $1 AND object_type = 'form' AND object_id = $2 ORDER BY created_at, id`, [A, formId])
  let fileSeq = 0

  async function cleanup() {
    for (const t of [A, B]) {
      for (const table of ['retention_execution_events', 'retention_review_events', 'form_files', 'form_submissions', 'object_permissions', 'workflows', 'form_versions', 'forms', 'retention_policies', 'teams', 'object_audit_log', 'github_sync_queue', 'github_sync_asset_map']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      }
      await db.query('DELETE FROM public.tenants WHERE id = $1', [t])
    }
  }

  /** A submission `daysAgo` old, optionally with a file only it holds and one a task also holds. */
  async function submission(formId: string, daysAgo: number, files: { own?: boolean; shared?: boolean } = {}) {
    const [row] = await q(`INSERT INTO public.form_submissions (tenant_id, form_id, form_name, values, created_at) VALUES ($1, $2, 'f', '{"note":"x"}', $3) RETURNING id`,
      [A, formId, new Date(Date.now() - daysAgo * DAY).toISOString()])
    const keys: Record<string, string> = {}
    for (const kind of ['own', 'shared'] as const) {
      if (!files[kind]) continue
      const key = `${A}/form-${formId}/${id(0x9000 + ++fileSeq)}/${kind}.pdf`
      const taskId = kind === 'shared' ? (await q(`INSERT INTO public.tasks (tenant_id, title, status) VALUES ($1, 'holds a file', 'todo') RETURNING id`, [A]))[0].id : null
      await q(`INSERT INTO public.form_files (tenant_id, storage_key, name, size, mime_type, checksum_sha256, context_kind, form_id, task_id, field_key, status, submission_id)
               VALUES ($1, $2, $3, 10, 'application/pdf', $4, 'form', $5, $6, 'docs', 'bound', $7)`, [A, key, `${kind}.pdf`, sha, formId, taskId, row.id])
      keys[kind] = key
    }
    return { id: row.id as string, keys }
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    await db.connect()
    await cleanup()
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Gov A', 'formsgov-a-test'), ($2, 'Gov B', 'formsgov-b-test')`, [A, B])
    await q(`INSERT INTO public.teams (id, tenant_id, name) VALUES ($1, $2, 'Claims team')`, [TEAM, A])
    await q(`INSERT INTO public.retention_policies (id, tenant_id, name, policy_mode, duration_value, duration_unit, applies_to)
             VALUES ($1, $3, 'Claims 30 days', 'purge_on', 30, 'days', '{forms}'), ($2, $3, 'Tables 1 year', 'purge_on', 1, 'years', '{data_tables}')`, [POLICY, TABLES_POLICY, A])
  }, 60_000)

  beforeEach(() => { storageDeletes.length = 0 })

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
  })

  it('purges due submissions and the files only they hold under a forms retention policy, and records it', async () => {
    const form = await forms.createForm(ctx(A), { name: 'Expense claim', fields: FIELDS })
    // A policy without the forms scope is refused; the forms policy is applied and audited.
    await expect(assignRetentionPolicy(ctx(A), { targetType: 'form', targetId: form.id, retentionPolicyId: TABLES_POLICY })).rejects.toMatchObject({ status: 400 })
    const assigned = await assignRetentionPolicy(ctx(A), { targetType: 'form', targetId: form.id, retentionPolicyId: POLICY })
    expect(assigned).toMatchObject({ assigned: true, target_type: 'form', retention_policy_id: POLICY })
    // Another workspace cannot assign to this form.
    await expect(assignRetentionPolicy(ctx(B), { targetType: 'form', targetId: form.id, retentionPolicyId: null })).rejects.toMatchObject({ status: 404 })

    const old = await submission(form.id, 60, { own: true, shared: true })
    const older = await submission(form.id, 45)
    const fresh = await submission(form.id, 2, { own: true })

    const due = await listDueFormSubmissionPurges(admin as any, A)
    expect(due).toEqual([expect.objectContaining({ form_id: form.id, retention_policy_id: POLICY, policy_mode: 'purge_on', legal_hold: false })])
    const totals = await processFormSubmissionPurges(admin as any, due)
    expect(totals).toMatchObject({ submissions: 2, files: 1, held: 0, executedPolicies: 1 })

    const left = (await q('SELECT id FROM public.form_submissions WHERE form_id = $1', [form.id])).map((r) => r.id)
    expect(left).toEqual([fresh.id])
    expect(left).not.toContain(older.id)
    // The file only the purged submission held: row and stored object gone. The task's file stays (unlinked).
    expect(await q('SELECT 1 FROM public.form_files WHERE storage_key = $1', [old.keys.own])).toHaveLength(0)
    expect(storageDeletes.flatMap((d) => d.keys)).toEqual([old.keys.own])
    expect(storageDeletes.every((d) => d.bucket === 'form-files')).toBe(true)
    expect(await q('SELECT submission_id FROM public.form_files WHERE storage_key = $1', [old.keys.shared])).toEqual([{ submission_id: null }])
    expect(await q('SELECT 1 FROM public.form_files WHERE storage_key = $1', [fresh.keys.own])).toHaveLength(1)

    // The audit trail: the execution event and the purge on the form (no submission values).
    const [event] = await q(`SELECT target_type, target_id, metadata FROM public.retention_execution_events WHERE tenant_id = $1 AND target_id = $2`, [A, form.id])
    expect(event).toMatchObject({ target_type: 'form', metadata: expect.objectContaining({ submissions: 2, files: 1 }) })
    const trail = await audits(form.id)
    expect(trail.map((r) => r.action)).toEqual(['create', 'retention', 'purge'])
    expect(trail[1].summary).toContain('Applied retention policy "Claims 30 days"')
    expect(trail[2].summary).toMatch(/purged 2 submissions of form "Expense claim" and 1 file/)
    expect(JSON.stringify(trail[2])).not.toContain('"note"')

    // A second run the same day finds nothing more to do.
    expect(await processFormSubmissionPurges(admin as any, await listDueFormSubmissionPurges(admin as any, A))).toMatchObject({ submissions: 0, executedPolicies: 0 })
  })

  it('respects a legal hold: nothing is purged (retention or Keep submissions), the form cannot be deleted, and the hold is audited', async () => {
    const form = await forms.createForm(ctx(A), { name: 'Held claim', fields: FIELDS, submission_retention_days: 7 })
    await assignRetentionPolicy(ctx(A), { targetType: 'form', targetId: form.id, retentionPolicyId: POLICY })
    const old = await submission(form.id, 90, { own: true })

    await expect(setFormLegalHold(ctx(A, ['forms.view']), form.id, { hold: true })).rejects.toMatchObject({ status: 403 })
    await expect(setFormLegalHold(ctx(B), form.id, { hold: true })).rejects.toMatchObject({ status: 404 })
    const held = await setFormLegalHold(ctx(A), form.id, { hold: true, reason: 'Case 2026-114' })
    expect(held).toMatchObject({ legal_hold: true, legal_hold_reason: 'Case 2026-114' })

    const due = await listDueFormSubmissionPurges(admin as any, A)
    expect(due.find((d) => d.form_id === form.id)).toMatchObject({ legal_hold: true })
    expect(await processFormSubmissionPurges(admin as any, due.filter((d) => d.form_id === form.id))).toMatchObject({ submissions: 0, held: 1 })
    // Directly (the Keep submissions cleanup path) as well.
    expect(await purgeFormSubmissions(admin as any, { tenantId: A, formId: form.id, before: new Date().toISOString() })).toEqual({ held: true, submissions: 0, files: 0 })
    expect(await q('SELECT id FROM public.form_submissions WHERE form_id = $1', [form.id])).toEqual([{ id: old.id }])
    expect(storageDeletes).toEqual([])

    await expect(forms.deleteForm(ctx(A), form.id)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('legal hold') })
    expect(await q('SELECT 1 FROM public.forms WHERE id = $1', [form.id])).toHaveLength(1)

    await setFormLegalHold(ctx(A), form.id, { hold: false })
    expect((await audits(form.id)).map((r) => r.action)).toEqual(['create', 'retention', 'legal_hold', 'legal_hold_release'])
    expect((await audits(form.id))[2].summary).toContain('Case 2026-114')
    // Released: the next run purges it.
    expect(await processFormSubmissionPurges(admin as any, (await listDueFormSubmissionPurges(admin as any, A)).filter((d) => d.form_id === form.id))).toMatchObject({ submissions: 1, files: 1 })
  })

  it('audits availability toggles and grant changes with the Submit wording', async () => {
    const form = await forms.createForm(ctx(A), { name: 'Leave request', fields: FIELDS })
    await forms.updateForm(ctx(A), form.id, { available_in_menu: true })
    const [member] = await q(`SELECT id FROM public.roles WHERE tenant_id = $1 AND slug = 'member'`, [A])
    const grant = await setObjectPermission(ctx(A), { object_type: 'form', object_id: form.id, role_id: member.id, can_view: true, can_execute: true, can_edit: true })
    // Forms use View and Submit only.
    expect(grant).toMatchObject({ object_type: 'form', can_view: true, can_execute: true, can_edit: false, can_delete: false })
    await setObjectPermission(ctx(A), { object_type: 'form', object_id: form.id, role_id: member.id, can_view: true, can_execute: false })
    const teamGrant = await setObjectPermission(ctx(A), { object_type: 'form', object_id: form.id, team_id: TEAM, can_execute: true })
    await removeObjectPermission(ctx(A), teamGrant.id)
    // Validation, permission and workspace checks.
    await expect(setObjectPermission(ctx(A), { object_type: 'form', object_id: form.id, role_id: member.id, team_id: TEAM })).rejects.toMatchObject({ status: 400 })
    await expect(setObjectPermission(ctx(A, ['forms.edit']), { object_type: 'form', object_id: form.id, team_id: TEAM })).rejects.toMatchObject({ status: 403 })
    await expect(setObjectPermission(ctx(B), { object_type: 'form', object_id: form.id, team_id: TEAM })).rejects.toMatchObject({ status: 404 })

    const trail = await audits(form.id)
    expect(trail.map((r) => r.action)).toEqual(['create', 'toggle', 'grant', 'grant', 'grant', 'revoke'])
    expect(trail[1].summary).toBe('Listed form "Leave request" in Available forms')
    expect(trail[2].summary).toBe('Gave role "Member" View, Submit on form "Leave request"')
    expect(trail[3].summary).toBe('Changed role "Member" on form "Leave request" from View, Submit to View')
    expect(trail[4].summary).toBe('Gave team "Claims team" View, Submit on form "Leave request"')
    expect(trail[5].summary).toBe('Removed team "Claims team" from form "Leave request"')
    expect(trail[2].metadata).toMatchObject({ grantee_type: 'role', can_execute: true, via: 'api' })
  })

  it('protects forms used by workflows and deletes versions, submissions, files and grants', async () => {
    const form = await forms.createForm(ctx(A), { name: 'Onboarding', fields: FIELDS })
    await forms.updateForm(ctx(A), form.id, { fields: [...FIELDS, { key: 'start', label: 'Start', type: 'date' }] })
    const [member] = await q(`SELECT id FROM public.roles WHERE tenant_id = $1 AND slug = 'member'`, [A])
    await setObjectPermission(ctx(A), { object_type: 'form', object_id: form.id, role_id: member.id, can_execute: true })
    const sub = await submission(form.id, 1, { own: true, shared: true })
    const [loose] = await q(`INSERT INTO public.form_files (tenant_id, storage_key, name, size, mime_type, checksum_sha256, context_kind, form_id, field_key, status, expires_at)
      VALUES ($1, $2, 'draft.pdf', 1, 'application/pdf', $3, 'form', $4, 'docs', 'pending', now() + interval '1 day') RETURNING storage_key`, [A, `${A}/form-${form.id}/${id(0x9999)}/draft.pdf`, sha, form.id])

    const nodes = [{ id: 'review', type: 'user_task', label: 'Review', position: { x: 0, y: 0 }, config: { title: 'Review', form_id: form.id, fields: FIELDS } }]
    await q(`INSERT INTO public.workflows (id, tenant_id, name, trigger_type, trigger_config, nodes, edges, is_active) VALUES ($1, $2, 'Uses onboarding', 'manual', '{}', $3, '[]', false)`, [WORKFLOW, A, JSON.stringify(nodes)])
    await expect(forms.deleteForm(ctx(A), form.id)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Uses onboarding') })
    // Nothing was touched by the refused delete.
    expect(await q(`SELECT 1 FROM public.object_permissions WHERE object_type = 'form' AND object_id = $1`, [form.id])).toHaveLength(1)
    expect(storageDeletes).toEqual([])

    await q('DELETE FROM public.workflows WHERE id = $1', [WORKFLOW])
    await expect(forms.deleteForm(ctx(B), form.id)).rejects.toMatchObject({ status: 404 })
    expect(await forms.deleteForm(ctx(A), form.id)).toMatchObject({ deleted: true })

    expect(await q('SELECT 1 FROM public.forms WHERE id = $1', [form.id])).toHaveLength(0)
    expect(await q('SELECT 1 FROM public.form_versions WHERE form_id = $1', [form.id])).toHaveLength(0)
    expect(await q('SELECT 1 FROM public.form_submissions WHERE id = $1', [sub.id])).toHaveLength(0)
    expect(await q(`SELECT 1 FROM public.object_permissions WHERE object_type = 'form' AND object_id = $1`, [form.id])).toHaveLength(0)
    expect(storageDeletes.flatMap((d) => d.keys).sort()).toEqual([sub.keys.own, loose.storage_key].sort())
    // The task's copy stays with the task.
    expect(await q('SELECT form_id, submission_id FROM public.form_files WHERE storage_key = $1', [sub.keys.shared])).toEqual([{ form_id: null, submission_id: null }])
    const trail = await audits(form.id)
    expect(trail.at(-1)).toMatchObject({ action: 'delete', metadata: expect.objectContaining({ version: 2, submissions: 1, files: 2, grants: 1 }) })
  })

  it('lists forms in the governance overview and their retention for governance', async () => {
    const form = await forms.createForm(ctx(A), { name: 'Overview form', fields: FIELDS })
    await assignRetentionPolicy(ctx(A), { targetType: 'form', targetId: form.id, retentionPolicyId: POLICY })
    const read = (name: string, args: unknown, tenant = A, perms = ['team.change_roles', 'forms.view']) =>
      runUiRead({ ...ctx(tenant, perms), authKind: 'session', source: 'ui' } as ServiceContext, { name, args })
    const overview = (await read('governance.permissionObjects', { tenantId: A }) as any).data
    expect(overview).toContainEqual(expect.objectContaining({ type: 'form', id: form.id, name: 'Overview form', href: `/automations/forms?details=${form.id}` }))
    const retention = (await read('governance.formRetention', undefined) as any).data
    expect(retention.find((r: any) => r.id === form.id)).toMatchObject({ retention_policy_id: POLICY, retention_policy: { name: 'Claims 30 days' }, legal_hold: false })
    const one = (await read('governance.form', { formId: form.id }) as any).data
    expect(one).toMatchObject({ id: form.id, submission_count: 0, retention_policy: { policy_mode: 'purge_on' } })
    expect(await read('governance.formRetention', undefined, A, ['forms.view'])).toMatchObject({ ok: false, status: 403 })
    // Another workspace sees none of it.
    expect((await read('governance.permissionObjects', { tenantId: B }, B) as any).data.some((o: any) => o.id === form.id)).toBe(false)
    expect(await read('governance.form', { formId: form.id }, B)).toMatchObject({ ok: false })
  })
})
