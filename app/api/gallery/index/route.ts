import { NextResponse } from 'next/server'
import { officialIndex } from '@/lib/gallery/remote-index'
import { communityIndexEntry, listCommunityPackages } from '@/lib/services/gallery-community'
import { publicBaseUrl } from '@/lib/deployment'

/**
 * The public gallery index: Official packages (public/gallery/index.json,
 * file URLs made absolute) and approved Community packages, each entry
 * tagged with `source`. Self-hosted instances read this (GALLERY_INDEX_URL)
 * to offer the community gallery in Browse gallery.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const base = publicBaseUrl()
  const official = officialIndex()
  const community = (await listCommunityPackages()).map((pkg) => communityIndexEntry(pkg, base))
  const packages = [...official.packages.map((entry) => ({ ...entry, file: `${base}${entry.file}`, page: `${base}${entry.page}` })), ...community]
  return NextResponse.json({ ...official, packages, community_count: community.length }, {
    headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
  })
}
