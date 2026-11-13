import { z } from 'zod'
import { defineEndpoint } from './registry'

/**
 * Licence and entitlements for paid extensions (/api/v1/licence*): instance
 * level, instance admin token only (like /api/v1/admin/*). Keep this module
 * dependency-free apart from zod (scripts load it for OpenAPI and the CLI).
 */

const AUTH_NOTE = 'Authorization: Bearer <INSTANCE_ADMIN_TOKEN> only (workspace API keys and OAuth tokens get 403). Off (404) unless the server sets INSTANCE_ADMIN_TOKEN. Rate-limited per IP; audited.'

const tags = ['Licence']

const problem = z.looseObject({ code: z.string(), message: z.string() })

const licenceSummary = z.looseObject({
  licenceId: z.string().nullable(),
  source: z.enum(['setting', 'env', 'env_file']).describe('setting: installed here; env: USERTASKS_LICENCE; env_file: USERTASKS_LICENCE_FILE'),
  customer: z.string().nullable(),
  issuedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  cutoffAt: z.string().nullable().describe('expiresAt + 24 hours: when the licensed extensions stop'),
  updatesUntil: z.string().nullable(),
  daysLeft: z.number().nullable(),
  timeState: z.enum(['not_yet_valid', 'active', 'expiring', 'cutoff_pending', 'expired']).nullable(),
  valid: z.boolean().describe('Genuine signature from a known key, and bound to this installation (or unbound)'),
  trial: z.boolean(),
  bound: z.looseObject({ instanceIds: z.array(z.string()), hostnames: z.array(z.string()) }),
  extensions: z.array(z.looseObject({ id: z.string(), edition: z.string().nullable(), features: z.array(z.string()).nullable() })),
  limits: z.record(z.string(), z.number()),
  kid: z.string().nullable(),
  problems: z.array(problem),
})

const extensionStatus = z.looseObject({
  id: z.string(),
  state: z.enum(['licensed', 'unlicensed', 'expired', 'not_required']),
  allowed: z.boolean(),
  licenceId: z.string().nullable(),
  features: z.array(z.string()).nullable(),
  limits: z.record(z.string(), z.number()),
  expiresAt: z.string().nullable(),
  cutoffAt: z.string().nullable(),
  daysLeft: z.number().nullable(),
  timeState: z.string().nullable(),
  trial: z.boolean(),
})

const warning = z.looseObject({
  level: z.enum(['info', 'warn', 'error']),
  code: z.string(),
  licenceId: z.string().nullable(),
  message: z.string(),
})

export const licenceStatusSchema = z.looseObject({
  instance: z.looseObject({ instanceId: z.string().nullable(), hostnames: z.array(z.string()) }),
  now: z.string(),
  licences: z.array(licenceSummary),
  extensions: z.array(extensionStatus),
  warnings: z.array(warning),
  usage: z.record(z.string(), z.number().nullable()).describe('Current usage per limit key (null: not counted)'),
})

export const getLicenceEndpoint = defineEndpoint({
  method: 'GET', path: '/licence', operationId: 'getLicence', tags,
  summary: 'Licence status: installed licences, licensed extensions, limits and usage, expiry warnings (instance admin)',
  description: `${AUTH_NOTE} Licensed extensions stop 24 hours after their licence expires (cutoffAt).`,
  permission: null, auth: 'instance_admin',
  response: licenceStatusSchema,
  cli: { resource: 'licence', verb: 'status' },
})

export const installLicenceBody = z.object({
  licence: z.string().min(1).max(64_000).describe('The licence file contents (JSON, or base64 of it)'),
})

export const installLicenceEndpoint = defineEndpoint({
  method: 'PUT', path: '/licence', operationId: 'installLicence', tags,
  summary: 'Install or replace a licence (instance admin)',
  description: `${AUTH_NOTE} The signature, key id and binding are checked; an invalid, foreign or expired licence is refused (400). A licence with the same licence_id replaces the installed one; others stay installed.`,
  permission: null, auth: 'instance_admin',
  body: installLicenceBody,
  response: z.looseObject({ licence: licenceSummary, replaced: z.boolean(), notes: z.array(z.string()) }),
  cli: { resource: 'licence', verb: 'install' },
})

export const removeLicenceQuery = z.object({
  licence_id: z.string().min(1).max(200).optional().describe('The licence to remove'),
  all: z.enum(['true', 'false']).optional().describe('true: remove every licence installed here'),
})

export const removeLicenceEndpoint = defineEndpoint({
  method: 'DELETE', path: '/licence', operationId: 'removeLicence', tags,
  summary: 'Remove an installed licence (instance admin)',
  description: `${AUTH_NOTE} Needs licence_id, or all=true. Licences from USERTASKS_LICENCE / USERTASKS_LICENCE_FILE are removed by unsetting the variable.`,
  permission: null, auth: 'instance_admin',
  query: removeLicenceQuery,
  response: z.looseObject({ removed: z.array(z.string()) }),
  cli: { resource: 'licence', verb: 'remove', flags: { all: 'remove-all' } },
})

