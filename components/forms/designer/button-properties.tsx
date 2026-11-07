'use client'

import { AnonymousStepToggle } from './anonymous-step-toggle'
import { TableChangesEditor } from './table-changes-editor'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { VariableInput } from '@/components/automations/variable-input'
import type { DesignerField, DesignerState } from '@/lib/forms/designer-state'
import {
  FIELD_BUTTON_ACTION_LABELS, FIELD_BUTTON_ACTION_TYPES, FIELD_BUTTON_ICONS, FIELD_BUTTON_LIMITS, describeFieldButton,
  type FieldButtonAction, type FieldButtonActionType, type FieldButtonConfig,
} from '@/lib/forms/field-buttons'
import { FORM_TARGET_LABELS, flagKey, parseTarget, type FormTargetKind } from '@/lib/forms/form-state'
import { isPaged } from '@/lib/forms/layout'
import { isSubmittingButton } from '@/lib/forms/buttons'
import { DISPLAY_FIELD_TYPES, type TaskFieldDef } from '@/lib/task-field-schema'
import { VisibleWhenEditor } from './field-properties'
import { FieldButtonIconView } from '@/components/forms/field-button'
import { contextVariableOptions } from '@/lib/forms/form-params'
import { presetButtons } from '@/lib/forms/form-messages'
import { BranchActions, MessageActionEditor, PromptActionEditor } from './message-editor'
import { DesignerVariableScope } from './designer-variable-scope'
import { designerInputClass as inputClass } from './designer-controls'
import { cn } from '@/lib/utils'

/**
 * Properties of an in-form Button (lib/forms/field-buttons.ts): its look,
 * "Disabled when", and the On click builder — an ordered list of steps,
 * the same UX as the bar buttons' behaviours. Show / hide targets can be
 * marked "starts hidden" (layout.state.hidden); state flags are declared
 * in Buttons & header → Form state (or here, with "New flag").
 */


function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</label>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-2xs text-fg-muted">{children}</p>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-2 border-t pt-3 border-border">
      <legend className="pr-2 text-2xs font-semibold text-fg-muted">{title}</legend>
      {children}
    </fieldset>
  )
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn('h-7 flex-1 rounded border px-1 text-2xs font-medium', value === v ? 'border-primary' : 'border-border', value === v ? 'bg-primary-wash' : '', value === v ? 'text-primary-text' : 'text-fg')}
         >
          {text}
        </button>
      ))}
    </div>
  )
}

interface TargetOption { target: string; label: string; kind: FormTargetKind }

function targetOptions(state: DesignerState, self: string): TargetOption[] {
  const out: TargetOption[] = []
  // Declared sections (lib/forms/sections.ts); a heading still names the rows under it (older forms).
  for (const s of state.layout.sections ?? []) out.push({ target: `section:${s.key}`, label: `Section: ${s.title || s.key}`, kind: 'section' })
  for (const f of state.fields) {
    if (f.key === self) continue
    if (f.type === 'heading') out.push({ target: `section:${f.key}`, label: `Heading section: ${f.label || f.key}`, kind: 'section' })
    if (f.type !== 'divider') out.push({ target: `field:${f.key}`, label: `${f.type === 'heading' ? 'Heading' : f.type === 'button' ? 'Button' : 'Field'}: ${f.label || f.key}`, kind: 'field' })
    if (!DISPLAY_FIELD_TYPES.has(f.type)) out.push({ target: `row:${f.key}`, label: `Row of ${f.label || f.key}`, kind: 'row' })
  }
  if (isPaged(state.layout)) {
    const noun = state.layout.mode === 'tabs' ? 'Tab' : 'Step'
    for (const p of state.layout.pages) out.push({ target: `page:${p.id}`, label: `${noun}: ${p.title}`, kind: 'page' })
  }
  return out
}

