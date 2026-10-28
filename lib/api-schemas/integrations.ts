import { z } from 'zod'
import { defineEndpoint } from './registry'
import { booleanFlag, deletedResponse, idParams, itemResponse, listResponse, looseObject, paginationQuery } from './common'

// Credential values (auth_config tokens, passwords, connector credentials) are
// write-only: responses carry '__SECRET__' in their place, and sending the
// sentinel back on an update keeps the stored value.
const SECRET_NOTE = 'Secrets are returned masked as "__SECRET__"; send the sentinel back to keep a stored value.'

export const integrationTypeSchema = z.enum(['rest_api', 'odata', 'webhook', 'database'])

export const integrationConfigSchema = looseObject.describe(
  'REST/OData/webhook: { base_url, auth_type: none|api_key|bearer|basic|oauth2, auth_config: { token | key_name+key_value | username+password }, headers }. '
  + 'Database: { db_config: { db_type, host, port, database, username, password, ssl } }',
)

export const integrationCreateBody = z.object({
  name: z.string().min(1).max(120),
  type: integrationTypeSchema,
  config: integrationConfigSchema,
  tags: z.array(z.string()).max(50).optional(),
})

export const integrationUpdateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  config: integrationConfigSchema.optional().describe(`Full config object. ${SECRET_NOTE}`),
  is_active: z.boolean().optional(),
  tags: z.array(z.string()).max(50).nullable().optional(),
})

export const importOpenApiOverrides = z.object({
  name: z.string().min(1).max(120).optional().describe('Integration name (default: the spec title)'),
  base_url: z.string().optional().describe('Base URL (default: the first server in the spec)'),
  auth_type: z.enum(['none', 'api_key', 'bearer', 'basic']).optional(),
  auth_config: looseObject.optional(),
  selected_reference_indexes: z.array(z.number().int().min(0)).optional().describe('Zero-based operation indexes to import (default: all)'),
  tags: z.array(z.string()).max(50).optional(),
})

// Either `{ spec, ...overrides }` or the raw OpenAPI/Postman document itself
// (so `-f openapi.json` works as-is; overrides then come from the query).
export const importOpenApiBody = z.looseObject({
  spec: z.union([z.string(), looseObject]).optional()
    .describe('OpenAPI 2/3 or Postman document (object, or JSON/YAML text). Omit to send the document itself as the body.'),
  name: z.string().optional(),
  base_url: z.string().optional(),
  auth_type: z.string().optional(),
  auth_config: looseObject.optional(),
  selected_reference_indexes: z.array(z.number().int()).optional(),
  tags: z.array(z.any()).optional(),
})

export const importOpenApiQuery = z.object({
  name: z.string().optional().describe('Integration name override (raw-document bodies)'),
  base_url: z.string().optional().describe('Base URL override (raw-document bodies)'),
  auth_type: z.enum(['none', 'api_key', 'bearer', 'basic']).optional().describe('Auth type override (raw-document bodies)'),
})

const referenceInputDef = looseObject.describe('{ name, type, required, location: path|query|header|body, default_value }')
const referenceOutputDef = looseObject.describe('{ name, path, type }')
const responseSchemaDef = looseObject.nullable().describe('Response model: { source?, root: { type, description?, example?, fields?: [{ name, ...node }], items?: node } } (a bare root node is accepted). null clears it; it is then derived from outputs again.')

export const referenceCreateBody = z.object({
  name: z.string().min(1).max(160),
  description: z.string().nullable().optional(),
  method: z.string().optional().describe('HTTP or database method (default GET)'),
  path_template: z.string().optional().describe('e.g. /users/{{id}}'),
  body_template: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  query_params: looseObject.optional(),
  request_config: looseObject.optional().describe('Full request config; overrides the shorthand fields'),
  inputs: z.array(referenceInputDef).optional(),
  outputs: z.array(referenceOutputDef).optional(),
  response_schema: responseSchemaDef.optional(),
  tags: z.array(z.string()).optional(),
})

export const referenceUpdateBody = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().nullable().optional(),
  method: z.string().optional().describe('Sets request_config.method'),
  request_config: looseObject.optional(),
  inputs: z.array(referenceInputDef).optional(),
  outputs: z.array(referenceOutputDef).optional(),
  response_schema: responseSchemaDef.optional(),
  tags: z.array(z.string()).nullable().optional(),
})

