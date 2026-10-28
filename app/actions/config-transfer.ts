'use server'

import { fromSession, isServiceError, type ServiceContext } from '@/lib/services/context'
import { serviceRoleClient } from '@/lib/services/_shared'
import { applyConfig, type ConfigApplyResult } from '@/lib/services/config'
import { normalizeImportDocument } from '@/lib/portability/import-document'

/*
 * Import dry runs for the Import button (components/shared/config-transfer.tsx;
 * exports and real applies run as background jobs, lib/user-jobs/kinds/config):
 * a thin wrapper over lib/services/config — the same
 * service as GET /config/export, POST /config/apply, MCP config_export /
 * config_apply and `usertasks config export|apply`. A downloaded file is a
 * config manifest, so it imports through any of those surfaces.
 *
 * Every section is permission-gated inside the service with the signed-in
 * user's permissions. Writes use a service-role client (log destinations
 * have no client grants; every query is tenant-pinned).
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message }
    if (error instanceof Error && /^(The file|Unrecognised file|This is a)/.test(error.message)) return { ok: false, error: error.message }
    throw error
  }
}

async function elevated(): Promise<ServiceContext> {
  const ctx = await fromSession()
  return { ...ctx, supabase: await serviceRoleClient(ctx) }
}

export interface ImportConfigInput {
  /** Parsed JSON of the uploaded file. */
  document: unknown
  dry_run: boolean
  adopt_by_name?: boolean
  rows_mode?: 'merge' | 'replace' | 'skip'
}

/** Plan (dry_run) or apply an uploaded export file (the UI applies through the `config.apply` job). */
export async function importConfigAction(input: ImportConfigInput) {
  return run(async (): Promise<ConfigApplyResult> => {
    const doc = normalizeImportDocument(input.document)
    return applyConfig(await elevated(), {
      ...(doc.kind === 'files' ? { files: doc.files } : { manifest: doc.manifest }),
      dry_run: input.dry_run,
      adopt_by_name: Boolean(input.adopt_by_name),
      rows_mode: input.rows_mode,
      source_label: 'ui',
    })
  })
}
