/**
 * Extension hooks into the core InfoPath importer (ServerExtension.infopath):
 * after the forms are generated and before anything is stored, each usable
 * extension's `enrich` may adjust them (e.g. bind a form to the list it came
 * from, turn a list data connection into a live lookup). A binding requested
 * by the extension that started the import (ctx.importers.infopath) is set
 * on every form here, with config keys its own hook added.
 *
 * Server-only. A hook that throws is logged and skipped: an upload never
 * fails because of an extension.
 */

import type { FormDataTargetRef } from '@/lib/forms/data-target'
import type { GenerateResult } from '@/lib/infopath/generate'
import type { InfoPathModel } from '@/lib/infopath/model'
import type { ServiceContext } from '@/lib/services/context'
import { isPlainObject } from '@/lib/utils/guards'

export interface InfoPathRunInternal {
  /** The extension that started the import (ctx.importers.infopath). */
  extensionId?: string
  /** Bind every form made to this target (the requesting extension's). */
  dataTarget?: FormDataTargetRef
  hints?: Record<string, unknown>
}

/** Run the enrich hooks and apply the requested binding; returns the hooks' notes. */
export async function applyInfoPathHooks(ctx: ServiceContext, model: InfoPathModel, generated: GenerateResult, internal: InfoPathRunInternal = {}): Promise<string[]> {
  const notes: string[] = []
  const { hasExtensions } = await import('@/lib/extensions/registry')
  if (hasExtensions() && ctx.tenantId) {
    const [{ getServerExtensions }, { extensionAccess }, { createExtensionContext }] = await Promise.all([
      import('@/lib/extensions/server-registry'), import('@/lib/extensions/state'), import('@/lib/extensions/host'),
    ])
    for (const server of getServerExtensions()) {
      const hook = server.infopath
      if (!hook || typeof hook.enrich !== 'function') continue
      try {
        if (!(await extensionAccess(ctx.tenantId, server.id, hook.feature)).usable) continue
        const extCtx = createExtensionContext({ extensionId: server.id, tenantId: ctx.tenantId, actorId: ctx.actorId ?? null, db: ctx.supabase, permissions: ctx.permissions })
        const result = await hook.enrich({
          ctx: extCtx,
          fileName: model.file_name,
          hash: model.hash,
          form: { name: generated.report.form.name, connections: model.manifest.connections.map((c) => ({ ...c })) },
          forms: generated.forms.map((f) => ({ name: f.name, view: f.view, fields: f.input.fields, layout: f.input.layout as unknown as Record<string, unknown> })),
          hints: { ...(internal.hints ?? {}) },
          requestedBy: internal.extensionId ?? null,
          target: internal.dataTarget ? { extension: internal.dataTarget.extension, key: internal.dataTarget.key, config: { ...internal.dataTarget.config } } : null,
        })
        if (!result) continue
        for (const note of (Array.isArray(result.notes) ? result.notes : []).slice(0, 50)) notes.push(String(note).slice(0, 500))
        const patches = Array.isArray(result.forms) ? result.forms : []
        generated.forms.forEach((form, i) => {
          const patch = patches[i]
          if (!patch) return
          if (Array.isArray(patch.fields)) form.input.fields = patch.fields
          if (isPlainObject(patch.layout)) {
            const { data_target: dataTarget, ...rest } = patch.layout as Record<string, unknown>
            Object.assign(form.input.layout as object, rest)
            // Only the requesting extension completes its own binding; nobody else binds a form.
            if (internal.dataTarget && internal.dataTarget.extension === server.id && isPlainObject(dataTarget) && isPlainObject((dataTarget as Record<string, unknown>).config)) {
              internal.dataTarget = { ...internal.dataTarget, config: { ...internal.dataTarget.config, ...((dataTarget as { config: Record<string, unknown> }).config as FormDataTargetRef['config']) } }
              ;(form as { targetConfig?: FormDataTargetRef['config'] }).targetConfig = internal.dataTarget.config
            }
          }
        })
      } catch (error) {
        console.warn(`[infopath-import] enrich hook of "${server.id}" failed:`, error instanceof Error ? error.message : error)
      }
    }
  }
  if (internal.dataTarget) {
    for (const form of generated.forms) {
      const own = (form as { targetConfig?: FormDataTargetRef['config'] }).targetConfig
      ;(form.input.layout as unknown as Record<string, unknown>).data_target = { ...internal.dataTarget, config: { ...internal.dataTarget.config, ...(own ?? {}) } }
    }
  }
  return notes
}
