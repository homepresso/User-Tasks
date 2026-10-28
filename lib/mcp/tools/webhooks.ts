import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import * as webhooks from '@/lib/services/webhooks'
import { messageOf } from './_util'

/*
 * Inbound workflow webhook tools: thin wrappers over lib/services/webhooks
 * (settings.manage_webhooks for every call, audited in the service). The
 * secret is returned once, by create and rotate.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const payloadMapping = z.array(z.record(z.string(), z.any())).describe('[{ incoming_field, variable_name, type }] mappings from the payload to workflow variables')

export function registerWebhookTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('webhooks_list', 'List the inbound webhooks of a workflow (slug, inbound url, active flag, payload mapping, receive count). Secrets are never returned.', {
    workflow_id: z.string().describe('Workflow ID'),
  }, async (args) => run(() => webhooks.listWorkflowWebhooks(svc(), args.workflow_id)))

  server.tool('webhooks_get', 'Get one inbound webhook (the secret is never returned).', {
    webhook_id: z.string().describe('Webhook ID'),
  }, async (args) => run(() => webhooks.getWebhook(svc(), args.webhook_id)))

  server.tool('webhooks_create', 'Create an inbound webhook that starts the workflow. Callers POST to the returned url with `Authorization: Bearer <secret>`; the secret is shown only in this response.', {
    workflow_id: z.string().describe('Workflow ID'),
    slug: z.string().optional().describe('URL slug (?hook=<slug>); generated when omitted'),
    payload_mapping: payloadMapping.optional(),
    is_active: z.boolean().optional().describe('Default true'),
  }, async (args) => run(async () => {
    const { workflow_id: workflowId, ...input } = args
    return { created: true, ...(await webhooks.createWorkflowWebhook(svc(), workflowId, input)) }
  }))

  server.tool('webhooks_update', 'Change a webhook slug, payload mapping or active flag. The secret only changes with webhooks_rotate.', {
    webhook_id: z.string().describe('Webhook ID'),
    slug: z.string().optional().describe('New URL slug (callers must switch to the new url)'),
    payload_mapping: payloadMapping.optional(),
    is_active: z.boolean().optional(),
  }, async (args) => run(async () => {
    const { webhook_id: webhookId, ...input } = args
    return { updated: true, ...(await webhooks.updateWebhook(svc(), webhookId, input)) }
  }))

  server.tool('webhooks_delete', 'Delete an inbound webhook; its url stops working.', {
    webhook_id: z.string().describe('Webhook ID'),
  }, async (args) => run(() => webhooks.deleteWebhook(svc(), args.webhook_id)))

  server.tool('webhooks_rotate', 'Replace a webhook secret (the old one stops working). The new secret is shown only in this response.', {
    webhook_id: z.string().describe('Webhook ID'),
  }, async (args) => run(() => webhooks.rotateWebhookSecret(svc(), args.webhook_id)))
}
