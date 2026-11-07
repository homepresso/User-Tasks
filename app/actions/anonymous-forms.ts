'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import type { AnonymousWorkspaceInput, FormAnonymousInput } from '@/lib/services/anonymous-forms'

/*
 * Anonymous forms (public form links): thin wrappers over
 * lib/services/anonymous-forms — forms.edit for a form's link, settings.edit
 * for the workspace switch and bot protection; both audited there.
 */

export async function setFormAnonymousAccess(formId: string, input: FormAnonymousInput) {
  return runAction('setFormAnonymousAccess', 'Could not save the anonymous settings.', async () =>
    (await import('@/lib/services/anonymous-forms')).setFormAnonymousAccess(await fromSession(), formId, input))
}

export async function regenerateFormAnonymousToken(formId: string) {
  return runAction('regenerateFormAnonymousToken', 'Could not regenerate the link.', async () =>
    (await import('@/lib/services/anonymous-forms')).regenerateFormAnonymousToken(await fromSession(), formId))
}

export async function setAnonymousWorkspaceSettings(input: AnonymousWorkspaceInput): Promise<ActionResult<import('@/lib/forms/anonymous').AnonymousWorkspaceView>> {
  return runAction('setAnonymousWorkspaceSettings', 'Could not save the setting.', async () =>
    (await import('@/lib/services/anonymous-forms')).setAnonymousWorkspaceSettings(await fromSession(), input))
}