export const referenceBulkDeleteBody = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
})

export const referenceExecuteBody = z.object({
  inputs: z.record(z.string(), z.any()).default({}).describe('Input values by input name'),
  capture_schema: z.boolean().optional().describe("Fold a successful response into the reference's response model (inferred from the sample, merged with earlier samples) and return it as response_schema"),
})

export const objectSourceSchema = z.looseObject({
  source_type: z.enum(['table', 'reference']).optional(),
  sourceType: z.enum(['table', 'reference']).optional(),
  table_id: z.string().nullable().optional(),
  reference_id: z.string().nullable().optional(),
  alias: z.string().min(1),
  is_primary: z.boolean().optional(),
  join_type: z.enum(['inner', 'left', 'right', 'full', 'cross']).nullable().optional(),
  join_on_local: z.string().nullable().optional(),
  join_on_foreign: z.string().nullable().optional(),
  join_to_alias: z.string().nullable().optional(),
}).describe('One source; exactly one must be primary. camelCase keys (sourceType, tableId, …) are also accepted.')

export const objectCreateBody = z.object({
  name: z.string().min(1).max(160),
  description: z.string().nullable().optional(),
  sources: z.array(objectSourceSchema).min(1),
})

export const objectUpdateBody = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().nullable().optional(),
  sources: z.array(objectSourceSchema).min(1).optional().describe('Full replacement source list (rebuilds the generated reference outputs)'),
})

export const connectorCategorySchema = z.enum(['cloud', 'communication', 'ai', 'payments', 'productivity', 'database'])

export const connectorCreateBody = z.object({
  connector_key: z.string().min(1).describe('Catalog key (see connectors catalog)'),
  display_name: z.string().max(120).optional(),
  config: z.record(z.string(), z.any()).optional().describe('Connector configuration fields'),
  credentials: z.record(z.string(), z.any()).optional().describe('Connector credential fields (write-only)'),
})

export const connectorUpdateBody = z.object({
  display_name: z.string().max(120).optional(),
  config: z.record(z.string(), z.any()).optional().describe('Fields to change (merged over the stored config)'),
  credentials: z.record(z.string(), z.any()).optional().describe(`Credential fields to change (merged). ${SECRET_NOTE}`),
  enabled: z.boolean().optional(),
  regenerate_references: z.boolean().optional().describe('Rebuild the generated references from the template'),
})

const integrationTags = ['Integrations']
const referenceTags = ['References']
const objectTags = ['Objects']
const connectorTags = ['Connectors']

const testResult = z.looseObject({ status: z.string(), message: z.string() })

export const listIntegrationsEndpoint = defineEndpoint({
  method: 'GET', path: '/integrations', operationId: 'listIntegrations', tags: integrationTags,
  summary: 'List integrations', permission: 'integrations.view',
  query: paginationQuery.extend({
    active: booleanFlag('Filter by active flag'),
    type: z.string().optional().describe('Integration type (rest_api, odata, database, webhook or a connector key)'),
    search: z.string().optional().describe('Name contains'),
  }),
  response: listResponse('integrations'), listKey: 'integrations',
  cli: { resource: 'integrations', verb: 'list' },
})

export const createIntegrationEndpoint = defineEndpoint({
  method: 'POST', path: '/integrations', operationId: 'createIntegration', tags: integrationTags,
  summary: 'Create an integration (credentials are encrypted at rest)', permission: 'integrations.create',
  body: integrationCreateBody, successStatus: 201, response: itemResponse('integration'),
  cli: { resource: 'integrations', verb: 'create' },
})

export const getIntegrationEndpoint = defineEndpoint({
  method: 'GET', path: '/integrations/{id}', operationId: 'getIntegration', tags: integrationTags,
  summary: 'Get an integration (masked config) with its references', description: SECRET_NOTE,
  permission: 'integrations.view', params: idParams, response: itemResponse('integration'),
  cli: { resource: 'integrations', verb: 'get', positional: ['id'] },
})

