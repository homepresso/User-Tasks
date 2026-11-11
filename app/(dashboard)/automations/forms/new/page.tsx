import { FormDesignerPage } from '@/components/forms/designer/form-designer-page'

/** Automations → Forms → New form: the designer page on a blank form, created on its first save (forms.edit). */
export default function NewFormRoute() {
  return <FormDesignerPage formId={null} />
}
