'use client'

import { createContext, useContext, useMemo } from 'react'
import { VariableScopeProvider } from '@/components/automations/variable-scope'
import { formVariableScope, type FormVariableContext } from '@/lib/forms/variable-catalog'
import type { PickerScope } from '@/lib/variable-picker'
import { useDesignerPreviewValues } from './designer-preview-context'
import type { WorkflowDataEntry } from '@/lib/forms/workflow-data'

/**
 * The variable picker's scope for a part of the form designer: every
 * VariableInput inside offers the variables of `context` (lib/forms/
 * variable-catalog.ts), with samples from the live preview. The dialog
 * sets a base scope (header) around the whole properties panel; rules,
 * buttons, defaults, Data tables, autocompletes and table changes set their
 * own. `sample` (the Rules tab's test panel) overrides the preview samples.
 */

/** A path's test value (undefined: none) — the Rules tab's "Test a rule" panel. */
type SampleFn = (path: string, context: FormVariableContext) => unknown
const TestSampleContext = createContext<SampleFn | null>(null)
export const DesignerTestSampleProvider = TestSampleContext.Provider

/**
 * The workflow data in scope when the form is designed from a workflow step
 * (lib/forms/workflow-data.ts): every picker in the designer also offers it
 * (grouped "Workflow · …"). Null for a form designed on its own.
 */
const WorkflowEntriesContext = createContext<readonly WorkflowDataEntry[] | null>(null)
export const DesignerWorkflowDataProvider = WorkflowEntriesContext.Provider
export function useDesignerWorkflowEntries(): readonly WorkflowDataEntry[] | null {
  return useContext(WorkflowEntriesContext)
}

export function useDesignerVariableScope(state: { fields: readonly unknown[]; layout: unknown }, context: FormVariableContext, extras?: Array<{ name: string; group: string; label?: string }>): PickerScope {
  const values = useDesignerPreviewValues()
  const testSample = useContext(TestSampleContext)
  const workflow = useContext(WorkflowEntriesContext)
  const key = JSON.stringify(context)
  const extrasKey = JSON.stringify(extras ?? [])
  return useMemo(() => {
    const scope = formVariableScope({ fields: state.fields as never, layout: state.layout, values, ...(workflow?.length ? { workflow } : {}) }, context, extras)
    if (!testSample) return scope
    return {
      ...scope,
      items: scope.items.map((i) => {
        const v = testSample(i.path, context)
        return v === undefined ? i : { ...i, sample: v }
      }),
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fields, state.layout, values, key, extrasKey, testSample, workflow])
}

export function DesignerVariableScope({ state, context, extras, children }: {
  state: { fields: readonly unknown[]; layout: unknown }
  context: FormVariableContext
  /** The input's own placeholders ({{search}}, {{row.<column>}}, {{run_reference}}…): listed first. */
  extras?: Array<{ name: string; group: string; label?: string }>
  children: React.ReactNode
}) {
  const scope = useDesignerVariableScope(state, context, extras)
  return <VariableScopeProvider value={scope}>{children}</VariableScopeProvider>
}