export const updateIntegrationEndpoint = defineEndpoint({
  method: 'PATCH', path: '/integrations/{id}', operationId: 'updateIntegration', tags: integrationTags,
  summary: 'Update an integration', description: SECRET_NOTE, permission: 'integrations.edit',
  params: idParams, body: integrationUpdateBody, response: itemResponse('integration'),
  roundTrip: { unwrap: 'integration' },
  cli: { resource: 'integrations', verb: 'update', positional: ['id'] },
})

export const deleteIntegrationEndpoint = defineEndpoint({
  method: 'DELETE', path: '/integrations/{id}', operationId: 'deleteIntegration', tags: integrationTags,
  summary: 'Delete an integration and its references', permission: 'integrations.delete',
  params: idParams, response: deletedResponse,
  cli: { resource: 'integrations', verb: 'delete', positional: ['id'] },
})

export const testIntegrationEndpoint = defineEndpoint({
  method: 'POST', path: '/integrations/{id}/test', operationId: 'testIntegration', tags: integrationTags,
  summary: 'Test the connection (GET base URL with the configured auth)', permission: 'integrations.test',
  params: idParams, response: testResult.extend({ http_status: z.number().int().nullable() }),
  cli: { resource: 'integrations', verb: 'test', positional: ['id'] },
})

export const importOpenApiEndpoint = defineEndpoint({
  method: 'POST', path: '/integrations/import-openapi', operationId: 'importOpenApiIntegration', tags: integrationTags,
  summary: 'Create an integration with one reference per operation from an OpenAPI 2/3 or Postman document',
  description: 'Body is either `{ spec, name?, base_url?, auth_type?, auth_config?, selected_reference_indexes?, tags? }` or the raw document (overrides via query).',
  permission: 'integrations.create',
  query: importOpenApiQuery, body: importOpenApiBody, successStatus: 201,
  response: z.looseObject({
    integration: looseObject,
    references_created: z.number().int(),
    imported_reference_names: z.array(z.string()),
  }),
  cli: { resource: 'integrations', verb: 'import-openapi' },
})

export const listIntegrationReferencesEndpoint = defineEndpoint({
  method: 'GET', path: '/integrations/{id}/references', operationId: 'listIntegrationReferences', tags: referenceTags,
  summary: "List an integration's references", permission: 'integrations.view',
  params: idParams, query: paginationQuery.extend({ search: z.string().optional().describe('Name/description contains') }),
  response: listResponse('references'), listKey: 'references',
  cli: { resource: 'references', verb: 'list', positional: ['id'] },
})

export const createReferenceEndpoint = defineEndpoint({
  method: 'POST', path: '/integrations/{id}/references', operationId: 'createReference', tags: referenceTags,
  summary: 'Create a reference on an integration', permission: 'integrations.manage_references',
  params: idParams, body: referenceCreateBody, successStatus: 201, response: itemResponse('reference'),
  cli: { resource: 'references', verb: 'create', positional: ['id'] },
})

export const getReferenceEndpoint = defineEndpoint({
  method: 'GET', path: '/references/{id}', operationId: 'getReference', tags: referenceTags,
  summary: 'Get a reference (request config, inputs, outputs, response model)', permission: 'integrations.view',
  params: idParams, response: itemResponse('reference'),
  cli: { resource: 'references', verb: 'get', positional: ['id'] },
})

export const updateReferenceEndpoint = defineEndpoint({
  method: 'PATCH', path: '/references/{id}', operationId: 'updateReference', tags: referenceTags,
  summary: 'Update a reference', permission: 'integrations.manage_references',
  params: idParams, body: referenceUpdateBody, response: itemResponse('reference'),
  roundTrip: { unwrap: 'reference' },
  cli: { resource: 'references', verb: 'update', positional: ['id'] },
})

export const deleteReferenceEndpoint = defineEndpoint({
  method: 'DELETE', path: '/references/{id}', operationId: 'deleteReference', tags: referenceTags,
  summary: 'Delete a reference', permission: 'integrations.manage_references',
  params: idParams, response: deletedResponse,
  cli: { resource: 'references', verb: 'delete', positional: ['id'] },
})

export const bulkDeleteReferencesEndpoint = defineEndpoint({
  method: 'POST', path: '/references/bulk-delete', operationId: 'bulkDeleteReferences', tags: referenceTags,
  summary: 'Delete several references (ids outside the workspace are ignored)', permission: 'integrations.manage_references',
  body: referenceBulkDeleteBody,
  response: z.looseObject({ deleted: z.number().int(), ids: z.array(z.string()) }),
  cli: { resource: 'references', verb: 'bulk-delete' },
  async: true,
})

