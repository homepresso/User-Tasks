import { z } from 'zod'
import { defineEndpoint } from './registry'
import { booleanFlag, deletedResponse, idParams, itemResponse, listResponse, looseObject, paginationQuery } from './common'

const CODE_NOTE = 'Saving never runs the code. Actions run in a QuickJS WebAssembly sandbox with only the capabilities their manifest declares and an administrator approved; operators can switch execution off with CUSTOM_ACTIONS_DISABLED=true (see code_execution_enabled in responses).'

export const workflowActivityStatusSchema = z.enum(['draft', 'active', 'archived'])
export const workflowActivitySourceKindSchema = z.enum(['upload', 'inline'])

const manifestField = z.looseObject({
  id: z.string().optional(),
  name: z.string().min(1),
  label: z.string().optional(),
  type: z.string().optional().describe('string, number, boolean, object, array, …'),
  description: z.string().optional(),
  required: z.boolean().optional(),
  defaultValue: z.any().optional(),
})

export const workflowActivityManifestSchema = z.looseObject({
  inputs: z.array(manifestField).optional(),
  outputs: z.array(manifestField).optional(),
  display_name: z.string().optional().describe('Friendly label in the workflow picker and on node cards'),
  purpose: z.string().optional().describe('One-line purpose for designers'),
  recommended_for: z.string().optional(),
  summary: z.string().optional(),
  setup_notes: z.array(z.string()).optional(),
}).describe('Typed inputs/outputs (at least one of each) and presentation metadata')

const activityFields = {
  description: z.string().nullable().optional(),
  key: z.string().optional().describe('Stable workflow node key (default: slug of the name; unique per workspace)'),
  status: workflowActivityStatusSchema.optional().describe('Default draft'),
  source_kind: workflowActivitySourceKindSchema.optional().describe('Default inline'),
  version: z.string().optional().describe('Default 1.0.0'),
  icon_name: z.string().optional(),
  color: z.string().optional(),
  demo_inputs: z.record(z.string(), z.any()).optional().describe('Sample inputs for previews and testing'),
  tags: z.array(z.string()).optional(),
  source_filename: z.string().nullable().optional(),
}

export const workflowActivityCreateBody = z.object({
  name: z.string().min(1).max(160),
  source_code: z.string().min(1).describe('JavaScript exposing run, execute, handler, main, module.exports or module.exports.default'),
  manifest: workflowActivityManifestSchema,
  ...activityFields,
})

export const workflowActivityUpdateBody = z.object({
  name: z.string().min(1).max(160).optional(),
  source_code: z.string().min(1).optional(),
  manifest: workflowActivityManifestSchema.optional().describe('Replacement manifest'),
  ...activityFields,
  enabled: z.boolean().optional().describe('Kill switch: false = steps using the action fail fast and the designer hides it'),
  approved_hosts: z.array(z.string()).optional().describe('HTTP hosts to allow (only hosts the manifest declares in capabilities.http.hosts)'),
  data_grants: z.array(z.object({ table_id: z.string(), access: z.enum(['read', 'write']).optional() })).optional()
    .describe('Data tables the action may use (needs capabilities.data; write needs data.write)'),
})

export const workflowActionUploadBody = z.object({
  package_base64: z.string().optional().describe('A zip package (manifest.json + dist/action.js, optional signature.json), base64'),
  package_name: z.string().optional().describe('File name of the uploaded package (multipart)'),
  module: z.string().optional().describe('Or: the ES module source (one file, dependencies bundled, default export defineAction(...))'),
  manifest: z.union([z.string(), looseObject]).optional().describe('With `module`: manifest.json (v1, object or JSON text)'),
  signature: looseObject.optional().describe('Optional { alg: "ed25519", public_key, signature } over the module SHA-256 (hex)'),
})

export const workflowActionSecretsBody = z.object({
  values: z.record(z.string(), z.string().nullable()).describe('Declared secret name → value (null or "" clears it). Values are encrypted and never returned.'),
})

