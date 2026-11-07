'use client'

import { use } from 'react'
import { FormWizard } from '@/components/forms/wizard/form-wizard'

/** Resume a wizard draft or edit a form made with the wizard (its owner, or forms.edit — checked in lib/services/form-wizard). */
export default function WizardFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <FormWizard projectId={id} />
}
