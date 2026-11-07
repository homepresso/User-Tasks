import type { NextRequest } from 'next/server'
import { serveControlFrame } from '@/lib/services/form-control-frame'

/**
 * GET|HEAD /form-controls/frame/<tag>/<version> — the sandboxed document a
 * custom form control runs in (its own CSP; see lib/forms/custom-controls/frame.ts).
 * proxy.ts and next.config.ts leave this path's security headers to the route.
 */

export const dynamic = 'force-dynamic'

async function handle(request: NextRequest, { params }: { params: Promise<{ tag: string; version: string }> }) {
  const { tag, version } = await params
  return serveControlFrame(request, decodeURIComponent(tag), decodeURIComponent(version))
}

export const GET = handle
export const HEAD = handle
