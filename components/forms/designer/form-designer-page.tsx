'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ClipboardPen, Copy, Download, FileText, Inbox, Link2, QrCode, Shield, Trash2 } from 'lucide-react'
import { Tag } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { DesktopOnly } from '@/components/layout/desktop-only'
import { ExportAssetDialog } from '@/components/shared/config-transfer'
import { useJobs } from '@/components/jobs/jobs-provider'
import { usePermissions } from '@/lib/permissions-context'
import { usePageBreadcrumbs } from '@/lib/breadcrumbs-context'
import { serverRead } from '@/lib/server-read'
import { createForm, createFormTheme, deleteForm, duplicateForm, updateForm } from '@/app/actions/forms'
import { listWizardProjects } from '@/app/actions/form-wizard'
import { normalizeFormDefinition, type FormDefinition } from '@/lib/forms/definition'
import type { FormThemeOverrides } from '@/lib/forms/form-theme'
import { publicFormPageUrl } from '@/lib/forms/form-page-url'
import { AVAILABLE_FORMS_QUERY_KEY } from '@/lib/forms/available-forms'
import { FORMS_LIBRARY_HREF, formDesignerHref } from '@/lib/forms/designer-links'
import { useAssistantChanges, type AssistantChange } from '@/lib/assistants/client-registry'
import { defaultTaskFieldValues } from '@/lib/task-field-schema'
import { formCardWidthClass, formWidthStyle } from '@/lib/forms/form-width'
import { cn } from '@/lib/utils'
import { FormRenderer } from '@/components/forms/form-renderer'
import { FormThemeScope } from '@/components/forms/form-theme-scope'
import { FormSubmissionsPanel } from '@/components/forms/form-submissions-panel'
import { FormQrDialog } from '@/components/forms/form-qr-dialog'
import { FormAccessSections, FormDetailsEditor, parseTags, type FormDetailsDraft } from '@/components/forms/form-details-editor'
import type { FormDetail } from '@/components/forms/forms-library-parts'
import { FormDesigner, type DesignerAction, type DesignerPageChrome } from './form-designer'
import type { SavedFormTheme } from './theme-editor'

/**
 * A reusable form's full-page designer (/automations/forms/<id>, and
 * /automations/forms/new before it is created): the shared FormDesigner in
 * its page frame, with the library's actions around it — Save (a new
 * version: linked drafts follow it, published workflows keep their pinned
 * one), rename in place, Open form, copy link / QR & embed / submissions /
 * duplicate / export / the wizard / delete, and Form and Access tabs.
 * Without forms.edit it is read only. Phones get the "Open on desktop"
 * notice with the form, read only. A change the Agent makes (confirmed)
 * reloads the designer on the new version.
 */

type PageForm = FormDetail & { available_in_menu?: boolean; system_name?: string | null; header?: unknown }
type ThemeRow = SavedFormTheme & { description: string | null; updated_at: string }

const EMPTY_FORM: FormDefinition = { fields: [], layout: { rows: [] }, theme: { source: 'workspace' } }
const NEW_DRAFT: FormDetailsDraft = { name: 'Untitled form', description: '', tags: '', available: false, systemName: '' }

