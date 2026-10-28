import { z } from 'zod'
import { defineEndpoint } from './registry'
import { booleanFlag, csvFilter, deletedResponse, idParams, itemResponse, listResponse, looseObject, paginationQuery } from './common'
import { isPlainObject } from '@/lib/utils/guards'

// ─── Authoring schemas (POST /workflows, PATCH /workflows/{id}) ───

// Nodes, edges and variables are loose: properties this schema doesn't name
// (editor layout hints, node-specific extras) are kept, not stripped, so a
// fetched definition survives a round trip unchanged.
export const workflowNodeSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  label: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.record(z.string(), z.any()).default({}),
  onError: z.enum(['stop', 'continue']).optional(),
  executionMode: z.enum(['sync', 'async']).optional(),
  collapsed: z.boolean().optional(),
  sectionId: z.string().optional(),
})

export const workflowEdgeSchema = z.looseObject({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
  sourcePort: z.enum(['bottom', 'left', 'right']).optional(),
})

export const workflowUserVariableSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.string().default('string').describe('string, number, boolean or object'),
  defaultValue: z.string().default(''),
  description: z.string().default(''),
  label: z.string().optional().describe('Input label in the Run dialog (default: from the name)'),
  required: z.boolean().optional().describe('Starts must supply a value unless there is a default'),
  format: z.string().optional().describe('Refines a string input: text, date, datetime, email, url or select'),
  options: z.union([z.string(), z.array(z.any())]).optional().describe('Choices of a select input (comma-separated string or array)'),
})

const triggerConfigSchema = z.record(z.string(), z.any())
  .describe('Trigger settings, e.g. schedule { cron, timezone }, webhook_received { path, method }, data_table_event { table_id, event_types }')

/** Author payload fields shared by create and update (GET /workflows/{id}/definition returns exactly these). */
const definitionFields = {
  description: z.string().nullable().optional(),
  trigger_config: triggerConfigSchema.nullable().optional(),
  swimlanes: z.array(z.any()).nullable().optional(),
  sections: z.array(z.any()).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
}

export const workflowAuthorCreateBody = z.object({
  name: z.string().min(1),
  trigger_type: z.string().default('webhook_received'),
  nodes: z.array(workflowNodeSchema).min(1),
  edges: z.array(workflowEdgeSchema).default([]),
  user_variables: z.array(workflowUserVariableSchema).default([]),
  ...definitionFields,
  is_active: z.boolean().default(false),
  publish: z.boolean().default(false).describe('Also publish version 1 (needs workflows.activate)'),
  publish_notes: z.string().optional(),
})

/** Draft update. Omitted fields are kept; fields equal to the stored value are not changes. */
export const workflowDefinitionUpdateBody = z.object({
  name: z.string().min(1).optional(),
  trigger_type: z.string().optional(),
  nodes: z.array(workflowNodeSchema).optional().describe('Replaces all nodes'),
  edges: z.array(workflowEdgeSchema).optional().describe('Replaces all edges'),
  user_variables: z.array(workflowUserVariableSchema).nullable().optional(),
  ...definitionFields,
  is_active: z.boolean().optional().describe('Changing it needs workflows.activate'),
  publish: z.boolean().default(false).describe('Publish the saved draft as a new version (needs workflows.activate)'),
  publish_notes: z.string().optional(),
})

export const workflowDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  trigger_type: z.string(),
  trigger_config: z.record(z.string(), z.any()),
  nodes: z.array(looseObject),
  edges: z.array(looseObject),
  user_variables: z.array(looseObject),
  swimlanes: z.array(z.any()),
  sections: z.array(z.any()),
  tags: z.array(z.string()),
})

/** Fields of the author payload, in the order the definition is returned. */
export const WORKFLOW_DEFINITION_FIELDS = [
  'name', 'description', 'trigger_type', 'trigger_config', 'nodes', 'edges', 'user_variables', 'swimlanes', 'sections', 'tags',
] as const

/**
 * Accept what the read endpoints return as a write body, so a fetched
 * workflow can be edited and sent back as-is:
 *   - the definition itself (GET /workflows/{id}/definition, MCP workflows_get_definition)
 *   - GET /workflows/{id}?include_definition=true → `{ workflow, definition, … }`
 *   - MCP workflows_get → the flat row (read-only columns are ignored)
 */
