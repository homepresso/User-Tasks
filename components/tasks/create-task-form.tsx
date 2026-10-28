'use client'

import { useState, useRef } from 'react'
import { createTask } from '@/app/actions/tasks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, X, GripVertical } from 'lucide-react'
import { OUTCOME_PRESETS } from '@/components/tasks/task-outcome-dialog'
import { MultiAssigneePicker } from '@/components/tasks/multi-assignee-picker'
import { useTenantUsers } from '@/hooks/use-tenant-users'
import { getInitials } from '@/lib/utils'
import { TaskDescriptionEditor } from '@/components/tasks/task-description'

interface SubtaskDraft {
  id: string
  title: string
  estimated_effort: number | null
  sequence: number
}

function AssigneePicker() {
  const { data: users, isLoading } = useTenantUsers()

  return (
    <select
      id="assignee_id"
      name="assignee_id"
      defaultValue=""
      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
        focus:border-[color:var(--theme-primary)] focus:outline-none focus:ring-1 focus:ring-[color:var(--theme-primary)]
        dark:border-gray-700 dark:bg-gray-900 dark:text-white"
    >
      <option value="">Unassigned (self)</option>
      {isLoading && <option disabled>Loading...</option>}
      {users?.map((user) => (
        <option key={user.id} value={user.id}>
          {user.display_name || user.email} ({getInitials(user.display_name || user.email)})
        </option>
      ))}
    </select>
  )
}

