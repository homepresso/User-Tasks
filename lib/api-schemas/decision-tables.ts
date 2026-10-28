import { z } from 'zod'
import { defineEndpoint } from './registry'
import { deletedResponse, idParams, itemResponse, listResponse, paginationQuery } from './common'

// Ids are optional (generated when missing) and condition values are
// stored as strings, so hand-written and fetched tables are both accepted.
export const decisionTableFieldSchema = z.looseObject({
  id: z.string().optional(),
  key: z.string().min(1),
  label: z.string().nullable().optional(),
  type: z.enum(['text', 'number', 'boolean', 'date']).nullable().optional().describe('Default text'),
})

export const decisionTableConditionSchema = z.looseObject({
  id: z.string().optional(),
  inputKey: z.string().min(1),
  operator: z.string().min(1).describe('equals, not_equals, contains, not_contains, starts_with, ends_with, greater_than, greater_than_or_equal, less_than, less_than_or_equal, is_empty, is_not_empty'),
  value: z.any().optional().describe('Comparison value (stored as a string)'),
})

export const decisionTableRuleSchema = z.looseObject({
  id: z.string().optional(),
  label: z.string().nullable().optional(),
  enabled: z.boolean().nullable().optional().describe('Default true'),
  conditions: z.array(decisionTableConditionSchema).default([]).describe('All must match'),
  outputs: z.record(z.string(), z.any()).default({}),
})

export const decisionTableCreateBody = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  inputs: z.array(decisionTableFieldSchema).default([]),
  outputs: z.array(decisionTableFieldSchema).default([]),
  rules: z.array(decisionTableRuleSchema).default([]).describe('Ordered; the first enabled matching rule wins'),
})

export const decisionTableUpdateBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  inputs: z.array(decisionTableFieldSchema).optional().describe('Replaces all inputs'),
  outputs: z.array(decisionTableFieldSchema).optional().describe('Replaces all outputs'),
  rules: z.array(decisionTableRuleSchema).optional().describe('Replaces all rules'),
})

export const decisionTableTestBody = z.object({
  values: z.record(z.string(), z.any()).default({}),
})

export const decisionTableExportSchema = z.looseObject({
  version: z.number().int(),
  asset_type: z.literal('decision_table'),
  decision_table: z.looseObject({
    name: z.string(),
    description: z.string().nullable(),
    inputs: z.array(z.any()),
    outputs: z.array(z.any()),
    rules: z.array(z.any()),
  }),
})

export const decisionTableImportBody = z.looseObject({
  decision_table: z.looseObject({}).optional().describe('An export document from GET /decision-tables/{id}/export (or send the table fields at the top level)'),
  name: z.string().optional().describe('Table name, when the table is sent at the top level'),
  name_override: z.string().optional().describe('Replacement name'),
  description_override: z.string().optional().describe('Replacement description'),
})

const tags = ['Decision tables']

export const exportDecisionTableEndpoint = defineEndpoint({
  method: 'GET', path: '/decision-tables/{id}/export', operationId: 'exportDecisionTable', tags,
  summary: 'Export a decision table as portable JSON', permission: 'workflows.view',
  params: idParams, response: decisionTableExportSchema,
  cli: { resource: 'decision-tables', verb: 'export', positional: ['id'] },
})

export const importDecisionTableEndpoint = defineEndpoint({
  method: 'POST', path: '/decision-tables/import', operationId: 'importDecisionTable', tags,
  summary: 'Create a decision table from an export document',
  description: 'Always creates a new table. Field, rule and condition ids are kept when present and generated otherwise.',
  permission: 'workflows.create', body: decisionTableImportBody, successStatus: 201,
  response: itemResponse('decision_table'),
  cli: { resource: 'decision-tables', verb: 'import' },
})

export const listDecisionTablesEndpoint = defineEndpoint({
  method: 'GET', path: '/decision-tables', operationId: 'listDecisionTables', tags,
  summary: 'List decision tables', permission: 'workflows.view',
  query: paginationQuery.extend({ search: z.string().optional().describe('Name or description contains') }),
  response: listResponse('decision_tables'), listKey: 'decision_tables',
  cli: { resource: 'decision-tables', verb: 'list' },
})

export const createDecisionTableEndpoint = defineEndpoint({
  method: 'POST', path: '/decision-tables', operationId: 'createDecisionTable', tags,
  summary: 'Create a decision table', description: 'workflows.create is also accepted.', permission: 'workflows.edit',
  body: decisionTableCreateBody, successStatus: 201,
  response: itemResponse('decision_table'),
  cli: { resource: 'decision-tables', verb: 'create' },
})

export const getDecisionTableEndpoint = defineEndpoint({
  method: 'GET', path: '/decision-tables/{id}', operationId: 'getDecisionTable', tags,
  summary: 'Get a decision table', permission: 'workflows.view',
  params: idParams, response: itemResponse('decision_table'),
  cli: { resource: 'decision-tables', verb: 'get', positional: ['id'] },
})

const updateDecisionTableDef = {
  tags, permission: 'workflows.edit', params: idParams, body: decisionTableUpdateBody,
  description: 'Fields equal to the stored value are not changes (changed: false).',
  response: itemResponse('decision_table'), roundTrip: { unwrap: 'decision_table' },
}

export const updateDecisionTableEndpoint = defineEndpoint({
  ...updateDecisionTableDef,
  method: 'PUT', path: '/decision-tables/{id}', operationId: 'updateDecisionTable',
  summary: 'Update a decision table (omitted fields are kept)',
  cli: { resource: 'decision-tables', verb: 'update', positional: ['id'] },
})

export const patchDecisionTableEndpoint = defineEndpoint({
  ...updateDecisionTableDef,
  method: 'PATCH', path: '/decision-tables/{id}', operationId: 'patchDecisionTable',
  summary: 'Update a decision table (same as PUT)',
})

export const deleteDecisionTableEndpoint = defineEndpoint({
  method: 'DELETE', path: '/decision-tables/{id}', operationId: 'deleteDecisionTable', tags,
  summary: 'Delete a decision table (queued)', permission: 'workflows.delete',
  params: idParams, response: deletedResponse,
  cli: { resource: 'decision-tables', verb: 'delete', positional: ['id'] },
})

export const testDecisionTableEndpoint = defineEndpoint({
  method: 'POST', path: '/decision-tables/{id}/test', operationId: 'testDecisionTable', tags,
  summary: 'Evaluate a decision table against input values', permission: 'workflows.view',
  params: idParams, body: decisionTableTestBody,
  response: z.looseObject({ matched: z.boolean(), rule: z.any(), outputs: z.any() }),
  cli: { resource: 'decision-tables', verb: 'test', positional: ['id'] },
})

export const decisionTableEndpoints = [
  listDecisionTablesEndpoint,
  createDecisionTableEndpoint,
  getDecisionTableEndpoint,
  updateDecisionTableEndpoint,
  patchDecisionTableEndpoint,
  deleteDecisionTableEndpoint,
  testDecisionTableEndpoint,
  exportDecisionTableEndpoint,
  importDecisionTableEndpoint,
]