export function FormDesignerPage({ formId }: { formId: string | null }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const jobs = useJobs()
  const { can } = usePermissions()
  const canEdit = can('forms.edit')
  const canSubmit = can('forms.submit')
  const canDelete = can('forms.delete')
  const canWizard = can('forms.wizard')
  const isNew = formId === null

  const { data: form, isLoading, refetch } = useQuery({
    queryKey: ['form', formId],
    enabled: !isNew,
    queryFn: async () => ((await serverRead('forms.get', { id: formId! })).data ?? null) as PageForm | null,
  })
  const { data: themes = [] } = useQuery({
    queryKey: ['form-themes'],
    queryFn: async () => ((await serverRead('forms.themes')).data ?? []) as ThemeRow[],
  })
  const { data: submissions = null } = useQuery({
    queryKey: ['form-submissions-count', formId],
    enabled: !isNew && canSubmit,
    queryFn: async () => ((await serverRead('forms.submissions', { form_id: formId! })).data as { total?: number } | null)?.total ?? null,
  })
  // "Edit with the wizard": the wizard project that made this form (the person's own).
  const { data: wizardProjectId = null } = useQuery({
    queryKey: ['form-wizard-project-of', formId],
    enabled: !isNew && canWizard,
    queryFn: async () => {
      const result = await listWizardProjects()
      return result.ok ? (result.data.find((p) => p.form_id === formId)?.id ?? null) : null
    },
  })

  // The Agent changed this form (a confirmed change): reload it and remount the designer on it.
  const [agentRev, setAgentRev] = useState(0)
  useAssistantChanges(useCallback((change: AssistantChange) => {
    if (change.kind !== 'form' || !formId || change.id !== formId) return
    void refetch().then(() => setAgentRev((r) => r + 1))
  }, [formId, refetch]))

  const [draft, setDraft] = useState<FormDetailsDraft>(NEW_DRAFT)
  const [dialog, setDialog] = useState<'qr' | 'export' | 'delete' | 'submissions' | null>(null)
  const name = isNew ? (draft.name.trim() || 'Untitled form') : form?.name ?? 'Form'
  usePageBreadcrumbs(isNew || form ? [{ label: 'Forms', href: FORMS_LIBRARY_HREF }, { label: name }] : null)

  // The definition the designer starts from: fixed per load (a save keeps the designer open; the Agent remounts it).
  const loadedKey = form ? `${form.id}:${agentRev}` : isNew ? 'new' : ''
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per load / Agent change, not per refetch after a save
  const initial = useMemo(() => (form ? normalizeFormDefinition(form) : EMPTY_FORM), [loadedKey])

  const refreshLists = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['forms-library'] }),
    queryClient.invalidateQueries({ queryKey: AVAILABLE_FORMS_QUERY_KEY }),
  ])
  const refresh = async () => { await Promise.all([refetch(), refreshLists()]) }

  async function saveTheme(themeName: string, overrides: FormThemeOverrides): Promise<{ id: string } | { error: string }> {
    const result = await createFormTheme({ name: themeName, overrides })
    if (!result.ok) return { error: result.error }
    await queryClient.invalidateQueries({ queryKey: ['form-themes'] })
    return { id: result.data.id }
  }

  async function copyLink() {
    if (!form) return
    // The friendly link (acme.usertasks.com/form/<name>) when the workspace has an address, else /f/<id>.
    const friendly = await serverRead('forms.friendlyLink', { form_id: form.id }).then((r) => r.data?.friendly_url ?? null).catch(() => null)
    try { await navigator.clipboard.writeText(friendly ?? publicFormPageUrl(form.id)); jobs.notify({ tone: 'success', title: 'Link copied' }) } catch { jobs.notify({ tone: 'error', title: 'Could not copy the link' }) }
  }

  if (!isNew && isLoading) return <FormDesignerSkeleton />
  if (!isNew && !form) {
    return (
      <EmptyState variant="no-results" title="Form not found" description="It may have been deleted, or you don't have access to it."
        action={{ label: 'Back to forms', href: FORMS_LIBRARY_HREF }} />
    )
  }

  const version = form?.version ?? null
  const actions: DesignerAction[] = !canEdit ? [] : [{
    id: 'save',
    label: form ? `Save version ${form.version + 1}` : 'Create form',
    hint: form ? `Saves version ${form.version + 1}: linked drafts follow it, published workflows keep their pinned version` : 'Create the form in the Forms library',
    run: async (def) => {
      const content = { fields: def.fields, layout: def.layout, theme: def.theme, buttons: def.buttons ?? null, header: def.header ?? null }
      if (form) {
        const result = await updateForm(form.id, content)
        if (!result.ok) return result.error
        jobs.notify({ tone: 'success', title: `Saved version ${result.data.version}` })
        return null
      }
      const result = await createForm({ name: draft.name.trim() || 'Untitled form', description: draft.description.trim(), tags: parseTags(draft.tags), available_in_menu: draft.available, ...content })
      if (!result.ok) return result.error
      jobs.notify({ tone: 'success', title: `Created "${result.data.name}"` })
      await refreshLists()
      router.replace(formDesignerHref(result.data.id))
      return null
    },
  }]

  const pills = (
    <>
      {form?.available_in_menu && <Tag className="shrink-0 text-primary-text max-lg:hidden" data-form-available="">In menu</Tag>}
      {(form?.tags ?? parseTags(draft.tags)).slice(0, 3).map((t) => <Tag key={t} className="max-w-[8rem] shrink-0 truncate max-xl:hidden">{t}</Tag>)}
    </>
  )

  const chrome: DesignerPageChrome = {
    backHref: FORMS_LIBRARY_HREF,
    backLabel: 'Back to forms',
    readOnly: !canEdit,
    pills,
    submissions: canSubmit ? submissions : null,
    openHref: form && canSubmit ? `/f/${form.id}` : null,
    onRename: async (next) => {
      if (!form) { setDraft((d) => ({ ...d, name: next })); return null }
      const result = await updateForm(form.id, { name: next })
      if (!result.ok) return result.error
      await refresh()
      return null
    },
    onSaved: () => { void refresh() },
    // Form settings and Access need forms.edit (a viewer sees the designer read only).
    extraTabs: !canEdit ? [] : [
      {
        value: 'settings', label: 'Form',
        render: () => (
          <FormDetailsEditor key={form ? `${form.id}:${form.name}:${form.updated_at}` : 'new'} idPrefix="designer-form" form={form ?? null}
            draft={draft} onDraftChange={setDraft}
            onNotice={(n) => jobs.notify({ tone: n.tone, title: n.message })}
            onSaved={async (message) => { jobs.notify({ tone: 'success', title: message }); await refresh() }} />
        ),
      },
      ...(form ? [{
        value: 'access', label: 'Access',
        render: () => <div className="space-y-4" data-designer-access=""><FormAccessSections formId={form.id} formName={form.name} /></div>,
      }] : []),
    ],
    menu: (api) => form ? (
      <>
        {canSubmit && <DropdownMenuItem icon={<Link2 />} onSelect={() => void copyLink()}>Copy link</DropdownMenuItem>}
        {canSubmit && <DropdownMenuItem icon={<QrCode />} onSelect={() => setDialog('qr')} data-form-qr-button="">QR code &amp; embed…</DropdownMenuItem>}
        {canSubmit && <DropdownMenuItem icon={<Inbox />} onSelect={() => setDialog('submissions')} data-testid="form-submissions-button">Submissions</DropdownMenuItem>}
        {canEdit && <DropdownMenuItem icon={<Shield />} onSelect={() => api.setTab('access')}>Access &amp; sharing</DropdownMenuItem>}
        {canEdit && <DropdownMenuItem icon={<FileText />} onSelect={() => api.setTab('settings')}>Form settings</DropdownMenuItem>}
        {canEdit && wizardProjectId && (
          <DropdownMenuItem asChild>
            <Link href={`/forms/wizard/${wizardProjectId}`}><ClipboardPen className="size-4 text-fg-muted" aria-hidden="true" /><span className="flex-1">Edit with the wizard</span></Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {canEdit && (
          <DropdownMenuItem icon={<Copy />} onSelect={async () => {
            const result = await duplicateForm(form.id)
            if (!result.ok) { jobs.notify({ tone: 'error', title: result.error }); return }
            jobs.notify({ tone: 'success', title: `Duplicated as "${result.data.name}"` })
            await refreshLists()
            router.push(formDesignerHref(result.data.id))
          }}>Duplicate</DropdownMenuItem>
        )}
        <DropdownMenuItem icon={<Download />} onSelect={() => setDialog('export')} data-testid="export-asset">Export…</DropdownMenuItem>
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger icon={<Trash2 />} onSelect={() => setDialog('delete')}>Delete form</DropdownMenuItem>
          </>
        )}
      </>
    ) : null,
  }

  const overrides = themeOverridesOf(initial, themes)

  return (
    <DesktopOnly action={{ label: 'Back to forms', href: FORMS_LIBRARY_HREF }} preview={<ReadOnlyFormPreview definition={initial} overrides={overrides} />}>
      <div className="h-[calc(100vh-7rem)]" data-testid="form-designer-page">
        <FormDesigner
          key={loadedKey}
          chrome="page"
          page={chrome}
          onClose={() => router.push(FORMS_LIBRARY_HREF)}
          title={name}
          badge={version ? `v${version}` : 'New'}
          formId={form?.id}
          subtitle={form ? `Saving changes to fields, layout or theme creates version ${form.version + 1}; linked drafts follow it, published workflows keep their pinned version. Name, tags and settings don't create a version.` : 'Reusable form: link it from any User Task or task trigger.'}
          initial={initial}
          savedThemes={themes}
          canSaveTheme={canEdit}
          onSaveTheme={saveTheme}
          actions={actions}
        />
      </div>
      {form && dialog === 'qr' && <FormQrDialog formId={form.id} open onOpenChange={(open) => { if (!open) setDialog(null) }} />}
      {form && dialog === 'export' && <ExportAssetDialog ids={[form.id]} name={form.name} open onOpenChange={(open) => { if (!open) setDialog(null) }} />}
      <FormSubmissionsPanel form={form && dialog === 'submissions' ? { id: form.id, name: form.name, fields: form.fields } : null} onClose={() => setDialog(null)} />
      {form && (
        <ConfirmDialog
          open={dialog === 'delete'}
          onOpenChange={(open) => { if (!open) setDialog(null) }}
          title={`Delete “${form.name}”?`}
          description="The form and all its versions are deleted. Forms that workflows still use can't be deleted."
          confirmLabel="Delete form"
          destructive
          onConfirm={async () => {
            const result = await deleteForm(form.id)
            setDialog(null)
            if (!result.ok) { jobs.notify({ tone: 'error', title: result.error }); return }
            jobs.notify({ tone: 'success', title: `Deleted "${form.name}"` })
            await refreshLists()
            router.push(FORMS_LIBRARY_HREF)
          }}
        />
      )}
    </DesktopOnly>
  )
}

