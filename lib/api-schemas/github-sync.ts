import { z } from 'zod'
import { defineEndpoint } from './registry'
import { idParams, itemResponse, listResponse, looseObject, paginationQuery } from './common'

// The GitHub sync routes normalise their bodies by hand (lib/github-sync/*);
// these schemas describe the accepted fields loosely.
export const githubSyncScopeSchema = z.looseObject({
  asset_types: z.array(z.string()).optional().describe('Manifest sections to sync in full'),
  assets: z.array(z.looseObject({ section: z.string(), id: z.string(), name: z.string().optional() })).optional(),
})

export const githubSyncRunBody = z.looseObject({
  kind: z.enum(['full_resync', 'commit', 'template']).optional().describe('Default full_resync'),
  scope: githubSyncScopeSchema.optional(),
  message: z.string().optional(),
})

export const githubSyncCommitBody = z.looseObject({ message: z.string().optional() })

export const githubSyncDeployBody = z.looseObject({
  dry_run: z.boolean().optional(),
  commit_sha: z.string().optional(),
  ref: z.string().optional().describe('Branch or ref to resolve when commit_sha is omitted'),
})

export const githubSyncScheduleBody = z.looseObject({
  schedule: looseObject.optional().describe('Schedule config (schedule_mode hourly|daily|weekly, time_of_day, day_of_week, minute_of_hour, timezone); may also be sent at the top level'),
})

const tags = ['GitHub sync']

export const githubSyncEndpoints = [
  defineEndpoint({
    method: 'GET', path: '/github-sync/status', operationId: 'getGitHubSyncStatus', tags,
    summary: 'Connection status, pending changes and latest run/deployment', permission: 'sync.view',
    response: z.looseObject({ connected: z.boolean(), pending_changes: z.number().int() }),
    cli: { resource: 'github-sync', verb: 'status' },
  }),
  defineEndpoint({
    method: 'POST', path: '/github-sync/commit', operationId: 'commitGitHubSync', tags,
    summary: 'Commit pending changes to the repository', permission: 'sync.manage',
    body: githubSyncCommitBody,
    response: z.looseObject({ committed: z.boolean() }),
    cli: { resource: 'github-sync', verb: 'commit' },
  }),
  defineEndpoint({
    method: 'GET', path: '/github-sync/runs', operationId: 'listGitHubSyncRuns', tags,
    summary: 'List sync runs', permission: 'sync.view',
    query: paginationQuery.extend({ status: z.string().optional(), kind: z.string().optional() }),
    response: listResponse('runs'), listKey: 'runs',
    cli: { resource: 'github-sync', verb: 'runs' },
  }),
  defineEndpoint({
    method: 'POST', path: '/github-sync/runs', operationId: 'startGitHubSyncRun', tags,
    summary: 'Enqueue a full, pending-change or scoped sync', permission: 'sync.manage',
    body: githubSyncRunBody, successStatus: 202,
    response: z.looseObject({ run: looseObject, status_url: z.string() }),
    cli: { resource: 'github-sync', verb: 'sync' },
  }),
  defineEndpoint({
    method: 'GET', path: '/github-sync/runs/{id}', operationId: 'getGitHubSyncRun', tags,
    summary: 'Get a sync run', permission: 'sync.view',
    params: idParams, response: itemResponse('run'),
    cli: { resource: 'github-sync', verb: 'run', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'POST', path: '/github-sync/deploy', operationId: 'deployGitHubSync', tags,
    summary: 'Deploy the repository manifest into this workspace', permission: 'sync.deploy',
    body: githubSyncDeployBody, successStatus: 202,
    response: z.looseObject({ deployment_id: z.string(), status: z.string(), status_url: z.string() }),
    cli: { resource: 'github-sync', verb: 'deploy' },
  }),
  defineEndpoint({
    method: 'GET', path: '/github-sync/deployments', operationId: 'listGitHubSyncDeployments', tags,
    summary: 'List deployments', permission: 'sync.view',
    query: paginationQuery,
    response: listResponse('deployments'), listKey: 'deployments',
    cli: { resource: 'github-sync', verb: 'deployments' },
  }),
  defineEndpoint({
    method: 'GET', path: '/github-sync/deployments/{id}', operationId: 'getGitHubSyncDeployment', tags,
    summary: 'Get a deployment', permission: 'sync.view',
    params: idParams, response: itemResponse('deployment'),
    cli: { resource: 'github-sync', verb: 'deployment', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'GET', path: '/github-sync/schedule', operationId: 'getGitHubSyncSchedule', tags,
    summary: 'Get the scheduled sync configuration', permission: 'sync.view',
    response: z.looseObject({ schedule: z.any() }),
    cli: { resource: 'github-sync', verb: 'schedule' },
  }),
  defineEndpoint({
    method: 'PUT', path: '/github-sync/schedule', operationId: 'setGitHubSyncSchedule', tags,
    summary: 'Set the scheduled sync configuration', permission: 'sync.manage',
    body: githubSyncScheduleBody,
    response: z.looseObject({ schedule: looseObject }),
    cli: { resource: 'github-sync', verb: 'set-schedule' },
  }),
  defineEndpoint({
    method: 'DELETE', path: '/github-sync/schedule', operationId: 'deleteGitHubSyncSchedule', tags,
    summary: 'Disable scheduled sync', permission: 'sync.manage',
    response: z.looseObject({ schedule: z.null(), disabled: z.literal(true) }),
    cli: { resource: 'github-sync', verb: 'unschedule' },
  }),
]
