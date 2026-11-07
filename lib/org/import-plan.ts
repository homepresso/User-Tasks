/**
 * Org structure CSV import planning (pure): the workspace's current state +
 * parsed rows + a column mapping → a per-row diff and the operations to
 * apply. lib/services/org-import.ts loads the state, calls planImport, and
 * (on apply) runs the operations.
 *
 * Cell semantics:
 *  - blank cell (or an unmapped column) = leave the value unchanged;
 *  - "-" = clear the value (manager, attributes, division / department);
 *  - team: one or more team names separated by ";" — the person is added to
 *    each (teams are created when missing); an import never removes anyone
 *    from a team;
 *  - display_name is informational (export carries it; import ignores it).
 *
 * Row actions: 'create' = first-time placement (the person had no
 * attributes, manager, org unit or team before and the row sets some),
 * 'update' = something changes, 'unchanged' = nothing changes, 'error' =
 * the row is skipped (messages in `errors`).
 */

import { autoMapHeaders, unguardCell, type ParsedCsv } from './csv'
import { attributeUnitPath, unitPathKey, type UnitPath } from './import-units'
import { ancestorIds, buildTree, PROFILE_FIELDS, type OrgSnapshot, type ProfileField } from './structure'

export const IMPORT_FIELDS = ['email', 'display_name', 'manager_email', 'job_title', 'department', 'division', 'location', 'employee_id', 'cost_center', 'team'] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]
export type ImportMapping = Record<ImportField, string | null>

export const CLEAR_TOKEN = '-'

export interface ImportPersonState {
  user_id: string
  email: string
  display_name: string | null
  manager_user_id: string | null
  profile_source: string | null
  job_title: string | null
  /** Attribute, else the department of the person's primary org unit. */
  department: string | null
  /** From the person's primary org unit path. */
  division: string | null
  location: string | null
  employee_id: string | null
  cost_center: string | null
  /** Team names the person is in. */
  teams: string[]
  has_unit: boolean
}

export interface ImportState {
  people: ImportPersonState[]
  /** Existing team names (any case). */
  team_names: string[]
  /** external_id of the workspace's CSV org units. */
  csv_unit_keys: string[]
}

export interface RowOps {
  user_id: string
  /** Profile attributes to write (null = clear). */
  profile: Partial<Record<ProfileField, string | null>>
  /** New manager (null = clear); undefined = unchanged. */
  manager?: string | null
  /** CSV org unit path to place the person in ([] = leave the CSV unit); undefined = unchanged. */
  unit_path?: UnitPath
  /** Team names to add the person to. */
  add_teams: string[]
}

export interface PlannedRow {
  row: number
  email: string
  user_id: string | null
  display_name: string | null
  action: 'create' | 'update' | 'unchanged' | 'error'
  changes: Record<string, { before: unknown; after: unknown }>
  errors: string[]
  warnings: string[]
}

export interface PlanOutput {
  headers: string[]
  mapping: ImportMapping
  rows: PlannedRow[]
  summary: { total: number; create: number; update: number; unchanged: number; errors: number }
  org_units: { create: string[]; existing: string[] }
  teams: { create: string[]; existing: string[] }
  cycles: string[][]
  /** Operations per valid row (by row number). Internal: not returned to callers. */
  ops: Map<number, RowOps>
}

const norm = (v: string | null | undefined) => String(v ?? '').trim()
const lc = (v: string | null | undefined) => norm(v).toLowerCase()

/** Split a team cell ("Platform; Infra") into names. */
export function splitTeams(cell: string): string[] {
  return Array.from(new Set(cell.split(/[;|]/).map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t && t !== CLEAR_TOKEN)))
}

/** Resolve the mapping: explicit entries win (null = skip), the rest auto-mapped; unknown headers dropped. */
export function resolveMapping(headers: readonly string[], explicit: Partial<Record<ImportField, string | null>> = {}): ImportMapping {
  const auto = autoMapHeaders(headers, IMPORT_FIELDS)
  const out = { ...auto }
  for (const field of IMPORT_FIELDS) {
    if (!(field in explicit)) continue
    const header = explicit[field]
    out[field] = header && headers.includes(header) ? header : null
  }
  return out
}

