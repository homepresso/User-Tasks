/**
 * Form / task-form tools of the AI assistants (server side). They work on
 * the live form the browser sent with the request (lib/assistants/form-values
 * sanitizeSnapshot) and never touch the database: proposing values emits a
 * `proposal` event — the browser shows a preview and sets values only when
 * the person applies them, through the form's own setters (rules and
 * validation run). There is deliberately no submit tool.
 */
import { coerceProposedValue, formForModel, unsettableReason } from '../form-values'
import type { AssistantToolDef } from '../engine'
import type { FormSnapshot, ProposedValue } from '../types'

export function formTools(snapshot: FormSnapshot | null, options: { canEdit: boolean }): AssistantToolDef[] {
  const tools: AssistantToolDef[] = [
    {
      name: 'get_form',
      description: 'Read the form on the person\'s screen: each visible field\'s key, label, type, whether it is required / read-only, its options, help text, limits, current value and any validation error.',
      parameters: { type: 'object', properties: {}, required: [] },
      mode: 'read',
      label: () => 'Reading the form',
      run: async () => ({ result: formForModel(snapshot) ?? { error: 'No form is open' } }),
    },
    {
      name: 'get_validation_problems',
      description: 'List the form\'s current problems: fields showing a validation error and required fields that are still empty.',
      parameters: { type: 'object', properties: {}, required: [] },
      mode: 'read',
      label: () => 'Checking the form',
      run: async () => {
        if (!snapshot) return { result: { error: 'No form is open' } }
        const visible = snapshot.fields.filter((f) => f.visible)
        const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
        return {
          result: {
            errors: visible.filter((f) => f.error).map((f) => ({ key: f.key, label: f.label, error: f.error })),
            required_empty: visible.filter((f) => f.required && empty(f.value) && !['heading', 'divider', 'button', 'label'].includes(f.type)).map((f) => ({ key: f.key, label: f.label })),
          },
        }
      },
    },
  ]
  if (!options.canEdit) return tools
  tools.push({
    name: 'propose_field_values',
    description: 'Propose values for fields of the form. The person sees a preview and chooses Apply / Apply all / Dismiss; nothing is set until they apply. Only visible, editable fields can be proposed. This never submits the form.',
    parameters: {
      type: 'object',
      properties: {
        values: {
          type: 'array',
          description: 'The proposed values',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'The field key' },
              value: { type: 'string', description: 'The value as text: numbers as digits, dates as YYYY-MM-DD, yes/no as true or false, a choice as its option value, several choices separated by commas' },
              reason: { type: 'string', description: 'Short note on where the value comes from (shown to the person)' },
            },
            required: ['key', 'value'],
          },
        },
      },
      required: ['values'],
    },
    mode: 'read',
    label: (args) => `Proposing ${Array.isArray(args.values) ? args.values.length : 0} value${Array.isArray(args.values) && args.values.length === 1 ? '' : 's'}`,
    run: async (args, env) => {
      if (!snapshot) return { result: { error: 'No form is open' }, ok: false }
      const byKey = new Map(snapshot.fields.map((f) => [f.key, f]))
      const values: ProposedValue[] = []
      const skipped: Array<{ key: string; reason: string }> = []
      for (const item of (Array.isArray(args.values) ? args.values : []).slice(0, 100)) {
        const key = String(item?.key ?? '')
        const field = byKey.get(key)
        const why = unsettableReason(field, snapshot.read_only === true)
        if (why) { skipped.push({ key, reason: why }); continue }
        const coerced = coerceProposedValue(field!, item?.value)
        if (!coerced.ok) { skipped.push({ key, reason: `${field!.label}: ${coerced.reason}` }); continue }
        if (values.some((v) => v.key === key)) continue
        values.push({ key, label: field!.label, current: field!.value ?? null, proposed: coerced.value, display: coerced.display, ...(typeof item?.reason === 'string' && item.reason.trim() ? { reason: item.reason.trim().slice(0, 300) } : {}) })
      }
      if (values.length) env.emit({ type: 'proposal', id: env.toolCallId, values, skipped })
      return {
        result: {
          shown_to_person: values.map((v) => v.key),
          skipped,
          note: values.length
            ? 'The proposal is shown to the person as a preview; they decide whether to apply it. You cannot submit the form.'
            : 'Nothing could be proposed — see skipped.',
        },
        ok: values.length > 0,
      }
    },
  })
  return tools
}
