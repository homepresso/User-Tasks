'use client'

/**
 * "My forms" (/forms/wizard): the forms the person made with the wizard and
 * their unfinished drafts — open the results, edit with the wizard, resume
 * or discard a draft — and the way into a new one.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BarChart3, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { formatRelative } from '@/lib/format/date'
import type { WizardProject } from '@/lib/services/form-wizard'
import { discardWizardDraft, listWizardProjects } from '@/app/actions/form-wizard'

export function WizardList() {
  const [projects, setProjects] = useState<WizardProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = async () => {
    const res = await listWizardProjects()
    if (res.ok) setProjects(res.data); else setError(res.error)
  }
  useEffect(() => { void load() }, [])
  const discard = async (id: string) => {
    const res = await discardWizardDraft(id)
    if (res.ok) void load(); else setError(res.error)
  }
  const newButton = <Button asChild leadingIcon={<Plus />}><Link href="/forms/wizard/new" data-testid="wizard-new">Build a form</Link></Button>
  return (
    <div className="space-y-4" data-testid="wizard-list">
      <PageHeader title="My forms" description="Forms, surveys and questionnaires you built with the form wizard." actions={newButton} />
      {error && <InlineNotice tone="danger" message={error} />}
      {!projects ? <PageSkeleton variant="list" /> : projects.length === 0 ? (
        <EmptyState icon={FileText} title="Build your first form" description="Answer a few simple questions: we make the form, a table for the responses, any approvals and a results page." action={{ label: "Build a form", href: "/forms/wizard/new" }} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Card padding="md" className="flex h-full flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-fg">{p.name}</div>
                    <div className="text-xs text-fg-muted">Changed {formatRelative(p.updated_at)}</div>
                  </div>
                  {p.status === 'draft' ? <Badge tone="warning">Draft</Badge> : p.draft ? <Badge tone="info">Unsaved changes</Badge> : <Badge tone="success">Live</Badge>}
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  {p.status === 'created' ? (
                    <>
                      <Button asChild size="sm" variant="secondary" leadingIcon={<BarChart3 />}><Link href={`/forms/results/${p.id}`}>Results</Link></Button>
                      {p.form_id && <Button asChild size="sm" variant="ghost"><Link href={`/fill/${p.form_id}`}>Open form</Link></Button>}
                      <Button asChild size="sm" variant="ghost" leadingIcon={<Pencil />}><Link href={`/forms/wizard/${p.id}`}>Edit</Link></Button>
                    </>
                  ) : (
                    <>
                      <Button asChild size="sm" variant="secondary" leadingIcon={<Pencil />}><Link href={`/forms/wizard/${p.id}`}>Continue</Link></Button>
                      <Button size="sm" variant="ghost" leadingIcon={<Trash2 />} onClick={() => discard(p.id)}>Discard</Button>
                    </>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
