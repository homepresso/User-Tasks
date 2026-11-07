import { z } from 'zod'
import { defineEndpoint } from './registry'
import { booleanFlag, csvFilter, deletedResponse, idParams, itemResponse, listResponse, looseObject } from './common'

/*
 * Organization structure (/org/*) and projects (/projects/*): the org chart
 * from reporting lines and people attributes, org units, the team tree,
 * people scopes ("who is in X") and the CSV import / export. Services:
 * lib/services/org.ts, lib/services/projects.ts, lib/services/org-import.ts.
 */

const orgTags = ['Organization']
const projectTags = ['Projects']

const personIdParams = z.object({ id: z.string().min(1).describe('User id, or `me` for the caller') })
const unitMemberParams = z.object({ id: z.string().describe('Org unit id'), userId: z.string().describe('User id') })
const projectMemberParams = z.object({ id: z.string().describe('Project id'), userId: z.string().describe('User id') })
const projectTeamParams = z.object({ id: z.string().describe('Project id'), teamId: z.string().describe('Team id') })

const person = z.looseObject({
  id: z.string(), display_name: z.string().nullable(), email: z.string().nullable(), avatar_url: z.string().nullable(),
  job_title: z.string().nullable(), department: z.string().nullable(), location: z.string().nullable(),
})

const SELF_NOTE = 'Your own (`me`) needs no permission; anyone else needs org.view (or team.view_members).'
const DIRECTORY_NOTE = 'Attributes the directory owns (profile_source `directory`) are refused with 409 until detached (POST /org/people/{id}/detach); directory sync then stops updating them.'
const UNIT_SOURCE_NOTE = 'Units imported from a directory or CSV (source ≠ manual) are read-only (409) until detached.'

