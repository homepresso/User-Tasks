/**
 * The Agent's InfoPath import: when the person attaches an .xsn, the
 * attachment carries the importer's analysis (for the model to explain)
 * and the file (lib/assistants/attachments.ts). import_infopath_form imports
 * it through the same service as the Forms page (lib/services/infopath-import),
 * as the person, after they confirm a card listing the forms it will make.
 */
import type { AssistantToolDef } from '../engine'
import { sanitizeAttachments } from '../attachments-core'
import { analyzeInfoPathFile, importInfoPathFile, type InfoPathImportOptions } from '@/lib/services/infopath-import'
import { hasPerm, type ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- tool arguments are JSON */

export const INFOPATH_TOOL = 'import_infopath_form'

/** The InfoPath files attached in this conversation (latest per name). */
export function infopathAttachments(messages: unknown[]): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m !== 'object' || (m as any).role !== 'user') continue
    for (const a of sanitizeAttachments((m as any).attachments)) if (a.infopath?.file_base64) out.set(a.name, Buffer.from(a.infopath.file_base64, 'base64'))
  }
  return out
}

function optionsOf(args: Record<string, any>): InfoPathImportOptions {
  return {
    ...(args.mode === 'combined' || args.mode === 'per_view' ? { mode: args.mode } : {}),
    ...(Array.isArray(args.views) ? { views: args.views.map(String) } : {}),
    ...(typeof args.name === 'string' ? { name: args.name } : {}),
    ...(args.existing === 'update' || args.existing === 'new' ? { existing: args.existing } : {}),
    ...(args.create_table === true ? { create_table: true } : {}),
  }
}

export function infopathTools(ctx: ServiceContext, messages: unknown[]): AssistantToolDef[] {
  const files = infopathAttachments(messages)
  if (!files.size || !hasPerm(ctx, 'forms.edit')) return []
  const pick = (name: unknown) => {
    const key = typeof name === 'string' && files.has(name) ? name : [...files.keys()].pop()!
    return { name: key, bytes: files.get(key)! }
  }
  return [{
    name: INFOPATH_TOOL,
    description: `Import an InfoPath form template (.xsn) the person attached: one UserTasks form per InfoPath view (mode per_view, the default) or one form with the views as steps (mode combined), with its rules, validation and formulas where they translate (the rest kept as turned-off rules with notes). Attached now: ${[...files.keys()].join(', ')}. The attachment's text is the analysis report: use it to explain what converts. existing: update re-imports into the forms made from this file before. create_table also makes a data table for the submissions and a draft save workflow. The person confirms first.`,
    parameters: {
      type: 'object',
      properties: {
        file_name: { type: 'string', description: 'The attached file name' },
        mode: { type: 'string', enum: ['per_view', 'combined'] },
        views: { type: 'array', items: { type: 'string' }, description: 'View names to import (default all)' },
        name: { type: 'string', description: 'Base form name (default the InfoPath title)' },
        existing: { type: 'string', enum: ['new', 'update'] },
        create_table: { type: 'boolean' },
      },
      required: [],
    },
    mode: 'write',
    label: (args) => `Importing ${pick(args.file_name).name}`,
    confirm: async (args) => {
      const f = pick(args.file_name)
      const a = await analyzeInfoPathFile(ctx, f.bytes, f.name, optionsOf(args))
      const s = a.report.summary
      const attention = a.report.items.filter((i) => i.status === 'manual').length
      return {
        title: `Import the InfoPath form "${f.name}"`,
        lines: [
          ...a.forms.map((x) => `${x.updates ? 'Update' : 'Create'} the form "${x.updates?.name ?? x.name}" (${x.counts.fields} fields, ${x.counts.rules} rules)`),
          `${s.rules.converted} of ${s.rules.total} rules, ${s.validations.converted} of ${s.validations.total} validations and ${s.calculations.converted} of ${s.calculations.total} formulas convert`,
          ...(args.create_table ? ['Create a data table for the submissions and a draft "save submissions" workflow'] : []),
        ],
        warnings: attention ? [`${attention} item${attention === 1 ? '' : 's'} will need attention: kept as turned-off rules with the original in their notes`] : [],
        confirm_label: a.forms.some((x) => x.updates) ? 'Update forms' : 'Import',
      }
    },
    run: async (args) => {
      const f = pick(args.file_name)
      const r = await importInfoPathFile(ctx, f.bytes, f.name, optionsOf(args))
      return {
        ok: true,
        result: {
          created: r.created.map((c) => ({ name: c.name, link: c.href })),
          updated: r.updated.map((c) => ({ name: c.name, link: c.href })),
          ...(r.table ? { table: r.table.name } : {}),
          ...(r.workflow ? { workflow: r.workflow.name } : {}),
          summary: r.report.summary,
          needs_attention: r.report.items.filter((i) => i.status === 'manual').slice(0, 20).map((i) => `${i.name}: ${i.detail}`),
          warnings: r.warnings,
        },
      }
    },
  }]
}
