import { z } from 'zod'
import type { EndpointDef } from '@/lib/api-schemas/registry'
import { exportConfigEndpoint, applyConfigEndpoint } from '@/lib/api-schemas/config'
import { bulkDeleteRowsEndpoint } from '@/lib/api-schemas/data-tables'
import { bulkDeleteReferencesEndpoint } from '@/lib/api-schemas/integrations'
import { migrateWorkflowInstancesEndpoint } from '@/lib/api-schemas/workflows'
import { buildPackageVersionEndpoint, installPackageEndpoint, upgradePackageInstallEndpoint, uninstallPackageEndpoint } from '@/lib/api-schemas/packages'
import { requirePerm, ServiceError, type ServiceContext } from '@/lib/services/context'
import { applyConfig, exportConfig } from '@/lib/services/config'
import { deleteRows } from '@/lib/services/data-tables'
import { bulkDeleteReferences } from '@/lib/services/references'
import { migrateInstances } from '@/lib/services/workflow-runs'
import { buildPackageVersion } from '@/lib/services/packages'
import { installPackage, uninstallPackage, upgradePackageInstall } from '@/lib/services/package-installs'
import { defineJobKind, type JobKind } from '../define'

/*
 * Async variants of slow /api/v1 endpoints (`?async=true` or
 * `Prefer: respond-async` → 202 with a job; lib/api/route.ts). The handler
 * here is THE handler of the endpoint: the route runs it inline by default,
 * the job (`api.<operationId>`) runs it later with the caller's re-checked
 * credential and stores its response `data` as the job result
 * (GET /api/v1/jobs/{id}/result).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- endpoint inputs are validated by their own schemas */

export interface ApiHandlerInput { ctx: ServiceContext; params: any; query: any; body: any }
export type ApiHandler = (input: ApiHandlerInput) => Promise<unknown>

const csv = (value: string | undefined) => value?.split(',').map((item) => item.trim()).filter(Boolean)

export const exportConfigHandler: ApiHandler = ({ ctx, query }) => exportConfig(ctx, {
  types: csv(query.types), ids: csv(query.ids), format: query.format,
  include_rows: query.include_rows === 'true', with_dependencies: query.with_dependencies === 'true',
})
export const applyConfigHandler: ApiHandler = ({ ctx, body }) => applyConfig(ctx, body)
export const bulkDeleteRowsHandler: ApiHandler = ({ ctx, params, body }) => deleteRows(ctx, params.id, body.row_ids)
export const bulkDeleteReferencesHandler: ApiHandler = ({ ctx, body }) => bulkDeleteReferences(ctx, body.ids)
export const migrateInstancesHandler: ApiHandler = ({ ctx, params, body }) => migrateInstances(ctx, {
  workflowId: params.id,
  toVersionId: body.to_version_id,
  runIds: body.run_ids ?? null,
  fromVersionId: body.from_version_id ?? null,
  allActive: body.all_active ?? false,
  nodeMap: body.node_map ?? null,
  defaultTargetNodeId: body.default_target_node_id ?? null,
  dryRun: body.dry_run,
})
export const buildPackageVersionHandler: ApiHandler = ({ ctx, params, body }) => buildPackageVersion(ctx, params.id, body)
export const installPackageHandler: ApiHandler = ({ ctx, body }) => installPackage(ctx, { source: 'api', ...body })
export const upgradePackageInstallHandler: ApiHandler = ({ ctx, params, body }) => upgradePackageInstall(ctx, params.id, { source: 'api', ...body })
export const uninstallPackageHandler: ApiHandler = ({ ctx, params, body }) => uninstallPackage(ctx, params.id, body)

/** Request bodies above this are stored as the job's input instead of in params. */
export const INLINE_BODY_BYTES = 64 * 1024

const apiParams = z.object({
  params: z.unknown().optional(),
  query: z.unknown().optional(),
  body: z.unknown().optional(),
  /** The body is the job input (large requests). */
  body_in_input: z.boolean().optional(),
})
export type ApiJobParams = z.infer<typeof apiParams>

export const apiJobKind = (operationId: string) => `api.${operationId.replace(/[^A-Za-z0-9]/g, '').toLowerCase()}`

function parse(schema: z.ZodType | undefined, value: unknown, where: string): unknown {
  if (!schema) return {}
  const parsed = schema.safeParse(value ?? {})
  if (!parsed.success) throw ServiceError.validation(`Validation failed: ${parsed.error.issues.map((i) => `${[where, ...i.path].join('.')}: ${i.message}`).join(', ')}`)
  return parsed.data
}

function defineApiJob(endpoint: EndpointDef, handler: ApiHandler): JobKind<ApiJobParams> {
  return defineJobKind({
    kind: apiJobKind(endpoint.operationId),
    effect: 'result',
    input: { maxBytes: 60 * 1024 * 1024 },
    params: apiParams,
    title: () => endpoint.summary.slice(0, 200),
    authorize: (ctx) => { if (endpoint.permission) requirePerm(ctx, endpoint.permission) },
    async run({ ctx, params, readInput, progress }) {
      let rawBody = params.body
      if (params.body_in_input) {
        const bytes = await readInput()
        if (!bytes) throw ServiceError.validation('The request body is missing')
        rawBody = JSON.parse(new TextDecoder().decode(bytes))
      }
      // Same validation as the synchronous route (the stored input is re-checked).
      const input: ApiHandlerInput = {
        ctx,
        params: parse(endpoint.params, params.params, 'params'),
        query: parse(endpoint.query, params.query, 'query'),
        body: parse(endpoint.body, rawBody, 'body'),
      }
      await progress(5, 'Running')
      const data = await handler(input)
      return { data: data ?? null, summary: 'Completed' }
    },
  })
}

/** Endpoints with an async variant, and their handlers. */
export const API_JOB_ENDPOINTS: Array<{ endpoint: EndpointDef; handler: ApiHandler }> = [
  { endpoint: exportConfigEndpoint, handler: exportConfigHandler },
  { endpoint: applyConfigEndpoint, handler: applyConfigHandler },
  { endpoint: bulkDeleteRowsEndpoint, handler: bulkDeleteRowsHandler },
  { endpoint: bulkDeleteReferencesEndpoint, handler: bulkDeleteReferencesHandler },
  { endpoint: migrateWorkflowInstancesEndpoint, handler: migrateInstancesHandler },
  { endpoint: buildPackageVersionEndpoint, handler: buildPackageVersionHandler },
  { endpoint: installPackageEndpoint, handler: installPackageHandler },
  { endpoint: upgradePackageInstallEndpoint, handler: upgradePackageInstallHandler },
  { endpoint: uninstallPackageEndpoint, handler: uninstallPackageHandler },
]

export const API_JOB_KINDS: JobKind<ApiJobParams>[] = API_JOB_ENDPOINTS.map(({ endpoint, handler }) => defineApiJob(endpoint, handler))