const nullableText = (max: number, description: string) => z.string().max(max).nullable().optional().describe(description)
const hexColour = z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional().describe('Hex colour like #3366FF')
const isoDate = (description: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe(description)

/* ── People ── */

export const personUpdateBody = z.object({
  job_title: nullableText(200, 'Job title'),
  department: nullableText(200, 'Department'),
  location: nullableText(200, 'Office / location'),
  employee_id: nullableText(100, 'Employee id / number'),
  cost_center: nullableText(100, 'Cost centre'),
  manager_user_id: z.string().nullable().optional().describe('Manager (null clears it). Needs org.manage or team.change_roles; loops and non-members are refused'),
})

export const getOrgChartEndpoint = defineEndpoint({
  method: 'GET', path: '/org/chart', operationId: 'getOrgChart', tags: orgTags,
  summary: 'The org chart: every active member with manager, attributes and report counts',
  description: '`roots` are the people at the top (no manager here), biggest organisation first. `total_reports` counts every level below a person.',
  permission: 'org.view',
  response: z.looseObject({
    people: z.array(person.extend({ manager_user_id: z.string().nullable(), direct_reports: z.number().int(), total_reports: z.number().int() })),
    roots: z.array(z.string()), total: z.number().int(),
  }),
  listKey: 'people',
  cli: { resource: 'org', verb: 'chart' },
})

export const getOrgPersonEndpoint = defineEndpoint({
  method: 'GET', path: '/org/people/{id}', operationId: 'getOrgPerson', tags: orgTags,
  summary: 'One person in context: attributes, manager chain, direct reports, peers, teams, org units and projects',
  description: `${SELF_NOTE} Projects are included for yourself or with projects.view (null otherwise).`,
  permission: null, params: personIdParams, response: person,
  cli: { resource: 'org', verb: 'person', positional: ['id'] },
})

export const updateOrgPersonEndpoint = defineEndpoint({
  method: 'PATCH', path: '/org/people/{id}', operationId: 'updateOrgPerson', tags: orgTags,
  summary: 'Edit a member\'s job title, department, location, employee id, cost centre and/or manager',
  description: `Attributes need org.manage. ${DIRECTORY_NOTE}`,
  permission: null, params: personIdParams, body: personUpdateBody, response: person,
  roundTrip: {},
  cli: { resource: 'org', verb: 'update-person', positional: ['id'] },
})

export const detachOrgPersonEndpoint = defineEndpoint({
  method: 'POST', path: '/org/people/{id}/detach', operationId: 'detachOrgPerson', tags: orgTags,
  summary: 'Detach a member\'s attributes from the directory (editable here; sync stops updating them)',
  permission: 'org.manage', params: personIdParams,
  response: z.looseObject({ detached: z.boolean(), user_id: z.string() }),
  cli: { resource: 'org', verb: 'detach-person', positional: ['id'] },
})

export const listOrgSubordinatesEndpoint = defineEndpoint({
  method: 'GET', path: '/org/people/{id}/subordinates', operationId: 'listOrgSubordinates', tags: orgTags,
  summary: 'People who report to a member: direct, or every level (depth=all, up to 10 levels)',
  description: SELF_NOTE, permission: null, params: personIdParams,
  query: z.object({
    depth: z.enum(['direct', 'all']).optional().describe('direct (default) or all levels'),
    include_self: booleanFlag('Include the person first (depth 0)'),
  }),
  response: z.looseObject({ user_id: z.string(), people: z.array(person.extend({ depth: z.number().int(), manager_user_id: z.string().nullable() })), total: z.number().int() }),
  listKey: 'people',
  cli: { resource: 'org', verb: 'reports', positional: ['id'] },
})

export const getOrgManagerChainEndpoint = defineEndpoint({
  method: 'GET', path: '/org/people/{id}/manager-chain', operationId: 'getOrgManagerChain', tags: orgTags,
  summary: 'A member\'s managers, nearest first', description: SELF_NOTE, permission: null, params: personIdParams,
  response: z.looseObject({ user_id: z.string(), chain: z.array(person) }), listKey: 'chain',
  cli: { resource: 'org', verb: 'manager-chain', positional: ['id'] },
})

export const listOrgPeersEndpoint = defineEndpoint({
  method: 'GET', path: '/org/people/{id}/peers', operationId: 'listOrgPeers', tags: orgTags,
  summary: 'Others with the same manager', description: SELF_NOTE, permission: null, params: personIdParams,
  response: z.looseObject({ user_id: z.string(), manager_user_id: z.string().nullable(), peers: z.array(person) }), listKey: 'peers',
  cli: { resource: 'org', verb: 'peers', positional: ['id'] },
})

export const listOrgPersonTeamsEndpoint = defineEndpoint({
  method: 'GET', path: '/org/people/{id}/teams', operationId: 'listOrgPersonTeams', tags: orgTags,
  summary: 'Teams a member is in, with the teams above them', description: SELF_NOTE, permission: null, params: personIdParams,
  response: z.looseObject({ user_id: z.string(), teams: z.array(looseObject) }), listKey: 'teams',
  cli: { resource: 'org', verb: 'teams', positional: ['id'] },
})

export const listOrgPersonProjectsEndpoint = defineEndpoint({
  method: 'GET', path: '/org/people/{id}/projects', operationId: 'listOrgPersonProjects', tags: orgTags,
  summary: 'Projects a member is on (member, owner, sponsor or through a team)',
  description: 'Your own needs no permission; anyone else needs projects.view. Archived projects only with include_archived=true.',
  permission: null, params: personIdParams,
  query: z.object({ include_archived: booleanFlag('Include archived projects') }),
  response: z.looseObject({ user_id: z.string(), projects: z.array(looseObject) }), listKey: 'projects',
  cli: { resource: 'org', verb: 'projects', positional: ['id'] },
})

export const resolveOrgScopeEndpoint = defineEndpoint({
  method: 'GET', path: '/org/scope', operationId: 'resolveOrgScope', tags: orgTags,
  summary: 'The people a scope covers: me, my direct / all reports, a team, an org unit or a project',
  description: 'me, direct_reports and all_reports are the caller\'s own (no permission). team needs team.view_members or org.view unless you are in it; org_unit needs org.view unless you are in it; project needs projects.view unless you are on it. `id` names the team / org unit / project.',
  permission: null,
  query: z.object({
    scope: z.enum(['me', 'direct_reports', 'all_reports', 'team', 'org_unit', 'project']).describe('Which people'),
    id: z.string().optional().describe('Team, org unit or project id (scope team / org_unit / project)'),
    recursive: booleanFlag('team / org_unit: include sub-teams / sub-units'),
    include_self: booleanFlag('direct_reports / all_reports: include the caller'),
    include_teams: booleanFlag('project: include attached teams\' members (default true)'),
  }),
  response: z.looseObject({ scope: looseObject, user_ids: z.array(z.string()), people: z.array(person), total: z.number().int() }),
  listKey: 'people',
  cli: { resource: 'org', verb: 'scope' },
})

/* ── Org units ── */

export const orgUnitCreateBody = z.object({
  name: z.string().min(1).max(200),
  kind: z.string().max(50).nullable().optional().describe('company, division, department, unit (default) or any custom kind'),
  parent_id: z.string().nullable().optional().describe('Parent org unit id (loops are refused)'),
  head_user_id: z.string().nullable().optional().describe('Head of the unit (an active member)'),
  description: z.string().max(2000).nullable().optional(),
  sort: z.number().int().nullable().optional().describe('Order among siblings (then name)'),
})

export const orgUnitUpdateBody = orgUnitCreateBody.partial()

export const orgUnitMemberBody = z.object({
  role: z.string().max(100).nullable().optional().describe('Role in the unit, e.g. "Deputy"'),
  is_primary: z.boolean().optional().describe('Make this the person\'s primary unit (one per person)'),
})

export const listOrgUnitsEndpoint = defineEndpoint({
  method: 'GET', path: '/org/units', operationId: 'listOrgUnits', tags: orgTags,
  summary: 'Every org unit with head, depth, children and headcounts',
  description: '`member_count` counts the unit\'s own members, `headcount` distinct members of the unit and every unit below. `roots` lists the top-level units in order.',
  permission: 'org.view', response: listResponse('units').extend({ roots: z.array(z.string()) }), listKey: 'units',
  cli: { resource: 'org-units', verb: 'list' },
})

export const createOrgUnitEndpoint = defineEndpoint({
  method: 'POST', path: '/org/units', operationId: 'createOrgUnit', tags: orgTags,
  summary: 'Create an org unit', permission: 'org.manage',
  body: orgUnitCreateBody, successStatus: 201, response: itemResponse('unit'),
  cli: { resource: 'org-units', verb: 'create' },
})

export const getOrgUnitEndpoint = defineEndpoint({
  method: 'GET', path: '/org/units/{id}', operationId: 'getOrgUnit', tags: orgTags,
  summary: 'An org unit with its path, children, members, teams and projects', permission: 'org.view',
  params: idParams, response: looseObject,
  cli: { resource: 'org-units', verb: 'get', positional: ['id'] },
})

export const updateOrgUnitEndpoint = defineEndpoint({
  method: 'PATCH', path: '/org/units/{id}', operationId: 'updateOrgUnit', tags: orgTags,
  summary: 'Rename, move (parent_id), set the head of or describe an org unit', description: UNIT_SOURCE_NOTE, permission: 'org.manage',
  params: idParams, body: orgUnitUpdateBody, response: itemResponse('unit'),
  roundTrip: { unwrap: 'unit' },
  cli: { resource: 'org-units', verb: 'update', positional: ['id'] },
})

export const deleteOrgUnitEndpoint = defineEndpoint({
  method: 'DELETE', path: '/org/units/{id}', operationId: 'deleteOrgUnit', tags: orgTags,
  summary: 'Delete an org unit (its sub-units move up to its parent)', description: UNIT_SOURCE_NOTE, permission: 'org.manage',
  params: idParams, response: deletedResponse,
  cli: { resource: 'org-units', verb: 'delete', positional: ['id'] },
})

export const detachOrgUnitEndpoint = defineEndpoint({
  method: 'POST', path: '/org/units/{id}/detach', operationId: 'detachOrgUnit', tags: orgTags,
  summary: 'Detach an imported org unit (editable here; its source stops updating it)', permission: 'org.manage',
  params: idParams, response: looseObject,
  cli: { resource: 'org-units', verb: 'detach', positional: ['id'] },
})

export const listOrgUnitMembersEndpoint = defineEndpoint({
  method: 'GET', path: '/org/units/{id}/members', operationId: 'listOrgUnitMembers', tags: orgTags,
  summary: 'Members of an org unit (recursive=true adds everyone in the units below)', permission: 'org.view',
  params: idParams, query: z.object({ recursive: booleanFlag('Include members of every unit below') }),
  response: listResponse('members', person), listKey: 'members',
  cli: { resource: 'org-units', verb: 'members', positional: ['id'] },
})

export const addOrgUnitMemberEndpoint = defineEndpoint({
  method: 'PUT', path: '/org/units/{id}/members/{userId}', operationId: 'addOrgUnitMember', tags: orgTags,
  summary: 'Add a member to an org unit, or update their role / primary flag (idempotent)', permission: 'org.manage',
  params: unitMemberParams, body: orgUnitMemberBody,
  response: z.looseObject({ added: z.literal(true), already_member: z.boolean() }),
  cli: { resource: 'org-units', verb: 'add-member', positional: ['id', 'userId'] },
})

export const removeOrgUnitMemberEndpoint = defineEndpoint({
  method: 'DELETE', path: '/org/units/{id}/members/{userId}', operationId: 'removeOrgUnitMember', tags: orgTags,
  summary: 'Remove a member from an org unit', permission: 'org.manage',
  params: unitMemberParams, response: z.looseObject({ removed: z.boolean() }),
  cli: { resource: 'org-units', verb: 'remove-member', positional: ['id', 'userId'] },
})

/* ── Team tree ── */

export const getOrgTeamTreeEndpoint = defineEndpoint({
  method: 'GET', path: '/org/teams', operationId: 'getOrgTeamTree', tags: orgTags,
  summary: 'The team tree: every team with lead, org unit, member counts, a member preview and projects',
  description: 'Needs team.view_members or org.view. `total_member_count` includes sub-teams; `project_ids` needs projects.view.',
  permission: null, response: listResponse('teams').extend({ roots: z.array(z.string()) }), listKey: 'teams',
  cli: { resource: 'org', verb: 'team-tree' },
})

export const listOrgTeamMembersEndpoint = defineEndpoint({
  method: 'GET', path: '/org/teams/{id}/members', operationId: 'listOrgTeamMembers', tags: orgTags,
  summary: 'Members of a team (recursive=true adds everyone in its sub-teams)', description: 'Needs team.view_members or org.view.',
  permission: null, params: idParams, query: z.object({ recursive: booleanFlag('Include members of every sub-team') }),
  response: listResponse('members', person), listKey: 'members',
  cli: { resource: 'org', verb: 'team-members', positional: ['id'] },
})

/* ── Import / export ── */

/** Largest CSV accepted by the import (characters). */
export const ORG_IMPORT_MAX_CSV = 5 * 1024 * 1024

const IMPORT_COLUMNS_NOTE = 'Columns: email (required: matches an existing member), display_name, manager_email, job_title, department, division, location, employee_id, cost_center, team. Headers are matched by name; `mapping` maps a field to a different header (or null to skip it).'

export const orgImportBody = z.object({
  csv: z.string().min(1).max(ORG_IMPORT_MAX_CSV).describe('The CSV text (UTF-8, header row first; max 5 MB)'),
  mapping: z.record(z.string(), z.string().nullable()).optional().describe('Field → CSV header (null skips the field)'),
  dry_run: z.boolean().optional().describe('true (default): return the plan without writing; false: apply it'),
})

export const exportOrgEndpoint = defineEndpoint({
  method: 'GET', path: '/org/export', operationId: 'exportOrg', tags: orgTags,
  summary: 'The org structure as CSV (the import format, one row per active member)',
  description: 'Returns `{ csv, filename, rows }`; with format=csv the file itself (text/csv attachment).',
  permission: 'org.view',
  query: z.object({ format: z.enum(['json', 'csv']).optional().describe('json (default) or csv (the file)') }),
  response: z.looseObject({ csv: z.string(), filename: z.string(), rows: z.number().int() }),
  cli: { resource: 'org', verb: 'export' },
})

export const getOrgImportTemplateEndpoint = defineEndpoint({
  method: 'GET', path: '/org/import/template', operationId: 'getOrgImportTemplate', tags: orgTags,
  summary: 'The CSV import template', description: `${IMPORT_COLUMNS_NOTE} With format=csv the file itself.`,
  permission: null,
  query: z.object({ format: z.enum(['json', 'csv']).optional().describe('json (default) or csv (the file)') }),
  response: z.looseObject({ csv: z.string(), filename: z.string() }),
  cli: { resource: 'org', verb: 'import-template' },
})

export const importOrgEndpoint = defineEndpoint({
  method: 'POST', path: '/org/import', operationId: 'importOrg', tags: orgTags,
  summary: 'Import people attributes, managers, departments and teams from CSV (dry run by default)',
  description: `${IMPORT_COLUMNS_NOTE} The dry run returns per-row create / update / unchanged / error with a diff, the org units and teams it would create and any manager loops. Applying skips rows with errors. Departments (under their division) become org units with source csv.`,
  permission: 'org.manage', body: orgImportBody, response: looseObject,
  cli: { resource: 'org', verb: 'import' },
})

/* ── Projects ── */

const PROJECT_STATUS = ['active', 'on_hold', 'completed', 'archived'] as const

export const projectCreateBody = z.object({
  name: z.string().min(1).max(200),
  key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/).nullable().optional().describe('Short unique key, e.g. APOLLO (generated from the name when omitted)'),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(PROJECT_STATUS).optional().describe('active (default), on_hold, completed or archived'),
  owner_user_id: z.string().nullable().optional().describe('Owner (default: the caller)'),
  sponsor_user_id: z.string().nullable().optional(),
  team_id: z.string().nullable().optional().describe('Owning team (its members count as project people)'),
  org_unit_id: z.string().nullable().optional(),
  start_date: isoDate('Start date (YYYY-MM-DD)'),
  end_date: isoDate('End date (YYYY-MM-DD, on or after the start)'),
  colour: hexColour,
})

