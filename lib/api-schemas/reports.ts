import { z } from 'zod'
import { defineEndpoint } from './registry'
import { booleanFlag, idParams, itemResponse, listResponse, looseObject, paginationQuery } from './common'

// Report routes normalise bodies with normalizeReportConfig rather than zod;
// these schemas describe the accepted fields loosely.
export const reportCreateBody = z.looseObject({
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  is_shared: z.boolean().optional(),
  config: looseObject.optional().describe('Report configuration (data_source, columns, filters, ...)'),
})

export const reportUpdateBody = z.looseObject({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  is_shared: z.boolean().optional(),
  config: looseObject.optional(),
})

export const reportPreviewBody = z.looseObject({
  data_source: z.string().describe('Report source key'),
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
    description: 'Also accepts a signed-in browser session. Returns a bare JSON body (no envelope).',
    body: reportPreviewBody, envelope: false,
    response: z.looseObject({ data: z.array(looseObject), total: z.number().optional(), available_columns: z.any(), joins: z.any() }),
    listKey: 'data',
    cli: { resource: 'reports', verb: 'preview' },
  }),
  defineEndpoint({
    method: 'GET', path: '/reports/sources', operationId: 'listReportSources', tags,
    summary: 'List report data sources', permission: 'reports.view',
    description: 'Also accepts a signed-in browser session. Returns a bare JSON body (no envelope).',
    envelope: false,
    response: z.looseObject({ sources: z.array(looseObject) }), listKey: 'sources',
    cli: { resource: 'reports', verb: 'sources' },
  }),
  exportReportEndpoint,
  importReportEndpoint,
]
