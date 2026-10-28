import type { McpToolServer } from '../server'
import type { McpContext } from '../server'
import { mcpErr, mcpOk } from '../server'
import { z } from 'zod'
import { fromMcpContext, type ServiceContext } from '@/lib/services/context'
import * as templates from '@/lib/services/email-templates'
import { messageOf } from './_util'

/*
 * Email template tools. Thin wrappers over lib/services/email-templates,
 * which owns HTML sanitisation, the single-default rule, tenant filtering
 * and audit (mutating tools are listed in AUDITED_IN_SERVICE in ../authz).
 * Reads and preview need workflows.view (READ_TOOL_PERMISSIONS in ../authz).
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

export function registerEmailTemplateTools(server: McpToolServer, ctx: McpContext) {
  const writeCtx = (): ServiceContext => fromMcpContext(ctx)
  const readCtx = (): ServiceContext => fromMcpContext(ctx) // reads are gated too (READ_TOOL_PERMISSIONS)

  server.tool('email_templates_list', 'List email templates (name, subject, default flag). Templates are used by the send_email node (email_template_id) and user_task notifications (notification_template_id).', {
    search: z.string().optional().describe('Name contains'),
    limit: z.number().optional().describe('Maximum results (default 50, hard cap 100)'),
  }, async (args) => run(async () => {
    const limit = Math.max(1, Math.min(args.limit ?? 50, 100))
    const { email_templates: rows, total } = await templates.listEmailTemplates(readCtx(), { search: args.search }, { limit, offset: 0 })
    return { email_templates: rows, count: rows.length, total }
  }))

  server.tool('email_templates_get', 'Get an email template with its subject, HTML body and plain-text body.', {
    email_template_id: z.string().describe('Email template ID'),
  }, async (args) => run(async () => ({ email_template: await templates.getEmailTemplate(readCtx(), args.email_template_id) })))

  server.tool('email_templates_create', 'Create an email template. Subject and bodies support {{variable}} and {{=FUNC(...)}} expressions. HTML is sanitised (scripts, iframes, forms, on* handlers and javascript: URLs are stripped); a blank text_body is generated from the HTML.', {
    name: z.string().describe('Template name (1-120 characters)'),
    description: z.string().optional().describe('Optional description'),
    subject: z.string().describe('Subject line'),
    html_body: z.string().describe('HTML body'),
    text_body: z.string().optional().describe('Plain-text / in-app notification body (default: generated from the HTML)'),
    is_default: z.boolean().optional().describe('Make this the workspace default (clears the previous default)'),
  }, async (args) => run(async () => ({ created: true, email_template: await templates.createEmailTemplate(writeCtx(), args) })))

  server.tool('email_templates_update', 'Update an email template. Supply only the fields that should change; a new html_body regenerates the text body unless text_body is also given. is_default: true moves the workspace default to this template.', {
    email_template_id: z.string().describe('Email template ID'),
    name: z.string().optional(),
    description: z.string().optional(),
    subject: z.string().optional(),
    html_body: z.string().optional(),
    text_body: z.string().optional(),
    is_default: z.boolean().optional(),
  }, async (args) => run(async () => {
    const { email_template_id: id, ...fields } = args
    return { updated: true, email_template: await templates.updateEmailTemplate(writeCtx(), id, fields) }
  }))

  server.tool('email_templates_delete', 'Delete an email template. The workspace default template cannot be deleted.', {
    email_template_id: z.string().describe('Email template ID'),
  }, async (args) => run(async () => {
    await templates.deleteEmailTemplate(writeCtx(), args.email_template_id)
    return { deleted: true, email_template_id: args.email_template_id }
  }))

  server.tool('email_templates_preview', 'Render an email template with sample variables using the same resolver as the send_email node. Nothing is sent.', {
    email_template_id: z.string().describe('Email template ID'),
    variables: z.record(z.string(), z.any()).optional().describe('Sample workflow variables, e.g. {"user_task_title": "Approve PO"}'),
    task: z.record(z.string(), z.any()).optional().describe('Sample task record for {{task.*}} references'),
  }, async (args) => run(async () => ({
    preview: await templates.previewEmailTemplate(readCtx(), args.email_template_id, { variables: args.variables, task: args.task }),
  })))
}
