/**
 * Accessibility fixes on the designer's working state (the dialog applies
 * them through change(), so every fix is one undo step).
 */

import { updateField, type DesignerState } from '@/lib/forms/designer-state'
import type { FormButton } from '@/lib/forms/buttons'
import type { FormThemeRef } from '@/lib/forms/form-theme'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import type { AccessibilityFix } from './types'
import { fixPatch } from './index'

export function applyFixToDesigner(state: DesignerState, fix: AccessibilityFix, answer?: string): DesignerState {
  const patch = fixPatch(fix, answer)
  switch (fix.kind) {
    case 'field': {
      const field = state.fields.find((f) => f.key === fix.field_key)
      return field ? updateField(state, field._id, patch as Partial<TaskFieldDef>) : state
    }
    case 'header':
      return { ...state, header: { ...state.header, ...patch } }
    case 'theme':
      return patch.theme ? { ...state, theme: patch.theme as FormThemeRef } : state
    case 'button':
      return { ...state, buttons: state.buttons.map((b) => (b.id === fix.button_id ? { ...b, ...(patch as Partial<FormButton>) } : b)) }
  }
}

/** Designer id of the field a finding is about. */
export function designerIdForKey(state: DesignerState, key: string | undefined): string | null {
  if (!key) return null
  return state.fields.find((f) => f.key === key)?._id ?? null
}
