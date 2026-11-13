import { z } from 'zod'
import type { McpContext, McpToolServer } from '../server'
import { mcpErr, mcpOk } from '../server'
import { fromMcpContext, isServiceError } from '@/lib/services/context'
import * as extensions from '@/lib/services/extensions'
import { createExtensionContext } from '@/lib/extensions/host'
import { extensionToolPrefix } from '@/lib/extensions/manifest'
import { getServerExtensions } from '@/lib/extensions/server-registry'
import { extensionAccess, extensionAccessError } from '@/lib/extensions/state'
import { messageOf } from './_util'

/*
 * Extensions (lib/services/extensions): list the extensions compiled into
 * this build, enable / disable them per workspace and read / change their
 * typed settings — the same rules as /api/v1/extensions and Settings →
 * Extensions (settings.view to read, settings.edit to change; secrets are
 * write-only). Then every extension's own tools, namespaced
 * `ext_<id>_<name>`, each gated by the permission its manifest names
 * (lib/mcp/authz extension fallback) and refused unless the extension is
 * enabled and licensed in the caller's workspace.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    // Licence and enablement denials carry their code (extension_licence_expired ≠ extension_not_licensed).
    const code = isServiceError(error) ? ((error.details as { code?: string } | undefined)?.code ?? error.code) : null
    if (code && /^extension_|^not_found$/.test(code)) return mcpErr(`[${code}] ${error instanceof Error ? error.message : 'Request failed'}`)
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const SETTINGS_NOTE = 'Workspace pages only (instance pages are for instance admins in Settings → Extensions; personal pages need a user key). Secret and certificate fields: a string sets, null clears, absent keeps; they are never returned (secrets_set lists which are set).'

export function registerExtensionTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('extensions_list', 'List the extensions compiled into this build: version, publisher, licence state (free / licensed / unlicensed / expired), compatibility, whether each runs here and is enabled in this workspace, its settings pages and permissions.', {},
    async () => run(() => extensions.listExtensions(svc())))

  server.tool('extensions_get', 'Get one extension (same fields as extensions_list).', {
    id: z.string().describe('Extension id, e.g. "example-hello"'),
  }, async (args) => run(() => extensions.getExtension(svc(), args.id)))

  server.tool('extensions_enable', 'Enable an extension in this workspace (settings.edit). Needs a licence for paid extensions; gives the workspace system roles the extension\'s default permissions. Audited.', {
    id: z.string().describe('Extension id'),
  }, async (args) => run(() => extensions.enableExtension(svc(), args.id)))

  server.tool('extensions_disable', 'Disable an extension in this workspace (settings.edit): its menus, pages, API, tools, triggers and jobs stop for the workspace; settings, secrets and data are kept. Audited.', {
    id: z.string().describe('Extension id'),
  }, async (args) => run(() => extensions.disableExtension(svc(), args.id)))

  server.tool('extensions_settings_get', `Read one settings page of an extension: its schema (sections and typed fields) and current values. ${SETTINGS_NOTE}`, {
    id: z.string().describe('Extension id'),
    page: z.string().describe('Settings page id (extensions_get → settings_pages)'),
  }, async (args) => run(() => extensions.getExtensionSettings(svc(), args.id, args.page)))

  server.tool('extensions_settings_update', `Change one settings page of an extension (settings.edit for workspace pages). Values are validated against the page schema on the server (types, options, patterns, required / requiredWhen). ${SETTINGS_NOTE} Audited and versioned.`, {
    id: z.string().describe('Extension id'),
    page: z.string().describe('Settings page id'),
    values: z.record(z.string(), z.unknown()).describe('Field key → value'),
  }, async (args) => run(() => extensions.updateExtensionSettings(svc(), args.id, args.page, args.values as Record<string, unknown>)))

  // The extensions' own tools.
  for (const ext of getServerExtensions()) {
    for (const tool of ext.mcpTools ?? []) {
      const name = `${extensionToolPrefix(ext.id)}${tool.name}`
      server.tool(name, tool.description, tool.schema, async (args) => run(async () => {
        const access = await extensionAccess(ctx.tenantId, ext.id)
        if (!access.usable) throw extensionAccessError(access, ext.id)
        const extCtx = createExtensionContext({ extensionId: ext.id, tenantId: ctx.tenantId, actorId: ctx.actingUserId ?? ctx.credentialOwnerId ?? null, db: ctx.supabase })
        const result = await tool.handler({ ctx: extCtx, args: (args ?? {}) as Record<string, unknown> })
        if (tool.mutates) await extCtx.audit({ action: 'execute', summary: `MCP: ${name}`, metadata: { via: 'mcp', tool: name, ...(ctx.via === 'agent' ? { agent: true } : {}) } })
        return result
      }))
    }
  }
}
