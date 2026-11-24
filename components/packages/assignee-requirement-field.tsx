'use client'

/**
 * The assignee requirements of a package install / complete setup (people
 * and teams never travel in a package): a type-to-search picker per step over
 * the people (and, where the step can be assigned to one, the teams) of the
 * workspace the package goes into — the task assignee search
 * (components/tasks/assignee-search.tsx) — with a "Me" shortcut, an earlier
 * install's choice shown prefilled, and "Assign all to…" for every step
 * still empty. Typing or pasting an email and pressing Enter picks that
 * person, or says inline that nobody in the workspace has it.
 *
 * Values follow lib/packages/assignees.ts: a user id, or team:<id>.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, UserRound, Users, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { AssigneeSearch, type AssigneePick } from '@/components/tasks/assignee-search'
import { packageAssigneeMeAction, searchPackageAssigneesAction } from '@/app/actions/packages'
import { assigneeValue, isEmailLike, resolveTypedAssignee, type AssigneeChoice, type AssigneeKind } from '@/lib/packages/assignees'
import type { AssigneeSearchResult } from '@/lib/services/assignee-search'

export type { AssigneeChoice, AssigneeKind }

const kindsFor = (accepts: AssigneeKind[]) => accepts.map((kind) => (kind === 'team' ? 'team' as const : 'person' as const))

export function choiceFromPick(pick: AssigneePick): AssigneeChoice {
  return pick.kind === 'team'
    ? { kind: 'team', id: pick.id, name: pick.name, member_count: pick.member_count }
    : { kind: 'user', id: pick.id, name: pick.name, email: pick.email }
}

async function searchIn(tenantId: string | null | undefined, input: { q: string; kinds: Array<'person' | 'team'>; limit: number }): Promise<AssigneeSearchResult> {
  const result = await searchPackageAssigneesAction({ ...input, tenant_id: tenantId ?? null })
  if (!result.ok) throw new Error(result.error)
  return result.data
}

/** The signed-in user as a choice in the target workspace ("Me"). */
export function useAssigneeMe(tenantId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['package-assignee-me', tenantId ?? null],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const result = await packageAssigneeMeAction(tenantId ?? null)
      return result.ok ? result.data : null
    },
  })
}

/** "User for step “X”" → "Assignee" / "Escalate to" wording for what the step really takes. */
export function assigneeFieldLabel(field: { key: string; label: string }, accepts: AssigneeKind[]): string {
  const step = field.label.replace(/^(User|Team)\s+for\s+/i, '')
  if (step === field.label) return field.label
  if (/escalation_(user|team)_id$/.test(field.key)) return `Escalate ${step} to`
  if (accepts.length > 1) return `Assignee for ${step}`
  return accepts[0] === 'team' ? `Team for ${step}` : `Person for ${step}`
}

