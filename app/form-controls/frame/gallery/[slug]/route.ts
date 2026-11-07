import type { NextRequest } from 'next/server'
import { serveGalleryControlFrame } from '@/lib/gallery/control-preview'

/**
 * GET|HEAD /form-controls/frame/gallery/<slug> — the sandboxed live preview
 * of an official gallery form control (the website's /gallery/controls/<slug>
 * page frames it). Public: the module is the published gallery package's.
 * proxy.ts and next.config.ts leave this path's security headers to the route.
 */

export const dynamic = 'force-dynamic'

async function handle(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return serveGalleryControlFrame(request, decodeURIComponent(slug))
}

export const GET = handle
export const HEAD = handle
