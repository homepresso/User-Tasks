/**
 * Org structure CSV import / export (Organization → Manage → Import,
 * POST /api/v1/org/import, GET /api/v1/org/export, MCP org_import /
 * org_export, the CLI).
 *
 * Import: the CSV is parsed and limited on the server (lib/org/csv.ts),
 * matched to the workspace's active members by email and planned against
 * the current state (lib/org/import-plan.ts — cell semantics there: blank =
 * unchanged, "-" = clear, teams are added, never removed). planOrgCsvImport
 * writes nothing; applyOrgCsvImport re-plans on the server (a client's plan
 * is never trusted) and applies the valid rows:
 *  - attributes → user_memberships (profile_source 'manual'); rows changing
 *    directory-owned attributes are refused in the plan;
 *  - managers → user_memberships.manager_user_id (manager_source 'manual'):
 *    cleared first, then set, so an order-dependent swap never trips the
 *    database's loop trigger (the final graph was checked for loops);
 *  - division / department → org units with source 'csv' (one per path
 *    prefix, re-imports update them) and the person's CSV unit membership;
 *  - team → added to each named team (created when missing).
 * A failing row write is recorded on that row; the rest still apply. One
 * audit entry per import. Both need org.manage; export needs org.view.
 */

import { CsvError, parseCsv, toCsv } from '@/lib/org/csv'
import { buildImportState, exportRows, IMPORT_FIELDS, planImport, type PlanOutput } from '@/lib/org/import-plan'
import { ensureOrgUnits, syncUnitMemberships, unitPathKey } from '@/lib/org/import-units'
import { loadOrgSnapshot } from '@/lib/org/load'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

export const ORG_IMPORT_COLUMNS = IMPORT_FIELDS
export type OrgImportColumn = (typeof ORG_IMPORT_COLUMNS)[number]

/** CSV column header for each field (null = not imported). Missing fields are auto-mapped by header name. */
export type OrgImportMapping = Partial<Record<OrgImportColumn, string | null>>

export interface OrgImportInput {
  csv: string
  mapping?: OrgImportMapping
}

export type OrgImportAction = 'create' | 'update' | 'unchanged' | 'error'

export interface OrgImportRowPlan {
  /** 1-based data row number (header excluded). */
  row: number
  email: string
  user_id: string | null
  display_name: string | null
  action: OrgImportAction
  changes: Record<string, { before: unknown; after: unknown }>
  errors: string[]
  warnings: string[]
}

export interface OrgImportPlan {
  headers: string[]
  mapping: Record<OrgImportColumn, string | null>
  rows: OrgImportRowPlan[]
  summary: { total: number; create: number; update: number; unchanged: number; errors: number }
  org_units: { create: string[]; existing: string[] }
  teams: { create: string[]; existing: string[] }
  /** Manager loops the file would create (each a list of emails). */
  cycles: string[][]
}

export interface OrgImportResult extends OrgImportPlan {
  applied: true
  people_updated: number
  managers_changed: number
  units_created: number
  unit_memberships_changed: number
  teams_created: number
  team_memberships_added: number
}

/** The import template: header row and two example rows. */
export function orgCsvTemplate(): string {
  return toCsv(ORG_IMPORT_COLUMNS, [
    ['ada@example.com', 'Ada Lovelace', '', 'Chief Executive', 'Leadership', '', 'London', 'E001', 'CC-100', 'Leadership team'],
    ['grace@example.com', 'Grace Hopper', 'ada@example.com', 'Engineering Manager', 'Engineering', 'Product & Technology', 'Remote', 'E002', 'CC-200', 'Platform; Architecture guild'],
  ])
}

function parse(input: OrgImportInput) {
  if (!input || typeof input.csv !== 'string' || !input.csv.trim()) throw ServiceError.validation('The CSV is empty')
  try {
    return parseCsv(input.csv)
  } catch (error) {
    if (error instanceof CsvError) throw ServiceError.validation(error.message)
    throw error
  }
}

