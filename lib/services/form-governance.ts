/**
 * Forms in the governance framework (migration 20261213000000):
 *
 *  - Legal hold: a form on hold keeps every submission and stored file —
 *    retention purges and the "Keep submissions" cleanup skip it — and cannot
 *    be deleted until the hold is released. Set by people who manage
 *    governance (team.change_roles); audited.
 *  - Retention: a form's retention policy (lib/services/retention) governs
 *    its submissions. purgeFormSubmissions deletes submissions created before
 *    a cut-off together with the files only they hold (rows and stored
 *    objects), and records the purge in the audit log; the retention job
 *    (lib/jobs/retention) decides the cut-off.
 *  - Deletion: purgeFormForDeletion removes what a deleted form leaves
 *    behind — its grants (object_permissions has no foreign key) and its
 *    submissions' files — before lib/services/forms deletes the row (form
 *    versions and submissions cascade).
 *  - Reads for the form's Details panel and Settings → Governance.
 *
 * Every query is pinned to the tenant; writes use the service-role client
 * (forms, form_submissions and form_files have no client write grants).
 */

import { deleteFormFileRows } from './form-files'
import { getDb, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped tables */

export const LEGAL_HOLD_REASON_MAX = 500
/** Submissions deleted per round trip (ids go into `in.(…)` filters). */
const BATCH = 100

const RETENTION_POLICY_EMBED = 'retention_policy:retention_policies(id, name, description, policy_mode, duration_value, duration_unit, exact_date, applies_to)'
const GOVERNANCE_COLUMNS = `id, name, created_at, retention_policy_id, retention_applied_at, legal_hold, legal_hold_reason, legal_hold_at, legal_hold_by, submission_retention_days, ${RETENTION_POLICY_EMBED}`

export interface FormGovernance {
  id: string
  name: string
  created_at: string
  retention_policy_id: string | null
  retention_applied_at: string | null
  retention_policy: Record<string, any> | null
  legal_hold: boolean
  legal_hold_reason: string | null
  legal_hold_at: string | null
  legal_hold_by: string | null
  submission_retention_days: number | null
  submission_count: number
}

async function loadGovernance(db: AnySupabaseClient, tenantId: string, formId: string) {
  const { data, error } = await (db as any).from('forms').select(GOVERNANCE_COLUMNS).eq('tenant_id', tenantId).eq('id', formId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Form not found')
  return data as Omit<FormGovernance, 'submission_count'>
}

async function submissionCount(db: AnySupabaseClient, tenantId: string, formId: string): Promise<number> {
  const { count } = await (db as any).from('form_submissions').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('form_id', formId)
  return count ?? 0
}

/** A form's retention policy, legal hold and submission count (Details → Retention). */
export async function getFormGovernance(ctx: ServiceContext, formId: string): Promise<FormGovernance> {
  requirePerm(ctx, 'forms.view')
  const db = getDb(ctx)
  const form = await loadGovernance(db, ctx.tenantId, formId)
  // Members only read their own submissions (RLS): count with the service role.
  const count = await submissionCount(await serviceRoleClient(ctx), ctx.tenantId, formId)
  return { ...form, submission_count: count }
}

/** Every form with its retention policy and legal hold (Settings → Governance → Retention). */
export async function listFormGovernance(ctx: ServiceContext): Promise<Array<Omit<FormGovernance, 'submission_count'>>> {
  requirePerm(ctx, 'team.change_roles')
  const { data, error } = await (getDb(ctx) as any).from('forms').select(GOVERNANCE_COLUMNS).eq('tenant_id', ctx.tenantId).order('name').limit(1000)
  if (error) throw dbError(error)
  return (data ?? []) as Array<Omit<FormGovernance, 'submission_count'>>
}

/** Place or release a legal hold on a form. */
export async function setFormLegalHold(ctx: ServiceContext, formId: string, input: { hold: boolean; reason?: string | null }) {
  requirePerm(ctx, 'team.change_roles')
  if (typeof input?.hold !== 'boolean') throw ServiceError.validation('hold must be true or false')
  const reason = String(input.reason ?? '').trim()
  if (reason.length > LEGAL_HOLD_REASON_MAX) throw ServiceError.validation(`reason is at most ${LEGAL_HOLD_REASON_MAX} characters`)
  const db = await serviceRoleClient(ctx) as any
  const existing = await loadGovernance(db, ctx.tenantId, formId)
  const update = input.hold
    ? { legal_hold: true, legal_hold_reason: reason || null, legal_hold_at: new Date().toISOString(), legal_hold_by: ctx.actorId }
    : { legal_hold: false, legal_hold_reason: null, legal_hold_at: null, legal_hold_by: null }
  const { data, error } = await db.from('forms').update(update).eq('tenant_id', ctx.tenantId).eq('id', formId)
    .select('id, name, legal_hold, legal_hold_reason, legal_hold_at, legal_hold_by').maybeSingle()
  if (error) throw dbError(error, 'Failed to update the legal hold')
  if (!data) throw ServiceError.notFound('Form not found')
  if (existing.legal_hold !== input.hold || (input.hold && (existing.legal_hold_reason ?? '') !== reason)) {
    await audit(ctx, {
      objectType: 'form', objectId: formId, action: input.hold ? 'legal_hold' : 'legal_hold_release',
      summary: input.hold ? `Placed form "${existing.name}" on legal hold${reason ? `: ${reason}` : ''}` : `Released the legal hold on form "${existing.name}"`,
      metadata: { reason: reason || null },
    })
  }
  return data as { id: string; name: string; legal_hold: boolean; legal_hold_reason: string | null; legal_hold_at: string | null; legal_hold_by: string | null }
}

/** Files that only these submissions hold (not a task's values or a run's start form). */
async function submissionOnlyFiles(db: any, tenantId: string, submissionIds: string[]) {
  if (!submissionIds.length) return []
  const { data, error } = await db.from('form_files').select('id, storage_key')
    .eq('tenant_id', tenantId).in('submission_id', submissionIds).is('task_id', null).is('run_id', null)
  if (error) throw dbError(error)
  return (data ?? []) as Array<{ id: string; storage_key: string }>
}

export interface SubmissionPurgeResult {
  /** The form is on legal hold: nothing was deleted. */
  held: boolean
  submissions: number
  files: number
}

/**
 * Delete a form's submissions created before `before` (ISO; omit for all),
 * with the stored files only they hold, unless the form is on legal hold.
 * Files a task or run also uses stay (their submission reference is cleared
 * by the foreign key). Writes one audit row on the form when anything was
 * deleted; submission values never go into the audit log.
 */
export async function purgeFormSubmissions(db: AnySupabaseClient, input: {
  tenantId: string
  formId: string
  before?: string | null
  actorId?: string | null
  /** Audit wording: why the submissions went. */
  reason?: string
  metadata?: Record<string, unknown>
  /** At most this many submissions per call (the next run continues). */
  limit?: number
}): Promise<SubmissionPurgeResult> {
  const sb = db as any
  const { data: form, error } = await sb.from('forms').select('id, name, legal_hold').eq('tenant_id', input.tenantId).eq('id', input.formId).maybeSingle()
  if (error) throw dbError(error)
  if (!form) return { held: false, submissions: 0, files: 0 }
  if (form.legal_hold) return { held: true, submissions: 0, files: 0 }

  const limit = Math.max(1, input.limit ?? 10_000)
  const totals = { submissions: 0, files: 0 }
  while (totals.submissions < limit) {
    let query = sb.from('form_submissions').select('id').eq('tenant_id', input.tenantId).eq('form_id', input.formId)
    if (input.before) query = query.lt('created_at', input.before)
    const { data: rows, error: listError } = await query.order('created_at', { ascending: true }).limit(Math.min(BATCH, limit - totals.submissions))
    if (listError) throw dbError(listError)
    const ids = ((rows ?? []) as Array<{ id: string }>).map((r) => r.id)
    if (!ids.length) break
    totals.files += await deleteFormFileRows(db, await submissionOnlyFiles(sb, input.tenantId, ids))
    const { error: deleteError } = await sb.from('form_submissions').delete().eq('tenant_id', input.tenantId).in('id', ids)
    if (deleteError) throw dbError(deleteError)
    totals.submissions += ids.length
    if (ids.length < BATCH) break
  }

  if (totals.submissions > 0) {
    const { writeAudit } = await import('@/lib/audit-log')
    await writeAudit({
      supabase: db as any, tenantId: input.tenantId, actorId: input.actorId ?? null,
      objectType: 'form', objectId: input.formId, action: 'purge',
      summary: `${input.reason ?? 'Purged'} ${totals.submissions} submission${totals.submissions === 1 ? '' : 's'} of form "${form.name}"${totals.files ? ` and ${totals.files} file${totals.files === 1 ? '' : 's'}` : ''}`,
      metadata: { submissions: totals.submissions, files: totals.files, before: input.before ?? null, ...input.metadata },
    })
  }
  return { held: false, ...totals }
}

/**
 * What a deleted form leaves behind: its grants (no foreign key) and the
 * stored files of its submissions and of uploads made on its page that were
 * never submitted. Call it after the delete checks (usages, legal hold) and
 * right before deleting the form row. Returns counts for the audit row.
 */
export async function purgeFormForDeletion(db: AnySupabaseClient, tenantId: string, formId: string): Promise<{ grants: number; files: number; submissions: number }> {
  const sb = db as any
  const { count: grants, error: grantError } = await sb.from('object_permissions').delete({ count: 'exact' })
    .eq('tenant_id', tenantId).eq('object_type', 'form').eq('object_id', formId)
  if (grantError) throw dbError(grantError)
  const submissions = await submissionCount(db, tenantId, formId)
  // The submission rows go with the form (ON DELETE CASCADE); their files first.
  let files = 0
  let after: string | null = null
  for (;;) {
    let query = sb.from('form_submissions').select('id').eq('tenant_id', tenantId).eq('form_id', formId)
    if (after) query = query.gt('id', after)
    const { data: rows, error } = await query.order('id', { ascending: true }).limit(BATCH)
    if (error) throw dbError(error)
    const ids = ((rows ?? []) as Array<{ id: string }>).map((r) => r.id)
    if (!ids.length) break
    files += await deleteFormFileRows(db, await submissionOnlyFiles(sb, tenantId, ids))
    after = ids[ids.length - 1]
    if (ids.length < BATCH) break
  }
  // Uploads on the form's page that were never part of a submission.
  const { data: loose, error: looseError } = await sb.from('form_files').select('id, storage_key')
    .eq('tenant_id', tenantId).eq('form_id', formId).eq('context_kind', 'form').is('submission_id', null).is('task_id', null).is('run_id', null)
  if (looseError) throw dbError(looseError)
  files += await deleteFormFileRows(db, (loose ?? []) as Array<{ id: string; storage_key: string }>)
  return { grants: grants ?? 0, files, submissions }
}
