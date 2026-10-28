import { NextResponse, type NextRequest } from 'next/server'
import { downloadCommunityPackage } from '@/lib/services/gallery-community'
import { bytesBody, galleryError } from '@/lib/gallery/http'

/** Download a listed community package (?version= for an older one); counts the download. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const file = await downloadCommunityPackage(slug, request.nextUrl.searchParams.get('version'))
    return new NextResponse(bytesBody(file.bytes), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${file.file_name.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
        'X-Content-SHA256': file.sha256,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (error) {
    return galleryError(error, 'download')
  }
}