export const getLicenceRequestEndpoint = defineEndpoint({
  method: 'GET', path: '/licence/request', operationId: 'getLicenceRequest', tags,
  summary: 'Offline activation request: instance id, hostnames, version (instance admin)',
  description: `${AUTH_NOTE} Upload the returned JSON to the licensing portal from any connected machine to get a licence bound to this installation. Contains no secrets and no usage data.`,
  permission: null, auth: 'instance_admin',
  response: z.looseObject({
    kind: z.literal('usertasks.licence_request'),
    format: z.literal(1),
    instance_id: z.string().nullable(),
    hostnames: z.array(z.string()),
    version: z.string(),
    deployment_mode: z.enum(['cloud', 'self_hosted']),
    installed_licences: z.array(z.string()),
    created_at: z.string(),
  }),
  cli: { resource: 'licence', verb: 'request' },
})

// ─── Cloud entitlements ────────────────────────────────────────────────────

export const tenantEntitlementSchema = z.looseObject({
  id: z.string().optional(),
  tenant_id: z.string(),
  extension_id: z.string(),
  edition: z.string().nullable().optional(),
  features: z.array(z.string()).nullable().optional(),
  limits: z.record(z.string(), z.number()).nullable().optional(),
  status: z.enum(['active', 'suspended', 'revoked']),
  source: z.enum(['admin', 'trial', 'stripe', 'licence']),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const listEntitlementsEndpoint = defineEndpoint({
  method: 'GET', path: '/licence/entitlements', operationId: 'listEntitlements', tags,
  summary: 'List workspace entitlements to paid extensions (instance admin)',
  description: `${AUTH_NOTE} Cloud entitlements (tenant_entitlements): admin-managed now, fed by billing later.`,
  permission: null, auth: 'instance_admin',
  query: z.object({
    tenant_id: z.string().uuid().optional().describe('Only this workspace'),
    extension_id: z.string().optional().describe('Only this extension'),
  }),
  response: z.looseObject({ entitlements: z.array(tenantEntitlementSchema) }),
  listKey: 'entitlements',
  cli: { resource: 'entitlements', verb: 'list' },
})

export const grantEntitlementBody = z.object({
  tenant_id: z.string().uuid().describe('Workspace id'),
  extension_id: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/).describe('Extension id, e.g. sharepoint'),
  edition: z.string().trim().min(1).max(100).nullable().optional(),
  features: z.array(z.string().trim().min(1).max(100)).max(200).optional().describe('Features granted (omitted / empty / ["*"]: all)'),
  limits: z.record(z.string().min(1).max(100), z.number().finite().nonnegative()).optional().describe('Numeric limits, e.g. {"sharepoint.farms": 2}'),
  status: z.enum(['active', 'suspended', 'revoked']).optional().describe('Default active'),
  source: z.enum(['admin', 'trial', 'stripe', 'licence']).optional().describe('Default admin'),
  starts_at: z.string().datetime({ offset: true }).nullable().optional(),
  ends_at: z.string().datetime({ offset: true }).nullable().optional().describe('Expiry; the extension stops 24 hours after it. Omitted: no end'),
  notes: z.string().max(2000).nullable().optional(),
})

export const grantEntitlementEndpoint = defineEndpoint({
  method: 'PUT', path: '/licence/entitlements', operationId: 'grantEntitlement', tags,
  summary: 'Grant or update a workspace entitlement to a paid extension (instance admin)',
  description: `${AUTH_NOTE} One row per workspace and extension (upsert).`,
  permission: null, auth: 'instance_admin',
  body: grantEntitlementBody,
  response: z.looseObject({ entitlement: tenantEntitlementSchema }),
  cli: { resource: 'entitlements', verb: 'grant' },
})

export const revokeEntitlementEndpoint = defineEndpoint({
  method: 'DELETE', path: '/licence/entitlements/{tenant_id}/{extension_id}', operationId: 'revokeEntitlement', tags,
  summary: 'Remove a workspace entitlement (instance admin)',
  description: AUTH_NOTE,
  permission: null, auth: 'instance_admin',
  params: z.object({ tenant_id: z.string().uuid().describe('Workspace id'), extension_id: z.string().min(1).max(63).describe('Extension id') }),
  response: z.looseObject({ deleted: z.boolean() }),
  cli: { resource: 'entitlements', verb: 'revoke', positional: ['tenant_id', 'extension_id'] },
})

export const licenceEndpoints = [
  getLicenceEndpoint,
  installLicenceEndpoint,
  removeLicenceEndpoint,
  getLicenceRequestEndpoint,
  listEntitlementsEndpoint,
  grantEntitlementEndpoint,
  revokeEntitlementEndpoint,
]
