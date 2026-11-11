'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Shield, Trash2, User, Users } from 'lucide-react'
import { serverQuery } from '@/lib/server-read'
import { inviteTaskViewers, removeTaskViewer } from '@/app/actions/task-viewers'
import { useAssignTargets } from '@/components/tasks/assign-task'
import { TASK_FOLLOWS_KEY } from '@/components/tasks/task-follow-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { InlineNotice } from '@/components/ui/inline-notice'
import { SearchableMultiOptionPicker, type SearchableMultiOption } from '@/components/ui/searchable-multi-option-picker'
import { Textarea } from '@/components/ui/textarea'
import { plural } from '@/lib/format/plural'

/**
 * Invite (read only): share a task with people, teams and roles
 * (lib/services/task-viewers.ts). Everyone an invite names can open the task
 * and its subtasks, its comments, attachments, history and process view, and
 * comment — nothing else. Distinct from "Add collaborator…" (quick actions),
 * which puts people ON the task to work on it.
 */

type PrincipalType = 'user' | 'team' | 'role'
type ViewerRow = {
  id: string
  principal_type: PrincipalType
  principal_id: string
  name: string
  member_count: number | null
  include_subtasks: boolean
  note: string | null
  invited_by: { id: string; name: string } | null
  created_at: string
}

export const taskViewersKey = (taskId: string) => ['task-viewers', taskId] as const

/** The task's invites and whether the signed-in person may change them (null: can't see the task). */
export function useTaskViewers(taskId: string, enabled = true) {
  return useQuery({
    queryKey: taskViewersKey(taskId),
    queryFn: () => serverQuery('tasks.viewers', { taskId }),
    staleTime: 30_000,
    enabled,
  })
}

const ICON: Record<PrincipalType, typeof User> = { user: User, team: Users, role: Shield }
const KIND: Record<PrincipalType, string> = { user: 'Person', team: 'Team', role: 'Role' }

function describe(v: ViewerRow) {
  if (v.principal_type === 'user') return null
  return `${KIND[v.principal_type]} · ${plural(v.member_count ?? 0, v.principal_type === 'team' ? 'member' : 'person', v.principal_type === 'team' ? 'members' : 'people')}`
}

/** "Shared with 3" — opens the dialog (managers can change it there; others see the list). */
export function SharedWithChip({ taskId, onOpen }: { taskId: string; onOpen: () => void }) {
  const { data } = useTaskViewers(taskId)
  const count = data?.viewers.length ?? 0
  if (!count) return null
  return (
    <button type="button" onClick={onOpen} data-task-shared-chip={count}
      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-subtle px-2.5 text-xs font-medium text-fg-muted hover:text-fg">
      <Eye className="size-3.5" aria-hidden />
      Shared with {plural(count, 'person or group', 'people / groups')}
    </button>
  )
}

/**
 * The task page / list panel's Invite button, the "Shared with N" chip and
 * the dialog. Shows the button only to people who may invite (can_manage);
 * the chip to everyone who can see the task.
 */
export function TaskInviteControls({ taskId, size = 'sm', showChip = true, label = 'Invite', variant = 'secondary' }: { taskId: string; size?: 'sm' | 'md'; showChip?: boolean; label?: string; variant?: 'secondary' | 'ghost' }) {
  const [open, setOpen] = useState(false)
  const { data } = useTaskViewers(taskId)
  return (
    <>
      {showChip && <SharedWithChip taskId={taskId} onOpen={() => setOpen(true)} />}
      {data?.can_manage && (
        <Button size={size} variant={variant} leadingIcon={<Eye />} onClick={() => setOpen(true)} data-task-invite-open="">
          {label}
        </Button>
      )}
      {open && <InviteViewersDialog taskId={taskId} open={open} onOpenChange={setOpen} />}
    </>
  )
}

