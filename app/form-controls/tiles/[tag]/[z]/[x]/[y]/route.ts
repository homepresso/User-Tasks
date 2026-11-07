import type { NextRequest } from 'next/server'
import { isServiceError } from '@/lib/services/context'
import { frameContext } from '@/lib/services/form-control-frame'
import { controlTile, tileCoords } from '@/lib/services/form-control-tiles'

/**
 * GET /form-controls/tiles/<tag>/<z>/<x>/<y>[?task=<id>|?w=<workspace>] — an
 * OpenStreetMap tile for a custom control's `tile` request, fetched by the
 * server (lib/services/form-control-tiles.ts). Session auth; the control must
 * be enabled with tile.openstreetmap.org approved in the workspace.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ tag: string; z: string; x: string; y: string }> }) {
  const { tag, z, x, y } = await params
  const coords = tileCoords(z, x, y)
  if (!coords) return new Response('Invalid tile', { status: 400, headers: { 'Cache-Control': 'no-store' } })
  try {
    const ctx = await frameContext(new URL(request.url).searchParams)
    const tile = await controlTile(ctx, decodeURIComponent(tag), coords)
    return new Response(new Uint8Array(tile.bytes), { headers: { 'Content-Type': tile.type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    const status = isServiceError(error) ? error.status : 502
    return new Response(isServiceError(error) ? error.message : 'The map tile is not available', { status, headers: { 'Cache-Control': 'no-store' } })
  }
}
