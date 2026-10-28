import { type NextRequest, NextResponse } from 'next/server'
import { readScreenshot } from '@/lib/services/gallery-community'
import { bytesBody, galleryError } from '@/lib/gallery/http'

/** A listed community package's screenshot (SVGs were sanitised on upload and are served sandboxed). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string; n: string }> }) {
  try {
    const { slug, n } = await params
    const shot = await readScreenshot({ slug }, Number(n))
    return new NextResponse(bytesBody(shot.bytes), { headers: { 'Content-Type': shot.type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } })
  } catch (error) {
    return galleryError(error, 'screenshot')
  }
}
