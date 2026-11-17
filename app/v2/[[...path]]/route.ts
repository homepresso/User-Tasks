import { NextRequest, NextResponse } from 'next/server'
import { isCloud } from '@/lib/deployment'
import { handleRegistryRequest } from '@/lib/editions/registry-front'
import { defaultRegistryFrontDeps } from '@/lib/editions/server'

/**
 * The usertasks.com registry front: `docker login usertasks.com` and
 * `docker pull usertasks.com/editions/<edition>@sha256:…` with a pull token
 * from POST /api/public/extensions/<edition>/pull-token
 * (lib/editions/registry-front.ts). Cloud edition only.
 *
 * Docker calls `/v2/` with the trailing slash: next.config sets
 * skipTrailingSlashRedirect and proxy.ts keeps the usual slash redirect for
 * every other path, so this route sees `/v2/` as it is.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle(request: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  if (!isCloud()) return NextResponse.json({ errors: [{ code: 'NAME_UNKNOWN', message: 'not found' }] }, { status: 404 })
  const { path } = await ctx.params
  return handleRegistryRequest({
    method: request.method,
    segments: (path ?? []).map((s) => decodeURIComponent(s)).filter(Boolean),
    authorization: request.headers.get('authorization'),
    accept: request.headers.get('accept'),
  }, defaultRegistryFrontDeps())
}

export const GET = handle
export const HEAD = handle
