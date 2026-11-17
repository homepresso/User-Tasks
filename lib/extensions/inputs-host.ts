/**
 * Start inputs of an extension's own workflows (ctx.workflows.inputs, and
 * ctx.workflows.trigger(…, { workflowId, inputs }) for a person starting one
 * by hand, e.g. from an item menu in another system).
 *
 * The inputs are the workflow's declared input parameters — its
 * `user_variables` from the published version (the draft while never
 * published), exactly as the Run dialog and POST /workflows/{id}/start see
 * them (lib/workflow-inputs). Submitted values are validated and coerced
 * server-side with the same rules (types, required, choices); only declared
 * keys are accepted (never `_`-prefixed or undeclared keys from a page), and
 * inputs this kind of start can't carry (attachments, custom form controls)
 * are refused when given or required without a default. The checked values
 * become the run's start variables next to the trigger data — where the
 * engine reads start parameters ({{key}}); a declared input wins over a
 * trigger field of the same name. Server-only.
 */

import { ExtensionError, type ExtensionWorkflowInput } from '@/lib/extensions/sdk'
import { deriveInputFields, formatInputErrors, validateWorkflowInputs, type WorkflowInputField } from '@/lib/workflow-inputs'

/* eslint-disable @typescript-eslint/no-explicit-any -- supabase rows */

interface InputsHost {
  tenantId: string | null
  serviceDb: any
  permissions: ReadonlySet<string> | null
}

/** Inputs a hand start from an extension page can't carry (uploads, custom controls). */
export function unsupportedInput(field: WorkflowInputField): boolean {
  return field.type === 'attachments' || Boolean(field.custom)
}

/** The declared input fields of a workflow (published version, else the draft). */
export async function workflowInputFields(host: InputsHost, workflowId: string): Promise<WorkflowInputField[]> {
  const { data: wf, error } = await host.serviceDb.from('workflows').select('id, published_version_id, user_variables').eq('tenant_id', host.tenantId).eq('id', workflowId).maybeSingle()
  if (error) throw new Error(`workflows.inputs failed: ${error.message}`)
  if (!wf) throw new ExtensionError('not_found', 'Workflow not found', 404)
  let vars: unknown = wf.user_variables
  if (wf.published_version_id) {
    const { data: version } = await host.serviceDb.from('workflow_versions').select('user_variables').eq('id', wf.published_version_id).maybeSingle()
    if (version) vars = version.user_variables
  }
  return deriveInputFields(vars)
}

export function presentInput(field: WorkflowInputField): ExtensionWorkflowInput {
  return {
    key: field.key, label: field.label, type: field.custom ? 'custom' : field.type, required: field.required,
    default: field.default ?? null, options: field.options ? field.options.map((o) => ({ ...o })) : null, help: field.description,
    supported: !unsupportedInput(field),
  }
}

export function canReadInputs(host: InputsHost): boolean {
  return !host.permissions || ['workflows.view', 'workflows.start', 'workflows.activate', 'workflows.edit'].some((p) => host.permissions!.has(p))
}

/**
 * Validate a hand start's inputs against the workflow's fields: declared keys only, types / required /
 * choices as the start service; throws ExtensionError 400 `invalid_inputs` with per-field messages.
 */
export function checkStartInputs(fields: readonly WorkflowInputField[], submitted: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const given = submitted && typeof submitted === 'object' ? submitted : {}
  const errors: Array<{ field: string; message: string }> = []
  const supported = fields.filter((f) => !unsupportedInput(f))
  for (const f of fields.filter(unsupportedInput)) {
    const value = given[f.key]
    if (value !== undefined && value !== null && value !== '') errors.push({ field: f.key, message: `${f.label} can't be given here (start the workflow in UserTasks)` })
    else if (f.required && (f.default === null || f.default === undefined || f.default === '')) errors.push({ field: f.key, message: `${f.label} is required and can only be given in UserTasks` })
  }
  const declared = new Set(supported.map((f) => f.key))
  const only = Object.fromEntries(Object.entries(given).filter(([k]) => declared.has(k)))
  const checked = validateWorkflowInputs(supported, only)
  errors.push(...checked.errors)
  if (errors.length) {
    throw new ExtensionError('invalid_inputs', `Invalid workflow inputs: ${formatInputErrors(errors)}`, 400, { fields: Object.fromEntries(errors.map((e) => [e.field, e.message])) })
  }
  return Object.fromEntries(Object.entries(checked.values).filter(([k]) => declared.has(k)))
}
