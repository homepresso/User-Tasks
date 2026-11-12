'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Eye, FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Skeleton } from '@/components/ui/skeleton'
import { FormRenderer } from '@/components/forms/form-renderer'
import { FormThemeScope } from '@/components/forms/form-theme-scope'
import { FormLookupProvider } from '@/components/forms/lookup-field'
import { FormButtonBar, FormHeaderBlock, FormMessages } from '@/components/forms/form-shell'
import { FormPagesProvider, FormStepActions } from '@/components/forms/form-pages'
import { usePageBreadcrumbs } from '@/lib/breadcrumbs-context'
import { serverRead } from '@/lib/server-read'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { normalizeFormButtons, type FormButton } from '@/lib/forms/buttons'
import { formCardWidth } from '@/lib/forms/form-width'
import { withFormContext } from '@/lib/forms/form-params'
import { openingFieldDefaults } from '@/lib/forms/preview-inputs'
import { formDesignerHref } from '@/lib/forms/designer-links'
import type { FormThemeOverrides } from '@/lib/forms/form-theme'
import { formatRelative } from '@/lib/format/date'
import { validateTaskFieldValues } from '@/lib/task-field-schema'
import { cn } from '@/lib/utils'

/**
 * The draft preview (/forms/<id>/draft-preview, lib/services/form-design-
 * drafts.ts getDraftPreview): a form draft drawn as its page will draw it,
 * for the editors and the people it was shared with. Test mode: buttons
 * check the answers in the browser and say what would happen — nothing is
 * submitted, no workflow starts, uploads are off (as in the designer's
 * Preview).
 */

type Preview = {
  form: { id: string; name: string; published_version: number }
  definition: { fields: unknown[]; layout: unknown; theme: unknown; buttons: unknown[] | null; header: unknown }
  theme_overrides: FormThemeOverrides | null
  updated_at: string
  updated_by: { id: string; name: string } | null
  access: 'editor' | 'reviewer'
  shared_by: { id: string; name: string } | null
}

export function DraftPreviewPage({ formId }: { formId: string }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['form-draft-preview', formId],
    retry: false,
    // Access ends at publish / discard / removal: never served from the persisted cache.
    meta: { persist: false },
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const result = await serverRead('forms.draftPreview', { id: formId })
      if (result.error) throw new Error(result.error.message)
      return result.data as Preview
    },
  })
  usePageBreadcrumbs(data ? [{ label: 'Draft preview' }, { label: data.form.name }] : [{ label: 'Draft preview' }])

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 py-6" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    )
  }
  if (error || !data) {
    return (
      <EmptyState variant="no-results" title="Draft not available" data-form-draft-preview-missing=""
        description={error instanceof Error ? error.message : 'This draft is no longer shared with you — it may have been published or discarded.'}
        action={{ label: 'Go home', href: '/home' }} />
    )
  }
  return <DraftPreviewForm preview={data} />
}

function DraftPreviewForm({ preview }: { preview: Preview }) {
  const def = useMemo(() => normalizeFormDefinition(preview.definition), [preview.definition])
  const buttons = useMemo(() => normalizeFormButtons(def.buttons ?? null).filter((b) => b.kind !== 'draft'), [def.buttons])
  const defaults = useMemo(() => openingFieldDefaults(def.fields, null), [def.fields])
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [result, setResult] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const shown = { ...defaults, ...values }
  const overrides = def.header?.enabled && preview.theme_overrides?.header ? { ...preview.theme_overrides, header: undefined } : preview.theme_overrides
  const width = formCardWidth(preview.theme_overrides, def.fields)

  function press(button: FormButton) {
    setResult(null)
    if (button.kind === 'cancel') { setValues({}); setErrors({}); setRound((n) => n + 1); return }
    const found = validateTaskFieldValues(def.fields, shown, { layout: def.layout, buttonIds: [button.id] })
    setErrors(found)
    if (Object.keys(found).length) return
    setResult(`Test only: “${button.label}” would submit these answers. Nothing was sent and no workflow started.`)
  }

  return (
    <div className="space-y-4 py-2" data-form-draft-preview={preview.form.id}>
      <InlineNotice tone="warning" title={`Draft preview — “${preview.form.name}”`}
        actions={preview.access === 'editor' ? <Button size="sm" variant="ghost" asChild><Link href={formDesignerHref(preview.form.id)}>Open in designer</Link></Button> : undefined}>
        <p className="text-fg-muted">
          {preview.access === 'reviewer' && preview.shared_by ? `${preview.shared_by.name} shared this draft with you. ` : ''}
          It isn&apos;t published yet: people filling the form still see version {preview.form.published_version}. Try it out — nothing you enter is submitted.
          {' '}Last saved {formatRelative(preview.updated_at)}{preview.updated_by ? ` by ${preview.updated_by.name}` : ''}.
        </p>
      </InlineNotice>
      <div className={cn('mx-auto', width.className)} style={width.style as React.CSSProperties}>
        <FormThemeScope overrides={overrides} page>
          <FormHeaderBlock header={def.header ?? (preview.theme_overrides?.header?.enabled ? null : { enabled: true, image: 'none', title: preview.form.name, align: 'left' })} values={withFormContext(def.layout, shown)} overrides={preview.theme_overrides} />
          <FormLookupProvider source={{ kind: 'preview' }}>
            <FormPagesProvider key={round} fields={def.fields} layout={def.layout} values={shown} errors={errors} idPrefix="draft-field-">
              <FormRenderer idPrefix="draft-field-" fields={def.fields} layout={def.layout} values={shown} errors={errors}
                labelPosition={preview.theme_overrides?.label_position} density={preview.theme_overrides?.density}
                onChange={(key, value) => {
                  setValues((prev) => ({ ...prev, [key]: value }))
                  setErrors((prev) => { if (!prev[key]) return prev; const next = { ...prev }; delete next[key]; return next })
                }} />
              {result && <FormMessages messages={[{ text: result, tone: 'info' }]} onDismiss={() => setResult(null)} />}
              <FormStepActions>
                <FormButtonBar buttons={buttons} placement={preview.theme_overrides?.button_placement} busy={null} onClick={press} />
              </FormStepActions>
            </FormPagesProvider>
          </FormLookupProvider>
        </FormThemeScope>
      </div>
      <p className="flex items-center justify-center gap-1.5 text-xs text-fg-muted"><FlaskConical className="size-3.5" aria-hidden /> Test mode <Eye className="ml-2 size-3.5" aria-hidden /> Read only</p>
    </div>
  )
}
