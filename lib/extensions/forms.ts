/**
 * `ctx.forms` of the extension host: reusable forms bound to the
 * extension's form data targets (lib/forms/data-target.ts).
 *
 *  - create  a form in the caller's workspace, as the caller: the normal form
 *            service (forms.edit, validation, accessibility, versions,
 *            audit) plus the binding check (the target exists here, the
 *            caller holds its bindPermission). `layout.data_target` is set
 *            from `target`; the extension cannot bind to another extension.
 *  - list / get  forms bound to THIS extension only.
 *  - delete  one of THIS extension's bound forms, as the caller (the normal
 *            form service: forms.delete, usage and legal-hold checks, audit,
 *            the target's `deleted` hook).
 *  - update  one of THIS extension's bound forms, as the caller (the normal
 *            form service: forms.edit, validation, versions, audit); the
 *            binding keeps its extension and key, only its config can change.
 *
 * Server-only.
 */

import type { BoundForm, ExtensionContext, FormCreateInput, FormUpdateInput } from '@/lib/extensions/sdk'
import { layoutDataTarget } from '@/lib/forms/data-target'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { isPlainObject } from '@/lib/utils/guards'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- forms rows */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const designerUrl = (id: string) => `/automations/forms/${id}`
export const formPageUrl = (id: string) => `/f/${id}`

interface HostForms {
  extensionId: string
  tenantId: string | null
  actorId: string | null
  db: any
  /** null = a system caller. */
  permissions: ReadonlySet<string> | null
}

function serviceContext(host: HostForms): ServiceContext {
  if (!host.tenantId) throw new Error('forms needs a workspace')
  return { db: host.db, supabase: host.db, tenantId: host.tenantId, actorId: host.actorId, permissions: host.permissions, authKind: 'job', source: 'ui' }
}

/** The form as a BoundForm when it is bound to one of this extension's targets, else null. */
export function boundForm(extensionId: string, row: Record<string, any>): BoundForm | null {
  const ref = layoutDataTarget(row.layout)
  if (!ref || ref.extension !== extensionId) return null
  return {
    id: String(row.id), name: String(row.name), version: Number(row.version ?? 1), key: ref.key, config: ref.config, label: ref.label ?? null,
    updatedAt: row.updated_at ? String(row.updated_at) : null, designerUrl: designerUrl(String(row.id)), pageUrl: formPageUrl(String(row.id)),
  }
}

export function hostForms(host: HostForms): Pick<ExtensionContext['forms'], 'create' | 'list' | 'get' | 'delete' | 'update'> {
  return {
    async create(input: FormCreateInput) {
      const { getServerExtension } = await import('./server-registry')
      if (!getServerExtension(host.extensionId)?.formTargets?.[input.target?.key ?? '']) throw new Error(`Form target "${input.target?.key}" is not declared by this extension (formTargets)`)
      const layout = { ...(isPlainObject(input.layout) ? input.layout : {}), data_target: { extension: host.extensionId, key: input.target.key, config: input.target.config ?? {}, ...(input.target.label ? { label: input.target.label } : {}) } }
      if (!Array.isArray((layout as Record<string, unknown>).rows) && !Array.isArray((layout as Record<string, unknown>).pages)) (layout as Record<string, unknown>).rows = []
      const { createForm } = await import('@/lib/services/forms')
      const row = await createForm(serviceContext(host), { name: input.name, description: input.description ?? null, fields: input.fields, layout, buttons: input.buttons ?? null } as any)
      return { id: row.id, name: row.name, version: row.version, designerUrl: designerUrl(row.id), pageUrl: formPageUrl(row.id) }
    },
    async list(options = {}) {
      if (!host.tenantId) return []
      const { data, error } = await host.db.from('forms').select('id, name, version, layout, updated_at').eq('tenant_id', host.tenantId).order('updated_at', { ascending: false }).limit(2000)
      if (error) throw new Error(`forms.list failed: ${error.message}`)
      return ((data ?? []) as Array<Record<string, any>>).map((r) => boundForm(host.extensionId, r)).filter((f): f is BoundForm => Boolean(f) && (!options.key || f!.key === options.key))
    },
    async get(id: string) {
      if (!host.tenantId || !UUID_RE.test(String(id))) return null
      const { data, error } = await host.db.from('forms').select('id, name, version, layout, fields, buttons, updated_at').eq('tenant_id', host.tenantId).eq('id', id).maybeSingle()
      if (error) throw new Error(`forms.get failed: ${error.message}`)
      const form = data ? boundForm(host.extensionId, data) : null
      if (!form) return null
      const def = normalizeFormDefinition(data)
      return { ...form, fields: def.fields, layout: def.layout, buttons: Array.isArray(data.buttons) ? data.buttons : null }
    },
    async update(id: string, input: FormUpdateInput) {
      if (!host.tenantId || !UUID_RE.test(String(id))) throw new Error('Form not found')
      const { data, error } = await host.db.from('forms').select('id, name, version, layout').eq('tenant_id', host.tenantId).eq('id', id).maybeSingle()
      if (error) throw new Error(`forms.update failed: ${error.message}`)
      const current = data ? boundForm(host.extensionId, data) : null
      // Only forms bound to this extension (anything else reads as absent).
      if (!current) throw new Error('Form not found')
      const binding = { extension: host.extensionId, key: current.key, config: input.target ? input.target.config : current.config, ...((input.target?.label ?? current.label) ? { label: input.target?.label ?? current.label } : {}) }
      const changesLayout = input.layout !== undefined || input.target !== undefined
      const baseLayout = input.layout !== undefined ? input.layout : (data as Record<string, any>).layout
      const layout = changesLayout ? { ...(isPlainObject(baseLayout) ? baseLayout : {}), data_target: binding } : undefined
      const { updateForm } = await import('@/lib/services/forms')
      const row = await updateForm(serviceContext(host), id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.fields !== undefined ? { fields: input.fields } : {}),
        ...(layout ? { layout } : {}),
        ...(input.buttons !== undefined ? { buttons: input.buttons } : {}),
      } as any)
      return { id: row.id, name: row.name, version: row.version, versionChanged: row.version_changed }
    },
    async delete(id: string) {
      if (!host.tenantId || !UUID_RE.test(String(id))) return { deleted: false }
      const { data, error } = await host.db.from('forms').select('id, name, version, layout').eq('tenant_id', host.tenantId).eq('id', id).maybeSingle()
      if (error) throw new Error(`forms.delete failed: ${error.message}`)
      // Only forms bound to this extension (anything else reads as absent).
      if (!data || !boundForm(host.extensionId, data)) return { deleted: false }
      const { deleteForm } = await import('@/lib/services/forms')
      await deleteForm(serviceContext(host), id)
      return { deleted: true }
    },
  }
}
