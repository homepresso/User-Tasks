/**
 * What trusted-embedding pages (/embed/…) tell the page that frames them.
 * Host-agnostic: any host (an intranet page, a SharePoint add-in part, a
 * future SPFx web part) frames the URL and listens; nothing here carries
 * values, record data or identity, so it goes to any parent and the host
 * checks the origin.
 *
 *  - `{ type: 'usertasks:resize', height, path }` on every height change
 *    (lib/forms/embed.ts resizeMessage) — unless the URL says `resize=0`
 *    (the host gives the frame a fixed height).
 *  - The classic add-in part resize message, when the URL carries a
 *    `SenderId` (add-in part hosts put it in the frame URL):
 *    `<message senderId=…>resize(width,height)</message>` as a string. The
 *    host page (SharePoint's classic web part page) sizes the part's frame.
 *  - `{ type: 'usertasks:form', event: 'submitted' | 'cancelled' }` (forms).
 *  - `{ type: 'usertasks:task', event: 'completed' | 'changed' | 'close', task_id }`
 *    from the embedded task page (/embed/task/<id>) and the task list.
 *
 * Pure and client-safe.
 */

import { resizeMessage } from '@/lib/forms/embed'

export const TASK_EVENT_MESSAGE_TYPE = 'usertasks:task'

export interface TaskEventMessage {
  type: typeof TASK_EVENT_MESSAGE_TYPE
  event: 'completed' | 'changed' | 'close'
  task_id: string
}

export function taskEventMessage(event: TaskEventMessage['event'], taskId: string): TaskEventMessage {
  return { type: TASK_EVENT_MESSAGE_TYPE, event, task_id: taskId }
}

export function isTaskEventMessage(data: unknown): data is TaskEventMessage {
  return Boolean(data) && typeof data === 'object' && (data as TaskEventMessage).type === TASK_EVENT_MESSAGE_TYPE
    && ['completed', 'changed', 'close'].includes(String((data as TaskEventMessage).event))
}

/** The add-in part sender id from a frame URL's query (`SenderId`), or null. Only [A-Za-z0-9_-], at most 64. */
export function senderIdFrom(search: string | URLSearchParams | null | undefined): string | null {
  const params = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search
  const raw = params?.get('SenderId') ?? params?.get('senderId') ?? params?.get('senderid') ?? ''
  return /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null
}

/** Does the URL turn the resize messages off (`resize=0`: fixed height)? */
export function resizeDisabled(search: string | URLSearchParams | null | undefined): boolean {
  const params = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search
  return /^(0|false|no|off|fixed)$/i.test(params?.get('resize') ?? '')
}

/** `<message senderId=…>resize(width,height)</message>` — the classic add-in part protocol. */
export function appPartResizeMessage(senderId: string, height: number, width: string | number = '100%'): string {
  const h = Math.max(0, Math.ceil(Number.isFinite(height) ? height : 0))
  const w = typeof width === 'number' ? `${Math.max(0, Math.ceil(width))}px` : /^\d{1,5}(px|%)$/.test(width) ? width : '100%'
  return `<message senderId=${senderId}>resize(${w},${h}px)</message>`
}

/** Every message a height change sends, for this frame URL (empty when resizing is off). */
export function hostResizeMessages(height: number, location: { pathname: string; search: string }): Array<ReturnType<typeof resizeMessage> | string> {
  if (resizeDisabled(location.search)) return []
  const out: Array<ReturnType<typeof resizeMessage> | string> = [resizeMessage(height, location.pathname)]
  const sender = senderIdFrom(location.search)
  if (sender) out.push(appPartResizeMessage(sender, height))
  return out
}

/** Post to the parent window (no-op at the top level). */
export function postToHost(message: unknown): void {
  if (typeof window === 'undefined' || window.parent === window) return
  try { window.parent.postMessage(message, '*') } catch { /* parent gone */ }
}
