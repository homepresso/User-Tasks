import { FormDesignerPage } from '@/components/forms/designer/form-designer-page'
import { returnToFrom } from '@/lib/navigation/return-to'

/**
 * Automations → Forms → a form: the full-page form designer (forms.view to
 * open, lib/route-permissions; editing needs forms.edit, read only without).
 * The workflow builder keeps the designer dialog for step and start forms.
 */
export default async function FormDesignerRoute({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const returnTo = returnToFrom((name) => { const v = query[name]; return Array.isArray(v) ? v[0] : v })
  return <FormDesignerPage formId={id} returnTo={returnTo} />
}
