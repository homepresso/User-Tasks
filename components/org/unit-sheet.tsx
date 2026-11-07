'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ColourDot, KindBadge, PersonChip, ProjectStatusBadge, SourceBadge } from './shared'

/** An org unit in context: path, head, sub-units, members, teams, projects. */
export function UnitSheet({ unitId, onClose, onNavigate, onPerson }: {
  unitId: string | null
  onClose: () => void
  onNavigate: (id: string) => void
  onPerson?: (id: string) => void
}) {
  const { data, error } = useQuery({
    queryKey: ['org', 'unit', unitId],
    queryFn: () => serverQuery('org.unit', { unitId: unitId! }),
    enabled: !!unitId,
  })
  return (
    <Sheet open={!!unitId} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent size="md" title={data?.name ?? 'Org unit'} description={data ? `${data.headcount} people` : undefined}>
        {!data ? (
          error ? <InlineNotice tone="danger" message={error instanceof Error ? error.message : 'Could not load this unit'} /> : <Skeleton className="h-32 w-full" />
        ) : (
          <div className="space-y-5 text-sm" data-unit-sheet={data.id}>
            <div className="flex flex-wrap items-center gap-2">
              <KindBadge kind={data.kind} />
              <SourceBadge source={data.source} detached={data.detached} />
            </div>
            {data.path.length > 0 && (
              <nav aria-label="Parent units" className="flex flex-wrap gap-1 text-xs text-fg-muted">
                {data.path.map((p) => <button key={p.id} type="button" onClick={() => onNavigate(p.id)} className="hover:text-fg hover:underline">{p.name} ›</button>)}
                <span className="text-fg">{data.name}</span>
              </nav>
            )}
            {data.description && <p className="text-fg-muted">{data.description}</p>}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">Head</h3>
              {data.head ? <PersonChip person={data.head} /> : <p className="text-xs text-fg-subtle">No head</p>}
            </section>
            {data.children.length > 0 && (
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">Sub-units ({data.children.length})</h3>
                <ul className="space-y-1">
                  {data.children.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <button type="button" onClick={() => onNavigate(c.id)} className="truncate text-primary-text hover:underline">{c.name}</button>
                      <span className="text-xs tabular-nums text-fg-muted">{c.headcount}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">Members ({data.members.length})</h3>
              {data.members.length ? (
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {data.members.map((m) => (
                    <li key={m.id}>
                      <button type="button" className="w-full rounded-md p-1 text-left hover:bg-subtle" onClick={() => onPerson?.(m.id)} disabled={!onPerson}>
                        <PersonChip person={m} sub={[m.role, m.is_primary ? null : 'secondary'].filter(Boolean).join(' · ') || m.job_title} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-fg-subtle">No direct members{data.headcount ? ` (${data.headcount} in sub-units)` : ''}</p>}
            </section>
            {data.teams.length > 0 && (
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">Teams</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {data.teams.map((t) => <li key={t.id}><Badge tone="neutral"><ColourDot colour={t.colour} className="mr-1" />{t.name}</Badge></li>)}
                </ul>
              </section>
            )}
            {data.projects && data.projects.length > 0 && (
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">Projects</h3>
                <ul className="space-y-1">
                  {data.projects.map((p) => (
                    <li key={p.id} className="flex items-center gap-2">
                      <Link href={`/org/projects/${p.id}`} className="text-primary-text hover:underline">{p.name}</Link>
                      <ProjectStatusBadge status={p.status} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
