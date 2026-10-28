'use server'

import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import * as pages from '@/lib/services/form-pages'

/*
 * "Publish as form page" (workflow page Form link panel, the designer's
 * start form settings): thin wrappers over lib/services/form-pages —
 * permissions (forms.edit + workflows.activate; forms.delete to
 * unpublish), the divergence check and audit live there.
 */

export async function publishStartFormPage(workflowId: string) {
  return runAction('publishStartFormPage', 'Could not publish the form page.', async () => pages.publishStartFormPage(await fromSession(), workflowId))
}

/** Copy the start form to the page again; `overwrite` replaces edits made on the form. */
export async function syncStartFormPage(workflowId: string, overwrite = false) {
  return runAction('syncStartFormPage', 'Could not update the form page.', async () => pages.syncStartFormPage(await fromSession(), workflowId, { overwrite }))
}

export async function unpublishStartFormPage(workflowId: string) {
  return runAction('unpublishStartFormPage', 'Could not unpublish the form page.', async () => pages.unpublishStartFormPage(await fromSession(), workflowId))
}
