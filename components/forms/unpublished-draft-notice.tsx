'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { InlineNotice } from '@/components/ui/inline-notice'
import { buttonVariants } from '@/components/ui/button'
import { usePermissions } from '@/lib/permissions-context'
import { serverRead } from '@/lib/server-read'
import { formDesignerHref } from '@/lib/forms/designer-links'

/**
 * On a form's in-app page (/fill/<id>), for its editors: "you are filling
 * in the published version; your saved draft isn't live yet". The designer
 * saves drafts, and the form's pages draw the published version, so an
 * editor who removed the header image and only saved the draft saw the
 * old image here and took it for a bug (customer report, Nov 2026).
 * Nothing for people who can't edit forms (the read needs forms.edit).
 */
export function UnpublishedDraftNotice({ formId }: { formId: string }) {
  const { can } = usePermissions()
  const { data } = useQuery({
    // Same key and freshness as the designer's draft read (components/forms/designer/form-draft-controls.tsx).
    queryKey: ['form-design-draft', formId],
    enabled: can('forms.edit'),
    meta: { persist: false },
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
    queryFn: async () => ((await serverRead('forms.designDraft', { id: formId })).data ?? null) as { form: { version: number }; draft: unknown | null } | null,
  })
  if (!data?.draft) return null
  return (
    <div className="mx-auto mb-3 max-w-3xl" data-unpublished-draft-notice>
      <InlineNotice tone="info"
      title="This is the published version"
      message={`This form has a saved draft that isn't live yet. Publish it in the designer to use it here (published version ${data.form.version}).`}
      actions={<Link href={formDesignerHref(formId)} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Open designer</Link>} />
    </div>
  )
}