export function ActionEditor({ action, index, count, state, field, onChange, onMove, onRemove, onToggleStartHidden, onAddFlag, extraPlaceholders = [], label: labelOverride, renderBranch }: {
  action: FieldButtonAction
  index: number
  count: number
  state: DesignerState
  field: DesignerField
  onChange: (next: FieldButtonAction, tag?: string) => void
  onMove: (delta: number) => void
  onRemove: () => void
  onToggleStartHidden: (target: string, hidden: boolean) => void
  onAddFlag: (key: string) => void
  /** More placeholders ({{event.row.name}}, {{user.email}} — form rules). */
  extraPlaceholders?: Array<{ name: string; group: string; label?: string }>
  /** The action's name in the header (rules use their catalog's wording). */
  label?: string
  /** Ask a question: draw a response's action list (default: a Button's own steps). */
  renderBranch?: (actions: FieldButtonAction[], onChange: (next: FieldButtonAction[], tag?: string) => void, response: string) => React.ReactNode
}) {
  // A form rule (field key '') may also set read-only fields (the server bounds what they may hold).
  const ruleMode = field.key === ''
  const valueFields = state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type) && (!f.read_only || ruleMode)).map((f) => (f.read_only ? { ...f, label: `${f.label || f.key} (read-only)` } : f))
  const flags = (state.layout.state?.flags ?? []).map((f) => f.key)
  const startHidden = new Set(state.layout.state?.hidden ?? [])
  const pages = isPaged(state.layout) ? state.layout.pages : []
  const label = labelOverride ?? FIELD_BUTTON_ACTION_LABELS[action.type]
  const placeholders = [...valueFields.map((f) => ({ name: f.key, group: 'This form', label: f.label || f.key })), ...extraPlaceholders, ...contextVariableOptions(state.layout).filter((o) => !extraPlaceholders.some((e) => e.name === o.name))]
  return (
    <div className="space-y-1.5 rounded border p-2 border-border" data-field-button-action={action.type}>
      <div className="flex items-center gap-1">
        <p className="flex-1 text-2xs font-semibold">{index + 1}. {label}</p>
        <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={index === 0} aria-label={`Move ${label} earlier`} onClick={() => onMove(-1)}><ArrowUp size={11} /></button>
        <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={index === count - 1} aria-label={`Move ${label} later`} onClick={() => onMove(1)}><ArrowDown size={11} /></button>
        <button type="button" className="rounded p-0.5" aria-label={`Remove ${label}`} onClick={onRemove}><X size={11} /></button>
      </div>
      {action.type === 'show_hide' && (() => {
        const options = targetOptions(state, field.key)
        const chosen = action.targets ?? []
        return (
          <>
            <Segmented label="Show or hide" value={action.mode === 'show' || action.mode === 'hide' ? action.mode : 'toggle'} options={[['toggle', 'Toggle'], ['show', 'Show'], ['hide', 'Hide']]} onChange={(mode) => onChange({ ...action, mode })} />
            <AutocompleteSelect value="" placeholder="+ Add a field, section, row or step / tab…"
              options={options.filter((o) => !chosen.includes(o.target)).map((o) => ({ value: o.target, label: o.label, hint: FORM_TARGET_LABELS[o.kind] }))}
              onChange={(v) => { if (v) onChange({ ...action, targets: [...chosen, v] }) }} />
            <ul className="space-y-1">
              {chosen.map((target) => {
                const t = parseTarget(target)
                const option = options.find((o) => o.target === target)
                return (
                  <li key={target} className="flex items-center gap-1 text-2xs" data-target={target}>
                    <span className="min-w-0 flex-1 truncate">{option?.label ?? `${t?.kind}: ${t?.id} (missing)`}</span>
                    <label className="flex shrink-0 items-center gap-1 text-2xs" title="Hidden when the form opens, until a button shows it">
                      <input className="accent-primary" type="checkbox" checked={startHidden.has(target)} onChange={(e) => onToggleStartHidden(target, e.target.checked)} />
                      Starts hidden
                    </label>
                    <button type="button" className="rounded p-0.5" aria-label={`Remove ${option?.label ?? target}`} onClick={() => onChange({ ...action, targets: chosen.filter((x) => x !== target) })}><X size={10} /></button>
                  </li>
                )
              })}
            </ul>
            <Hint>A section is a heading and the rows under it, up to the next heading or divider. Hidden elements are not required and skip validation. A button hide wins over a rule; Show only undoes a hide.</Hint>
          </>
        )
      })()}
      {action.type === 'set_state' && (
        <>
          <div className="grid grid-cols-[1fr_auto] gap-1">
            <AutocompleteSelect value={action.flag ?? ''} placeholder="Choose a flag…" options={flags.map((f) => ({ value: f, label: `state.${f}` }))} onChange={(v) => onChange({ ...action, flag: v || undefined })} />
            <button type="button" className="flex items-center gap-1 rounded border px-2 text-2xs border-border text-primary-text"
              onClick={() => {
                const base = flagKey(field.label) || 'flag'
                let key = base
                for (let n = 2; flags.includes(key); n++) key = `${base}_${n}`
                onAddFlag(key)
                onChange({ ...action, flag: key })
              }}><Plus size={10} /> New flag</button>
          </div>
          <Segmented label="Set to" value={action.state_value ?? 'toggle'} options={[['toggle', 'Toggle'], ['true', 'On'], ['false', 'Off']]} onChange={(state_value) => onChange({ ...action, state_value })} />
          <Hint>Rules read it as <code>state.{action.flag || '<flag>'}</code> (Visible when → equals true).</Hint>
        </>
      )}
      {action.type === 'go_to_page' && (
        pages.length
          ? <AutocompleteSelect value={action.page ?? ''} placeholder="Choose…" options={pages.map((p) => ({ value: p.id, label: p.title }))} onChange={(v) => onChange({ ...action, page: v || undefined })} />
          : <Hint>Needs a form with steps or tabs.</Hint>
      )}
      {(action.type === 'next_page' || action.type === 'previous_page') && <Hint>{action.type === 'next_page' ? 'Checks the step first, like the wizard’s Next; stops here when it has errors.' : 'Goes to the previous step.'}</Hint>}
      {action.type === 'set_values' && (
        <div className="space-y-1">
          {Object.entries(action.assign ?? {}).map(([key, template]) => (
            <div key={key} className="space-y-0.5">
              <div className="flex items-center gap-1">
                <p className="flex-1 font-mono text-2xs">{valueFields.find((f) => f.key === key)?.label ?? key}</p>
                <button type="button" className="rounded p-0.5" aria-label={`Stop setting ${key}`} onClick={() => { const next = { ...(action.assign ?? {}) }; delete next[key]; onChange({ ...action, assign: next }) }}><X size={10} /></button>
              </div>
              <VariableInput value={template} extraVariables={placeholders} placeholder="A value, or {{other_field}}"
                onChange={(v) => onChange({ ...action, assign: { ...(action.assign ?? {}), [key]: v } }, `assign-${key}`)} />
            </div>
          ))}
          <AutocompleteSelect value="" placeholder="+ Set a field…" options={valueFields.filter((f) => !(key(f) in (action.assign ?? {}))).map((f) => ({ value: f.key, label: f.label || f.key }))}
            onChange={(v) => { if (v) onChange({ ...action, assign: { ...(action.assign ?? {}), [v]: '' } }) }} />
        </div>
      )}
      {action.type === 'clear_values' && (
        <div className="space-y-1">
          {valueFields.map((f) => (
            <label key={f.key} className="flex items-center gap-1.5 text-2xs">
              <input className="accent-primary" type="checkbox" checked={(action.fields ?? []).includes(f.key)}
                onChange={(e) => onChange({ ...action, fields: e.target.checked ? [...(action.fields ?? []), f.key] : (action.fields ?? []).filter((k) => k !== f.key) })} />
              {f.label || f.key}
            </label>
          ))}
        </div>
      )}
      {action.type === 'validate' && (
        <>
          <Segmented label="Validate" value={action.scope ?? 'form'} options={[['form', 'Whole form'], ['page', 'This step / tab']]} onChange={(scope) => onChange({ ...action, scope })} />
          <Hint>Shows the errors and stops here when something needs attention.</Hint>
        </>
      )}
      {action.type === 'submit' && (
        <>
          <AutocompleteSelect value={action.button ?? ''} placeholder="The first Submit / outcome button" clearable
            options={state.buttons.filter(isSubmittingButton).map((b) => ({ value: b.id, label: b.label, hint: b.kind === 'outcome' ? `outcome: ${b.outcome}` : 'submit' }))}
            onChange={(v) => onChange({ ...action, button: v || undefined })} />
          <Hint>Presses that button (Buttons &amp; header): it validates, submits and runs its behaviours — message, success screen, start workflow, redirect, close. Works in application mode too.</Hint>
        </>
      )}
      {action.type === 'save_draft' && <Hint>Presses the form’s Save draft button (task forms with one).</Hint>}
      {action.type === 'print' && <Hint>Opens the browser’s print dialog.</Hint>}
      {action.type === 'open_link' && (
        <>
          <input aria-label="Link address" className={inputClass} value={action.url ?? ''} placeholder="/tasks or an allowed https:// address" onChange={(e) => onChange({ ...action, url: e.target.value }, 'link-url')} />
          <label className="flex items-center gap-1.5 text-2xs">
            <input className="accent-primary" type="checkbox" checked={action.new_tab === true} onChange={(e) => onChange({ ...action, new_tab: e.target.checked || undefined })} />
            Open in a new tab
          </label>
          <Hint>App pages (/…) or addresses on the allow list, like redirects.</Hint>
        </>
      )}
      {action.type === 'apply_table_changes' && (
        <TableChangesEditor config={action.table_changes} fields={state.fields} testId="button-table-changes"
          onChange={(table_changes, tag) => onChange({ ...action, table_changes }, tag)} />
      )}
      {(action.type === 'apply_table_changes' || action.type === 'call_reference' || action.type === 'start_workflow') && (
        <AnonymousStepToggle checked={action.allow_anonymous === true} onChange={(v) => onChange({ ...action, allow_anonymous: v || undefined })} />
      )}
      {action.type === 'message' && <MessageActionEditor action={action} onChange={onChange} placeholders={placeholders} />}
      {action.type === 'prompt' && (
        <PromptActionEditor action={action} onChange={onChange} placeholders={placeholders}
          renderBranch={renderBranch ?? ((actions, setBranch) => (
            <BranchActions actions={actions} onChange={setBranch} create={(t) => newAction(t as FieldButtonActionType)}
              options={[{ items: FIELD_BUTTON_ACTION_TYPES.filter((t) => t !== 'prompt' && (isPaged(state.layout) || !['go_to_page', 'next_page', 'previous_page'].includes(t))).map((t) => ({ value: t, label: FIELD_BUTTON_ACTION_LABELS[t] })) }]}
              renderAction={(a, i, common) => (
                <ActionEditor key={i} {...common} action={a} state={state} field={field} onToggleStartHidden={onToggleStartHidden} onAddFlag={onAddFlag} extraPlaceholders={extraPlaceholders} />
              )} />
          ))} />
      )}
    </div>
  )
}

