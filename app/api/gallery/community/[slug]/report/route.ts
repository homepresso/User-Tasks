import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { reportAbuse } from '@/lib/services/gallery-community'
import { clientAddress, galleryError, NO_STORE, sessionUser } from '@/lib/gallery/http'

const Body = z.object({
  reason: z.string().max(40),
  details: z.string().max(2000).optional(),
  version: z.string().max(40).optional(),
  website: z.string().max(0).optional(),
})

/** "Report abuse" on a community package page (anyone; rate limited per address). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return NextResponse.json({ error: 'Expected application/json' }, { status: 415, headers: NO_STORE })
    }
    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Choose a reason' }, { status: 400, headers: NO_STORE })
    const { slug } = await params
    const user = await sessionUser()
    await reportAbuse({ slug, reason: parsed.data.reason, details: parsed.data.details, version: parsed.data.version }, { userId: user?.id ?? null, ip: clientAddress(request.headers) })
    return NextResponse.json({ ok: true }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return galleryError(error, 'report')
  }
}
