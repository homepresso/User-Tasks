import type { Metadata } from 'next'
import { FormDesignerPage } from '@/components/forms/designer/form-designer-page'
import { stepFromQuery } from '@/lib/forms/designer-step'
import { EmbeddedDesignerShell } from '@/components/embed/designer-shell'
import { embedDesignerGate, type Query } from '@/lib/embed/designer-route'

/**
 * Embedded form designer (lib/embed/designers.ts): the designer of
 * /automations/forms/<id> without the app shell, for a page on an approved
 * site. Same component (save draft, publish, preview, version history,
 * settings, access), same permissions (forms.view to open, read only
 * without forms.edit).
 */

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Form designer', robots: { index: false, follow: false } }

export default async function EmbeddedFormDesigner({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params
  const query = await searchParams
  const gate = await embedDesignerGate({ kind: 'form', id, embedPath: `/embed/forms/${id}/design`, appPath: `/automations/forms/${id}`, query, allOf: ['forms.view'] })
  if (gate.kind === 'node') return gate.node
  return (
    <EmbeddedDesignerShell {...gate.shell}>
      {/* Launched from a User Task of an embedded workflow (?workflow=&step=): that step's workflow data. */}
      <FormDesignerPage formId={gate.shell.id} step={stepFromQuery(query as Record<string, string | string[] | undefined>)} />
    </EmbeddedDesignerShell>
  )
}