async function plan(ctx: ServiceContext, input: OrgImportInput) {
  const parsed = parse(input)
  const db = await serviceRoleClient(ctx)
  const snapshot = await loadOrgSnapshot(db, ctx.tenantId, ['people', 'units', 'teams'])
  let output: PlanOutput
  try {
    output = planImport(parsed, input.mapping, buildImportState(snapshot))
  } catch (error) {
    throw ServiceError.validation(error instanceof Error ? error.message : String(error))
  }
  return { db, snapshot, output }
}

function publicPlan(output: PlanOutput): OrgImportPlan {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- ops stay server-side
  const { ops, ...rest } = output
  return rest
}

/** Parse and diff a CSV against the workspace without writing anything. org.manage. */
export async function planOrgCsvImport(ctx: ServiceContext, input: OrgImportInput): Promise<OrgImportPlan> {
  requirePerm(ctx, 'org.manage')
  return publicPlan((await plan(ctx, input)).output)
}

/** Apply a CSV import (rows with errors are skipped). org.manage. */
export async function applyOrgCsvImport(ctx: ServiceContext, input: OrgImportInput): Promise<OrgImportResult> {
  requirePerm(ctx, 'org.manage')
  const { db, snapshot, output } = await plan(ctx, input)
  const rowByNumber = new Map(output.rows.map((r) => [r.row, r]))
  const fail = (rowNo: number, message: string) => {
    const row = rowByNumber.get(rowNo)
    if (row) { row.errors.push(message); row.action = 'error' }
  }
  const nowIso = new Date().toISOString()
  const tenantId = ctx.tenantId
  let peopleUpdated = 0
  let managersChanged = 0

  // 1. Attributes.
  for (const [rowNo, op] of output.ops) {
    if (!Object.keys(op.profile).length) continue
    const { error } = await (db as any).from('user_memberships')
      .update({ ...op.profile, profile_source: 'manual', profile_updated_at: nowIso })
      .eq('tenant_id', tenantId).eq('user_id', op.user_id)
    if (error) fail(rowNo, `Attributes not saved: ${error.message}`)
    else peopleUpdated++
  }

  // 2. Managers: clear, then set (the final graph is loop-free; each set adds an edge of it).
  const managerRows = [...output.ops].filter(([rowNo, op]) => op.manager !== undefined && rowByNumber.get(rowNo)?.action !== 'error')
  const cleared = new Set<number>()
  for (const [rowNo, op] of managerRows) {
    const { error } = await (db as any).from('user_memberships')
      .update({ manager_user_id: null, manager_source: null, manager_updated_at: nowIso })
      .eq('tenant_id', tenantId).eq('user_id', op.user_id)
    if (error) fail(rowNo, `Manager not changed: ${error.message}`)
    else cleared.add(rowNo)
  }
  for (const [rowNo, op] of managerRows) {
    if (!cleared.has(rowNo)) continue
    if (op.manager === null) { managersChanged++; continue }
    const { error } = await (db as any).from('user_memberships')
      .update({ manager_user_id: op.manager, manager_source: 'manual', manager_updated_at: nowIso })
      .eq('tenant_id', tenantId).eq('user_id', op.user_id)
    if (error) fail(rowNo, `Manager not set: ${error.message.replace(/^.*?: /, '')}`)
    else managersChanged++
  }

  // 3. CSV org units and memberships.
  const unitOps = [...output.ops].filter(([rowNo, op]) => op.unit_path !== undefined && rowByNumber.get(rowNo)?.action !== 'error')
  let unitsCreated = 0
  let unitMembershipsChanged = 0
  if (unitOps.length) {
    const ensured = await ensureOrgUnits(db, tenantId, 'csv', unitOps.map(([, op]) => op.unit_path!).filter((p) => p.length), { createdBy: ctx.actorId })
    unitsCreated = ensured.created
    const desired = new Map<string, string | null>()
    for (const [rowNo, op] of unitOps) {
      const path = op.unit_path!
      if (!path.length) { desired.set(op.user_id, null); continue }
      const unitId = ensured.idByKey.get(unitPathKey(path))
      if (unitId) desired.set(op.user_id, unitId)
      else fail(rowNo, 'Org unit could not be created')
    }
    const synced = await syncUnitMemberships(db, tenantId, 'csv', desired)
    unitMembershipsChanged = synced.added + synced.removed
  }

  // 4. Teams (add only).
  let teamsCreated = 0
  let teamMembershipsAdded = 0
  const teamIdByLower = new Map(snapshot.teams.map((t) => [t.name.toLowerCase(), t.id]))
  const inTeam = new Set(snapshot.teamMembers.map((m) => `${m.team_id}:${m.user_id}`))
  for (const [rowNo, op] of output.ops) {
    if (!op.add_teams.length || rowByNumber.get(rowNo)?.action === 'error') continue
    for (const name of op.add_teams) {
      let teamId = teamIdByLower.get(name.toLowerCase())
      if (!teamId) {
        const { data, error } = await (db as any).from('teams').insert({ tenant_id: tenantId, name }).select('id').single()
        if (error || !data) { fail(rowNo, `Team "${name}" not created: ${error?.message ?? 'unknown error'}`); continue }
        teamId = String(data.id)
        teamIdByLower.set(name.toLowerCase(), teamId)
        teamsCreated++
      }
      if (inTeam.has(`${teamId}:${op.user_id}`)) continue
      const { error } = await (db as any).from('user_teams').insert({ team_id: teamId, user_id: op.user_id, role: 'member' })
      if (error && !/duplicate|unique/i.test(error.message ?? '')) { fail(rowNo, `Not added to team "${name}": ${error.message}`); continue }
      inTeam.add(`${teamId}:${op.user_id}`)
      teamMembershipsAdded++
    }
  }

  const result = publicPlan(output)
  result.summary = { total: result.rows.length, create: 0, update: 0, unchanged: 0, errors: 0 }
  for (const r of result.rows) {
    if (r.action === 'error') result.summary.errors++
    else result.summary[r.action]++
  }
  await audit(ctx, {
    objectType: 'org', objectId: tenantId, action: 'import',
    summary: `Imported the org structure from CSV: ${peopleUpdated} people updated, ${managersChanged} managers changed, ${unitsCreated} org units and ${teamsCreated} teams created, ${result.summary.errors} rows skipped`,
    metadata: { rows: result.summary.total, people_updated: peopleUpdated, managers_changed: managersChanged, units_created: unitsCreated, unit_memberships_changed: unitMembershipsChanged, teams_created: teamsCreated, team_memberships_added: teamMembershipsAdded, errors: result.summary.errors },
  })
  return {
    ...result,
    applied: true,
    people_updated: peopleUpdated,
    managers_changed: managersChanged,
    units_created: unitsCreated,
    unit_memberships_changed: unitMembershipsChanged,
    teams_created: teamsCreated,
    team_memberships_added: teamMembershipsAdded,
  }
}

/** The org structure as CSV (the import format, one row per active member). org.view. */
export async function exportOrgCsv(ctx: ServiceContext): Promise<{ csv: string; filename: string; rows: number }> {
  requirePerm(ctx, 'org.view')
  const db = await serviceRoleClient(ctx)
  const snapshot = await loadOrgSnapshot(db, ctx.tenantId, ['people', 'units', 'teams'])
  const rows = exportRows(buildImportState(snapshot))
  const { data: tenant, error } = await (db as any).from('tenants').select('slug').eq('id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  const slug = String(tenant?.slug ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  const stamp = new Date().toISOString().slice(0, 10)
  return { csv: toCsv(ORG_IMPORT_COLUMNS, rows), filename: `org-structure-${slug || 'workspace'}-${stamp}.csv`, rows: rows.length }
}
