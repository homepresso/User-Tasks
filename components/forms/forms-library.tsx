'use client'

import { FavoriteStar } from '@/components/home/favorite-star'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { ClipboardPen, Copy, Download, FileText, Inbox, Link2, MoreHorizontal, Palette, Plus, QrCode, Settings2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input, SearchInput } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/list-controls'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs } from '@/components/ui/tabs'
import { Tag } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Table, TBody, TD, TH, THead, TR, TableSkeleton } from '@/components/ui/table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ExportAssetDialog, ImportConfigButton } from '@/components/shared/config-transfer'
import { usePermissions } from '@/lib/permissions-context'
import { serverRead } from '@/lib/server-read'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { createForm, createFormTheme, deleteForm, deleteFormTheme, duplicateForm, updateForm, updateFormTheme } from '@/app/actions/forms'
import { normalizeFormDefinition, type FormDefinition } from '@/lib/forms/definition'
import { blockingFormThemeIssues, type FormThemeOverrides, type FormThemeRef } from '@/lib/forms/form-theme'
import { defaultTaskFieldValues, type TaskFieldDef } from '@/lib/task-field-schema'
import { formatCount } from '@/lib/format/number'
import { FormDesignerDialog } from './designer/form-designer-dialog'
import { useAssistantChanges, type AssistantChange } from '@/lib/assistants/client-registry'
import { ThemeEditor, type SavedFormTheme } from './designer/theme-editor'
import { FormRenderer } from './form-renderer'
import { FormSubmissionsPanel } from './form-submissions-panel'
import { FormThemeScope } from './form-theme-scope'
import { FormQrDialog } from './form-qr-dialog'
import { publicFormPageUrl } from '@/lib/forms/form-page-url'
import { AVAILABLE_FORMS_QUERY_KEY } from '@/lib/forms/available-forms'
import { ObjectPermissions } from '@/components/governance/object-permissions'
import { FormGovernanceSection } from '@/components/forms/form-governance-section'
import { FormAnonymousSection } from '@/components/forms/form-anonymous-section'
import { FormAvailabilityHint, FormAvailabilityStatus } from './form-availability-hint'
import { FormSystemNameField } from './form-system-name-field'
import { FilterMenu, FormDetailsSheet, RelativeDate, THEME_SOURCE_LABELS, type FormDetail, type FormListItem } from './forms-library-parts'

/**
 * Forms library (Automations → Forms): reusable task forms — list, search,
 * filter by tag / theme / use, create / edit (the designer) / details /
 * duplicate / delete, where each form is used — and the reusable Form themes.
 */

const EMPTY_FORM: FormDefinition = { fields: [], layout: { rows: [] }, theme: { source: 'workspace' } }

type ThemeEditing = { id: string | null; name: string; ref: FormThemeRef }
type DetailsState = { form: FormListItem | null; name: string; description: string; tags: string; available: boolean; systemName: string }

function detailsOf(form: FormListItem): DetailsState {
  return { form, name: form.name, description: form.description ?? '', tags: form.tags.join(', '), available: form.available_in_menu === true, systemName: form.system_name ?? '' }
}

const USE_FILTERS = [
  { value: 'used', label: 'Used by a workflow' },
  { value: 'unused', label: 'Not used yet' },
  { value: 'menu', label: 'In the Forms menu' },
  { value: 'page', label: 'A workflow’s form page' },
]

function matchesUse(f: FormListItem, use: string | undefined): boolean {
  if (!use) return true
  if (use === 'used') return f.usage_count > 0
  if (use === 'unused') return f.usage_count === 0
  if (use === 'menu') return f.available_in_menu === true
  return Boolean(f.form_page_of)
}

