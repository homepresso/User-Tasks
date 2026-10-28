import { NextResponse, type NextRequest } from 'next/server'
import { fetchRemotePackage } from '@/lib/gallery/remote-index'
import { bytesBody, NO_STORE, sessionUser } from '@/lib/gallery/http'

/**
 * A remote community package for the install wizard (self-hosted): fetched
 * server-side from the configured gallery index's origin only (5 MB cap).
 * The wizard then verifies the file like any other upload.
 */
export async function GET(request: NextRequest) {
  if (!(await sessionUser())) return NextResponse.json({ error: 'Sign in' }, { status: 401, headers: NO_STORE })
  const slug = String(request.nextUrl.searchParams.get('slug') ?? '')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return NextResponse.json({ error: 'Invalid package' }, { status: 400, headers: NO_STORE })
  try {
    const file = await fetchRemotePackage(slug)
    return new NextResponse(bytesBody(file.bytes), { headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': file.file_name, ...NO_STORE } })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502, headers: NO_STORE })
  }
}
