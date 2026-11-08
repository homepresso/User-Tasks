'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { UserCheck, UserPlus, UserX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Textarea } from '@/components/ui/textarea'
import { InlineNotice } from '@/components/ui/inline-notice'
import { serverQuery } from '@/lib/server-read'
import { assignTaskTo, bulkAssignTasks, takeTaskOwnership } from '@/app/actions/task-ownership'

/*
 * Take ownership / Assign to… (lib/services/task-ownership.ts): the task
 * page's Unassigned banner and "Reassign…" for managers and admins, the
 * process view's Unassigned chip and the queue page's Active tasks tab.
 * The server re-checks every action (lib/task-authz.ts decideTaskAssignment).
 */

export function useAssignTargets(enabled = true) {
  return useQuery({
    queryKey: ['task-assign-targets'],
    queryFn: () => serverQuery('tasks.assignTargets'),
    staleTime: 60_000,
    enabled,
  })
}

/** After a change: every list, the task page and the process view read again. */
function useRefreshAfterAssign() {
  const queryClient = useQueryClient()
  const router = useRouter()
  return () => {
    void queryClient.invalidateQueries()
    router.refresh()
  }
}

export function TakeOwnershipButton({ taskId, size = 'sm', variant = 'primary', label = 'Take ownership', onDone, className }: {
  taskId: string
  size?: 'sm' | 'md'
  variant?: 'primary' | 'secondary' | 'ghost'
  label?: string
  onDone?: () => void
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useRefreshAfterAssign()
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        size={size} variant={variant} leadingIcon={<UserCheck />} loading={busy} className={className}
        data-take-ownership={taskId}
        onClick={async (e) => {
          e.stopPropagation()
          setBusy(true); setError(null)
          const result = await takeTaskOwnership(taskId)
          setBusy(false)
          if (!result.ok) { setError(result.error); return }
          refresh(); onDone?.()
        }}
      >{label}</Button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  )
}

/**
 * Pick a person or a team, give a reason, reassign. `taskIds` with more
 * than one id is the admin's bulk reassign (to a person only).
 */
export function AssignTaskDialog({ taskIds, open, onOpenChange, title, description, currentAssignee, onDone }: {
  taskIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  /** "Priya Nair", "Finance team", "Unassigned" (shown as From). */
  currentAssignee?: string | null
  onDone?: (message: string) => void
}) {
  const bulk = taskIds.length > 1
  const { data: targets } = useAssignTargets(open)
  const [kind, setKind] = useState<'person' | 'team'>('person')
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useRefreshAfterAssign()

  const reset = () => { setTarget(''); setReason(''); setError(null); setKind('person') }
  const options = kind === 'person'
    ? (targets?.users ?? []).map((u) => ({ value: u.id, label: u.name, hint: u.email && u.email !== u.name ? u.email : undefined }))
    : (targets?.teams ?? []).map((t) => ({ value: t.id, label: t.name }))
  const targetName = (kind === 'person' ? targets?.users.find((u) => u.id === target)?.name : targets?.teams.find((t) => t.id === target)?.name) ?? null

  async function submit() {
    if (!target) { setError(kind === 'person' ? 'Choose a person' : 'Choose a team'); return }
    setBusy(true); setError(null)
    if (bulk) {
      const result = await bulkAssignTasks(taskIds, target, reason || null)
      setBusy(false)
      if (!result.ok) { setError(result.error); return }
      const { assigned, failed } = result.data
      refresh()
      if (failed.length && !assigned.length) { setError(failed[0].error); return }
      onDone?.(`${assigned.length} task${assigned.length === 1 ? '' : 's'} reassigned to ${targetName ?? 'them'}${failed.length ? ` — ${failed.length} could not be (${failed[0].error})` : ''}.`)
    } else {
      const result = await assignTaskTo(taskIds[0], kind === 'person' ? { targetUserId: target, reason } : { targetTeamId: target, reason })
      setBusy(false)
      if (!result.ok) { setError(result.error); return }
      refresh()
      onDone?.(`Task assigned to ${targetName ?? (kind === 'person' ? 'them' : 'the team')}.`)
    }
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) { onOpenChange(next); if (!next) reset() } }}>
      <DialogContent
        size="md"
        title={title ?? (bulk ? `Reassign ${taskIds.length} tasks` : 'Assign task')}
        description={description ?? (bulk ? 'Every selected task goes to one person. Each change is checked, audited and recorded in the task\'s history, and the person is notified.' : 'The new assignee is notified; the change is audited and shown in the task history and the process view.')}
        data-assign-task-dialog=""
      >
        <DialogBody className="space-y-3">
          {currentAssignee && !bulk && <p className="text-ui text-fg-muted">Currently: <span className="font-medium text-fg">{currentAssignee}</span></p>}
          {!bulk && (
            <SegmentedControl
              aria-label="Assign to"
              size="sm"
              value={kind}
              onValueChange={(v) => { setKind(v); setTarget('') }}
              options={[{ value: 'person', text: 'A person' }, { value: 'team', text: 'A team' }]}
            />
          )}
          <Field label={kind === 'person' ? 'Person' : 'Team'}>
            <AutocompleteSelect
              value={target}
              placeholder={kind === 'person' ? 'Select a person' : 'Select a team'}
              size="md"
              options={options}
              onChange={setTarget}
            />
          </Field>
          <Field label="Reason" optional>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={2000} placeholder="Why are you reassigning this?" data-assign-reason="" />
          </Field>
          {error && <InlineNotice tone="danger">{error}</InlineNotice>}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!target} data-assign-submit="">
            {bulk ? `Reassign ${taskIds.length} tasks` : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The task page's notice on a task nobody is on (admins / workflow managers can take or assign it). */
export function UnassignedTaskBanner({ taskId, canTakeOwnership, canReassign }: { taskId: string; canTakeOwnership: boolean; canReassign: boolean }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  if (message) return <InlineNotice tone="success" className="mb-4">{message}</InlineNotice>
  const canManage = canTakeOwnership || canReassign
  return (
    <div data-unassigned-banner={canManage ? 'manage' : 'read'} className="mb-4 flex flex-wrap items-start gap-3 rounded-lg border border-[color-mix(in_srgb,var(--status-warning)_35%,var(--ds-border))] bg-warning-wash px-4 py-3 text-sm text-fg">
      <UserX size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Nobody is assigned to this task</p>
        <p className="mt-0.5 text-xs text-fg-muted">
          {canManage
            ? 'It is waiting in the queue with no assignee, so nobody is working on it. Take ownership to work on it yourself (acting on it also takes ownership), or assign it to someone. The change is audited and shown in the task history.'
            : 'It is waiting with no assignee. An admin or a manager of this workflow can take ownership or assign it.'}
        </p>
      </div>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          {canTakeOwnership && <TakeOwnershipButton taskId={taskId} onDone={() => setMessage('You now own this task.')} />}
          {canReassign && <Button size="sm" variant="secondary" leadingIcon={<UserPlus />} onClick={() => setOpen(true)} data-assign-open="">Assign to…</Button>}
        </div>
      )}
      <AssignTaskDialog taskIds={[taskId]} open={open} onOpenChange={setOpen} currentAssignee="Unassigned" onDone={setMessage} />
    </div>
  )
}
