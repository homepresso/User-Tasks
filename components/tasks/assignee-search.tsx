'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Search, Users } from 'lucide-react'
import { serverRead } from '@/lib/server-read'
import { cn, getInitials } from '@/lib/utils'
import { plural } from '@/lib/format/plural'
import { TeamOriginBadge } from '@/components/teams/team-origin-badge'
import { TEAM_ORIGIN_LABELS, TEAM_ORIGIN_SHORT_LABELS, type TeamOrigin } from '@/lib/teams/origin'
import type { AssigneeKind, AssigneePerson, AssigneeSearchResult, AssigneeTeam } from '@/lib/services/assignee-search'

/**
 * The assignee type-ahead (Create task, Assign to… / Reassign, the workflow
 * User Task node's team): one search box over people and teams, searched
 * server-side (tasks.assigneeSearch), results grouped "People" / "Teams".
 * Every team shows where it comes from (Internal, Active Directory, Entra
 * ID, SharePoint …) and its member count; the highlighted team shows its
 * first members. A chip row filters teams by origin — only the origins the
 * workspace has. Keyboard: ↑ ↓ move, Home / End, Enter picks, Esc clears.
 *
 * `search` replaces the workspace search (e.g. a package installed into
 * another workspace searches that one); the origin chips and the team member
 * preview read the current workspace, so they are off with it.
 */

export type AssigneePick =
  | { kind: 'person'; id: string; name: string; email: string | null }
  | { kind: 'team'; id: string; name: string; origin: TeamOrigin; origin_label: string; member_count: number }

type Option = { key: string; item: AssigneePerson | AssigneeTeam }

export const assigneeKey = (kind: AssigneeKind, id: string) => `${kind}:${id}`

/**
 * The highlighted option after a key (↑ ↓ wrap around, Home / End), or null
 * when the key does not move it. People come first, then teams: one list.
 */