export const executeReferenceEndpoint = defineEndpoint({
  method: 'POST', path: '/references/{id}/execute', operationId: 'executeReference', tags: referenceTags,
  summary: 'Call a reference with input values', permission: 'integrations.test',
  params: idParams, body: referenceExecuteBody,
  response: z.looseObject({ status: z.number().int(), data: z.any(), headers: z.record(z.string(), z.string()).optional(), response_schema: looseObject.optional() }),
  cli: { resource: 'references', verb: 'execute', positional: ['id'] },
})

export const listObjectsEndpoint = defineEndpoint({
  method: 'GET', path: '/objects', operationId: 'listObjects', tags: objectTags,
  summary: 'List composite objects with their sources', permission: 'integrations.view',
  query: paginationQuery, response: listResponse('objects'), listKey: 'objects',
  cli: { resource: 'objects', verb: 'list' },
})

export const createObjectEndpoint = defineEndpoint({
  method: 'POST', path: '/objects', operationId: 'createObject', tags: objectTags,
  summary: 'Create a composite object (also generates its callable reference)', permission: 'integrations.edit',
  body: objectCreateBody, successStatus: 201,
  response: z.looseObject({ object: looseObject, sources: z.array(looseObject), generated_reference: looseObject.nullable() }),
  cli: { resource: 'objects', verb: 'create' },
})

export const getObjectEndpoint = defineEndpoint({
  method: 'GET', path: '/objects/{id}', operationId: 'getObject', tags: objectTags,
  summary: 'Get a composite object with its sources and generated references', permission: 'integrations.view',
  params: idParams, response: itemResponse('object'),
  cli: { resource: 'objects', verb: 'get', positional: ['id'] },
})

export const updateObjectEndpoint = defineEndpoint({
  method: 'PATCH', path: '/objects/{id}', operationId: 'updateObject', tags: objectTags,
  summary: 'Update a composite object (name, description, or a full replacement source list)', permission: 'integrations.edit',
  params: idParams, body: objectUpdateBody, response: itemResponse('object'),
  roundTrip: { unwrap: 'object' },
  cli: { resource: 'objects', verb: 'update', positional: ['id'] },
})

export const deleteObjectEndpoint = defineEndpoint({
  method: 'DELETE', path: '/objects/{id}', operationId: 'deleteObject', tags: objectTags,
  summary: 'Delete a composite object, its sources and generated references', permission: 'integrations.delete',
  params: idParams, response: deletedResponse.extend({ deleted_reference_count: z.number().int() }),
  cli: { resource: 'objects', verb: 'delete', positional: ['id'] },
})

export const connectorCatalogEndpoint = defineEndpoint({
  method: 'GET', path: '/connectors/catalog', operationId: 'getConnectorCatalog', tags: connectorTags,
  summary: 'List the built-in connector templates', permission: 'integrations.view',
  query: z.object({ category: connectorCategorySchema.optional() }),
  response: z.looseObject({ connectors: z.array(looseObject), count: z.number().int() }),
  cli: { resource: 'connectors', verb: 'catalog' },
})

export const listConnectorsEndpoint = defineEndpoint({
  method: 'GET', path: '/connectors', operationId: 'listConnectors', tags: connectorTags,
  summary: 'List enabled connectors (credentials masked)', permission: 'integrations.view',
  query: paginationQuery.extend({
    enabled: booleanFlag('Filter by enabled flag'),
    connector_key: z.string().optional().describe('Catalog key'),
  }),
  response: listResponse('connectors'), listKey: 'connectors',
  cli: { resource: 'connectors', verb: 'list' },
})

export const createConnectorEndpoint = defineEndpoint({
  method: 'POST', path: '/connectors', operationId: 'createConnector', tags: connectorTags,
  summary: 'Enable a connector: creates its integration and templated references', permission: 'integrations.create',
  body: connectorCreateBody, successStatus: 201,
  response: z.looseObject({ connector: looseObject, integration: looseObject, references_created: z.number().int() }),
  cli: { resource: 'connectors', verb: 'create' },
})

