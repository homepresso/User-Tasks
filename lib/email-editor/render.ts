/**
 * Rendering an email template at send time (the Send Email step, User Task
 * notifications) and in previews.
 *
 * Values come from the run as before; on top of them:
 *   - link helpers the engine fills automatically (`task_url`,
 *     `current_year`) when the run has no variable of that name;
 *   - the step's variable mappings (`template_variables`: variable name →
 *     expression), each resolved against the run. An empty mapping keeps the
 *     old behaviour (the template reads a same-named run variable).
 * The run's variables are never modified.
 */

import { resolveExpression, type ExpressionContext } from '@/lib/expression-resolver'
import { mappingFilled } from './variables'

export type TemplateVariableMappings = Record<string, unknown>

export interface RenderableTemplate {
  subject: string
  html_body: string
  text_body?: string | null
}

/** Run variables plus link helpers plus resolved mappings (a new object). */
export function templateRenderVariables(ctx: ExpressionContext, mappings?: TemplateVariableMappings | null): Record<string, unknown> {
  const base = ctx.variables ?? {}
  const variables: Record<string, unknown> = { ...base }
  const appUrl = String(base.app_url ?? '').replace(/\/+$/, '')
  const taskId = base.user_task_id ?? base.task_id ?? ctx.task?.id
  if (variables.task_url === undefined && appUrl && taskId) variables.task_url = `${appUrl}/tasks/${taskId}`
  if (variables.current_year === undefined) variables.current_year = String(new Date().getUTCFullYear())
  if (mappings && typeof mappings === 'object') {
    for (const [name, expression] of Object.entries(mappings)) {
      if (!name || !mappingFilled(expression)) continue
      // Resolved against the run (not against other mappings).
      variables[name] = typeof expression === 'string' ? resolveExpression(expression, ctx) : expression
    }
  }
  return variables
}

/** The context templates resolve in: the run's, with the variables above. */
export function templateRenderContext(ctx: ExpressionContext, mappings?: TemplateVariableMappings | null): ExpressionContext {
  return { ...ctx, variables: templateRenderVariables(ctx, mappings) }
}

/** One template text rendered (undefined / null → ''). */
export function renderTemplateText(text: string | null | undefined, ctx: ExpressionContext): string {
  const resolved = resolveExpression(text ?? '', ctx)
  return resolved === undefined || resolved === null ? '' : String(resolved)
}

export function renderEmailTemplate(template: RenderableTemplate, ctx: ExpressionContext, mappings?: TemplateVariableMappings | null) {
  const renderCtx = templateRenderContext(ctx, mappings)
  return {
    subject: renderTemplateText(template.subject, renderCtx),
    html: renderTemplateText(template.html_body, renderCtx),
    text: renderTemplateText(template.text_body ?? '', renderCtx),
  }
}