export function moveActive(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  const current = Math.max(-1, Math.min(index, count - 1))
  if (key === 'ArrowDown') return (current + 1) % count
  if (key === 'ArrowUp') return current <= 0 ? count - 1 : current - 1
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

export function useTeamOrigins(enabled = true) {
  return useQuery({
    queryKey: ['team-origins'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => (await serverRead('tasks.teamOrigins')).data ?? [],
  })
}

/** A team's first members (hover / keyboard highlight). */
function TeamPreview({ teamId, count }: { teamId: string; count: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['team-preview', teamId],
    staleTime: 60_000,
    enabled: count > 0,
    queryFn: async () => (await serverRead('tasks.teamPreview', { teamId, limit: 4 })).data ?? null,
  })
  if (count === 0) return <span className="text-fg-muted">No members yet</span>
  if (isLoading || !data) return <span className="text-fg-muted">Loading members…</span>
  const names = data.members.map((m) => m.name)
  const more = Math.max(0, data.total - names.length)
  return <span className="text-fg-muted">{names.join(', ')}{more ? ` and ${more} more` : ''}</span>
}

export function AssigneeSearch({
  kinds = ['person', 'team'],
  onPick,
  selectedKeys = [],
  placeholder,
  label = 'Search people and teams',
  limit = 8,
  className,
  autoFocus,
  listClassName,
  search,
  scope,
  onDismiss,
  onEnterText,
}: {
  kinds?: AssigneeKind[]
  onPick: (pick: AssigneePick) => void
  /** `person:<id>` / `team:<id>` already chosen (marked, not hidden). */
  selectedKeys?: string[]
  placeholder?: string
  label?: string
  limit?: number
  className?: string
  autoFocus?: boolean
  listClassName?: string
  /** Search somewhere else than the current workspace (no origin chips or member preview then). */
  search?: (input: { q: string; kinds: AssigneeKind[]; limit: number }) => Promise<AssigneeSearchResult>
  /** Cache key of that search (e.g. the workspace id). */
  scope?: string
  /** Esc with nothing typed. */
  onDismiss?: () => void
  /** Enter with nothing to pick (e.g. an email that matches nobody): the text typed. */
  onEnterText?: (text: string) => void
}) {
  const baseId = useId()
  const listId = `${baseId}-list`
  const inputRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [origin, setOrigin] = useState<TeamOrigin | null>(null)
  const [active, setActive] = useState(0)
  const debouncedQ = useDebounced(q.trim(), 150)
  const wantTeams = kinds.includes('team')
  const wantPeople = kinds.includes('person')
  const teamExtras = !search
  const { data: origins = [] } = useTeamOrigins(wantTeams && teamExtras)

  const { data, isFetching, error } = useQuery({
    queryKey: ['assignee-search', debouncedQ, kinds.join(','), origin, limit, ...(search ? ['scoped', scope ?? null] : [])],
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async () => {
      if (search) return search({ q: debouncedQ, kinds, limit })
      const result = await serverRead('tasks.assigneeSearch', { q: debouncedQ, kinds, origin, limit })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  const people = useMemo(() => (origin ? [] : data?.people ?? []), [data, origin])
  const teams = useMemo(() => data?.teams ?? [], [data])
  const options: Option[] = useMemo(() => [
    ...people.map((p) => ({ key: assigneeKey('person', p.id), item: p })),
    ...teams.map((t) => ({ key: assigneeKey('team', t.id), item: t })),
  ], [people, teams])
  const activeIndex = options.length ? Math.min(active, options.length - 1) : -1
  const activeOption = activeIndex >= 0 ? options[activeIndex] : null
  const optionId = (key: string) => `${baseId}-opt-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  const selected = new Set(selectedKeys)

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!activeOption) return
    document.getElementById(optionId(activeOption.key))?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optionId is derived from baseId
  }, [activeOption?.key])

  const pick = (option: Option | null) => {
    if (!option) return
    const item = option.item
    if (item.kind === 'person') onPick({ kind: 'person', id: item.id, name: item.name, email: item.email })
    else onPick({ kind: 'team', id: item.id, name: item.name, origin: item.origin, origin_label: item.origin_label, member_count: item.member_count })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const next = moveActive(e.key, activeIndex, options.length)
    if (next !== null) { e.preventDefault(); setActive(next) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      // Still searching what was just typed, or a whole email (matched exactly
      // by the caller, not by the closest name): the text, not a stale result.
      const typed = q.trim()
      if (onEnterText && typed && (!activeOption || typed !== debouncedQ || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed))) onEnterText(typed)
      else pick(activeOption)
    }
    else if (e.key === 'Escape' && q) { e.preventDefault(); setQ(''); setActive(0) }
    else if (e.key === 'Escape' && onDismiss) { e.preventDefault(); e.stopPropagation(); onDismiss() }
  }

  const showChips = teamExtras && wantTeams && origins.length > 1
  const groupHeading = 'px-2 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-fg-muted'

  const renderOption = (option: Option, index: number) => {
    const item = option.item
    const isActive = index === activeIndex
    const isSelected = selected.has(option.key)
    const describedBy = item.kind === 'team' && isActive && teamExtras ? `${optionId(option.key)}-members` : undefined
    return (
      <li
        key={option.key}
        id={optionId(option.key)}
        role="option"
        aria-selected={isActive}
        aria-describedby={describedBy}
        data-assignee-option={option.key}
        data-active={isActive || undefined}
        onMouseMove={() => { if (!isActive) setActive(index) }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { setActive(index); pick(option) }}
        className={cn(
          'flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5 text-ui',
          isActive ? 'bg-subtle ring-1 ring-inset ring-[color:var(--ds-border-strong,var(--ds-border))]' : 'hover:bg-subtle',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {item.kind === 'person' ? (
            <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-bold text-fg-muted">{getInitials(item.name)}</span>
          ) : (
            <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-fg-muted"><Users className="size-3.5" /></span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-fg">{item.name}</span>
            {item.kind === 'person' && item.email && item.email !== item.name && (
              <span className="block truncate text-2xs text-fg-muted">{item.email}</span>
            )}
            {item.kind === 'team' && (
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-fg-muted">
                <span className="num">{plural(item.member_count, 'member')}</span>
                {item.source_label && item.source_label !== item.origin_label && <span className="truncate">{item.source_label}</span>}
              </span>
            )}
          </span>
          {item.kind === 'team' && <TeamOriginBadge origin={item.origin} />}
          {isSelected && <span className="shrink-0 text-2xs font-medium text-primary-text">Selected</span>}
        </span>
        {item.kind === 'team' && isActive && teamExtras && (
          <span id={`${optionId(option.key)}-members`} data-team-preview={item.id} className="block pl-8 text-2xs">
            <TeamPreview teamId={item.id} count={item.member_count} />
          </span>
        )}
      </li>
    )
  }

  const empty = !isFetching && !options.length
  const status = error
    ? 'Could not search'
    : empty
      ? (debouncedQ ? `No ${wantPeople && !origin ? 'people or teams' : 'teams'} match "${debouncedQ}"` : origin ? `No ${TEAM_ORIGIN_LABELS[origin]} teams` : 'Nothing to pick yet')
      : `${people.length ? plural(people.length, 'person', 'people') : ''}${people.length && teams.length ? ', ' : ''}${teams.length ? plural(teams.length, 'team') : ''}`

  return (
    <div className={cn('space-y-2', className)} data-assignee-search="">
      <div className="relative">
        <Search aria-hidden size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? optionId(activeOption.key) : undefined}
          aria-label={label}
          autoFocus={autoFocus}
          autoComplete="off"
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0) }}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? (wantPeople && wantTeams ? 'Search people and teams…' : wantTeams ? 'Search teams…' : 'Search people…')}
          className="h-9 w-full rounded-md border border-input-border bg-input pl-8 pr-3 text-ui text-fg placeholder:text-fg-subtle"
          data-assignee-input=""
        />
      </div>

      {showChips && (
        <div role="group" aria-label="Filter teams by source" className="flex flex-wrap gap-1.5" data-origin-filters="">
          {[{ origin: null as TeamOrigin | null, label: 'All', count: null as number | null }, ...origins.map((o) => ({ origin: o.origin, label: TEAM_ORIGIN_SHORT_LABELS[o.origin], count: o.count }))].map((chip) => {
            const on = origin === chip.origin
            return (
              <button
                key={chip.origin ?? 'all'}
                type="button"
                aria-pressed={on}
                title={chip.origin ? `${TEAM_ORIGIN_LABELS[chip.origin]} teams` : 'People and every team'}
                data-origin-filter={chip.origin ?? 'all'}
                onClick={() => { setOrigin(chip.origin); setActive(0); inputRef.current?.focus() }}
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors',
                  on ? 'border-primary bg-primary-wash text-primary-text' : 'border-border bg-panel text-fg-muted hover:bg-subtle hover:text-fg',
                )}
              >
                {chip.label}
                {chip.count !== null && <span className="num text-2xs opacity-80">{chip.count}</span>}
              </button>
            )
          })}
        </div>
      )}

      <div className={cn('max-h-64 overflow-y-auto rounded-lg border border-border p-1', listClassName)}>
        <ul id={listId} role="listbox" aria-label={label} aria-busy={isFetching || undefined} className="space-y-0.5">
          {people.length > 0 && (
            <li role="presentation">
              <div className={groupHeading} id={`${baseId}-people`}>People</div>
              <ul role="group" aria-labelledby={`${baseId}-people`} className="space-y-0.5">
                {people.map((p, i) => renderOption(options[i], i))}
              </ul>
            </li>
          )}
          {teams.length > 0 && (
            <li role="presentation">
              <div className={groupHeading} id={`${baseId}-teams`}>Teams</div>
              <ul role="group" aria-labelledby={`${baseId}-teams`} className="space-y-0.5">
                {teams.map((t, i) => renderOption(options[people.length + i], people.length + i))}
              </ul>
            </li>
          )}
        </ul>
        {empty && <p className="px-2 py-3 text-center text-xs text-fg-muted">{status}</p>}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{isFetching ? 'Searching…' : status}</p>
    </div>
  )
}

/**
 * One team, picked with the same search (the workflow User Task node's team):
 * the chosen team with its origin badge, or the search to choose one.
 */
export function TeamPicker({ value, valueName, valueOrigin, onChange, label = 'Search teams' }: {
  value: string | null | undefined
  /** Name of the current team (from the caller's own list), until one is picked here. */
  valueName?: string | null
  valueOrigin?: string | null
  onChange: (team: { id: string; name: string } | null) => void
  label?: string
}) {
  const [picked, setPicked] = useState<Extract<AssigneePick, { kind: 'team' }> | null>(null)
  const [changing, setChanging] = useState(false)
  const current = value ? (picked && picked.id === value ? picked : { id: value, name: valueName ?? 'Team', origin: valueOrigin ?? null }) : null
  if (current && !changing) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-primary bg-primary-wash px-2.5 py-1.5 text-xs" data-team-picker-value={current.id}>
        <Users aria-hidden className="size-3.5 shrink-0 text-primary-text" />
        <span className="min-w-0 flex-1 truncate font-medium text-primary-text">{current.name}</span>
        {current.origin && <TeamOriginBadge origin={current.origin} compact />}
        <button type="button" className="text-2xs text-fg-muted underline" onClick={() => setChanging(true)}>Change</button>
        <button type="button" className="text-2xs text-fg-muted underline" onClick={() => { setPicked(null); onChange(null) }}>Clear</button>
      </div>
    )
  }
  return (
    <AssigneeSearch
      kinds={['team']}
      label={label}
      autoFocus={changing}
      listClassName="max-h-56"
      selectedKeys={value ? [assigneeKey('team', value)] : []}
      onPick={(pick) => {
        if (pick.kind !== 'team') return
        setPicked(pick)
        setChanging(false)
        onChange({ id: pick.id, name: pick.name })
      }}
    />
  )
}