export function unwrapWorkflowBody(raw: unknown): unknown {
  if (!isPlainObject(raw) || !isPlainObject(raw.definition)) return raw
  const definition = raw.definition
  const meta = isPlainObject(raw.workflow) ? raw.workflow : {}
  const merged: Record<string, unknown> = {}
  for (const field of WORKFLOW_DEFINITION_FIELDS) {
    if (definition[field] !== undefined) merged[field] = definition[field]
    else if (meta[field] !== undefined) merged[field] = meta[field]
  }
  for (const key of ['is_active', 'publish', 'publish_notes']) if (raw[key] !== undefined) merged[key] = raw[key]
  return merged
}

export const workflowPublishBody = z.object({
  notes: z.string().max(2000).optional().describe('Publish notes describing what changed'),
})

// ─── Execution schemas ───

export const workflowStartBody = z.object({
  workflow_id: z.string().uuid(),
  variables: z.record(z.string(), z.any()).optional()
    .describe('Input values keyed by input name (GET /workflows/{id}/inputs lists them). Declared inputs are validated and coerced to their type; other keys pass through unchanged.'),
  async: z.boolean().default(false),
  task_id: z.string().uuid().optional(),
  priority: z.number().int().min(0).max(100).default(50),
})

const workflowInputField = z.looseObject({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'number', 'boolean', 'date', 'datetime', 'json', 'select', 'email', 'url']),
  required: z.boolean(),
  default: z.any().describe('Typed default, or null'),
  description: z.string().nullable(),
  options: z.array(z.looseObject({ value: z.string(), label: z.string() })).nullable(),
})

export const workflowEventCompleteBody = z.object({
  return_variables: z.record(z.string(), z.any()).optional(),
})

export const workflowQueueActionBody = z.object({
  action: z.enum(['cancel', 'retry']),
})

export const workflowRunActionBody = z.object({
  action: z.enum(['pause', 'resume', 'cancel']),
  return_variables: z.record(z.string(), z.any()).optional(),
  goto_node_id: z.string().optional(),
})

// ─── Live instances and migration ───

export const workflowInstancesQuery = paginationQuery.extend({
  status: z.enum(['active', 'waiting_for_event', 'paused']).optional().describe('active (default) = waiting_for_event and paused'),
  version_id: z.string().optional().describe('Only instances on this version'),
})

export const workflowInstancesMigrateBody = z.object({
  to_version_id: z.string().min(1).describe('Version the instances continue on (any version of this workflow)'),
  run_ids: z.array(z.string().min(1)).max(500).optional().describe('Instances to migrate (at most 500)'),
  from_version_id: z.string().optional().describe('Migrate every live instance on this version'),
  all_active: z.boolean().optional().describe('Migrate every live instance not already on to_version_id (500 per request; `truncated` says more remain)'),
  node_map: z.record(z.string(), z.string()).optional().describe('Current node id → node id in the target version where the instance continues'),
  default_target_node_id: z.string().optional().describe('Target node for instances whose node is not in node_map (default: the node with the same id)'),
  dry_run: z.boolean().default(false).describe('Only plan: list each instance → target node, what is closed and created, warnings'),
})

const liveInstance = z.looseObject({
  run_id: z.string(), status: z.string(), version_id: z.string().nullable(), version_number: z.number().nullable(),
  current_node_id: z.string().nullable(), current_node_label: z.string().nullable(), current_node_type: z.string().nullable(),
  waiting_since: z.string().nullable(), open_task: looseObject.nullable(),
})

const migrationPlanItem = z.looseObject({
  run_id: z.string(), ok: z.boolean(), blocked_reason: z.string().nullable(), warnings: z.array(z.string()),
  source_node_id: z.string().nullable(), target_node_id: z.string().nullable(), target_via: z.string().nullable(),
  close: looseObject, create: looseObject,
})

// ─── Endpoints ───

const tags = ['Workflows']

const toggleResponse = z.looseObject({ id: z.string(), is_active: z.boolean() })

export const deleteWorkflowEndpoint = defineEndpoint({
  method: 'DELETE', path: '/workflows/{id}', operationId: 'deleteWorkflow', tags,
  summary: 'Delete a workflow (queued: its versions, runs and spawned tasks go with it)', permission: 'workflows.delete',
  params: idParams, response: deletedResponse,
  cli: { resource: 'workflows', verb: 'delete', positional: ['id'] },
})

