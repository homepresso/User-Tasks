import { FormDesignerPage } from '@/components/forms/designer/form-designer-page'

/**
 * Automations → Forms → a form: the full-page form designer (forms.view to
 * open, lib/route-permissions; editing needs forms.edit, read only without).
 * The workflow builder keeps the designer dialog for step and start forms.
 */
export default async function FormDesignerRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <FormDesignerPage formId={id} />
}
