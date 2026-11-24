'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import * as apps from '@/lib/services/apps'
import * as widgetActions from '@/lib/services/app-widget-actions'
import type { AppCreateInput, AppUpdateInput, PageCreateInput, PageUpdateInput } from '@/lib/apps/schema'

/*
 * App builder writes from the dashboard: thin wrappers over
 * lib/services/apps (every access check lives there).
 */

function run<T>(label: string, fallback: string, fn: (ctx: Awaited<ReturnType<typeof fromSession>>) => Promise<T>): Promise<ActionResult<T>> {
  return runAction(label, fallback, async () => fn(await fromSession()))
}

export async function createApp(input: AppCreateInput) {
  return run('createApp', 'Could not create the app.', (ctx) => apps.createApp(ctx, input))
}

export async function updateApp(app: string, input: AppUpdateInput) {
  return run('updateApp', 'Could not save the app.', (ctx) => apps.updateApp(ctx, app, input))
}

export async function deleteApp(app: string) {
  return run('deleteApp', 'Could not delete the app.', (ctx) => apps.deleteApp(ctx, app))
}

export async function createAppPage(app: string, input: PageCreateInput) {
  return run('createAppPage', 'Could not add the page.', (ctx) => apps.createPage(ctx, app, input))
}

export async function updateAppPage(app: string, page: string, input: PageUpdateInput) {
  return run('updateAppPage', 'Could not save the page.', (ctx) => apps.updatePage(ctx, app, page, input))
}

export async function deleteAppPage(app: string, page: string) {
  return run('deleteAppPage', 'Could not delete the page.', (ctx) => apps.deletePage(ctx, app, page))
}

/** Give the form grants that fix these access issues (or all the caller can fix). */
export async function grantAppAccess(app: string, keys: string[] | 'all') {
  return run('grantAppAccess', 'Could not grant access.', (ctx) => apps.grantAppAccess(ctx, app, keys))
}

export async function reorderAppPages(app: string, order: string[]) {
  return run('reorderAppPages', 'Could not reorder the pages.', (ctx) => apps.reorderPages(ctx, app, order))
}

/* ── Drafts and publishing (lib/services/app-versions.ts) ── */

export async function publishAppAction(app: string, input: { note?: string | null } = {}) {
  return run('publishApp', 'Could not publish the app.', async (ctx) => (await import('@/lib/services/app-versions')).publishApp(ctx, app, input))
}

export async function discardAppDraftAction(app: string) {
  return run('discardAppDraft', 'Could not discard the draft.', async (ctx) => (await import('@/lib/services/app-versions')).discardAppDraft(ctx, app))
}

export async function restoreAppVersionAction(app: string, version: number) {
  return run('restoreAppVersion', 'Could not restore that version.', async (ctx) => (await import('@/lib/services/app-versions')).restoreAppVersion(ctx, app, version))
}

/* ── Widget actions (lib/services/app-widget-actions.ts: the widget must be on the page as the viewer sees it) ── */

/** Editors previewing the draft send draft / as_role: the widget is looked up on the draft page. */
type Preview = { draft?: boolean | null; as_role?: 'viewer' | 'contributor' | null }

export async function moveKanbanTask(input: { app: string; page: string; widget_id: string; task_id: string; status: string } & Preview) {
  return run('moveKanbanTask', 'Could not move the task.', (ctx) => widgetActions.moveKanbanTask(ctx, input))
}

export async function moveKanbanRow(input: { app: string; page: string; widget_id: string; row_id: string; lane: string } & Preview) {
  return run('moveKanbanRow', 'Could not move the card.', (ctx) => widgetActions.moveKanbanRow(ctx, input))
}

export async function updateGridRow(input: { app: string; page: string; widget_id: string; row_id: string; cells: Record<string, unknown> } & Preview) {
  return run('updateGridRow', 'Could not save the row.', (ctx) => widgetActions.updateGridRow(ctx, input))
}

export async function deleteGridRows(input: { app: string; page: string; widget_id: string; row_ids: string[] } & Preview) {
  return run('deleteGridRows', 'Could not delete the rows.', (ctx) => widgetActions.deleteGridRows(ctx, input))
}

export async function listGridViews(input: { app: string; page: string; widget_id: string } & Preview) {
  return run('listGridViews', 'Could not load your views.', (ctx) => widgetActions.listGridViews(ctx, input))
}

export async function saveGridView(input: { app: string; page: string; widget_id: string; view: unknown } & Preview) {
  return run('saveGridView', 'Could not save the view.', (ctx) => widgetActions.saveGridView(ctx, input))
}

export async function deleteGridView(input: { app: string; page: string; widget_id: string; id: string } & Preview) {
  return run('deleteGridView', 'Could not delete the view.', (ctx) => widgetActions.deleteGridView(ctx, input))
}

export async function askAppAgent(input: { app: string; page: string; widget_id: string; message: string; history?: Array<{ role: 'user' | 'agent'; text: string }> } & Preview) {
  return run('askAppAgent', 'Could not send the message.', (ctx) => widgetActions.askAgent(ctx, input))
}

export async function appAgentReply(input: { app: string; page: string; widget_id: string; job_id: string } & Preview) {
  return run('appAgentReply', 'Could not read the reply.', (ctx) => widgetActions.agentReply(ctx, input))
}

export async function claimNextAppTask(input: { app: string; page: string; widget_id: string; index: number } & Preview) {
  return run('claimNextAppTask', 'Could not claim a task.', (ctx) => widgetActions.claimNext(ctx, input))
}

/** Upload a custom SVG app icon (FormData: file, app, tint). */
export async function uploadAppIconAction(formData: FormData) {
  return run('uploadAppIcon', 'Could not upload the icon.', async (ctx) => {
    const file = formData.get('file')
    if (!file || typeof file === 'string') throw new Error('No file was uploaded')
    const { uploadAppIcon } = await import('@/lib/services/app-icons')
    return uploadAppIcon(ctx, { app: String(formData.get('app') ?? ''), name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()), tint: formData.get('tint') === '1' })
  })
}

/** Package / Export: what the app's package would include (the dialog's list). */
export async function previewAppPackageAction(app: string, input: { excluded?: Array<{ type: string; id: string }>; data_modes?: Record<string, 'schema' | 'rows'>; content?: 'published' | 'draft' } = {}) {
  return run('previewAppPackage', 'Could not list what the app uses.', async (ctx) => (await import('@/lib/services/app-packages')).previewAppPackage(ctx, app, input))
}

/** Package / Export: build the next version of the app's package and return the .utpkg (base64). */
export async function packageAppAction(app: string, input: { excluded?: Array<{ type: string; id: string }>; data_modes?: Record<string, 'schema' | 'rows'>; notes?: string | null; content?: 'published' | 'draft' } = {}) {
  return run('packageApp', 'Could not package the app.', async (ctx) => (await import('@/lib/services/app-packages')).packageApp(ctx, app, input))
}

/** An app rule's server action (lib/services/app-rule-actions.ts; the same service as POST /api/v1/apps/{id}/actions). */
export async function runAppRuleActionAction(app: string, input: { page?: string | null; rule_id: string; path: string; values?: Record<string, string>; idempotency_key: string; preview?: { draft?: boolean | null; as_role?: 'viewer' | 'contributor' | null } | null }) {
  return run('runAppRuleAction', 'That step could not run.', async (ctx) => (await import('@/lib/services/app-rule-actions')).runAppRuleAction(ctx, app, input))
}