/** The form's theme overrides (custom, or a saved theme's), for the read-only phone preview. */
function themeOverridesOf(def: FormDefinition, themes: SavedFormTheme[]): FormThemeOverrides | null {
  const ref = def.theme
  if (ref.source === 'custom') return ref.overrides
  if (ref.source === 'saved') return themes.find((t) => t.id === ref.theme_id)?.overrides ?? null
  return null
}

/** Phones: the form as it renders, read only, under the "Open on desktop to edit" notice. */
function ReadOnlyFormPreview({ definition, overrides }: { definition: FormDefinition; overrides: FormThemeOverrides | null }) {
  const values = useMemo(() => defaultTaskFieldValues(definition.fields), [definition.fields])
  if (!definition.fields.length) return null
  return (
    <div className={cn('mx-auto w-full', formCardWidthClass(overrides, definition.fields))} style={formWidthStyle(overrides) as React.CSSProperties} data-form-readonly-preview="">
      <FormThemeScope overrides={overrides} page>
        <FormRenderer idPrefix="readonly-" fields={definition.fields} layout={definition.layout} values={values} readOnly singleColumn
          labelPosition={overrides?.label_position} density={overrides?.density} />
      </FormThemeScope>
    </div>
  )
}

/** The designer page's layout while the form loads: toolbar | palette, canvas, properties (as the workflow builder's). */
export function FormDesignerSkeleton() {
  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col" aria-busy="true" aria-label="Loading form">
      <div className="mb-2 flex h-12 shrink-0 items-center gap-3 rounded-lg border border-border bg-panel px-3">
        <ArrowLeft className="size-4 text-fg-muted" aria-hidden="true" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-5 w-10 rounded-full" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-28" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="w-60 shrink-0 space-y-2 rounded-lg border border-border bg-panel p-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
        </div>
        <div className="min-w-0 flex-1 space-y-3 rounded-lg border border-border bg-bg p-6">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
        <div className="w-[24rem] shrink-0 space-y-4 rounded-lg border border-border bg-panel p-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-2.5 w-1/3" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
