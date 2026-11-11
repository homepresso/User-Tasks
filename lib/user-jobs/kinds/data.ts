import { z } from 'zod'
import { requirePerm, ServiceError, type ServiceContext } from '@/lib/services/context'
import { runImport, type DataImportOptions, type ImportReport, type ImportState } from '@/lib/services/data-import'
import { DATA_IMPORT_LIMITS } from '@/lib/data-import/parse'
import { toCsv } from '@/lib/org/csv'
import { defineJobKind } from '../define'

/*
 * Data-table import (the import wizard, POST /data-tables/{id}/rows/import
 * with ?async=true, MCP data_rows_import for large files). The uploaded
 * file is the job input (gzip accepted); the import runs in batches and
 * hands back before each invocation's time limit, resuming from its
 * checkpoint (lib/services/data-import runImport). Permission: writing rows
 * of that table (data.manage_rows; data.edit_schema when it adds columns).
 */

const columnType = z.enum(['text', 'longtext', 'number', 'date', 'boolean', 'select'])

export const dataImportParams = z.object({
  table_id: z.string().uuid(),
  table_name: z.string().max(200).default('table'),
  file_name: z.string().trim().min(1).max(255),
  sheet: z.string().max(200).nullish(),
  delimiter: z.enum(['auto', ',', ';', '\t']).nullish(),
  encoding: z.enum(['auto', 'utf-8', 'utf-16le', 'utf-16be', 'windows-1252']).nullish(),
  mapping: z.record(z.string(), z.string().nullable()).nullish(),
  new_columns: z.array(z.object({
    header: z.string().min(1).max(500),
    name: z.string().max(200).optional(),
    type: columnType.optional(),
    options: z.array(z.string().max(500)).max(500).optional(),
    required: z.boolean().optional(),
  })).max(DATA_IMPORT_LIMITS.maxColumns).nullish(),
  mode: z.enum(['insert', 'upsert', 'replace']).default('insert'),
  key_column: z.string().max(200).nullish(),
  confirm_replace: z.string().max(200).nullish(),
  date_order: z.enum(['auto', 'dmy', 'mdy', 'ymd']).nullish(),
  trim: z.boolean().default(true),
  empty_cells: z.enum(['empty', 'ignore']).default('empty'),
  skip_invalid: z.boolean().default(false),
  fire_triggers: z.boolean().default(true),
})
export type DataImportJobParams = z.infer<typeof dataImportParams>

export function importOptionsOf(params: DataImportJobParams): DataImportOptions {
  const options: Partial<DataImportJobParams> = { ...params }
  delete options.table_id
  delete options.table_name
  return { ...(options as Omit<DataImportJobParams, 'table_id' | 'table_name'>), new_columns: params.new_columns ?? null, dry_run: false }
}

export function importSummary(r: ImportReport): string {
  const parts = [`${r.counts.inserted} inserted`, `${r.counts.updated} updated`, `${r.counts.skipped} skipped`, `${r.counts.failed} failed`]
  if (r.counts.deleted) parts.unshift(`${r.counts.deleted} replaced`)
  return parts.join(', ')
}

function authorizeImport(ctx: ServiceContext, params: DataImportJobParams) {
  requirePerm(ctx, 'data.manage_rows')
  if (params.new_columns?.length) requirePerm(ctx, 'data.edit_schema')
  const allow = ctx.resourceScopes?.table_ids ?? []
  if (allow.length && !allow.includes(params.table_id)) throw ServiceError.forbidden('Forbidden: this credential is not allowed to access that table')
}

export const dataImportJob = defineJobKind({
  kind: 'data.import',
  effect: 'change',
  // Gzip or not, the unpacked file is checked against DATA_IMPORT_LIMITS.maxBytes.
  input: { maxBytes: DATA_IMPORT_LIMITS.maxBytes + 1024 * 1024 },
  params: dataImportParams,
  title: (p) => `Import ${p.file_name} into ${p.table_name}`,
  authorize: authorizeImport,
  async run({ ctx, params, readInput, checkpoint, progress, timeLeft }) {
    const input = await readInput()
    if (!input) throw ServiceError.validation('The uploaded file is missing')
    await progress(checkpoint ? 5 : 1, checkpoint ? 'Resuming' : 'Reading the file')
    const step = await runImport(ctx, params.table_id, input, importOptionsOf(params), (checkpoint as ImportState | null) ?? null, { progress, timeLeft })
    if (!step.done) return { continue: step.state, progress: step.progress, message: step.message }
    const r = step.report
    const output: { data: ImportReport; counts: Record<string, number>; summary: string; file?: { name: string; contentType: string; body: string } } = {
      data: r,
      counts: { inserted: r.counts.inserted, updated: r.counts.updated, skipped: r.counts.skipped, failed: r.counts.failed, deleted: r.counts.deleted },
      summary: importSummary(r),
    }
    if (r.errors.length) {
      // The error report (formula-guarded CSV): row, column, value, reason.
      output.file = { name: `${params.file_name.replace(/\.[^.]+$/, '')}-errors.csv`, contentType: 'text/csv', body: toCsv(['Row', 'Column', 'Value', 'Reason'], r.errors.map((e) => [e.row, e.column, e.value, e.reason])) }
    }
    return output
  },
})
