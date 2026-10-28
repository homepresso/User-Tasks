import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { fromMcpContext, type ServiceContext } from '@/lib/services/context'
import * as decisionTables from '@/lib/services/decision-tables'
import { messageOf } from './_util'

const fieldSchema = z.object({
  id: z.string().optional().describe('Optional stable field ID. One is generated when omitted.'),
  key: z.string().min(1).describe('Stable field key used in workflow mappings and test inputs'),
  label: z.string().optional().describe('Display label shown to users'),
  type: z.enum(['text', 'number', 'boolean', 'date']).optional().describe('Field type'),
})

const conditionSchema = z.object({
  id: z.string().optional().describe('Optional condition ID. One is generated when omitted.'),
  inputKey: z.string().min(1).describe('Input field key this condition reads from'),
  operator: z.enum([
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'starts_with',
    'ends_with',
    'greater_than',
    'greater_than_or_equal',
    'less_than',
    'less_than_or_equal',
    'is_empty',
    'is_not_empty',
  ]).describe('Comparison operator'),
  value: z.any().optional().describe('Comparison value when required by the operator'),
})

const ruleSchema = z.object({
  id: z.string().optional().describe('Optional rule ID. One is generated when omitted.'),
  label: z.string().optional().describe('Rule label shown to designers'),
  enabled: z.boolean().optional().describe('Whether this rule is enabled'),
  conditions: z.array(conditionSchema).default([]).describe('Ordered rule conditions. All must match; an empty list makes the rule a catch-all (put it last).'),
  outputs: z.record(z.string(), z.any()).default({}).describe('Output values returned when the rule matches'),
})

async function run(fn: () => Promise<unknown>, fallback = 'Request failed') {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, fallback))
  }
}

/*
 * Thin wrappers over lib/services/decision-tables, which owns id
 * normalisation, tenant filtering, audit, sync capture and the deletion
 * queue (mutating tools are in AUDITED_IN_SERVICE in ../authz). Reads and
 * test need workflows.view.
 */
export function registerDecisionTableTools(server: McpToolServer, ctx: McpContext) {
  const writeCtx = (): ServiceContext => fromMcpContext(ctx)
  const readCtx = (): ServiceContext => fromMcpContext(ctx) // reads are gated too (READ_TOOL_PERMISSIONS)

  server.tool('decision_tables_list', 'List business rules / decision tables. Decision tables can be called from workflow decision_table nodes, and tested with sample inputs.', {
    search: z.string().optional().describe('Search table name and description'),
    limit: z.number().optional().describe('Max results (default 50, hard cap 200)'),
  }, async (args) => run(async () => {
    const { decision_tables: rows } = await decisionTables.listDecisionTables(readCtx(), { search: args.search }, { limit: Math.max(1, Math.min(args.limit ?? 50, 200)), offset: 0 })
    return { decision_tables: rows, count: rows.length }
  }))

  server.tool('decision_tables_get', 'Get a single decision table with inputs, outputs, rules, and metadata. The decision_table object can be edited and passed back to decision_tables_update.', {
    decision_table_id: z.string().describe('Decision table ID'),
  }, async (args) => run(async () => ({ decision_table: await decisionTables.getDecisionTable(readCtx(), args.decision_table_id) }), 'Decision table not found'))

  server.tool('decision_tables_export', 'Export a decision table as portable JSON so MCP can clone, version, or recreate the rule asset in another tenant.', {
    decision_table_id: z.string().describe('Decision table ID'),
  }, async (args) => run(async () => ({ exported: true, export: await decisionTables.exportDecisionTable(readCtx(), args.decision_table_id) }), 'Decision table not found'))

  server.tool('decision_tables_create', 'Create a business rule / decision table with custom inputs, outputs, and ordered rules. The first enabled matching rule wins.', {
    name: z.string().describe('Decision table name'),
    description: z.string().optional().describe('Optional description'),
    inputs: z.array(fieldSchema).optional().describe('Input field definitions'),
    outputs: z.array(fieldSchema).optional().describe('Output field definitions'),
    rules: z.array(ruleSchema).optional().describe('Ordered rules'),
  }, async (args) => run(async () => ({ created: true, decision_table: await decisionTables.createDecisionTable(writeCtx(), args) }), 'Failed to create decision table'))

  server.tool('decision_tables_update', 'Update a decision table. Provide only the fields you want to change. Inputs, outputs, and rules replace the existing arrays when supplied; values equal to the stored ones are not changes (updated: false).', {
    decision_table_id: z.string().describe('Decision table ID'),
    name: z.string().optional().describe('Updated name'),
    description: z.string().optional().describe('Updated description'),
    inputs: z.array(fieldSchema).optional().describe('Replacement input definitions'),
    outputs: z.array(fieldSchema).optional().describe('Replacement output definitions'),
    rules: z.array(ruleSchema).optional().describe('Replacement ordered rules'),
  }, async (args) => {
    const { decision_table_id: id, ...fields } = args
    if (!Object.values(fields).some((value) => value !== undefined)) return mcpErr('No fields to update')
    return run(async () => {
      const { changed, ...decisionTable } = await decisionTables.updateDecisionTable(writeCtx(), id, fields)
      return { updated: changed, decision_table: decisionTable }
    }, 'Decision table not found')
  })

  server.tool('decision_tables_delete', 'Delete a decision table by ID (queued; workflows that call it will fail).', {
    decision_table_id: z.string().describe('Decision table ID'),
  }, async (args) => run(async () => {
    await decisionTables.deleteDecisionTable(writeCtx(), args.decision_table_id)
    return { deleted: true, decision_table_id: args.decision_table_id }
  }))

  server.tool('decision_tables_test', 'Test a decision table with sample input values and return the matched rule plus output payload. Useful for validating business rules before wiring them into workflows.', {
    decision_table_id: z.string().describe('Decision table ID'),
    values: z.record(z.string(), z.any()).describe('Input values keyed by decision-table input key'),
  }, async (args) => run(() => decisionTables.testDecisionTable(readCtx(), args.decision_table_id, args.values), 'Decision table not found'))

  server.tool('decision_tables_import', 'Import a decision table from portable JSON. This is useful when MCP wants to recreate rules from an exported asset or a generated blueprint without using the drag-and-drop UI.', {
    import_json: z.string().describe('JSON string from decision_tables_export or a compatible object with name, description, inputs, outputs, and rules'),
    name_override: z.string().optional().describe('Optional replacement name'),
    description_override: z.string().optional().describe('Optional replacement description'),
  }, async (args) => {
    try {
      const decision_table = await decisionTables.importDecisionTable(writeCtx(), {
        payload: decisionTables.parseDecisionTableImportJson(args.import_json),
        name_override: args.name_override,
        description_override: args.description_override,
      })
      return mcpOk({ imported: true, decision_table })
    } catch (error) {
      return mcpErr(messageOf(error, 'Failed to import decision table'))
    }
  })
}