export const activateWorkflowEndpoint = defineEndpoint({
  method: 'POST', path: '/workflows/{id}/activate', operationId: 'activateWorkflow', tags,
  summary: 'Activate a workflow (it responds to its trigger)', permission: 'workflows.activate',
  params: idParams, response: toggleResponse,
  cli: { resource: 'workflows', verb: 'activate', positional: ['id'] },
})

export const deactivateWorkflowEndpoint = defineEndpoint({
  method: 'POST', path: '/workflows/{id}/deactivate', operationId: 'deactivateWorkflow', tags,
  summary: 'Deactivate a workflow (its trigger is paused)', permission: 'workflows.activate',
  params: idParams, response: toggleResponse,
  cli: { resource: 'workflows', verb: 'deactivate', positional: ['id'] },
})

export const listWorkflowVersionsEndpoint = defineEndpoint({
  method: 'GET', path: '/workflows/{id}/versions', operationId: 'listWorkflowVersions', tags,
  summary: 'List published versions of a workflow (newest first)', permission: 'workflows.view',
  description: 'Each version carries `active_instances`: its live (waiting or paused) runs.',
  params: idParams, query: paginationQuery,
  response: listResponse('versions'), listKey: 'versions',
  cli: { resource: 'workflows', verb: 'versions', positional: ['id'] },
})

export const getWorkflowVersionEndpoint = defineEndpoint({
  method: 'GET', path: '/workflows/{id}/versions/{versionId}', operationId: 'getWorkflowVersion', tags,
  summary: 'Get one published version with its full definition', permission: 'workflows.view',
  params: z.object({ id: z.string().describe('Workflow id'), versionId: z.string().describe('Version id') }),
  response: itemResponse('version'),
  cli: { resource: 'workflows', verb: 'version', positional: ['id', 'versionId'] },
})

export const getWorkflowDefinitionEndpoint = defineEndpoint({
  method: 'GET', path: '/workflows/{id}/definition', operationId: 'getWorkflowDefinition', tags,
  summary: 'Get the draft definition in author-payload shape (edit it and send it back to PATCH /workflows/{id})',
  permission: 'workflows.view', params: idParams, response: workflowDefinitionSchema,
  cli: { resource: 'workflows', verb: 'definition', positional: ['id'] },
})

export const updateWorkflowDefinitionEndpoint = defineEndpoint({
  method: 'PATCH', path: '/workflows/{id}', operationId: 'updateWorkflowDefinition', tags,
  summary: 'Save draft changes to a workflow (publish separately, or with publish: true)',
  description: 'Omitted fields are kept and fields equal to the stored value are not changes (changed: false). Runs keep using the published version until the draft is published.',
  permission: 'workflows.edit', params: idParams, body: workflowDefinitionUpdateBody,
  response: z.looseObject({ workflow_id: z.string(), changed: z.boolean(), updated_fields: z.array(z.string()), published: z.boolean() }),
  roundTrip: { normalize: unwrapWorkflowBody },
  cli: { resource: 'workflows', verb: 'update', positional: ['id'] },
})

export const publishWorkflowEndpoint = defineEndpoint({
  method: 'POST', path: '/workflows/{id}/publish', operationId: 'publishWorkflow', tags,
  summary: 'Publish the draft as a new version (runs use it) and activate the workflow', permission: 'workflows.activate',
  params: idParams, body: workflowPublishBody,
  response: z.looseObject({ workflow_id: z.string(), published: z.literal(true), version_number: z.number().int(), version_id: z.string() }),
  cli: { resource: 'workflows', verb: 'publish', positional: ['id'] },
})

export const createWorkflowEndpoint = defineEndpoint({
  method: 'POST', path: '/workflows', operationId: 'createWorkflow', tags,
  summary: 'Create a workflow from nodes and edges', permission: 'workflows.edit',
  description: 'workflows.create is also accepted. A definition fetched from GET /workflows/{id}/definition creates a copy.',
  body: workflowAuthorCreateBody, successStatus: 201,
  response: z.looseObject({ workflow_id: z.string(), name: z.string(), published: z.boolean() }),
  roundTrip: { normalize: unwrapWorkflowBody },
  cli: { resource: 'workflows', verb: 'create' },
})

