import { z } from 'zod'
import { defineEndpoint } from './registry'

/**
 * Importers (lib/services/importers): workflows and forms from other
 * products' files. The core InfoPath importer has its own endpoint
 * (POST /forms/import/infopath); extensions contribute the rest
 * (`ext.<extension>.<key>`, e.g. a SharePoint Designer 2010 workflow).
 */

const tags = ['Importers']
const importerId = z.string().regex(/^(auto|infopath|ext\.[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*)$/, 'ext.<extension>.<key> (or auto)')
const importerParams = z.object({ importer: importerId.describe('Importer id from GET /importers (ext.<extension>.<key>), or auto: the importer whose detect hook recognises the files best') })

const option = z.looseObject({ name: z.string(), label: z.string().optional(), type: z.string(), required: z.boolean().optional(), description: z.string().optional(), options: z.array(z.looseObject({ value: z.string(), label: z.string().optional() })).optional() })

const importer = z.looseObject({
  id: z.string().describe('infopath or ext.<extension>.<key>'),
  extension_id: z.string().nullable(),
  extension_name: z.string().nullable(),
  label: z.string(),
  description: z.string().nullable(),
  produces: z.array(z.enum(['workflow', 'form'])),
  accepts: z.array(z.string()).describe('File name endings, e.g. .xoml'),
  multiple: z.boolean().describe('Several files make one import'),
  files_optional: z.boolean().describe('The importer can read its source from its options instead of files (e.g. from a connected system)'),
  preview: z.boolean().describe('Mapping not verified on real exports yet'),
  feature: z.string().nullable().describe('Licence feature (extension importers)'),
  options: z.array(option).describe('Options sent as `options`'),
  available: z.boolean().describe('Enabled and licensed here, and the caller may import'),
  unavailable_reason: z.string().nullable(),
  endpoint: z.string().nullable().describe('Served by its own endpoint (the InfoPath importer)'),
})

const reportItem = z.looseObject({
  kind: z.string(), name: z.string(),
  status: z.enum(['mapped', 'partial', 'placeholder', 'skipped', 'info']),
  mappedTo: z.string().optional(), detail: z.string().optional(), location: z.string().optional(),
})

const report = z.looseObject({
  title: z.string(),
  source: z.string(),
  summary: z.string().nullable(),
  coverage: z.looseObject({ total: z.number().int(), mapped: z.number().int(), partial: z.number().int(), placeholder: z.number().int(), skipped: z.number().int(), percent: z.number().int().describe('mapped + half of partial, over total') }),
  complexity: z.looseObject({ score: z.number().int().describe('0–100, higher is harder'), level: z.enum(['low', 'medium', 'high']), factors: z.array(z.string()) }),
  readiness: z.enum(['auto', 'review', 'rebuild']),
  items: z.array(reportItem),
  warnings: z.array(z.string()),
  preview: z.boolean().optional(),
  outputs: z.array(z.looseObject({ kind: z.enum(['workflow', 'form', 'other']), name: z.string(), detail: z.string().optional() })),
})

const importBody = z.object({
  files: z.array(z.object({
    name: z.string().min(1).max(200).describe('File name (its ending picks how it is read, e.g. Approval.xoml)'),
    content_base64: z.string().describe('The file, base64'),
    content_type: z.string().max(120).optional(),
  })).max(50).default([]).describe('The files of one import (an importer that reads its source from options takes none)'),
  options: z.record(z.string(), z.unknown()).optional().describe("The importer's options (GET /importers lists them)"),
})

export const listImportersEndpoint = defineEndpoint({
  method: 'GET', path: '/importers', operationId: 'listImporters', tags,
  summary: 'List the importers of this build (core InfoPath and those of extensions) with their availability here',
  description: 'Extension importers need the extension enabled and licensed (their licence feature): they lock when the licence lapses, while workflows already imported keep running. Needs workflows.view or forms.view.',
  permission: null,
  query: z.object({ produces: z.enum(['workflow', 'form']).optional().describe('Only importers that make workflows / forms') }),
  response: z.looseObject({ importers: z.array(importer), total: z.number().int() }), listKey: 'importers',
  cli: { resource: 'importers', verb: 'list' },
})

export const analyzeImportEndpoint = defineEndpoint({
  method: 'POST', path: '/importers/{importer}/analyze', bodyLimit: 'package', operationId: 'analyzeImport', tags,
  summary: 'Analyse files with an importer (dry run): mapping coverage, complexity score, readiness and what an import would make',
  description: 'Nothing is stored (the files neither). report.items lists every element of the source and how it converts (mapped, partial = review, placeholder = a labelled placeholder step keeps the original, skipped); markdown is the same report as Markdown. Needs the view permission of what the importer makes.',
  permission: null, params: importerParams, body: importBody,
  response: z.looseObject({ importer: z.string(), report, markdown: z.string() }),
  cli: { resource: 'importers', verb: 'analyze', positional: ['importer'] },
})

export const runImportEndpoint = defineEndpoint({
  method: 'POST', path: '/importers/{importer}/import', bodyLimit: 'package', operationId: 'runImport', tags,
  summary: 'Import files with an importer: creates draft workflows (inactive) and forms, and returns them with the report',
  description: 'Workflows are created inactive (a draft to review and publish); unmapped steps become labelled placeholder steps. Needs the importer\'s permission (default workflows.create for workflows, forms.edit for forms). Audited.',
  permission: null, params: importerParams, body: importBody, successStatus: 201,
  response: z.looseObject({
    importer: z.string(), report, markdown: z.string(),
    created: z.array(z.looseObject({ kind: z.enum(['workflow', 'form', 'other']), id: z.string(), name: z.string(), href: z.string().nullable() })),
    warnings: z.array(z.string()),
  }),
  cli: { resource: 'importers', verb: 'import', positional: ['importer'] },
})

export const importerEndpoints = [listImportersEndpoint, analyzeImportEndpoint, runImportEndpoint]
