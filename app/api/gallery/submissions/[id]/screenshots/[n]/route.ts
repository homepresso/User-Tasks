import { NextResponse, type NextRequest } from 'next/server'
import { readScreenshot } from '@/lib/services/gallery-community'
import { bytesBody, galleryError, NO_STORE, sessionUser } from '@/lib/gallery/http'

/** A pending submission's screenshot, for its submitter and the moderators only. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  try {
    const { id, n } = await params
    const user = await sessionUser()
    if (!user) return NextResponse.json({ error: 'Sign in' }, { status: 401, headers: NO_STORE })
    const shot = await readScreenshot({ submissionId: id }, Number(n), user)
    return new NextResponse(bytesBody(shot.bytes), { headers: { 'Content-Type': shot.type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } })
  } catch (error) {
    return galleryError(error, 'submission screenshot')
  }
}
