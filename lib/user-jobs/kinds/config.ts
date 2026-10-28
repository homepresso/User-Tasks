import { z } from 'zod'
import { applyConfig, exportConfig, type ConfigApplyResult } from '@/lib/services/config'
import { normalizeImportDocument } from '@/lib/portability/import-document'
import { ServiceError } from '@/lib/services/context'
import { defineJobKind } from '../define'

/*
 * Config export / import from the Export and Import buttons
 * (components/shared/config-transfer.tsx). Same service as GET /config/export
 * and POST /config/apply: every section is gated by its own permission
 * inside the service, with the job's (re-resolved) permissions.
 */

const uuid = z.string().uuid()

export function slugifyName(name: string, fallback = 'export'): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || fallback
}

export const configExportJob = defineJobKind({
  kind: 'config.export',
  effect: 'download',
  maxAttempts: 3,
  params: z.object({
    ids: z.array(uuid).min(1).max(5000),
    name: z.string().trim().min(1).max(200).default('export'),
    with_dependencies: z.boolean().default(false),
    include_rows: z.boolean().default(false),
  }),
  title: (p) => `Export “${p.name}”`,
  authorize: () => undefined,
  async run({ ctx, params, progress }) {
    await progress(10, 'Collecting assets')
    const result = await exportConfig(ctx, {
      ids: params.ids,
      with_dependencies: params.with_dependencies,
      include_rows: params.include_rows,
      format: 'manifest',
    })
    await progress(90, 'Writing the file')
    const manifest = result.manifest ?? {}
    const assets = Object.values(manifest).reduce<number>((n, value) => n + (Array.isArray(value) ? value.length : 0), 0)
    return {
      file: { name: `${slugifyName(params.name)}.usertasks.json`, contentType: 'application/json', body: JSON.stringify(manifest, null, 2) + '\n' },
      counts: { assets, skipped_sections: result.skipped.length },
      summary: `${assets} item${assets === 1 ? '' : 's'} exported${result.skipped.length ? ` (${result.skipped.length} section${result.skipped.length === 1 ? '' : 's'} skipped: no permission)` : ''}`,
    }
  },
})

export const configApplyJob = defineJobKind({
  kind: 'config.apply',
  effect: 'change',
  input: { maxBytes: 50 * 1024 * 1024 },
  params: z.object({
    name: z.string().trim().max(200).default('configuration file'),
    adopt_by_name: z.boolean().default(false),
    rows_mode: z.enum(['merge', 'replace', 'skip']).optional(),
  }),
  title: (p) => `Import ${p.name}`,
  authorize: () => undefined,
  async run({ ctx, params, progress, readInput }) {
    const input = await readInput()
    if (!input) throw ServiceError.validation('The uploaded file is missing')
    let document: unknown
    try {
      document = JSON.parse(new TextDecoder().decode(input))
    } catch {
      throw ServiceError.validation('The file is not valid JSON')
    }
    let doc
    try {
      doc = normalizeImportDocument(document)
    } catch (error) {
      throw ServiceError.validation(error instanceof Error ? error.message : 'Unrecognised file')
    }
    await progress(10, 'Importing')
    const result: ConfigApplyResult = await applyConfig(ctx, {
      ...(doc.kind === 'files' ? { files: doc.files } : { manifest: doc.manifest }),
      dry_run: false,
      adopt_by_name: params.adopt_by_name,
      rows_mode: params.rows_mode,
      source_label: 'ui',
    })
    const created = Object.values(result.result?.created ?? {}).reduce((a, b) => a + b, 0)
    const updated = Object.values(result.result?.updated ?? {}).reduce((a, b) => a + b, 0)
    const errors = result.result?.errors.length ?? 0
    return {
      data: result,
      counts: { created, updated, errors },
      summary: `${created} created, ${updated} updated${errors ? `, ${errors} failed` : ''}`,
    }
  },
})
