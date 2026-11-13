import { z } from 'zod'
import { defineEndpoint } from './registry'

/**
 * Extensions compiled into this build (lib/services/extensions): per-workspace
 * enable / disable and typed settings. Reading needs settings.view, changing
 * settings.edit. An extension's own endpoints live under /ext/<id>/… and are
 * listed in the served OpenAPI document of a build that includes it.
 */

const tags = ['Extensions']
const idParams = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/).describe('Extension id') })
const pageParams = idParams.extend({ page: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/).describe('Settings page id') })

const extensionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  version: z.string(),
  publisher: z.object({ id: z.string(), name: z.string() }),
  licence: z.object({
    tier: z.enum(['free', 'paid']),
    sku: z.string().nullable(),
    state: z.string().describe('licensed, unlicensed, expired or not_required (free)'),
    allowed: z.boolean(),
    reason: z.string().nullable(),
  }),
  compatible: z.boolean().describe('engines.usertasks / extension_sdk accept this build'),
  runs_here: z.boolean().describe('Compatible, built for this deployment mode and complete'),
  problems: z.array(z.string()),
  enabled: z.boolean().describe('Enabled in this workspace'),
  enabled_at: z.string().nullable(),
  config_version: z.number(),
  settings_pages: z.array(z.object({ id: z.string(), scope: z.enum(['workspace', 'instance', 'user']), label: z.string(), group: z.string() })),
  permissions: z.array(z.object({ key: z.string(), label: z.string(), implied_by: z.array(z.string()) })),
  contributes: z.object({ nodes: z.number(), triggers: z.number(), connectors: z.number(), nav_items: z.number(), settings_pages: z.number(), pages: z.number() }),
})

const settingsResponse = z.object({
  extension_id: z.string(),
  page: z.object({ id: z.string(), scope: z.enum(['workspace', 'instance', 'user']), label: z.string(), description: z.string().nullable(), schema: z.unknown().describe('Sections of typed fields (manifest settings schema)') }),
  values: z.record(z.string(), z.unknown()).describe('Current values (defaults filled in); secret / certificate fields are never returned'),
  secrets_set: z.array(z.string()).describe('Secret / certificate fields that have a value'),
  config_version: z.number(),
})

export const listExtensionsEndpoint = defineEndpoint({
  method: 'GET', path: '/extensions', operationId: 'listExtensions', tags,
  summary: 'List the extensions in this build and their state in this workspace', permission: 'settings.view',
  response: z.object({
    extensions: z.array(extensionSchema), total: z.number(), platform_version: z.string(), problems: z.array(z.string()),
    notice: z.string().optional().describe('Set when the extension tables are missing (migration not applied)'),
  }),
  listKey: 'extensions',
  cli: { resource: 'extensions', verb: 'list' },
})

export const getExtensionEndpoint = defineEndpoint({
  method: 'GET', path: '/extensions/{id}', operationId: 'getExtension', tags,
  summary: 'Get one extension', permission: 'settings.view', params: idParams,
  response: z.object({ extension: extensionSchema }),
  cli: { resource: 'extensions', verb: 'get', positional: ['id'] },
})

export const enableExtensionEndpoint = defineEndpoint({
  method: 'POST', path: '/extensions/{id}/enable', operationId: 'enableExtension', tags,
  summary: 'Enable an extension in this workspace',
  description: '402 when a paid extension is not licensed, 409 when it cannot run in this build. Gives the workspace system roles the extension\'s default permissions. Audited.',
  permission: 'settings.edit', params: idParams,
  response: z.object({ extension: extensionSchema }),
  cli: { resource: 'extensions', verb: 'enable', positional: ['id'] },
})

export const disableExtensionEndpoint = defineEndpoint({
  method: 'POST', path: '/extensions/{id}/disable', operationId: 'disableExtension', tags,
  summary: 'Disable an extension in this workspace (settings and data are kept)', permission: 'settings.edit', params: idParams,
  response: z.object({ extension: extensionSchema }),
  cli: { resource: 'extensions', verb: 'disable', positional: ['id'] },
})

export const getExtensionSettingsEndpoint = defineEndpoint({
  method: 'GET', path: '/extensions/{id}/settings/{page}', operationId: 'getExtensionSettings', tags,
  summary: 'Read one settings page of an extension (schema and values; secrets never returned)',
  description: 'Workspace pages need settings.view; personal pages a user API key; instance pages are only available in Settings → Extensions.',
  permission: null, params: pageParams,
  response: settingsResponse,
  cli: { resource: 'extensions', verb: 'settings', positional: ['id', 'page'] },
})

export const updateExtensionSettingsEndpoint = defineEndpoint({
  method: 'PUT', path: '/extensions/{id}/settings/{page}', operationId: 'updateExtensionSettings', tags,
  summary: 'Change one settings page of an extension',
  description: 'Validated against the page schema on the server. Secret and certificate fields: a string sets, null clears, absent keeps. Workspace pages need settings.edit. Audited and versioned.',
  permission: null, params: pageParams,
  body: z.object({ values: z.record(z.string(), z.unknown()).describe('Field key → value') }),
  response: settingsResponse,
  cli: { resource: 'extensions', verb: 'configure', positional: ['id', 'page'] },
})

export const extensionEndpoints = [listExtensionsEndpoint, getExtensionEndpoint, enableExtensionEndpoint, disableExtensionEndpoint, getExtensionSettingsEndpoint, updateExtensionSettingsEndpoint]
