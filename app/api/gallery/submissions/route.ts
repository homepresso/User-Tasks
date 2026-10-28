import { NextResponse, type NextRequest } from 'next/server'
import { listMySubmissions, submitCommunityPackage } from '@/lib/services/gallery-community'
import { clientAddress, galleryError, NO_STORE, sessionUser } from '@/lib/gallery/http'
import { COMMUNITY_LIMITS } from '@/lib/gallery/community'

/**
 * "Share your solution": a signed-in user uploads a .utpkg with its listing
 * and screenshots (multipart/form-data: `file`, `listing` JSON, `screenshots`
 * files). The package is validated at once; a valid one is queued for a
 * moderator and nothing is public until it is approved.
 * GET lists the caller's own submissions.
 */

export async function POST(request: NextRequest) {
  try {
    const user = await sessionUser()
    if (!user) return NextResponse.json({ error: 'Sign in to share a solution' }, { status: 401, headers: NO_STORE })
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
      return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 415, headers: NO_STORE })
    }
    const declared = Number(request.headers.get('content-length') ?? 0)
    const max = COMMUNITY_LIMITS.packageBytes + COMMUNITY_LIMITS.screenshots * COMMUNITY_LIMITS.screenshotBytes + 256 * 1024
    if (declared > max) return NextResponse.json({ error: 'The upload is too large' }, { status: 413, headers: NO_STORE })
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'Attach the .utpkg file' }, { status: 400, headers: NO_STORE })
    let listing: unknown
    try {
      listing = JSON.parse(String(form.get('listing') ?? '{}'))
    } catch {
      return NextResponse.json({ error: 'listing must be JSON' }, { status: 400, headers: NO_STORE })
    }
    const screenshots = await Promise.all(form.getAll('screenshots').filter((s): s is File => s instanceof File && s.size > 0).map(async (s) => ({ name: s.name, type: s.type, bytes: new Uint8Array(await s.arrayBuffer()) })))
    const submission = await submitCommunityPackage(user, { file: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, listing, screenshots }, { ip: clientAddress(request.headers) })
    return NextResponse.json({ submission }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return galleryError(error, 'submit')
  }
}

export async function GET() {
  try {
    const user = await sessionUser()
    if (!user) return NextResponse.json({ error: 'Sign in' }, { status: 401, headers: NO_STORE })
    return NextResponse.json({ submissions: await listMySubmissions(user) }, { headers: NO_STORE })
  } catch (error) {
    return galleryError(error, 'list submissions')
  }
}
