'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import type { WorkspaceSsoView } from '@/lib/services/workspace-sso'

/** Settings → SSO & Directory → Single sign-on (any member reads; lib/services/workspace-sso). */
export async function getWorkspaceSsoAction(): Promise<ActionResult<WorkspaceSsoView>> {
  return runAction('getWorkspaceSso', 'Could not load the single sign-on settings.', async () =>
    (await import('@/lib/services/workspace-sso')).getWorkspaceSso(await fromSession()))
}

/** Save (settings.edit; audited in the service). */
export async function setWorkspaceSsoAction(input: { auto_sign_in?: boolean; sso_only?: boolean; idp?: string | null }): Promise<ActionResult<WorkspaceSsoView>> {
  return runAction('setWorkspaceSso', 'Could not save the single sign-on settings.', async () =>
    (await import('@/lib/services/workspace-sso')).setWorkspaceSso(await fromSession(), input))
}
