'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import type { FormSignInSettings } from '@/lib/forms/sign-in-page'

/** Settings → Forms → Form sign-in page: save (settings.edit; audited in lib/services/form-sign-in-page). */
export async function setFormSignInSettingsAction(input: Partial<Record<keyof FormSignInSettings, unknown>>): Promise<ActionResult<FormSignInSettings>> {
  return runAction('setFormSignInSettings', 'Could not save the sign-in page.', async () =>
    (await import('@/lib/services/form-sign-in-page')).setFormSignInSettings(await fromSession(), input))
}
