/**
 * ctx.importers.infopath: an extension runs the core InfoPath importer on a
 * template it obtained itself (e.g. pulled from a SharePoint form library),
 * as the caller — same permissions (dry run forms.view, import forms.edit),
 * report, forms and audit as an upload — optionally binding every form to
 * one of its own form targets.
 *
 * Server-only.
 */

import { ExtensionError, type InfoPathRunInput } from '@/lib/extensions/sdk'
import { normalizeDataTarget } from '@/lib/forms/data-target'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- the host's db client */

export async function runInfoPathForExtension(
  host: { extensionId: string; tenantId: string; actorId: string | null; db: any; permissions: ReadonlySet<string> | null },
  input: InfoPathRunInput,
): Promise<Record<string, unknown>> {
  const bytes = input?.bytes
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new ExtensionError('invalid_request', 'importers.infopath: bytes (the .xsn) is required', 400)
  const { INFOPATH_LIMITS } = await import('@/lib/infopath/archive')
  if (bytes.length > INFOPATH_LIMITS.maxInputBytes) throw new ExtensionError('invalid_request', `The template is larger than ${Math.round(INFOPATH_LIMITS.maxInputBytes / 1024 / 1024)} MB`, 400)
  let dataTarget
  if (input.target) {
    const { getServerExtension } = await import('@/lib/extensions/server-registry')
    if (!getServerExtension(host.extensionId)?.formTargets?.[input.target.key]) throw new ExtensionError('invalid_request', `Form target "${input.target.key}" is not declared by this extension (formTargets)`, 400)
    dataTarget = normalizeDataTarget({ extension: host.extensionId, key: input.target.key, config: input.target.config ?? {}, ...(input.target.label ? { label: input.target.label } : {}) })
    if (!dataTarget) throw new ExtensionError('invalid_request', 'importers.infopath: the target config is not valid', 400)
  }
  const ctx: ServiceContext = { db: host.db, supabase: host.db, tenantId: host.tenantId, actorId: host.actorId, permissions: host.permissions, authKind: 'job', source: 'ui' } as ServiceContext
  const { getInfoPathRunner } = await import('./infopath-runner')
  const runner = getInfoPathRunner()
  if (!runner) throw new ExtensionError('not_ready', 'The InfoPath importer is not loaded in this process (call it from an importer)', 503)
  const { isServiceError } = await import('@/lib/services/context')
  const internal = { extensionId: host.extensionId, dataTarget, hints: input.hints && typeof input.hints === 'object' ? input.hints : {} }
  const options = (input.options && typeof input.options === 'object' ? input.options : {}) as Record<string, unknown>
  const fileName = String(input.fileName ?? 'form.xsn').slice(0, 200) || 'form.xsn'
  try {
    const result = input.dryRun
      ? await runner.analyze(ctx, bytes, fileName, options, { definitions: true }, internal)
      : await runner.import(ctx, bytes, fileName, options, internal)
    return result as unknown as Record<string, unknown>
  } catch (error) {
    if (isServiceError(error)) throw new ExtensionError(error.code, error.message, error.status, error.details as Record<string, unknown> | undefined)
    throw error
  }
}