export const projectUpdateBody = projectCreateBody.partial()

export const projectMemberBody = z.object({
  role: z.string().max(100).nullable().optional().describe('Role on the project, e.g. Lead, Member (default Member)'),
  allocation_percent: z.number().int().min(0).max(100).nullable().optional().describe('Share of their time (0–100)'),
})

export const projectArchiveBody = z.object({
  archived: z.boolean().optional().describe('true (default) archives, false restores (status active)'),
})

export const listProjectsEndpoint = defineEndpoint({
  method: 'GET', path: '/projects', operationId: 'listProjects', tags: projectTags,
  summary: 'List projects with owner, team, counts and a member preview (archived hidden by default)', permission: 'projects.view',
  query: z.object({
    status: csvFilter('active, on_hold, completed, archived'),
    include_archived: booleanFlag('Include archived projects'),
    team_id: z.string().optional().describe('Projects the team is attached to (or owns)'),
    org_unit_id: z.string().optional(),
    q: z.string().optional().describe('Name or key contains'),
  }),
  response: listResponse('projects'), listKey: 'projects',
  cli: { resource: 'projects', verb: 'list' },
})

export const createProjectEndpoint = defineEndpoint({
  method: 'POST', path: '/projects', operationId: 'createProject', tags: projectTags,
  summary: 'Create a project', permission: 'projects.manage',
  body: projectCreateBody, successStatus: 201, response: itemResponse('project'),
  cli: { resource: 'projects', verb: 'create' },
})

