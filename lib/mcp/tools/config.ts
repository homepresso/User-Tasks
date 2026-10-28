import { z } from 'zod'
import type { McpContext, McpToolServer } from '../server'
import { mcpErr, mcpOk } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import { applyConfig, CONFIG_EXPORT_TYPES, exportConfig } from '@/lib/services/config'
import { messageOf } from './_util'

/*
 * Config-as-code over MCP: the same service as GET /config/export and
 * POST /config/apply (and `usertasks config export|apply`). MCP has no file
 * system, so both tools speak the single-manifest form. This is also the
 * single-asset export/import for every type: export with `ids` (optionally
 * `with_dependencies`), apply the returned manifest in another workspace.
 * Each section is gated by its own view / create / edit permission inside the
 * service; secrets are always "__SECRET__".
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

export function registerConfigTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('config_export', `Export workspace configuration as one portable manifest (config as code). Omit everything for the whole workspace, or pass ids for single assets of any type. Sections: ${CONFIG_EXPORT_TYPES.join(', ')}. Secrets are replaced with "__SECRET__"; sections you cannot view are listed in skipped.`, {
    types: z.array(z.string()).optional().describe('Sections to export (default all)'),
    ids: z.array(z.string()).optional().describe('Only these asset ids (an integration brings its references and objects)'),
    with_dependencies: z.boolean().optional().describe('With ids: also export everything they depend on'),
    include_rows: z.boolean().optional().describe('Also export the rows of exported data tables (table_rows section)'),
  }, async (args) => run(() => exportConfig(svc(), { ...args, format: 'manifest' })))

  server.tool('config_apply', 'Apply a config manifest (from config_export or a config-as-code folder) to this workspace: creates or updates, never deletes. Use dry_run first — it returns a per-asset plan (create / update / unchanged / error) with field diffs. "__SECRET__" keeps stored secrets; connectors without credentials are created disabled.', {
    manifest: z.record(z.string(), z.any()).describe('The manifest object (config_export output `manifest`)'),
    dry_run: z.boolean().optional().describe('Plan only (default false)'),
    adopt_by_name: z.boolean().optional().describe('Match unmapped assets to existing ones with the same unique name'),
    source_label: z.string().optional().describe('Label recorded with id mappings (default "default")'),
    rows_mode: z.enum(['merge', 'replace', 'skip']).optional().describe('table_rows: merge (default), replace or skip'),
  }, async (args) => run(() => applyConfig(svc(), { ...args, source_label: args.source_label ?? 'mcp' })))
}
