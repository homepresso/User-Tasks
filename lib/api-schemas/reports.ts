import { z } from 'zod'
import { defineEndpoint } from './registry'
import { booleanFlag, idParams, itemResponse, listResponse, looseObject, paginationQuery } from './common'
import { MAX_REPORT_CHARTS, reportChartSpecSchema } from '@/lib/report-charts'

// Report routes normalise bodies with normalizeReportConfig rather than zod;
// these schemas describe the accepted fields loosely.

/** Summary charts (lib/report-charts.ts): invalid entries are dropped on save. */
export const reportChartsField = z.array(reportChartSpecSchema).max(MAX_REPORT_CHARTS).optional()
  .describe(`Summary charts drawn above the report's table (at most ${MAX_REPORT_CHARTS}); each is aggregated on the server from the report's own rows`)

export const reportConfigSchema = z.looseObject({
  data_source: z.string().optional().describe('Report source key'),
  charts: reportChartsField,
}).describe('Report configuration (data_source, columns, filters, ..., charts)')

/** One summary chart's series (POST /reports/preview). */
export const reportChartResultSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  value: z.number().nullable().optional().describe('Number cards'),
  points: z.array(z.object({ key: z.string(), label: z.string(), value: z.number().nullable() })).optional().describe('Every other chart type, in display order'),
  cells: z.array(z.object({ dow: z.number(), hour: z.number(), value: z.number() })).optional().describe('Heatmap: day of week (0 = Monday) × hour'),
  rows: z.number().describe('Rows aggregated'),
  truncated: z.boolean().describe('More rows matched than the chart row cap (10,000): the newest were used'),
  timezone: z.string(),
  error: z.string().optional(),
})
export const reportCreateBody = z.looseObject({
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  is_shared: z.boolean().optional(),
  config: reportConfigSchema.optional(),
})

export const reportUpdateBody = z.looseObject({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  is_shared: z.boolean().optional(),
  config: reportConfigSchema.optional(),
})

export const reportPreviewBody = z.looseObject({
  data_source: z.string().describe('Report source key'),
  charts: reportChartsField,
})

const tags = ['Reports']

export const reportExportSchema = z.looseObject({
  version: z.number().int(),
  asset_type: z.literal('report'),
  report: z.looseObject({ name: z.string(), config: z.any() }),
})

export const reportImportBody = z.looseObject({
  report: looseObject.optional().describe('An export document from GET /reports/{id}/export (or send the report fields at the top level)'),
  name: z.string().optional().describe('Report name, when the report is sent at the top level'),
  name_override: z.string().optional().describe('Replacement name'),
})

export const exportReportEndpoint = defineEndpoint({
  method: 'GET', path: '/reports/{id}/export', operationId: 'exportReport', tags,
  summary: 'Export a saved report as portable JSON', permission: 'reports.view',
  params: idParams, response: reportExportSchema,
  cli: { resource: 'reports', verb: 'export', positional: ['id'] },
})

export const importReportEndpoint = defineEndpoint({
  method: 'POST', path: '/reports/import', operationId: 'importReport', tags,
  summary: 'Create a saved report from an export document', permission: 'reports.create',
  body: reportImportBody, successStatus: 201, response: itemResponse('report'),
  cli: { resource: 'reports', verb: 'import' },
})

export const reportEndpoints = [
  defineEndpoint({
    method: 'GET', path: '/reports', operationId: 'listReports', tags,
    summary: 'List saved reports', permission: 'reports.view',
    query: paginationQuery.extend({ shared: booleanFlag('Filter by shared flag'), category: z.string().optional() }),
    response: listResponse('reports'), listKey: 'reports',
    cli: { resource: 'reports', verb: 'list' },
  }),
  defineEndpoint({
    method: 'POST', path: '/reports', operationId: 'createReport', tags,
    summary: 'Create a saved report', permission: 'reports.create',
    body: reportCreateBody, successStatus: 201, response: itemResponse('report'),
    cli: { resource: 'reports', verb: 'create' },
  }),
  defineEndpoint({
    method: 'GET', path: '/reports/{id}', operationId: 'getReport', tags,
    summary: 'Get a saved report', permission: 'reports.view',
    params: idParams, response: itemResponse('report'),
    cli: { resource: 'reports', verb: 'get', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'PUT', path: '/reports/{id}', operationId: 'updateReport', tags,
    summary: 'Update a saved report', permission: 'reports.edit_own',
    params: idParams, body: reportUpdateBody, response: itemResponse('report'),
    roundTrip: { unwrap: 'report' },
    cli: { resource: 'reports', verb: 'update', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'PATCH', path: '/reports/{id}', operationId: 'patchReport', tags,
    summary: 'Update a saved report (same as PUT)', permission: 'reports.edit_own',
    params: idParams, body: reportUpdateBody, response: itemResponse('report'),
    roundTrip: { unwrap: 'report' },
  }),
  defineEndpoint({
    method: 'DELETE', path: '/reports/{id}', operationId: 'deleteReport', tags,
    summary: 'Delete a saved report', permission: 'reports.delete',
    params: idParams, response: z.looseObject({ deleted: z.literal(true), report_id: z.string() }),
    cli: { resource: 'reports', verb: 'delete', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'POST', path: '/reports/preview', operationId: 'previewReport', tags,
    summary: 'Run a report configuration without saving it', permission: 'reports.view',
    description: 'Also accepts a signed-in browser session. Returns a bare JSON body (no envelope). With summary charts in the config, `charts` holds each chart\'s series, bucketed in `timezone` (the ?timezone= query, else the user\'s profile zone, else UTC).',
    query: z.object({ timezone: z.string().optional().describe('IANA time zone for summary chart time buckets') }),
    body: reportPreviewBody, envelope: false,
    response: z.looseObject({ data: z.array(looseObject), total: z.number().optional(), available_columns: z.any(), joins: z.any(), charts: z.array(reportChartResultSchema).optional(), timezone: z.string().optional() }),
    listKey: 'data',
    cli: { resource: 'reports', verb: 'preview' },
  }),
  defineEndpoint({
    method: 'GET', path: '/reports/sources', operationId: 'listReportSources', tags,
    summary: 'List report data sources', permission: 'reports.view',
    description: 'Also accepts a signed-in browser session. Returns a bare JSON body (no envelope). With workflow_id, the Workflow runs and Tasks sources are scoped to that workflow and list its variables as columns (vars.<name> on runs, fields.<key> on tasks); use the same id as config.source_inputs.workflow_id.',
    query: z.object({ workflow_id: z.string().uuid().optional().describe('Scope Workflow runs / Tasks to this workflow and list its variable columns') }),
    envelope: false,
    response: z.looseObject({ sources: z.array(looseObject) }), listKey: 'sources',
    cli: { resource: 'reports', verb: 'sources' },
  }),
  exportReportEndpoint,
  importReportEndpoint,
]
