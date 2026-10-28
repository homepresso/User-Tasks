import { z } from 'zod'
import { defineEndpoint } from './registry'
import { booleanFlag, deletedResponse, idParams, itemResponse, listResponse, looseObject, paginationQuery } from './common'

const CODE_NOTE = 'Saving never runs the code. Execution in workflows requires the server to set ENABLE_CUSTOM_ACTIVITY_CODE=true (see code_execution_enabled in responses).'

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
  summary: 'Delete an activity', permission: 'extensibility.delete',
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

export const workflowActivityEndpoints = [
  listWorkflowActivitiesEndpoint, createWorkflowActivityEndpoint, importWorkflowActivityEndpoint,
  getWorkflowActivityEndpoint, updateWorkflowActivityEndpoint, deleteWorkflowActivityEndpoint,
  exportWorkflowActivityEndpoint,
]
