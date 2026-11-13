import type { NextRequest } from 'next/server'
import { dispatchPublicRoute } from '@/lib/extensions/api'

/**
 * /ext-public/<extension id>/<path>: inbound callbacks of the extensions
 * compiled into this build (receivers, webhooks). Only routes a manifest
 * declares in capabilities.inbound_public_routes exist; each picks its own
 * authentication (lib/extensions/api.ts). Rate limited, body capped,
 * audited. 404 in the public build.
 */
type Context = { params: Promise<{ ext: string; path: string[] }> }

async function handle(request: NextRequest, context: Context) {
  const { ext, path } = await context.params
  return dispatchPublicRoute(request, ext, path ?? [])
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
