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
  if (!policy.multiple_responses && facts.signedIn && facts.alreadyResponded) return 'You have already responded to this form (one response per person).'
  return null
}

/**
 * Refuse a submission the form's wizard policy does not allow (403 with a
 * plain message). No project, or the table not there yet (migration
 * 20261229000000 not applied) → allowed.
 */
export async function assertWizardResponsePolicy(db: AnySupabaseClient, tenantId: string, formId: string, actorId: string | null, now = Date.now()): Promise<void> {
  const { data, error } = await (db as any).from('form_wizard_projects').select('spec, status').eq('tenant_id', tenantId).eq('form_id', formId).maybeSingle()
  if (error || !data || data.status !== 'created') return
  const policy = responsePolicyOf(data.spec)
  let alreadyResponded = false
  if (!policy.multiple_responses && actorId) {
    const { data: earlier } = await (db as any).from('form_submissions').select('id').eq('tenant_id', tenantId).eq('form_id', formId).eq('submitted_by', actorId).limit(1)
    alreadyResponded = Boolean(earlier?.length)
  }
  const problem = responsePolicyProblem(policy, { now, signedIn: Boolean(actorId), alreadyResponded })
  if (problem) throw ServiceError.forbidden(problem)
}

/** The submitter's manager in the workspace (reporting lines), for "The person's manager approves". */
export async function managerOf(db: AnySupabaseClient, tenantId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null
  const { data } = await (db as any).from('user_memberships').select('manager_user_id').eq('tenant_id', tenantId).eq('user_id', userId).eq('is_active', true).maybeSingle()
  return data?.manager_user_id ? String(data.manager_user_id) : null
}
