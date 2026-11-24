/**
 * Importers in this build: the core InfoPath importer (forms, its own
 * endpoint POST /forms/import/infopath), the core Nintex importer (workflows
 * and forms, on the generic endpoints), the core PDF form importer (forms,
 * generic endpoints — lib/importers/pdf) and every importer an extension
 * contributes (manifest contributes.importers + ServerExtension.importers),
 * addressed as `ext.<extension id>.<key>`.
 *
 * Server-only (the extension half reads the server registry).
 */

import type { ImporterContribution } from '@/lib/extensions/manifest'
import type { ImportFile, ImporterHandler, ImportReport, ImportResult } from '@/lib/extensions/sdk'
import type { ServiceContext } from '@/lib/services/context'

export const IMPORTER_ID_RE = /^(infopath|nintex|pdf|ext\.[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*)$/

/** A core importer served by the generic /importers endpoints (runs as the caller, no extension context). */
export interface CoreImporterRunner {
  analyze(ctx: ServiceContext, files: ImportFile[], options: Record<string, unknown>): Promise<ImportReport>
  import(ctx: ServiceContext, files: ImportFile[], options: Record<string, unknown>): Promise<ImportResult>
  detect?(files: ImportFile[]): number
}

export interface RegisteredImporter {
  /** `infopath` or `ext.<extension>.<key>`. */
  id: string
  extensionId: string | null
  extensionName: string | null
  contribution: ImporterContribution
  /** null for the core InfoPath importer (served by its own service). */
  handler: ImporterHandler | null
  /** Where the importer is served when not by the generic /importers endpoints. */
  endpoint: string | null
  /** A core importer on the generic endpoints (Nintex). */
  core?: CoreImporterRunner
}

const NINTEX_RUNNER: CoreImporterRunner = {
  analyze: async (ctx, files, options) => (await import('./nintex/importer')).analyzeNintex(ctx, files, options),
  import: async (ctx, files, options) => (await import('./nintex/importer')).importNintex(ctx, files, options) as Promise<ImportResult>,
  detect: (files) => (files.some((f) => /\.(nwf|nwp)$/i.test(f.name)) ? 0.9 : 0),
}

const PDF_RUNNER: CoreImporterRunner = {
  analyze: async (ctx, files, options) => (await import('./pdf/importer')).analyzePdfImport(ctx, files, options),
  import: async (ctx, files, options) => (await import('./pdf/importer')).importPdf(ctx, files, options),
  detect: (files) => (files.length === 1 && /\.pdf$/i.test(files[0].name) ? 0.8 : 0),
}

/** The core InfoPath importer as a contribution (listed beside the extensions' importers). */
export const CORE_INFOPATH_IMPORTER: ImporterContribution = {
  key: 'infopath',
  label: 'InfoPath form (.xsn)',
  description: 'Views, controls, repeating tables, rules, validation and data connections become UserTasks forms (one per view, or the views as steps).',
  produces: ['form'],
  accepts: ['.xsn', '.zip'],
  multiple: false,
  filesOptional: false,
  preview: false,
  options: [],
}

export async function listImporters(): Promise<RegisteredImporter[]> {
  const { CORE_NINTEX_IMPORTER } = await import('./nintex/importer')
  const { CORE_PDF_IMPORTER } = await import('./pdf/importer')
  const out: RegisteredImporter[] = [
    { id: 'infopath', extensionId: null, extensionName: null, contribution: CORE_INFOPATH_IMPORTER, handler: null, endpoint: '/forms/import/infopath' },
    { id: 'nintex', extensionId: null, extensionName: null, contribution: CORE_NINTEX_IMPORTER, handler: null, endpoint: null, core: NINTEX_RUNNER },
    { id: 'pdf', extensionId: null, extensionName: null, contribution: CORE_PDF_IMPORTER, handler: null, endpoint: null, core: PDF_RUNNER },
  ]
  const { hasExtensions, getExtensionManifest } = await import('@/lib/extensions/registry')
  if (!hasExtensions()) return out
  const { getServerExtensions } = await import('@/lib/extensions/server-registry')
  for (const server of getServerExtensions()) {
    const manifest = getExtensionManifest(server.id)
    if (!manifest) continue
    for (const contribution of manifest.contributes.importers) {
      const handler = server.importers?.[contribution.key]
      if (!handler) continue
      out.push({ id: `ext.${server.id}.${contribution.key}`, extensionId: server.id, extensionName: manifest.name, contribution, handler, endpoint: null })
    }
  }
  return out
}

export async function getImporter(id: string): Promise<RegisteredImporter | null> {
  if (!IMPORTER_ID_RE.test(String(id ?? ''))) return null
  return (await listImporters()).find((i) => i.id === id) ?? null
}

/** Does a file name end with one of the importer's accepted endings? */
export function acceptsFile(contribution: Pick<ImporterContribution, 'accepts'>, name: string): boolean {
  if (!contribution.accepts.length) return false
  const lower = String(name ?? '').toLowerCase()
  return contribution.accepts.some((ending) => lower.endsWith(ending))
}