export function CreateTaskForm() {
  const [subtasks, setSubtasks] = useState<SubtaskDraft[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Sync guard against double submission. State updates are async, so a
  // fast double-click could pass the setIsSubmitting(true) check twice
  // before React re-renders and disables the button. A ref is updated
  // synchronously and blocks the second call reliably.
  const submittingRef = useRef(false)
  const [selectedOutcomePreset, setSelectedOutcomePreset] = useState("complete")
  const [customOutcomes, setCustomOutcomes] = useState<string[]>([""])
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([])
  const [assignmentMode, setAssignmentMode] = useState<'single' | 'individual' | 'collaborative'>('single')
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [allowRedirect, setAllowRedirect] = useState(false)
  const [allowInviteOnRedirect, setAllowInviteOnRedirect] = useState(false)
  const [redirectAssignmentMode, setRedirectAssignmentMode] = useState<'single' | 'many'>('single')
  const [redirectRecipientLimitMode, setRedirectRecipientLimitMode] = useState<'unlimited' | 'capped'>('unlimited')
  const [redirectRecipientLimit, setRedirectRecipientLimit] = useState('2')


  function addSubtask() {
    setSubtasks((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        title: '',
        estimated_effort: null,
        sequence: prev.length + 1,
      },
    ])
  }

  function removeSubtask(id: string) {
    setSubtasks((prev) => prev.filter((s) => s.id !== id))
  }

  function updateSubtask(id: string, field: string, value: any) {
    setSubtasks((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    )
  }

  async function handleSubmit(formData: FormData) {
    // Hard-block re-entrancy: if a previous submit is in flight, drop this one.
    if (submittingRef.current) return
    submittingRef.current = true
    setIsSubmitting(true)
    setError(null)
    try {
      const subtasksPayload = subtasks
        .filter((s) => s.title.trim())
        .map(({ title, estimated_effort, sequence }) => ({
          title,
          estimated_effort,
          sequence,
        }))
      formData.set('subtasks', JSON.stringify(subtasksPayload))
      if (selectedOutcomePreset === 'custom') {
        const validOutcomes = customOutcomes
          .map(o => o.trim().toLowerCase().replace(/\s+/g, '_'))
          .filter(Boolean)
        if (validOutcomes.length > 0) {
          formData.set('available_outcomes', JSON.stringify(validOutcomes))
        }
      } else {
        const preset = OUTCOME_PRESETS.find(p => p.id === selectedOutcomePreset)
        if (preset && preset.id !== 'complete') {
          formData.set('available_outcomes', JSON.stringify(preset.outcomes))
        }
      }
      formData.set('allow_redirect', allowRedirect ? 'true' : 'false')
      formData.set('allow_invite_on_redirect', allowRedirect && allowInviteOnRedirect ? 'true' : 'false')
      formData.set('redirect_assignment_mode', allowRedirect ? redirectAssignmentMode : 'single')
      formData.set(
        'redirect_recipient_limit_mode',
        allowRedirect && redirectAssignmentMode === 'many' ? redirectRecipientLimitMode : 'unlimited'
      )
      formData.set(
        'redirect_recipient_limit',
        allowRedirect && redirectAssignmentMode === 'many' && redirectRecipientLimitMode === 'capped'
          ? String(Math.max(1, Number(redirectRecipientLimit) || 1))
          : ''
      )
      await createTask(formData)
    } catch (e: any) {
      // Next.js redirect() throws NEXT_REDIRECT — don't treat it as an error.
      // Keep the ref locked in the redirect case because we're navigating away.
      if (e?.digest?.includes('NEXT_REDIRECT')) throw e
      setError(e.message ?? 'Failed to create task')
      setIsSubmitting(false)
      // Reset the re-entrancy ref so the user can retry after a real error
      submittingRef.current = false
    }
  }

  return (
    <form action={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Task Details */}
      <div className="space-y-4">
        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Title
          </label>
          <Input
            id="title"
            name="title"
            required
            placeholder="What needs to be done?"
          />
        </div>

        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Description
          </label>
          <TaskDescriptionEditor
            id="description"
            name="description"
            rows={3}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
              placeholder:text-gray-400 focus:border-[color:var(--theme-primary)] focus:outline-none focus:ring-1 focus:ring-[color:var(--theme-primary)]
              dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            placeholder="Add details..."
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor="priority"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Priority
            </label>
            <select
              id="priority"
              name="priority"
              defaultValue="medium"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                focus:border-[color:var(--theme-primary)] focus:outline-none focus:ring-1 focus:ring-[color:var(--theme-primary)]
                dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="none">None</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="due_date"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Due date
            </label>
            <Input id="due_date" name="due_date" type="datetime-local" />
          </div>

          <div>
            <label
              htmlFor="estimated_effort"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Effort (minutes)
            </label>
            <Input
              id="estimated_effort"
              name="estimated_effort"
              type="number"
              min="0"
              placeholder="e.g. 60"
            />
          </div>
        </div>
        <MultiAssigneePicker
          selectedIds={selectedAssignees}
          onChangeIds={setSelectedAssignees}
          assignmentMode={assignmentMode}
          onChangeMode={setAssignmentMode}
          selectedTeamId={selectedTeamId}
          onChangeTeam={setSelectedTeamId}
        />
      </div>

      {/* Task Outcomes */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Completion Options
        </label>
        <select
          value={selectedOutcomePreset}
          onChange={(e) => setSelectedOutcomePreset(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
            focus:border-[color:var(--theme-primary)] focus:outline-none focus:ring-1 focus:ring-[color:var(--theme-primary)]
            dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        >
          {OUTCOME_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label} ({preset.outcomes.join(", ")})
            </option>
          ))}
          <option value="custom">Custom Options...</option>
        </select>
        <p className="text-xs mt-1" style={{ color: "var(--theme-muted-text)" }}>
          Determines what buttons the assignee sees when completing this task
        </p>

        {selectedOutcomePreset === "custom" && (
          <div className="mt-3 space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
              Add custom completion options
            </p>
            {customOutcomes.map((outcome, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={outcome}
                  onChange={(e) => {
                    const next = [...customOutcomes]
                    next[idx] = e.target.value
                    setCustomOutcomes(next)
                  }}
                  placeholder={`Option ${idx + 1} (e.g. "Needs Revision")`}
                  className="flex-1"
                />
                {customOutcomes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setCustomOutcomes(prev => prev.filter((_, i) => i !== idx))}
                    className="text-gray-400 hover:text-red-500"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCustomOutcomes(prev => [...prev, ""])}
            >
              <Plus size={14} className="mr-1" />
              Add option
            </Button>
          </div>
        )}
      </div>
      <div className="space-y-4 rounded-xl border p-4" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>
            Redirect & Invite
          </h3>
          <p className="mt-1 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
            Let assignees reroute an ad hoc task to another person directly from the task form or queue.
          </p>
        </div>

        <label className="flex items-start gap-3 rounded-lg border px-3 py-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
          <input
            type="checkbox"
            checked={allowRedirect}
            onChange={(e) => {
              const enabled = e.target.checked
              setAllowRedirect(enabled)
              if (!enabled) {
                setAllowInviteOnRedirect(false)
                setRedirectAssignmentMode('single')
                setRedirectRecipientLimitMode('unlimited')
                setRedirectRecipientLimit('2')
              }
            }}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[color:var(--theme-card-text)] focus:ring-[color:var(--theme-primary)]"
          />
          <span className="space-y-1">
            <span className="block text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>
              Allow redirect
            </span>
            <span className="block text-xs" style={{ color: 'var(--theme-muted-text)' }}>
              Assignees can pass the task to someone else without needing a workflow-backed activity.
            </span>
          </span>
        </label>

        {allowRedirect && (
          <div className="space-y-4 rounded-lg border p-4" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>
                  Redirect Mode
                </label>
                <select
                  value={redirectAssignmentMode}
                  onChange={(e) => {
                    const nextMode = e.target.value === 'many' ? 'many' : 'single'
                    setRedirectAssignmentMode(nextMode)
                    if (nextMode === 'single') {
                      setRedirectRecipientLimitMode('unlimited')
                    }
                  }}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                    focus:border-[color:var(--theme-primary)] focus:outline-none focus:ring-1 focus:ring-[color:var(--theme-primary)]
                    dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="single">Single person</option>
                  <option value="many">Multiple people</option>
                </select>
                <p className="mt-1 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                  Choose whether the task can be redirected to one user or shared with several users at once.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>
                  Invite Support
                </label>
                <label className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--theme-surface-border)' }}>
                  <input
                    type="checkbox"
                    checked={allowInviteOnRedirect}
                    onChange={(e) => setAllowInviteOnRedirect(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-[color:var(--theme-card-text)] focus:ring-[color:var(--theme-primary)]"
                  />
                  <span className="text-sm" style={{ color: 'var(--theme-card-text)' }}>
                    Allow invite users by email during redirect
                  </span>
                </label>
              </div>
            </div>

            {redirectAssignmentMode === 'many' && (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>
                    Recipient Limit
                  </label>
                  <select
                    value={redirectRecipientLimitMode}
                    onChange={(e) => setRedirectRecipientLimitMode(e.target.value === 'capped' ? 'capped' : 'unlimited')}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                      focus:border-[color:var(--theme-primary)] focus:outline-none focus:ring-1 focus:ring-[color:var(--theme-primary)]
                      dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  >
                    <option value="unlimited">Unlimited recipients</option>
                    <option value="capped">Cap recipients</option>
                  </select>
                  <p className="mt-1 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                    Useful when a task can be invited broadly versus staying within a controlled group size.
                  </p>
                </div>

                {redirectRecipientLimitMode === 'capped' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>
                      Max Users
                    </label>
                    <Input
                      type="number"
                      min="1"
                      value={redirectRecipientLimit}
                      onChange={(e) => setRedirectRecipientLimit(e.target.value)}
                      placeholder="e.g. 3"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Subtask Builder */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            Subtasks
          </h3>
          <Button type="button" variant="outline" size="sm" onClick={addSubtask}>
            <Plus size={14} className="mr-1" />
            Add subtask
          </Button>
        </div>

        {subtasks.length > 0 && (
          <div className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            {subtasks.map((subtask, index) => (
              <div key={subtask.id} className="flex items-center gap-2">
                <GripVertical size={14} className="text-gray-400 shrink-0" />
                <span className="text-xs text-gray-400 w-5">{index + 1}</span>
                <Input
                  value={subtask.title}
                  onChange={(e) =>
                    updateSubtask(subtask.id, 'title', e.target.value)
                  }
                  placeholder="Subtask title"
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={subtask.estimated_effort ?? ''}
                  onChange={(e) =>
                    updateSubtask(
                      subtask.id,
                      'estimated_effort',
                      e.target.value ? parseInt(e.target.value) : null
                    )
                  }
                  placeholder="Min"
                  className="w-20"
                />
                <button
                  type="button"
                  onClick={() => removeSubtask(subtask.id)}
                  className="p-1 text-gray-400 hover:text-red-500"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="flex justify-end gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating...' : 'Create Task'}
        </Button>
      </div>
    </form>
  )
}