export const getProjectEndpoint = defineEndpoint({
  method: 'GET', path: '/projects/{id}', operationId: 'getProject', tags: projectTags,
  summary: 'A project with its people (direct members and attached teams\' members) and teams',
  description: 'projects.view, or being on the project (member, owner, sponsor or through a team).',
  permission: null, params: idParams, response: itemResponse('project'),
  cli: { resource: 'projects', verb: 'get', positional: ['id'] },
})

export const updateProjectEndpoint = defineEndpoint({
  method: 'PATCH', path: '/projects/{id}', operationId: 'updateProject', tags: projectTags,
  summary: 'Update a project', permission: 'projects.manage',
  params: idParams, body: projectUpdateBody, response: itemResponse('project'),
  roundTrip: { unwrap: 'project' },
  cli: { resource: 'projects', verb: 'update', positional: ['id'] },
})

export const deleteProjectEndpoint = defineEndpoint({
  method: 'DELETE', path: '/projects/{id}', operationId: 'deleteProject', tags: projectTags,
  summary: 'Delete a project with its memberships (archive it to keep the history)', permission: 'projects.manage',
  params: idParams, response: deletedResponse,
  cli: { resource: 'projects', verb: 'delete', positional: ['id'] },
})

export const archiveProjectEndpoint = defineEndpoint({
  method: 'POST', path: '/projects/{id}/archive', operationId: 'archiveProject', tags: projectTags,
  summary: 'Archive (or restore with archived=false) a project', permission: 'projects.manage',
  params: idParams, body: projectArchiveBody, response: itemResponse('project'),
  cli: { resource: 'projects', verb: 'archive', positional: ['id'] },
})

