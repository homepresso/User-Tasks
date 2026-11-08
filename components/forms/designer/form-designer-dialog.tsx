'use client'

import { formAnimation } from '@/lib/forms/motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Eye, Info, LayoutList, Library, Maximize2, Minimize2, Monitor, Moon, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil, Redo2, RotateCcw, SlidersHorizontal, Smartphone, Sun, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Tag } from '@/components/ui/badge'
import { Field } from '@/components/ui/field'
import { Input, SearchInput } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip'
import { overlayClass } from '@/components/ui/dialog'
import { FormRenderer } from '@/components/forms/form-renderer'
import { FormThemeScope, useFormPageCanvas } from '@/components/forms/form-theme-scope'
import { FormLookupProvider } from '@/components/forms/lookup-field'
import { useWorkspaceTheme } from '@/components/providers/theme-provider'
import { formDefinitionKey, type FormDefinition } from '@/lib/forms/definition'
import {
  addField, addSection, convertHeadingToSection, definitionFrom, deletePage, designerProblems, designerRuleProblems, designerSectionProblems, designerStateFrom, duplicateField, duplicatePage, keyRenames, onPage, removeField, updateField,
  type DesignerState,
} from '@/lib/forms/designer-state'
import { allRows, isPaged, pageGrid } from '@/lib/forms/layout'
import { pageFieldKeys, pageProblems } from '@/lib/forms/pages'
import { FormPagesProvider, FormStepActions } from '@/components/forms/form-pages'
import { PageStrip } from './page-strip'
import { PageProperties } from './page-properties'
import { SectionProperties } from './section-properties'
import { blockingFormThemeIssues, type FormThemeOverrides } from '@/lib/forms/form-theme'
import type { FieldReference } from '@/lib/forms/references'
import { TASK_FIELD_TYPE_LABELS, TASK_FIELD_TYPES, validateTaskFieldValues, type TaskFieldType } from '@/lib/task-field-schema'
import type { ThemeMode } from '@/lib/theme/schema'
import { cn } from '@/lib/utils'
import { formCardWidthClass, formWidthStyle } from '@/lib/forms/form-width'
import { DRAG_NEW_TYPE, FIELD_ICONS, PALETTE_GROUPS, paletteGroupClass, paletteItemClass } from './field-icons'
import { InspectorTabs } from './inspector-tabs'
import { CustomControlsPalette } from './custom-controls-palette'
import { FieldProperties } from './field-properties'
import { FormSettings } from './form-settings'
import { DesignerPreviewValuesProvider } from './designer-preview-context'
import { DesignerVariableScope } from './designer-variable-scope'
import { PreviewTestInputsPanel } from './preview-test-inputs'
import { EMPTY_PREVIEW_INPUTS, normalizePreviewInputs, previewInputsStorageKey, previewSeed, previewShownValues, type PreviewTestInputs } from '@/lib/forms/preview-inputs'
import { FORM_VARS_KEY, formUrlWithParams, layoutFormParams, setVariables, withFormContext } from '@/lib/forms/form-params'
import { publicFormPageUrl } from '@/lib/forms/form-page-url'
import { FormButtonBar, FormHeaderBlock, FormMessages, FormSuccessScreen } from '@/components/forms/form-shell'
import { buttonProblems, planButtonEffects, type ButtonEffects } from '@/lib/forms/buttons'
import { applySubmittedPage, freshSubmissionValues } from '@/lib/forms/submitted-page'
import { submitPathProblem } from '@/lib/forms/form-state'
import { GridCanvas } from './grid-canvas'
import { RulesPanel } from './rules-panel'
import { FormContextPanel } from './form-context-panel'
import { collectFormRules } from '@/lib/forms/form-rules'
import { ThemeEditor, type SavedFormTheme } from './theme-editor'
import { useHistory } from './use-history'
import { useResizableDialog } from './use-resizable-dialog'
import { AgentDialogButton, useAgentDock } from '@/components/assistants/assistant-panel'
import { useDesignerContext } from '@/lib/assistants/client-registry'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { AccessibilityPanel, AccessibilitySaveCheck, useFormAccessibility } from './accessibility-panel'

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
  /** Explanation behind the info button next to the title. */
  subtitle?: React.ReactNode
  /** Tag after the title ("Version 2"). */
  badge?: React.ReactNode
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
  /**
   * Steps / tabs options: conditional pages (`rules`, off for start forms,
   * whose inputs are checked without the layout) and "resume later"
   * (`resume`, a reusable form's own page).
   */
  pageOptions?: { rules?: boolean; resume?: boolean }
  /**
   * The saved reusable form being edited, if any: Preview's test inputs are
   * remembered under it, and "Copy link with these parameters" offers its
   * form page link.
   */
  formId?: string
}

/** Preview test inputs remembered in this browser (lib/forms/preview-inputs.ts); never part of the form. */
function readPreviewInputs(key: string, layout: unknown): PreviewTestInputs {
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(key)
    return raw ? normalizePreviewInputs(layout, JSON.parse(raw)) : EMPTY_PREVIEW_INPUTS
  } catch { return EMPTY_PREVIEW_INPUTS }
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

