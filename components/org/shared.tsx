'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge, type Tone } from '@/components/ui/badge'
import { thClass } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { personName, type PersonLike } from './types'

/** Overlapping avatars, then "+N". */
export function AvatarStack({ people, max = 6, total, size = 'sm' }: { people: PersonLike[]; max?: number; total?: number; size?: 'sm' | 'md' }) {
  const shown = people.slice(0, max)
  const extra = Math.max(0, (total ?? people.length) - shown.length)
  if (!shown.length) return <span className="text-xs text-fg-subtle">No members</span>
  return (
    <span className="flex items-center" aria-label={`${total ?? people.length} people`}>
      <span className="flex -space-x-1.5">
        {shown.map((p) => <Avatar key={p.id} name={personName(p)} src={p.avatar_url ?? null} size={size} ring title={personName(p)} />)}
      </span>
      {extra > 0 && <span className="ml-1.5 text-xs text-fg-muted">+{extra}</span>}
    </span>
  )
}

/** Avatar, name and a secondary line (title, or email). */
export function PersonChip({ person, sub, size = 'sm', className }: { person: PersonLike; sub?: ReactNode; size?: 'sm' | 'md'; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <Avatar name={personName(person)} src={person.avatar_url ?? null} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-fg">{personName(person)}</span>
        {(sub ?? person.job_title) ? <span className="block truncate text-xs text-fg-muted">{sub ?? person.job_title}</span> : null}
      </span>
    </span>
  )
}

const SOURCE_LABEL: Record<string, string> = { okta: 'Okta', entra: 'Entra ID', google: 'Google', ldap: 'LDAP', scim: 'SCIM', csv: 'CSV', directory: 'Directory' }

/** "From Okta" style badge for imported data (nothing for manual). */
export function SourceBadge({ source, detached }: { source: string | null | undefined; detached?: boolean }) {
  if (!source || source === 'manual') return null
  return <Badge tone={detached ? 'neutral' : 'info'} title={detached ? 'Imported, edited here since' : 'Managed by the import; detach to edit'}>{detached ? 'Detached' : `From ${SOURCE_LABEL[source] ?? source}`}</Badge>
}

export function KindBadge({ kind }: { kind: string }) {
  return <Badge tone="neutral" className="capitalize">{kind}</Badge>
}

export function ColourDot({ colour, className }: { colour: string | null | undefined; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2.5 shrink-0 rounded-full border border-border-subtle', className)} style={{ background: colour ?? 'var(--ds-border)' }} />
}

export const PROJECT_STATUS_LABEL: Record<string, string> = { active: 'Active', on_hold: 'On hold', completed: 'Completed', archived: 'Archived' }
const PROJECT_STATUS_TONE: Record<string, Tone> = { active: 'success', on_hold: 'warning', completed: 'brand', archived: 'neutral' }

export function ProjectStatusBadge({ status }: { status: string }) {
  return <Badge tone={PROJECT_STATUS_TONE[status] ?? 'neutral'} dot>{PROJECT_STATUS_LABEL[status] ?? status}</Badge>
}

/** "Jan 5, 2027 – Mar 1, 2027", "From Jan 5, 2027", "" (dates are YYYY-MM-DD). */
export function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  const fmt = (d: string) => {
    const date = new Date(`${d.slice(0, 10)}T00:00:00Z`)
    return Number.isNaN(date.getTime()) ? d : date.toLocaleDateString('en', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
  }
  if (start && end) return `${fmt(start)} – ${fmt(end)}`
  if (start) return `From ${fmt(start)}`
  if (end) return `Until ${fmt(end)}`
  return ''
}

/* ── Sortable tables ── */

export type SortDir = 'asc' | 'desc'

/** Sort rows by a key; null / empty values last. */
export function useSorted<T, K extends string>(rows: readonly T[], getters: Record<K, (row: T) => string | number | null | undefined>, initial: NoInfer<K>) {
  const [sort, setSort] = useState<{ key: K; dir: SortDir }>({ key: initial, dir: 'asc' })
  const sorted = useMemo(() => {
    const get = getters[sort.key]
    const factor = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      const ea = va === null || va === undefined || va === ''
      const eb = vb === null || vb === undefined || vb === ''
      if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor
      return String(va).localeCompare(String(vb)) * factor
    })
    // getters are static per call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort])
  const toggle = (key: K) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  return { sorted, sort, toggle }
}

/** A column header that sorts (aria-sort for screen readers). */
export function SortTH<K extends string>({ label, column, sort, onSort, numeric }: { label: string; column: K; sort: { key: K; dir: SortDir }; onSort: (key: K) => void; numeric?: boolean }) {
  const active = sort.key === column
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className={cn(thClass, numeric && 'text-right')} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} scope="col">
      <button type="button" onClick={() => onSort(column)} className={cn('inline-flex items-center gap-1 hover:text-fg', active && 'text-fg')}>
        {label}
        <Icon className="size-3" aria-hidden />
      </button>
    </th>
  )
}

/** Person items for SearchableEntityPicker. */
export function pickerItems(people: readonly PersonLike[]): { id: string; name: string; subtitle?: string }[] {
  return people.map((p) => ({ id: p.id, name: personName(p), subtitle: [p.job_title, p.email].filter(Boolean).join(' · ') || undefined }))
}
