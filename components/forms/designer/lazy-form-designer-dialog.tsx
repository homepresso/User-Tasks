'use client'

import dynamic from 'next/dynamic'
import type { FormDesignerDialogProps } from './form-designer'

// The designer (FormDesigner, rules panel, preview renderer …) is a large
// graph: load it when a dialog opens, not with the workflow builder.
const FormDesignerDialogInner = dynamic(() => import('./form-designer-dialog').then((m) => m.FormDesignerDialog), { ssr: false })

/** FormDesignerDialog, loaded on first open (it renders nothing while closed anyway). */
export function LazyFormDesignerDialog(props: FormDesignerDialogProps) {
  if (!props.open) return null
  return <FormDesignerDialogInner {...props} />
}
