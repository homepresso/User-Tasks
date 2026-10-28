'use client'

import { useMemo, useState } from 'react'
import { normalizeFormButtons } from '@/lib/forms/buttons'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDown, ChevronRight, Copy, ExternalLink, FileText, Inbox, Link2, Palette, PencilRuler, Plus, Search, Settings2, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ExportAssetButton, ImportConfigButton } from '@/components/shared/config-transfer'
import { usePermissions } from '@/lib/permissions-context'
import { serverRead } from '@/lib/server-read'
import { formatRelativeDate } from '@/lib/utils'
import { createForm, createFormTheme, deleteForm, deleteFormTheme, duplicateForm, updateForm, updateFormTheme } from '@/app/actions/forms'
import { normalizeFormDefinition, type FormDefinition } from '@/lib/forms/definition'
import { blockingFormThemeIssues, type FormThemeOverrides, type FormThemeRef } from '@/lib/forms/form-theme'
import { defaultTaskFieldValues, type TaskFieldDef } from '@/lib/task-field-schema'
import { FormDesignerDialog } from './designer/form-designer-dialog'
import { ThemeEditor, type SavedFormTheme } from './designer/theme-editor'
import { FormRenderer } from './form-renderer'
import { FormSubmissionsPanel } from './form-submissions-panel'
import { FormThemeScope } from './form-theme-scope'
import { FormQrButton } from './form-qr-dialog'
import { publicFormPageUrl } from '@/lib/forms/form-page-url'

/* eslint-disable @typescript-eslint/no-explicit-any -- service rows */

/**
 * Forms library (Automations → Forms): reusable task forms — list, search,
 * tags, create / edit (the designer) / details / duplicate / delete, where
 * each form is used — and the reusable Form themes.
 */

interface FormListItem {
  id: string; name: string; description: string | null; tags: string[]; version: number
  field_count: number; theme_source: string; usage_count: number; updated_at: string
  form_page_of?: { workflow_id: string; workflow_name: string | null } | null
}

interface FormDetail {
  id: string; name: string; description: string | null; tags: string[]; version: number
  fields: unknown[]; layout: unknown; theme: unknown; updated_at: string
  usages: Array<{ workflow_id: string; workflow_name: string; node_id: string; node_label: string; node_type?: string; where: 'draft' | 'published'; pinned_version: number | null }>
  buttons?: unknown[] | null
}

/** The workflows a form starts: "Form submitted" triggers on it and its buttons' "Start workflow" actions. */
function formStarts(form: FormDetail): Array<{ workflow_id: string; workflow_name: string; via: string }> {
  const out: Array<{ workflow_id: string; workflow_name: string; via: string }> = []
  const seen = new Set<string>()
  for (const u of form.usages) {
    if (u.node_type !== 'form_submitted' || seen.has(`${u.workflow_id}-t`)) continue
    seen.add(`${u.workflow_id}-t`)
    out.push({ workflow_id: u.workflow_id, workflow_name: u.workflow_name, via: 'Form submitted trigger' })
  }
  for (const b of normalizeFormButtons(form.buttons ?? null)) {
    for (const a of b.actions ?? []) {
      if (a.type !== 'start_workflow' || !a.workflow_id || seen.has(`${a.workflow_id}-${b.id}`)) continue
      seen.add(`${a.workflow_id}-${b.id}`)
      out.push({ workflow_id: a.workflow_id, workflow_name: a.workflow_name ?? 'Workflow', via: a.start_form_page ? `form page of its start form (“${b.label}” button)` : `“${b.label}” button` })
    }
  }
  return out
}

const EMPTY_FORM: FormDefinition = { fields: [], layout: { rows: [] }, theme: { source: 'workspace' } }

