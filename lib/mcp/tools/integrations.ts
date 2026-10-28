import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { fromMcpContext, type ServiceContext } from '@/lib/services/context'
import * as integrations from '@/lib/services/integrations'
import * as references from '@/lib/services/references'
import * as objects from '@/lib/services/objects'
import * as connectors from '@/lib/services/connectors'
import { messageOf } from './_util'

/*
 * Integration, reference, object and connector tools. Thin wrappers over
 * lib/services/*: the services own tenant filtering, secret encryption and
 * masking, audit and GitHub-sync capture (mutating tools here are listed in
 * AUDITED_IN_SERVICE in ../authz). Read tools need integrations.view
 * (READ_TOOL_PERMISSIONS in ../authz), enforced again by the services.
 */

type Parsed<T> = { ok: true; value: T | null } | { ok: false; error: string }

/** JSON-string tool argument → value (null when absent). */
function parseJsonArg<T>(value: string | undefined, fieldName: string): Parsed<T> {
  if (value == null) return { ok: true, value: null }
  try {
    return { ok: true, value: JSON.parse(value) as T }
  } catch {
    return { ok: false, error: `${fieldName} must be a valid JSON string` }
  }
}

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

export function registerIntegrationTools(server: McpToolServer, ctx: McpContext) {
  const writeCtx = (): ServiceContext => fromMcpContext(ctx)
  const readCtx = (): ServiceContext => fromMcpContext(ctx) // reads are gated too (READ_TOOL_PERMISSIONS)

  server.tool('connectors_list', 'List available built-in connector templates that MCP can use to create integrations and auto-generate references.', {
    category: z.enum(['cloud', 'communication', 'ai', 'payments', 'productivity', 'database']).optional().describe('Optional connector category filter'),
  }, async (args) => run(async () => connectors.listConnectorCatalog(readCtx(), { category: args.category })))

  server.tool('connectors_list_installed', 'List the connectors configured in this workspace (tenant connectors: key, display name, enabled flag, masked config, generated integration). connectors_list lists the catalog of templates instead.', {
    enabled: z.boolean().optional().describe('Filter by enabled flag'),
    connector_key: z.string().optional().describe('Filter by catalog key'),
  }, async (args) => run(() => connectors.listConnectors(readCtx(), { enabled: args.enabled, connectorKey: args.connector_key }, { limit: null, offset: 0 })))

  server.tool('connectors_get', 'Get a connector-backed integration with its saved config, generated integration, and generated references. Use this before updating or regenerating a connector so prompt-driven changes stay aligned with the connector template.', {
    connector_id: z.string().describe('Tenant connector ID'),
  }, async (args) => run(async () => connectors.getConnector(readCtx(), args.connector_id)))

  server.tool('integrations_list', 'List integrations and connector-backed integrations available in the tenant. These power callable references for workflows, agents, and MCP-driven automation.', {
    active: z.boolean().optional(),
  }, async (args) => run(async () => {
    const { integrations: rows } = await integrations.listIntegrations(readCtx(), { active: args.active }, { limit: null, offset: 0 })
    return { integrations: rows }
  }))

  server.tool('integrations_get', 'Get integration details (config with credentials masked as "__SECRET__") with references so MCP can inspect the callable surface before wiring workflows, agents, or reports. The config can be edited and sent back to integrations_update; "__SECRET__" keeps a stored credential.', {
    integration_id: z.string().describe('Integration ID'),
  }, async (args) => run(async () => {
    // Same masked config as GET /api/v1/integrations/{id}, so an MCP client can edit and send it back.
    const integration: Record<string, unknown> = await integrations.getIntegration(readCtx(), args.integration_id)
    return integration
  }))

  server.tool('references_list', 'List integration references across the tenant. References are the callable operations used by workflow call_reference nodes and agent tools.', {
    integration_id: z.string().optional().describe('Filter references to a single integration'),
    search: z.string().optional().describe('Search reference names and descriptions'),
    limit: z.number().optional().describe('Max results (default 100)'),
  }, async (args) => run(async () => {
    const { references: rows } = await references.listReferences(
      readCtx(),
      { integrationId: args.integration_id, search: args.search },
      { limit: Math.min(args.limit ?? 100, 200), offset: 0 },
    )
    return { references: rows, count: rows.length }
  }))

  server.tool('references_get', 'Get a single integration reference with its request config, inputs, outputs, and parent integration details.', {
    reference_id: z.string().describe('Reference ID'),
  }, async (args) => run(async () => references.getReference(readCtx(), args.reference_id)))

  server.tool('integrations_create', 'Create a new integration. Integrations become the parent container for callable references that MCP can use in workflows, agents, and composite objects.', {
    name: z.string().describe('Integration name'),
    type: z.enum(['rest_api', 'odata', 'database', 'webhook']).describe('Integration type'),
    config: z.string().describe('JSON string. For REST/OData/webhook: {"base_url": "https://...", "auth_type": "none"|"bearer"|"api_key"|"basic"|"oauth2", "auth_config": {"token": "...", "key_name": "...", "key_value": "...", "username": "...", "password": "..."}, "headers": {}}. For database: {"db_config": {"db_type": "postgres"|"mssql", "host": "...", "port": 5432, "database": "...", "username": "...", "password": "...", "ssl": true}}'),
  }, async (args) => {
    const configArg = parseJsonArg<Record<string, unknown>>(args.config, 'config')
    if (!configArg.ok) return mcpErr(configArg.error)
    const config = configArg.value
    return run(async () => {
      const integration = await integrations.createIntegration(writeCtx(), { name: args.name, type: args.type, config: config ?? {} })
      return { created: true, integration }
    })
  })

  server.tool('integrations_create_bundle', 'Create an integration and its references in one MCP call. Useful for API or database setups where MCP receives the integration config plus a reference list and should provision the whole integration surface at once.', {
    name: z.string().describe('Integration name'),
    type: z.enum(['rest_api', 'odata', 'database', 'webhook']).describe('Integration type'),
    config: z.string().describe('JSON string integration config'),
    references: z.string().optional().describe('JSON string array of references to create immediately. Each reference can include name, description, method, path_template/pathTemplate, body_template/bodyTemplate, headers, tags, inputs, outputs, or request_config.'),
    tags: z.string().optional().describe('JSON string array of integration tags'),
  }, async (args) => {
    const configArg = parseJsonArg<Record<string, unknown>>(args.config, 'config')
    if (!configArg.ok) return mcpErr(configArg.error)
    const config = configArg.value
    const refsArg = parseJsonArg<references.ReferenceInput[]>(args.references, 'references')
    if (!refsArg.ok) return mcpErr(refsArg.error)
    const refs = refsArg.value
    const tagsArg = parseJsonArg<string[]>(args.tags, 'tags')
    if (!tagsArg.ok) return mcpErr(tagsArg.error)
    const tags = tagsArg.value
    return run(async () => {
      const result = await integrations.createIntegrationWithReferences(writeCtx(), {
        name: args.name,
        type: args.type,
        config: config ?? {},
        tags: tags ?? null,
        references: Array.isArray(refs) ? refs : [],
      })
      return { created: true, integration: result.integration, references_created: result.references_created }
    })
  })

  server.tool('connectors_create', 'Create a connector-backed integration from a built-in connector template. MCP provides connector config and credentials; the server creates the integration, tenant connector record, and all templated references automatically.', {
    connector_key: z.string().describe('Connector key from connectors_list'),
    display_name: z.string().optional().describe('Friendly connector display name'),
    config: z.string().optional().describe('JSON string of connector configuration fields'),
    credentials: z.string().optional().describe('JSON string of connector credentials/secrets'),
  }, async (args) => {
    const configArg = parseJsonArg<Record<string, unknown>>(args.config, 'config')
    if (!configArg.ok) return mcpErr(configArg.error)
    const config = configArg.value
    const credentialsArg = parseJsonArg<Record<string, unknown>>(args.credentials, 'credentials')
    if (!credentialsArg.ok) return mcpErr(credentialsArg.error)
    const credentials = credentialsArg.value
    return run(async () => {
      const result = await connectors.createConnector(writeCtx(), {
        connector_key: args.connector_key,
        display_name: args.display_name,
        config: config ?? {},
        credentials: credentials ?? {},
      })
      return { created: true, ...result }
    })
  })

  server.tool('connectors_update', 'Update a connector-backed integration. MCP can change connector config, credentials, display name, enabled state, and optionally regenerate the templated references so the prompt-driven integration surface stays aligned to the connector definition.', {
    connector_id: z.string().describe('Tenant connector ID'),
    display_name: z.string().optional().describe('Updated connector display name'),
    config: z.string().optional().describe('JSON string of connector configuration updates or full replacement'),
    credentials: z.string().optional().describe('JSON string of connector credential updates or full replacement'),
    enabled: z.boolean().optional().describe('Enable or disable the connector and its backing integration'),
    regenerate_references: z.boolean().optional().describe('When true, replace generated references from the current connector template'),
  }, async (args) => {
    const configArg = parseJsonArg<Record<string, unknown>>(args.config, 'config')
    if (!configArg.ok) return mcpErr(configArg.error)
    const config = configArg.value
    const credentialsArg = parseJsonArg<Record<string, unknown>>(args.credentials, 'credentials')
    if (!credentialsArg.ok) return mcpErr(credentialsArg.error)
    const credentials = credentialsArg.value
    return run(async () => {
      const result = await connectors.updateConnector(writeCtx(), args.connector_id, {
        display_name: args.display_name,
        config: config ?? undefined,
        credentials: credentials ?? undefined,
        enabled: args.enabled,
        regenerate_references: args.regenerate_references,
      }, { mode: 'merge' })
      return {
        updated: true,
        connector_id: args.connector_id,
        display_name: result.display_name,
        enabled: result.enabled,
        references_regenerated: result.references_regenerated,
      }
    })
  })

  server.tool('connectors_test', 'Test a connector-backed integration using the connector-specific probe flow. This validates preflight rules, auth shape, and a real read-only capability of the target service.', {
    connector_id: z.string().describe('Tenant connector ID'),
  }, async (args) => run(async () => connectors.testSavedConnector(writeCtx(), args.connector_id)))

  server.tool('connectors_delete', 'Delete a connector-backed integration including its generated references, backing integration record, and connector record.', {
    connector_id: z.string().describe('Tenant connector ID'),
  }, async (args) => run(async () => {
    const result = await connectors.deleteConnector(writeCtx(), args.connector_id)
    return { deleted: true, connector_id: args.connector_id, integration_id: result.integration_id }
  }))

  server.tool('integrations_import_api_spec', 'Create an API integration and references from an OpenAPI 2.0/3.x or Postman collection document. MCP sends the spec content and optional overrides; the server parses it, creates the integration, and provisions the selected references.', {
    spec_content: z.string().describe('Raw OpenAPI/Swagger/Postman content in JSON or YAML'),
    name_override: z.string().optional().describe('Optional integration name override'),
    base_url_override: z.string().optional().describe('Optional base URL override'),
    auth_type_override: z.enum(['none', 'api_key', 'bearer', 'basic']).optional().describe('Optional auth type override'),
    auth_config_override: z.string().optional().describe('JSON string override for auth config'),
    selected_reference_indexes: z.string().optional().describe('JSON string array of zero-based reference indexes to import. Omit to import all.'),
    tags: z.string().optional().describe('JSON string array of integration tags'),
  }, async (args) => {
    const authConfigArg = parseJsonArg<Record<string, unknown>>(args.auth_config_override, 'auth_config_override')
    if (!authConfigArg.ok) return mcpErr(authConfigArg.error)
    const authConfig = authConfigArg.value
    const indexesArg = parseJsonArg<number[]>(args.selected_reference_indexes, 'selected_reference_indexes')
    if (!indexesArg.ok) return mcpErr(indexesArg.error)
    const indexes = indexesArg.value
    const tagsArg = parseJsonArg<string[]>(args.tags, 'tags')
    if (!tagsArg.ok) return mcpErr(tagsArg.error)
    const tags = tagsArg.value
    return run(async () => {
      const result = await integrations.importOpenApi(writeCtx(), {
        spec: args.spec_content,
        name: args.name_override,
        base_url: args.base_url_override,
        auth_type: args.auth_type_override,
        auth_config: authConfig ?? undefined,
        selected_reference_indexes: Array.isArray(indexes) ? indexes : undefined,
        tags: tags ?? undefined,
      })
      return {
        created: true,
        integration: result.integration,
        references_created: result.references_created,
        imported_reference_names: result.imported_reference_names,
      }
    })
  })

  server.tool('integrations_update', 'Update an existing integration, including its configuration and active state.', {
    integration_id: z.string().describe('Integration ID'),
    name: z.string().optional(),
    config: z.string().optional().describe('JSON string of the full config (as returned by integrations_get; "__SECRET__" keeps a stored credential)'),
    is_active: z.boolean().optional(),
  }, async (args) => {
    const configArg = parseJsonArg<Record<string, unknown>>(args.config, 'config')
    if (!configArg.ok) return mcpErr(configArg.error)
    const config = configArg.value
    return run(async () => {
      await integrations.updateIntegration(writeCtx(), args.integration_id, {
        name: args.name,
        config: config ?? undefined,
        is_active: args.is_active,
      })
      return { updated: true, integration_id: args.integration_id }
    })
  })

  server.tool('integrations_delete', 'Delete an integration by ID.', {
    integration_id: z.string().describe('Integration ID'),
  }, async (args) => run(async () => {
    await integrations.deleteIntegration(writeCtx(), args.integration_id)
    return { deleted: true, integration_id: args.integration_id }
  }))

  server.tool('integrations_test', 'Test an integration connection and return the current connectivity result.', {
    integration_id: z.string().describe('Integration ID'),
  }, async (args) => {
    try {
      const result = await integrations.testIntegration(writeCtx(), args.integration_id)
      if (!result.reachable) return mcpErr(`Connection failed: ${result.message}`)
      return mcpOk({ status: result.status, http_status: result.http_status })
    } catch (error) {
      return mcpErr(messageOf(error, 'Integration not found'))
    }
  })

  server.tool('references_create', 'Create an API reference for an integration. References can be called in workflow call_reference nodes and agent tooling.', {
    integration_id: z.string().describe('Integration ID this reference belongs to'),
    name: z.string().describe('Reference name'),
    description: z.string().optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'QUERY', 'EXEC', 'INSERT']).describe('HTTP or database method'),
    request_config: z.string().describe('JSON string: {"method": "GET"|"POST"|"PUT"|"DELETE", "path_template": "/api/users/{{id}}", "body_template": "{}", "query_params": {}, "headers": {}}'),
    inputs: z.string().optional().describe('JSON string of input definitions: [{"name": "id", "type": "string", "required": true, "location": "path"}]'),
    outputs: z.string().optional().describe('JSON string of output definitions: [{"name": "user_name", "path": "data.name", "type": "string"}]'),
    response_schema: z.string().optional().describe('JSON string response model: {"root": {"type": "object", "fields": [{"name": "data", "type": "array", "items": {"type": "object", "fields": [{"name": "email", "type": "string"}]}}]}}. "null" clears it. Optional — references_get derives one from outputs, and integrations_execute_reference with capture_schema infers it from a real response.'),
    tags: z.string().optional().describe('JSON string array of tags for discovery and categorization'),
  }, async (args) => {
    const requestConfigArg = parseJsonArg<Record<string, unknown>>(args.request_config, 'request_config')
    if (!requestConfigArg.ok) return mcpErr(requestConfigArg.error)
    const requestConfig = requestConfigArg.value
    const inputsArg = parseJsonArg<unknown[]>(args.inputs, 'inputs')
    if (!inputsArg.ok) return mcpErr(inputsArg.error)
    const inputs = inputsArg.value
    const outputsArg = parseJsonArg<unknown[]>(args.outputs, 'outputs')
    if (!outputsArg.ok) return mcpErr(outputsArg.error)
    const outputs = outputsArg.value
    const tagsArg = parseJsonArg<string[]>(args.tags, 'tags')
    if (!tagsArg.ok) return mcpErr('tags must be a valid JSON string array')
    const tags = tagsArg.value
    const schemaArg = parseJsonArg<Record<string, unknown> | null>(args.response_schema, 'response_schema')
    if (!schemaArg.ok) return mcpErr(schemaArg.error)
    return run(async () => {
      const reference = await references.createReference(writeCtx(), args.integration_id, {
        response_schema: schemaArg.value ?? undefined,
        name: args.name,
        description: args.description ?? null,
        method: typeof requestConfig?.method === 'string' ? requestConfig.method : args.method,
        request_config: requestConfig ?? { path_template: '', body_template: '' },
        inputs,
        outputs,
        tags,
      })
      return { created: true, reference }
    })
  })

  server.tool('references_update', 'Update an API reference, including request config, inputs, outputs, and metadata.', {
    reference_id: z.string().describe('Reference ID'),
    name: z.string().optional(),
    description: z.string().optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
    request_config: z.string().optional().describe('JSON string: {"method": "GET"|"POST"|"PUT"|"DELETE", "path_template": "/api/users/{{id}}", "body_template": "{}", "query_params": {}, "headers": {}}'),
    inputs: z.string().optional().describe('JSON string of input definitions: [{"name": "id", "type": "string", "required": true, "location": "path"}]'),
    outputs: z.string().optional().describe('JSON string of output definitions: [{"name": "user_name", "path": "data.name", "type": "string"}]'),
    response_schema: z.string().optional().describe('JSON string response model: {"root": {"type": "object", "fields": [{"name": "data", "type": "array", "items": {"type": "object", "fields": [{"name": "email", "type": "string"}]}}]}}. "null" clears it. Optional — references_get derives one from outputs, and integrations_execute_reference with capture_schema infers it from a real response.'),
    tags: z.string().optional().describe('JSON string array of tags'),
  }, async (args) => {
    const requestConfigArg = parseJsonArg<Record<string, unknown>>(args.request_config, 'request_config')
    if (!requestConfigArg.ok) return mcpErr(requestConfigArg.error)
    const requestConfig = requestConfigArg.value
    const inputsArg = parseJsonArg<unknown[]>(args.inputs, 'inputs')
    if (!inputsArg.ok) return mcpErr(inputsArg.error)
    const inputs = inputsArg.value
    const outputsArg = parseJsonArg<unknown[]>(args.outputs, 'outputs')
    if (!outputsArg.ok) return mcpErr(outputsArg.error)
    const outputs = outputsArg.value
    const tagsArg = parseJsonArg<string[]>(args.tags, 'tags')
    if (!tagsArg.ok) return mcpErr('tags must be a valid JSON string array')
    const tags = tagsArg.value
    const schemaArg = parseJsonArg<Record<string, unknown> | null>(args.response_schema, 'response_schema')
    if (!schemaArg.ok) return mcpErr(schemaArg.error)
    return run(async () => {
      await references.updateReference(writeCtx(), args.reference_id, {
        response_schema: args.response_schema !== undefined ? schemaArg.value : undefined,
        name: args.name,
        description: args.description,
        method: args.method,
        request_config: requestConfig ?? undefined,
        inputs: inputs ?? undefined,
        outputs: outputs ?? undefined,
        tags: args.tags !== undefined ? tags : undefined,
      })
      return { updated: true, reference_id: args.reference_id }
    })
  })

  server.tool('references_delete', 'Delete an API reference by ID.', {
    reference_id: z.string().describe('Reference ID'),
  }, async (args) => run(async () => {
    await references.deleteReference(writeCtx(), args.reference_id)
    return { deleted: true, reference_id: args.reference_id }
  }))

  server.tool('references_bulk_delete', 'Delete several API references at once (all must belong to this workspace).', {
    reference_ids: z.array(z.string()).min(1).max(1000).describe('Reference IDs'),
  }, async (args) => run(() => references.bulkDeleteReferences(writeCtx(), args.reference_ids)))

  server.tool('objects_list', 'List composite objects. Objects join multiple data tables and/or references into a queryable entity and can auto-generate callable references for workflows and agents.', {
    limit: z.number().optional().describe('Max results (default 100)'),
  }, async (args) => run(async () => {
    const { objects: rows } = await objects.listObjects(readCtx(), { limit: Math.min(args.limit ?? 100, 200), offset: 0 })
    return { objects: rows, count: rows.length }
  }))

  server.tool('objects_get', 'Get a composite object with all of its join sources and any auto-generated references tied to it.', {
    object_id: z.string().describe('Object ID'),
  }, async (args) => run(async () => objects.getObject(readCtx(), args.object_id)))

  server.tool('objects_create', 'Create a composite object that joins multiple data tables and/or existing references. The first source must be primary; later sources can join to the primary or another alias using join_type, join_on_local, join_on_foreign, and join_to_alias. The object also auto-creates a base callable reference under the internal __objects__ integration.', {
    name: z.string().describe('Object name'),
    description: z.string().optional().describe('Object description'),
    sources: z.string().describe('JSON string array of object sources. Example: [{"sourceType":"table","tableId":"tbl_1","alias":"orders","isPrimary":true},{"sourceType":"table","tableId":"tbl_2","alias":"customers","isPrimary":false,"joinType":"left","joinOnLocal":"customer_id","joinOnForeign":"id","joinToAlias":"orders"}]'),
  }, async (args) => {
    const sourcesArg = parseJsonArg<unknown[]>(args.sources, 'sources')
    if (!sourcesArg.ok) return mcpErr('sources must be a valid JSON string array')
    const sources = sourcesArg.value
    return run(async () => {
      const result = await objects.createObject(writeCtx(), { name: args.name, description: args.description, sources })
      return { created: true, ...result }
    })
  })

  server.tool('objects_update', 'Update a composite object: name, description, and/or a full replacement source list (same shape as objects_create, or the sources array returned by objects_get). The generated reference is renamed and its outputs rebuilt to match.', {
    object_id: z.string().describe('Object ID'),
    name: z.string().optional().describe('New object name'),
    description: z.string().optional().describe('New description'),
    sources: z.union([z.string(), z.array(z.record(z.string(), z.any()))]).optional().describe('Full replacement sources: JSON string array or array (camelCase or snake_case keys)'),
  }, async (args) => {
    let sources: unknown
    if (typeof args.sources === 'string') {
      const parsed = parseJsonArg<unknown[]>(args.sources, 'sources')
      if (!parsed.ok) return mcpErr('sources must be a valid JSON string array')
      sources = parsed.value
    } else sources = args.sources
    return run(async () => {
      const { changed, ...object } = await objects.updateObject(writeCtx(), args.object_id, { name: args.name, description: args.description, sources })
      return { updated: changed, object }
    })
  })

  server.tool('objects_delete', 'Delete a composite object, its join sources, and any auto-generated references tied to the object.', {
    object_id: z.string().describe('Object ID'),
  }, async (args) => run(async () => {
    const result = await objects.deleteObject(writeCtx(), args.object_id)
    return { deleted: true, object_id: args.object_id, deleted_reference_count: result.deleted_reference_count }
  }))

  server.tool('integrations_execute_reference', 'Execute an integration API reference', {
    reference_id: z.string().describe('Integration reference ID'),
    inputs: z.record(z.string(), z.any()).optional().describe('Input parameters'),
    capture_schema: z.boolean().optional().describe("Fold a successful response into the reference's response model (what the workflow data picker browses) and return it"),
  }, async (args) => {
    try {
      const result: Record<string, any> = await references.executeReference(writeCtx(), args.reference_id, args.inputs ?? {}, { captureSchema: args.capture_schema === true })
      return mcpOk({ status: result.status, data: result.data, ...(result.response_schema ? { response_schema: result.response_schema } : {}) })
    } catch (err) {
      const message = messageOf(err, 'unknown error')
      return mcpErr(message.startsWith('Execution failed') ? message : `Execution failed: ${message}`)
    }
  })
}
