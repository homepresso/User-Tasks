import type { NextRequest } from 'next/server'
import { getStorageProvider } from '@/lib/providers/storage'
import { serveFontCss } from '@/lib/fonts/serve'

/**
 * GET|HEAD /fonts/g/<slug>/<weights>.css — a Google Fonts stylesheet served
 * from this origin (lib/fonts/serve.ts): fetched from Google once, stored,
 * its font files pointed at /fonts/g/<slug>/<weights>/…. Public (form links
 * use it signed out); cached for a year (the URL names the exact content).
 */

export const dynamic = 'force-dynamic'

async function handle(request: NextRequest, { params }: { params: Promise<{ family: string; variant: string }> }) {
  const { family, variant } = await params
  return serveFontCss(request, family, variant, { storage: getStorageProvider })
}

export const GET = handle
export const HEAD = handle