function DesignerBody({ onClose, title, subtitle, badge, initial, actions, allowedTypes = TASK_FIELD_TYPES, savedThemes, canSaveTheme, onSaveTheme, findReferences, saveAsReusable, hideTheme, formSettings = {}, pageOptions = {}, formId }: FormDesignerDialogProps) {
  const start = useMemo(() => designerStateFrom(initial), [initial])
  const initialKey = useMemo(() => formDefinitionKey(definitionFrom(start)), [start])
  const initialKeys = useMemo(() => new Map(start.fields.map((f) => [f._id, f.key])), [start])
  const history = useHistory<DesignerState>(start)
  const state = history.state
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<'field' | 'section' | 'page' | 'form' | 'rules' | 'data' | 'theme' | 'a11y'>('field')
  const [selectedSection, setSelectedSection] = useState<string | null>(null)
  const [activePage, setActivePage] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; moveTo: string } | null>(null)
  const [a11yGate, setA11yGate] = useState<DesignerAction | null>(null)
  const [previewEffects, setPreviewEffects] = useState<ButtonEffects | null>(null)
  const [view, setView] = useState<'design' | 'preview'>('design')
  const [paletteSearch, setPaletteSearch] = useState('')
  const { mode: appMode } = useWorkspaceTheme()
  const [previewMode, setPreviewMode] = useState<ThemeMode>(appMode)
  // Replay animation: remounts the preview so the form's load animation runs again.
  const [replay, setReplay] = useState(0)
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'mobile'>('desktop')
  const [busy, setBusy] = useState<string | null>(null)
  // Synchronous guard: two clicks in one frame both see `busy === null`.
  const actionGuard = useSubmitGuard()
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ action: DesignerAction; refs: Array<FieldReference & { from: string; to: string }> } | null>(null)
  const [reusable, setReusable] = useState<{ name: string; description: string; tags: string } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  // Resizable / maximizable dialog, collapsible side panels (remembered in this browser).
  const frame = useResizableDialog()

  const definition = useMemo(() => definitionFrom(state), [state])
  const dirty = formDefinitionKey(definition) !== initialKey
  // The Agent: this dialog hosts its panel (a modal makes the shell's inert) and, for a saved form, is the open item.
  const agentPanel = useAgentDock()
  const agentSummary = useMemo(() => {
    const lines = state.fields.slice(0, 80).map((f) => `${f.key} (${f.type}${f.required ? ', required' : ''}): ${String(f.label ?? '').slice(0, 60)}`)
    return `${state.fields.length} field${state.fields.length === 1 ? '' : 's'}${isPaged(state.layout) ? ` on ${state.layout.pages.length} pages` : ''}:\n${lines.join('\n')}`.slice(0, 4_000)
  }, [state.fields, state.layout])
  useDesignerContext(formId ? { area: 'form', item_id: formId, item_name: title, dirty, summary: agentSummary } : null)
  const problems = useMemo(() => designerProblems(state), [state])
  // Steps / tabs: the page being edited (its grid in the centre, its settings in the Page tab).
  const pages = isPaged(state.layout) ? state.layout.pages : []
  const activeId = pages.find((p) => p.id === activePage)?.id ?? pages[0]?.id ?? null
  const activePageDef = pages.find((p) => p.id === activeId) ?? null
  const gridState = useMemo<DesignerState>(() => (isPaged(state.layout) ? { ...state, layout: pageGrid(state.layout, activeId) } : state), [state, activeId])
  const pageBlocking = useMemo(() => pageProblems(state.layout).blocking, [state.layout])
  const pageNoun = isPaged(state.layout) && state.layout.mode === 'tabs' ? 'Tab' : 'Step'
  const themeRef = state.theme
  const themeOverrides: FormThemeOverrides | null = themeRef.source === 'custom' ? themeRef.overrides
    : themeRef.source === 'saved' ? (savedThemes.find((t) => t.id === themeRef.theme_id)?.overrides ?? null) : null
  const previewCanvas = useFormPageCanvas(themeOverrides, previewMode)
  const themeBlocking = state.theme.source === 'custom' ? blockingFormThemeIssues(state.theme.overrides) : []
  const buttonIssues = useMemo(() => (formSettings === false ? {} : buttonProblems(state.buttons, { outcomes: formSettings.outcomes, policy: { appOrigin: typeof window !== 'undefined' ? window.location.origin : null }, editableTables: new Set(state.fields.filter((f) => f.type === 'data_table' && f.data_table?.mode === 'edit').map((f) => f.key)) })), [state.buttons, state.fields, formSettings])
  const ruleIssues = useMemo(() => designerRuleProblems(state), [state])
  const sectionIssues = useMemo(() => designerSectionProblems(state), [state])
  const sectionDef = (state.layout.sections ?? []).find((s) => s.key === selectedSection) ?? null
  const problemCount = Object.keys(problems).length + Object.keys(buttonIssues).length + (themeBlocking.length ? 1 : 0) + Object.keys(pageBlocking).length + Object.keys(ruleIssues).length + Object.keys(sectionIssues).length
  const selected = state.fields.find((f) => f._id === selectedId) ?? null
  const contextCount = (state.layout.params?.length ?? 0) + (state.layout.variables?.length ?? 0)
  const ruleCount = useMemo(() => collectFormRules({ fields: state.fields as never, layout: state.layout as never, buttons: state.buttons as never }).length, [state])
  const a11y = useFormAccessibility(definition, themeOverrides, formSettings !== false && formSettings.showDraft ? 'task' : undefined)
  // A task form in Application mode with no in-form Submit (completed from the task header only).
  const noSubmit = formSettings !== false && formSettings.showDraft ? submitPathProblem(definition.fields, definition.layout, 'task') : null

  // Preview test inputs: parameter values (as if the form were opened with them) and variable overrides.
  const inputsKey = previewInputsStorageKey(formId ?? `title:${title}`)
  const [testInputs, setTestInputs] = useState<PreviewTestInputs>(() => readPreviewInputs(inputsKey, initial.layout))
  const [showInputs, setShowInputs] = useState(true)
  // Remounts the preview when the parameters change, so "Form loads" rules run again as on opening.
  const [previewRun, setPreviewRun] = useState(0)
  useEffect(() => {
    try {
      if (Object.keys(testInputs.params).length || Object.keys(testInputs.vars).length) window.localStorage.setItem(inputsKey, JSON.stringify(testInputs))
      else window.localStorage.removeItem(inputsKey)
    } catch { /* storage unavailable */ }
  }, [inputsKey, testInputs])
  const seed = useMemo(() => previewSeed(definition.fields, definition.layout, testInputs), [definition.fields, definition.layout, testInputs])
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>(() => seed.initialValues)
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({})
  const shownValues = useMemo(() => previewShownValues(seed, previewValues), [seed, previewValues])
  const seedRef = useRef(seed)
  useEffect(() => { seedRef.current = seed }, [seed])
  const paramsKey = JSON.stringify(seed.params?.values ?? null)
  const appliedParams = useRef(paramsKey)
  useEffect(() => {
    if (appliedParams.current === paramsKey) return
    // Debounced: typing a value reopens the preview once.
    const timer = setTimeout(() => {
      appliedParams.current = paramsKey
      setPreviewValues(seedRef.current.initialValues)
      setPreviewErrors({})
      setPreviewEffects(null)
      setPreviewRun((n) => n + 1)
    }, 350)
    return () => clearTimeout(timer)
  }, [paramsKey])
  const liveVars = useMemo(() => (withFormContext(definition.layout, shownValues)[FORM_VARS_KEY] ?? {}) as Record<string, unknown>, [definition.layout, shownValues])
  const initialVars = useMemo(() => (withFormContext(definition.layout, { ...shownValues, [FORM_VARS_KEY]: null })[FORM_VARS_KEY] ?? {}) as Record<string, unknown>, [definition.layout, shownValues])
  const declaredParams = useMemo(() => layoutFormParams(definition.layout), [definition.layout])
  const paramLink = formId && declaredParams.some((p) => p.source === 'url') ? formUrlWithParams(publicFormPageUrl(formId), declaredParams, testInputs.params) : null
  const dropVar = (values: Record<string, unknown>, name: string | null) => {
    if (!(FORM_VARS_KEY in values)) return values
    const next = { ...values }
    if (name === null) { delete next[FORM_VARS_KEY]; return next }
    const vars = setVariables(values)
    delete vars[name]
    next[FORM_VARS_KEY] = vars
    return next
  }

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
    const { state: next, field } = addField(state, type, undefined, activeId)
    change(next)
    setSelectedId(field._id)
    setTab('field')
    setAnnouncement(`${TASK_FIELD_TYPE_LABELS[type]} added in a new row${activePageDef ? ` on ${activePageDef.title}` : ''}`)
    requestAnimationFrame(() => document.getElementById(`form-cell-${field._id}`)?.focus())
  }

  async function runAction(action: DesignerAction, updateReferences: boolean) {
    await actionGuard.run(async () => {
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
    })
  }

  function startAction(action: DesignerAction, a11yChecked = false) {
    if (problemCount > 0) { setError('Fix the highlighted problems first'); return }
    if (!a11yChecked && a11y.belowMinimum) { setA11yGate(action); return }
    const renames = keyRenames(initialKeys, state)
    const refs = findReferences ? renames.flatMap((r) => findReferences(r.from).map((ref) => ({ ...ref, ...r }))) : []
    if (refs.length) { setPendingAction({ action, refs }); return }
    void runAction(action, false)
  }

  const paletteQuery = paletteSearch.trim().toLowerCase()
  const paletteMatch = (label: string) => !paletteQuery || label.toLowerCase().includes(paletteQuery)

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) requestClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlayClass} />
        <Dialog.Content
          ref={rootRef}
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          // Focus the dialog itself, not the first control (the title's info button would pop its tooltip).
          onOpenAutoFocus={(e) => { e.preventDefault(); rootRef.current?.focus() }}
          className={cn('ds-dialog fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-bg text-fg shadow-elev-3 outline-none', frame.resizing && 'select-none')}
          style={{ ...frame.contentStyle }}
          data-testid="form-designer"
          data-maximized={frame.fullScreen ? 'true' : 'false'}
        >
          {frame.handles.map(({ key, ...handle }) => <div key={key} {...handle} />)}
          <div className="sr-only" aria-live="polite">{announcement}</div>
          {/* Header */}
          <div className="flex min-h-14 flex-wrap items-center gap-2 border-b border-border-subtle bg-panel px-4 py-2"
            onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button, input, select, textarea, a') && !frame.mobile) frame.toggleMaximized() }}
            data-designer-header>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Dialog.Title className="truncate text-base font-semibold">{title}</Dialog.Title>
              {badge != null && <Tag className="shrink-0">{badge}</Tag>}
              {subtitle && (
                <Tooltip content={<span className="block max-w-xs">{subtitle}</span>}>
                  <button type="button" className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-subtle hover:text-fg" aria-label="About saving this form" data-designer-subtitle>
                    <Info size={14} aria-hidden />
                  </button>
                </Tooltip>
              )}
              {subtitle && <span className="sr-only">{subtitle}</span>}
            </div>
            <TooltipProvider>
              <div className="flex items-center gap-0.5">
                <IconButton label="Undo" kbd="Ctrl Z" icon={<Undo2 />} onClick={history.undo} disabled={!history.canUndo} tooltipSide="bottom" />
                <IconButton label="Redo" kbd="Ctrl ⇧ Z" icon={<Redo2 />} onClick={history.redo} disabled={!history.canRedo} tooltipSide="bottom" />
              </div>
              <SegmentedControl aria-label="View" value={view} onValueChange={setView}
                options={[{ value: 'design', text: 'Design', icon: <Pencil /> }, { value: 'preview', text: 'Preview', icon: <Eye /> }]} />
              <div className="flex items-center gap-0.5">
                {view === 'design' && (
                  <IconButton label={frame.paletteCollapsed ? 'Show the field palette' : 'Hide the field palette'} icon={frame.paletteCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
                    onClick={frame.togglePalette} aria-pressed={!frame.paletteCollapsed} data-designer-toggle="palette" tooltipSide="bottom" />
                )}
                <IconButton label={frame.propertiesCollapsed ? 'Show the properties panel' : 'Hide the properties panel'} icon={frame.propertiesCollapsed ? <PanelRightOpen /> : <PanelRightClose />}
                  onClick={frame.toggleProperties} aria-pressed={!frame.propertiesCollapsed} data-designer-toggle="properties" tooltipSide="bottom" />
                {!frame.mobile && (
                  <IconButton label={frame.maximized ? 'Restore designer size' : 'Maximize designer'} icon={frame.maximized ? <Minimize2 /> : <Maximize2 />}
                    onClick={frame.toggleMaximized} aria-pressed={frame.maximized} data-designer-maximize tooltipSide="bottom" />
                )}
                <AgentDialogButton />
                <IconButton label="Close" icon={<X />} onClick={requestClose} tooltipSide="bottom" />
              </div>
            </TooltipProvider>
          </div>

          {/* Body */}
          <div className="flex min-h-0 flex-1">
            {/* Palette */}
            {view === 'design' && !frame.paletteCollapsed && (
              <aside className="flex w-52 shrink-0 flex-col border-r border-border-subtle bg-panel" aria-label="Field palette">
                <div className="space-y-1.5 p-3 pb-2">
                  <SearchInput size="sm" aria-label="Search fields" placeholder="Search fields" value={paletteSearch} onValueChange={setPaletteSearch} />
                  <p className="text-2xs text-fg-muted">Drag onto the grid, or press Enter to add.</p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">
                {PALETTE_GROUPS.map((group) => {
                  const types = group.types.filter((t) => allowedTypes.includes(t) && paletteMatch(TASK_FIELD_TYPE_LABELS[t]))
                  if (!types.length) return null
                  return (
                    <div key={group.label} className="mb-2" role="group" aria-labelledby={`palette-group-${group.label}`}>
                      <p id={`palette-group-${group.label}`} className={paletteGroupClass}>{group.label}</p>
                      <div>
                        {types.map((type) => {
                          const Icon = FIELD_ICONS[type]
                          return (
                            <button
                              key={type}
                              type="button"
                              draggable
                              onDragStart={(e) => { e.dataTransfer.setData(DRAG_NEW_TYPE, type); e.dataTransfer.effectAllowed = 'copy' }}
                              onClick={() => addType(type)}
                              className={paletteItemClass}
                              data-palette-type={type}
                            >
                              <Icon className="shrink-0 text-fg-muted" size={14} aria-hidden />
                              <span className="truncate">{TASK_FIELD_TYPE_LABELS[type]}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                {allowedTypes.includes('custom') && <CustomControlsPalette onAdd={() => addType('custom')} filter={paletteQuery} />}
                {paletteMatch('Section') && (
                <div className="mb-2">
                  <p className={paletteGroupClass}>Group</p>
                  <button
                    type="button"
                    onClick={() => {
                      const r = addSection(state, activeId)
                      change(r.state)
                      setSelectedSection(r.key); setSelectedId(null); setTab('section')
                      setAnnouncement('Section added at the end of the grid: drop fields into it')
                    }}
                    className={paletteItemClass}
                    data-palette-section
                  >
                    <LayoutList className="shrink-0 text-fg-muted" size={14} aria-hidden />
                    Section
                  </button>
                </div>
                )}
                </div>
              </aside>
            )}

            {/* Centre */}
            <main className="min-w-0 flex-1 overflow-y-auto p-4" aria-label={view === 'design' ? 'Form grid' : 'Preview'}>
              {view === 'design' ? (<>
                <PageStrip
                  state={state}
                  activeId={activeId}
                  onSelect={(id) => { setActivePage(id); setSelectedId(null); setTab('page') }}
                  onChange={change}
                  onFieldAdded={(id) => { setSelectedId(id); setTab('field') }}
                  announce={setAnnouncement}
                />
                {activePageDef && (
                  <div className="mb-2 flex items-baseline gap-2 text-xs" data-active-page={activePageDef.id}>
                    <span className="font-semibold">{pageNoun} {pages.indexOf(activePageDef) + 1}: {activePageDef.title || 'Untitled'}</span>
                    {activePageDef.visible_when && <span className="text-fg-muted">· shown when {state.fields.find((f) => f.key === activePageDef.visible_when!.field)?.label || activePageDef.visible_when.field} {activePageDef.visible_when.operator.replace(/_/g, ' ')}{activePageDef.visible_when.value ? ` “${activePageDef.visible_when.value}”` : ''}</span>}
                  </div>
                )}
                <GridCanvas
                  state={gridState}
                  selectedId={selectedId}
                  problems={problems}
                  onSelect={(id) => { setSelectedId(id); if (id) { setSelectedSection(null); setTab('field') } }}
                  sections={state.layout.sections ?? []}
                  selectedSection={selectedSection}
                  onSelectSection={(key) => { setSelectedSection(key); setSelectedId(null); if (key) setTab('section') }}
                  sectionProblems={sectionIssues}
                  onChange={(next, tag) => change(onPage(state, activeId, () => next), tag)}
                  announce={setAnnouncement}
                />
              </>) : (
                <div className="flex min-h-full flex-col">
                  <div className="mb-0 flex flex-wrap items-center gap-2 pb-3">
                    <SegmentedControl aria-label="Preview mode" size="sm" value={previewMode} onValueChange={setPreviewMode}
                      options={[{ value: 'light', text: 'Light', icon: <Sun /> }, { value: 'dark', text: 'Dark', icon: <Moon /> }]} />
                    <SegmentedControl aria-label="Preview width" size="sm" value={previewWidth} onValueChange={setPreviewWidth}
                      options={[{ value: 'desktop', text: 'Desktop', icon: <Monitor /> }, { value: 'mobile', text: 'Phone', icon: <Smartphone /> }]} />
                    {contextCount > 0 && (
                      <Button size="sm" variant={showInputs ? 'secondary' : 'ghost'} leadingIcon={<SlidersHorizontal className="size-[var(--btn-icon)]" aria-hidden />}
                        onClick={() => setShowInputs((v) => !v)} aria-expanded={showInputs} aria-controls="designer-preview-inputs" title="Test the preview with parameter values and variable overrides" data-preview-inputs-toggle>
                        Inputs ({contextCount})
                      </Button>
                    )}
                    <div className="flex-1" />
                    <Button size="sm" variant="ghost" leadingIcon={<RotateCcw className="size-[var(--btn-icon)]" aria-hidden />} onClick={() => setReplay((n) => n + 1)}
                      disabled={formAnimation(definition.layout).style === 'none'} title="Play the form's load animation again" data-replay-animation>Replay animation</Button>
                    <Button size="sm" variant="secondary" onClick={() => setPreviewErrors(validateTaskFieldValues(definition.fields, shownValues, { layout: definition.layout }))}>Check validation</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setPreviewValues(seed.initialValues); setPreviewErrors({}) }}>Reset values</Button>
                  </div>
                  {contextCount > 0 && showInputs && (
                    <div id="designer-preview-inputs">
                      <PreviewTestInputsPanel
                        layout={definition.layout}
                        inputs={testInputs}
                        seed={seed}
                        liveVars={liveVars}
                        initialVars={initialVars}
                        copyLink={paramLink}
                        onParamChange={(name, text) => setTestInputs((prev) => {
                          const params = { ...prev.params }
                          if (text.trim()) params[name] = text
                          else delete params[name]
                          return { ...prev, params }
                        })}
                        onClearParams={() => setTestInputs((prev) => ({ ...prev, params: {} }))}
                        onVarChange={(name, text, value) => {
                          setTestInputs((prev) => ({ ...prev, vars: { ...prev.vars, [name]: text } }))
                          if (value !== undefined) setPreviewValues((prev) => ({ ...prev, [FORM_VARS_KEY]: { ...setVariables(prev), [name]: value } }))
                        }}
                        onVarReset={(name) => {
                          setTestInputs((prev) => { const vars = { ...prev.vars }; delete vars[name]; return { ...prev, vars } })
                          setPreviewValues((prev) => dropVar(prev, name))
                        }}
                        onResetAllVars={() => {
                          setTestInputs((prev) => ({ ...prev, vars: {} }))
                          setPreviewValues((prev) => dropVar(prev, null))
                        }}
                      />
                    </div>
                  )}
                  <div className={cn('-mx-4 -mb-4 flex-1 px-4 pb-8 pt-6', previewCanvas && 'border-t border-border-subtle')} style={previewCanvas ?? undefined} data-preview-canvas={previewCanvas ? 'theme' : undefined}>
                  <div className={cn('mx-auto', previewWidth === 'mobile' ? 'w-[375px] max-w-full' : formCardWidthClass(themeOverrides, definition.fields))} style={previewWidth === 'mobile' ? undefined : formWidthStyle(themeOverrides) as React.CSSProperties} data-preview-width={previewWidth} data-preview-mode={previewMode}>
                    <FormThemeScope key={`${replay}-${previewRun}`} overrides={state.header.enabled && themeOverrides?.header ? { ...themeOverrides, header: undefined } : themeOverrides} mode={previewMode} page={formSettings !== false} motion={formAnimation(definition.layout)}>
                      <FormLookupProvider source={{ kind: 'preview' }}>
                      <FormPagesProvider fields={definition.fields} layout={definition.layout} values={shownValues} errors={previewErrors} idPrefix="preview-">
                      {formSettings !== false && <FormHeaderBlock header={state.header} values={shownValues} overrides={themeOverrides} />}
                      {previewEffects?.success_screen ? (
                        <FormSuccessScreen screen={previewEffects.success_screen} messages={previewEffects.messages} autoFocus={false} onSubmitAnother={() => { setPreviewEffects(null); setPreviewValues((prev) => freshSubmissionValues(prev)) }} onClose={() => setPreviewEffects(null)} />
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
                        <FormStepActions>
                          {previewEffects && <FormMessages messages={previewEffects.messages} onDismiss={(i) => setPreviewEffects({ ...previewEffects, messages: previewEffects.messages.filter((_, j) => j !== i) })} />}
                          {previewEffects?.redirect && <p className="mt-2 text-xs text-fg-muted" role="status">Would go to {previewEffects.redirect}</p>}
                          <FormButtonBar
                            buttons={state.buttons.filter((b) => formSettings.showDraft || b.kind !== 'draft')}
                            placement={themeOverrides?.button_placement}
                            onClick={(button) => {
                              if (button.kind === 'cancel') { setPreviewValues(seed.initialValues); setPreviewErrors({}); setPreviewEffects(planButtonEffects(button, { values: shownValues }, { appOrigin: window.location.origin })); return }
                              if (button.kind !== 'draft') {
                                const errs = validateTaskFieldValues(definition.fields, shownValues, { layout: definition.layout, buttonIds: [button.id] })
                                setPreviewErrors(errs)
                                if (Object.keys(errs).length) return
                              }
                              // Preview: no workflow is started; {{run_reference}} shows a placeholder.
                              const scope = { values: shownValues, extras: { run_reference: 'PREVIEW', submission_id: 'PREVIEW' } }
                              const planned = planButtonEffects(button, scope, { appOrigin: window.location.origin })
                              // The form's Submitted page (not for task forms, as at run time).
                              setPreviewEffects(button.kind === 'draft' ? planned : applySubmittedPage(planned, { layout: definition.layout, fields: definition.fields, scope, surface: formSettings.showDraft ? 'task' : 'page' }))
                            }}
                          />
                        </FormStepActions>
                      )}
                      </>)}
                      </FormPagesProvider>
                      </FormLookupProvider>
                    </FormThemeScope>
                  </div>
                  </div>
                </div>
              )}
            </main>

            {/* Properties */}
            {!frame.propertiesCollapsed && <aside className={cn('flex shrink-0 flex-col border-l border-border-subtle bg-panel', tab === 'rules' ? 'w-[34rem] max-w-[55%]' : 'w-[26rem] max-w-[45%]')} aria-label="Properties">
              <InspectorTabs
                tab={tab}
                onTab={setTab}
                tabs={[
                  { value: 'field', label: 'Field' },
                  ...(sectionDef ? [{ value: 'section' as const, label: 'Section' }] : []),
                  ...(activePageDef ? [{ value: 'page' as const, label: pageNoun }] : []),
                  ...(formSettings === false ? [] : [{ value: 'form' as const, label: 'Header' }]),
                  { value: 'rules', label: 'Rules', count: ruleCount, problem: Object.keys(ruleIssues).length > 0, srLabel: `Rules, ${ruleCount} rule${ruleCount === 1 ? '' : 's'}${Object.keys(ruleIssues).length ? ', with problems' : ''}` },
                  { value: 'data', label: 'Data', count: contextCount },
                  ...(hideTheme ? [] : [{ value: 'theme' as const, label: 'Theme' }]),
                  { value: 'a11y', label: 'Checks', score: a11y.result.score, srLabel: `Accessibility, score ${a11y.result.score} of 100` },
                ]}
              />
              {/* Every variable input in the panel gets the form's variables (rules, buttons, tables… set narrower scopes). */}
              <DesignerPreviewValuesProvider value={shownValues}>
              <DesignerVariableScope state={state} context={{ kind: 'header' }}>
              <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin" id={`designer-panel-${tab}`}>
                {tab === 'a11y' ? (
                  <AccessibilityPanel a11y={a11y} state={state} definition={definition} formName={title} view={view} setView={setView}
                    previewMode={previewMode} setPreviewMode={setPreviewMode} onChange={change} onSelectField={(id) => { setSelectedId(id); setTab('field') }} />
                ) : tab === 'page' && activePageDef ? (
                  <PageProperties
                    key={activePageDef.id}
                    state={state}
                    page={activePageDef}
                    onChange={change}
                    allowRules={pageOptions.rules !== false}
                    allowResume={pageOptions.resume !== false}
                    onDuplicate={() => {
                      const r = duplicatePage(state, activePageDef.id)
                      if (r) { change(r.state); setActivePage(r.id); setAnnouncement(`${pageNoun} duplicated`) }
                    }}
                    onDelete={() => {
                      const at = pages.indexOf(activePageDef)
                      const fallback = pages[at - 1] ?? pages[at + 1]
                      if (!pageFieldKeys(activePageDef).length) {
                        change(deletePage(state, activePageDef.id, null))
                        setActivePage(fallback?.id ?? null)
                        setAnnouncement(`${pageNoun} deleted`)
                        return
                      }
                      setPendingDelete({ id: activePageDef.id, moveTo: fallback?.id ?? '' })
                    }}
                  />
                ) : tab === 'section' && sectionDef ? (
                  <SectionProperties
                    key={sectionDef.key}
                    state={state}
                    section={sectionDef}
                    onChange={(next, tag) => {
                      // A renamed key: keep the section selected.
                      const before = new Set((state.layout.sections ?? []).map((s) => s.key))
                      const renamed = (next.layout.sections ?? []).find((s) => !before.has(s.key))
                      change(next, tag)
                      if (renamed) setSelectedSection(renamed.key)
                    }}
                    onRemoved={() => { setSelectedSection(null); setTab('field'); setAnnouncement('Section removed; its fields stay on the form') }}
                    allowOptional={pageOptions.rules !== false}
                  />
                ) : tab === 'rules' ? (
                  <DesignerPreviewValuesProvider value={shownValues}>
                    <RulesPanel state={state} onChange={(next, tag) => change(next, tag)} />
                  </DesignerPreviewValuesProvider>
                ) : tab === 'data' ? (
                  <FormContextPanel state={state} onChange={(next, tag) => change(next, tag)} />
                ) : tab === 'theme' && !hideTheme ? (
                  <ThemeEditor value={state.theme} onChange={(theme) => change({ ...state, theme }, 'theme')} savedThemes={savedThemes} canSaveTheme={canSaveTheme} onSaveTheme={onSaveTheme} formHeaderOn={formSettings !== false && state.header.enabled} />
                ) : tab === 'form' && formSettings !== false ? (
                  <DesignerPreviewValuesProvider value={shownValues}>
                    <FormSettings state={state} onChange={(next, tag) => change(next, tag)} outcomes={formSettings.outcomes} showDraft={formSettings.showDraft} problems={buttonIssues} />
                  </DesignerPreviewValuesProvider>
                ) : selected ? (
                  <DesignerPreviewValuesProvider value={shownValues}>
                  <FieldProperties
                    key={selected._id}
                    state={state}
                    field={selected}
                    allowedTypes={allowedTypes}
                    onPatch={(patch, tag) => change(updateField(state, selected._id, patch), tag)}
                    onChangeState={(next) => change(next)}
                    onRemove={() => { change(removeField(state, selected._id)); setSelectedId(null) }}
                    onDuplicate={() => { const r = duplicateField(state, selected._id); if (r) { change(r.state); setSelectedId(r.field._id) } }}
                    onConvertToSection={selected.type === 'heading' ? () => {
                      const r = convertHeadingToSection(state, selected._id)
                      if (!r) return
                      change(r.state); setSelectedId(null); setSelectedSection(r.key); setTab('section')
                      setAnnouncement('Heading converted to a section')
                    } : undefined}
                  />
                  </DesignerPreviewValuesProvider>
                ) : (
                  <div className="space-y-2 text-xs text-fg-muted">
                    <p>Select a field on the grid to edit its label, key, validation and visibility.</p>
                    <p>Each field&apos;s key is available downstream as <code className="text-primary-text">{'{{task_data.<key>}}'}</code>.</p>
                    <p>Keyboard: Tab to a field, Alt+Arrow keys to move it, Delete to remove it, Ctrl+Z to undo.</p>
                    <p>{state.fields.length} field{state.fields.length === 1 ? '' : 's'} in {allRows(state.layout).length} row{allRows(state.layout).length === 1 ? '' : 's'}{pages.length ? ` on ${pages.length} ${pageNoun.toLowerCase()}${pages.length === 1 ? '' : 's'}` : ''}.</p>
                    <p>Steps or tabs: choose the layout above the grid to split the form into pages.</p>
                  </div>
                )}
              </div>
              </DesignerVariableScope>
              </DesignerPreviewValuesProvider>
            </aside>}
            {agentPanel}
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle bg-panel px-4 py-3">
            <p className={cn('flex min-w-0 flex-1 items-center gap-1.5 text-xs', error || problemCount ? 'text-danger' : 'text-fg-muted')} role={error ? 'alert' : undefined} data-designer-status>
              <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', error || problemCount ? 'bg-danger' : dirty ? 'bg-warning' : 'bg-border-strong')} />
              <span className="min-w-0">
                {error ?? (problemCount ? `${problemCount} problem${problemCount === 1 ? '' : 's'} to fix before saving` : dirty ? 'Unsaved changes' : 'No changes')}
                {!error && !problemCount && noSubmit && <span className="ml-2 text-warning" data-testid="footer-no-submit">· Application mode: no button on the form submits</span>}
              </span>
            </p>
            {saveAsReusable && (
              <Button size="sm" variant="secondary" leadingIcon={<Library />} onClick={() => setReusable({ name: '', description: '', tags: '' })} disabled={Boolean(busy)}>
                Save as reusable form
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={requestClose} disabled={Boolean(busy)}>Cancel</Button>
            {actions.filter((a) => !a.hidden).map((action) => (
              <Button key={action.id} size="sm" variant={action.variant === 'outline' ? 'secondary' : 'primary'} onClick={() => startAction(action)} disabled={Boolean(busy) && busy !== action.id} loading={busy === action.id} data-action={action.id}>
                {busy === action.id ? 'Saving…' : action.label}
              </Button>
            ))}
          </div>

          {/* Accessibility check before saving (workspace setting forms.accessibility) */}
          {a11yGate && (
            <Overlay>
              <AccessibilitySaveCheck a11y={a11y} onCancel={() => setA11yGate(null)} onReview={() => { setA11yGate(null); setTab('a11y') }}
                onSaveAnyway={() => { const action = a11yGate; setA11yGate(null); startAction(action, true) }} />
            </Overlay>
          )}

          {/* Unsaved-changes guard */}
          {confirmClose && (
            <Overlay>
              <p className="text-base font-semibold">Discard your changes?</p>
              <p className="mt-1 text-sm text-fg-muted">The form has changes that haven&apos;t been saved.</p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setConfirmClose(false)}>Keep editing</Button>
                <Button variant="danger" onClick={onClose}>Discard changes</Button>
              </div>
            </Overlay>
          )}

          {/* Delete a step / tab that has fields */}
          {pendingDelete && (() => {
            const page = pages.find((p) => p.id === pendingDelete.id)
            if (!page) return null
            const count = pageFieldKeys(page).length
            const others = pages.filter((p) => p.id !== page.id)
            return (
              <Overlay>
                <p className="text-base font-semibold">Delete “{page.title || 'Untitled'}”?</p>
                <p className="mt-1 text-sm text-fg-muted">It has {count} field{count === 1 ? '' : 's'}. Move {count === 1 ? 'it' : 'them'} to another {pageNoun.toLowerCase()}, or delete {count === 1 ? 'it' : 'them'} with the {pageNoun.toLowerCase()} (undo with Ctrl+Z).</p>
                <Field label="Move the fields to" className="mt-3">
                  <Select value={pendingDelete.moveTo} onChange={(e) => setPendingDelete({ ...pendingDelete, moveTo: e.target.value })} data-delete-move-to
                    options={others.map((p) => ({ value: p.id, label: p.title || 'Untitled' }))} />
                </Field>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={() => setPendingDelete(null)}>Cancel</Button>
                  <Button variant="danger-ghost" data-delete-page-fields onClick={() => {
                    change(deletePage(state, page.id, null)); setActivePage(pendingDelete.moveTo || null); setPendingDelete(null); setSelectedId(null); setAnnouncement(`${pageNoun} and its fields deleted`)
                  }}>Delete with fields</Button>
                  <Button data-delete-page-move disabled={!pendingDelete.moveTo} onClick={() => {
                    change(deletePage(state, page.id, pendingDelete.moveTo)); setActivePage(pendingDelete.moveTo); setPendingDelete(null); setAnnouncement(`${pageNoun} deleted; its fields moved`)
                  }}>Move fields and delete</Button>
                </div>
              </Overlay>
            )
          })()}

          {/* Renamed keys used downstream */}
          {pendingAction && (
            <Overlay>
              <p className="text-base font-semibold">Renamed keys are used later in the workflow</p>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-ui">
                {pendingAction.refs.map((ref, i) => (
                  <li key={i}>
                    <span className="font-medium">{ref.node_label}</span>
                    <span className="text-fg-muted"> · {ref.path || 'config'} · </span>
                    <code className="font-mono text-xs">{ref.from}</code> → <code className="font-mono text-xs">{ref.to}</code>{ref.count > 1 ? ` (${ref.count}×)` : ''}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-fg-muted">Update those references to the new keys, or keep them (they will no longer resolve).</p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setPendingAction(null)}>Cancel</Button>
                <Button variant="secondary" onClick={() => void runAction(pendingAction.action, false)}>Keep references</Button>
                <Button onClick={() => void runAction(pendingAction.action, true)} data-action="update-references">Update references</Button>
              </div>
            </Overlay>
          )}

          {/* Save as reusable form */}
          {reusable && saveAsReusable && (
            <Overlay>
              <p className="text-base font-semibold">Save as a reusable form</p>
              <p className="mt-1 text-sm text-fg-muted">The form goes into the Forms library and this step links to it: later edits to the form create new versions.</p>
              <div className="mt-3 space-y-3">
                <Field label="Name"><Input autoFocus value={reusable.name} onChange={(e) => setReusable({ ...reusable, name: e.target.value })} data-testid="reusable-name" /></Field>
                <Field label="Description" optional><Input value={reusable.description} onChange={(e) => setReusable({ ...reusable, description: e.target.value })} /></Field>
                <Field label="Tags" description="Comma separated" optional><Input value={reusable.tags} onChange={(e) => setReusable({ ...reusable, tags: e.target.value })} /></Field>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setReusable(null)}>Cancel</Button>
                <Button
                  loading={busy === 'reusable'}
                  disabled={!reusable.name.trim() || busy === 'reusable' || problemCount > 0}
                  data-action="save-reusable"
                  onClick={() => actionGuard.run(async () => {
                    setBusy('reusable')
                    const message = await saveAsReusable.run(definition, { name: reusable.name.trim(), description: reusable.description.trim(), tags: reusable.tags.split(',').map((t) => t.trim()).filter(Boolean) })
                    setBusy(null)
                    if (message) setError(message)
                    else { setReusable(null); onClose() }
                  })}
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
    <div className="ds-overlay absolute inset-0 z-10 flex items-center justify-center bg-[color:var(--theme-overlay)] p-4" role="alertdialog" aria-modal="true">
      <div className="ds-dialog w-[min(30rem,92vw)] rounded-xl bg-elevated p-6 text-fg shadow-elev-3">
        {children}
      </div>
    </div>
  )
}
