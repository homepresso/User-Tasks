'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as Dialog from '@radix-ui/react-dialog'
import { Library, Link2, PencilRuler, Search, Unlink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePermissions } from '@/lib/permissions-context'
import { serverRead } from '@/lib/server-read'
import { createForm, createFormTheme, updateForm } from '@/app/actions/forms'
import { formDefinitionKey, nodeFormPatch, normalizeFormDefinition, readNodeForm, readNodeFormLink, type FormDefinition, type FormLink } from '@/lib/forms/definition'
import { findFieldReferences, renameFieldReferences, type RefNode } from '@/lib/forms/references'
import { TASK_FIELD_TYPE_LABELS, valueFields } from '@/lib/task-field-schema'
import { FormDesignerDialog, type DesignerAction, type DesignerSaveContext } from './designer/form-designer-dialog'
import type { SavedFormTheme } from './designer/theme-editor'
import { FIELD_ICONS } from './designer/field-icons'

/* eslint-disable @typescript-eslint/no-explicit-any -- node config is free-form JSON */

/**
 * The "Form" section of a User Task (or task trigger) config panel: a
 * summary of the fields and where they land downstream, "Design form"
 * (the designer dialog), "Use a saved form" (link a reusable form) and, for
 * a linked step, its badge and "Detach" (keep a local copy).
 *
 * A linked step keeps a cached copy of the form on the node (fields, layout,
 * theme) so the data picker and validation work offline from the library;
 * the copy is refreshed to the latest version when the panel opens. Runs use
 * the linked form itself (the version pinned at publish).
 */

interface FormListItem { id: string; name: string; description: string | null; tags: string[]; version: number; field_count: number; usage_count: number }

