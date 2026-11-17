import { NextResponse } from 'next/server'
import { isCloud } from '@/lib/deployment'
import { editionById } from '@/lib/editions/catalog'
import { latestEditionInfo } from '@/lib/editions/pull-service'
import { defaultPullServiceDeps } from '@/lib/editions/server'

/**
 * GET /api/public/extensions/<edition> → { edition, name, available,
 * latest_core_version, latest_edition_version }: which UserTasks release has
 * the newest edition build, so `install.sh --edition sharepoint` installs a
 * release that has one. Versions only — no licence, no credential. Cached
 * for five minutes. Cloud edition only.
 */

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, ctx: { params: Promise<{ edition: string }> }) {
  if (!isCloud()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const edition = editionById((await ctx.params).edition)
  if (!edition) return NextResponse.json({ error: 'Unknown edition' }, { status: 404 })
  const info = await latestEditionInfo(edition, defaultPullServiceDeps(edition))
  return NextResponse.json(info, { headers: { 'Cache-Control': 'public, max-age=60' } })
}
