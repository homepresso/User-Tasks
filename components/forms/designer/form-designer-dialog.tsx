'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Eye, Library, Monitor, Moon, Pencil, Redo2, Smartphone, Sun, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FormRenderer } from '@/components/forms/form-renderer'
import { FormThemeScope } from '@/components/forms/form-theme-scope'
import { FormLookupProvider } from '@/components/forms/lookup-field'
import { useWorkspaceTheme } from '@/components/providers/theme-provider'
import { formDefinitionKey, type FormDefinition } from '@/lib/forms/definition'
import {
  addField, definitionFrom, designerProblems, designerStateFrom, duplicateField, keyRenames, removeField, updateField,
  type DesignerState,
} from '@/lib/forms/designer-state'
import { blockingFormThemeIssues, type FormThemeOverrides } from '@/lib/forms/form-theme'
import type { FieldReference } from '@/lib/forms/references'
import { defaultTaskFieldValues, TASK_FIELD_TYPE_LABELS, TASK_FIELD_TYPES, validateTaskFieldValues, type TaskFieldType } from '@/lib/task-field-schema'
import type { ThemeMode } from '@/lib/theme/schema'
import { cn } from '@/lib/utils'
import { DRAG_NEW_TYPE, FIELD_ICONS, PALETTE_GROUPS } from './field-icons'
import { FieldProperties } from './field-properties'
import { FormSettings } from './form-settings'
import { FormButtonBar, FormHeaderBlock, FormMessages, FormSuccessScreen } from '@/components/forms/form-shell'
import { buttonProblems, planButtonEffects, type ButtonEffects } from '@/lib/forms/buttons'
import { GridCanvas } from './grid-canvas'
import { ThemeEditor, type SavedFormTheme } from './theme-editor'
import { useHistory } from './use-history'

/**
 * The form designer: palette (left) → grid (centre) → properties of the
 * selected field / the form theme (right), with a live preview that renders
 * exactly what the assignee sees (light / dark, desktop / phone width).
 * Undo / redo (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y outside text inputs), an
 * unsaved-changes guard, and a check of downstream references when a key is
 * renamed. Saving is up to the caller (`actions`): a node's own form, the
 * linked reusable form, a new reusable form, the library.
 */

export interface DesignerSaveContext {
  /** Keys renamed since the dialog opened. */
  renames: Array<{ from: string; to: string }>
  /** The author chose to rewrite downstream references to renamed keys. */
  updateReferences: boolean
}

export interface DesignerAction {
  id: string
  label: string
  variant?: 'default' | 'outline'
  /** Hidden for display only. */
  hidden?: boolean
  /** Resolve to an error message to keep the dialog open. */
  run: (def: FormDefinition, ctx: DesignerSaveContext) => Promise<string | null | void>
}

export interface FormDesignerDialogProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: React.ReactNode
  initial: FormDefinition
  actions: DesignerAction[]
  /** Field types the palette offers (start forms are limited to workflow input types). */
  allowedTypes?: TaskFieldType[]
  savedThemes: SavedFormTheme[]
  canSaveTheme: boolean
  onSaveTheme?: (name: string, overrides: FormThemeOverrides) => Promise<{ id: string } | { error: string }>
  /** Downstream references to a key (workflow context): offers to rewrite them on rename. */
  findReferences?: (key: string) => FieldReference[]
  /** Save-as-reusable form panel (when allowed). */
  saveAsReusable?: { run: (def: FormDefinition, meta: { name: string; description: string; tags: string[] }) => Promise<string | null> }
  /** Theme tab hidden (start forms keep the workspace theme… or not). */
  hideTheme?: boolean
  /**
   * The "Buttons & header" tab: the step's outcomes (task forms, for
   * outcome buttons) and whether a Save draft button is offered. false =
   * no tab (start forms: the Run dialog has its own buttons).
   */
  formSettings?: { outcomes?: string[]; showDraft?: boolean } | false
}

function isTextTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function FormDesignerDialog(props: FormDesignerDialogProps) {
  // Remount per opening so the history starts from the stored definition.
  if (!props.open) return null
  return <DesignerBody {...props} />
}