/** Primary org unit → (department, division) names: kind-aware, else leaf / parent. */
export function unitPlacement(snapshot: Pick<OrgSnapshot, 'units' | 'unitMembers'>, userId: string): { department: string | null; division: string | null; has_unit: boolean } {
  const mine = snapshot.unitMembers.filter((m) => m.user_id === userId).sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
  if (!mine.length) return { department: null, division: null, has_unit: false }
  const byId = new Map(snapshot.units.map((u) => [u.id, u]))
  const tree = buildTree(snapshot.units)
  const leafId = mine[0].org_unit_id
  const pathIds = [leafId, ...ancestorIds(tree, leafId)] // leaf → root
  const path = pathIds.map((id) => byId.get(id)).filter((u): u is NonNullable<typeof u> => Boolean(u))
  if (!path.length) return { department: null, division: null, has_unit: true }
  const dept = path.find((u) => u.kind === 'department')
  const div = path.find((u) => u.kind === 'division')
  if (dept || div) {
    return { department: dept?.name ?? null, division: div?.name ?? null, has_unit: true }
  }
  if (path[0].kind === 'company') return { department: null, division: null, has_unit: true }
  return { department: path[0].name, division: path[1] && path[1].kind !== 'company' ? path[1].name : null, has_unit: true }
}

/** The import state from an org snapshot (people, units and teams parts). */
export function buildImportState(snapshot: OrgSnapshot): ImportState {
  const teamName = new Map(snapshot.teams.map((t) => [t.id, t.name]))
  return {
    people: snapshot.people.map((p) => {
      const placement = unitPlacement(snapshot, p.id)
      return {
        user_id: p.id,
        email: p.email ?? '',
        display_name: p.display_name,
        manager_user_id: p.manager_user_id,
        profile_source: p.profile_source,
        job_title: p.job_title,
        department: p.department ?? placement.department,
        division: placement.division,
        location: p.location,
        employee_id: p.employee_id,
        cost_center: p.cost_center,
        teams: snapshot.teamMembers.filter((m) => m.user_id === p.id).map((m) => teamName.get(m.team_id)).filter((n): n is string => Boolean(n)).sort((a, b) => a.localeCompare(b)),
        has_unit: placement.has_unit,
      }
    }),
    team_names: snapshot.teams.map((t) => t.name),
    csv_unit_keys: snapshot.units.filter((u) => u.source === 'csv' && u.external_id).map((u) => String(u.external_id)),
  }
}

