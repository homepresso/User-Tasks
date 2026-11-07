'use client'

import { use } from 'react'
import { StandaloneForm } from '@/components/forms/standalone-form'

/**
 * A reusable form inside the app (the dashboard shell): where the app's own
 * Forms menu, Home favourites and search open a form. Links people share
 * (/f/<id>, /form/<system name>) open the form on its own page instead
 * (app/f/[id], app/form/[name]: no shell, embeddable).
 * For signed-in members with forms.submit.
 * The query string carries the form's URL parameters (/f/<id>?customer=ALFKI):
 * only declared ones are read, typed and validated (lib/forms/form-params.ts).
 * The favourite heart and Save draft icons are in the form's top-right corner
 * (components/forms/form-header-actions.tsx).
 */
export default function FormPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = use(params)
  const query = use(searchParams)
  return (
    <div className="py-2">
      <StandaloneForm formId={id} query={query} />
    </div>
  )
}
