import type { NextRequest } from 'next/server'
import { serveTrustedBundle } from '@/lib/services/form-control-frame'

/**
 * GET|HEAD /form-controls/bundle/<tag>/<version>.js — a TRUSTED custom form
 * control's module, loaded into the page itself (an instance admin opted in).
 * Untrusted controls only ever run in the sandboxed frame.
 */

export const dynamic = 'force-dynamic'

async function handle(request: NextRequest, { params }: { params: Promise<{ tag: string; file: string }> }) {
  const { tag, file } = await params
  return serveTrustedBundle(request, decodeURIComponent(tag), decodeURIComponent(file))
}

export const GET = handle
export const HEAD = handle
