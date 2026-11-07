'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import { setFormLegalHold as setHold } from '@/lib/services/form-governance'

/*
 * Forms in governance (form Details → Retention, Settings → Governance):
 * thin wrappers over lib/services/form-governance — permission
 * (team.change_roles), validation and audit live there. The retention policy
 * itself is assigned with assignRetentionPolicy (app/actions/retention-policies).
 */

export async function setFormLegalHold(formId: string, input: { hold: boolean; reason?: string | null }): Promise<ActionResult<Awaited<ReturnType<typeof setHold>>>> {
  return runAction('setFormLegalHold', 'Could not update the legal hold.', async () => {
    const result = await setHold(await fromSession(), formId, input)
    revalidatePath('/settings/governance')
    return result
  })
}
