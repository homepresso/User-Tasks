import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import * as gateways from '@/lib/services/gateways'
import { messageOf } from './_util'

/*
 * On-premises gateway tools: status for agents diagnosing a connection ("is
 * the gateway online, which targets does it serve, why do requests fail")
 * and, with settings.edit, the same administration as REST / CLI / Settings
 * (create, rename, add an instance — returns a one-time registration token
 * like api_keys_create returns a key —, revoke an instance or the gateway).
 * All changes are audited in lib/services/gateways.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

export function registerGatewayTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('gateways_list', 'List the workspace\'s on-premises gateways (services on a customer\'s network that carry connector requests to systems behind the firewall): state (online / offline / never connected), instances with version and last seen, and the targets each serves.', {
    include_revoked: z.boolean().optional().describe('Also list revoked gateways'),
  }, async (args) => run(() => gateways.listGateways(svc(), { include_revoked: args.include_revoked === true })))

  server.tool('gateways_get', 'Get one on-premises gateway: instances, advertised targets, the last 24 hours of requests (count, failures, p50 / p95 latency, recent requests without bodies) and security events (refused signatures, replays, allowlist refusals).', {
    gateway_id: z.string().describe('Gateway ID'),
  }, async (args) => run(() => gateways.getGateway(svc(), args.gateway_id)))

  server.tool('gateways_create', 'Create an on-premises gateway (settings.edit) and its first one-time registration token (valid 24 hours, shown once) with the install commands. The customer installs the gateway on their network and registers it with the token. Audited.', {
    name: z.string().describe('Gateway name, e.g. "Head office"'),
    description: z.string().nullable().optional(),
  }, async (args) => run(() => gateways.createGateway(svc(), args)))

  server.tool('gateways_update', 'Rename an on-premises gateway or change its description (settings.edit).', {
    gateway_id: z.string().describe('Gateway ID'),
    name: z.string().optional(),
    description: z.string().nullable().optional(),
  }, async (args) => run(() => gateways.updateGateway(svc(), args.gateway_id, { name: args.name, description: args.description })))

  server.tool('gateways_revoke', 'Revoke an on-premises gateway (settings.edit): every instance key and queued request at once; connections through it stop working. Cannot be undone. Audited.', {
    gateway_id: z.string().describe('Gateway ID'),
  }, async (args) => run(() => gateways.revokeGateway(svc(), args.gateway_id)))

  server.tool('gateways_add_instance', 'Issue a one-time registration token for another instance of a gateway (settings.edit): high availability or a replacement. Valid 24 hours, shown once. Audited.', {
    gateway_id: z.string().describe('Gateway ID'),
    label: z.string().nullable().optional(),
  }, async (args) => run(() => gateways.createGatewayRegistrationToken(svc(), args.gateway_id, { label: args.label })))

  server.tool('gateways_revoke_instance', 'Revoke one gateway instance key or an unused registration token (settings.edit); its in-flight requests fail, other instances keep working. Audited.', {
    gateway_id: z.string().describe('Gateway ID'),
    instance_id: z.string().describe('Instance (key) ID'),
  }, async (args) => run(() => gateways.revokeGatewayInstance(svc(), args.gateway_id, args.instance_id)))
}
