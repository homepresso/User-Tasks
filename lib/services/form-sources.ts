/**
 * The designer's Data panel: the data source a form is bound to, in the one
 * shape every source shares (the extension SDK's FormTargetDescription:
 * source fields + the mapping), and changes to its mapping.
 *
 *  - an extension form target (layout.data_target, e.g. a SharePoint list):
 *    the provider's own describe / bind (lib/services/form-targets.ts) —
 *    the provider owns the mapping inside data_target.config;
 *  - a core source (layout.data_binding: a Data table or an API reference,
 *    lib/forms/data-binding.ts): describe / bind here, from the table's
 *    columns or the reference's response model
 *    (lib/forms/data-binding-sources.ts).
 *
 * Nothing is saved here: the designer puts the result in its state and the
 * normal form save stores it (forms.edit, validation, versions, audit).
 * Server-only.
 */

import { layoutDataTarget } from '@/lib/forms/data-target'
import { layoutDataBinding, type FormDataBinding } from '@/lib/forms/data-binding'
import { bindCoreBinding, DataBindingError, describeCoreBinding, referenceSource, tableSource, type CoreBindInput, type CoreSource } from '@/lib/forms/data-binding-sources'
import type { FormTargetDescription } from '@/lib/extensions/sdk'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'
import { getDb, hasPerm, requirePerm, ServiceError, type ServiceContext } from './context'
import { bindFormTarget, describeFormTarget, type TargetForm } from './form-targets'

/* eslint-disable @typescript-eslint/no-explicit-any -- table / reference rows are free-form JSON */

export type FormSourceKind = 'none' | 'target' | 'table' | 'reference'

export interface FormSourceState {
  kind: FormSourceKind
  /** What the designer calls the source. */
  label: string
  description: FormTargetDescription | null
  /** The mapping can be changed here (the provider has `bind`, or a core source). */
  bind: boolean
  /** Extension targets: chosen by the extension (e.g. SharePoint), not in the designer. */
  locked: boolean
  /** Submissions are written to the source. */
  writable: boolean
}

/** Test seam: where core sources come from. */
export const formSourceDeps = {
  async table(ctx: ServiceContext, id: string): Promise<{ id: string; name: string; columns: unknown } | null> {
    const { data, error } = await (getDb(ctx) as any).from('custom_tables').select('id, name, columns').eq('tenant_id', ctx.tenantId).eq('id', id).maybeSingle()
    if (error) throw new ServiceError('validation_error', `Could not read the data table: ${error.message}`)
    return data ?? null
  },
  async reference(ctx: ServiceContext, id: string): Promise<Record<string, any> | null> {
    if (!hasPerm(ctx, 'integrations.view')) throw ServiceError.forbidden('Forbidden: binding a form to an API reference needs integrations.view')
    const { data, error } = await (getDb(ctx) as any).from('integration_references').select('id, name, outputs, request_config, integration_id, integration:integrations(id, name, type)').eq('tenant_id', ctx.tenantId).eq('id', id).maybeSingle()
    if (error) throw new ServiceError('validation_error', `Could not read the API reference: ${error.message}`)
    return data ?? null
  },
}

/** The core source a binding names, ready for describe / bind (not found → a clear error). */
export async function loadCoreSource(ctx: ServiceContext, binding: FormDataBinding): Promise<CoreSource> {
  if (binding.kind === 'table') {
    const table = await formSourceDeps.table(ctx, binding.source_id)
    if (!table) throw ServiceError.notFound(`The data table this form is bound to${binding.label ? ` ("${binding.label}")` : ''} no longer exists`)
    return tableSource(table)
  }
  const ref = await formSourceDeps.reference(ctx, binding.source_id)
  if (!ref) throw ServiceError.notFound(`The API reference this form is bound to${binding.label ? ` ("${binding.label}")` : ''} no longer exists`)
  return referenceSource(ref as never)
}

/** What the Data panel shows for the form as it is in the designer (unsaved fields and layout). */
export async function describeFormSource(ctx: ServiceContext, form: TargetForm): Promise<FormSourceState> {
  const target = layoutDataTarget(form.layout)
  if (target) {
    const described = await describeFormTarget(ctx, form)
    return { kind: 'target', label: described.label, description: described.description, bind: described.bind, locked: true, writable: true }
  }
  const binding = layoutDataBinding(form.layout)
  if (!binding) return { kind: 'none', label: '', description: null, bind: false, locked: false, writable: false }
  const source = await loadCoreSource(ctx, binding)
  return {
    kind: binding.kind,
    label: binding.label ?? source.label,
    description: describeCoreBinding(binding, source, form.fields),
    bind: true,
    locked: false,
    writable: binding.kind === 'table' && Boolean(binding.save),
  }
}

export interface FormSourceBindInput extends CoreBindInput {
  options?: Record<string, string | boolean>
}

/**
 * Change the mapping / add bound fields: the new layout (its data_target
 * config or data_binding) and the new fields (not yet placed: the designer
 * puts them where they were dropped).
 */
export async function bindFormSource(ctx: ServiceContext, form: TargetForm, input: FormSourceBindInput): Promise<{ layout: Record<string, unknown>; fields: TaskFieldDef[] }> {
  if (layoutDataTarget(form.layout)) return bindFormTarget(ctx, form, { mappings: input.mappings, add: input.add, options: input.options })
  const binding = layoutDataBinding(form.layout)
  if (!binding) throw new ServiceError('validation_error', 'This form has no data source: choose one in the Data panel first')
  const source = await loadCoreSource(ctx, binding)
  try {
    const out = bindCoreBinding(binding, source, form.fields, {
      mappings: (input.mappings ?? []).slice(0, 500).map((m) => ({ field: String(m.field), source: m.source === null ? null : String(m.source) })),
      add: (input.add ?? []).slice(0, 300).map(String),
      types: input.types,
    })
    return { layout: { ...(isPlainObject(form.layout) ? form.layout : {}), data_binding: out.binding }, fields: out.fields }
  } catch (error) {
    if (error instanceof DataBindingError) throw new ServiceError('validation_error', error.message, { details: { code: 'data_binding_invalid', fields: error.fields } })
    throw error
  }
}

/**
 * REST / MCP / CLI: a saved form's data source (or an unsaved definition of
 * it) described — its fields, the mapping and what it loads / saves. Binding
 * is part of the form definition: change it with a form update
 * (layout.data_binding, or the extension's own connection for data_target).
 */
export async function describeSavedFormSource(ctx: ServiceContext, formId: string, input: { definition?: Record<string, unknown> | null } = {}) {
  requirePerm(ctx, 'forms.view')
  const { getForm } = await import('./forms')
  const { normalizeFormDefinition } = await import('@/lib/forms/definition')
  const form = await getForm(ctx, formId) as any
  const def = normalizeFormDefinition(input.definition && typeof input.definition === 'object' ? input.definition as any : form)
  const state = await describeFormSource(ctx, { id: String(form.id), name: String(form.name), version: Number(form.version), fields: def.fields, layout: def.layout ?? {} })
  return { form_id: String(form.id), form_version: Number(form.version), checked: input.definition ? 'definition' as const : 'saved' as const, ...state }
}
