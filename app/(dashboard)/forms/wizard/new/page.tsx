import { Suspense } from 'react'
import { FormWizard } from '@/components/forms/wizard/form-wizard'
import { PageSkeleton } from '@/components/ui/page-skeleton'

/**
 * A new form with the wizard (forms.wizard). The first change saves a draft
 * and records it in the URL as ?draft=<id> (same route, so the wizard is not
 * remounted mid-edit); reloading that URL resumes the draft.
 */
export default function NewWizardFormPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <FormWizard />
    </Suspense>
  )
}
