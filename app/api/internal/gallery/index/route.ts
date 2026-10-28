import { NextResponse } from 'next/server'
import { instanceGallery } from '@/lib/gallery/remote-index'
import { NO_STORE, sessionUser } from '@/lib/gallery/http'

/**
 * Browse gallery (Automations → Packages): Official packages from this
 * instance plus Community packages (this instance's own on usertasks.com,
 * else the public index at GALLERY_INDEX_URL). Signed-in users only.
 */
export async function GET() {
  if (!(await sessionUser())) return NextResponse.json({ error: 'Sign in' }, { status: 401, headers: NO_STORE })
  return NextResponse.json(await instanceGallery(), { headers: NO_STORE })
}