export const workflowActionTestBody = z.object({
  operation: z.string().optional().describe('Operation id (default: the first)'),
  inputs: z.record(z.string(), z.any()).optional().describe('Input values (default: the operation\'s sample)'),
  version: z.string().optional().describe('Run a stored version instead of the current one'),
})

// The body is a portable export (`{ version, asset_type, workflow_activity }`
// from GET …/export) or the bare activity object.
export const workflowActivityImportBody = z.looseObject({
  workflow_activity: looseObject.optional(),
})

const tags = ['Workflow activities']

export const listWorkflowActivitiesEndpoint = defineEndpoint({
  method: 'GET', path: '/workflow-activities', operationId: 'listWorkflowActivities', tags,
  summary: 'List custom workflow activities (without source code)', permission: 'extensibility.view',
  query: paginationQuery.extend({
    status: workflowActivityStatusSchema.optional(),
    search: z.string().optional().describe('Name, description or key contains'),
  }),
  response: listResponse('workflow_activities'), listKey: 'workflow_activities',
  cli: { resource: 'activities', verb: 'list' },
})

export const createWorkflowActivityEndpoint = defineEndpoint({
  method: 'POST', path: '/workflow-activities', operationId: 'createWorkflowActivity', tags,
  summary: 'Create a custom workflow activity', description: CODE_NOTE, permission: 'extensibility.create',
  body: workflowActivityCreateBody, successStatus: 201, response: itemResponse('workflow_activity'),
  cli: { resource: 'activities', verb: 'create' },
})

export const importWorkflowActivityEndpoint = defineEndpoint({
  method: 'POST', path: '/workflow-activities/import', operationId: 'importWorkflowActivity', tags,
  summary: 'Create an activity from a portable export', description: `Body: the JSON from GET /workflow-activities/{id}/export. ${CODE_NOTE}`,
  permission: 'extensibility.create',
  query: z.object({ publish: booleanFlag('true = import as active regardless of the exported status') }),
  body: workflowActivityImportBody, successStatus: 201, response: itemResponse('workflow_activity'),
  cli: { resource: 'activities', verb: 'import' },
})

export const getWorkflowActivityEndpoint = defineEndpoint({
  method: 'GET', path: '/workflow-activities/{id}', operationId: 'getWorkflowActivity', tags,
  summary: 'Get an activity with source code, manifest and readiness findings', permission: 'extensibility.view',
  params: idParams, response: itemResponse('workflow_activity'),
  cli: { resource: 'activities', verb: 'get', positional: ['id'] },
})

export const updateWorkflowActivityEndpoint = defineEndpoint({
  method: 'PATCH', path: '/workflow-activities/{id}', operationId: 'updateWorkflowActivity', tags,
  summary: 'Update an activity (omitted fields are kept)', description: CODE_NOTE, permission: 'extensibility.edit',
  params: idParams, body: workflowActivityUpdateBody, response: itemResponse('workflow_activity'),
  roundTrip: { unwrap: 'workflow_activity' },
  cli: { resource: 'activities', verb: 'update', positional: ['id'] },
})

export const deleteWorkflowActivityEndpoint = defineEndpoint({
  method: 'DELETE', path: '/workflow-activities/{id}', operationId: 'deleteWorkflowActivity', tags,
  summary: 'Delete an activity — refused (409, with the usages) while a workflow uses it', permission: 'extensibility.delete',
  params: idParams, response: deletedResponse,
  cli: { resource: 'activities', verb: 'delete', positional: ['id'] },
})

export const exportWorkflowActivityEndpoint = defineEndpoint({
  method: 'GET', path: '/workflow-activities/{id}/export', operationId: 'exportWorkflowActivity', tags,
  summary: 'Export an activity as portable JSON (accepted by POST /workflow-activities/import)', permission: 'extensibility.view',
  params: idParams,
  response: z.looseObject({ version: z.literal(1), asset_type: z.literal('workflow_activity'), workflow_activity: looseObject }),
  cli: { resource: 'activities', verb: 'export', positional: ['id'] },
})

