import type { NextRequest } from 'next/server'
import { getStorageProvider } from '@/lib/providers/storage'
import { serveFontFile } from '@/lib/fonts/serve'

/**
 * GET|HEAD /fonts/g/<slug>/<weights>/<dir>/<version>/<name>.woff2 — a font
 * file named by the stylesheet next to it (lib/fonts/serve.ts): stored on
 * first use, then served from storage. Anything the stylesheet doesn't name
 * is a 404.
 */

export const dynamic = 'force-dynamic'

async function handle(request: NextRequest, { params }: { params: Promise<{ family: string; variant: string; file: string[] }> }) {
  const { family, variant, file } = await params
  return serveFontFile(request, family, variant, file, { storage: getStorageProvider })
}

export const GET = handle
export const HEAD = handle
