import { z } from 'zod'
import type { McpContext, McpToolServer } from '../server'
import { mcpErr, mcpOk } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import * as org from '@/lib/services/org'
import * as orgImport from '@/lib/services/org-import'
import { scopeFromQuery } from '@/lib/api/org-route-helpers'
import { MCP_CORE_TOOL_DESCRIPTIONS } from '../descriptions'
import { messageOf } from './_util'

/*
 * Organization tools: thin wrappers over lib/services/org (the org chart,
 * people attributes, org units, the team tree, people scopes) and
 * lib/services/org-import (CSV). The services own permission checks, tenant
 * filtering and audit (mutating tools are in AUDITED_IN_SERVICE in ../authz).
 * Self-scoped reads (your own reports, chain, peers, profile, scope) are
 * gated at the floor every role holds; the service requires org.view for
 * anyone else.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const userId = z.string().describe('User ID, or "me" for the caller')
const DIRECTORY_NOTE = 'Attributes the directory owns are refused until detached (org_person_detach).'
const UNIT_NOTE = 'Units imported from a directory or CSV are read-only until detached (org_unit_detach).'

export function registerOrgTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('org_chart', 'The org chart: every active member with manager_user_id, job title, department, location and direct / total report counts, plus `roots` (people with no manager, biggest organisation first). Needs org.view.', {}, async () => run(() => org.getOrgChart(svc())))

  server.tool('org_person_get', 'One person in context: attributes, manager chain, direct reports, peers, teams, org units and projects. Your own ("me") needs no permission; anyone else needs org.view.', {
    user_id: userId,
  }, async (args) => run(() => org.getPerson(svc(), args.user_id)))

  server.tool('org_person_update', `Edit a member's job_title, department, location, employee_id, cost_center (org.manage) and/or manager_user_id (null clears; loops refused). ${DIRECTORY_NOTE}`, {
    user_id: userId,
    job_title: z.string().nullable().optional(),
    department: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    employee_id: z.string().nullable().optional(),
    cost_center: z.string().nullable().optional(),
    manager_user_id: z.string().nullable().optional().describe('Manager user ID, or null to clear'),
  }, async ({ user_id, ...patch }) => run(() => org.updatePersonProfile(svc(), user_id, patch)))

  server.tool('org_person_detach', 'Detach a member\'s attributes from the directory: they become editable here and directory sync stops updating them.', {
    user_id: userId,
  }, async (args) => run(() => org.detachPersonProfile(svc(), args.user_id)))

  server.tool('org_subordinates', 'People who report to a member: direct (default) or every level with depth "all" (up to 10 levels, cycle-safe); include_self adds the person first. Your own needs no permission; anyone else needs org.view.', {
    user_id: userId,
    depth: z.enum(['direct', 'all']).optional().describe('direct (default) or all'),
    include_self: z.boolean().optional(),
  }, async (args) => run(() => org.getSubordinates(svc(), args.user_id, { depth: args.depth ?? 'direct', includeSelf: args.include_self === true })))

  server.tool('org_manager_chain', 'A member\'s managers, nearest first. Your own needs no permission; anyone else needs org.view.', {
    user_id: userId,
  }, async (args) => run(() => org.getManagerChain(svc(), args.user_id)))

  server.tool('org_peers', 'Others with the same manager as a member. Your own needs no permission; anyone else needs org.view.', {
    user_id: userId,
  }, async (args) => run(() => org.getPeers(svc(), args.user_id)))

  server.tool('org_scope_resolve', MCP_CORE_TOOL_DESCRIPTIONS.org_scope_resolve, {
    scope: z.enum(['me', 'direct_reports', 'all_reports', 'team', 'org_unit', 'project']),
    id: z.string().optional().describe('Team, org unit or project ID'),
    recursive: z.boolean().optional(),
    include_self: z.boolean().optional(),
    include_teams: z.boolean().optional(),
  }, async (args) => run(() => org.resolvePeopleScope(svc(), scopeFromQuery({
    scope: args.scope,
    id: args.id,
    recursive: args.recursive ? 'true' : undefined,
    include_self: args.include_self ? 'true' : undefined,
    include_teams: args.include_teams === false ? 'false' : undefined,
  }))))

  server.tool('org_units_list', 'Every org unit (company, division, department, unit or custom kind) with head, depth, child_ids, member_count and headcount (distinct members of the unit and every unit below), plus `roots`.', {}, async () => run(() => org.getOrgUnitTree(svc())))

  server.tool('org_unit_get', 'One org unit with its path, children, members, teams and projects.', {
    org_unit_id: z.string().describe('Org unit ID'),
  }, async (args) => run(() => org.getOrgUnit(svc(), args.org_unit_id)))

  server.tool('org_unit_create', 'Create an org unit, optionally under a parent with a head (an active member).', {
    name: z.string(),
    kind: z.string().optional().describe('company, division, department, unit (default) or custom'),
    parent_id: z.string().nullable().optional(),
    head_user_id: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  }, async (args) => run(async () => ({ created: true, unit: await org.createOrgUnit(svc(), args) })))

  server.tool('org_unit_update', `Rename, move (parent_id; loops refused), set the head of or describe an org unit. ${UNIT_NOTE}`, {
    org_unit_id: z.string().describe('Org unit ID'),
    name: z.string().optional(),
    kind: z.string().optional(),
    parent_id: z.string().nullable().optional(),
    head_user_id: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    sort: z.number().int().optional(),
  }, async ({ org_unit_id, ...input }) => run(async () => ({ updated: true, unit: await org.updateOrgUnit(svc(), org_unit_id, input) })))

  server.tool('org_unit_delete', `Delete an org unit; its sub-units move up to its parent and its memberships are removed. ${UNIT_NOTE}`, {
    org_unit_id: z.string().describe('Org unit ID'),
  }, async (args) => run(() => org.deleteOrgUnit(svc(), args.org_unit_id)))

  server.tool('org_unit_detach', 'Detach an org unit imported from a directory or CSV: editable here, no longer updated by its source.', {
    org_unit_id: z.string().describe('Org unit ID'),
  }, async (args) => run(() => org.detachOrgUnit(svc(), args.org_unit_id)))

  server.tool('org_unit_members', 'Members of an org unit; recursive adds everyone in the units below (each with via_unit_ids).', {
    org_unit_id: z.string().describe('Org unit ID'),
    recursive: z.boolean().optional(),
  }, async (args) => run(() => org.getOrgUnitMembers(svc(), args.org_unit_id, { recursive: args.recursive === true })))

  server.tool('org_unit_member_add', 'Add a member to an org unit, or update their role / primary flag (one primary unit per person). Idempotent.', {
    org_unit_id: z.string().describe('Org unit ID'),
    user_id: z.string().describe('User ID'),
    role: z.string().nullable().optional(),
    is_primary: z.boolean().optional(),
  }, async (args) => run(() => org.addOrgUnitMember(svc(), args.org_unit_id, args.user_id, { role: args.role, is_primary: args.is_primary })))

  server.tool('org_unit_member_remove', 'Remove a member from an org unit.', {
    org_unit_id: z.string().describe('Org unit ID'),
    user_id: z.string().describe('User ID'),
  }, async (args) => run(() => org.removeOrgUnitMember(svc(), args.org_unit_id, args.user_id)))

  server.tool('org_team_tree', 'The team tree: every team with kind, colour, lead, org unit, member_count, total_member_count (with sub-teams), a member preview and project_ids, plus `roots`.', {}, async () => run(() => org.getTeamTree(svc())))

  server.tool('org_team_members', 'Members of a team; recursive adds everyone in its sub-teams (each with via_team_ids).', {
    team_id: z.string().describe('Team ID'),
    recursive: z.boolean().optional(),
  }, async (args) => run(() => org.getTeamMembers(svc(), args.team_id, { recursive: args.recursive === true })))

  server.tool('org_export', 'Export the org structure as CSV (the import format: email, display_name, manager_email, job_title, department, division, location, employee_id, cost_center, team; one row per active member).', {}, async () => run(() => orgImport.exportOrgCsv(svc())))

  server.tool('org_import', 'Import people attributes, managers, departments (as org units) and teams from CSV. dry_run (default true) returns the per-row plan (create / update / unchanged / error with a diff, units and teams to create, manager loops) without writing; dry_run false applies it, skipping rows with errors. People are matched by email (they must already be members).', {
    csv: z.string().max(5 * 1024 * 1024).describe('CSV text, header row first'),
    mapping: z.record(z.string(), z.string().nullable()).optional().describe('Field → CSV header (null skips the field)'),
    dry_run: z.boolean().optional().describe('Default true'),
  }, async (args) => run(async () => {
    const input = { csv: args.csv, mapping: args.mapping as orgImport.OrgImportMapping | undefined }
    return args.dry_run === false ? orgImport.applyOrgCsvImport(svc(), input) : { dry_run: true, ...(await orgImport.planOrgCsvImport(svc(), input)) }
  }))
}