export const getConnectorEndpoint = defineEndpoint({
  method: 'GET', path: '/connectors/{id}', operationId: 'getConnector', tags: connectorTags,
  summary: 'Get a connector with its template, integration and references', description: SECRET_NOTE,
  permission: 'integrations.view', params: idParams,
  response: z.looseObject({ connector: looseObject, connector_template: looseObject.nullable(), integration: looseObject.nullable(), references: z.array(looseObject) }),
  cli: { resource: 'connectors', verb: 'get', positional: ['id'] },
})

export const updateConnectorEndpoint = defineEndpoint({
  method: 'PATCH', path: '/connectors/{id}', operationId: 'updateConnector', tags: connectorTags,
  summary: 'Update connector config/credentials (merged) and keep its integration in step', description: SECRET_NOTE,
  permission: 'integrations.edit', params: idParams, body: connectorUpdateBody, response: itemResponse('connector'),
  roundTrip: { unwrap: 'connector' },
  cli: { resource: 'connectors', verb: 'update', positional: ['id'] },
})

export const deleteConnectorEndpoint = defineEndpoint({
  method: 'DELETE', path: '/connectors/{id}', operationId: 'deleteConnector', tags: connectorTags,
  summary: 'Delete a connector, its integration and generated references', permission: 'integrations.delete',
  params: idParams, response: deletedResponse.extend({ integration_id: z.string().nullable() }),
  cli: { resource: 'connectors', verb: 'delete', positional: ['id'] },
})

export const testConnectorEndpoint = defineEndpoint({
  method: 'POST', path: '/connectors/{id}/test', operationId: 'testConnector', tags: connectorTags,
  summary: 'Run the connector preflight and probe with its stored credentials', permission: 'integrations.test',
  params: idParams, response: testResult,
  cli: { resource: 'connectors', verb: 'test', positional: ['id'] },
})

export const enableConnectorEndpoint = defineEndpoint({
  method: 'POST', path: '/connectors/{id}/enable', operationId: 'enableConnector', tags: connectorTags,
  summary: 'Re-enable a connector and its integration', permission: 'integrations.edit',
  params: idParams, response: z.looseObject({ id: z.string(), enabled: z.boolean() }),
  cli: { resource: 'connectors', verb: 'enable', positional: ['id'] },
})

export const disableConnectorEndpoint = defineEndpoint({
  method: 'POST', path: '/connectors/{id}/disable', operationId: 'disableConnector', tags: connectorTags,
  summary: 'Disable a connector and deactivate its integration', permission: 'integrations.edit',
  params: idParams, response: z.looseObject({ id: z.string(), enabled: z.boolean() }),
  cli: { resource: 'connectors', verb: 'disable', positional: ['id'] },
})

export const regenerateConnectorReferencesEndpoint = defineEndpoint({
  method: 'POST', path: '/connectors/{id}/regenerate-references', operationId: 'regenerateConnectorReferences', tags: connectorTags,
  summary: 'Replace the generated references with the current template set', permission: 'integrations.manage_references',
  params: idParams, response: z.looseObject({ id: z.string(), count: z.number().int() }),
  cli: { resource: 'connectors', verb: 'regenerate-references', positional: ['id'] },
})

export const integrationEndpoints = [
  listIntegrationsEndpoint, createIntegrationEndpoint, importOpenApiEndpoint, getIntegrationEndpoint,
  updateIntegrationEndpoint, deleteIntegrationEndpoint, testIntegrationEndpoint,
  listIntegrationReferencesEndpoint, createReferenceEndpoint, getReferenceEndpoint, updateReferenceEndpoint,
  deleteReferenceEndpoint, bulkDeleteReferencesEndpoint, executeReferenceEndpoint,
  listObjectsEndpoint, createObjectEndpoint, getObjectEndpoint, updateObjectEndpoint, deleteObjectEndpoint,
  connectorCatalogEndpoint, listConnectorsEndpoint, createConnectorEndpoint, getConnectorEndpoint,
  updateConnectorEndpoint, deleteConnectorEndpoint, testConnectorEndpoint, enableConnectorEndpoint,
  disableConnectorEndpoint, regenerateConnectorReferencesEndpoint,
]
