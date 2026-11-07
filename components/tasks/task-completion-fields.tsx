'use client'

import { useId } from 'react'
import { VariableInput } from '@/components/automations/variable-input'
import { Switch } from '@/components/ui/switch'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { cn } from '@/lib/utils'
import {
  completionTextLimit, DEFAULT_TASK_COMPLETION,
  type CompletionSwitchKey, type CompletionTextKey, type TaskCompletedOverride, type TaskCompletionSettings,
} from '@/lib/tasks/completion-screen'

/**
 * The Task completed screen's fields, shared by Settings → Workspace → Task
 * completion (`mode="workspace"`: every value set) and the form designer's
 * override (`mode="override"`: blank inherits `inherited`, switches can be
 * left to the workspace). Template inputs are VariableInputs: they read the
 * nearest variable scope (the caller sets the task_completed one).
 */

const TEXTS: Array<{ key: CompletionTextKey; label: string; hint?: string }> = [
  { key: 'heading', label: 'Heading' },
  { key: 'subheading', label: 'Subheading', hint: 'Leave blank for no subheading.' },
  { key: 'next_assigned', label: 'Next: moved on to someone' },
  { key: 'next_complete', label: 'Next: process complete' },
  { key: 'next_waiting', label: 'Next: waiting on a timer or event' },
]

const BUTTONS: Array<{ show: CompletionSwitchKey; label: CompletionTextKey; name: string; hint: string }> = [
  { show: 'show_next_task', label: 'next_task_label', name: 'Next task', hint: 'Opens the person\'s next open task (Home "My tasks" order). Hidden when there is none.' },
  { show: 'show_back', label: 'back_label', name: 'Back', hint: 'Esc does the same.' },
  { show: 'show_view_flow', label: 'view_flow_label', name: 'Process view', hint: 'Workflow tasks only: the run view the person may see.' },
]

type Value = Partial<TaskCompletionSettings>