function ChoiceChip({ choice, note, onChange, onClear, disabled, testId }: {
  choice: AssigneeChoice
  note?: string
  onChange: () => void
  onClear?: () => void
  disabled?: boolean
  testId?: string
}) {
  return (
    <div className="flex min-h-9 items-center gap-2 rounded-md border border-border bg-subtle px-2 py-1 text-ui" data-assignee-choice={`${choice.kind}:${choice.id}`} data-testid={testId}>
      {choice.kind === 'team'
        ? <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-fg-muted"><Users className="size-3.5" /></span>
        : <Avatar name={choice.name} size="sm" aria-hidden aria-label={undefined} role={undefined} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-fg">{choice.name}{choice.kind === 'team' && <span className="ml-1.5 text-2xs font-normal text-fg-muted">Team</span>}</span>
        {(choice.kind === 'user' && choice.email && choice.email !== choice.name) || note ? (
          <span className="block truncate text-2xs text-fg-muted">{[choice.kind === 'user' && choice.email !== choice.name ? choice.email : null, note].filter(Boolean).join(' · ')}</span>
        ) : null}
      </span>
      {!disabled && (
        <>
          <button type="button" onClick={onChange} className="shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium text-primary-text hover:bg-muted" aria-label={`Change ${choice.name}`}>Change</button>
          {onClear && (
            <button type="button" onClick={onClear} className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-muted hover:text-fg" aria-label={`Remove ${choice.name}`}>
              <X size={13} aria-hidden />
            </button>
          )}
        </>
      )}
    </div>
  )
}

/**
 * One assignee: the chosen person / team as a chip, or the search. `value`
 * is the form value ('' = none chosen here); `kept` the earlier install's
 * choice (shown until something else is picked); `known` names values picked
 * elsewhere in the form ("Assign all", another field).
 */
export function AssigneePicker({
  value, onPick, onClear, accepts, kept, serverError, label, tenantId, me, known, required, placeholder, actionMode, describedBy, testId,
}: {
  value: string
  onPick: (value: string, choice: AssigneeChoice) => void
  onClear?: () => void
  accepts: AssigneeKind[]
  kept?: AssigneeChoice | null
  serverError?: string
  label: string
  tenantId?: string | null
  me?: AssigneeChoice | null
  known?: Record<string, AssigneeChoice>
  required?: boolean
  placeholder?: string
  /** "Assign all": picking runs onPick and the picker stays empty. */
  actionMode?: boolean
  describedBy?: string
  testId?: string
}) {
  const [open, setOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const kinds = kindsFor(accepts)
  const takesPeople = accepts.includes('user')
  const takesTeams = accepts.includes('team')
  const chosen: AssigneeChoice | null = value
    ? known?.[value] ?? (kept && assigneeValue(kept) === value ? kept : null) ?? (me && me.id === value ? me : null)
    : null
  const showKept = !value && kept && !actionMode
  const pick = (choice: AssigneeChoice) => {
    setLocalError(null)
    setOpen(false)
    onPick(assigneeValue(choice), choice)
  }
  const resolveText = async (text: string) => {
    setChecking(true)
    try {
      const found = await searchIn(tenantId, { q: text, kinds: isEmailLike(text) ? ['person'] : kinds, limit: 5 })
      const resolved = resolveTypedAssignee(text, found, accepts)
      if ('choice' in resolved) pick(resolved.choice)
      else setLocalError(resolved.error)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Could not search')
    } finally {
      setChecking(false)
    }
  }
  const error = localError ?? (!chosen ? serverError : undefined) ?? undefined
  const errorId = testId ? `${testId}-error` : undefined
  const search = tenantId ? (input: { q: string; kinds: Array<'person' | 'team'>; limit: number }) => searchIn(tenantId, input) : undefined
  const triggerText = placeholder ?? (takesPeople && takesTeams ? 'Choose a person or team…' : takesTeams ? 'Choose a team…' : 'Choose a person…')
  const meButton = me && takesPeople && !(value && value === me.id) && (
    <Button type="button" size="sm" variant="secondary" onClick={() => pick(me)} data-assignee-me="" aria-label={`Assign ${label} to me (${me.name})`}>
      <UserRound size={14} aria-hidden /> Me
    </Button>
  )

  return (
    <div className="space-y-1.5" data-assignee-picker="" data-testid={testId} data-accepts={accepts.join(',')}>
      {open ? (
        <div className="space-y-1.5">
          <AssigneeSearch
            kinds={kinds}
            label={label}
            autoFocus
            limit={6}
            listClassName="max-h-56"
            placeholder={takesPeople && takesTeams ? 'Search people and teams, or paste an email…' : takesTeams ? 'Search teams…' : 'Search people, or paste an email…'}
            selectedKeys={chosen ? [`${chosen.kind === 'team' ? 'team' : 'person'}:${chosen.id}`] : []}
            onPick={(p) => pick(choiceFromPick(p))}
            onDismiss={() => setOpen(false)}
            onEnterText={(text) => void resolveText(text)}
            search={search}
            scope={tenantId ?? undefined}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-2xs text-fg-muted" aria-live="polite">{checking ? 'Checking…' : 'Enter picks · Esc closes'}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setLocalError(null) }}>Cancel</Button>
          </div>
        </div>
      ) : chosen ? (
        <ChoiceChip choice={chosen} onChange={() => setOpen(true)} onClear={onClear} testId={testId ? `${testId}-chosen` : undefined} />
      ) : showKept ? (
        <ChoiceChip choice={kept!} note="Chosen earlier: kept unless you change it" onChange={() => setOpen(true)} testId={testId ? `${testId}-kept` : undefined} />
      ) : value ? (
        // A typed value the form has no name for (e.g. from the API): show it as is.
        <ChoiceChip choice={{ kind: value.startsWith('team:') ? 'team' : 'user', id: value.replace(/^(team|user):/, ''), name: value }} onChange={() => setOpen(true)} onClear={onClear} />
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="combobox"
            onClick={() => setOpen(true)}
            aria-haspopup="listbox"
            aria-expanded={false}
            aria-label={label}
            aria-describedby={[describedBy, error ? errorId : undefined].filter(Boolean).join(' ') || undefined}
            aria-invalid={error ? true : undefined}
            aria-required={required || undefined}
            className={cn(
              'flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-input px-2.5 text-left text-ui text-fg-subtle transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ds-focus-ring,var(--ds-primary))]',
              error ? 'border-danger' : 'border-input-border',
            )}
            data-assignee-trigger=""
          >
            <Search size={13} aria-hidden className="shrink-0 text-fg-muted" />
            <span className="truncate">{triggerText}</span>
          </button>
          {meButton}
        </div>
      )}
      {error && <p id={errorId} className="text-xs text-danger" role="alert" data-assignee-error="">{error}</p>}
    </div>
  )
}