function DesignerBody({ onClose, title, subtitle, initial, actions, allowedTypes = TASK_FIELD_TYPES, savedThemes, canSaveTheme, onSaveTheme, findReferences, saveAsReusable, hideTheme, formSettings = {} }: FormDesignerDialogProps) {
  const start = useMemo(() => designerStateFrom(initial), [initial])
  const initialKey = useMemo(() => formDefinitionKey(definitionFrom(start)), [start])
  const initialKeys = useMemo(() => new Map(start.fields.map((f) => [f._id, f.key])), [start])
  const history = useHistory<DesignerState>(start)
  const state = history.state
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<'field' | 'form' | 'theme'>('field')
  const [previewEffects, setPreviewEffects] = useState<ButtonEffects | null>(null)
  const [view, setView] = useState<'design' | 'preview'>('design')
  const { mode: appMode } = useWorkspaceTheme()
  const [previewMode, setPreviewMode] = useState<ThemeMode>(appMode)
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'mobile'>('desktop')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ action: DesignerAction; refs: Array<FieldReference & { from: string; to: string }> } | null>(null)
  const [reusable, setReusable] = useState<{ name: string; description: string; tags: string } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const definition = useMemo(() => definitionFrom(state), [state])
  const dirty = formDefinitionKey(definition) !== initialKey
  const problems = useMemo(() => designerProblems(state), [state])
  const themeRef = state.theme
  const themeOverrides: FormThemeOverrides | null = themeRef.source === 'custom' ? themeRef.overrides
    : themeRef.source === 'saved' ? (savedThemes.find((t) => t.id === themeRef.theme_id)?.overrides ?? null) : null
  const themeBlocking = state.theme.source === 'custom' ? blockingFormThemeIssues(state.theme.overrides) : []
  const buttonIssues = useMemo(() => (formSettings === false ? {} : buttonProblems(state.buttons, { outcomes: formSettings.outcomes, policy: { appOrigin: typeof window !== 'undefined' ? window.location.origin : null } })), [state.buttons, formSettings])
  const problemCount = Object.keys(problems).length + Object.keys(buttonIssues).length + (themeBlocking.length ? 1 : 0)
  const selected = state.fields.find((f) => f._id === selectedId) ?? null

  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>({})
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({})
  const previewDefaults = useMemo(() => defaultTaskFieldValues(definition.fields, (v) => (/\{\{/.test(v) ? '' : v)), [definition.fields])
  const shownValues = { ...previewDefaults, ...previewValues }

  const change = useCallback((next: DesignerState, tag?: string) => { setError(null); history.set(next, tag) }, [history])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || isTextTarget(e.target)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); history.undo() }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); history.redo() }
    }
    const el = rootRef.current
    el?.addEventListener('keydown', onKey)
    return () => el?.removeEventListener('keydown', onKey)
  }, [history])

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  function requestClose() {
    if (dirty) setConfirmClose(true)
    else onClose()
  }

  function addType(type: TaskFieldType) {
    // Into the selected field's row when it has room, else a new row.
    const { state: next, field } = addField(state, type)
    change(next)
    setSelectedId(field._id)
    setTab('field')
    setAnnouncement(`${TASK_FIELD_TYPE_LABELS[type]} added in a new row`)
    requestAnimationFrame(() => document.getElementById(`form-cell-${field._id}`)?.focus())
  }

  async function runAction(action: DesignerAction, updateReferences: boolean) {
    setBusy(action.id)
    setError(null)
    try {
      const message = await action.run(definition, { renames: keyRenames(initialKeys, state), updateReferences })
      if (message) setError(message)
      else onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the form')
    } finally {
      setBusy(null)
      setPendingAction(null)
    }
  }

  function startAction(action: DesignerAction) {
    if (problemCount > 0) { setError('Fix the highlighted problems first'); return }
    const renames = keyRenames(initialKeys, state)
    const refs = findReferences ? renames.flatMap((r) => findReferences(r.from).map((ref) => ({ ...ref, ...r }))) : []
    if (refs.length) { setPendingAction({ action, refs }); return }
    void runAction(action, false)
  }

  const iconButton = 'flex h-8 w-8 items-center justify-center rounded-md border disabled:opacity-30'
  const iconStyle = { borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) requestClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" />
        <Dialog.Content
          ref={rootRef}
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 flex h-[min(92vh,900px)] w-[min(1320px,97vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl shadow-xl dialog-content"
          style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-card-text)' }}
          data-testid="form-designer"
        >
          <div className="sr-only" aria-live="polite">{announcement}</div>
          {/* Header */}
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-sm font-semibold">{title}</Dialog.Title>
              {subtitle && <div className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>{subtitle}</div>}
            </div>
            <div className="flex items-center gap-1">
              <button type="button" className={iconButton} style={iconStyle} onClick={history.undo} disabled={!history.canUndo} aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)"><Undo2 size={14} /></button>
              <button type="button" className={iconButton} style={iconStyle} onClick={history.redo} disabled={!history.canRedo} aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)"><Redo2 size={14} /></button>
            </div>
            <div className="flex items-center rounded-md border p-0.5" style={{ borderColor: 'var(--theme-surface-border)' }} role="radiogroup" aria-label="View">
              {([['design', 'Design', Pencil], ['preview', 'Preview', Eye]] as const).map(([v, label, Icon]) => (
                <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}
                  className="flex h-7 items-center gap-1 rounded px-2.5 text-xs font-medium"
                  style={view === v ? { backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' } : { color: 'var(--theme-card-text)' }}>
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
            <button type="button" className={iconButton} style={iconStyle} onClick={requestClose} aria-label="Close"><X size={14} /></button>
          </div>

          {/* Body */}
          <div className="flex min-h-0 flex-1">
            {/* Palette */}
            {view === 'design' && (
              <aside className="w-48 shrink-0 overflow-y-auto border-r p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }} aria-label="Field palette">
                <p className="mb-2 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Drag onto the grid, or press Enter to add.</p>
                {PALETTE_GROUPS.map((group) => {
                  const types = group.types.filter((t) => allowedTypes.includes(t))
                  if (!types.length) return null
                  return (
                    <div key={group.label} className="mb-3">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>{group.label}</p>
                      <div className="space-y-1">
                        {types.map((type) => {
                          const Icon = FIELD_ICONS[type]
                          return (
                            <button
                              key={type}
                              type="button"
                              draggable
                              onDragStart={(e) => { e.dataTransfer.setData(DRAG_NEW_TYPE, type); e.dataTransfer.effectAllowed = 'copy' }}
                              onClick={() => addType(type)}
                              className="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:opacity-90"
                              style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}
                              data-palette-type={type}
                            >
                              <Icon size={13} style={{ color: 'var(--theme-primary-text)' }} aria-hidden />
                              {TASK_FIELD_TYPE_LABELS[type]}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </aside>
            )}

            {/* Centre */}
            <main className="min-w-0 flex-1 overflow-y-auto p-4" aria-label={view === 'design' ? 'Form grid' : 'Preview'}>
              {view === 'design' ? (
                <GridCanvas
                  state={state}
                  selectedId={selectedId}
                  problems={problems}
                  onSelect={(id) => { setSelectedId(id); if (id) setTab('field') }}
                  onChange={change}
                  announce={setAnnouncement}
                />
              ) : (
                <div>
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                    <div className="flex items-center rounded-md border p-0.5" style={{ borderColor: 'var(--theme-surface-border)' }} role="radiogroup" aria-label="Preview mode">
                      {([['light', Sun], ['dark', Moon]] as const).map(([m, Icon]) => (
                        <button key={m} type="button" role="radio" aria-checked={previewMode === m} onClick={() => setPreviewMode(m)} className="flex h-7 items-center gap-1 rounded px-2 capitalize"
                          style={previewMode === m ? { backgroundColor: 'var(--theme-primary-light)' } : undefined}><Icon size={12} /> {m}</button>
                      ))}
                    </div>
                    <div className="flex items-center rounded-md border p-0.5" style={{ borderColor: 'var(--theme-surface-border)' }} role="radiogroup" aria-label="Preview width">
                      {([['desktop', Monitor, 'Desktop'], ['mobile', Smartphone, 'Phone']] as const).map(([w, Icon, label]) => (
                        <button key={w} type="button" role="radio" aria-checked={previewWidth === w} onClick={() => setPreviewWidth(w)} className="flex h-7 items-center gap-1 rounded px-2"
                          style={previewWidth === w ? { backgroundColor: 'var(--theme-primary-light)' } : undefined}><Icon size={12} /> {label}</button>
                      ))}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setPreviewErrors(validateTaskFieldValues(definition.fields, shownValues))}>Check validation</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setPreviewValues({}); setPreviewErrors({}) }}>Reset values</Button>
                  </div>
                  <div className={cn('mx-auto', previewWidth === 'mobile' ? 'w-[375px] max-w-full' : 'max-w-3xl')} data-preview-width={previewWidth} data-preview-mode={previewMode}>
                    <FormThemeScope overrides={state.header.enabled && themeOverrides?.header ? { ...themeOverrides, header: undefined } : themeOverrides} mode={previewMode} page={formSettings !== false}>
                      <FormLookupProvider source={{ kind: 'preview' }}>
                      {formSettings !== false && <FormHeaderBlock header={state.header} values={shownValues} overrides={themeOverrides} />}
                      {previewEffects?.success_screen ? (
                        <FormSuccessScreen screen={previewEffects.success_screen} onSubmitAnother={() => { setPreviewEffects(null); setPreviewValues({}) }} onClose={() => setPreviewEffects(null)} />
                      ) : (<>
                      <FormRenderer
                        idPrefix="preview-"
                        fields={definition.fields}
                        layout={definition.layout}
                        values={shownValues}
                        errors={previewErrors}
                        singleColumn={previewWidth === 'mobile'}
                        labelPosition={themeOverrides?.label_position}
                        density={themeOverrides?.density}
                        onChange={(key, value) => {
                          setPreviewValues((prev) => ({ ...prev, [key]: value }))
                          setPreviewErrors((prev) => { if (!prev[key]) return prev; const next = { ...prev }; delete next[key]; return next })
                        }}
                      />
                      {formSettings !== false && (
                        <>
                          {previewEffects && <FormMessages messages={previewEffects.messages} onDismiss={(i) => setPreviewEffects({ ...previewEffects, messages: previewEffects.messages.filter((_, j) => j !== i) })} />}
                          {previewEffects?.redirect && <p className="mt-2 text-xs" role="status" style={{ color: 'var(--theme-muted-text)' }}>Would go to {previewEffects.redirect}</p>}
                          <FormButtonBar
                            buttons={state.buttons.filter((b) => formSettings.showDraft || b.kind !== 'draft')}
                            placement={themeOverrides?.button_placement}
                            onClick={(button) => {
                              if (button.kind === 'cancel') { setPreviewValues({}); setPreviewErrors({}); setPreviewEffects(planButtonEffects(button, { values: shownValues }, { appOrigin: window.location.origin })); return }
                              if (button.kind !== 'draft') {
                                const errs = validateTaskFieldValues(definition.fields, shownValues)
                                setPreviewErrors(errs)
                                if (Object.keys(errs).length) return
                              }
                              // Preview: no workflow is started; {{run_reference}} shows a placeholder.
                              setPreviewEffects(planButtonEffects(button, { values: shownValues, extras: { run_reference: 'PREVIEW', submission_id: 'PREVIEW' } }, { appOrigin: window.location.origin }))
                            }}
                          />
                        </>
                      )}
                      </>)}
                      </FormLookupProvider>
                    </FormThemeScope>
                  </div>
                </div>
              )}
            </main>

            {/* Properties */}
            <aside className="w-80 shrink-0 overflow-y-auto border-l" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }} aria-label="Properties">
              {!hideTheme && (
                <div className="flex border-b" style={{ borderColor: 'var(--theme-surface-border)' }} role="tablist">
                  {([['field', 'Field'], ...(formSettings === false ? [] : [['form', 'Buttons & header']]), ['theme', 'Form theme']] as Array<['field' | 'form' | 'theme', string]>).map(([t, label]) => (
                    <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                      className="flex-1 border-b-2 py-2 text-xs font-medium"
                      style={{ borderColor: tab === t ? 'var(--theme-primary)' : 'transparent', color: tab === t ? 'var(--theme-card-text)' : 'var(--theme-muted-text)' }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <div className="p-3">
                {tab === 'theme' && !hideTheme ? (
                  <ThemeEditor value={state.theme} onChange={(theme) => change({ ...state, theme }, 'theme')} savedThemes={savedThemes} canSaveTheme={canSaveTheme} onSaveTheme={onSaveTheme} />
                ) : tab === 'form' && formSettings !== false ? (
                  <FormSettings state={state} onChange={(next, tag) => change(next, tag)} outcomes={formSettings.outcomes} showDraft={formSettings.showDraft} problems={buttonIssues} />
                ) : selected ? (
                  <FieldProperties
                    key={selected._id}
                    state={state}
                    field={selected}
                    allowedTypes={allowedTypes}
                    onPatch={(patch, tag) => change(updateField(state, selected._id, patch), tag)}
                    onChangeState={(next) => change(next)}
                    onRemove={() => { change(removeField(state, selected._id)); setSelectedId(null) }}
                    onDuplicate={() => { const r = duplicateField(state, selected._id); if (r) { change(r.state); setSelectedId(r.field._id) } }}
                  />
                ) : (
                  <div className="space-y-2 text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
                    <p>Select a field on the grid to edit its label, key, validation and visibility.</p>
                    <p>Each field&apos;s key is available downstream as <code style={{ color: 'var(--theme-primary-text)' }}>{'{{task_data.<key>}}'}</code>.</p>
                    <p>Keyboard: Tab to a field, Alt+Arrow keys to move it, Delete to remove it, Ctrl+Z to undo.</p>
                    <p>{state.fields.length} field{state.fields.length === 1 ? '' : 's'} in {state.layout.rows.length} row{state.layout.rows.length === 1 ? '' : 's'}.</p>
                  </div>
                )}
              </div>
            </aside>
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
            <p className="flex-1 text-[11px]" style={{ color: error || problemCount ? 'var(--status-blocked)' : 'var(--theme-muted-text)' }} role={error ? 'alert' : undefined}>
              {error ?? (problemCount ? `${problemCount} problem${problemCount === 1 ? '' : 's'} to fix before saving` : dirty ? 'Unsaved changes' : 'No changes')}
            </p>
            {saveAsReusable && (
              <Button size="sm" variant="outline" onClick={() => setReusable({ name: '', description: '', tags: '' })} disabled={Boolean(busy)}>
                <Library size={12} /> Save as reusable form
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={requestClose} disabled={Boolean(busy)}>Cancel</Button>
            {actions.filter((a) => !a.hidden).map((action) => (
              <Button key={action.id} size="sm" variant={action.variant ?? 'default'} onClick={() => startAction(action)} disabled={Boolean(busy)} data-action={action.id}>
                {busy === action.id ? 'Saving…' : action.label}
              </Button>
            ))}
          </div>

          {/* Unsaved-changes guard */}
          {confirmClose && (
            <Overlay>
              <p className="text-sm font-semibold">Discard your changes?</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--theme-muted-text)' }}>The form has changes that haven&apos;t been saved.</p>
              <div className="mt-4 flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setConfirmClose(false)}>Keep editing</Button>
                <Button size="sm" variant="destructive" onClick={onClose}>Discard</Button>
              </div>
            </Overlay>
          )}

          {/* Renamed keys used downstream */}
          {pendingAction && (
            <Overlay>
              <p className="text-sm font-semibold">Renamed keys are used later in the workflow</p>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
                {pendingAction.refs.map((ref, i) => (
                  <li key={i}>
                    <span className="font-medium">{ref.node_label}</span>
                    <span style={{ color: 'var(--theme-muted-text)' }}> · {ref.path || 'config'} · </span>
                    <code>{ref.from}</code> → <code>{ref.to}</code>{ref.count > 1 ? ` (${ref.count}×)` : ''}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>Update those references to the new keys, or keep them (they will no longer resolve).</p>
              <div className="mt-4 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPendingAction(null)}>Cancel</Button>
                <Button size="sm" variant="outline" onClick={() => void runAction(pendingAction.action, false)}>Keep references</Button>
                <Button size="sm" onClick={() => void runAction(pendingAction.action, true)} data-action="update-references">Update references</Button>
              </div>
            </Overlay>
          )}

          {/* Save as reusable form */}
          {reusable && saveAsReusable && (
            <Overlay>
              <p className="text-sm font-semibold">Save as a reusable form</p>
              <p className="mt-1 text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>The form goes into the Forms library and this step links to it: later edits to the form create new versions.</p>
              <div className="mt-3 space-y-2 text-xs">
                <label className="block">Name
                  <input autoFocus className="mt-0.5 h-8 w-full rounded-md border px-2" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)' }} value={reusable.name} onChange={(e) => setReusable({ ...reusable, name: e.target.value })} data-testid="reusable-name" />
                </label>
                <label className="block">Description
                  <input className="mt-0.5 h-8 w-full rounded-md border px-2" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)' }} value={reusable.description} onChange={(e) => setReusable({ ...reusable, description: e.target.value })} />
                </label>
                <label className="block">Tags (comma separated)
                  <input className="mt-0.5 h-8 w-full rounded-md border px-2" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)' }} value={reusable.tags} onChange={(e) => setReusable({ ...reusable, tags: e.target.value })} />
                </label>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setReusable(null)}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={!reusable.name.trim() || busy === 'reusable' || problemCount > 0}
                  data-action="save-reusable"
                  onClick={async () => {
                    setBusy('reusable')
                    const message = await saveAsReusable.run(definition, { name: reusable.name.trim(), description: reusable.description.trim(), tags: reusable.tags.split(',').map((t) => t.trim()).filter(Boolean) })
                    setBusy(null)
                    if (message) setError(message)
                    else { setReusable(null); onClose() }
                  }}
                >
                  {busy === 'reusable' ? 'Saving…' : 'Save and link'}
                </Button>
              </div>
            </Overlay>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-4" role="alertdialog" aria-modal="true">
      <div className="w-[min(30rem,92vw)] rounded-xl p-5 shadow-xl" style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}>
        {children}
      </div>
    </div>
  )
}
