import { NextRequest, NextResponse } from 'next/server'
import { buildPublicConfig, publicConfigScript } from '@/lib/config/public'
import { loadInstanceSettings } from '@/lib/config/instance-settings'

// Runtime values: never prerender at build time.
export const dynamic = 'force-dynamic'

/**
 * Browser-safe instance config (Supabase URL + anon key, app URL, SSO flags).
 * `?format=js` returns a script that installs it as window.__USERTASKS_CONFIG__;
 * the root layout loads that form on pages prerendered without the values.
 */
export async function GET(request: NextRequest) {
  // Warm the settings cache so an instance-level realtime provider is included.
  await loadInstanceSettings()
  const config = buildPublicConfig()
  const headers = { 'Cache-Control': 'public, max-age=60, s-maxage=60' }
  if (request.nextUrl.searchParams.get('format') === 'js') {
    return new NextResponse(publicConfigScript(config), {
      headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' },
    })
  }
  return NextResponse.json(config, { headers })
}