export function InviteViewersDialog({ taskId, open, onOpenChange }: { taskId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const { data: list } = useTaskViewers(taskId, open)
  const canManage = list?.can_manage === true
  const { data: targets } = useAssignTargets(open && canManage)
  // Roles of the task's own workspace.
  const tenantId = list?.tenant_id ?? null
  const { data: roles } = useQuery({
    queryKey: ['governance-role-options', tenantId],
    queryFn: () => serverQuery('governance.roleOptions', { tenantId: tenantId! }),
    staleTime: 60_000,
    enabled: open && canManage && Boolean(tenantId),
  })
  const [picked, setPicked] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [includeSubtasks, setIncludeSubtasks] = useState(true)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const invited = useMemo(() => new Set((list?.viewers ?? []).map((v) => `${v.principal_type}:${v.principal_id}`)), [list])
  const options = useMemo<SearchableMultiOption[]>(() => [
    ...(targets?.users ?? []).map((u) => ({ value: `user:${u.id}`, label: u.name, subtitle: u.email && u.email !== u.name ? u.email : undefined, group: 'People', keywords: u.email ? [u.email] : [] })),
    ...(targets?.teams ?? []).map((t) => ({ value: `team:${t.id}`, label: t.name, subtitle: 'Team', group: 'Teams' })),
    ...((roles ?? []) as Array<{ id: string; name: string }>).map((r) => ({ value: `role:${r.id}`, label: r.name, subtitle: 'Everyone with this role', group: 'Roles' })),
  ].filter((o) => !invited.has(o.value)), [targets, roles, invited])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: taskViewersKey(taskId) })
    void queryClient.invalidateQueries({ queryKey: ['task-events', taskId] })
    void queryClient.invalidateQueries({ queryKey: TASK_FOLLOWS_KEY })
  }

  async function invite() {
    if (!picked.length) { setError('Choose people, teams or roles to invite'); return }
    setBusy(true); setError(null); setMessage(null)
    const principals = picked.map((value) => {
      const [type, id] = value.split(':') as [PrincipalType, string]
      return { type, id }
    })
    const result = await inviteTaskViewers(taskId, { principals, note: note.trim() || null, include_subtasks: includeSubtasks })
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    const { added, notified, skipped_group_notifications: skipped } = result.data
    setPicked([]); setNote('')
    refresh()
    setMessage(added.length
      ? `Shared with ${added.map((v) => v.name).join(', ')} (read only).${notified ? ` ${plural(notified, 'person', 'people')} notified.` : ''}${skipped ? ' Large groups aren’t notified — the task is in their tracker.' : ''}`
      : 'Everyone you chose already has access.')
  }

  async function remove(v: ViewerRow) {
    setRemoving(v.id); setError(null); setMessage(null)
    const result = await removeTaskViewer(taskId, v.id)
    setRemoving(null)
    if (!result.ok) { setError(result.error); return }
    refresh()
    setMessage(`Stopped sharing with ${v.name}.`)
  }

  const viewers = (list?.viewers ?? []) as ViewerRow[]
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <DialogContent
        size="md"
        title={canManage ? 'Invite to view' : 'Shared with'}
        description={canManage
          ? 'People, teams and roles you invite can open this task, its comments, attachments, history and process view, and comment. They can’t complete it, fill in the form, add subtasks or reassign it. It shows in their Task tracker.'
          : 'People, teams and roles invited to view this task (read only).'}
        data-task-invite-dialog=""
      >
        <DialogBody className="space-y-4">
          {canManage && (
            <>
              <Field label="People, teams or roles">
                <SearchableMultiOptionPicker
                  options={options}
                  values={picked}
                  onChange={setPicked}
                  placeholder="Search people, teams and roles"
                  searchPlaceholder="Type a name, team or role…"
                  emptyLabel="Nobody else to invite"
                />
              </Field>
              <Field label="Note" optional>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} placeholder="Why are you sharing this? (shown in their notification)" data-task-invite-note="" />
              </Field>
              <Checkbox checked={includeSubtasks} onChange={(e) => setIncludeSubtasks(e.target.checked)} label="Include its subtasks" description="They can open this task’s subtasks too." />
            </>
          )}
          {error && <InlineNotice tone="danger">{error}</InlineNotice>}
          {message && <InlineNotice tone="success">{message}</InlineNotice>}
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">{viewers.length ? `Shared with ${plural(viewers.length, 'person or group', 'people / groups')}` : 'Not shared with anyone yet'}</p>
            {viewers.length > 0 && (
              <ul className="divide-y divide-border-subtle rounded-md border border-border" data-task-viewer-list="">
                {viewers.map((v) => {
                  const Icon = ICON[v.principal_type]
                  return (
                    <li key={v.id} className="flex items-center gap-3 px-3 py-2 text-ui" data-task-viewer={v.principal_type}>
                      <Icon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-fg">{v.name}</p>
                        <p className="truncate text-xs text-fg-muted">
                          {[describe(v), v.invited_by ? `invited by ${v.invited_by.name}` : null, v.include_subtasks ? null : 'not subtasks'].filter(Boolean).join(' · ')}
                        </p>
                        {v.note && <p className="mt-0.5 truncate text-xs text-fg-muted">“{v.note}”</p>}
                      </div>
                      <Badge tone="neutral">Can view</Badge>
                      {canManage && (
                        <IconButton size="sm" label={`Stop sharing with ${v.name}`} icon={<Trash2 />} loading={removing === v.id}
                          disabled={removing !== null} onClick={() => void remove(v)} data-task-viewer-remove={v.id} />
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>{canManage ? 'Close' : 'Done'}</Button>
          {canManage && <Button onClick={() => void invite()} loading={busy} disabled={!picked.length} leadingIcon={<Eye />} data-task-invite-submit="">Invite</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The task page's notice for someone here only through an invite (read only, comments allowed). */
export function ViewerBanner({ invitedByName, via, inherited }: { invitedByName: string | null; via: PrincipalType; inherited: boolean }) {
  const through = via === 'team' ? ' (through your team)' : via === 'role' ? ' (through your role)' : ''
  return (
    <div data-task-viewer-banner={via} className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-info-wash px-4 py-3 text-sm text-fg">
      <Eye size={16} className="mt-0.5 shrink-0 text-info" aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold">You’re invited to view this task (read only){invitedByName ? ` by ${invitedByName}` : ''}{through}</p>
        <p className="mt-0.5 text-xs text-fg-muted">
          {inherited ? 'You were invited to its parent task. ' : ''}You can follow it, read its comments, attachments and history, and add comments. Only the people working on it can complete it, change it or invite others.
        </p>
      </div>
    </div>
  )
}
