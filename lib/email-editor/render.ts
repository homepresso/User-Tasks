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
 *
 * HTML bodies escape every interpolated value (`{{var}}`, `{{=FN()}}`): run
 * variables can hold text from anonymous public forms, which must not become
 * live links or markup in mail sent from the workspace's address. Variables
 * that legitimately hold HTML (rich-text fields, HTML built by the workflow)
 * use the raw form `{{{var}}}`, sanitised with sanitizeEmailHtml. Subjects
 * lose CR / LF (header injection); plain-text bodies are not escaped.
 */

import { resolveExpression, type ExpressionContext } from '@/lib/expression-resolver'
import { mappingFilled, normalizeVariableDeclarations } from './variables'
import { escapeHtml } from '@/lib/html-sanitize'
import { sanitizeEmailHtml } from '@/lib/email-templates'

export type TemplateVariableMappings = Record<string, unknown>

export interface RenderableTemplate {
  subject: string
  html_body: string
  text_body?: string | null
  /** Variable declarations (email_templates.variables): type 'html' renders raw (sanitised). */
  variables?: unknown
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

/**
 * Variables that hold HTML by contract and stay raw (sanitised) in HTML
 * bodies: declared type 'html', or named *_html (user_task_description_html,
 * the starters' items_html — the editor types those 'html' too).
 */
export function htmlVariablePredicate(declarations?: unknown): (path: string) => boolean {
  const declared = new Set(normalizeVariableDeclarations(declarations).filter((d) => d.type === 'html').map((d) => d.name.toLowerCase()))
  return (path: string) => {
    const p = path.toLowerCase()
    const last = p.split('.').pop() ?? p
    return declared.has(p) || /(^|_)html$/.test(last)
  }
}

/**
 * Escape a run value for an HTML body. Line breaks survive: `<br>` tags (lists
 * built with JOIN("<br>", …), as gallery packages and many templates do) stay
 * line breaks — markup that can't carry a link or a script.
 */
export function escapeEmailValue(value: string): string {
  return escapeHtml(value).replace(/&lt;br\s*\/?&gt;/gi, '<br>')
}

/** One HTML template text rendered: values escaped; `{{{var}}}` and HTML-typed variables sanitised raw HTML. */
export function renderTemplateHtml(text: string | null | undefined, ctx: ExpressionContext, declarations?: unknown): string {
  return renderTemplateText(text, { ...ctx, escape: escapeEmailValue, raw: sanitizeEmailHtml, rawVariable: htmlVariablePredicate(declarations) })
}

/** An email subject: one header line (CR / LF / other line breaks become spaces). */
export function emailSubjectLine(value: unknown): string {
  return String(value ?? '').replace(/[\r\n\u0085\u2028\u2029]+/g, ' ').trim()
}

export function renderEmailTemplate(template: RenderableTemplate, ctx: ExpressionContext, mappings?: TemplateVariableMappings | null) {
  const renderCtx = templateRenderContext(ctx, mappings)
  return {
    subject: emailSubjectLine(renderTemplateText(template.subject, renderCtx)),
    html: renderTemplateHtml(template.html_body, renderCtx, template.variables),
    text: renderTemplateText(template.text_body ?? '', renderCtx),
  }
}