export function FormsLibrary() {
  const { can } = usePermissions()
  const canEdit = can('forms.edit')
  const canDelete = can('forms.delete')
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'forms' | 'themes'>('forms')
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [designing, setDesigning] = useState<{ form: FormDetail | null; details?: { name: string; description: string; tags: string[] } } | null>(null)
  const [details, setDetails] = useState<{ form: FormListItem | null; name: string; description: string; tags: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<FormListItem | null>(null)
  const [submissionsOf, setSubmissionsOf] = useState<FormListItem | null>(null)
  const canSubmit = can('forms.submit')

  const { data, isLoading } = useQuery({
    queryKey: ['forms-library', 'list'],
    queryFn: async () => ((await serverRead('forms.list', {})).data as { forms: FormListItem[] } | null)?.forms ?? [],
  })
  const { data: themes = [] } = useQuery({
    queryKey: ['form-themes'],
    queryFn: async () => ((await serverRead('forms.themes')).data ?? []) as Array<SavedFormTheme & { description: string | null; updated_at: string }>,
  })
  const { data: expandedForm } = useQuery({
    queryKey: ['form', expanded],
    enabled: Boolean(expanded),
    queryFn: async () => (await serverRead('forms.get', { id: expanded! })).data as FormDetail | null,
  })

  const forms = useMemo(() => data ?? [], [data])
  const allTags = useMemo(() => [...new Set(forms.flatMap((f) => f.tags))].sort(), [forms])
  const q = search.trim().toLowerCase()
  const shown = forms.filter((f) => (!tag || f.tags.includes(tag)) && (!q || f.name.toLowerCase().includes(q) || (f.description ?? '').toLowerCase().includes(q) || f.tags.some((t) => t.includes(q))))

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['forms-library'] }),
    queryClient.invalidateQueries({ queryKey: ['form'] }),
  ])

  async function openDesigner(item: FormListItem) {
    const result = await serverRead('forms.get', { id: item.id })
    if (!result.data) { setNotice({ tone: 'error', message: 'The form could not be loaded' }); return }
    setDesigning({ form: result.data as FormDetail })
  }

  async function saveTheme(name: string, overrides: FormThemeOverrides): Promise<{ id: string } | { error: string }> {
    const result = await createFormTheme({ name, overrides })
    if (!result.ok) return { error: result.error }
    await queryClient.invalidateQueries({ queryKey: ['form-themes'] })
    return { id: result.data.id }
  }

  return (
    <div className="space-y-4" data-testid="forms-library">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border p-0.5" style={{ borderColor: 'var(--theme-surface-border)' }} role="tablist">
          {([['forms', 'Forms', FileText], ['themes', 'Form themes', Palette]] as const).map(([t, label, Icon]) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className="flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium"
              style={tab === t ? { backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' } : { color: 'var(--theme-card-text)' }}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {tab === 'forms' && canEdit && <ImportConfigButton size="default" onImported={() => void refresh()} />}
        {tab === 'forms' && canEdit && (
          <Button onClick={() => setDetails({ form: null, name: '', description: '', tags: '' })} data-testid="new-form"><Plus size={14} /> New form</Button>
        )}
      </div>

      {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}

      {tab === 'forms' ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} aria-hidden />
              <Input aria-label="Search forms" className="pl-9" placeholder="Search forms" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {allTags.map((t) => (
              <button key={t} type="button" aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}
                className="rounded-full border px-2.5 py-1 text-[11px]"
                style={tag === t ? { backgroundColor: 'var(--theme-primary)', borderColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' } : { borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}>
                {t}
              </button>
            ))}
          </div>

          {isLoading ? null : shown.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={forms.length === 0 ? 'No reusable forms yet' : 'No forms match'}
              description={forms.length === 0 ? 'Design a form once and use it on any User Task or task trigger. Linked steps follow new versions; published workflows pin theirs.' : 'Try another search or tag.'}
            />
          ) : (
            <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
              {shown.map((form) => {
                const open = expanded === form.id
                return (
                  <div key={form.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--theme-surface-border)' }} data-form-id={form.id}>
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <button type="button" onClick={() => setExpanded(open ? null : form.id)} className="rounded p-0.5" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} where "${form.name}" is used`}>
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>
                          {form.name} <span className="ml-1 rounded-full border px-1.5 text-[10px] font-normal" style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}>v{form.version}</span>
                        </p>
                        <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
                          {form.field_count} field{form.field_count === 1 ? '' : 's'} · used by {form.usage_count} step{form.usage_count === 1 ? '' : 's'} · {form.theme_source === 'workspace' ? 'workspace theme' : 'custom theme'} · updated {formatRelativeDate(form.updated_at)}
                          {form.description && ` · ${form.description}`}
                        </p>
                        {form.form_page_of && (
                          <p className="mt-0.5 text-[11px]" data-form-page-of={form.form_page_of.workflow_id}>
                            <span style={{ color: 'var(--theme-muted-text)' }}>Form page · starts </span>
                            <Link href={`/automations/${form.form_page_of.workflow_id}`} className="font-medium underline-offset-2 hover:underline" style={{ color: 'var(--theme-primary-text)' }}>{form.form_page_of.workflow_name ?? 'its workflow'}</Link>
                          </p>
                        )}
                        {form.tags.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{form.tags.map((t) => <span key={t} className="rounded-full border px-1.5 text-[10px]" style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}>{t}</span>)}</p>}
                      </div>
                      <div className="flex items-center gap-1">
                        {canSubmit && (
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/f/${form.id}`} data-testid="open-form"><ExternalLink size={12} /> Open form</Link>
                          </Button>
                        )}
                        {canSubmit && (
                          <Button size="sm" variant="ghost" aria-label={`Copy the link to ${form.name}`} title="Copy link" onClick={async () => {
                            try { await navigator.clipboard.writeText(publicFormPageUrl(form.id)); setNotice({ tone: 'success', message: 'Link copied' }) } catch { setNotice({ tone: 'error', message: 'Could not copy the link' }) }
                          }}><Link2 size={12} /></Button>
                        )}
                        {canSubmit && <FormQrButton formId={form.id} />}
                        {canSubmit && (
                          <Button size="sm" variant="ghost" onClick={() => setSubmissionsOf(form)} data-testid="form-submissions-button" aria-label={`Submissions of ${form.name}`} title="Submissions"><Inbox size={12} /></Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => void openDesigner(form)} data-testid="edit-form"><PencilRuler size={12} /> {canEdit ? 'Edit' : 'View'}</Button>
                        {canEdit && <Button size="sm" variant="ghost" onClick={() => setDetails({ form, name: form.name, description: form.description ?? '', tags: form.tags.join(', ') })} aria-label={`Details of ${form.name}`}><Settings2 size={12} /></Button>}
                        {canEdit && (
                          <Button size="sm" variant="ghost" aria-label={`Duplicate ${form.name}`} onClick={async () => {
                            const result = await duplicateForm(form.id)
                            setNotice(result.ok ? { tone: 'success', message: `Duplicated as "${result.data.name}"` } : { tone: 'error', message: result.error })
                            await refresh()
                          }}><Copy size={12} /></Button>
                        )}
                        <ExportAssetButton ids={[form.id]} name={form.name} iconOnly variant="ghost" />
                        {canDelete && <Button size="sm" variant="ghost" aria-label={`Delete ${form.name}`} onClick={() => setConfirmDelete(form)}><Trash2 size={12} /></Button>}
                      </div>
                    </div>
                    {open && expandedForm && (() => {
                      const starts = formStarts(expandedForm)
                      if (!starts.length) return null
                      return (
                        <div className="px-11 pb-2 text-xs" data-testid="form-starts">
                          <p className="mb-1 font-medium" style={{ color: 'var(--theme-card-text)' }}>Submitting this form starts</p>
                          <ul className="space-y-1">
                            {starts.map((st) => (
                              <li key={`${st.workflow_id}-${st.via}`}>
                                <Link href={`/automations/${st.workflow_id}`} className="font-medium underline-offset-2 hover:underline" style={{ color: 'var(--theme-primary-text)' }}>{st.workflow_name}</Link>
                                <span style={{ color: 'var(--theme-muted-text)' }}> · {st.via}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    })()}
                    {open && (
                      <div className="px-11 pb-3 text-xs" data-testid="form-usages">
                        {!expandedForm ? <p style={{ color: 'var(--theme-muted-text)' }}>Loading…</p>
                          : expandedForm.usages.length === 0 ? <p style={{ color: 'var(--theme-muted-text)' }}>Not used by any workflow yet. Link it from a User Task or task trigger: Form → Use a saved form.</p>
                          : (
                            <ul className="space-y-1">
                              {expandedForm.usages.map((u, i) => (
                                <li key={i}>
                                  <Link href={`/automations/${u.workflow_id}`} className="font-medium underline-offset-2 hover:underline" style={{ color: 'var(--theme-primary-text)' }}>{u.workflow_name}</Link>
                                  <span style={{ color: 'var(--theme-muted-text)' }}> › {u.node_label} · {u.where === 'published' ? `published, pinned to v${u.pinned_version ?? '?'}` : 'draft, follows the latest version'}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <FormThemesTab themes={themes} canEdit={canEdit} canDelete={canDelete} onNotice={setNotice} />
      )}

      <FormSubmissionsPanel form={submissionsOf} onClose={() => setSubmissionsOf(null)} />

      {/* New form / details */}
      <Dialog.Root open={Boolean(details)} onOpenChange={(open) => { if (!open) setDetails(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" />
          <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl p-5 shadow-xl dialog-content" style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}>
            <div className="mb-3 flex items-center"><Dialog.Title className="flex-1 text-sm font-semibold">{details?.form ? 'Form details' : 'New form'}</Dialog.Title><Dialog.Close aria-label="Close"><X size={14} /></Dialog.Close></div>
            {details && (
              <form className="space-y-3" onSubmit={async (e) => {
                e.preventDefault()
                const tags = details.tags.split(',').map((t) => t.trim()).filter(Boolean)
                if (!details.form) {
                  setDetails(null)
                  setDesigning({ form: null, details: { name: details.name.trim(), description: details.description.trim(), tags } })
                  return
                }
                const result = await updateForm(details.form.id, { name: details.name, description: details.description, tags })
                setNotice(result.ok ? { tone: 'success', message: 'Details saved' } : { tone: 'error', message: result.error })
                if (result.ok) { setDetails(null); await refresh() }
              }}>
                <label className="block text-xs font-medium">Name<Input className="mt-1" required maxLength={120} value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} data-testid="form-name" /></label>
                <label className="block text-xs font-medium">Description<Input className="mt-1" maxLength={2000} value={details.description} onChange={(e) => setDetails({ ...details, description: e.target.value })} /></label>
                <label className="block text-xs font-medium">Tags (comma separated)<Input className="mt-1" value={details.tags} onChange={(e) => setDetails({ ...details, tags: e.target.value })} /></label>
                <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Name, description and tags don&apos;t create a new version; field, layout and theme changes do.</p>
                <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setDetails(null)}>Cancel</Button><Button type="submit" disabled={!details.name.trim()}>{details.form ? 'Save' : 'Continue to designer'}</Button></div>
              </form>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <FormDesignerDialog
        open={Boolean(designing)}
        onClose={() => setDesigning(null)}
        title={designing?.form ? `Form — ${designing.form.name}` : `New form — ${designing?.details?.name ?? ''}`}
        subtitle={designing?.form ? `Version ${designing.form.version}. Saving changes to fields, layout or theme creates version ${designing.form.version + 1}; linked drafts follow it, published workflows keep their pinned version.` : 'Reusable form: link it from any User Task or task trigger.'}
        initial={designing?.form ? normalizeFormDefinition(designing.form) : EMPTY_FORM}
        savedThemes={themes}
        canSaveTheme={canEdit}
        onSaveTheme={saveTheme}
        actions={canEdit ? [{
          id: 'save',
          label: designing?.form ? 'Save new version' : 'Create form',
          run: async (def) => {
            const result = designing?.form
              ? await updateForm(designing.form.id, { fields: def.fields, layout: def.layout, theme: def.theme, buttons: def.buttons ?? null, header: def.header ?? null })
              : await createForm({ ...designing!.details!, fields: def.fields, layout: def.layout, theme: def.theme, buttons: def.buttons ?? null, header: def.header ?? null })
            if (!result.ok) return result.error
            setNotice({ tone: 'success', message: designing?.form ? `Saved version ${result.data.version}` : `Created "${result.data.name}"` })
            await refresh()
            return null
          },
        }] : []}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}
        title="Delete form?"
        description={confirmDelete ? `"${confirmDelete.name}" and all its versions will be deleted. Forms that workflows still use can't be deleted.` : ''}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!confirmDelete) return
          const result = await deleteForm(confirmDelete.id)
          setNotice(result.ok ? { tone: 'success', message: `Deleted "${confirmDelete.name}"` } : { tone: 'error', message: result.error })
          setConfirmDelete(null)
          await refresh()
        }}
      />
    </div>
  )
}

const SAMPLE_FIELDS: TaskFieldDef[] = [
  { key: 'details', label: 'Details', type: 'heading', help_text: 'A sample form for the theme preview' },
  { key: 'full_name', label: 'Full name', type: 'text', required: true, placeholder: 'Jane Doe' },
  { key: 'amount', label: 'Amount', type: 'currency', currency: 'USD' },
  { key: 'category', label: 'Category', type: 'choice', options: ['Travel', 'Equipment', 'Training'] },
  { key: 'agree', label: 'I confirm the details are correct', type: 'boolean' },
]
const SAMPLE_LAYOUT = { rows: [{ columns: 1, cells: [{ field_key: 'details', span: 1 }] }, { columns: 2, cells: [{ field_key: 'full_name', span: 1 }, { field_key: 'amount', span: 1 }] }, { columns: 2, cells: [{ field_key: 'category', span: 1 }, { field_key: 'agree', span: 1 }] }] }

function FormThemesTab({ themes, canEdit, canDelete, onNotice }: {
  themes: Array<SavedFormTheme & { description: string | null; updated_at: string }>
  canEdit: boolean
  canDelete: boolean
  onNotice: (notice: { tone: 'error' | 'success'; message: string }) => void
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<{ id: string | null; name: string; ref: FormThemeRef } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<SavedFormTheme | null>(null)
  const sampleValues = useMemo(() => defaultTaskFieldValues(SAMPLE_FIELDS), [])
  const overrides = editing?.ref.source === 'custom' ? editing.ref.overrides : null
  const blocking = blockingFormThemeIssues(overrides)

  return (
    <div className="space-y-3" data-testid="form-themes">
      <div className="flex justify-end">
        {canEdit && <Button onClick={() => setEditing({ id: null, name: '', ref: { source: 'custom', overrides: {} } })} data-testid="new-form-theme"><Plus size={14} /> New form theme</Button>}
      </div>
      {themes.length === 0 ? (
        <EmptyState icon={Palette} title="No form themes yet" description="A form theme is a small set of overrides on the workspace theme — accent, background, text, radius, font, density, labels and a header. Save one here or from the designer's Form theme tab." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {themes.map((theme) => {
            const light = theme.overrides.colors?.light ?? {}
            return (
              <div key={theme.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                <div className="mb-2 flex gap-1" aria-hidden>
                  {[light.accent, light.background, light.text, theme.overrides.header?.banner_color].filter(Boolean).map((c, i) => <span key={i} className="h-5 w-5 rounded-full border" style={{ backgroundColor: c, borderColor: 'var(--theme-surface-border)' }} />)}
                </div>
                <p className="text-sm font-medium">{theme.name}</p>
                <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>{theme.description || 'Form theme'} · updated {formatRelativeDate(theme.updated_at)}</p>
                <div className="mt-2 flex gap-1">
                  {canEdit && <Button size="sm" variant="outline" onClick={() => setEditing({ id: theme.id, name: theme.name, ref: { source: 'custom', overrides: theme.overrides } })}>Edit</Button>}
                  {canDelete && <Button size="sm" variant="ghost" aria-label={`Delete ${theme.name}`} onClick={() => setConfirmDelete(theme)}><Trash2 size={12} /></Button>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog.Root open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" />
          <Dialog.Content aria-describedby={undefined} onInteractOutside={(e) => e.preventDefault()} className="fixed left-1/2 top-1/2 z-50 flex h-[min(88vh,820px)] w-[min(980px,96vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl shadow-xl dialog-content" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-card-text)' }} data-testid="form-theme-editor">
            <div className="flex items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
              <Dialog.Title className="flex-1 text-sm font-semibold">{editing?.id ? 'Edit form theme' : 'New form theme'}</Dialog.Title>
              <Dialog.Close aria-label="Close"><X size={14} /></Dialog.Close>
            </div>
            {editing && (
              <div className="flex min-h-0 flex-1">
                <div className="w-80 shrink-0 space-y-3 overflow-y-auto border-r p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                  <label className="block text-xs font-medium">Name<Input className="mt-1" maxLength={120} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} data-testid="theme-name" /></label>
                  <ThemeEditor idPrefix="lib-theme" value={editing.ref} onChange={(ref) => setEditing({ ...editing, ref: ref.source === 'custom' ? ref : { source: 'custom', overrides: overrides ?? {} } })} savedThemes={[]} canSaveTheme={false} />
                </div>
                <div className="min-w-0 flex-1 space-y-4 overflow-y-auto p-5">
                  {(['light', 'dark'] as const).map((mode) => (
                    <div key={mode}>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>{mode} mode</p>
                      <FormThemeScope overrides={overrides} mode={mode}>
                        <FormRenderer idPrefix={`theme-${mode}-`} fields={SAMPLE_FIELDS} layout={SAMPLE_LAYOUT} values={sampleValues} onChange={() => {}} labelPosition={overrides?.label_position} density={overrides?.density} />
                      </FormThemeScope>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 border-t px-4 py-2.5" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
              {blocking.length > 0 && <p className="flex-1 text-[11px]" style={{ color: 'var(--status-blocked)' }}>{blocking.join('; ')}</p>}
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
              <Button size="sm" disabled={!editing?.name.trim() || busy || blocking.length > 0} data-action="save-theme" onClick={async () => {
                if (!editing) return
                setBusy(true)
                const result = editing.id
                  ? await updateFormTheme(editing.id, { name: editing.name, overrides: overrides ?? {} })
                  : await createFormTheme({ name: editing.name, overrides: overrides ?? {} })
                setBusy(false)
                if (!result.ok) { onNotice({ tone: 'error', message: result.error }); return }
                onNotice({ tone: 'success', message: `Saved "${result.data.name}"` })
                setEditing(null)
                await queryClient.invalidateQueries({ queryKey: ['form-themes'] })
              }}>{busy ? 'Saving…' : 'Save theme'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}
        title="Delete form theme?"
        description={confirmDelete ? `"${confirmDelete.name}" will be deleted. Themes that forms or steps still use can't be deleted.` : ''}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!confirmDelete) return
          const result = await deleteFormTheme(confirmDelete.id)
          onNotice(result.ok ? { tone: 'success', message: `Deleted "${confirmDelete.name}"` } : { tone: 'error', message: result.error })
          setConfirmDelete(null)
          await queryClient.invalidateQueries({ queryKey: ['form-themes'] })
        }}
      />
    </div>
  )
}
