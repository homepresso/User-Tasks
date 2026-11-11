'use client'

import { FormDesigner, type FormDesignerDialogProps } from './form-designer'

export type { DesignerAction, DesignerSaveContext, FormDesignerDialogProps } from './form-designer'

/**
 * The form designer as a resizable modal: the workflow builder's step forms
 * (node-form-section) and start forms (start-form-button). The designer
 * itself is the shared FormDesigner (./form-designer); the Forms library
 * edits a reusable form on its own page instead (FormDesignerPage).
 */
export function FormDesignerDialog(props: FormDesignerDialogProps) {
  // Remount per opening so the history starts from the stored definition.
  if (!props.open) return null
  return <FormDesigner {...props} chrome="dialog" />
}
