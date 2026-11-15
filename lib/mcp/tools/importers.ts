import { z } from 'zod'
import type { McpContext, McpToolServer } from '../server'
import { mcpErr, mcpOk } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import * as importers from '@/lib/services/importers'
import { messageOf } from './_util'

/*
 * Importer tools: thin wrappers over lib/services/importers. Extension
 * importers (e.g. SharePoint Designer 2010 workflows) need the extension
 * enabled and licensed; the service checks the real permission (view for a
 * dry run, workflows.create / forms.edit for an import) and audits imports.
 * The core InfoPath importer stays forms_import_infopath.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const importerId = z.string().regex(/^(auto|ext\.[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*)$/).describe('Importer id from importers_list (ext.<extension>.<key>), or auto (the importer that recognises the files)')
const files = z.array(z.object({
  name: z.string().describe('File name; its ending picks how it is read (e.g. Approval.xoml, Approval.xoml.rules, Approval.xoml.wfconfig.xml)'),
  content_base64: z.string().describe('The file, base64'),
})).max(50).optional().describe('The files of one import')
const options = z.record(z.string(), z.any()).optional().describe("The importer's options (importers_list shows them)")

export function registerImporterTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('importers_list', 'List importers that turn other products\' files into UserTasks workflows and forms (extension importers such as SharePoint Designer 2010 workflows, and the core InfoPath importer — forms_import_infopath): accepted files, options, preview status and whether each is available here (enabled, licensed, permitted).', {
    produces: z.enum(['workflow', 'form']).optional().describe('Only importers that make workflows / forms'),
  }, async (args) => run(() => importers.listImporterViews(svc(), { produces: args.produces })))

  server.tool('importers_analyze', 'Dry run of an importer: returns the report — every element of the source and how it converts (mapped, partial = review, placeholder = a labelled placeholder step keeps the original, skipped), coverage %, a 0–100 complexity score, readiness (auto / review / rebuild) and what an import would make. Nothing is stored.', {
    importer: importerId,
    files,
    options,
  }, async (args) => run(async () => {
    const { markdown: _markdown, ...rest } = await importers.analyzeImport(svc(), args.importer, importers.decodeImportFiles(args.files), args.options)
    return rest
  }))

  server.tool('importers_import', 'Import with an importer: creates draft workflows (inactive, review then publish) and forms, and returns them (id, name, href) with the report. Unmapped steps become labelled placeholder steps that keep the original definition in their notes.', {
    importer: importerId,
    files,
    options,
  }, async (args) => run(async () => {
    const { markdown: _markdown, ...rest } = await importers.runImport(svc(), args.importer, importers.decodeImportFiles(args.files), args.options)
    return rest
  }))
}
