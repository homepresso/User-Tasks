import { z } from 'zod'
import { defineEndpoint } from './registry'
import { idParams, looseObject } from './common'

/**
 * On-premises gateways (lib/gateway, lib/services/gateways): a service the
 * customer runs on their network that dials out to UserTasks and carries
 * connector requests to systems behind the firewall (e.g. SharePoint Server).
 * Reads: integrations.view. Changes: settings.edit (audited).
 */

const tags = ['On-premises gateways']

const instance = z.looseObject({
  id: z.string(),
  label: z.string().nullable(),
  status: z.enum(['pending', 'active', 'rotated', 'revoked']),
  online: z.boolean(),
  fingerprint: z.string().nullable().describe('Short fingerprint of the instance\'s Ed25519 public key'),
  instance_name: z.string().nullable(),
  hostname: z.string().nullable(),
  version: z.string().nullable(),
  update_available: z.boolean(),
  last_seen_at: z.string().nullable(),
  token_expires_at: z.string().nullable().describe('Pending instances: when the registration token expires'),
})

const gateway = z.looseObject({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(['active', 'revoked']),
  online: z.boolean(),
  state: z.enum(['online', 'offline', 'never_connected', 'revoked']),
  targets: z.array(z.object({ id: z.string(), origin: z.string() })).describe('Targets the gateway advertises (from its own configuration)'),
  relay_url: z.string().nullable().describe('Where the gateway takes inbound callbacks on the customer\'s network (null = relay off)'),
  version: z.string().nullable(),
  latest_version: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  instances: z.array(instance),
})

const registration = z.looseObject({
  key_id: z.string(),
  token: z.string().describe('One-time registration token (shown once, valid 24 hours)'),
  expires_at: z.string(),
  commands: z.looseObject({ windows: z.string(), docker: z.string(), cli: z.string() }),
})

export const listGatewaysEndpoint = defineEndpoint({
  method: 'GET', path: '/gateways', operationId: 'listGateways', tags,
  summary: 'List the workspace\'s on-premises gateways with their instances and status',
  permission: 'integrations.view',
  query: z.object({ include_revoked: z.enum(['true', 'false']).optional().describe('Also list revoked gateways') }),
  response: z.object({ gateways: z.array(gateway), configured: z.boolean().describe('The server can sign gateway answers (ENCRYPTION_KEY or GATEWAY_SIGNING_KEY set)') }),
  listKey: 'gateways',
  cli: { resource: 'gateways', verb: 'list' },
})

export const createGatewayEndpoint = defineEndpoint({
  method: 'POST', path: '/gateways', operationId: 'createGateway', tags,
  summary: 'Create an on-premises gateway and its first registration token',
  description: 'Returns the gateway and a one-time registration token for its first instance (valid 24 hours, shown once). Install the gateway on the customer\'s network and register it with the token. Audited.',
  permission: 'settings.edit', successStatus: 201,
  body: z.object({ name: z.string().max(100), description: z.string().max(500).nullable().optional() }),
  response: z.object({ gateway, registration }),
  cli: { resource: 'gateways', verb: 'create' },
})

export const getGatewayEndpoint = defineEndpoint({
  method: 'GET', path: '/gateways/{id}', operationId: 'getGateway', tags,
  summary: 'Get a gateway: instances, status, last 24 hours of requests (latency, failures) and security events',
  permission: 'integrations.view', params: idParams,
  response: looseObject,
  cli: { resource: 'gateways', verb: 'get', positional: ['id'] },
})

export const updateGatewayEndpoint = defineEndpoint({
  method: 'PATCH', path: '/gateways/{id}', operationId: 'updateGateway', tags,
  summary: 'Rename a gateway or change its description',
  permission: 'settings.edit', params: idParams,
  body: z.object({ name: z.string().max(100).optional(), description: z.string().max(500).nullable().optional() }),
  response: gateway,
  roundTrip: { unwrap: 'gateway' },
  cli: { resource: 'gateways', verb: 'update', positional: ['id'] },
})

export const revokeGatewayEndpoint = defineEndpoint({
  method: 'DELETE', path: '/gateways/{id}', operationId: 'revokeGateway', tags,
  summary: 'Revoke a gateway: every instance key and queued request; connections using it stop working',
  permission: 'settings.edit', params: idParams,
  response: z.object({ revoked: z.boolean(), id: z.string() }),
  cli: { resource: 'gateways', verb: 'revoke', positional: ['id'] },
})

export const createGatewayTokenEndpoint = defineEndpoint({
  method: 'POST', path: '/gateways/{id}/tokens', operationId: 'createGatewayRegistrationToken', tags,
  summary: 'Issue a one-time registration token for another instance of a gateway (high availability, replacement)',
  description: 'Each instance has its own key. Run two or more instances for failover. Tokens are valid 24 hours and shown once. Audited.',
  permission: 'settings.edit', params: idParams, successStatus: 201,
  body: z.object({ label: z.string().max(100).nullable().optional() }),
  response: registration,
  cli: { resource: 'gateways', verb: 'add-instance', positional: ['id'] },
})

export const revokeGatewayInstanceEndpoint = defineEndpoint({
  method: 'DELETE', path: '/gateways/{id}/instances/{instance_id}', operationId: 'revokeGatewayInstance', tags,
  summary: 'Revoke one gateway instance key (or an unused registration token); its in-flight requests fail',
  permission: 'settings.edit',
  params: z.object({ id: z.string().describe('Gateway id'), instance_id: z.string().describe('Instance (key) id') }),
  response: z.object({ revoked: z.boolean(), key_id: z.string() }),
  cli: { resource: 'gateways', verb: 'revoke-instance', positional: ['id', 'instance_id'] },
})

export const gatewayEndpoints = [
  listGatewaysEndpoint, createGatewayEndpoint, getGatewayEndpoint, updateGatewayEndpoint, revokeGatewayEndpoint,
  createGatewayTokenEndpoint, revokeGatewayInstanceEndpoint,
]
