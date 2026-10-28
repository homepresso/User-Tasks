import { z } from 'zod'
import { defineEndpoint } from './registry'
import { deletedResponse, idParams, itemResponse, listResponse } from './common'

const SECRET_NOTE = 'Callers POST to the returned url with `Authorization: Bearer <secret>`. The secret is shown only in this response.'

export const webhookCreateBody = z.object({
  slug: z.string().min(3).max(100).optional().describe('URL slug (?hook=<slug>); generated when omitted'),
  payload_mapping: z.array(z.looseObject({})).optional().describe('[{ incoming_field, variable_name, type }] mappings from the payload to workflow variables'),
  is_active: z.boolean().optional().describe('Default true'),
})

const webhookWithSecret = z.looseObject({
  webhook: z.looseObject({}),
  secret: z.string().describe('Plaintext webhook secret (shown once)'),
})

const tags = ['Webhooks']

export const listWorkflowWebhooksEndpoint = defineEndpoint({
  method: 'GET', path: '/workflows/{id}/webhooks', operationId: 'listWorkflowWebhooks', tags,
  summary: 'List the inbound webhooks of a workflow (secrets are never returned)', permission: 'settings.manage_webhooks',
  params: idParams, response: listResponse('webhooks'), listKey: 'webhooks',
  cli: { resource: 'webhooks', verb: 'list', positional: ['id'] },
})

export const createWorkflowWebhookEndpoint = defineEndpoint({
  method: 'POST', path: '/workflows/{id}/webhooks', operationId: 'createWorkflowWebhook', tags,
  summary: 'Create an inbound webhook that triggers the workflow', description: SECRET_NOTE, permission: 'settings.manage_webhooks',
  params: idParams, body: webhookCreateBody, successStatus: 201, response: webhookWithSecret,
  cli: { resource: 'webhooks', verb: 'create', positional: ['id'] },
})

export const webhookUpdateBody = z.object({
  slug: z.string().min(3).max(100).optional().describe('New URL slug (callers must switch to the new url)'),
  payload_mapping: z.array(z.looseObject({})).optional().describe('Replacement payload mappings'),
  is_active: z.boolean().optional(),
})

export const getWebhookEndpoint = defineEndpoint({
  method: 'GET', path: '/webhooks/{id}', operationId: 'getWebhook', tags,
  summary: 'Get a webhook (the secret is never returned)', permission: 'settings.manage_webhooks',
  params: idParams, response: itemResponse('webhook'),
  cli: { resource: 'webhooks', verb: 'get', positional: ['id'] },
})

export const updateWebhookEndpoint = defineEndpoint({
  method: 'PATCH', path: '/webhooks/{id}', operationId: 'updateWebhook', tags,
  summary: 'Update a webhook slug, payload mapping or active flag', permission: 'settings.manage_webhooks',
  params: idParams, body: webhookUpdateBody, response: z.looseObject({ webhook: z.looseObject({}), changed: z.boolean() }),
  roundTrip: { unwrap: 'webhook' },
  cli: { resource: 'webhooks', verb: 'update', positional: ['id'] },
})

export const deleteWebhookEndpoint = defineEndpoint({
  method: 'DELETE', path: '/webhooks/{id}', operationId: 'deleteWebhook', tags,
  summary: 'Delete a webhook', permission: 'settings.manage_webhooks',
  params: idParams, response: deletedResponse,
  cli: { resource: 'webhooks', verb: 'delete', positional: ['id'] },
})

export const rotateWebhookEndpoint = defineEndpoint({
  method: 'POST', path: '/webhooks/{id}/rotate', operationId: 'rotateWebhookSecret', tags,
  summary: 'Replace a webhook secret (the old one stops working)', description: SECRET_NOTE, permission: 'settings.manage_webhooks',
  params: idParams, response: webhookWithSecret,
  cli: { resource: 'webhooks', verb: 'rotate', positional: ['id'] },
})

export const webhookEndpoints = [
  listWorkflowWebhooksEndpoint, createWorkflowWebhookEndpoint, getWebhookEndpoint, updateWebhookEndpoint, deleteWebhookEndpoint, rotateWebhookEndpoint,
]
