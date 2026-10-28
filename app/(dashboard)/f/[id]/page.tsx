'use client'

import { use } from 'react'
import { StandaloneForm } from '@/components/forms/standalone-form'

/** A reusable form on its own page, for signed-in members with forms.submit. */
export default function FormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <div className="py-2">
      <StandaloneForm formId={id} />
    </div>
  )
}
