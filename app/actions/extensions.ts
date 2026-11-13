'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession, ServiceError } from '@/lib/services/context'
import * as extensions from '@/lib/services/extensions'
import { createExtensionContext } from '@/lib/extensions/host'
import { getServerExtension } from '@/lib/extensions/server-registry'
import { assertUiReference, isInstanceAdminSession, loadExtensionUiState } from '@/lib/extensions/ui-server'
import type { ExtensionUiState } from '@/lib/extensions/ui'
import type { UiActionResult } from '@/lib/extensions/sdk'

/*
 * Extension UI from the browser: contributed actions and data sources, the
 * shell's extension state, and Settings → Extensions. Server actions are
 * POST-only and same-origin (Next.js checks Origin), so contributed actions
 * cannot be triggered from another site. Every call re-checks that the
 * extension is usable in the workspace and that an entry naming the action /
 * source is visible to the caller (lib/extensions/ui-server).
 */

const MAX_ITEMS = 200

function plain(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? JSON.parse(JSON.stringify(value)) as Record<string, unknown> : {}
}

export async function runExtensionUiAction(input: {
  extensionId: string
  action: string
  objectType?: string | null
  items?: Array<Record<string, unknown>>
  values?: Record<string, unknown>
  settings?: { page: string; values: Record<string, unknown> }
}): Promise<ActionResult<UiActionResult>> {
  return runAction('runExtensionUiAction', 'The action failed.', async () => {
    const ctx = await fromSession()
    await assertUiReference(ctx, input.extensionId, { kind: 'action', name: input.action })
    const handler = getServerExtension(input.extensionId)?.ui?.actions?.[input.action]
    if (!handler) throw ServiceError.notFound(`Action "${input.action}" is not implemented`)
    const items = (input.items ?? []).slice(0, MAX_ITEMS).map(plain)
    const result = await handler({
      ctx: createExtensionContext({ extensionId: input.extensionId, tenantId: ctx.tenantId, actorId: ctx.actorId, db: ctx.supabase }),
      objectType: input.objectType ?? null,
      items,
      values: input.values ? plain(input.values) : undefined,
      settings: input.settings ? { page: String(input.settings.page), values: plain(input.settings.values) } : undefined,
    })
    const out = (result ?? {}) as UiActionResult
    if (out.redirect && !/^\/(?!\/)/.test(out.redirect)) delete out.redirect
    return out
  })
}

export async function loadExtensionUiData(input: {
  extensionId: string
  source: string
  objectType?: string | null
  item?: Record<string, unknown> | null
}): Promise<ActionResult<unknown>> {
  return runAction('loadExtensionUiData', 'Could not load the extension data.', async () => {
    const ctx = await fromSession()
    await assertUiReference(ctx, input.extensionId, { kind: 'data', name: input.source })
    const handler = getServerExtension(input.extensionId)?.ui?.data?.[input.source]
    if (!handler) throw ServiceError.notFound(`Data source "${input.source}" is not implemented`)
    const data = await handler({
      ctx: createExtensionContext({ extensionId: input.extensionId, tenantId: ctx.tenantId, actorId: ctx.actorId, db: ctx.supabase }),
      objectType: input.objectType ?? null,
      item: input.item ? plain(input.item) : null,
    })
    return JSON.parse(JSON.stringify(data ?? null)) as unknown
  })
}

/** The shell's extension state (refreshed after enable / disable / settings changes). */
export async function getExtensionUiStateAction(): Promise<ActionResult<ExtensionUiState>> {
  return runAction('getExtensionUiStateAction', 'Could not load extensions.', async () => loadExtensionUiState(await fromSession()))
}

export async function listExtensionsAction(): Promise<ActionResult<Awaited<ReturnType<typeof extensions.listExtensions>>>> {
  return runAction('listExtensionsAction', 'Could not load extensions.', async () => extensions.listExtensions(await fromSession()))
}

export async function setExtensionEnabledAction(extensionId: string, enabled: boolean): Promise<ActionResult<Awaited<ReturnType<typeof extensions.getExtension>>>> {
  return runAction('setExtensionEnabledAction', 'Could not change the extension.', async () => {
    const ctx = await fromSession()
    return enabled ? extensions.enableExtension(ctx, extensionId) : extensions.disableExtension(ctx, extensionId)
  })
}

export async function getExtensionSettingsAction(extensionId: string, pageId: string): Promise<ActionResult<Awaited<ReturnType<typeof extensions.getExtensionSettings>>>> {
  return runAction('getExtensionSettingsAction', 'Could not load the settings.', async () => {
    const ctx = await fromSession()
    return extensions.getExtensionSettings(ctx, extensionId, pageId, { instanceAdmin: await isInstanceAdminSession() })
  })
}

export async function saveExtensionSettingsAction(extensionId: string, pageId: string, values: Record<string, unknown>): Promise<ActionResult<Awaited<ReturnType<typeof extensions.getExtensionSettings>>>> {
  return runAction('saveExtensionSettingsAction', 'Could not save the settings.', async () => {
    const ctx = await fromSession()
    return extensions.updateExtensionSettings(ctx, extensionId, pageId, plain(values), { instanceAdmin: await isInstanceAdminSession() })
  })
}