export const listWorkflowInstancesEndpoint = defineEndpoint({
  method: 'GET', path: '/workflows/{id}/instances', operationId: 'listWorkflowInstances', tags,
  summary: 'List live instances (waiting or paused runs) with their current node and version',
  description: 'Each instance has its current node, version, waiting-since time and open task (with assignee). `versions` counts live instances per version; `on_older_versions` counts those not on the published version.',
  permission: 'workflows.view_runs',
  params: idParams, query: workflowInstancesQuery,
  response: z.looseObject({
    instances: z.array(liveInstance), total: z.number().int(),
    published_version_id: z.string().nullable(),
    versions: z.array(z.looseObject({ version_id: z.string().nullable(), version_number: z.number().nullable(), is_published: z.boolean(), instances: z.number().int() })),
    on_older_versions: z.number().int(),
  }),
  listKey: 'instances',
  cli: { resource: 'workflows', verb: 'instances', positional: ['id'] },
})

export const migrateWorkflowInstancesEndpoint = defineEndpoint({
  method: 'POST', path: '/workflows/{id}/instances/migrate', operationId: 'migrateWorkflowInstances', tags,
  summary: 'Migrate live instances to another version (or dry-run the plan)',
  description: 'Each instance is closed out (status `migrated`, open tasks cancelled, queued resumes dropped) and a new run starts on the target version at the chosen node with the same variables, trace and task (a User Task there creates a fresh task). Target node per instance: node_map[current node] → default_target_node_id → the node with the same id. Results are per instance; an instance that changed since planning is reported as a conflict and left alone.',
  permission: 'workflows.manage_runs',
  params: idParams, body: workflowInstancesMigrateBody,
  response: z.looseObject({
    dry_run: z.boolean(),
    plan: z.looseObject({ to_version: looseObject, items: z.array(migrationPlanItem), summary: looseObject, truncated: z.boolean() }),
    results: z.array(z.looseObject({ run_id: z.string(), ok: z.boolean(), conflict: z.boolean().optional(), error: z.string().optional(), new_run_id: z.string().optional(), new_status: z.string().optional() })),
    summary: z.looseObject({ migrated: z.number().int(), skipped: z.number().int(), failed: z.number().int() }),
  }),
  cli: { resource: 'workflows', verb: 'migrate-instances', positional: ['id'] },
  async: true,
})

export const startWorkflowEndpoint = defineEndpoint({
  method: 'POST', path: '/workflows/start', operationId: 'startWorkflow', tags,
  summary: 'Start a workflow run (sync, or async via the queue)', permission: 'workflows.activate',
  description: 'Runs the published version (the draft if never published). `variables` are checked against the workflow inputs (GET /workflows/{id}/inputs): a missing required input or a value of the wrong type is a 400 with one `details` entry per field; values are coerced (e.g. "42" → 42 for a number input). Keys that are not declared inputs pass through and are listed in `warnings`. Async starts answer 202 with `job_id`.',
  body: workflowStartBody,
  response: z.looseObject({
    mode: z.enum(['sync', 'async']), run_id: z.string().nullable().optional(), job_id: z.string().optional(),
    status: z.string().optional(), warnings: z.array(z.string()).optional(),
  }),
  cli: { resource: 'workflows', verb: 'start' },
})

export const getWorkflowInputsEndpoint = defineEndpoint({
  method: 'GET', path: '/workflows/{id}/inputs', operationId: 'getWorkflowInputs', tags,
  summary: 'Get the input parameters a workflow run accepts',
  description: 'Fields come from the published version\'s workflow variables (the draft\'s when never published; `source` says which). Each field has key, label, type (text, number, boolean, date, datetime, json, select, email, url), required, default, description and options (select).',
  permission: 'workflows.view',
  params: idParams,
  response: z.looseObject({
    workflow_id: z.string(), workflow_name: z.string(), is_active: z.boolean(), published: z.boolean(),
    source: z.enum(['published', 'draft']), version_id: z.string().nullable(), version_number: z.number().nullable(),
    fields: z.array(workflowInputField),
    start_form: z.looseObject({
      layout: z.looseObject({ rows: z.array(z.looseObject({ columns: z.number().int(), cells: z.array(z.looseObject({ field_key: z.string(), span: z.number().int() })) })) }).nullable(),
      theme: z.record(z.string(), z.unknown()).nullable(),
    }).nullable().optional().describe('The start form designed in the form designer: grid rows (1-4 columns, cells reference field keys) and the resolved mini theme. Null for the plain one-column form.'),
  }),
  listKey: 'fields',
  cli: { resource: 'workflows', verb: 'inputs', positional: ['id'] },
})

