import type { NextRequest } from 'next/server'
import { clientAddress } from '@/lib/gallery/http'
import { isServiceError } from '@/lib/services/context'
import { previewTile, tileCoords } from '@/lib/services/form-control-tiles'

/**
 * GET /form-controls/tiles/gallery/<z>/<x>/<y> — map tiles for the live
 * preview of the official map control on its gallery page. Public, rate
 * limited per address, served from the server's tile cache.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params
  const coords = tileCoords(z, x, y)
  if (!coords) return new Response('Invalid tile', { status: 400, headers: { 'Cache-Control': 'no-store' } })
  try {
    const tile = await previewTile(clientAddress(request.headers), coords)
    return new Response(new Uint8Array(tile.bytes), { headers: { 'Content-Type': tile.type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    const status = isServiceError(error) ? error.status : 502
    return new Response('The map tile is not available', { status, headers: { 'Cache-Control': 'no-store' } })
  }
}