const key = (f: TaskFieldDef) => f.key

export { targetOptions }

export function newAction(type: FieldButtonActionType): FieldButtonAction {
  switch (type) {
    case 'show_hide': return { type, mode: 'toggle', targets: [] }
    case 'set_state': return { type, state_value: 'toggle' }
    case 'set_values': return { type, assign: {} }
    case 'clear_values': return { type, fields: [] }
    case 'validate': return { type, scope: 'form' }
    // New messages are banners (a message saved before banners keeps its original inline look).
    case 'message': return { type, text: 'Done.', style: 'banner' }
    case 'prompt': return { type, text: 'Are you sure?', prompt: { id: `question_${Math.random().toString(36).slice(2, 6)}`, display: 'banner', preset: 'yes_no', buttons: presetButtons('yes_no') as never } }
    case 'apply_table_changes': return { type, table_changes: { field: '', target: 'table', operation: 'auto' } }
    case 'enable_disable': return { type, mode: 'disable', targets: [] }
    case 'read_only': return { type, mode: 'read_only', targets: [] }
    case 'field_error': return { type, text: 'Check this value.' }
    case 'block_submit': return { type, text: 'The form cannot be submitted yet.' }
    case 'copy_values': return { type, assign: {} }
    case 'load_part': return { type, targets: [] }
    default: return { type }
  }
}

