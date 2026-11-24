'use client'

/**
 * A PDF import's preview as it will look: the form inside the theme derived
 * from the PDF (FormThemeScope), its header (logo, title, banner colour) and
 * the fields with the headings, text, dividers and pictures brought across.
 * Used by the import dialog and the public "try a PDF" preview. Pictures are
 * the analysis's inline PNGs (data:image/png only); nothing is stored.
 */

import { FormRenderer } from '@/components/forms/form-renderer'
import { FormHeaderBlock } from '@/components/forms/form-shell'
import { FormThemeScope } from '@/components/forms/form-theme-scope'
import type { FormHeader } from '@/lib/forms/header'
import type { FormLayout } from '@/lib/forms/layout'
import type { FormThemeOverrides } from '@/lib/forms/form-theme'
import type { TaskFieldDef } from '@/lib/task-field-schema'

const SAFE_DATA_IMAGE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/

export interface StyledPreviewHeader {
  enabled: true
  image: 'upload' | 'none'
  image_url?: string
  image_alt?: string
  title?: string
  subtitle?: string
  align: 'left' | 'center'
  banner?: boolean
}

export function PdfStyledPreview({ fields, layout, header, theme, values, onChange, idPrefix }: {
  fields: TaskFieldDef[]
  layout: FormLayout
  header?: StyledPreviewHeader | null
  theme?: FormThemeOverrides | null
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  idPrefix: string
}) {
  // Only an inline PNG from the analysis is drawn as the logo.
  const safeHeader: FormHeader | null = header
    ? { ...header, ...(header.image === 'upload' && header.image_url && SAFE_DATA_IMAGE.test(header.image_url) ? {} : { image: 'none', image_url: undefined }) } as FormHeader
    : null
  const body = (
    <>
      {safeHeader && <FormHeaderBlock header={safeHeader} values={values} overrides={theme ?? null} />}
      <FormRenderer idPrefix={idPrefix} fields={fields} layout={layout} values={values} onChange={onChange} compact />
    </>
  )
  if (!theme) return body
  // The banner's text colour is set on the header itself: page styles (the marketing site's headings) must not override it.
  return <div data-testid="pdf-styled-preview" className="[&_[data-form-header]_h2]:text-inherit"><FormThemeScope overrides={theme} className="rounded-lg p-3">{body}</FormThemeScope></div>
}
