import { z } from 'zod'
import { defineEndpoint } from './registry'

/**
 * The workspace address: acme.usertasks.com (tenants.subdomain). Reads are
 * open to any member; changing it needs settings.edit.
 */

const RULES = 'Lowercase a-z, 0-9 and hyphens, 3-40 characters, no leading, trailing or double hyphen; reserved names (www, app, api, docs, admin, mail, status, auth, login, help, support, gallery, form, …) are refused.'

const addressResponse = z.object({
  enabled: z.boolean().describe('Workspace addresses are on for this instance (a base domain is configured)'),
  base_domain: z.string().nullable().describe('The base domain addresses live under (e.g. usertasks.com)'),
  subdomain: z.string().nullable().describe('This workspace\'s subdomain (null = none)'),
  url: z.string().nullable().describe('https://<subdomain>.<base domain>, when both are set'),
})

const tags = ['Workspace address']

export const getWorkspaceAddressEndpoint = defineEndpoint({
  method: 'GET', path: '/workspace/address', operationId: 'getWorkspaceAddress', tags,
  summary: 'Get the workspace address (any member)', permission: null,
  response: addressResponse,
  cli: { resource: 'workspace-address', verb: 'get' },
})

export const updateWorkspaceAddressEndpoint = defineEndpoint({
  method: 'PATCH', path: '/workspace/address', operationId: 'updateWorkspaceAddress', tags,
  summary: 'Change the workspace address',
  description: `${RULES} 409 when another workspace has it (or had it in the last year). Links to the old address keep redirecting to the new one for a year; null removes the address (old links then stop working). Audited.`,
  permission: 'settings.edit',
  body: z.object({ subdomain: z.string().max(100).nullable().describe('The new subdomain, or null to remove it') }),
  response: addressResponse,
  cli: { resource: 'workspace-address', verb: 'set', positional: ['subdomain'] },
})

export const checkWorkspaceAddressEndpoint = defineEndpoint({
  method: 'GET', path: '/workspace/address/check', operationId: 'checkWorkspaceAddress', tags,
  summary: 'Check whether a workspace subdomain is valid and available', description: RULES,
  permission: null,
  query: z.object({ subdomain: z.string().max(100).describe('The subdomain to check') }),
  response: z.object({
    subdomain: z.string(),
    available: z.boolean(),
    reason: z.string().nullable().describe('Why not (format, reserved, taken), when not available'),
  }),
  cli: { resource: 'workspace-address', verb: 'check', positional: ['subdomain'] },
})

export const workspaceAddressEndpoints = [getWorkspaceAddressEndpoint, updateWorkspaceAddressEndpoint, checkWorkspaceAddressEndpoint]

/* ── trusted embedding (per-workspace approved sites) ─────────────── */

const embeddingResponse = z.object({
  supported: z.boolean().describe('Per-workspace approved sites apply on this instance'),
  reason: z.string().nullable().describe('Why not, when not supported'),
  origins: z.array(z.string()).describe('Sites (origins) that may frame this workspace\'s embeddable pages'),
  instance_origins: z.array(z.string()).describe('The instance-wide list (EMBED_FRAME_ANCESTORS), applies to every workspace'),
  workspace_url: z.string().nullable(),
})

const embeddingTags = ['Trusted embedding']

export const getWorkspaceEmbeddingEndpoint = defineEndpoint({
  method: 'GET', path: '/workspace/embedding', operationId: 'getWorkspaceEmbedding', tags: embeddingTags,
  summary: 'Get the sites approved to embed this workspace\'s pages (trusted embedding)', permission: 'settings.view',
  response: embeddingResponse,
  cli: { resource: 'workspace-embedding', verb: 'get' },
})

export const updateWorkspaceEmbeddingEndpoint = defineEndpoint({
  method: 'PUT', path: '/workspace/embedding', operationId: 'updateWorkspaceEmbedding', tags: embeddingTags,
  summary: 'Replace the sites approved to embed this workspace\'s pages',
  description: 'Origins only (https://sharepoint.contoso.com, https://*.contoso.com; http:// only when named so), at most 20. Applies to embeddable pages (/embed/…) on the workspace\'s own address. Audited.',
  permission: 'settings.edit',
  body: z.object({ origins: z.array(z.string().max(300)).max(20) }),
  response: embeddingResponse,
  cli: { resource: 'workspace-embedding', verb: 'set' },
})

export const workspaceEmbeddingEndpoints = [getWorkspaceEmbeddingEndpoint, updateWorkspaceEmbeddingEndpoint]
