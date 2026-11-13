/**
 * Permission of an extension MCP tool (`ext_<id>_<name>`), from its server
 * module (lib/mcp/authz falls back here; unknown tools stay denied).
 */
import { extensionToolPrefix } from './manifest'
import { getServerExtensions } from './server-registry'

export function extensionToolPermission(toolName: string): string | undefined {
  for (const ext of getServerExtensions()) {
    const prefix = extensionToolPrefix(ext.id)
    if (!toolName.startsWith(prefix)) continue
    const tool = (ext.mcpTools ?? []).find((t) => `${prefix}${t.name}` === toolName)
    if (tool) return tool.permission
  }
  return undefined
}