export const workflowEndpoints = [
  defineEndpoint({
    method: 'GET', path: '/workflows', operationId: 'listWorkflows', tags,
    summary: 'List workflows', permission: 'workflows.view',
    query: paginationQuery.extend({ active: booleanFlag('Only active workflows (default true; pass false for all)') }),
    response: listResponse('workflows'), listKey: 'workflows',
    cli: { resource: 'workflows', verb: 'list' },
  }),
  defineEndpoint({
    method: 'GET', path: '/workflows/{id}', operationId: 'getWorkflow', tags,
    summary: 'Get a workflow with its recent runs', permission: 'workflows.view',
    description: 'With include_definition=true, `definition` is the author payload (as GET /workflows/{id}/definition); the whole response is accepted by PATCH /workflows/{id}.',
    params: idParams,
    query: z.object({
      run_id: z.string().optional().describe('Include detail for this run'),
      include_logs: booleanFlag('Include node logs for the selected run'),
      include_definition: booleanFlag('Include the draft definition (author payload)'),
    }),
    response: z.looseObject({ workflow: looseObject, current_run: z.any(), recent_runs: z.array(looseObject), definition: looseObject.optional() }),
    cli: { resource: 'workflows', verb: 'get', positional: ['id'] },
  }),
  createWorkflowEndpoint,
  getWorkflowDefinitionEndpoint,
  updateWorkflowDefinitionEndpoint,
  publishWorkflowEndpoint,
  startWorkflowEndpoint,
  getWorkflowInputsEndpoint,
  defineEndpoint({
    method: 'POST', path: '/workflows/events/{id}/complete', operationId: 'completeWorkflowEvent', tags,
    summary: 'Resume a run waiting on an external event', permission: 'workflows.activate',
    params: idParams, body: workflowEventCompleteBody,
    response: z.looseObject({ run_id: z.string(), status: z.string() }),
    cli: { resource: 'events', verb: 'complete', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'GET', path: '/workflows/runs', operationId: 'listWorkflowRuns', tags,
    summary: 'List workflow runs', permission: 'workflows.view_runs',
    query: paginationQuery.extend({
      workflow_id: z.string().optional(),
      version_id: z.string().optional().describe('Only runs of this workflow version'),
      status: csvFilter('Run statuses (running, waiting_for_event, paused, completed, failed, migrated)'),
    }),
    response: listResponse('runs'), listKey: 'runs',
    cli: { resource: 'runs', verb: 'list' },
  }),
  defineEndpoint({
    method: 'GET', path: '/workflows/runs/{id}', operationId: 'getWorkflowRun', tags,
    summary: 'Get a workflow run with its logs', permission: 'workflows.view_runs',
    params: idParams,
    response: z.looseObject({ run: looseObject, logs: z.array(looseObject) }),
    cli: { resource: 'runs', verb: 'get', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'POST', path: '/workflows/runs/{id}/action', operationId: 'actOnWorkflowRun', tags,
    summary: 'Pause, resume or cancel a run', permission: 'workflows.activate',
    params: idParams, body: workflowRunActionBody,
    response: z.looseObject({ action: z.string() }),
    cli: { resource: 'runs', verb: 'action', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'GET', path: '/workflows/queue', operationId: 'listWorkflowQueue', tags,
    summary: 'List queued workflow jobs', permission: 'workflows.view_runs',
    query: paginationQuery.extend({
      workflow_id: z.string().optional(),
      status: csvFilter('Job statuses'),
    }),
    response: listResponse('jobs'), listKey: 'jobs',
    cli: { resource: 'queue', verb: 'list' },
  }),
  defineEndpoint({
    method: 'POST', path: '/workflows/queue/{id}/action', operationId: 'actOnWorkflowJob', tags,
    summary: 'Cancel or retry a queued job', permission: 'workflows.activate',
    params: idParams, body: workflowQueueActionBody,
    response: z.looseObject({ action: z.string() }),
    cli: { resource: 'queue', verb: 'action', positional: ['id'] },
  }),
  deleteWorkflowEndpoint,
  activateWorkflowEndpoint,
  deactivateWorkflowEndpoint,
  listWorkflowVersionsEndpoint,
  getWorkflowVersionEndpoint,
  listWorkflowInstancesEndpoint,
  migrateWorkflowInstancesEndpoint,
]
