import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import * as address from '@/lib/services/workspace-address'
import { getWorkspaceEmbedding, setWorkspaceEmbedding } from '@/lib/services/tenant-settings'
import { messageOf } from './_util'

/*
 * Workspace address tools (acme.usertasks.com): thin wrappers over
 * lib/services/workspace-address. Reads are open to any member (mapped to
 * tasks.view_own, which every role holds); changing the address needs
 * settings.edit and is audited in the service.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const RULES = 'Lowercase a-z, 0-9 and hyphens, 3-40 characters, no leading, trailing or double hyphen; reserved names (www, app, api, docs, admin, mail, status, auth, login, help, support, gallery, form, …) are refused.'

export function registerWorkspaceAddressTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('workspace_address_get', 'Get the workspace address: whether addresses are on for this instance, the base domain, this workspace\'s subdomain and its URL (https://<subdomain>.<base domain>).', {},
    async () => run(async () => ({ address: await address.getWorkspaceAddress(svc()) })))

  server.tool('workspace_address_check', `Check whether a subdomain is valid and available for this workspace. ${RULES}`, {
    subdomain: z.string().describe('The subdomain to check'),
  }, async (args) => run(async () => address.checkSubdomain(svc(), args.subdomain)))

  server.tool('workspace_address_set', `Change (or, with null, remove) the workspace address (settings.edit). ${RULES} Links to the old address keep redirecting for a year; removing the address breaks them. Audited.`, {
    subdomain: z.string().nullable().describe('The new subdomain, or null to remove it'),
  }, async (args) => run(async () => ({ address: await address.setWorkspaceSubdomain(svc(), args.subdomain) })))

  server.tool('workspace_embedding_get', 'Trusted embedding: the sites (origins) approved to show this workspace\'s embeddable pages in a frame or dialog (e.g. the SharePoint add-in dialog), the instance-wide list, and whether per-workspace lists apply on this instance.', {},
    async () => run(async () => getWorkspaceEmbedding(svc())))

  server.tool('workspace_embedding_set', 'Replace the sites approved to embed this workspace\'s pages (settings.edit): origins such as https://sharepoint.contoso.com or https://*.contoso.com (http:// only when named so), at most 20; applies on the workspace\'s own address. Audited.', {
    origins: z.array(z.string()).describe('Origins, scheme + host (+ port), no paths'),
  }, async (args) => run(async () => setWorkspaceEmbedding(svc(), { origins: args.origins })))
}
