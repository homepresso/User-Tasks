import { z } from 'zod'
import { defineEndpoint } from './registry'
import { deletedResponse, idParams, itemResponse, listResponse, paginationQuery } from './common'

const SANITISE_NOTE = 'HTML is sanitised (scripts, iframes, objects, embeds, forms, on* handlers and javascript: URLs are removed); a blank text_body is generated from the HTML.'
const DEFAULT_NOTE = 'At most one template per workspace is the default: setting is_default clears it on the others. The default cannot be deleted.'

export const emailTemplateCreateBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().nullable().optional(),
  subject: z.string().min(1).max(500).describe('Subject line; supports {{variable}} and {{=FUNC(...)}} expressions'),
  html_body: z.string().min(1).max(250_000).describe('HTML body; supports {{variable}} and {{=FUNC(...)}} expressions'),
  text_body: z.string().max(100_000).nullable().optional().describe('Plain-text / in-app notification body (default: generated from the HTML)'),
  is_default: z.boolean().optional().describe('Make this the workspace default template'),
})

export const emailTemplateUpdateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().nullable().optional(),
  subject: z.string().min(1).max(500).optional(),
  html_body: z.string().min(1).max(250_000).optional().describe('New HTML body (the text body is regenerated unless text_body is also sent)'),
  text_body: z.string().max(100_000).nullable().optional(),
  is_default: z.boolean().optional().describe('true makes this the workspace default (clearing the previous one)'),
})

export const emailTemplatePreviewBody = z.object({
  variables: z.record(z.string(), z.any()).default({}).describe('Sample workflow variables, e.g. { "user_task_title": "Approve PO" }; app_url defaults to the server URL'),
  task: z.record(z.string(), z.any()).optional().describe('Sample task record for {{task.*}} references'),
})

const tags = ['Email templates']

export const listEmailTemplatesEndpoint = defineEndpoint({
  method: 'GET', path: '/email-templates', operationId: 'listEmailTemplates', tags,
  summary: 'List email templates (without bodies)', permission: 'workflows.view',
  query: paginationQuery.extend({ search: z.string().optional().describe('Name contains') }),
  response: listResponse('email_templates'), listKey: 'email_templates',
  cli: { resource: 'email-templates', verb: 'list' },
})

export const createEmailTemplateEndpoint = defineEndpoint({
  method: 'POST', path: '/email-templates', operationId: 'createEmailTemplate', tags,
  summary: 'Create an email template', description: `${SANITISE_NOTE} ${DEFAULT_NOTE}`,
  permission: 'workflows.create', body: emailTemplateCreateBody, successStatus: 201,
  response: itemResponse('email_template'),
  cli: { resource: 'email-templates', verb: 'create' },
})

export const getEmailTemplateEndpoint = defineEndpoint({
  method: 'GET', path: '/email-templates/{id}', operationId: 'getEmailTemplate', tags,
  summary: 'Get an email template with its subject and bodies', permission: 'workflows.view',
  params: idParams, response: itemResponse('email_template'),
  cli: { resource: 'email-templates', verb: 'get', positional: ['id'] },
})

export const updateEmailTemplateEndpoint = defineEndpoint({
  method: 'PATCH', path: '/email-templates/{id}', operationId: 'updateEmailTemplate', tags,
  summary: 'Update an email template', description: `${SANITISE_NOTE} ${DEFAULT_NOTE}`,
  permission: 'workflows.edit', params: idParams, body: emailTemplateUpdateBody,
  response: itemResponse('email_template'),
  roundTrip: { unwrap: 'email_template' },
  cli: { resource: 'email-templates', verb: 'update', positional: ['id'] },
})

export const deleteEmailTemplateEndpoint = defineEndpoint({
  method: 'DELETE', path: '/email-templates/{id}', operationId: 'deleteEmailTemplate', tags,
  summary: 'Delete an email template (409 for the default template)', permission: 'workflows.edit',
  params: idParams, response: deletedResponse,
  cli: { resource: 'email-templates', verb: 'delete', positional: ['id'] },
})

export const previewEmailTemplateEndpoint = defineEndpoint({
  method: 'POST', path: '/email-templates/{id}/preview', operationId: 'previewEmailTemplate', tags,
  summary: 'Render the subject and bodies with sample variables (nothing is sent)',
  description: 'Uses the same expression resolver as the send_email workflow node; unknown {{variables}} render as empty.',
  permission: 'workflows.view', params: idParams, body: emailTemplatePreviewBody,
  response: z.looseObject({ id: z.string(), name: z.string(), subject: z.string(), html_body: z.string(), text_body: z.string() }),
  cli: { resource: 'email-templates', verb: 'preview', positional: ['id'] },
})

export const emailTemplateEndpoints = [
  listEmailTemplatesEndpoint, createEmailTemplateEndpoint, getEmailTemplateEndpoint,
  updateEmailTemplateEndpoint, deleteEmailTemplateEndpoint, previewEmailTemplateEndpoint,
]
