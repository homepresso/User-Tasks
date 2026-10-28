import type { McpToolServer } from '../server'
import type { McpContext } from '../server'
import { mcpErr, mcpOk } from '../server'
import { z } from 'zod'
import { MCP_CORE_TOOL_DESCRIPTIONS } from '@/lib/mcp/descriptions'
import { fromMcpContext, type ServiceContext } from '@/lib/services/context'
import * as activities from '@/lib/services/workflow-activities'
import { messageOf } from './_util'

/*
 * Custom workflow activity tools. Thin wrappers over
 * lib/services/workflow-activities: the service owns validation, tenant
 * filtering, the deletion queue, audit and GitHub-sync capture (mutating
 * tools are listed in AUDITED_IN_SERVICE in ../authz). Reads need
 * extensibility.view (READ_TOOL_PERMISSIONS in ../authz).
 */

const workflowActivityFieldSchema = z.object({
  id: z.string().optional().describe('Optional stable ID for the field'),
  name: z.string().min(1).describe('Field name'),
  label: z.string().optional().describe('Optional label'),
  type: z.string().optional().describe('Optional type hint such as string, number, boolean, object, array'),
  description: z.string().optional().describe('Optional description'),
  required: z.boolean().optional().describe('Whether this field is required'),
  defaultValue: z.any().optional().describe('Optional default value'),
})

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

/** Saved activity → the legacy `{ <flag>: true, workflow_activity, readiness, guidance }` shape. */
function saved(flag: 'created' | 'updated' | 'imported', activity: activities.WorkflowActivitySummary) {
  return { [flag]: true, workflow_activity: activity, readiness: activity.readiness, guidance: activities.activityGuidance(activity) }
}

const manifestSchema = z.object({
  inputs: z.array(workflowActivityFieldSchema).optional(),
  outputs: z.array(workflowActivityFieldSchema).optional(),
  display_name: z.string().optional().describe('Friendly end-user label shown in the workflow picker and node cards'),
  purpose: z.string().optional().describe('Plain-language one-line purpose for non-technical users'),
  recommended_for: z.string().optional().describe('Who this activity is best suited for, for example Operations managers or HR coordinators'),
  summary: z.string().optional().describe('Optional end-user summary shown across the workflow UX'),
  setup_notes: z.array(z.string()).optional().describe('Optional friendly setup notes shown in simple mode'),
})

export function registerExtensibilityTools(server: McpToolServer, ctx: McpContext) {
  const writeCtx = (): ServiceContext => fromMcpContext(ctx)
  const readCtx = (): ServiceContext => fromMcpContext(ctx) // reads are gated too (READ_TOOL_PERMISSIONS)

  server.tool('workflow_activities_list', 'List custom workflow activities available in Extensibility. These uploaded code assets appear as native custom activity nodes inside the workflow builder.', {
    search: z.string().optional().describe('Search by name, description, key, or tags'),
    status: z.enum(['draft', 'active', 'archived']).optional().describe('Filter by status'),
    limit: z.number().optional().describe('Maximum results to return (default 50, hard cap 200)'),
  }, async (args) => run(async () => {
    const limit = Math.max(1, Math.min(args.limit ?? 50, 200))
    const { workflow_activities: rows } = await activities.listWorkflowActivities(
      readCtx(),
      { search: args.search, status: args.status },
      { limit, offset: 0 },
    )
    return { workflow_activities: rows, count: rows.length }
  }))

  server.tool('workflow_activities_get', 'Get a single custom workflow activity including source code, manifest, demo inputs, and metadata.', {
    workflow_activity_id: z.string().describe('Workflow activity ID'),
  }, async (args) => run(async () => ({ workflow_activity: await activities.getWorkflowActivity(readCtx(), args.workflow_activity_id) })))

  server.tool('workflow_activities_export', 'Export a custom workflow activity as portable JSON so MCP can recreate the activity in another tenant or environment.', {
    workflow_activity_id: z.string().describe('Workflow activity ID'),
  }, async (args) => run(async () => ({ exported: true, export: await activities.exportWorkflowActivity(readCtx(), args.workflow_activity_id) })))

  server.tool('workflow_activities_create', MCP_CORE_TOOL_DESCRIPTIONS.workflow_activities_create, {
    name: z.string().describe('Activity name'),
    description: z.string().optional().describe('Optional description'),
    key: z.string().optional().describe('Optional stable workflow node key; defaults to a slug of the activity name'),
    status: z.enum(['draft', 'active', 'archived']).optional().describe('Asset status'),
    source_kind: z.enum(['upload', 'inline']).optional().describe('Whether the activity came from uploaded files or inline code'),
    version: z.string().optional().describe('Semantic version string'),
    icon_name: z.string().optional().describe('Optional workflow builder icon name'),
    color: z.string().optional().describe('Optional node color'),
    source_code: z.string().describe('JavaScript source that exports run, execute, handler, main, module.exports, or module.exports.default'),
    manifest: manifestSchema.optional().describe('Typed input and output declarations used by the workflow builder'),
    demo_inputs: z.record(z.string(), z.any()).optional().describe('Optional sample inputs for previews and testing'),
    tags: z.array(z.string()).optional().describe('Search tags'),
    source_filename: z.string().optional().describe('Original uploaded filename'),
  }, async (args) => run(async () => saved('created', await activities.createWorkflowActivity(writeCtx(), args))))

  server.tool('workflow_activities_update', 'Update an existing custom workflow activity. Supply only the fields that should change.', {
    workflow_activity_id: z.string().describe('Workflow activity ID'),
    name: z.string().optional().describe('Updated name'),
    description: z.string().optional().describe('Updated description'),
    key: z.string().optional().describe('Updated stable workflow node key'),
    status: z.enum(['draft', 'active', 'archived']).optional().describe('Updated status'),
    source_kind: z.enum(['upload', 'inline']).optional().describe('Updated source kind'),
    version: z.string().optional().describe('Updated version string'),
    icon_name: z.string().optional().describe('Updated icon name'),
    color: z.string().optional().describe('Updated node color'),
    source_code: z.string().optional().describe('Replacement JavaScript source'),
    manifest: manifestSchema.optional().describe('Replacement typed input/output manifest'),
    demo_inputs: z.record(z.string(), z.any()).optional().describe('Replacement sample inputs'),
    tags: z.array(z.string()).optional().describe('Replacement tags'),
    source_filename: z.string().optional().describe('Updated original filename'),
  }, async (args) => run(async () => {
    const { workflow_activity_id: id, ...fields } = args
    return saved('updated', await activities.updateWorkflowActivity(writeCtx(), id, fields))
  }))

  server.tool('workflow_activities_delete', 'Delete a custom workflow activity asset from Extensibility.', {
    workflow_activity_id: z.string().describe('Workflow activity ID'),
  }, async (args) => run(async () => {
    await activities.deleteWorkflowActivity(writeCtx(), args.workflow_activity_id)
    return { deleted: true, workflow_activity_id: args.workflow_activity_id }
  }))

  server.tool('workflow_activities_import', 'Import a portable custom workflow activity JSON export.', {
    import_json: z.string().describe('Portable JSON from workflow_activities_export or the Extensibility export button'),
    publish: z.boolean().optional().describe('When true, imported assets become active regardless of their source status'),
  }, async (args) => run(async () => saved('imported', await activities.importWorkflowActivity(writeCtx(), args.import_json, { publish: args.publish }))))
}
