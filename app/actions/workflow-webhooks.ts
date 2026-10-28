'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import { updateWebhook } from '@/lib/services/webhooks'

/** Save a workflow webhook's payload mapping (workflow designer trigger panel). */
export async function saveWebhookPayloadMapping(webhookId: string, mapping: unknown[]): Promise<ActionResult<{ changed: boolean }>> {
  return runAction('saveWebhookPayloadMapping', 'Could not save the mapping.', async () => {
    const { changed } = await updateWebhook(await fromSession(), webhookId, { payload_mapping: mapping })
    return { changed }
  })
}
