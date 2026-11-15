/**
 * Late binding between the extension host and the core InfoPath importer.
 *
 * ctx.importers.infopath (extension host) must not import the InfoPath
 * service: the service runs the extensions' enrich hooks through the host,
 * and that import cycle breaks the production bundler. The service
 * registers itself here when it loads; the importer service
 * (lib/services/importers) loads it before any extension importer runs.
 */

import type { ServiceContext } from '@/lib/services/context'
import type { InfoPathRunInternal } from './infopath-hooks'

export interface InfoPathRunner {
  analyze(ctx: ServiceContext, bytes: Uint8Array, fileName: string, options: Record<string, unknown>, opts: { definitions?: boolean }, internal: InfoPathRunInternal): Promise<unknown>
  import(ctx: ServiceContext, bytes: Uint8Array, fileName: string, options: Record<string, unknown>, internal: InfoPathRunInternal): Promise<unknown>
}

const KEY = Symbol.for('usertasks.infopath-runner')
type Holder = { [KEY]?: InfoPathRunner }

export function setInfoPathRunner(runner: InfoPathRunner): void {
  ;(globalThis as Holder)[KEY] = runner
}

export function getInfoPathRunner(): InfoPathRunner | null {
  return (globalThis as Holder)[KEY] ?? null
}