export function ButtonProperties({ state, field, onPatch, onChangeState }: {
  state: DesignerState
  field: DesignerField
  onPatch: (patch: Partial<TaskFieldDef>, tag?: string) => void
  onChangeState: (next: DesignerState) => void
}) {
  const config: FieldButtonConfig = field.button ?? { style: 'secondary', actions: [] }
  const set = (patch: Partial<FieldButtonConfig>, tag?: string) => onPatch({ button: { ...config, ...patch } }, tag ? `${tag}-${field._id}` : undefined)
  const setActions = (actions: FieldButtonAction[], tag?: string) => set({ actions }, tag)
  const otherFields = state.fields.filter((f) => f._id !== field._id && !DISPLAY_FIELD_TYPES.has(f.type))
  const flags = (state.layout.state?.flags ?? []).map((f) => f.key)
  const id = (n: string) => `bp-${field._id}-${n}`
  const paged = isPaged(state.layout)

  /** Both the button's config and the layout change (one undo step). */
  const withLayout = (layoutPatch: (layout: DesignerState['layout']) => DesignerState['layout'], actions?: FieldButtonAction[]) => {
    const layout = layoutPatch(state.layout)
    const fields = actions ? state.fields.map((f) => (f._id === field._id ? { ...f, button: { ...config, actions } } : f)) : state.fields
    onChangeState({ ...state, layout, fields })
  }

  return (
    <div className="space-y-3" data-testid="button-properties">
      <p className="text-2xs text-fg-muted">{describeFieldButton(config)}</p>
      <Section title="Look">
        <div>
          <Label>Style</Label>
          <Segmented label="Button style" value={config.style} options={[['primary', 'Primary'], ['secondary', 'Secondary'], ['outline', 'Outline'], ['link', 'Link'], ['danger', 'Danger']]} onChange={(style) => set({ style })} />
        </div>
        <div className="grid grid-cols-2 gap-1">
          <div>
            <Label>Size</Label>
            <Segmented label="Button size" value={config.size ?? 'md'} options={[['sm', 'S'], ['md', 'M'], ['lg', 'L']]} onChange={(size) => set({ size: size === 'md' ? undefined : size })} />
          </div>
          <div>
            <Label>Alignment</Label>
            <Segmented label="Button alignment" value={config.align ?? 'left'} options={[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]} onChange={(align) => set({ align: align === 'left' ? undefined : align })} />
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-end gap-1">
          <div>
            <Label>Icon</Label>
            <AutocompleteSelect value={config.icon ?? ''} placeholder="No icon" clearable
              options={FIELD_BUTTON_ICONS.map((i) => ({ value: i, label: i }))}
              onChange={(v) => set({ icon: (v || undefined) as FieldButtonConfig['icon'], ...(v ? {} : { icon_after: undefined }) })} />
          </div>
          <span className="flex h-8 w-8 items-center justify-center rounded border border-border" aria-hidden><FieldButtonIconView icon={config.icon} /></span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs">
          <label className="flex items-center gap-1.5"><input className="accent-primary" type="checkbox" checked={config.full_width === true} onChange={(e) => set({ full_width: e.target.checked || undefined })} /> Full width</label>
          {config.icon && <label className="flex items-center gap-1.5"><input className="accent-primary" type="checkbox" checked={config.icon_after === true} onChange={(e) => set({ icon_after: e.target.checked || undefined })} /> Icon after the label</label>}
        </div>
        <div>
          <Label htmlFor={id('tooltip')}>Tooltip</Label>
          <input id={id('tooltip')} className={inputClass} value={config.tooltip ?? ''} maxLength={FIELD_BUTTON_LIMITS.tooltip} placeholder="Optional (also read by screen readers)" onChange={(e) => set({ tooltip: e.target.value || undefined }, 'tooltip')} />
        </div>
        <div>
          <Label htmlFor={id('confirm')}>Ask first</Label>
          <input id={id('confirm')} className={inputClass} value={config.confirm ?? ''} maxLength={FIELD_BUTTON_LIMITS.text} placeholder="e.g. Clear the address fields?" onChange={(e) => set({ confirm: e.target.value || undefined }, 'confirm')} />
        </div>
      </Section>

      <Section title="On click">
        {/* A Button's steps read the form's values and controls, not an event (lib/forms/variable-catalog.ts). */}
        <DesignerVariableScope state={state} context={{ kind: 'button' }}>
        {config.actions.map((action, i) => (
          <ActionEditor key={i} action={action} index={i} count={config.actions.length} state={state} field={field}
            onChange={(next, tag) => setActions(config.actions.map((a, j) => (j === i ? next : a)), tag ? `${tag}-${i}` : undefined)}
            onMove={(delta) => { const next = [...config.actions]; const [a] = next.splice(i, 1); next.splice(Math.max(0, Math.min(next.length, i + delta)), 0, a); setActions(next) }}
            onRemove={() => setActions(config.actions.filter((_, j) => j !== i))}
            onToggleStartHidden={(target, hidden) => withLayout((layout) => {
              const current = new Set(layout.state?.hidden ?? [])
              if (hidden) current.add(target); else current.delete(target)
              const stateConfig = { ...(layout.state ?? {}) }
              if (current.size) stateConfig.hidden = [...current]; else delete stateConfig.hidden
              const next = { ...layout }
              if (Object.keys(stateConfig).length) next.state = stateConfig; else delete next.state
              return next
            })}
            onAddFlag={(flag) => withLayout(
              (layout) => ({ ...layout, state: { ...(layout.state ?? {}), flags: [...(layout.state?.flags ?? []), { key: flag }] } }),
              config.actions.map((a, j) => (j === i ? { ...a, flag } : a)),
            )}
          />
        ))}
        </DesignerVariableScope>
        {config.actions.length < FIELD_BUTTON_LIMITS.actions && (
          <AutocompleteSelect value="" placeholder="+ Add a step…"
            options={FIELD_BUTTON_ACTION_TYPES.filter((t) => paged || !['go_to_page', 'next_page', 'previous_page'].includes(t)).map((t) => ({ value: t, label: FIELD_BUTTON_ACTION_LABELS[t] }))}
            onChange={(v) => { if (v) setActions([...config.actions, newAction(v as FieldButtonActionType)]) }} />
        )}
        <Hint>Steps run in order. Validate and Next stop on errors; Submit ends the click.</Hint>
      </Section>

      {(otherFields.length > 0 || flags.length > 0) && (
        <Section title="Disabled when">
          <VisibleWhenEditor rule={config.disabled_when} fields={otherFields} flags={flags} emptyLabel="Never"
            onChange={(rule, typing) => set({ disabled_when: rule }, typing ? 'dw' : undefined)} />
        </Section>
      )}
      {!flags.length && (
        <p className="flex items-center gap-1 text-2xs text-fg-muted">
          <Plus size={10} aria-hidden /> Tip: a state flag (Set a state flag → New flag) lets rules show fields and steps declaratively.
        </p>
      )}
    </div>
  )
}