export const uploadWorkflowActionEndpoint = defineEndpoint({
  method: 'POST', path: '/workflow-activities/upload', operationId: 'uploadWorkflowAction', tags,
  summary: 'Upload a packaged action (manifest v1 + one ES module): a new action, or a new version of the one with the same key',
  description: `Re-uploading identical content for an existing version is a no-op (outcome "unchanged"); different content for an existing version is refused (409). ${CODE_NOTE}`,
  permission: 'extensibility.create',
  body: workflowActionUploadBody, successStatus: 201,
  multipart: { files: { file: { name: 'package_name', content: 'package_base64' } } },
  response: z.looseObject({ workflow_activity: looseObject, version: z.string(), outcome: z.enum(['created', 'version', 'unchanged']), warnings: z.array(z.string()) }),
  cli: { resource: 'activities', verb: 'upload' },
})

export const workflowActivityUsagesEndpoint = defineEndpoint({
  method: 'GET', path: '/workflow-activities/{id}/usages', operationId: 'getWorkflowActivityUsages', tags,
  summary: 'Workflow steps that run the action (drafts and active published versions)', permission: 'extensibility.view',
  params: idParams, response: listResponse('usages'), listKey: 'usages',
  cli: { resource: 'activities', verb: 'usages', positional: ['id'] },
})

export const getWorkflowActivityVersionEndpoint = defineEndpoint({
  method: 'GET', path: '/workflow-activities/{id}/versions/{version}', operationId: 'getWorkflowActivityVersion', tags,
  summary: 'Get one stored version: manifest, SHA-256, signature and (with include_source=true) the module', permission: 'extensibility.view',
  params: idParams.extend({ version: z.string().min(1).max(64) }),
  query: z.object({ include_source: z.enum(['true', 'false']).optional() }),
  response: itemResponse('version'),
  cli: { resource: 'activities', verb: 'version', positional: ['id', 'version'] },
})

export const setWorkflowActivitySecretsEndpoint = defineEndpoint({
  method: 'PUT', path: '/workflow-activities/{id}/secrets', operationId: 'setWorkflowActivitySecrets', tags,
  summary: 'Set or clear the secrets the action declares (encrypted; never returned)', permission: 'extensibility.edit',
  params: idParams, body: workflowActionSecretsBody,
  response: z.looseObject({ secrets: z.array(z.looseObject({ name: z.string(), set: z.boolean() })) }),
  cli: { resource: 'activities', verb: 'secrets', positional: ['id'] },
})

export const testWorkflowActivityEndpoint = defineEndpoint({
  method: 'POST', path: '/workflow-activities/{id}/test', operationId: 'testWorkflowActivity', tags,
  summary: 'Run one operation with the given inputs in the sandbox and return outputs, logs, warnings and stats',
  description: 'Runs with the action\'s real grants (ctx.run.test is true). A failed run is still 200 with ok: false and the error code (timeout, memory, capability, action, invalid, host, disabled).',
  permission: 'extensibility.edit',
  params: idParams, body: workflowActionTestBody, response: z.looseObject({ ok: z.boolean(), outputs: looseObject, logs: z.array(looseObject) }),
  cli: { resource: 'activities', verb: 'test', positional: ['id'] },
})

export const workflowActivityEndpoints = [
  uploadWorkflowActionEndpoint, workflowActivityUsagesEndpoint, getWorkflowActivityVersionEndpoint,
  setWorkflowActivitySecretsEndpoint, testWorkflowActivityEndpoint,
  listWorkflowActivitiesEndpoint, createWorkflowActivityEndpoint, importWorkflowActivityEndpoint,
  getWorkflowActivityEndpoint, updateWorkflowActivityEndpoint, deleteWorkflowActivityEndpoint,
  exportWorkflowActivityEndpoint,
]