export function NodeFormSection({ node, allNodes, onPatch, onUpdateOtherNode, variant }: {
  node: RefNode & { config: Record<string, any> }
  allNodes: RefNode[]
  onPatch: (patch: Record<string, unknown>) => void
  onUpdateOtherNode: (id: string, config: Record<string, any>) => void
  variant: 'user_task' | 'task_trigger'
}) {
  const { can } = usePermissions()
  const canView = can('forms.view')
  const canEdit = can('forms.edit')
  const queryClient = useQueryClient()
  const def = useMemo(() => readNodeForm(node.config), [node.config])
  const link = readNodeFormLink(node.config)
  const [designerOpen, setDesignerOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const prefix = variant === 'user_task' ? 'task_data' : 'task.data'

  const { data: linkedForm } = useQuery({
    queryKey: ['form', link?.form_id],
    enabled: Boolean(link?.form_id) && canView,
    staleTime: 15_000,
    queryFn: async () => {
      const result = await serverRead('forms.get', { id: link!.form_id })
      return result.data as (FormDefinition & { id: string; name: string; version: number; fields: unknown; layout: unknown; theme: unknown }) | null
    },
  })
  const { data: savedThemes = [] } = useQuery({
    queryKey: ['form-themes'],
    enabled: canView,
    staleTime: 30_000,
    queryFn: async () => ((await serverRead('forms.themes')).data ?? []) as SavedFormTheme[],
  })

  // Keep the cached copy of a linked form current (drafts follow the latest version).
  useEffect(() => {
    if (!link || !linkedForm) return
    const latest = normalizeFormDefinition({ fields: linkedForm.fields, layout: linkedForm.layout, theme: linkedForm.theme, buttons: (linkedForm as { buttons?: unknown }).buttons, header: (linkedForm as { header?: unknown }).header })
    if (link.cached_version === linkedForm.version && link.form_name === linkedForm.name && formDefinitionKey(latest) === formDefinitionKey(def)) return
    onPatch(nodeFormPatch(latest, { form_id: link.form_id, form_name: linkedForm.name, cached_version: linkedForm.version }))
  }, [link, linkedForm, def, onPatch])

  function applyRenames(ctx: DesignerSaveContext) {
    if (!ctx.updateReferences) return
    let nodes = allNodes
    for (const { from, to } of ctx.renames) nodes = renameFieldReferences(nodes, from, to, node.id)
    nodes.forEach((n, i) => { if (n !== allNodes[i] && n.config) onUpdateOtherNode(n.id, n.config) })
  }

  async function saveTheme(name: string, overrides: unknown): Promise<{ id: string } | { error: string }> {
    const result = await createFormTheme({ name, overrides })
    if (!result.ok) return { error: result.error }
    await queryClient.invalidateQueries({ queryKey: ['form-themes'] })
    return { id: result.data.id }
  }

  const actions: DesignerAction[] = link
    ? [
        {
          id: 'detach-save', label: 'Detach and save here', variant: 'outline',
          run: async (next, ctx) => { applyRenames(ctx); onPatch(nodeFormPatch(next, null)); return null },
        },
        {
          id: 'save-linked', label: `Save to "${link.form_name ?? 'form'}" (new version)`, hidden: !canEdit,
          run: async (next, ctx) => {
            const result = await updateForm(link.form_id, { fields: next.fields, layout: next.layout, theme: next.theme, buttons: next.buttons ?? null, header: next.header ?? null })
            if (!result.ok) return result.error
            applyRenames(ctx)
            onPatch(nodeFormPatch(normalizeFormDefinition(result.data), { form_id: link.form_id, form_name: result.data.name, cached_version: result.data.version }))
            await queryClient.invalidateQueries({ queryKey: ['form', link.form_id] })
            return null
          },
        },
      ]
    : [{ id: 'save', label: 'Save form', run: async (next, ctx) => { applyRenames(ctx); onPatch(nodeFormPatch(next, null)); return null } }]

  function linkTo(form: FormListItem & { fields?: unknown; layout?: unknown; theme?: unknown }, full: FormDefinition) {
    onPatch(nodeFormPatch(full, { form_id: form.id, form_name: form.name, cached_version: form.version }))
  }

  const fields = valueFields(def.fields)
  const initialForDesigner: FormDefinition = link && linkedForm ? normalizeFormDefinition({ fields: linkedForm.fields, layout: linkedForm.layout, theme: linkedForm.theme, buttons: (linkedForm as { buttons?: unknown }).buttons, header: (linkedForm as { header?: unknown }).header }) : def

  return (
    <div className="space-y-2" data-testid="node-form-section">
      {link && (
        <div className="rounded-lg border px-2.5 py-2 text-[11px]" style={{ borderColor: 'var(--theme-primary)', backgroundColor: 'var(--theme-primary-light)' }} data-testid="linked-form-badge">
          <p className="flex items-center gap-1.5 font-medium" style={{ color: 'var(--theme-card-text)' }}>
            <Link2 size={12} /> Linked to form &ldquo;{link.form_name ?? linkedForm?.name ?? 'form'}&rdquo; v{linkedForm?.version ?? link.cached_version ?? '?'}
          </p>
          <p className="mt-0.5 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
            The draft follows the latest version; publishing pins the version in use. Edits to the form create a new version.
          </p>
          {!linkedForm && canView && <p className="mt-0.5 text-[10px]" style={{ color: 'var(--theme-warning)' }}>Loading the form… (a deleted form falls back to the copy on this step)</p>}
        </div>
      )}

      {fields.length === 0 ? (
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          {variant === 'user_task'
            ? 'No fields — the assignee just picks an outcome. Design a form to collect values on the task.'
            : 'Optional: describe the form fields the triggering task carries, so they appear in the data picker as {{task.data.<key>}}.'}
        </p>
      ) : (
        <ul className="space-y-1" aria-label="Form fields">
          {fields.map((field) => {
            const Icon = FIELD_ICONS[field.type]
            return (
              <li key={field.key} className="flex items-center gap-1.5 rounded border px-2 py-1 text-[11px]" style={{ borderColor: 'var(--theme-surface-border)' }}>
                <Icon size={11} style={{ color: 'var(--theme-primary-text)' }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{field.label}{field.required && <span style={{ color: 'var(--status-blocked)' }}>*</span>}</span>
                <span className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>{TASK_FIELD_TYPE_LABELS[field.type]}</span>
              </li>
            )
          })}
        </ul>
      )}
      {fields.length > 0 && (
        <p className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
          Downstream: <code style={{ color: 'var(--theme-primary-text)' }}>{`{{${prefix}.<key>}}`}</code> — every field appears in the data picker, typed.
          {def.layout && ` · ${def.layout.rows.length}-row grid`}
          {def.theme.source !== 'workspace' && ' · custom theme'}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => setDesignerOpen(true)} data-testid="design-form">
          <PencilRuler size={12} /> Design form
        </Button>
        {canView && (
          <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)} data-testid="use-saved-form">
            <Library size={12} /> Use a saved form
          </Button>
        )}
        {link && (
          <Button size="sm" variant="outline" onClick={() => onPatch(nodeFormPatch(def, null))} data-testid="detach-form" title="Keep a local copy of the form on this step and stop following the library form">
            <Unlink size={12} /> Detach
          </Button>
        )}
      </div>

      <FormDesignerDialog
        open={designerOpen}
        onClose={() => setDesignerOpen(false)}
        title={`Design form — ${node.label || 'step'}`}
        subtitle={link ? <>Linked to <strong>{link.form_name}</strong> · saving to the form creates a new version</> : variant === 'user_task' ? 'What the assignee fills in. Values return to the workflow as {{task_data.<key>}}.' : 'The fields the triggering task carries ({{task.data.<key>}}).'}
        initial={initialForDesigner}
        actions={actions}
        savedThemes={savedThemes}
        canSaveTheme={canEdit}
        onSaveTheme={saveTheme}
        findReferences={(key) => findFieldReferences(allNodes, key, node.id)}
        formSettings={variant === 'user_task' ? { outcomes: Array.isArray(node.config?.outcomes) ? (node.config.outcomes as string[]) : undefined, showDraft: true } : false}
        saveAsReusable={canEdit ? {
          run: async (next, meta) => {
            const result = await createForm({ name: meta.name, description: meta.description, tags: meta.tags, fields: next.fields, layout: next.layout, theme: next.theme, buttons: next.buttons ?? null, header: next.header ?? null })
            if (!result.ok) return result.error
            onPatch(nodeFormPatch(normalizeFormDefinition(result.data), { form_id: result.data.id, form_name: result.data.name, cached_version: result.data.version }))
            await queryClient.invalidateQueries({ queryKey: ['forms-library'] })
            return null
          },
        } : undefined}
      />

      <SavedFormPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentId={link?.form_id ?? null}
        replacing={!link && fields.length > 0}
        onPick={async (form) => {
          const full = await serverRead('forms.get', { id: form.id })
          if (!full.data) return 'The form could not be loaded'
          linkTo(form, normalizeFormDefinition(full.data as any))
          queryClient.setQueryData(['form', form.id], full.data)
          return null
        }}
      />
    </div>
  )
}

export function SavedFormPicker({ open, onOpenChange, currentId, replacing, onPick }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentId: string | null
  replacing: boolean
  onPick: (form: FormListItem) => Promise<string | null>
}) {
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['forms-library', 'picker'],
    enabled: open,
    staleTime: 10_000,
    queryFn: async () => ((await serverRead('forms.list', {})).data as { forms: FormListItem[] } | null)?.forms ?? [],
  })
  const q = search.trim().toLowerCase()
  const forms = (data ?? []).filter((f) => !q || f.name.toLowerCase().includes(q) || (f.description ?? '').toLowerCase().includes(q) || f.tags.some((t) => t.includes(q)))
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[min(36rem,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl shadow-xl dialog-content" style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }} data-testid="saved-form-picker">
          <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <Dialog.Title className="flex-1 text-sm font-semibold">Use a saved form</Dialog.Title>
            <Dialog.Close className="rounded p-1" aria-label="Close"><X size={14} /></Dialog.Close>
          </div>
          <div className="px-4 pt-3">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} aria-hidden />
              <input autoFocus aria-label="Search forms" placeholder="Search by name, description or tag" value={search} onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-full rounded-lg border pl-8 pr-2 text-sm outline-none focus-visible:ring-2"
                style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)', ['--tw-ring-color' as string]: 'var(--theme-primary)' }} />
            </div>
            {replacing && <p className="mt-2 text-[11px]" style={{ color: 'var(--theme-warning)' }}>This step already has its own fields: linking a form replaces them.</p>}
            {error && <p className="mt-2 text-[11px]" style={{ color: 'var(--status-blocked)' }}>{error}</p>}
          </div>
          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-4" role="listbox" aria-label="Saved forms">
            {isLoading && <li className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>Loading…</li>}
            {!isLoading && forms.length === 0 && <li className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>No saved forms{q ? ' match' : ' yet — design a form and choose “Save as reusable form”'}.</li>}
            {forms.map((form) => (
              <li key={form.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={form.id === currentId}
                  onClick={async () => { setError(null); const message = await onPick(form); if (message) setError(message); else onOpenChange(false) }}
                  className="w-full rounded-lg border px-3 py-2 text-left hover:opacity-90"
                  style={{ borderColor: form.id === currentId ? 'var(--theme-primary)' : 'var(--theme-surface-border)' }}
                >
                  <p className="text-sm font-medium">{form.name} <span className="text-[10px] font-normal" style={{ color: 'var(--theme-muted-text)' }}>v{form.version} · {form.field_count} field{form.field_count === 1 ? '' : 's'} · used {form.usage_count}×</span></p>
                  {form.description && <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>{form.description}</p>}
                  {form.tags.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{form.tags.map((t) => <span key={t} className="rounded-full border px-1.5 text-[9px]" style={{ borderColor: 'var(--theme-surface-border)' }}>{t}</span>)}</p>}
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export type { FormLink }
