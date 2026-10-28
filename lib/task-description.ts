/**
 * Workflow `user_task` description templates → stored task description.
 *
 * Descriptions may be HTML, so values interpolated into them must not be able
 * to inject markup: in an HTML template ({{var}} inside tags) every
 * interpolated value is HTML-escaped; in a plain-text template values are
 * inserted as is unless they contain `<`, in which case they are escaped too
 * (so existing plain-text descriptions resolve byte-for-byte as before).
 * The result is then sanitised like every other description write.
 */

import { resolveExpression, type ExpressionContext } from './expression-resolver'
import { escapeHtml, looksLikeHtml, sanitizeTaskDescription } from './html-sanitize'

const escapeMarkup = (value: string) => (value.includes('<') ? escapeHtml(value) : value)

export function resolveTaskDescriptionTemplate(template: unknown, ctx: ExpressionContext): string {
  if (template === undefined || template === null) return ''
  if (typeof template !== 'string') return sanitizeTaskDescription(String(template))
  const escape = looksLikeHtml(template) ? escapeHtml : escapeMarkup
  const resolved = resolveExpression(template, { ...ctx, escape })
  return sanitizeTaskDescription(String(resolved ?? ''))
}
