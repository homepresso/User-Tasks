'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { ShieldAlert, UserCheck, Lock } from 'lucide-react'

/**
 * Acting on a workflow task you are not assigned to (lib/task-authz.ts):
 * a manager — anyone in the assignee's manager chain —, a manager of the
 * workflow (explicit Edit grant on it) or a break-glass tasks.complete_any
 * holder acts ON BEHALF of the assignee, with a note.
 * Everyone else sees the task read-only. The server re-checks every action.
 */

export type TaskActMode = 'assignee' | 'on_behalf' | 'break_glass' | 'none'

export interface OnBehalfState {
  /** The task's outcome / form / save controls are usable by this user. */
  canAct: boolean
  /** Actions are sent with on_behalf + note. */
  onBehalf: boolean
  note: string
  /** onBehalf and no note yet: actions are blocked. */
  needsNote: boolean
  options: { onBehalf?: boolean; onBehalfNote?: string | null }
}

const DEFAULT: OnBehalfState = { canAct: true, onBehalf: false, note: '', needsNote: false, options: {} }
const Ctx = createContext<OnBehalfState>(DEFAULT)

export function useOnBehalf(): OnBehalfState {
  return useContext(Ctx)
}

export function OnBehalfProvider({ mode, workflowTask, children, note, viewer = false }: { mode: TaskActMode | null; workflowTask: boolean; note: string; children: ReactNode; /** Here only through an invite (read only): nothing to act on, any task. */ viewer?: boolean }) {
  const value = useMemo<OnBehalfState>(() => {
    // Standard tasks keep their rules; unknown access (still loading) acts as before.
    if (viewer) return { canAct: false, onBehalf: false, note: '', needsNote: false, options: {} }
    if (!workflowTask || mode === null || mode === 'assignee') return DEFAULT
    if (mode === 'none') return { canAct: false, onBehalf: false, note: '', needsNote: false, options: {} }
    const trimmed = note.trim()
    return { canAct: true, onBehalf: true, note: trimmed, needsNote: !trimmed, options: { onBehalf: true, onBehalfNote: trimmed || null } }
  }, [mode, workflowTask, note, viewer])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** The banner above a task the user is not assigned to. */
export function OnBehalfBanner({ mode, basis = null, assigneeName, note, onNoteChange }: { mode: TaskActMode; basis?: 'manager' | 'workflow_manager' | 'break_glass' | null; assigneeName: string | null; note: string; onNoteChange: (note: string) => void }) {
  const [touched, setTouched] = useState(false)
  if (mode === 'assignee') return null
  const who = assigneeName || 'the assignee'
  if (mode === 'none') {
    return (
      <div data-on-behalf="none" className="mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm border-border bg-subtle text-fg">
        <Lock size={16} className="mt-0.5 shrink-0 text-fg-muted" />
        <p>Only {who} can action this workflow task. You can view it, but its outcome buttons and form are read-only for you.</p>
      </div>
    )
  }
  const breakGlass = mode === 'break_glass'
  return (
    <div data-on-behalf={mode} data-on-behalf-basis={basis ?? undefined} className={`mb-4 rounded-lg border px-4 py-3 text-sm text-fg ${breakGlass
      ? 'bg-danger-wash border-[color-mix(in_srgb,var(--theme-danger)_30%,var(--ds-border))]'
      : 'bg-info-wash border-[color-mix(in_srgb,var(--status-info)_30%,var(--ds-border))]'}`}>
      <div className="flex items-start gap-2">
        {breakGlass ? <ShieldAlert size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden /> : <UserCheck size={16} className="mt-0.5 shrink-0 text-info" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{breakGlass ? `Break-glass: acting on behalf of ${who}` : `Acting on behalf of ${who}`}</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {breakGlass
              ? 'You are not in their manager chain. Your tasks.complete_any permission allows this; it is recorded as break-glass in the task history and audit log.'
              : basis === 'workflow_manager'
                ? `This task is assigned to ${who}. You manage this workflow, so you can act for them: anything you submit is recorded as done by you on their behalf (as a manager of the workflow), and ${who} is notified.`
                : `This task is assigned to ${who}, who reports to you. Anything you submit is recorded as done by you on their behalf, and ${who} is notified.`}
          </p>
          <label className="mt-2 block text-xs font-medium" htmlFor="on-behalf-note">Reason (required)</label>
          <textarea
            id="on-behalf-note"
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            onBlur={() => setTouched(true)}
            rows={2}
            maxLength={2000}
            placeholder={`Why are you acting for ${who}?`}
            className="mt-1 w-full rounded-md border border-input-border bg-input px-3 py-2 text-sm text-fg"
          />
          {touched && !note.trim() && <p className="mt-1 text-xs text-danger">Add a reason before acting on their behalf.</p>}
        </div>
      </div>
    </div>
  )
}