/** Export rows in IMPORT_FIELDS order, sorted by email. */
export function exportRows(state: ImportState): string[][] {
  const emailOf = new Map(state.people.map((p) => [p.user_id, p.email]))
  return state.people
    .filter((p) => p.email)
    .slice()
    .sort((a, b) => a.email.localeCompare(b.email))
    .map((p) => [
      p.email, p.display_name ?? '', (p.manager_user_id && emailOf.get(p.manager_user_id)) || '',
      p.job_title ?? '', p.department ?? '', p.division ?? '', p.location ?? '', p.employee_id ?? '', p.cost_center ?? '',
      p.teams.join('; '),
    ])
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Find manager loops in `managerOf` that include any of `touched`. Each loop once, as user ids. */
export function findCycles(managerOf: ReadonlyMap<string, string>, touched: Iterable<string>): string[][] {
  const out: string[][] = []
  const seenInCycle = new Set<string>()
  for (const start of touched) {
    if (seenInCycle.has(start)) continue
    const order: string[] = []
    const index = new Map<string, number>()
    let current: string | undefined = start
    while (current && !index.has(current) && order.length < 100_000) {
      index.set(current, order.length)
      order.push(current)
      current = managerOf.get(current)
    }
    if (current && index.has(current)) {
      const loop = order.slice(index.get(current)!)
      if (loop.some((id) => seenInCycle.has(id))) continue
      for (const id of loop) seenInCycle.add(id)
      out.push(loop)
    }
  }
  return out
}

/** Plan an import. Pure: no I/O. */
export function planImport(parsed: ParsedCsv, explicitMapping: Partial<Record<ImportField, string | null>> | undefined, state: ImportState): PlanOutput {
  const mapping = resolveMapping(parsed.headers, explicitMapping)
  if (!mapping.email) {
    throw new Error('No email column: map a column to "email" (the person is matched by email).')
  }
  const col = new Map<ImportField, number>()
  for (const field of IMPORT_FIELDS) {
    const header = mapping[field]
    if (header) col.set(field, parsed.headers.indexOf(header))
  }
  const cell = (row: string[], field: ImportField): string => {
    const idx = col.get(field)
    return idx === undefined || idx < 0 ? '' : unguardCell(norm(row[idx]))
  }

  const byEmail = new Map(state.people.filter((p) => p.email).map((p) => [lc(p.email), p]))
  const byId = new Map(state.people.map((p) => [p.user_id, p]))
  const teamByLower = new Map(state.team_names.map((n) => [n.toLowerCase(), n]))
  const seenEmails = new Map<string, number>()
  const rows: PlannedRow[] = []
  const ops = new Map<number, RowOps>()

  parsed.rows.forEach((raw, i) => {
    const rowNo = i + 1
    const email = cell(raw, 'email')
    const planned: PlannedRow = { row: rowNo, email, user_id: null, display_name: cell(raw, 'display_name') || null, action: 'unchanged', changes: {}, errors: [], warnings: [] }
    rows.push(planned)
    if (!email) { planned.errors.push('Email is required'); return }
    if (!EMAIL_RE.test(email)) { planned.errors.push(`"${email}" is not an email address`); return }
    const firstRow = seenEmails.get(lc(email))
    if (firstRow !== undefined) { planned.errors.push(`Duplicate of row ${firstRow}`); return }
    seenEmails.set(lc(email), rowNo)
    const person = byEmail.get(lc(email))
    if (!person) { planned.errors.push('Not a member of this workspace (invite them first)'); return }
    planned.user_id = person.user_id
    planned.display_name = person.display_name ?? planned.display_name

    const op: RowOps = { user_id: person.user_id, profile: {}, add_teams: [] }
    // Attributes.
    let attributeChange = false
    for (const field of PROFILE_FIELDS) {
      const value = cell(raw, field)
      if (!value) continue
      const next = value === CLEAR_TOKEN ? null : value.replace(/\s+/g, ' ')
      const limit = field === 'employee_id' || field === 'cost_center' ? 100 : 200
      if (next && next.length > limit) { planned.errors.push(`${field} is longer than ${limit} characters`); continue }
      const before = person[field] ?? null
      if ((before ?? '') === (next ?? '')) continue
      op.profile[field] = next
      planned.changes[field] = { before, after: next }
      attributeChange = true
    }
    // Division (org unit path only) and the CSV org unit.
    const divisionCell = cell(raw, 'division')
    const nextDivision = divisionCell ? (divisionCell === CLEAR_TOKEN ? null : divisionCell.replace(/\s+/g, ' ')) : person.division
    if (divisionCell && (person.division ?? '') !== (nextDivision ?? '')) {
      planned.changes.division = { before: person.division, after: nextDivision }
      attributeChange = true
    }
    const departmentChanged = 'department' in op.profile
    if (departmentChanged || planned.changes.division) {
      const nextDepartment = departmentChanged ? op.profile.department ?? null : person.department
      op.unit_path = attributeUnitPath({ division: nextDivision, department: nextDepartment })
      const fmt = (div: string | null, dep: string | null) => [div, dep].filter(Boolean).join(' / ') || null
      planned.changes.org_unit = { before: fmt(person.division, person.department), after: fmt(nextDivision, nextDepartment) }
    }
    if (attributeChange && person.profile_source === 'directory') {
      planned.errors.push('Attributes come from the directory; detach them first (Organization → Manage → People) or leave those columns blank')
    }
    // Manager.
    const managerCell = cell(raw, 'manager_email')
    if (managerCell) {
      if (managerCell === CLEAR_TOKEN) {
        if (person.manager_user_id) {
          op.manager = null
          planned.changes.manager = { before: byId.get(person.manager_user_id)?.email ?? person.manager_user_id, after: null }
        }
      } else if (lc(managerCell) === lc(email)) {
        planned.errors.push('A person cannot be their own manager')
      } else {
        const manager = byEmail.get(lc(managerCell))
        if (!manager) planned.errors.push(`Manager ${managerCell} is not a member of this workspace`)
        else if (manager.user_id !== person.manager_user_id) {
          op.manager = manager.user_id
          planned.changes.manager = { before: person.manager_user_id ? byId.get(person.manager_user_id)?.email ?? person.manager_user_id : null, after: manager.email }
        }
      }
    }
    // Teams (add only).
    const teamCell = cell(raw, 'team')
    if (teamCell === CLEAR_TOKEN) planned.warnings.push('"-" in team is ignored: an import never removes anyone from a team')
    const current = new Set(person.teams.map((t) => t.toLowerCase()))
    for (const name of splitTeams(teamCell)) {
      if (name.length > 200) { planned.errors.push('Team name longer than 200 characters'); continue }
      if (current.has(name.toLowerCase())) continue
      op.add_teams.push(teamByLower.get(name.toLowerCase()) ?? name)
    }
    if (op.add_teams.length) planned.changes.team = { before: person.teams.join('; ') || null, after: [...person.teams, ...op.add_teams].join('; ') }

    if (planned.errors.length) return
    if (!Object.keys(planned.changes).length) return
    const blank = !person.job_title && !person.department && !person.division && !person.location && !person.employee_id
      && !person.cost_center && !person.manager_user_id && !person.has_unit && !person.teams.length
    planned.action = blank ? 'create' : 'update'
    ops.set(rowNo, op)
  })

  // Manager loops across existing lines + the file's valid changes.
  const managerOf = new Map<string, string>()
  for (const p of state.people) if (p.manager_user_id) managerOf.set(p.user_id, p.manager_user_id)
  const touched: string[] = []
  for (const op of ops.values()) {
    if (op.manager === undefined) continue
    if (op.manager === null) managerOf.delete(op.user_id)
    else { managerOf.set(op.user_id, op.manager); touched.push(op.user_id) }
  }
  const cycleIds = findCycles(managerOf, touched)
  const emailOf = (id: string) => byId.get(id)?.email ?? id
  const cycles = cycleIds.map((loop) => loop.map(emailOf))
  const inCycle = new Set(cycleIds.flat())
  for (const planned of rows) {
    const op = ops.get(planned.row)
    if (!op || op.manager === undefined || op.manager === null || !inCycle.has(op.user_id)) continue
    const loop = cycleIds.find((l) => l.includes(op.user_id))!
    planned.errors.push(`Manager loop: ${[...loop, loop[0]].map(emailOf).join(' → ')}`)
    ops.delete(planned.row)
  }
  for (const planned of rows) if (planned.errors.length) planned.action = 'error'

  // Org units and teams the valid rows need.
  const existingKeys = new Set(state.csv_unit_keys)
  const unitCreate = new Map<string, string>()
  const unitExisting = new Map<string, string>()
  const teamCreate = new Map<string, string>()
  const teamExisting = new Map<string, string>()
  for (const op of ops.values()) {
    if (op.unit_path?.length) {
      for (let i = 1; i <= op.unit_path.length; i++) {
        const prefix = op.unit_path.slice(0, i)
        const key = unitPathKey(prefix)
        const label = prefix.map((s) => s.name).join(' / ')
        if (existingKeys.has(key)) unitExisting.set(key, label)
        else if (!unitCreate.has(key)) unitCreate.set(key, label)
      }
    }
    for (const name of op.add_teams) {
      const key = name.toLowerCase()
      if (teamByLower.has(key)) teamExisting.set(key, teamByLower.get(key)!)
      else if (!teamCreate.has(key)) teamCreate.set(key, name)
    }
  }

  const summary = { total: rows.length, create: 0, update: 0, unchanged: 0, errors: 0 }
  for (const r of rows) {
    if (r.action === 'error') summary.errors++
    else summary[r.action]++
  }
  return {
    headers: parsed.headers,
    mapping,
    rows,
    summary,
    org_units: { create: [...unitCreate.values()], existing: [...unitExisting.values()] },
    teams: { create: [...teamCreate.values()], existing: [...teamExisting.values()] },
    cycles,
    ops,
  }
}
