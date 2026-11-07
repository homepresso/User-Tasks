import { z } from 'zod'
import type { McpContext, McpToolServer } from '../server'
import { mcpErr, mcpOk } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import * as projects from '@/lib/services/projects'
import { PROJECT_STATUSES } from '@/lib/org/structure'
import { MCP_CORE_TOOL_DESCRIPTIONS } from '../descriptions'
import { messageOf } from './_util'

/*
 * Project tools: thin wrappers over lib/services/projects, which owns
 * permission checks (projects.view / projects.manage; anyone may read the
 * projects they are on), tenant filtering and audit.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const projectId = z.string().describe('Project ID')
const status = z.enum(PROJECT_STATUSES)

const projectFields = {
  key: z.string().nullable().optional().describe('Short unique key, e.g. APOLLO (generated from the name when omitted)'),
  description: z.string().nullable().optional(),
  status: status.optional().describe('active, on_hold, completed or archived'),
  owner_user_id: z.string().nullable().optional(),
  sponsor_user_id: z.string().nullable().optional(),
  team_id: z.string().nullable().optional().describe('Owning team (its members count as project people)'),
  org_unit_id: z.string().nullable().optional(),
  start_date: z.string().nullable().optional().describe('YYYY-MM-DD'),
  end_date: z.string().nullable().optional().describe('YYYY-MM-DD'),
  colour: z.string().nullable().optional().describe('Hex colour like #3366FF'),
}

export function registerProjectTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('projects_list', 'List projects with status, owner, owning team, team_ids, member and people counts (people = direct members plus attached teams\' members). Archived projects are hidden unless include_archived or status asks for them.', {
    status: z.array(status).optional(),
    include_archived: z.boolean().optional(),
    team_id: z.string().optional(),
    org_unit_id: z.string().optional(),
    q: z.string().optional().describe('Name or key contains'),
  }, async (args) => run(() => projects.listProjects(svc(), args)))

  server.tool('projects_mine', 'Projects a person is on (direct member, owner, sponsor or through an attached team). Use user_id "me" (default) for the caller; anyone else needs projects.view.', {
    user_id: z.string().optional().describe('User ID, or "me" (default)'),
    include_archived: z.boolean().optional(),
  }, async (args) => run(() => projects.getMyProjects(svc(), args.user_id ?? 'me', { include_archived: args.include_archived === true })))

  server.tool('projects_get', 'One project with its people (direct members with role / allocation, plus attached teams\' members) and its teams. projects.view, or being on the project.', {
    project_id: projectId,
  }, async (args) => run(async () => ({ project: await projects.getProject(svc(), args.project_id) })))

  server.tool('projects_create', 'Create a project. The owner defaults to the caller.', {
    name: z.string(),
    ...projectFields,
  }, async (args) => run(async () => ({ created: true, project: await projects.createProject(svc(), args) })))

  server.tool('projects_update', 'Update a project\'s name, key, description, status, owner, sponsor, owning team, org unit, dates or colour.', {
    project_id: projectId,
    name: z.string().optional(),
    ...projectFields,
  }, async ({ project_id, ...input }) => run(async () => ({ updated: true, project: await projects.updateProject(svc(), project_id, input) })))

  server.tool('projects_archive', 'Archive a project (archived false restores it to active).', {
    project_id: projectId,
    archived: z.boolean().optional().describe('Default true'),
  }, async (args) => run(async () => ({ project: await projects.archiveProject(svc(), args.project_id, args.archived !== false) })))

  server.tool('projects_delete', 'Delete a project with its memberships and team links. Prefer projects_archive to keep the history.', {
    project_id: projectId,
  }, async (args) => run(() => projects.deleteProject(svc(), args.project_id)))

  server.tool('projects_members', MCP_CORE_TOOL_DESCRIPTIONS.projects_members, {
    project_id: projectId,
    include_teams: z.boolean().optional(),
  }, async (args) => run(() => projects.getProjectMembers(svc(), args.project_id, { includeTeams: args.include_teams !== false })))

  server.tool('projects_member_add', 'Add a member to a project, or update their role (e.g. Lead, Member) / allocation_percent (0–100). Idempotent.', {
    project_id: projectId,
    user_id: z.string().describe('User ID'),
    role: z.string().nullable().optional(),
    allocation_percent: z.number().int().min(0).max(100).nullable().optional(),
  }, async (args) => run(() => projects.addProjectMember(svc(), args.project_id, args.user_id, { role: args.role, allocation_percent: args.allocation_percent })))

  server.tool('projects_member_remove', 'Remove a direct member from a project (people who are on it through a team stay until the team is detached).', {
    project_id: projectId,
    user_id: z.string().describe('User ID'),
  }, async (args) => run(() => projects.removeProjectMember(svc(), args.project_id, args.user_id)))

  server.tool('projects_team_attach', 'Attach a whole team to a project: its members (and its sub-teams\' members) become project people. Idempotent.', {
    project_id: projectId,
    team_id: z.string().describe('Team ID'),
  }, async (args) => run(() => projects.attachProjectTeam(svc(), args.project_id, args.team_id)))

  server.tool('projects_team_detach', 'Detach a team from a project.', {
    project_id: projectId,
    team_id: z.string().describe('Team ID'),
  }, async (args) => run(() => projects.detachProjectTeam(svc(), args.project_id, args.team_id)))
}
