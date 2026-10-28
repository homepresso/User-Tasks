'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Library, PencilRuler } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePermissions } from '@/lib/permissions-context'
import { serverRead } from '@/lib/server-read'
import { createFormTheme } from '@/app/actions/forms'
import { normalizeFormDefinition, type FormDefinition } from '@/lib/forms/definition'
import { START_FORM_TYPES, startFormConfig, startFormFromVariables, variablesFromStartForm, type StartFormVariable } from '@/lib/forms/start-form'
import type { TaskFieldDef, TaskFieldType } from '@/lib/task-field-schema'
import { FormDesignerDialog } from './designer/form-designer-dialog'
import type { SavedFormTheme } from './designer/theme-editor'
import { SavedFormPicker } from './node-form-section'

/* eslint-disable @typescript-eslint/no-explicit-any -- node config is free-form JSON */

/** A saved form's field as a start-form field (start forms support the workflow input types). */
const AS_START_TYPE: Partial<Record<TaskFieldType, TaskFieldType>> = { textarea: 'text', phone: 'text', user: 'text', currency: 'number' }

function toStartFields(fields: TaskFieldDef[]): TaskFieldDef[] {
  return fields.flatMap((f) => {
    const type = START_FORM_TYPES.includes(f.type) ? f.type : AS_START_TYPE[f.type]
    return type ? [{ ...f, type }] : []
  })
}

/**
 * "Design start form" in the workflow settings: the workflow inputs (the
 * Run dialog and API starts) in the form designer — types, labels, help,
 * defaults, required — on a grid, with a theme. Saving rewrites the
 * variables and the trigger node's `start_form`.
 */
export function StartFormButton({ variables, onVariablesChange, triggerNode, onTriggerConfigChange }: {
  variables: StartFormVariable[]
  onVariablesChange: (variables: any[]) => void
  triggerNode: { id: string; config: Record<string, any> } | null
  onTriggerConfigChange: (config: Record<string, any>) => void
}) {
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [imported, setImported] = useState<FormDefinition | null>(null)
  const model = useMemo(() => startFormFromVariables(variables, triggerNode?.config), [variables, triggerNode?.config])
  const { data: savedThemes = [] } = useQuery({
    queryKey: ['form-themes'],
    enabled: can('forms.view'),
    staleTime: 30_000,
    queryFn: async () => ((await serverRead('forms.themes')).data ?? []) as SavedFormTheme[],
  })
  if (!triggerNode) return null

  return (
    <div className="flex flex-wrap gap-1.5" data-testid="start-form">
      <Button size="sm" variant="outline" onClick={() => { setImported(null); setOpen(true) }} data-testid="design-start-form">
        <PencilRuler size={12} /> Design start form
      </Button>
      {can('forms.view') && (
        <Button size="sm" variant="ghost" onClick={() => setPickerOpen(true)} title="Start from a saved form's fields (copied, not linked)">
          <Library size={12} /> From a saved form
        </Button>
      )}
      <FormDesignerDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Design start form"
        subtitle="The workflow inputs: what the Run dialog and API / CLI starts fill in. Each field is a workflow variable ({{name}})."
        initial={imported ?? model.def}
        allowedTypes={START_FORM_TYPES}
        formSettings={false}
        savedThemes={savedThemes}
        canSaveTheme={can('forms.edit')}
        onSaveTheme={async (name, overrides) => {
          const result = await createFormTheme({ name, overrides })
          if (!result.ok) return { error: result.error }
          await queryClient.invalidateQueries({ queryKey: ['form-themes'] })
          return { id: result.data.id }
        }}
        actions={[{
          id: 'save',
          label: 'Save start form',
          run: async (def) => {
            onVariablesChange(variablesFromStartForm(def, variables, model.nameByKey, () => crypto.randomUUID()))
            const startForm = startFormConfig(def, model.nameByKey)
            const { start_form: _old, ...rest } = triggerNode.config ?? {}
            onTriggerConfigChange(startForm ? { ...rest, start_form: startForm } : rest)
            return null
          },
        }]}
      />
      <SavedFormPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentId={null}
        replacing={model.def.fields.length > 0}
        onPick={async (form) => {
          const full = await serverRead('forms.get', { id: form.id })
          if (!full.data) return 'The form could not be loaded'
          const def = normalizeFormDefinition(full.data as any)
          const fields = toStartFields(def.fields)
          setImported({ fields, layout: def.layout ? normalizeFormDefinition({ fields, layout: def.layout }).layout : null, theme: def.theme })
          setOpen(true)
          return null
        }}
      />
    </div>
  )
}
