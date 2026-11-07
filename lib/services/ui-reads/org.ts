import { z } from 'zod'
import { defineRead, id, NO_ARGS, type UiRead } from './define'

/* eslint-disable @typescript-eslint/no-explicit-any -- registry typing */

/**
 * Organization page (/org, /org/projects/[id], /org/manage): the org chart,
 * a person in context, org units, the team tree and projects. Each read runs
 * the org / projects service (lib/services/org.ts, projects.ts), which checks
 * permissions itself and filters by the caller's workspace explicitly.
 */
export const reads = {
  /** People view: every active member with manager, attributes and report counts. */
  'org.chart': defineRead({
    args: NO_ARGS,
    perm: 'org.view',
    run: async (ctx) => (await import('../org')).getOrgChart(ctx),
  }),

  /** Person side sheet: chain, reports, peers, teams, units, projects (own: anyone). */
  'org.person': defineRead({
    args: z.object({ userId: id }),
    run: async (ctx, { userId }) => (await import('../org')).getPerson(ctx, userId),
  }),

  /** Org units view: every unit with head, children and headcounts. */
  'org.units': defineRead({
    args: NO_ARGS,
    perm: 'org.view',
    run: async (ctx) => (await import('../org')).getOrgUnitTree(ctx),
  }),

  /** Org unit side sheet: path, children, members, teams, projects. */
  'org.unit': defineRead({
    args: z.object({ unitId: id }),
    perm: 'org.view',
    run: async (ctx, { unitId }) => (await import('../org')).getOrgUnit(ctx, unitId),
  }),

  /** Teams view: the team tree with leads, counts and member previews. */
  'org.teams': defineRead({
    args: NO_ARGS,
    perm: ['team.view_members', 'org.view'],
    run: async (ctx) => (await import('../org')).getTeamTree(ctx),
  }),

  /** Projects view: projects with owner, teams, counts and previews. */
  'org.projects': defineRead({
    args: z.object({ includeArchived: z.boolean().optional() }).optional(),
    perm: 'projects.view',
    run: async (ctx, args) => (await import('../projects')).listProjects(ctx, { include_archived: args?.includeArchived === true }),
  }),

  /** Project page: the project with its people and teams (projects.view, or on the project). */
  'org.project': defineRead({
    args: z.object({ projectId: id }),
    run: async (ctx, { projectId }) => (await import('../projects')).getProject(ctx, projectId),
  }),

  /** The signed-in user's projects. */
  'org.myProjects': defineRead({
    args: NO_ARGS,
    run: async (ctx) => (await import('../projects')).getMyProjects(ctx, 'me'),
  }),
} satisfies Record<string, UiRead<any, any>>
