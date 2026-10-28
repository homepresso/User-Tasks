import { z } from 'zod'
import { defineEndpoint } from './registry'
import { csvFilter, idParams, looseObject } from './common'

/**
 * Background jobs: the async variants of slow endpoints (`?async=true` or
 * `Prefer: respond-async` → 202 `{ job }`) and the jobs started in the UI.
 */

export const JOB_STATUS_VALUES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const

export const jobSchema = z.looseObject({
  id: z.string(),
  tenant_id: z.string(),
  user_id: z.string().nullable(),
  kind: z.string().describe('What the job does, e.g. config.export or api.applyconfig'),
  title: z.string(),
  status: z.enum(JOB_STATUS_VALUES),
  progress: z.number().int().describe('0-100'),
  message: z.string().nullable(),
  result: z.looseObject({
    file: z.object({ filename: z.string(), content_type: z.string(), size: z.number().int() }).optional(),
    counts: z.record(z.string(), z.number()).optional(),
    summary: z.string().optional(),
    data: z.any().optional(),
    data_in_file: z.boolean().optional(),
  }).nullable(),
  error: z.string().nullable(),
  attempts: z.number().int(),
  max_attempts: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  expires_at: z.string().nullable().describe('When the result (and the job) is deleted'),
  downloadable: z.boolean().describe('A result file is ready: GET /jobs/{id}/download'),
  cancellable: z.boolean(),
  retryable: z.boolean(),
})

/** 202 body of an async request. */
export const acceptedJobResponse = z.object({ job: jobSchema })

const tags = ['Jobs']
const jobResponse = z.object({ job: jobSchema })

export const listJobsEndpoint = defineEndpoint({
  method: 'GET', path: '/jobs', operationId: 'listJobs', tags,
  summary: 'List background jobs',
  description: 'Jobs started by this credential\'s user (tenant keys: by this key), newest first. scope=tenant lists every job of the workspace (needs settings.edit).',
  permission: null,
  query: z.object({
    status: csvFilter(`Only these statuses: ${JOB_STATUS_VALUES.join(', ')}`),
    active: z.enum(['true', 'false']).optional().describe('true: only queued or running jobs'),
    scope: z.enum(['mine', 'tenant']).optional().describe('mine (default) or tenant (admins)'),
    limit: z.coerce.number().int().min(1).max(200).optional().describe('At most this many (default 50)'),
  }),
  response: z.object({ jobs: z.array(jobSchema) }),
  listKey: 'jobs',
  cli: { resource: 'jobs', verb: 'list' },
})

export const getJobEndpoint = defineEndpoint({
  method: 'GET', path: '/jobs/{id}', operationId: 'getJob', tags,
  summary: 'Get a background job (status, progress, result summary)',
  permission: null, params: idParams, response: jobResponse,
  cli: { resource: 'jobs', verb: 'get', positional: ['id'] },
})

export const cancelJobEndpoint = defineEndpoint({
  method: 'POST', path: '/jobs/{id}/cancel', operationId: 'cancelJob', tags,
  summary: 'Cancel a queued or running job',
  description: 'Queued jobs stop at once; running jobs stop at their next progress report (work already done is kept).',
  permission: null, params: idParams, response: jobResponse,
  cli: { resource: 'jobs', verb: 'cancel', positional: ['id'] },
})

export const retryJobEndpoint = defineEndpoint({
  method: 'POST', path: '/jobs/{id}/retry', operationId: 'retryJob', tags,
  summary: 'Start a failed or cancelled job again',
  description: 'Creates a new job with the same input, checked against the caller\'s current permissions.',
  permission: null, params: idParams, response: jobResponse, successStatus: 202,
  cli: { resource: 'jobs', verb: 'retry', positional: ['id'] },
})

export const getJobResultEndpoint = defineEndpoint({
  method: 'GET', path: '/jobs/{id}/result', operationId: 'getJobResult', tags,
  summary: 'The JSON result of a finished job',
  description: 'For async API requests: exactly the `data` the synchronous request would have returned. 409 while the job is not finished, 410 once expired.',
  permission: null, params: idParams, response: looseObject,
  cli: { resource: 'jobs', verb: 'result', positional: ['id'] },
})

export const downloadJobEndpoint = defineEndpoint({
  method: 'GET', path: '/jobs/{id}/download', operationId: 'downloadJob', tags,
  summary: 'Download the result file of a finished job',
  description: 'The file itself (Content-Disposition: attachment). Owner only; 409 while the job is not finished, 410 once expired. CLI: `usertasks jobs download <id>`.',
  permission: null, params: idParams, envelope: false, download: true,
})

export const jobEndpoints = [listJobsEndpoint, getJobEndpoint, cancelJobEndpoint, retryJobEndpoint, getJobResultEndpoint, downloadJobEndpoint]
