'use client'

import { use } from 'react'
import { WizardResultsView } from '@/components/forms/wizard/wizard-results'

/** A wizard form's results page: the owner, the roles / teams chosen in the wizard, or forms.edit (lib/services/form-wizard getWizardResults). */
export default function WizardResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <WizardResultsView projectId={id} />
}
