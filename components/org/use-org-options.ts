'use client'

import { useQuery } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'
import { usePermissions } from '@/lib/permissions-context'
import type { PersonLike } from './types'
import { flattenTree, parentTree } from './tree-data'

/** Hierarchy order (depth-first) of a tree read. */
function ordered<T extends { id: string; child_ids: readonly string[] }>(data: { roots: string[] } | undefined, rows: readonly T[]): T[] {
  if (!data) return []
  const byId = new Map(rows.map((r) => [r.id, r]))
  return flattenTree(parentTree(rows, data.roots), 'all').map((r) => byId.get(r.id)).filter((r): r is T => !!r)
}

/**
 * Pickers for the editors: workspace people (any member may list them),
 * teams (team.view_members / org.view) and org units (org.view).
 */
export function useOrgOptions() {
  const { can } = usePermissions()
  const people = useQuery({ queryKey: ['org', 'options', 'people'], queryFn: () => serverQuery('settings.tenantUsers') })
  const teams = useQuery({ queryKey: ['org', 'teams'], queryFn: () => serverQuery('org.teams'), enabled: can('team.view_members') || can('org.view') })
  const units = useQuery({ queryKey: ['org', 'units'], queryFn: () => serverQuery('org.units'), enabled: can('org.view') })
  return {
    people: (people.data ?? []) as PersonLike[],
    teams: ordered(teams.data, teams.data?.teams ?? []).map((t) => ({ id: t.id, name: t.name, depth: t.depth })),
    units: ordered(units.data, units.data?.units ?? []).map((u) => ({ id: u.id, name: u.name, depth: u.depth, kind: u.kind })),
    unitTree: units.data,
    teamTree: teams.data,
  }
}

/** "— — Name" labels so a flat <select> shows the hierarchy. */
export function indentLabel(name: string, depth: number): string {
  return `${'— '.repeat(Math.min(depth, 8))}${name}`
}
