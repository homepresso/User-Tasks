import { handleGatewayRequest } from '@/lib/gateway/handlers'

/**
 * /api/gateway/v1/<…>: the on-premises gateway channel (lib/gateway). Gateways
 * dial out to it over HTTPS; every call after registration is signed by the
 * gateway instance's own key, every answer by the server's. One route file
 * for the whole protocol keeps it to one serverless function. The long poll
 * holds up to 25 s.
 */
type Context = { params: Promise<{ path: string[] }> }

export const maxDuration = 60
export const dynamic = 'force-dynamic'

async function handle(request: Request, context: Context) {
  const { path } = await context.params
  return handleGatewayRequest(request, path ?? [])
}

export const GET = handle
export const POST = handle
export const PUT = handle
