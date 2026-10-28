/** Small helpers shared by the gallery route handlers. */

import { NextResponse } from 'next/server'
import { isServiceError } from '@/lib/services/context'

export const NO_STORE = { 'Cache-Control': 'no-store' }

/** The client address (first X-Forwarded-For hop, X-Real-IP, or unknown); only ever hashed. */
export function clientAddress(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown'
}

export function galleryError(error: unknown, label: string) {
  if (isServiceError(error)) {
    return NextResponse.json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) }, { status: error.status, headers: NO_STORE })
  }
  console.error(`[gallery] ${label}`, error)
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500, headers: NO_STORE })
}

/** The signed-in user (id + email), or null. */
export async function sessionUser(): Promise<{ id: string; email: string | null } | null> {
  try {
    const { getSessionDbWithUser } = await import('@/lib/providers/db/session')
    const { user } = await getSessionDbWithUser()
    return user ? { id: user.id, email: user.email ?? null } : null
  } catch {
    return null
  }
}

/** Bytes as a download / image response body. */
export function bytesBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
