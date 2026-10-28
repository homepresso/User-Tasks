import { NextResponse, type NextRequest } from 'next/server'
import { getSsoProvider } from '@/lib/providers/auth/sso/config'
import { ssoOrigin } from '@/lib/providers/auth/sso/flow'
import { samlMetadataXml } from '@/lib/providers/auth/sso/saml'

/** SAML SP metadata for IdP `<id>` (entity id, ACS URL, NameID format) — import it at the IdP. */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ idp: string }> }) {
  const { idp: id } = await params
  const idp = await getSsoProvider(id).catch(() => null)
  if (!idp || idp.type !== 'saml') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const xml = await samlMetadataXml(idp, ssoOrigin(request))
    return new NextResponse(xml, { headers: { 'Content-Type': 'application/samlmetadata+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' } })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 503 })
  }
}
