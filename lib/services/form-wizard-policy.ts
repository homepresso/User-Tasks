/**
 * What a wizard form decides at submit time (lib/services/form-submissions
 * submitForm calls it): the response window (opens / closes) and "one
 * response per person". Read from the form's wizard project
 * (form_wizard_projects, one per form); forms not made by the wizard have no
 * project and nothing changes for them. Kept small and separate from the
 * wizard service so the submit path loads nothing else.
 */

import { isPlainObject } from '@/lib/utils/guards'
import type { AnySupabaseClient } from './context'
import { ServiceError } from './context'

/* eslint-disable @typescript-eslint/no-explicit-any -- form_wizard_projects is not in the generated types */

export const ONE_RESPONSE_MESSAGE = 'You have already responded to this form (one response per person).'
/** The partial unique index on (tenant_id, form_id, submitted_by) WHERE single_response (migration 20270126140000). */
export const SINGLE_RESPONSE_INDEX = 'uq_form_submissions_single_response'

export interface WizardResponsePolicy {
  opens_at: string | null
  closes_at: string | null
  multiple_responses: boolean
}

/** The policy stored on a project's spec (audience), defaults = always open, many responses. */
export function responsePolicyOf(spec: unknown): WizardResponsePolicy {
  const audience = isPlainObject(spec) && isPlainObject(spec.audience) ? spec.audience : {}
  return {
    opens_at: typeof audience.opens_at === 'string' && audience.opens_at ? audience.opens_at : null,
    closes_at: typeof audience.closes_at === 'string' && audience.closes_at ? audience.closes_at : null,
    multiple_responses: audience.multiple_responses !== false,
  }
}

/** Why a submission is refused now (null = accepted). Pure: the clock and the earlier-response check are inputs. */
export function responsePolicyProblem(policy: WizardResponsePolicy, facts: { now: number; signedIn: boolean; alreadyResponded: boolean }): string | null {
  if (policy.opens_at && facts.now < Date.parse(policy.opens_at)) {
    return `This form opens on ${new Date(policy.opens_at).toUTCString().replace(/:\d\d GMT$/, ' UTC')}.`
  }
  if (policy.closes_at && facts.now >= Date.parse(policy.closes_at)) return 'This form is closed: it no longer accepts responses.'
  if (!policy.multiple_responses && facts.signedIn && facts.alreadyResponded) return ONE_RESPONSE_MESSAGE
  return null
}

/**
 * Refuse a submission the form's wizard policy does not allow (403 with a
 * plain message). No project, or the table not there yet (migration
 * 20261229000000 not applied) → allowed.
 */
export async function assertWizardResponsePolicy(db: AnySupabaseClient, tenantId: string, formId: string, actorId: string | null, now = Date.now()): Promise<{ singleResponse: boolean }> {
  const { data, error } = await (db as any).from('form_wizard_projects').select('spec, status').eq('tenant_id', tenantId).eq('form_id', formId).maybeSingle()
  if (error || !data || data.status !== 'created') return { singleResponse: false }
  const policy = responsePolicyOf(data.spec)
  let alreadyResponded = false
  if (!policy.multiple_responses && actorId) {
    const { data: earlier } = await (db as any).from('form_submissions').select('id').eq('tenant_id', tenantId).eq('form_id', formId).eq('submitted_by', actorId).limit(1)
    alreadyResponded = Boolean(earlier?.length)
  }
  const problem = responsePolicyProblem(policy, { now, signedIn: Boolean(actorId), alreadyResponded })
  if (problem) throw ServiceError.forbidden(problem)
  // The check above is a read: two submissions at the same moment both pass it. The row is
  // stored flagged (insertSubmissionRow) and a unique index makes the second one fail.
  return { singleResponse: !policy.multiple_responses && Boolean(actorId) }
}

/** PostgREST / Postgres: the column isn't there (the migration not applied yet). */
function missingColumn(error: { code?: string; message?: string } | null | undefined, column: string): boolean {
  if (!error) return false
  return (error.code === 'PGRST204' || error.code === '42703') && String(error.message ?? '').includes(column)
}

/**
 * Store a form_submissions row. With "one response per person" the row is flagged
 * `single_response`, so a second response by the same person — even one racing the
 * first past the read check (a double click, two tabs) — hits the unique index
 * (`duplicateResponse`: the caller refuses it with ONE_RESPONSE_MESSAGE). Before the migration is applied the flag is left
 * out (the read check alone, as before) and a warning is logged.
 */
export async function insertSubmissionRow<T = Record<string, any>>(db: AnySupabaseClient, row: Record<string, unknown>, columns: string, options: { singleResponse: boolean }): Promise<{ data: T | null; error: { code?: string; message?: string } | null; duplicateResponse: boolean }> {
  const insert = (r: Record<string, unknown>) => (db as any).from('form_submissions').insert(r).select(columns).single()
  let result = await insert(options.singleResponse ? { ...row, single_response: true } : row)
  if (options.singleResponse && missingColumn(result.error, 'single_response')) {
    console.warn('[forms] form_submissions.single_response is missing (apply migration 20270126140000): one response per person is checked but not enforced atomically')
    result = await insert(row)
  }
  const duplicateResponse = Boolean(options.singleResponse && result.error?.code === '23505' && String(`${result.error.message ?? ''} ${(result.error as any).details ?? ''}`).includes(SINGLE_RESPONSE_INDEX))
  return { data: result.data ?? null, error: result.error ?? null, duplicateResponse }
}

/** The submitter's manager in the workspace (reporting lines), for "The person's manager approves". */
export async function managerOf(db: AnySupabaseClient, tenantId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null
  const { data } = await (db as any).from('user_memberships').select('manager_user_id').eq('tenant_id', tenantId).eq('user_id', userId).eq('is_active', true).maybeSingle()
  return data?.manager_user_id ? String(data.manager_user_id) : null
}
