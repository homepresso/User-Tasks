import type { NextRequest } from 'next/server'
import { dispatchExtensionApi } from '@/lib/extensions/api'

/**
 * /api/v1/ext/<extension id>/<path>: the REST endpoints of the extensions
 * compiled into this build (lib/extensions/api.ts). Same pipeline as core
 * endpoints (Bearer token, permission, zod validation, envelope) plus the
 * workspace check: 403 not enabled, 402 not licensed. 404 in the public build.
 */
type Context = { params: Promise<{ ext: string; path: string[] }> }

async function handle(request: NextRequest, context: Context) {
  const { ext, path } = await context.params
  return dispatchExtensionApi(request, ext, path ?? [])
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