export const listProjectMembersEndpoint = defineEndpoint({
  method: 'GET', path: '/projects/{id}/members', operationId: 'listProjectMembers', tags: projectTags,
  summary: 'A project\'s people: direct members and (include_teams, default true) attached teams\' members',
  description: 'projects.view, or being on the project.',
  permission: null, params: idParams, query: z.object({ include_teams: booleanFlag('Include attached teams\' members (default true)') }),
  response: listResponse('members', person), listKey: 'members',
  cli: { resource: 'projects', verb: 'members', positional: ['id'] },
})

export const addProjectMemberEndpoint = defineEndpoint({
  method: 'PUT', path: '/projects/{id}/members/{userId}', operationId: 'addProjectMember', tags: projectTags,
  summary: 'Add a member to a project, or update their role / allocation (idempotent)', permission: 'projects.manage',
  params: projectMemberParams, body: projectMemberBody,
  response: z.looseObject({ added: z.literal(true), already_member: z.boolean() }),
  cli: { resource: 'projects', verb: 'add-member', positional: ['id', 'userId'] },
})

export const removeProjectMemberEndpoint = defineEndpoint({
  method: 'DELETE', path: '/projects/{id}/members/{userId}', operationId: 'removeProjectMember', tags: projectTags,
  summary: 'Remove a member from a project', permission: 'projects.manage',
  params: projectMemberParams, response: z.looseObject({ removed: z.boolean() }),
  cli: { resource: 'projects', verb: 'remove-member', positional: ['id', 'userId'] },
})

