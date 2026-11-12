import { getStorageProvider } from '@/lib/providers/storage'
import { fontStatus } from '@/lib/fonts/serve'

/**
 * GET /fonts/status — what the font pickers may offer: `remote` (Google
 * Fonts not stored yet can still be fetched) and `stored` (families already
 * on this instance; with remote fetching off, the only Google fonts that
 * load). No workspace data; cached briefly.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const status = await fontStatus({ storage: getStorageProvider })
  return Response.json(status, { headers: { 'Cache-Control': 'private, max-age=60' } })
}
