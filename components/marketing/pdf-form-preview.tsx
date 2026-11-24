"use client"

import { useState } from "react"
import { PdfStyledPreview } from "@/components/importers/pdf-styled-preview"
import type { PublicPdfSummary } from "@/lib/importers/pdf/public-summary"

/** The PDF as a real UserTasks form (try it: nothing is submitted). Loaded on demand. */
export function PdfFormPreview({ preview, name }: { preview: NonNullable<PublicPdfSummary["preview"]>; name: string }) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  return (
    <div className="p-5" data-testid="pdf-public-form">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-(color:--mkt-bronze)">{name} · as a UserTasks form</p>
      <PdfStyledPreview idPrefix="pdf-public-" fields={preview.fields} layout={preview.layout} header={preview.header} theme={preview.theme} values={values} onChange={(k, v) => setValues((prev) => ({ ...prev, [k]: v }))} />
    </div>
  )
}