export const attachProjectTeamEndpoint = defineEndpoint({
  method: 'PUT', path: '/projects/{id}/teams/{teamId}', operationId: 'attachProjectTeam', tags: projectTags,
  summary: 'Attach a whole team to a project (its members and sub-teams\' members join; idempotent)', permission: 'projects.manage',
  params: projectTeamParams, response: z.looseObject({ attached: z.literal(true), already_attached: z.boolean() }),
  cli: { resource: 'projects', verb: 'attach-team', positional: ['id', 'teamId'] },
})

export const detachProjectTeamEndpoint = defineEndpoint({
  method: 'DELETE', path: '/projects/{id}/teams/{teamId}', operationId: 'detachProjectTeam', tags: projectTags,
  summary: 'Detach a team from a project', permission: 'projects.manage',
  params: projectTeamParams, response: z.looseObject({ detached: z.boolean() }),
  cli: { resource: 'projects', verb: 'detach-team', positional: ['id', 'teamId'] },
})

export const orgEndpoints = [
  getOrgChartEndpoint, getOrgPersonEndpoint, updateOrgPersonEndpoint, detachOrgPersonEndpoint,
  listOrgSubordinatesEndpoint, getOrgManagerChainEndpoint, listOrgPeersEndpoint, listOrgPersonTeamsEndpoint, listOrgPersonProjectsEndpoint,
  resolveOrgScopeEndpoint,
  listOrgUnitsEndpoint, createOrgUnitEndpoint, getOrgUnitEndpoint, updateOrgUnitEndpoint, deleteOrgUnitEndpoint, detachOrgUnitEndpoint,
  listOrgUnitMembersEndpoint, addOrgUnitMemberEndpoint, removeOrgUnitMemberEndpoint,
  getOrgTeamTreeEndpoint, listOrgTeamMembersEndpoint,
  exportOrgEndpoint, getOrgImportTemplateEndpoint, importOrgEndpoint,
]

export const projectEndpoints = [
  listProjectsEndpoint, createProjectEndpoint, getProjectEndpoint, updateProjectEndpoint, deleteProjectEndpoint, archiveProjectEndpoint,
  listProjectMembersEndpoint, addProjectMemberEndpoint, removeProjectMemberEndpoint, attachProjectTeamEndpoint, detachProjectTeamEndpoint,
]
