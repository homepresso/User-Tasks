/**
 * Shared bits of the /api/v1/org routes: the `?scope=` query → a people
 * scope, and CSV file responses (export / import template with format=csv).
 */

import { NextResponse } from 'next/server'
import { ServiceError } from '@/lib/services/context'
import type { PeopleScopeInput } from '@/lib/services/org'

export interface ScopeQuery {
  scope: 'me' | 'direct_reports' | 'all_reports' | 'team' | 'org_unit' | 'project'
  id?: string
  recursive?: 'true' | 'false'
  include_self?: 'true' | 'false'
  include_teams?: 'true' | 'false'
}

export function scopeFromQuery(query: ScopeQuery): PeopleScopeInput {
  const flag = (v?: string) => v === 'true'
  const needId = () => {
    if (!query.id) throw ServiceError.validation(`scope=${query.scope} needs an id`)
    return query.id
  }
  switch (query.scope) {
    case 'me': return { kind: 'me' }
    case 'direct_reports': return { kind: 'direct_reports', includeSelf: flag(query.include_self) }
    case 'all_reports': return { kind: 'all_reports', includeSelf: flag(query.include_self) }
    case 'team': return { kind: 'team', team_id: needId(), recursive: flag(query.recursive) }
    case 'org_unit': return { kind: 'org_unit', org_unit_id: needId(), recursive: flag(query.recursive) }
    case 'project': return { kind: 'project', project_id: needId(), includeTeams: query.include_teams !== 'false' }
    default: throw ServiceError.validation(`Unknown scope '${String((query as { scope?: unknown }).scope)}'`)
  }
}

/** A CSV attachment response. */
export function csvFile(csv: string, filename: string): NextResponse {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '_') || 'export.csv'
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safe}"`,
      'Cache-Control': 'no-store',
    },
  })
}
