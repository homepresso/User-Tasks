'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import * as dataEvent from '@/lib/services/form-data-event'

/*
 * The form designer's "Map to data event" wizard: thin wrappers over
 * lib/services/form-data-event — permissions, validation and rollback live
 * there.
 */

function run<T>(label: string, fallback: string, fn: (ctx: Awaited<ReturnType<typeof fromSession>>) => Promise<T>): Promise<ActionResult<T>> {
  return runAction(label, fallback, async () => fn(await fromSession()))
}

export async function getDataEventOptions(formId?: string | null) {
  return run('getDataEventOptions', 'Could not load the data event options.', (ctx) => dataEvent.getDataEventOptions(ctx, { form_id: formId ?? null }))
}

export async function planDataEventWorkflow(input: dataEvent.DataEventWorkflowInput) {
  return run('planDataEventWorkflow', 'Could not plan the workflow.', (ctx) => dataEvent.planDataEventWorkflow(ctx, input))
}

export async function createDataEventWorkflow(input: dataEvent.DataEventWorkflowInput) {
  return run('createDataEventWorkflow', 'Could not create the workflow.', (ctx) => dataEvent.createDataEventWorkflow(ctx, input))
}
