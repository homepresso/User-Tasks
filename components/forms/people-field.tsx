'use client'

import { useQuery } from '@tanstack/react-query'
import { User, Users, X } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { serverRead } from '@/lib/server-read'
import { normalizePeopleValue, peopleMax, personRefKey, type PersonRef, type UserFieldConfig } from '@/lib/forms/people-field'
import { cn } from '@/lib/utils'

type PersonOption = { id: string; display_name: string | null; email: string | null }

/** The workspace's teams (names for the picker; any member — tasks.teams). */
export function useTeamOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['form-team-options'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => (await serverRead('tasks.teams')).data ?? [],
  })
}

/**
 * Person field with several people and / or teams (lib/forms/people-field.ts):
 * the picks as removable chips, then a type-to-filter picker to add one
 * (people first, then teams). The value is an array of { kind, id, name };
 * the server checks every id belongs to the workspace and sets the names.
 */
export function PeopleField({ value, onChange, id, labelledBy, describedBy, invalid, disabled, readOnly, config, people, placeholder, label }: {
  value: unknown
  onChange: (refs: PersonRef[]) => void
  id: string
  label: string
  labelledBy?: string
  describedBy?: string
  invalid?: boolean
  disabled?: boolean
  readOnly?: boolean
  config?: UserFieldConfig
  people: PersonOption[]
  placeholder?: string
}) {
  const { data: teams = [] } = useTeamOptions(Boolean(config?.allow_teams))
  const refs = normalizePeopleValue(value)
  const max = peopleMax(config)
  const editable = !disabled && !readOnly
  const nameOf = (ref: PersonRef) => {
    if (ref.kind === 'team') return teams.find((t) => t.id === ref.id)?.name ?? ref.name ?? 'Team'
    const p = people.find((x) => x.id === ref.id)
    return p ? p.display_name || p.email || ref.name || 'Person' : ref.name ?? 'Person'
  }
  const taken = new Set(refs.map(personRefKey))
  const options = [
    ...people.map((p) => ({ value: `user:${p.id}`, label: p.display_name || p.email || p.id, hint: p.display_name && p.email ? p.email : undefined })),
    ...(config?.allow_teams ? teams.map((t) => ({ value: `team:${t.id}`, label: t.name, hint: 'Team' })) : []),
  ].filter((o) => !taken.has(o.value))
  const add = (key: string) => {
    const [kind, refId] = key.split(':') as ['user' | 'team', string]
    if (!refId) return
    const next = max === 1 ? [] : refs
    const name = nameOf({ kind, id: refId })
    onChange([...next, { kind, id: refId, name }].slice(0, max))
  }
  const remove = (key: string) => onChange(refs.filter((r) => personRefKey(r) !== key))
  const full = refs.length >= max

  return (
    <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy} data-people-field {...(readOnly ? { 'data-read-only': '' } : {})}>
      {refs.length > 0 && (
        <ul role="list" aria-label={`${label}: chosen`} className="mb-1.5 flex flex-wrap gap-1.5">
          {refs.map((ref) => {
            const name = nameOf(ref)
            const Icon = ref.kind === 'team' ? Users : User
            return (
              <li key={personRefKey(ref)} className={cn('inline-flex max-w-full items-center gap-1 rounded-full border py-0.5 pl-2 text-xs text-fg border-border bg-subtle', editable ? 'pr-0.5' : 'pr-2', readOnly && 'border-dashed')}>
                <Icon size={12} aria-hidden className="shrink-0 text-fg-muted" />
                <span className="truncate">{name}</span>
                {ref.kind === 'team' && <span className="sr-only">(team)</span>}
                {editable && (
                  <button type="button" onClick={() => remove(personRefKey(ref))} aria-label={`Remove ${name}`}
                    className="inline-flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-border hover:text-fg">
                    <X size={12} aria-hidden />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {editable && (!full || max === 1) && (
        <AutocompleteSelect
          value=""
          onChange={(next) => { if (next) add(next) }}
          options={options}
          placeholder={placeholder || (max === 1 ? (config?.allow_teams ? 'Choose a person or team…' : 'Choose a person…') : config?.allow_teams ? 'Add a person or team…' : 'Add a person…')}
          size="md"
          id={id} labelledBy={labelledBy} describedBy={describedBy} invalid={invalid}
        />
      )}
      {editable && max > 1 && <p className="mt-1 text-2xs text-fg-muted" aria-live="polite">{refs.length} of at most {max} chosen</p>}
      {!editable && !refs.length && <p className="text-sm text-fg">—</p>}
    </div>
  )
}

/** Read-only: the names (server-set), people and teams. */
export function PeopleValueView({ value }: { value: unknown }) {
  const refs = normalizePeopleValue(value)
  if (!refs.length) return <p className="text-sm text-fg">—</p>
  return (
    <ul role="list" className="flex flex-wrap gap-1.5" data-people-value>
      {refs.map((ref) => {
        const Icon = ref.kind === 'team' ? Users : User
        return (
          <li key={personRefKey(ref)} className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-fg border-border bg-subtle">
            <Icon size={12} aria-hidden className="shrink-0 text-fg-muted" />
            <span className="truncate">{ref.name || (ref.kind === 'team' ? 'A team' : 'A person')}</span>
            {ref.kind === 'team' && <span className="sr-only">(team)</span>}
          </li>
        )
      })}
    </ul>
  )
}
