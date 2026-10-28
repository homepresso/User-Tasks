/**
 * Task descriptions in API / MCP responses.
 *
 * `description` is returned as stored (sanitised HTML or plain text) and
 * `description_text` carries the plain-text rendering. With `strip_html=true`
 * (REST query option, MCP `strip_html` argument) `description` itself is
 * replaced by the plain text, for clients that cannot render HTML.
 */

import { htmlToPlainText } from './html-sanitize'

type TaskRow = Record<string, unknown>

/** `?strip_html=true` (also 1/yes). */
export function wantsStrippedHtml(value: string | boolean | null | undefined): boolean {
  if (typeof value === 'boolean') return value
  return ['true', '1', 'yes'].includes(String(value ?? '').toLowerCase())
}

export function withDescriptionText<T extends TaskRow>(task: T, stripHtml = false): T & { description_text?: string | null } {
  if (!task || typeof task !== 'object' || !('description' in task)) return task
  const description = task.description
  const text = typeof description === 'string' ? htmlToPlainText(description) : null
  return { ...task, ...(stripHtml ? { description: text } : {}), description_text: text }
}

export function withDescriptionTexts<T extends TaskRow>(tasks: T[] | null | undefined, stripHtml = false) {
  return (tasks ?? []).map((task) => withDescriptionText(task, stripHtml))
}