export function TaskCompletionFields({ value, onChange, mode, inherited = DEFAULT_TASK_COMPLETION, disabled, dense }: {
  value: Value
  onChange: (next: Value) => void
  mode: 'workspace' | 'override'
  /** Override mode: what blank / unset inherits (the workspace settings). */
  inherited?: TaskCompletionSettings
  disabled?: boolean
  /** The designer's compact styling. */
  dense?: boolean
}) {
  const uid = useId()
  const override = mode === 'override'
  const labelClass = dense ? 'mb-0.5 block text-2xs font-medium text-fg-muted' : 'mb-1.5 block text-ui font-medium text-fg'
  const hintClass = dense ? 'mt-1 text-2xs text-fg-muted' : 'mt-1 text-xs text-fg-muted'
  const inputClass = dense ? 'text-xs' : undefined
  const text = (key: CompletionTextKey) => (value[key] as string | undefined) ?? ''
  const setText = (key: CompletionTextKey, v: string) => {
    const next = { ...value, [key]: v.slice(0, completionTextLimit(key)) }
    if (override && !v.trim()) delete next[key]
    onChange(next)
  }
  const placeholderOf = (key: CompletionTextKey) => {
    const inherit = inherited[key]
    if (override) return inherit ? `Workspace: ${inherit}` : 'Workspace default'
    if (key === 'back_label') return (value.back_target ?? inherited.back_target) === 'home' ? 'Back to Home' : 'Back to my tasks'
    return DEFAULT_TASK_COMPLETION[key] || undefined
  }

  const switchRow = (k: CompletionSwitchKey, label: string) => {
    const set = value[k]
    if (!override) {
      return <Switch checked={set ?? inherited[k]} onCheckedChange={(c) => onChange({ ...value, [k]: c })} label={label} disabled={disabled} size={dense ? 'sm' : 'md'} data-completion-switch={k} />
    }
    // Override: Workspace (inherit) / On / Off.
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={dense ? 'text-2xs text-fg' : 'text-ui text-fg'}>{label}</span>
        <SegmentedControl
          size="sm"
          aria-label={label}
          value={set === undefined ? 'inherit' : set ? 'on' : 'off'}
          onValueChange={(v) => {
            const next = { ...value }
            if (v === 'inherit') delete next[k]
            else next[k] = v === 'on'
            onChange(next)
          }}
          options={[
            { value: 'inherit', text: `Workspace (${inherited[k] ? 'on' : 'off'})` },
            { value: 'on', text: 'On' },
            { value: 'off', text: 'Off' },
          ]}
        />
      </div>
    )
  }

  return (
    <fieldset disabled={disabled} className={cn(dense ? 'space-y-3' : 'space-y-5')} data-task-completion-fields={mode}>
      {switchRow("enabled", "Show the Task completed screen")}
      <div className={dense ? 'space-y-2' : 'space-y-4'}>
        {TEXTS.map(({ key, label, hint }) => (
          <div key={key}>
            <span id={`${uid}-${key}`} className={labelClass}>{label}</span>
            <VariableInput value={text(key)} onChange={(v) => setText(key, v)} placeholder={placeholderOf(key)} ariaLabel={label} className={inputClass} />
            {hint && !override && <p className={hintClass}>{hint}</p>}
          </div>
        ))}
        <p className={hintClass}>Type {'{'} to insert the task title, outcome, next step, who it is with, your name or the process name.</p>
      </div>
      <div className={dense ? 'space-y-2' : 'space-y-4'}>
        <span className={labelClass}>Buttons</span>
        {BUTTONS.map((b) => (
          <div key={b.show} className={cn('space-y-1.5 rounded-md border border-border-subtle', dense ? 'p-2' : 'p-3')}>
            {switchRow(b.show, `Show ${b.name}`)}
            <VariableInput value={text(b.label)} onChange={(v) => setText(b.label, v)} placeholder={placeholderOf(b.label)} ariaLabel={`${b.name} button label`} className={inputClass} />
            <p className={hintClass}>{b.hint}</p>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={dense ? 'text-2xs text-fg' : 'text-ui text-fg'}>Back goes to</span>
          <SegmentedControl
            size="sm"
            aria-label="Back goes to"
            value={value.back_target ?? (override ? 'inherit' : inherited.back_target)}
            onValueChange={(v) => {
              const next = { ...value }
              if (v === 'inherit') delete next.back_target
              else next.back_target = v as 'tasks' | 'home'
              onChange(next)
            }}
            options={[
              ...(override ? [{ value: 'inherit', text: `Workspace (${inherited.back_target === 'home' ? 'Home' : 'My tasks'})` }] : []),
              { value: 'tasks', text: 'My tasks' },
              { value: 'home', text: 'Home' },
            ]}
          />
        </div>
      </div>
    </fieldset>
  )
}

/** Override mode: a heading / subheading per outcome ("Rejected" can read differently from "Approved"). */
export function TaskCompletionOutcomeFields({ outcomes, value, onChange, dense }: {
  outcomes: string[]
  value: TaskCompletedOverride['outcomes']
  onChange: (next: TaskCompletedOverride['outcomes']) => void
  dense?: boolean
}) {
  if (!outcomes.length) return null
  const map = value ?? {}
  const set = (outcome: string, key: 'heading' | 'subheading', v: string) => {
    const entry = { ...(map[outcome] ?? {}) }
    if (v.trim()) entry[key] = v.slice(0, completionTextLimit('heading'))
    else delete entry[key]
    const next = { ...map }
    if (Object.keys(entry).length) next[outcome] = entry
    else delete next[outcome]
    onChange(Object.keys(next).length ? next : undefined)
  }
  const labelClass = dense ? 'mb-0.5 block text-2xs font-medium text-fg-muted' : 'mb-1.5 block text-ui font-medium text-fg'
  return (
    <div className={dense ? 'space-y-2' : 'space-y-3'} data-task-completion-outcomes>
      <span className={labelClass}>Per outcome (optional)</span>
      {outcomes.map((outcome) => (
        <div key={outcome} className={cn('space-y-1.5 rounded-md border border-border-subtle', dense ? 'p-2' : 'p-3')} data-task-completion-outcome={outcome}>
          <span className={dense ? 'text-2xs font-medium text-fg' : 'text-ui font-medium text-fg'}>{outcome}</span>
          <VariableInput value={map[outcome]?.heading ?? ''} onChange={(v) => set(outcome, 'heading', v)} placeholder="Heading (blank: as above)" ariaLabel={`${outcome}: heading`} className={dense ? 'text-xs' : undefined} />
          <VariableInput value={map[outcome]?.subheading ?? ''} onChange={(v) => set(outcome, 'subheading', v)} placeholder="Subheading (blank: as above)" ariaLabel={`${outcome}: subheading`} className={dense ? 'text-xs' : undefined} />
        </div>
      ))}
    </div>
  )
}