export function FormsLibrary() {
  const { can } = usePermissions()
  const canEdit = can('forms.edit')
  const canWizard = can('forms.wizard')
  const router = useRouter()
  const [choosing, setChoosing] = useState(false)
  const canDelete = can('forms.delete')
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'forms' | 'themes'>('forms')
  const [search, setSearch] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [themeFilter, setThemeFilter] = useState<string[]>([])
  const [useFilter, setUseFilter] = useState<string[]>([])
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)
  const [sheetOf, setSheetOf] = useState<FormListItem | null>(null)
  const [designing, setDesigning] = useState<{ form: FormDetail | null; details?: { name: string; description: string; tags: string[]; available_in_menu: boolean } } | null>(null)
  const [details, setDetails] = useState<DetailsState | null>(null)
  const [systemNameOk, setSystemNameOk] = useState(true)
  const [turningOn, setTurningOn] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<FormListItem | null>(null)
  const [submissionsOf, setSubmissionsOf] = useState<FormListItem | null>(null)
  const [qrOf, setQrOf] = useState<FormListItem | null>(null)
  const [exportOf, setExportOf] = useState<FormListItem | null>(null)
  const [themeEditing, setThemeEditing] = useState<ThemeEditing | null>(null)
  const canSubmit = can('forms.submit')

  const { data, isLoading } = useQuery({
    queryKey: ['forms-library', 'list'],
    queryFn: async () => ((await serverRead('forms.list', {})).data as { forms: FormListItem[] } | null)?.forms ?? [],
  })
  const { data: themes = [] } = useQuery({
    queryKey: ['form-themes'],
    queryFn: async () => ((await serverRead('forms.themes')).data ?? []) as Array<SavedFormTheme & { description: string | null; updated_at: string }>,
  })

  const forms = useMemo(() => data ?? [], [data])
  const allTags = useMemo(() => [...new Set(forms.flatMap((f) => f.tags))].sort(), [forms])
  const themeSources = useMemo(() => [...new Set(forms.map((f) => f.theme_source))].sort(), [forms])
  const q = search.trim().toLowerCase()
  const shown = forms.filter((f) => (!tags.length || tags.some((t) => f.tags.includes(t)))
    && (!themeFilter.length || themeFilter.includes(f.theme_source))
    && matchesUse(f, useFilter[0])
    && (!q || f.name.toLowerCase().includes(q) || (f.description ?? '').toLowerCase().includes(q) || f.tags.some((t) => t.includes(q))))
  const filtered = Boolean(q || tags.length || themeFilter.length || useFilter.length)
  const clearFilters = () => { setSearch(''); setTags([]); setThemeFilter([]); setUseFilter([]) }
  // A page at a time (the shared pager); a search or filter change goes back to page 1.
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const filterKey = `${q}|${tags.join(',')}|${themeFilter.join(',')}|${useFilter.join(',')}`
  useEffect(() => { setPage(1) }, [filterKey])
  const safePage = Math.min(page, Math.max(1, Math.ceil(shown.length / pageSize)))
  const pageRows = shown.slice((safePage - 1) * pageSize, safePage * pageSize)

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['forms-library'] }),
    queryClient.invalidateQueries({ queryKey: ['form'] }),
    // Names and "Available forms" show in the sidebar Forms menu.
    queryClient.invalidateQueries({ queryKey: AVAILABLE_FORMS_QUERY_KEY }),
  ])

  async function openDesigner(item: FormListItem) {
    const result = await serverRead('forms.get', { id: item.id })
    if (!result.data) { setNotice({ tone: 'error', message: 'The form could not be loaded' }); return }
    setDesigning({ form: result.data as FormDetail })
  }

  // The Agent changed the form open in the designer (a confirmed change): load the new version into it.
  const designingId = designing?.form?.id ?? null
  useAssistantChanges(useCallback((change: AssistantChange) => {
    if (change.kind !== 'form' || !designingId || change.id !== designingId) return
    void serverRead('forms.get', { id: designingId }).then((result) => {
      if (result.data) setDesigning((prev) => (prev?.form?.id === designingId ? { form: result.data as FormDetail } : prev))
    })
  }, [designingId]))

  async function copyLink(form: FormListItem) {
    // The friendly link (acme.usertasks.com/form/<name>) when the workspace has an address, else /f/<id>.
    const friendly = await serverRead('forms.friendlyLink', { form_id: form.id }).then((r) => r.data?.friendly_url ?? null).catch(() => null)
    try { await navigator.clipboard.writeText(friendly ?? publicFormPageUrl(form.id)); setNotice({ tone: 'success', message: 'Link copied' }) } catch { setNotice({ tone: 'error', message: 'Could not copy the link' }) }
  }

  async function duplicate(form: FormListItem) {
    const result = await duplicateForm(form.id)
    setNotice(result.ok ? { tone: 'success', message: `Duplicated as "${result.data.name}"` } : { tone: 'error', message: result.error })
    await refresh()
  }

  // Deep links from the header search box: ?q= filters the list, ?open=<id>
  // opens the form in the designer, ?submissions=<id> its submissions,
  // ?details=<id> its Details.
  const searchParams = useSearchParams()
  const handledLink = useRef<string | null>(null)
  useEffect(() => {
    const link = searchParams.toString()
    if (!data || !link || handledLink.current === link) return
    handledLink.current = link
    const q = searchParams.get('q')
    if (q !== null) { setTab('forms'); setSearch(q) }
    const open = forms.find((f) => f.id === searchParams.get('open'))
    if (open) void openDesigner(open)
    const submissions = forms.find((f) => f.id === searchParams.get('submissions'))
    if (submissions && canSubmit) setSubmissionsOf(submissions)
    // ?details=<id> (Settings → Governance): the form's Details — access, retention, legal hold.
    const detailsFor = forms.find((f) => f.id === searchParams.get('details'))
    if (detailsFor && canEdit) setDetails(detailsOf(detailsFor))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per link, after the list loads
  }, [data, searchParams])

  async function saveTheme(name: string, overrides: FormThemeOverrides): Promise<{ id: string } | { error: string }> {
    const result = await createFormTheme({ name, overrides })
    if (!result.ok) return { error: result.error }
    await queryClient.invalidateQueries({ queryKey: ['form-themes'] })
    return { id: result.data.id }
  }

  const newForm = () => setDetails({ form: null, name: '', description: '', tags: '', available: false, systemName: '' })
  // With the form wizard (forms.wizard): choose the wizard (recommended) or a blank form in the designer.
  const startNewForm = () => (canWizard ? setChoosing(true) : newForm())
  const headerActions = !canEdit ? undefined : tab === 'forms' ? (
    <>
      <ImportConfigButton label="Import…" onImported={() => void refresh()} />
      <Button size="sm" leadingIcon={<Plus />} onClick={startNewForm} data-testid="new-form">New form</Button>
    </>
  ) : (
    <Button size="sm" leadingIcon={<Plus />} onClick={() => setThemeEditing({ id: null, name: '', ref: { source: 'custom', overrides: {} } })} data-testid="new-form-theme">New form theme</Button>
  )

  return (
    <div data-testid="forms-library">
      <PageHeader
        title="Forms"
        description="Reusable task forms and form themes for User Tasks and task triggers."
        actions={headerActions}
        tabs={<Tabs aria-label="Forms library" value={tab} onValueChange={setTab}
          items={[{ value: 'forms', label: 'Forms', count: data ? forms.length : undefined }, { value: 'themes', label: 'Themes', count: themes.length || undefined }]} />}
        className="mb-4"
      />

      {notice && <div className="mb-4"><InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} /></div>}

      {tab === 'forms' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" data-testid="forms-toolbar">
            <SearchInput aria-label="Search forms" placeholder="Search forms" value={search} onValueChange={setSearch} wrapperClassName="w-full sm:w-72" />
            {allTags.length > 0 && <FilterMenu label="Tags" multiple options={allTags.map((t) => ({ value: t, label: t }))} selected={tags} onChange={setTags} testId="tags" />}
            {themeSources.length > 1 && <FilterMenu label="Theme" options={themeSources.map((t) => ({ value: t, label: THEME_SOURCE_LABELS[t] ?? t }))} selected={themeFilter} onChange={setThemeFilter} testId="theme" />}
            <FilterMenu label="Used by" options={USE_FILTERS} selected={useFilter} onChange={setUseFilter} testId="used-by" />
            {filtered && <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>}
          </div>

          {!isLoading && shown.length === 0 ? (
            forms.length === 0
              ? <EmptyState icon={FileText} title="No reusable forms yet" description="Design a form once and use it on any User Task or task trigger. Linked steps follow new versions; published workflows pin theirs."
                action={canEdit ? { label: 'Create form', onClick: startNewForm } : undefined} />
              : <EmptyState size="sm" variant="no-results" title={q ? `No forms match “${search.trim()}”` : 'No forms match these filters'} description="Try another search, or clear the filters."
                action={{ label: 'Clear filters', onClick: clearFilters }} />
          ) : (
            <Table>
              <THead>
                <tr>
                  {canSubmit && <TH className="w-10"><span className="sr-only">Favourite</span></TH>}
                  <TH>Name</TH>
                  <TH numeric className="w-20">Fields</TH>
                  <TH numeric className="w-24">Used by</TH>
                  <TH className="w-56">Tags</TH>
                  <TH className="w-28">Updated</TH>
                  <TH className="w-px"><span className="sr-only">Actions</span></TH>
                </tr>
              </THead>
              <TBody>
                {isLoading ? <TableSkeleton columns={canSubmit ? 7 : 6} /> : pageRows.map((form) => (
                  <TR key={form.id} interactive onClick={() => setSheetOf(form)} data-form-id={form.id} aria-label={`${form.name}: details`}>
                    {canSubmit && (
                      <TD className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <FavoriteStar formId={form.id} name={form.name} description={form.description ?? null} onError={(message) => setNotice({ tone: 'error', message })} />
                      </TD>
                    )}
                    <TD className="max-w-0 py-2">
                      <div className="flex min-w-0 items-center gap-2 max-sm:flex-wrap max-sm:gap-y-1">
                        <span className="truncate font-medium max-sm:basis-full">{form.name}</span>
                        <Tag mono>v{form.version}</Tag>
                        {form.available_in_menu && <Tag className="text-primary-text" data-form-available>In the Forms menu</Tag>}
                        {form.form_page_of && <Tag data-form-page-of={form.form_page_of.workflow_id}>Form page</Tag>}
                      </div>
                      {form.description && <p className="truncate text-xs text-fg-muted">{form.description}</p>}
                    </TD>
                    <TD numeric>{formatCount(form.field_count)}</TD>
                    <TD numeric>{form.usage_count ? formatCount(form.usage_count) : <span className="text-fg-subtle">—</span>}</TD>
                    <TD className="max-w-0" onClick={(e) => e.stopPropagation()} data-form-tags>
                      {form.tags.length ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-1">
                          {/* A tag filters the list by it (click again to clear). */}
                          {form.tags.slice(0, 3).map((t) => (
                            <button key={t} type="button" onClick={() => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}
                              aria-pressed={tags.includes(t)} title={tags.includes(t) ? `Stop filtering by ${t}` : `Show forms tagged ${t}`}
                              className="max-w-full rounded-sm">
                              <Tag className={cn('max-w-[10rem] truncate', tags.includes(t) && 'text-primary-text')}>{t}</Tag>
                            </button>
                          ))}
                          {form.tags.length > 3 && <span className="text-2xs text-fg-subtle" title={form.tags.slice(3).join(', ')}>+{form.tags.length - 3}</span>}
                        </div>
                      ) : <span className="text-fg-subtle">—</span>}
                    </TD>
                    <TD className="text-fg-muted"><RelativeDate value={form.updated_at} /></TD>
                    <TD className="w-px whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-1">
                        {canSubmit && (
                          <Button size="sm" variant="secondary" asChild>
                            <Link href={`/fill/${form.id}`} data-testid="open-form">Open</Link>
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => void openDesigner(form)} data-testid="edit-form">{canEdit ? 'Edit' : 'View'}</Button>
                        <FormRowMenu form={form} canSubmit={canSubmit} canEdit={canEdit} canDelete={canDelete}
                          onCopyLink={() => void copyLink(form)} onQr={() => setQrOf(form)} onSubmissions={() => setSubmissionsOf(form)}
                          onDuplicate={() => void duplicate(form)} onSettings={() => setDetails(detailsOf(form))} onDetails={() => setSheetOf(form)}
                          onExport={() => setExportOf(form)} onDelete={() => setConfirmDelete(form)} />
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {shown.length > 0 && <Pagination page={safePage} pageSize={pageSize} total={shown.length} onPageChange={setPage} onPageSizeChange={setPageSize} pageSizeOptions={[25, 50, 100]} showPageNumbers noun={shown.length === 1 ? 'form' : 'forms'} />}
        </div>
      ) : (
        <FormThemesTab themes={themes} canEdit={canEdit} canDelete={canDelete} onNotice={setNotice} editing={themeEditing} setEditing={setThemeEditing} />
      )}

      <FormDetailsSheet form={sheetOf} onClose={() => setSheetOf(null)} />
      <FormSubmissionsPanel form={submissionsOf} onClose={() => setSubmissionsOf(null)} />
      {qrOf && <FormQrDialog formId={qrOf.id} open onOpenChange={(open) => { if (!open) setQrOf(null) }} />}
      {exportOf && <ExportAssetDialog ids={[exportOf.id]} name={exportOf.name} open onOpenChange={(open) => { if (!open) setExportOf(null) }} />}

      {/* New form: the wizard or a blank form */}
      <Dialog open={choosing} onOpenChange={setChoosing}>
        <DialogContent size="sm" title="New form" data-testid="new-form-choice">
          <DialogBody>
            <div className="grid gap-2">
              <button type="button" onClick={() => { setChoosing(false); router.push('/forms/wizard/new') }} data-testid="new-form-wizard"
                className="flex items-start gap-3 rounded-lg border border-primary bg-primary-wash p-3 text-left hover:bg-subtle">
                <ClipboardPen className="mt-0.5 size-5 shrink-0 text-primary-text" aria-hidden />
                <span><span className="block text-sm font-medium">Use the wizard (recommended)</span><span className="block text-xs text-fg-muted">A few simple steps: the form, a data table for the responses, any approvals and a results page.</span></span>
              </button>
              <button type="button" onClick={() => { setChoosing(false); newForm() }} data-testid="new-form-blank"
                className="flex items-start gap-3 rounded-lg border border-border p-3 text-left hover:bg-subtle">
                <FileText className="mt-0.5 size-5 shrink-0 text-fg-muted" aria-hidden />
                <span><span className="block text-sm font-medium">Start blank</span><span className="block text-xs text-fg-muted">Open the full form designer with an empty form.</span></span>
              </button>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* New form / details */}
      <Dialog open={Boolean(details)} onOpenChange={(open) => { if (!open) setDetails(null) }}>
        <DialogContent size={details?.form ? 'md' : 'sm'} title={details?.form ? 'Form settings' : 'New form'} data-testid="form-details">
          <DialogBody>
            {details && (
              <form className="space-y-3" onSubmit={async (e) => {
                e.preventDefault()
                const tags = details.tags.split(',').map((t) => t.trim()).filter(Boolean)
                if (!details.form) {
                  setDetails(null)
                  setDesigning({ form: null, details: { name: details.name.trim(), description: details.description.trim(), tags, available_in_menu: details.available } })
                  return
                }
                const systemName = details.systemName.trim().toLowerCase()
                const result = await updateForm(details.form.id, { name: details.name, description: details.description, tags, available_in_menu: details.available, ...(systemName && systemName !== (details.form.system_name ?? '') ? { system_name: systemName } : {}) })
                setNotice(result.ok ? { tone: 'success', message: 'Details saved' } : { tone: 'error', message: result.error })
                if (result.ok) { setDetails(null); await refresh() }
              }}>
                <Field label="Name"><Input required maxLength={120} value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} data-testid="form-name" /></Field>
                <Field label="Description" optional><Input maxLength={2000} value={details.description} onChange={(e) => setDetails({ ...details, description: e.target.value })} /></Field>
                <Field label="Tags" description="Comma separated" optional><Input value={details.tags} onChange={(e) => setDetails({ ...details, tags: e.target.value })} /></Field>
                {details.form && (
                  <FormSystemNameField formId={details.form.id} formName={details.name} value={details.systemName} saved={details.form.system_name ?? null}
                    onChange={(systemName) => setDetails((prev) => (prev ? { ...prev, systemName } : prev))} onValidity={setSystemNameOk} />
                )}
                <div className="flex items-start gap-2 rounded-md bg-subtle p-3">
                  <input id="form-available" type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={details.available}
                    onChange={(e) => setDetails({ ...details, available: e.target.checked })} aria-describedby="form-available-help" data-testid="form-available" />
                  <div className="min-w-0">
                    <label htmlFor="form-available" className="block text-ui font-medium">Available forms</label>
                    <p id="form-available-help" className="text-xs text-fg-muted">
                      Show this form in the Forms menu for people who have been given access to it: a person, a team they&apos;re in or a role they hold, under <strong>Access</strong>{details.form ? ' below' : ' (once the form is created)'}. Every form already has its own page, so there&apos;s nothing else to publish.
                      {details.form && <FormAvailabilityStatus formId={details.form.id} />}
                    </p>
                  </div>
                </div>
                {details.form && (
                  <FormAvailabilityHint formId={details.form.id} available={details.available} busy={turningOn}
                    onTurnOn={async () => {
                      const form = details.form!
                      setTurningOn(true)
                      const result = await updateForm(form.id, { available_in_menu: true })
                      setTurningOn(false)
                      if (!result.ok) { setNotice({ tone: 'error', message: result.error }); return }
                      setDetails((prev) => (prev ? { ...prev, available: true, form: prev.form ? { ...prev.form, available_in_menu: true } : prev.form } : prev))
                      setNotice({ tone: 'success', message: `${form.name} now shows in the Forms menu of the people with access` })
                      await refresh()
                    }} />
                )}
                <p className="text-xs text-fg-muted">Name, system name, description, tags and Available forms don&apos;t create a new version; field, layout and theme changes do.</p>
                <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="secondary" onClick={() => setDetails(null)}>Cancel</Button><Button type="submit" disabled={!details.name.trim() || (Boolean(details.form) && !systemNameOk)}>{details.form ? 'Save settings' : 'Continue to designer'}</Button></div>
              </form>
            )}
            {details?.form && (
              <section className="mt-4 border-t pt-4 border-border" aria-label="Access" data-testid="form-access">
                <ObjectPermissions objectType="form" objectId={details.form.id} objectName={details.form.name} showEditDelete={false} executeLabel="Submit"
                  copy={{
                    openBadge: 'No one yet', restrictedBadge: 'Given access',
                    open: 'No one has been given access to this form yet. Add a role, team or person: with Available forms on, the form shows in their Forms menu (they also need Submit forms).',
                    restricted: 'These roles, teams and people have been given access. With Available forms on, the form shows in their Forms menu (they also need Submit forms).',
                  }} />
              </section>
            )}
            {details?.form && <FormAnonymousSection formId={details.form.id} formName={details.form.name} />}
            {details?.form && <FormGovernanceSection formId={details.form.id} formName={details.form.name} />}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <FormDesignerDialog
        // A new version (saved here or by the Agent) reopens the designer on it.
        key={designing?.form ? `${designing.form.id}:${designing.form.version}` : 'new'}
        open={Boolean(designing)}
        onClose={() => setDesigning(null)}
        title={designing?.form ? designing.form.name : designing?.details?.name || 'New form'}
        badge={designing?.form ? `Version ${designing.form.version}` : 'New form'}
        formId={designing?.form?.id}
        subtitle={designing?.form ? `Saving changes to fields, layout or theme creates version ${designing.form.version + 1}; linked drafts follow it, published workflows keep their pinned version.` : 'Reusable form: link it from any User Task or task trigger.'}
        initial={designing?.form ? normalizeFormDefinition(designing.form) : EMPTY_FORM}
        savedThemes={themes}
        canSaveTheme={canEdit}
        onSaveTheme={saveTheme}
        actions={canEdit ? [{
          id: 'save',
          label: designing?.form ? `Save version ${designing.form.version + 1}` : 'Create form',
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
        title={confirmDelete ? `Delete “${confirmDelete.name}”?` : 'Delete form?'}
        description="The form and all its versions are deleted. Forms that workflows still use can't be deleted."
        confirmLabel="Delete form"
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

/** A row's overflow menu: everything but Open and Edit. */
function FormRowMenu({ form, canSubmit, canEdit, canDelete, onCopyLink, onQr, onSubmissions, onDuplicate, onSettings, onDetails, onExport, onDelete }: {
  form: FormListItem
  canSubmit: boolean; canEdit: boolean; canDelete: boolean
  onCopyLink: () => void; onQr: () => void; onSubmissions: () => void; onDuplicate: () => void
  onSettings: () => void; onDetails: () => void; onExport: () => void; onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="sm" label={`More actions for ${form.name}`} icon={<MoreHorizontal />} data-testid="form-row-more" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem icon={<FileText />} onSelect={onDetails}>Where it&apos;s used</DropdownMenuItem>
        {canSubmit && <DropdownMenuItem icon={<Link2 />} onSelect={onCopyLink}>Copy link</DropdownMenuItem>}
        {canSubmit && <DropdownMenuItem icon={<QrCode />} onSelect={onQr} data-form-qr-button>QR code</DropdownMenuItem>}
        {canSubmit && <DropdownMenuItem icon={<Inbox />} onSelect={onSubmissions} data-testid="form-submissions-button">Submissions</DropdownMenuItem>}
        {canEdit && <DropdownMenuItem icon={<Copy />} onSelect={onDuplicate}>Duplicate</DropdownMenuItem>}
        {canEdit && <DropdownMenuItem icon={<Settings2 />} onSelect={onSettings} data-testid="form-details-button">Settings</DropdownMenuItem>}
        <DropdownMenuItem icon={<Download />} onSelect={onExport} data-testid="export-asset">Export…</DropdownMenuItem>
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger icon={<Trash2 />} onSelect={onDelete}>Delete</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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

function FormThemesTab({ themes, canEdit, canDelete, onNotice, editing, setEditing }: {
  themes: Array<SavedFormTheme & { description: string | null; updated_at: string }>
  canEdit: boolean
  canDelete: boolean
  onNotice: (notice: { tone: 'error' | 'success'; message: string }) => void
  editing: ThemeEditing | null
  setEditing: (editing: ThemeEditing | null) => void
}) {
  const queryClient = useQueryClient()
  // Synchronous guard so a double click can't create the theme twice.
  const { pending: busy, run: runSave } = useSubmitGuard()
  const [confirmDelete, setConfirmDelete] = useState<SavedFormTheme | null>(null)
  const sampleValues = useMemo(() => defaultTaskFieldValues(SAMPLE_FIELDS), [])
  const overrides = editing?.ref.source === 'custom' ? editing.ref.overrides : null
  const blocking = blockingFormThemeIssues(overrides)

  return (
    <div className="space-y-3" data-testid="form-themes">
      {themes.length === 0 ? (
        <EmptyState icon={Palette} title="No form themes yet" description="A form theme is a small set of overrides on the workspace theme — accent, background, text, radius, font, density, labels and a header. Save one here or from the designer's Theme tab."
          action={canEdit ? { label: 'Create form theme', onClick: () => setEditing({ id: null, name: '', ref: { source: 'custom', overrides: {} } }) } : undefined} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {themes.map((theme) => {
            const light = theme.overrides.colors?.light ?? {}
            const swatches = [light.accent, light.background, light.text, theme.overrides.header?.banner_color].filter(Boolean)
            return (
              <div key={theme.id} className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4" data-form-theme-card={theme.id}>
                <div className="flex items-start gap-3">
                  <div className="flex -space-x-1.5" aria-hidden>
                    {swatches.length ? swatches.map((c, i) => <span key={i} className="h-6 w-6 rounded-full border-2 border-panel ring-1 ring-border" style={{ backgroundColor: c }} />)
                      : <span className="h-6 w-6 rounded-full bg-muted ring-1 ring-border" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ui font-medium">{theme.name}</p>
                    <p className="truncate text-xs text-fg-muted">{theme.description || 'Form theme'} · updated <RelativeDate value={theme.updated_at} /></p>
                  </div>
                </div>
                {(canEdit || canDelete) && (
                  <div className="flex items-center gap-1">
                    {canEdit && <Button size="sm" variant="secondary" onClick={() => setEditing({ id: theme.id, name: theme.name, ref: { source: 'custom', overrides: theme.overrides } })}>Edit</Button>}
                    {canDelete && <IconButton size="sm" variant="danger-ghost" label={`Delete ${theme.name}`} icon={<Trash2 />} onClick={() => setConfirmDelete(theme)} />}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null) }}>
        <DialogContent size="xl" title={editing?.id ? 'Edit form theme' : 'New form theme'} onInteractOutside={(e) => e.preventDefault()} className="h-[min(88vh,820px)]" data-testid="form-theme-editor">
          {editing && (
            <div className="mt-4 flex min-h-0 flex-1 border-t border-border-subtle">
              <div className="w-80 shrink-0 space-y-3 overflow-y-auto border-r border-border-subtle p-4">
                <Field label="Name"><Input maxLength={120} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} data-testid="theme-name" /></Field>
                <ThemeEditor idPrefix="lib-theme" value={editing.ref} onChange={(ref) => setEditing({ ...editing, ref: ref.source === 'custom' ? ref : { source: 'custom', overrides: overrides ?? {} } })} savedThemes={[]} canSaveTheme={false} />
              </div>
              <div className="min-w-0 flex-1 space-y-5 overflow-y-auto bg-bg p-5">
                {(['light', 'dark'] as const).map((mode) => (
                  <div key={mode}>
                    <p className="mb-2 text-xs font-medium text-fg-muted">{mode === 'light' ? 'Light mode' : 'Dark mode'}</p>
                    <FormThemeScope overrides={overrides} mode={mode}>
                      <FormRenderer idPrefix={`theme-${mode}-`} fields={SAMPLE_FIELDS} layout={SAMPLE_LAYOUT} values={sampleValues} onChange={() => {}} labelPosition={overrides?.label_position} density={overrides?.density} />
                    </FormThemeScope>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            {blocking.length > 0 && <p className="mr-auto text-xs text-danger" role="alert">{blocking.join('; ')}</p>}
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button loading={busy} disabled={!editing?.name.trim() || busy || blocking.length > 0} data-action="save-theme" onClick={() => runSave(async () => {
              if (!editing) return
              const result = editing.id
                ? await updateFormTheme(editing.id, { name: editing.name, overrides: overrides ?? {} })
                : await createFormTheme({ name: editing.name, overrides: overrides ?? {} })
              if (!result.ok) { onNotice({ tone: 'error', message: result.error }); return }
              onNotice({ tone: 'success', message: `Saved "${result.data.name}"` })
              setEditing(null)
              await queryClient.invalidateQueries({ queryKey: ['form-themes'] })
            })}>{busy ? 'Saving…' : 'Save theme'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}
        title={confirmDelete ? `Delete “${confirmDelete.name}”?` : 'Delete form theme?'}
        description="Themes that forms or steps still use can't be deleted."
        confirmLabel="Delete theme"
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
