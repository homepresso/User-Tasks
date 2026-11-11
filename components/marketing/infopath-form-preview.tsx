"use client"

import { useState } from "react"
import { FormRenderer } from "@/components/forms/form-renderer"
import type { PublicInfoPathSummary } from "@/lib/infopath/public-summary"

/** The first InfoPath view as a real UserTasks form (try it: nothing is submitted). Loaded on demand. */
export function InfoPathFormPreview({ preview }: { preview: NonNullable<PublicInfoPathSummary["preview"]> }) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  return (
    <div className="p-5" data-testid="infopath-public-form">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-(color:--mkt-bronze)">{preview.name} · as a UserTasks form</p>
      <FormRenderer idPrefix="ip-public-" fields={preview.fields} layout={preview.layout} values={values} onChange={(k, v) => setValues((prev) => ({ ...prev, [k]: v }))} compact />
    </div>
  )
}
