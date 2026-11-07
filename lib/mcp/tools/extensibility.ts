import type { McpToolServer } from '../server'
import type { McpContext } from '../server'
import { mcpErr, mcpOk } from '../server'
import { z } from 'zod'
import { MCP_CORE_TOOL_DESCRIPTIONS } from '@/lib/mcp/descriptions'
import { fromMcpContext, type ServiceContext } from '@/lib/services/context'
import * as activities from '@/lib/services/workflow-activities'
import * as formControls from '@/lib/services/form-controls'
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

  server.tool('workflow_activities_update', 'Update an existing custom workflow activity / action. Supply only the fields that should change. Also: enabled (kill switch), approved_hosts (HTTP hosts the manifest declares), data_grants (tables the action may read / write).', {
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
    enabled: z.boolean().optional().describe('Kill switch: false = steps using it fail fast and the designer hides it'),
    approved_hosts: z.array(z.string()).optional().describe('HTTP hosts to allow (only hosts the manifest declares); [] revokes'),
    data_grants: z.array(z.object({ table_id: z.string(), access: z.enum(['read', 'write']).optional() })).optional().describe('Data tables the action may use; [] revokes'),
  }, async (args) => run(async () => {
    const { workflow_activity_id: id, ...fields } = args
    return saved('updated', await activities.updateWorkflowActivity(writeCtx(), id, fields))
  }))

  server.tool('workflow_activities_delete', 'Delete a custom workflow activity / action from Extensibility. Refused while a workflow uses it — the error lists the usages.', {
    workflow_activity_id: z.string().describe('Workflow activity ID'),
  }, async (args) => run(async () => {
    await activities.deleteWorkflowActivity(writeCtx(), args.workflow_activity_id)
    return { deleted: true, workflow_activity_id: args.workflow_activity_id }
  }))

  server.tool('workflow_activities_import', 'Import a portable custom workflow activity JSON export.', {
    import_json: z.string().describe('Portable JSON from workflow_activities_export or the Extensibility export button'),
    publish: z.boolean().optional().describe('When true, imported assets become active regardless of their source status'),
  }, async (args) => run(async () => saved('imported', await activities.importWorkflowActivity(writeCtx(), args.import_json, { publish: args.publish }))))

  server.tool('workflow_activities_upload', 'Add a packaged custom workflow action (manifest v1 + one self-contained ES module whose default export is defineAction({ operations })), or a new version of the action with the same key. Versions are immutable (same bytes = unchanged; different bytes for an existing version are refused). The module runs in a QuickJS WebAssembly sandbox with only the capabilities its manifest declares and an administrator approves (hosts, tables, secrets).', {
    package_base64: z.string().optional().describe('Zip package (manifest.json + dist/action.js), base64'),
    module: z.string().optional().describe('ES module source (with manifest)'),
    manifest: z.union([z.string(), z.record(z.string(), z.any())]).optional().describe('manifest.json for `module` (object or JSON text)'),
  }, async (args) => run(async () => {
    const ctx = writeCtx()
    if (args.package_base64) return activities.uploadWorkflowAction(ctx, { zip: formControls.decodeBase64Package(args.package_base64) })
    if (args.module) return activities.uploadWorkflowAction(ctx, { module: args.module, manifest: args.manifest })
    throw new Error('Send package_base64 or module + manifest')
  }))

  server.tool('workflow_activities_usages', 'Workflow steps (drafts and active published versions) that run a custom workflow action.', {
    workflow_activity_id: z.string().describe('Workflow activity id or key'),
  }, async (args) => run(async () => ({ usages: await activities.getWorkflowActivityUsages(readCtx(), args.workflow_activity_id) })))

  server.tool('workflow_activities_version_get', 'Get one stored version of a custom workflow action: manifest, SHA-256, signature, optionally the module source.', {
    workflow_activity_id: z.string().describe('Workflow activity id or key'),
    version: z.string().describe('Semver version'),
    include_source: z.boolean().optional().describe('Include the module source'),
  }, async (args) => run(async () => ({ version: await activities.getWorkflowActivityVersion(readCtx(), args.workflow_activity_id, args.version, { includeSource: args.include_source }) })))

  server.tool('workflow_activities_secrets_set', 'Set or clear the secrets a custom workflow action declares (capabilities.secrets). Values are encrypted and never returned; the action reads them as secret://<name>.', {
    workflow_activity_id: z.string().describe('Workflow activity id or key'),
    values: z.record(z.string(), z.string().nullable()).describe('Secret name → value (null clears)'),
  }, async (args) => run(async () => activities.setWorkflowActivitySecrets(writeCtx(), args.workflow_activity_id, args.values)))

  server.tool('workflow_activities_test', 'Run one operation of a custom workflow action in the sandbox with the given inputs (default: its sample). Returns ok, outputs, logs, type warnings and stats; a failed run returns ok: false with an error code (timeout, memory, capability, action, invalid, host, disabled).', {
    workflow_activity_id: z.string().describe('Workflow activity id or key'),
    operation: z.string().optional().describe('Operation id (default: the first)'),
    inputs: z.record(z.string(), z.any()).optional().describe('Input values'),
    version: z.string().optional().describe('Run a stored version'),
  }, async (args) => run(async () => activities.testWorkflowActivity(writeCtx(), args.workflow_activity_id, { operation: args.operation ?? null, inputs: args.inputs ?? null, version: args.version ?? null })))

  // ── Custom form controls (web components) ──────────────────────────────

  server.tool('form_controls_list', 'List custom form controls (web components) in the workspace library, with versions, checksums and approved network hosts. Enabled controls appear in the form designer\'s Custom palette group; place one on a form with a field { type: "custom", custom: { tag, version, value_type, props } } (forms_create / forms_update).', {
    search: z.string().optional().describe('Name, tag or description contains'),
    enabled: z.boolean().optional().describe('Only enabled (true) or disabled (false) controls'),
    limit: z.number().optional().describe('Maximum results (default 50, cap 200)'),
  }, async (args) => run(async () => {
    const limit = Math.max(1, Math.min(args.limit ?? 50, 200))
    const { form_controls: rows, total } = await formControls.listFormControls(readCtx(), { search: args.search, enabled: args.enabled }, { limit, offset: 0 })
    return { form_controls: rows, count: rows.length, total }
  }))

  server.tool('form_controls_get', 'Get a custom form control by id or tag: the latest manifest (value type, props schema, capabilities, display template), every version and its SHA-256 / signature.', {
    form_control_id: z.string().describe('Control id or tag (e.g. ut-star-rating)'),
  }, async (args) => run(async () => ({ form_control: await formControls.getFormControl(readCtx(), args.form_control_id) })))

  server.tool('form_controls_version_get', 'Get one version of a custom form control: manifest and checksum, optionally the ES module source.', {
    form_control_id: z.string().describe('Control id or tag'),
    version: z.string().describe('Semantic version, e.g. 1.0.0'),
    include_module: z.boolean().optional().describe('Include the module source'),
  }, async (args) => run(async () => ({ version: (await formControls.getFormControlVersion(readCtx(), args.form_control_id, args.version, { includeBundle: args.include_module })).version })))

  server.tool('form_controls_create', 'Add a custom form control, or a new version of the control with the same tag: a zip package (base64), an ES module + its manifest, or an https URL (fetched once and snapshotted — never loaded from the URL at runtime). The module must be one self-contained ES module (dependencies bundled) defining the manifest tag and dispatching ut-change. Versions are immutable. Controls run in a sandboxed iframe with no network unless an admin approves hosts.', {
    package_base64: z.string().optional().describe('Zip package (manifest.json + module), base64'),
    module: z.string().optional().describe('ES module source (with manifest)'),
    manifest: z.union([z.string(), z.record(z.string(), z.any())]).optional().describe('manifest.json for `module` (object or JSON text)'),
    url: z.string().optional().describe('https URL of a zip or module to import'),
    manifest_url: z.string().optional().describe('manifest.json URL for a module `url` (default: next to it)'),
  }, async (args) => run(async () => {
    const ctx = writeCtx()
    if (args.url) return formControls.importFormControlFromUrl(ctx, { url: args.url, manifest_url: args.manifest_url ?? null })
    if (args.package_base64) return formControls.uploadFormControl(ctx, { zip: formControls.decodeBase64Package(args.package_base64) })
    if (args.module) return formControls.uploadFormControl(ctx, { module: args.module, manifest: args.manifest })
    throw new Error('Send package_base64, module + manifest, or url')
  }))

  server.tool('form_controls_update', 'Enable or disable a custom form control (disabled: hidden from the designer and its frames stop loading), rename it, or approve the network hosts its manifest asks for. Marking a control trusted is not available here.', {
    form_control_id: z.string().describe('Control id or tag'),
    enabled: z.boolean().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    approved_hosts: z.array(z.string()).optional().describe('Hosts to allow (only ones a manifest asks for); [] revokes'),
  }, async (args) => run(async () => {
    const { form_control_id: id, ...fields } = args
    return { updated: true, form_control: await formControls.updateFormControl(writeCtx(), id, fields) }
  }))

  server.tool('form_controls_usages', 'Where a custom form control is used: reusable forms (any version), workflow drafts and published versions, open tasks.', {
    form_control_id: z.string().describe('Control id or tag'),
  }, async (args) => run(async () => ({ usages: await formControls.getFormControlUsages(readCtx(), args.form_control_id) })))

  server.tool('form_controls_delete', 'Delete a custom form control (or one version). Refused while a form, workflow or open task uses it — the error lists the usages.', {
    form_control_id: z.string().describe('Control id or tag'),
    version: z.string().optional().describe('Delete only this version'),
  }, async (args) => run(async () => formControls.deleteFormControl(writeCtx(), args.form_control_id, { version: args.version ?? null })))

  server.tool('form_controls_export', 'Export a custom form control with every version (modules included) as portable JSON for form_controls_import.', {
    form_control_id: z.string().describe('Control id or tag'),
  }, async (args) => run(async () => ({ exported: true, export: await formControls.exportFormControl(readCtx(), args.form_control_id) })))

  server.tool('form_controls_import', 'Import a portable custom form control export: creates the control and adds the versions it lacks (checksums verified; existing versions with different content are refused).', {
    import_json: z.string().describe('JSON from form_controls_export'),
  }, async (args) => run(async () => formControls.importFormControl(writeCtx(), args.import_json)))
}
