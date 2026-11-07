import { NextResponse } from 'next/server'
import { versionInfo } from '@/lib/version'

// The commit and build time come from the runtime environment: never prerender.
export const dynamic = 'force-dynamic'

/** The running version (package.json), git commit and build time; unauthenticated, no secrets. */
export function GET() {
  return NextResponse.json(versionInfo(), {
    headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' },
  })
}
