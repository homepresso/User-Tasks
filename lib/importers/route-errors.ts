import { NextResponse } from 'next/server'
import { isServiceError } from '@/lib/services/context'
import { isExtensionError } from '@/lib/extensions/sdk'

const NO_STORE = { 'Cache-Control': 'no-store' }

/** A JSON error response for the importer dialog routes (service and extension errors as they are, others 500). */
export function importRouteFailure(error: unknown, what: string) {
  if (isServiceError(error)) return NextResponse.json({ error: error.message, code: error.code, details: error.details ?? null }, { status: error.status, headers: NO_STORE })
  if (isExtensionError(error)) {
    const status = error.status >= 400 && error.status <= 599 ? error.status : 500
    return NextResponse.json({ error: error.message, code: error.code, details: error.details ?? null }, { status, headers: NO_STORE })
  }
  console.error(`[importers] ${what}`, error instanceof Error ? error.message : error)
  return NextResponse.json({ error: `Could not ${what} — try again` }, { status: 500, headers: NO_STORE })
}
